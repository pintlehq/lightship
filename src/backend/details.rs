//! Resource identity, scoped events and ownership-checked workload log targets.
use super::*;
use std::collections::HashSet;

pub(super) fn same_uid(expected: &Value, current: &Value) -> Result<(), String> {
    let expected = expected["metadata"]["uid"]
        .as_str()
        .filter(|s| !s.is_empty());
    if expected.is_some() && expected != current["metadata"]["uid"].as_str() {
        return Err("Resource replaced · the original UID no longer exists. Open the new resource from its list.".into());
    }
    Ok(())
}
fn controlled_by(object: &Value, owners: &HashSet<String>) -> bool {
    object["metadata"]["ownerReferences"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|owner| {
            owner["controller"] == true
                && owner["uid"]
                    .as_str()
                    .is_some_and(|uid| owners.contains(uid))
        })
}
impl Session {
    pub(super) async fn detail_for(&self, spec: &Spec, seed: Value) -> Result<Detail, String> {
        let mut revisions = Vec::new();
        let mut object = if spec.key == "helm" {
            let releases = self.helm().await?;
            revisions=releases.iter().filter(|r|r["name"]==seed["name"] && r["metadata"]["namespace"]==seed["metadata"]["namespace"]).map(|r|json!({"metadata":{"name":r["metadata"]["name"],"namespace":r["metadata"]["namespace"],"uid":r["metadata"]["uid"]},"kind":"HelmRelease","name":r["name"],"version":r["version"],"status":r["info"]["status"]})).collect();
            revisions.sort_by_key(|r| std::cmp::Reverse(r["version"].as_u64()));
            releases
                .into_iter()
                .find(|release| {
                    release["metadata"]["uid"] == seed["metadata"]["uid"]
                        && release["version"] == seed["version"]
                })
                .ok_or("Helm release revision unavailable · refresh the release list")?
        } else {
            self.json(&spec.item(&seed)).await.map_err(|e| {
                if e == "API or resource unavailable" {
                    "Resource unavailable · it may have been deleted or its API removed".to_string()
                } else {
                    e
                }
            })?
        };
        same_uid(&seed, &object)?;
        if spec.key == "secrets" {
            object["kind"] = json!("Secret");
        }
        let events = if let Some(uid) = object["metadata"]["uid"].as_str() {
            let fields = format!("involvedObject.uid={uid}");
            match self
                .list_scoped(
                    &builtin("events"),
                    object["metadata"]["namespace"].as_str(),
                    None,
                    Some(&fields),
                )
                .await
            {
                Ok((items, _)) => json!({"items": items}),
                Err(e) => json!({"unavailable": e}),
            }
        } else {
            json!({"items": []})
        };
        let mut sections = Vec::new();
        let name = object["metadata"]["name"].as_str().unwrap_or("");
        match spec.key.as_str() {
            "pods" => {
                let rows = object["spec"]["containers"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|c| {
                        let status = object["status"]["containerStatuses"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .find(|s| s["name"] == c["name"]);
                        format!(
                            "{}   {}   {}",
                            c["name"].as_str().unwrap_or("—"),
                            c["image"].as_str().unwrap_or("—"),
                            if status.is_some_and(|s| s["ready"] == true) {
                                "Ready"
                            } else {
                                "Not ready"
                            }
                        )
                    })
                    .collect();
                sections.push(("Containers".into(), rows));
            }
            "nodes" => {
                let mut capacity = Vec::new();
                for field in ["cpu", "memory", "pods", "ephemeral-storage"] {
                    if let Some(total) = object["status"]["capacity"][field].as_str() {
                        capacity.push(format!(
                            "{field}  {} allocatable / {total} capacity",
                            object["status"]["allocatable"][field]
                                .as_str()
                                .unwrap_or("—")
                        ));
                    }
                }
                sections.push(("Capacity and allocatable".into(), capacity));
                let assigned = self
                    .list_scoped(
                        &builtin("pods"),
                        None,
                        None,
                        Some(&format!("spec.nodeName={name}")),
                    )
                    .await;
                sections.push((
                    "Pods on this node".into(),
                    assigned
                        .map(|(pods, _)| {
                            pods.iter()
                                .map(|p| {
                                    format!(
                                        "{} / {}",
                                        p["metadata"]["namespace"].as_str().unwrap_or("—"),
                                        p["metadata"]["name"].as_str().unwrap_or("—")
                                    )
                                })
                                .collect()
                        })
                        .unwrap_or_else(|e| vec![e]),
                ));
            }
            "namespaces" => {
                for (key, title) in [
                    ("pods", "Pods"),
                    ("resourcequotas", "Resource quotas"),
                    ("limitranges", "Limit ranges"),
                    ("networkpolicies", "Network policies"),
                ] {
                    let result = self
                        .list_scoped(&builtin(key), Some(name), None, None)
                        .await;
                    let rows = result
                        .map(|(items, _)| {
                            items
                                .iter()
                                .map(|i| {
                                    let name = i["metadata"]["name"].as_str().unwrap_or("—");
                                    match key {
                                        "pods" => format!(
                                            "{}   {}",
                                            name,
                                            i["status"]["phase"].as_str().unwrap_or("—")
                                        ),
                                        "resourcequotas" => format!(
                                            "{}   used {} / hard {}",
                                            name, i["status"]["used"], i["spec"]["hard"]
                                        ),
                                        "limitranges" => {
                                            format!("{}   {}", name, i["spec"]["limits"])
                                        }
                                        _ => name.to_owned(),
                                    }
                                })
                                .collect()
                        })
                        .unwrap_or_else(|e| vec![e]);
                    sections.push((title.into(), rows));
                }
            }
            _ => {}
        }
        Ok(Detail {
            object,
            events,
            sections,
            revisions,
        })
    }
    pub(super) async fn related_pods(
        &self,
        key: &str,
        object: &Value,
    ) -> Result<Vec<Value>, String> {
        let namespace = object["metadata"]["namespace"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("Resource has no namespace")?;
        let uid = object["metadata"]["uid"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("Resource has no UID")?;
        if key == "pods" {
            return Ok(vec![object.clone()]);
        }
        if !matches!(key, "deployments" | "statefulsets" | "daemonsets" | "jobs") {
            return Err("Logs are not supported for this resource type".into());
        }
        let mut owners = HashSet::from([uid.to_string()]);
        if key == "deployments" {
            let (replicas, _) = self
                .list_scoped(&builtin("replicasets"), Some(namespace), None, None)
                .await?;
            owners = replicas
                .iter()
                .filter(|rs| rs["metadata"]["namespace"] == namespace && controlled_by(rs, &owners))
                .filter_map(|rs| rs["metadata"]["uid"].as_str().map(str::to_owned))
                .collect();
            if owners.is_empty() {
                return Ok(Vec::new());
            }
        }
        let (pods, _) = self
            .list_scoped(&builtin("pods"), Some(namespace), None, None)
            .await?;
        let mut pods: Vec<_> = pods
            .into_iter()
            .filter(|pod| pod["metadata"]["namespace"] == namespace && controlled_by(pod, &owners))
            .collect();
        pods.sort_by(|a, b| {
            a["metadata"]["name"]
                .as_str()
                .cmp(&b["metadata"]["name"].as_str())
        });
        Ok(pods)
    }
}
