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
        let mut object = if spec.key == "helm" {
            self.helm()
                .await?
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
        Ok(Detail { object, events })
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
