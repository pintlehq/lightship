//! Cordon and evict only identified pods assigned to the reviewed node.
use super::*;
use std::collections::HashSet;

#[derive(Clone)]
pub struct DrainProgress {
    pub message: String,
    pub done: bool,
}

enum Disposition {
    Skip,
    Evict,
    Wait,
}
fn disposition(p: &Value) -> Result<Disposition, String> {
    if p["metadata"]["annotations"]
        .get("kubernetes.io/config.mirror")
        .is_some()
        || matches!(p["status"]["phase"].as_str(), Some("Succeeded" | "Failed"))
    {
        return Ok(Disposition::Skip);
    }
    let owner = p["metadata"]["ownerReferences"]
        .as_array()
        .and_then(|refs| refs.iter().find(|r| r["controller"] == true));
    if owner.is_some_and(|r| r["kind"] == "DaemonSet") {
        return Ok(Disposition::Skip);
    }
    let name = p["metadata"]["name"].as_str().unwrap_or("unknown");
    if owner.is_none() {
        return Err(format!("Unmanaged Pod {name} blocks drain"));
    }
    if p["spec"]["volumes"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|v| v.get("emptyDir").is_some())
    {
        return Err(format!("Pod {name} has emptyDir storage"));
    }
    for key in ["uid", "name", "namespace", "resourceVersion"] {
        if p["metadata"][key].as_str().is_none_or(str::is_empty) {
            return Err("Pod identity incomplete".into());
        }
    }
    Ok(if p["metadata"]["deletionTimestamp"].is_string() {
        Disposition::Wait
    } else {
        Disposition::Evict
    })
}
fn identifier(value: &Value) -> Result<&str, String> {
    value
        .as_str()
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 253
                && s.bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'.')
                && *s != "."
                && *s != ".."
        })
        .ok_or_else(|| "Invalid Kubernetes resource name".into())
}
impl Backend {
    pub fn drain(self: &Arc<Self>, id: &str, node: Value) -> Job<DrainProgress> {
        let backend = self.clone();
        let id = id.to_owned();
        let session = self.session(&id);
        let (sender, receiver) = watch::channel(None);
        let task = self.runtime.spawn(async move {
            let report = |message| {
                let _ = sender.send(Some(Ok(DrainProgress {
                    message,
                    done: false,
                })));
            };
            let result = tokio::time::timeout(Duration::from_secs(300), async {
                drain_node(&session?, &node, report).await
            })
            .await
            .unwrap_or_else(|_| Err("Drain timed out · check node and remaining Pods".into()));
            backend.mutation_changed(&id);
            let _ = sender.send(Some(result.map(|message| DrainProgress {
                message,
                done: true,
            })));
        });
        Job {
            receiver,
            task,
            closed: false,
        }
    }
}
async fn drain_node(
    session: &Arc<Session>,
    node: &Value,
    report: impl Fn(String),
) -> Result<String, String> {
    let name = identifier(&node["metadata"]["name"])?;
    let path = format!("/api/v1/nodes/{name}");
    let current = bounded(session.json(&path)).await?;
    let uid = node["metadata"]["uid"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Missing node UID")?;
    let version = node["metadata"]["resourceVersion"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Missing node version")?;
    if current["metadata"]["uid"] != uid || current["metadata"]["resourceVersion"] != version {
        return Err("Node changed since review".into());
    }
    if current["spec"]["unschedulable"] != true {
        report(format!("Cordoning {name}"));
        let patch = json!([
            {"op":"test","path":"/metadata/uid","value":uid},
            {"op":"test","path":"/metadata/resourceVersion","value":version},
            {"op":"add","path":"/spec/unschedulable","value":true}
        ]);
        let req = session.policy.seal(
            http::Method::PATCH,
            &path,
            "application/json-patch+json",
            patch.to_string().into_bytes(),
        )?;
        bounded(async { session.client.request::<Value>(req).await.map_err(error) }).await?;
    }
    let mut accepted = HashSet::new();
    loop {
        let current = bounded(session.json(&path)).await?;
        if current["metadata"]["uid"] != uid || current["spec"]["unschedulable"] != true {
            return Err("Node replaced or no longer cordoned".into());
        }
        let selector = format!("spec.nodeName={name}");
        let (pods, _) =
            bounded(session.list_scoped(&builtin("pods"), None, None, Some(&selector))).await?;
        let mut pending = Vec::new();
        for pod in &pods {
            if pod["spec"]["nodeName"] != name {
                return Err("Pod list contains a different node".into());
            }
            match disposition(pod)? {
                Disposition::Skip => {}
                state => pending.push((pod, state)),
            }
        }
        if pending.is_empty() {
            return Ok(format!("Drain complete · {name} is cordoned"));
        }
        report(format!(
            "{} Pods remaining · {} evictions accepted",
            pending.len(),
            accepted.len()
        ));
        for (pod, state) in pending {
            let meta = &pod["metadata"];
            let uid = meta["uid"].as_str().ok_or("Missing Pod UID")?;
            if matches!(state, Disposition::Wait) || accepted.contains(uid) {
                continue;
            }
            let namespace = identifier(&meta["namespace"])?;
            let name = identifier(&meta["name"])?;
            let path = format!("/api/v1/namespaces/{namespace}/pods/{name}/eviction");
            let body = json!({"apiVersion":"policy/v1","kind":"Eviction","metadata":{"name":name,"namespace":namespace},"deleteOptions":{"preconditions":{"uid":uid,"resourceVersion":meta["resourceVersion"]}}});
            let request = session.policy.seal(
                http::Method::POST,
                &path,
                "application/json",
                body.to_string().into_bytes(),
            )?;
            match tokio::time::timeout(
                Duration::from_secs(15),
                session.client.request::<Value>(request),
            )
            .await
            {
                Ok(Ok(_)) => {
                    accepted.insert(uid.to_owned());
                }
                Ok(Err(kube::Error::Api(e))) if matches!(e.code, 404 | 429) => break,
                Ok(Err(e)) => return Err(error(e)),
                Err(_) => return Err("Eviction timed out · check the node before retrying".into()),
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}
async fn bounded<T>(
    future: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    tokio::time::timeout(Duration::from_secs(15), future)
        .await
        .map_err(|_| "Kubernetes request timed out".to_owned())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drain_waits_for_evictions_and_respects_disruption_budget() {
        use crate::backend::tests::mock_backend;
        use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
        let attempts = Arc::new(AtomicUsize::new(0));
        let seen = attempts.clone();
        let cordoned = AtomicBool::new(false);
        let node = json!({"metadata":{"uid":"n","name":"worker","resourceVersion":"1"}});
        let n = node.clone();
        let backend = mock_backend(move |req| match (req.method().as_str(), req.uri().path()) {
            ("PATCH", "/api/v1/nodes/worker") => {
                cordoned.store(true, Ordering::SeqCst);
                (200, n.to_string())
            }
            ("GET", "/api/v1/nodes/worker") => {
                let mut node = n.clone();
                node["spec"]["unschedulable"] = json!(cordoned.load(Ordering::SeqCst));
                (200, node.to_string())
            }
            ("GET", "/api/v1/pods") => {
                assert!(req.uri().query().unwrap().contains("fieldSelector="));
                let mut pods = Vec::new();
                if seen.load(Ordering::SeqCst) < 2 {
                    pods.push(json!({"metadata":{"namespace":"apps","name":"api","uid":"p","resourceVersion":"3","ownerReferences":[{"controller":true,"kind":"ReplicaSet"}]},"spec":{"nodeName":"worker"}}));
                }
                (
                    200,
                    json!({"metadata":{"resourceVersion":"4"},"items":pods}).to_string(),
                )
            }
            ("POST", "/api/v1/namespaces/apps/pods/api/eviction") => {
                if seen.fetch_add(1, Ordering::SeqCst) == 0 {
                    (429,json!({"kind":"Status","status":"Failure","message":"disruption budget","reason":"TooManyRequests","code":429}).to_string())
                } else {
                    (201, "{}".into())
                }
            }
            _ => panic!("Unexpected drain request"),
        });
        let mut job = backend.drain("test", node);
        let deadline = std::time::Instant::now() + Duration::from_secs(12);
        loop {
            if let Some(value) = job.take() {
                let progress = value.unwrap();
                if progress.done {
                    assert!(progress.message.contains("complete"));
                    break;
                }
            }
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }
    #[test]
    fn empty_dir_unmanaged_and_mirror_pods_have_distinct_drain_rules() {
        let mut p =
            json!({"metadata":{"name":"p","namespace":"n","uid":"u","resourceVersion":"1"}});
        assert!(disposition(&p).is_err());
        p["metadata"]["ownerReferences"] = json!([{"controller":true,"kind":"ReplicaSet"}]);
        assert!(matches!(disposition(&p), Ok(Disposition::Evict)));
        p["spec"]["volumes"] = json!([{"emptyDir":{}}]);
        assert!(disposition(&p).is_err());
        p["metadata"]["annotations"] = json!({"kubernetes.io/config.mirror":"x"});
        assert!(matches!(disposition(&p), Ok(Disposition::Skip)));
    }
}
