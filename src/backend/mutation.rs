//! Reviewed, session-bound Kubernetes mutations. No client or arbitrary HTTP API escapes.
use super::*;
use http::Method;
use serde::Deserialize;

pub const MAX_YAML: usize = 4 * 1024 * 1024;
#[derive(Clone)]
pub(super) struct Discovered {
    kind: String,
    spec: Spec,
    verbs: Vec<String>,
}
#[derive(Clone)]
enum Change {
    Apply,
    Replace,
    Restart,
    DeletePod,
    Skip(String),
}
#[derive(Clone)]
struct Operation {
    target: String,
    path: String,
    before: Option<Value>,
    desired: Value,
    change: Change,
    warning: String,
}
/// A review is tied to the exact session and payload; changing clusters cannot retarget it.
#[derive(Clone)]
pub struct Prepared {
    connection: String,
    session: Arc<Session>,
    operations: Vec<Operation>,
    stop_on_error: bool,
}
impl Prepared {
    pub fn review(&self, context: &str) -> String {
        let mut text = format!(
            "Cluster: {context}\n{} target(s)\n\n",
            self.operations.len()
        );
        for op in &self.operations {
            text.push_str(&op.target);
            if let Change::Skip(reason) = &op.change {
                text.push_str(&format!(" · skipped: {reason}"));
            }
            if !op.warning.is_empty() {
                text.push_str(&format!("\n{}", op.warning));
            }
            text.push('\n');
        }
        if self
            .operations
            .iter()
            .any(|op| matches!(op.change, Change::DeletePod))
        {
            text.push_str("\nPods are deleted gracefully; their controller must create replacements. Direct deletion bypasses PodDisruptionBudgets. Restart requested does not mean Ready.");
        }
        text
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Succeeded,
    Failed,
    Unknown,
    Skipped,
}
#[derive(Clone)]
pub struct ItemReport {
    pub target: String,
    pub uid: Option<String>,
    pub outcome: Outcome,
    pub message: String,
}
#[derive(Clone)]
pub struct BatchReport {
    pub items: Vec<ItemReport>,
    pub check: Option<Prepared>,
}
impl BatchReport {
    pub fn text(&self) -> String {
        self.items
            .iter()
            .map(|r| format!("{} · {}", r.target, r.message))
            .collect::<Vec<_>>()
            .join("\n")
    }
    pub fn succeeded(&self) -> bool {
        !self.items.is_empty() && self.items.iter().all(|r| r.outcome == Outcome::Succeeded)
    }
}
fn segment(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 253
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.'))
        || value == "."
        || value == ".."
    {
        Err("Invalid resource identity".into())
    } else {
        Ok(value)
    }
}
fn required<'a>(value: &'a Value, pointer: &str) -> Result<&'a str, String> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Resource requires apiVersion, kind and metadata.name".into())
}
/// Removes server-owned fields, retaining the editable object without masking values.
pub fn editable(object: &Value) -> Value {
    let mut object = object.clone();
    if let Some(map) = object.as_object_mut() {
        map.remove("status");
    }
    if let Some(meta) = object.get_mut("metadata").and_then(Value::as_object_mut) {
        for key in [
            "uid",
            "resourceVersion",
            "managedFields",
            "creationTimestamp",
            "deletionTimestamp",
            "deletionGracePeriodSeconds",
            "generation",
            "selfLink",
        ] {
            meta.remove(key);
        }
    }
    object
}
fn manifests(source: &str) -> Result<Vec<Value>, String> {
    if source.len() > MAX_YAML {
        return Err("YAML exceeds the 4 MiB editor limit".into());
    }
    let mut result = Vec::new();
    for document in serde_yaml::Deserializer::from_str(source) {
        let object = Value::deserialize(document)
            .map_err(|_| "Invalid YAML/JSON · check syntax and string field types")?;
        if object.is_null() {
            continue;
        }
        if !object.is_object() {
            return Err("Each document must be a Kubernetes object".into());
        }
        if object["kind"] == "List" {
            let items = object["items"].as_array().ok_or("List requires items")?;
            result.extend(items.iter().cloned());
        } else {
            result.push(object);
        }
    }
    if result.is_empty() {
        return Err("Enter at least one Kubernetes resource".into());
    }
    Ok(result)
}
fn same_identity(a: &Value, b: &Value) -> bool {
    [
        "/apiVersion",
        "/kind",
        "/metadata/name",
        "/metadata/namespace",
    ]
    .iter()
    .all(|p| a.pointer(p) == b.pointer(p))
}
fn contains(actual: &Value, wanted: &Value) -> bool {
    match wanted {
        Value::Object(map) => map
            .iter()
            .all(|(k, v)| actual.get(k).is_some_and(|a| contains(a, v))),
        _ => actual == wanted,
    }
}
impl Session {
    async fn discover(&self, api: &str, kind: &str, verb: &str) -> Result<Spec, String> {
        let parts: Vec<_> = api.split('/').collect();
        let path = match parts.as_slice() {
            [version] => format!("/api/{}", segment(version)?),
            [group, version] => format!("/apis/{}/{}", segment(group)?, segment(version)?),
            _ => return Err("Invalid apiVersion".into()),
        };
        let cached = self
            .discovery
            .lock()
            .unwrap()
            .get(api)
            .cloned()
            .filter(|resources| resources.iter().any(|r| r.kind == kind));
        let resources = if let Some(cached) = cached {
            cached
        } else {
            let data = tokio::time::timeout(Duration::from_secs(10), self.json(&path))
                .await
                .map_err(|_| "API discovery timed out")??;
            let resources = data["resources"]
                .as_array()
                .ok_or("API discovery unavailable")?
                .iter()
                .filter_map(|r| {
                    let plural = r["name"].as_str()?;
                    if plural.contains('/') || segment(plural).is_err() {
                        return None;
                    }
                    Some(Discovered {
                        kind: r["kind"].as_str()?.into(),
                        spec: Spec {
                            key: String::new(),
                            title: r["kind"].as_str()?.into(),
                            group: if parts.len() == 2 {
                                parts[0].into()
                            } else {
                                String::new()
                            },
                            version: parts.last()?.to_string(),
                            plural: plural.into(),
                            namespaced: r["namespaced"].as_bool()?,
                        },
                        verbs: r["verbs"]
                            .as_array()?
                            .iter()
                            .filter_map(|v| v.as_str().map(str::to_owned))
                            .collect(),
                    })
                })
                .collect::<Vec<_>>();
            // Cache the full served version separately from preferred-version navigation.
            self.discovery
                .lock()
                .unwrap()
                .insert(api.into(), resources.clone());
            resources
        };
        let found = resources.iter().find(|r| r.kind == kind).ok_or(
            "Resource kind/version is not available · refresh discovery or install its CRD first",
        )?;
        if !found.verbs.iter().any(|v| v == verb) {
            return Err("This API does not support the requested operation".into());
        }
        let spec = found.spec.clone();
        self.policy.register(spec.collection(None));
        Ok(spec)
    }
    async fn read_optional(&self, path: &str) -> Result<Option<Value>, String> {
        match tokio::time::timeout(
            Duration::from_secs(10),
            self.client.request::<Value>(get(path)),
        )
        .await
        {
            Ok(Ok(value)) => Ok(Some(value)),
            Ok(Err(kube::Error::Api(e))) if e.code == 404 => Ok(None),
            Ok(Err(e)) => Err(error(e)),
            Err(_) => Err("Resource read timed out".into()),
        }
    }
}
impl Backend {
    pub fn mutation_revision(&self, id: &str) -> u64 {
        self.data_updates
            .lock()
            .unwrap()
            .mutations
            .get(id)
            .copied()
            .unwrap_or(0)
    }
    fn mutation_changed(&self, id: &str) {
        *self
            .data_updates
            .lock()
            .unwrap()
            .mutations
            .entry(id.into())
            .or_default() += 1;
    }
    pub fn prepare_yaml(
        &self,
        id: &str,
        source: String,
        namespace: Option<String>,
    ) -> Job<Prepared> {
        let session = self.session(id);
        let id = id.to_string();
        self.job(async move {
            let session = session?;
            let mut operations = Vec::new();
            let mut identities = std::collections::HashSet::new();
            for mut desired in manifests(&source)? {
                let api = required(&desired, "/apiVersion")?.to_string();
                let kind = required(&desired, "/kind")?.to_string();
                segment(required(&desired, "/metadata/name")?)?;
                let spec = session.discover(&api, &kind, "patch").await?;
                if spec.namespaced {
                    let ns = desired["metadata"]["namespace"]
                        .as_str()
                        .or(namespace.as_deref())
                        .unwrap_or(session.client.default_namespace());
                    let ns = segment(ns)?.to_string();
                    desired["metadata"]["namespace"] = json!(ns);
                } else if desired["metadata"].get("namespace").is_some() {
                    return Err("Cluster-scoped resources must omit metadata.namespace".into());
                }
                let path = spec.item(&desired);
                if !identities.insert(path.clone()) {
                    return Err("Duplicate resource target in YAML".into());
                }
                let before = session.read_optional(&path).await?;
                if let Some(before) = &before {
                    identity_version(before, before)?;
                }
                if before.is_none() {
                    session.discover(&api, &kind, "create").await?;
                }
                let mut desired = editable(&desired);
                // Secret.stringData is write-only; normalize it so GET-only verification is possible.
                if kind == "Secret"
                    && let Some(strings) =
                        desired.as_object_mut().and_then(|o| o.remove("stringData"))
                {
                    use base64::Engine;
                    let strings = strings
                        .as_object()
                        .ok_or("Secret stringData must be a string map")?;
                    if desired.get("data").is_none() {
                        desired["data"] = json!({});
                    }
                    let data = desired["data"]
                        .as_object_mut()
                        .ok_or("Secret data must be a string map")?;
                    for (key, value) in strings {
                        let value = value
                            .as_str()
                            .ok_or("Secret stringData must contain strings")?;
                        data.insert(
                            key.clone(),
                            json!(base64::engine::general_purpose::STANDARD.encode(value)),
                        );
                    }
                }
                operations.push(Operation {
                    target: label(&kind, &desired),
                    path,
                    before,
                    desired,
                    change: Change::Apply,
                    warning: String::new(),
                });
            }
            Ok(Prepared {
                connection: id,
                session,
                operations,
                stop_on_error: true,
            })
        })
    }
    pub fn prepare_update(
        &self,
        id: &str,
        key: &str,
        baseline: Value,
        source: String,
    ) -> Job<Prepared> {
        let session = self.session(id);
        let spec = self.spec(id, key);
        let id = id.to_string();
        self.job(async move {
            let session = session?;
            let mut docs = manifests(&source)?;
            if docs.len() != 1 { return Err("Edit YAML accepts exactly one resource".into()); }
            let mut desired = docs.remove(0);
            if !same_identity(&baseline, &desired) { return Err("Resource identity is locked · apiVersion, kind, name and namespace cannot change".into()); }
            // Server-owned fields are not editable, including UID and resourceVersion.
            if editable(&desired) != desired { return Err("Remove status and server-owned metadata; identity/version are supplied by Lightship".into()); }
            segment(required(&baseline, "/metadata/name")?)?;
            if spec.namespaced { segment(required(&baseline, "/metadata/namespace")?)?; }
            let path = spec.item(&baseline);
            let current = session.read_optional(&path).await?.ok_or("Resource no longer exists · draft retained")?;
            identity_version(&baseline, &current)?;
            let api = required(&baseline, "/apiVersion")?;
            let kind = required(&baseline, "/kind")?;
            session.discover(api, kind, "update").await?;
            desired["metadata"]["uid"] = baseline["metadata"]["uid"].clone();
            desired["metadata"]["resourceVersion"] = baseline["metadata"]["resourceVersion"].clone();
            Ok(Prepared { connection: id, session, operations: vec![Operation { target: label(kind, &desired), path, before: Some(baseline), desired, change: Change::Replace, warning: String::new() }], stop_on_error: true })
        })
    }
    pub fn prepare_restart(&self, id: &str, key: &str, objects: Vec<Value>) -> Job<Prepared> {
        let session = self.session(id);
        let spec = self.spec(id, key);
        let id = id.to_string();
        let key = key.to_string();
        self.job(async move {
            if !matches!(key.as_str(), "deployments" | "statefulsets" | "daemonsets" | "pods") { return Err("Restart is unavailable for this resource type".into()); }
            let session = session?;
            let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
            let mut operations = Vec::new();
            for object in objects {
                segment(required(&object, "/metadata/name")?)?;
                segment(required(&object, "/metadata/namespace")?)?;
                let path = spec.item(&object);
                let read = session.read_optional(&path).await;
                let mut warning = String::new();
                let mut desired = Value::Null;
                let change = match read {
                    Ok(Some(current)) => match identity_version(&object, &current).and_then(|_| restart_supported(&key, &current)) {
                        Err(e) => Change::Skip(e),
                        Ok(()) if key == "pods" => {
                            let controller = current["metadata"]["ownerReferences"].as_array().and_then(|o| o.iter().find(|o| o["controller"] == true));
                            if controller.is_none() { warning = "No controller · this Pod will be deleted and may never be recreated.".into(); }
                            if controller.is_some_and(|o| o["kind"] == "Job") { warning = "Job Pod · deletion may rerun work or may not create a replacement.".into(); }
                            Change::DeletePod
                        }
                        Ok(()) => {
                            desired = json!(timestamp);
                            Change::Restart
                        }
                    },
                    Ok(None) => Change::Skip("Resource no longer exists".into()),
                    Err(e) => Change::Skip(e),
                };
                operations.push(Operation { target: label(&key, &object), path, before: Some(object), desired, change, warning });
            }
            if operations.is_empty() { return Err("Select at least one resource".into()); }
            Ok(Prepared { connection: id, session, operations, stop_on_error: false })
        })
    }
    pub fn execute_mutation(self: &Arc<Self>, plan: Prepared) -> Job<BatchReport> {
        let backend = self.clone();
        self.job(async move {
            let mut items = Vec::new();
            let mut unknown = Vec::new();
            let mut stop = false;
            for op in &plan.operations {
                let (outcome, message) = if stop || !plan.session.policy.active() {
                    (
                        Outcome::Skipped,
                        "Skipped · previous operation failed or connection changed".into(),
                    )
                } else if let Change::Skip(reason) = &op.change {
                    (Outcome::Skipped, reason.clone())
                } else {
                    let result = send(&plan.session, op).await;
                    backend.mutation_changed(&plan.connection);
                    result
                };
                if outcome == Outcome::Unknown {
                    unknown.push(op.clone());
                }
                if plan.stop_on_error && outcome != Outcome::Succeeded {
                    stop = true;
                }
                items.push(report(op, outcome, message));
            }
            let check = if unknown.is_empty() {
                None
            } else {
                Some(Prepared {
                    operations: unknown,
                    ..plan
                })
            };
            Ok(BatchReport { items, check })
        })
    }
    /// GET-only reconciliation. It never resubmits a mutation, even after reconnect.
    pub fn check_mutation(self: &Arc<Self>, plan: Prepared) -> Job<BatchReport> {
        let backend = self.clone();
        self.job(async move {
            let session = backend.session(&plan.connection)?;
            if !session.policy.active() || !Arc::ptr_eq(&session, &plan.session) {
                return Err("Connection changed · inspect the original target before discarding its unresolved result".into());
            }
            let mut items = Vec::new();
            let mut unknown = Vec::new();
            for op in &plan.operations {
                let (outcome, message) = reconcile(&session, op).await;
                if outcome != Outcome::Unknown { backend.mutation_changed(&plan.connection); }
                if outcome == Outcome::Unknown {
                    unknown.push(op.clone());
                }
                items.push(report(op, outcome, message));
            }
            let check = if unknown.is_empty() {
                None
            } else {
                Some(Prepared {
                    session,
                    operations: unknown,
                    ..plan
                })
            };
            Ok(BatchReport { items, check })
        })
    }
}
fn label(kind: &str, object: &Value) -> String {
    format!(
        "{} / {} / {}",
        kind,
        object["metadata"]["namespace"]
            .as_str()
            .unwrap_or("cluster-scoped"),
        object["metadata"]["name"].as_str().unwrap_or("?")
    )
}
fn identity_version(expected: &Value, current: &Value) -> Result<(), String> {
    for field in ["uid", "resourceVersion"] {
        if expected["metadata"][field]
            .as_str()
            .is_none_or(str::is_empty)
            || expected["metadata"][field] != current["metadata"][field]
        {
            return Err(
                "Resource changed or replaced · refresh before retrying; draft retained".into(),
            );
        }
    }
    Ok(())
}
fn restart_supported(key: &str, object: &Value) -> Result<(), String> {
    if object["metadata"]
        .get("deletionTimestamp")
        .is_some_and(|v| !v.is_null())
    {
        return Err("Resource is already terminating".into());
    }
    if key == "deployments" && object["spec"]["paused"] == true {
        return Err("Deployment is paused · resume it explicitly before restart".into());
    }
    if matches!(key, "statefulsets" | "daemonsets")
        && object["spec"]["updateStrategy"]["type"] == "OnDelete"
    {
        return Err("OnDelete strategy requires explicit Pod replacement".into());
    }
    if key == "pods"
        && (object["metadata"]["annotations"]
            .get("kubernetes.io/config.mirror")
            .is_some()
            || object["metadata"]["annotations"]["kubernetes.io/config.source"]
                .as_str()
                .is_some_and(|s| s != "api"))
    {
        return Err("Static/mirror Pods cannot be restarted here".into());
    }
    Ok(())
}
fn report(op: &Operation, outcome: Outcome, message: String) -> ItemReport {
    ItemReport {
        target: op.target.clone(),
        uid: op
            .before
            .as_ref()
            .and_then(|v| v["metadata"]["uid"].as_str().map(str::to_owned)),
        outcome,
        message,
    }
}
fn request(session: &Session, op: &Operation) -> Result<http::Request<Vec<u8>>, String> {
    let before = op.before.as_ref().unwrap_or(&Value::Null);
    let (method, uri, content_type, body) = match op.change {
        Change::Apply => {
            let mut desired = op.desired.clone();
            if let Some(before) = &op.before {
                // Tie the reviewed update to its UID/version, including a change during confirmation.
                desired["metadata"]["uid"] = before["metadata"]["uid"].clone();
                desired["metadata"]["resourceVersion"] =
                    before["metadata"]["resourceVersion"].clone();
            }
            (
                Method::PATCH,
                format!("{}?fieldManager=lightship&fieldValidation=Strict", op.path),
                "application/apply-patch+yaml",
                desired,
            )
        }
        Change::Replace => (
            Method::PUT,
            op.path.clone(),
            "application/json",
            op.desired.clone(),
        ),
        Change::DeletePod => (
            Method::DELETE,
            op.path.clone(),
            "application/json",
            json!({"apiVersion":"v1","kind":"DeleteOptions","preconditions":{"uid":before["metadata"]["uid"],"resourceVersion":before["metadata"]["resourceVersion"]}}),
        ),
        Change::Restart => {
            let mut patch = vec![
                json!({"op":"test","path":"/metadata/uid","value":before["metadata"]["uid"]}),
                json!({"op":"test","path":"/metadata/resourceVersion","value":before["metadata"]["resourceVersion"]}),
            ];
            if before.pointer("/spec/template/metadata").is_none() {
                patch.push(
                    json!({"op":"add","path":"/spec/template/metadata","value":{"annotations":{}}}),
                );
            } else if !before
                .pointer("/spec/template/metadata/annotations")
                .is_some_and(Value::is_object)
            {
                patch.push(
                    json!({"op":"add","path":"/spec/template/metadata/annotations","value":{}}),
                );
            }
            patch.push(json!({"op":"add","path":"/spec/template/metadata/annotations/kubectl.kubernetes.io~1restartedAt","value":op.desired}));
            (
                Method::PATCH,
                op.path.clone(),
                "application/json-patch+json",
                json!(patch),
            )
        }
        Change::Skip(_) => return Err("Skipped target cannot be written".into()),
    };
    session.policy.seal(
        method,
        &uri,
        content_type,
        serde_json::to_vec(&body).map_err(|_| "Could not encode mutation")?,
    )
}
async fn send(session: &Session, op: &Operation) -> (Outcome, String) {
    let request = match request(session, op) {
        Ok(r) => r,
        Err(e) => return (Outcome::Failed, e),
    };
    let result = tokio::time::timeout(
        Duration::from_secs(20),
        session.client.request::<Value>(request),
    )
    .await;
    match result {
        Ok(Ok(_)) => (Outcome::Succeeded, if matches!(op.change, Change::Restart | Change::DeletePod) { "Restart requested" } else { "Applied" }.into()),
        Ok(Err(kube::Error::Api(e))) if matches!(e.code, 400 | 401 | 403 | 404 | 405 | 409 | 413 | 415 | 422 | 429) => (Outcome::Failed, match e.code {
            401 => "Credentials expired · reconnect before retrying",
            403 => "Forbidden · RBAC does not allow this operation",
            409 => "Conflict · resource changed or fields have another owner; draft retained",
            404 => "Resource or API no longer exists",
            429 => "Request throttled · review before retrying",
            _ => "Kubernetes rejected the request · check manifest, schema, immutable fields and version",
        }.into()),
        _ => reconcile(session, op).await,
    }
}
async fn reconcile(session: &Session, op: &Operation) -> (Outcome, String) {
    let current = match session.read_optional(&op.path).await {
        Ok(v) => v,
        Err(_) => {
            return (
                Outcome::Unknown,
                "Result unknown · Check result before retrying".into(),
            );
        }
    };
    let before = op.before.as_ref();
    if matches!(op.change, Change::DeletePod)
        && (current.is_none()
            || current.as_ref().is_some_and(|v| {
                before.is_some_and(|b| v["metadata"]["uid"] != b["metadata"]["uid"])
            }))
    {
        return (
            Outcome::Succeeded,
            "Original Pod removed · replacement readiness not verified".into(),
        );
    }
    if let Some(current) = &current {
        if before.is_some_and(|b| b["metadata"]["uid"] != current["metadata"]["uid"]) {
            return (
                Outcome::Failed,
                "Resource replaced · original request will not be retried".into(),
            );
        }
        let applied = match op.change {
            // A subset check cannot prove that omitted, previously owned fields were removed.
            Change::Apply if before.is_some() => editable(current) == editable(&op.desired),
            Change::Apply => contains(&editable(current), &editable(&op.desired)),
            Change::Replace => editable(current) == editable(&op.desired),
            Change::Restart => {
                current.pointer(
                    "/spec/template/metadata/annotations/kubectl.kubernetes.io~1restartedAt",
                ) == Some(&op.desired)
            }
            _ => false,
        };
        if applied {
            return (
                Outcome::Succeeded,
                "Desired state verified by read-back".into(),
            );
        }
        if before.is_some_and(|b| {
            b["metadata"]["resourceVersion"] == current["metadata"]["resourceVersion"]
        }) {
            return (
                Outcome::Failed,
                "Verified unchanged · review again to retry".into(),
            );
        }
    } else if before.is_none() {
        return (
            Outcome::Failed,
            "Verified absent · review again to retry".into(),
        );
    }
    (
        Outcome::Unknown,
        "Result unknown · resource changed; inspect it before retrying".into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::tests::{await_result, mock_backend};
    use futures::FutureExt;
    use std::sync::atomic::{AtomicUsize, Ordering};
    fn object(key: &str, name: &str) -> Value {
        let (kind, api) = match key {
            "pods" => ("Pod", "v1"),
            "deployments" => ("Deployment", "apps/v1"),
            "statefulsets" => ("StatefulSet", "apps/v1"),
            "daemonsets" => ("DaemonSet", "apps/v1"),
            _ => ("ConfigMap", "v1"),
        };
        json!({"apiVersion":api,"kind":kind,"metadata":{"name":name,"namespace":"apps","uid":format!("uid-{name}"),"resourceVersion":"10"},"spec":{"template":{"metadata":{"labels":{"app":"api"},"annotations":{"keep":"yes"}}}},"data":{"key":"old"}})
    }
    fn discovery(path: &str) -> Option<Value> {
        let resources = match path {
            "/api/v1" => vec![
                ("ConfigMap", "configmaps", true),
                ("Secret", "secrets", true),
                ("Namespace", "namespaces", false),
                ("Pod", "pods", true),
            ],
            "/apis/apps/v1" => vec![
                ("Deployment", "deployments", true),
                ("StatefulSet", "statefulsets", true),
                ("DaemonSet", "daemonsets", true),
            ],
            "/apis/example.io/v2" => vec![("Widget", "widgets", true)],
            _ => return None,
        };
        Some(
            json!({"resources":resources.iter().map(|(kind,name,ns)| json!({"kind":kind,"name":name,"namespaced":ns,"verbs":["get","list","patch","create","update","delete"]})).collect::<Vec<_>>()}),
        )
    }
    fn body(request: &http::Request<kube::client::Body>) -> Value {
        let bytes = request
            .body()
            .try_clone()
            .unwrap()
            .collect_bytes()
            .now_or_never()
            .unwrap()
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }
    fn failure(code: u16) -> (u16, String) {
        (code,json!({"kind":"Status","apiVersion":"v1","status":"Failure","code":code,"message":"private-server-value"}).to_string())
    }
    #[test]
    fn apply_resolves_namespaces_versions_secrets_and_stops_on_first_error() {
        let writes = Arc::new(AtomicUsize::new(0));
        let count = writes.clone();
        let backend = mock_backend(move |r| {
            if let Some(d) = discovery(r.uri().path()) {
                return (200, d.to_string());
            }
            if r.method() == Method::GET {
                return failure(404);
            }
            assert_eq!(r.method(), Method::PATCH);
            assert_eq!(r.headers()["Content-Type"], "application/apply-patch+yaml");
            assert_eq!(
                r.uri().query(),
                Some("fieldManager=lightship&fieldValidation=Strict")
            );
            let desired = body(r);
            let n = count.fetch_add(1, Ordering::SeqCst);
            if n == 0 {
                assert_eq!(r.uri().path(), "/api/v1/namespaces/filter/secrets/new");
                assert_eq!(desired["data"]["password"], "cHJpdmF0ZQ==");
                assert!(desired.get("stringData").is_none());
                (200, desired.to_string())
            } else {
                failure(409)
            }
        });
        let source = "apiVersion: v1\nkind: Secret\nmetadata: {name: new}\nstringData: {password: private}\n---\napiVersion: example.io/v2\nkind: Widget\nmetadata: {name: w, namespace: explicit}\n---\napiVersion: v1\nkind: ConfigMap\nmetadata: {name: skipped}\n";
        let plan =
            await_result(&mut backend.prepare_yaml("test", source.into(), Some("filter".into())))
                .unwrap();
        assert_eq!(
            plan.operations[1].path,
            "/apis/example.io/v2/namespaces/explicit/widgets/w"
        );
        assert!(!plan.review("Test").contains("private"));
        assert_eq!(writes.load(Ordering::SeqCst), 0);
        let report = await_result(&mut backend.execute_mutation(plan)).unwrap();
        assert_eq!(writes.load(Ordering::SeqCst), 2);
        assert_eq!(
            report.items.iter().map(|r| r.outcome).collect::<Vec<_>>(),
            [Outcome::Succeeded, Outcome::Failed, Outcome::Skipped]
        );
        assert!(!report.text().contains("private"));
        assert_eq!(backend.mutation_revision("test"), 2);
    }
    #[test]
    fn manifest_validation_never_writes_and_defaults_to_connection_namespace() {
        let backend = mock_backend(|r| {
            assert_eq!(r.method(), Method::GET);
            if let Some(d) = discovery(r.uri().path()) {
                (200, d.to_string())
            } else {
                failure(404)
            }
        });
        for source in [
            "secret: [invalid",
            "[]",
            "",
            "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: '../pods'}",
            "apiVersion: v1\nkind: ConfigMap\nmetadata: {generateName: foo}",
            "apiVersion: v1\nkind: Namespace\nmetadata: {name: apps, namespace: apps}",
            "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: x}\n---\napiVersion: v1\nkind: ConfigMap\nmetadata: {name: x}",
        ] {
            assert!(await_result(&mut backend.prepare_yaml("test", source.into(), None)).is_err());
        }
        let plan = await_result(&mut backend.prepare_yaml(
            "test",
            "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: x}".into(),
            None,
        ))
        .unwrap();
        assert_eq!(
            plan.operations[0].path,
            "/api/v1/namespaces/default/configmaps/x"
        );
        let plan = await_result(&mut backend.prepare_yaml("test","apiVersion: v1\nkind: List\nitems:\n- apiVersion: v1\n  kind: Namespace\n  metadata: {name: apps}".into(),None)).unwrap();
        assert_eq!(plan.operations[0].path, "/api/v1/namespaces/apps");
    }
    #[test]
    fn replacing_yaml_is_conditional_and_identity_locked() {
        let original = object("configmaps", "config");
        let saved = original.clone();
        let writes = Arc::new(AtomicUsize::new(0));
        let count = writes.clone();
        let backend = mock_backend(move |r| {
            if let Some(d) = discovery(r.uri().path()) {
                return (200, d.to_string());
            }
            if r.method() == Method::GET {
                return (200, saved.to_string());
            }
            assert_eq!(r.method(), Method::PUT);
            let desired = body(r);
            assert_eq!(desired["metadata"]["uid"], "uid-config");
            assert_eq!(desired["metadata"]["resourceVersion"], "10");
            assert_eq!(desired["data"]["key"], "new");
            assert!(desired.get("status").is_none());
            assert!(desired["metadata"].get("managedFields").is_none());
            count.fetch_add(1, Ordering::SeqCst);
            (200, desired.to_string())
        });
        let mut desired = editable(&original);
        desired["data"]["key"] = json!("new");
        let plan = await_result(&mut backend.prepare_update(
            "test",
            "configmaps",
            original.clone(),
            desired.to_string(),
        ))
        .unwrap();
        assert!(
            await_result(&mut backend.execute_mutation(plan))
                .unwrap()
                .succeeded()
        );
        desired["metadata"]["name"] = json!("other");
        assert!(
            await_result(&mut backend.prepare_update(
                "test",
                "configmaps",
                original.clone(),
                desired.to_string()
            ))
            .is_err()
        );
        let mut stale = original.clone();
        stale["metadata"]["resourceVersion"] = json!("9");
        assert!(
            await_result(&mut backend.prepare_update(
                "test",
                "configmaps",
                stale,
                editable(&original).to_string()
            ))
            .is_err()
        );
        assert_eq!(writes.load(Ordering::SeqCst), 1);
    }
    #[test]
    fn workload_restart_and_pod_deletion_are_narrow_conditional_requests() {
        for key in ["deployments", "statefulsets", "daemonsets", "pods"] {
            let original = object(key, "api");
            let saved = original.clone();
            let backend = mock_backend(move |r| {
                if r.method() == Method::GET {
                    return (200, saved.to_string());
                }
                let payload = body(r);
                if key == "pods" {
                    assert_eq!(r.method(), Method::DELETE);
                    assert_eq!(
                        payload["preconditions"],
                        json!({"uid":"uid-api","resourceVersion":"10"})
                    );
                    assert!(payload.get("gracePeriodSeconds").is_none());
                } else {
                    assert_eq!(r.method(), Method::PATCH);
                    assert_eq!(
                        payload[0],
                        json!({"op":"test","path":"/metadata/uid","value":"uid-api"})
                    );
                    assert_eq!(payload[1]["path"], "/metadata/resourceVersion");
                    assert_eq!(payload.as_array().unwrap().len(), 3);
                    assert_eq!(
                        payload[2]["path"],
                        "/spec/template/metadata/annotations/kubectl.kubernetes.io~1restartedAt"
                    );
                }
                (200, saved.to_string())
            });
            let plan =
                await_result(&mut backend.prepare_restart("test", key, vec![original])).unwrap();
            if key == "pods" {
                assert!(plan.review("Test").contains("No controller"));
            }
            let report = await_result(&mut backend.execute_mutation(plan)).unwrap();
            assert_eq!(report.items[0].message, "Restart requested");
        }
    }
    #[test]
    fn restart_handles_missing_annotations_and_partial_failures_without_retry() {
        let mut original = object("deployments", "a");
        original["spec"]["template"]["metadata"]
            .as_object_mut()
            .unwrap()
            .remove("annotations");
        let second = object("deployments", "b");
        let saved = original.clone();
        let other = second.clone();
        let writes = Arc::new(AtomicUsize::new(0));
        let count = writes.clone();
        let backend = mock_backend(move |r| {
            if r.method() == Method::GET {
                return (
                    200,
                    if r.uri().path().ends_with("/a") {
                        saved.to_string()
                    } else {
                        other.to_string()
                    },
                );
            }
            count.fetch_add(1, Ordering::SeqCst);
            if r.uri().path().ends_with("/a") {
                assert_eq!(
                    body(r)[2],
                    json!({"op":"add","path":"/spec/template/metadata/annotations","value":{}})
                );
                failure(403)
            } else {
                (200, other.to_string())
            }
        });
        let plan = await_result(&mut backend.prepare_restart(
            "test",
            "deployments",
            vec![original, second],
        ))
        .unwrap();
        let report = await_result(&mut backend.execute_mutation(plan)).unwrap();
        assert_eq!(
            report.items.iter().map(|r| r.outcome).collect::<Vec<_>>(),
            [Outcome::Failed, Outcome::Succeeded]
        );
        assert_eq!(writes.load(Ordering::SeqCst), 2);
        assert!(!report.text().contains("private-server-value"));
    }
    #[test]
    fn unsupported_or_replaced_restart_targets_never_write() {
        for scenario in [
            "paused",
            "on-delete",
            "mirror",
            "static",
            "uid",
            "version",
            "terminating",
        ] {
            let key = match scenario {
                "on-delete" => "statefulsets",
                "mirror" | "static" => "pods",
                _ => "deployments",
            };
            let original = object(key, "api");
            let mut current = original.clone();
            match scenario {
                "paused" => current["spec"]["paused"] = json!(true),
                "on-delete" => current["spec"]["updateStrategy"] = json!({"type":"OnDelete"}),
                "mirror" => {
                    current["metadata"]["annotations"] = json!({"kubernetes.io/config.mirror":"id"})
                }
                "static" => {
                    current["metadata"]["annotations"] =
                        json!({"kubernetes.io/config.source":"file"})
                }
                "uid" => current["metadata"]["uid"] = json!("replacement"),
                "version" => current["metadata"]["resourceVersion"] = json!("11"),
                _ => current["metadata"]["deletionTimestamp"] = json!("2026-11-08T00:00:00Z"),
            }
            let backend = mock_backend(move |r| {
                assert_eq!(r.method(), Method::GET);
                (200, current.to_string())
            });
            let plan =
                await_result(&mut backend.prepare_restart("test", key, vec![original])).unwrap();
            assert_eq!(
                await_result(&mut backend.execute_mutation(plan))
                    .unwrap()
                    .items[0]
                    .outcome,
                Outcome::Skipped
            );
        }
    }
    #[test]
    fn exact_permits_reject_tampering_foreign_sessions_unsealed_writes_and_revocation() {
        let backend = mock_backend(|r| {
            assert_eq!(r.method(), Method::GET);
            (200, object("deployments", "api").to_string())
        });
        let plan = await_result(&mut backend.prepare_restart(
            "test",
            "deployments",
            vec![object("deployments", "api")],
        ))
        .unwrap();
        let op = &plan.operations[0];
        let policy = &plan.session.policy;
        for variant in [
            "method", "path", "query", "type", "body", "foreign", "unsealed", "valid",
        ] {
            let mut r = request(&plan.session, op).unwrap();
            match variant {
                "method" => *r.method_mut() = Method::DELETE,
                "path" => {
                    *r.uri_mut() = "/apis/apps/v1/namespaces/apps/deployments/other"
                        .parse()
                        .unwrap()
                }
                "query" => *r.uri_mut() = format!("{}?force=true", op.path).parse().unwrap(),
                "type" => {
                    r.headers_mut()
                        .insert("Content-Type", "application/json".parse().unwrap());
                }
                "body" => *r.body_mut() = b"[]".to_vec(),
                "unsealed" => r.extensions_mut().clear(),
                _ => (),
            }
            let guard = if variant == "foreign" {
                policy::Policy::default()
            } else {
                policy.clone()
            };
            assert_eq!(
                guard.check(r.map(kube::client::Body::from)).is_ok(),
                variant == "valid",
                "{variant}"
            );
        }
        let sealed = request(&plan.session, op).unwrap();
        backend.disconnect("test");
        assert!(policy.check(sealed.map(kube::client::Body::from)).is_err());
        let report = await_result(&mut backend.execute_mutation(plan)).unwrap();
        assert_eq!(report.items[0].outcome, Outcome::Skipped);
    }
    #[test]
    fn uncertain_results_are_verified_with_get_only_and_never_resubmitted() {
        for applied in [true, false] {
            let original = object("deployments", "api");
            let saved = original.clone();
            let state = Arc::new(Mutex::new(None::<Value>));
            let seen = state.clone();
            let writes = Arc::new(AtomicUsize::new(0));
            let count = writes.clone();
            let backend = mock_backend(move |r| {
                if r.method() == Method::PATCH {
                    count.fetch_add(1, Ordering::SeqCst);
                    let patch = body(r);
                    *seen.lock().unwrap() = Some(patch[2]["value"].clone());
                    return failure(503);
                }
                let mut current = saved.clone();
                if let Some(timestamp) = seen.lock().unwrap().clone() {
                    if applied {
                        current["spec"]["template"]["metadata"]["annotations"]["kubectl.kubernetes.io/restartedAt"] =
                            timestamp;
                        current["metadata"]["resourceVersion"] = json!("11");
                    } else {
                        return failure(503);
                    }
                }
                (200, current.to_string())
            });
            let plan =
                await_result(&mut backend.prepare_restart("test", "deployments", vec![original]))
                    .unwrap();
            let report = await_result(&mut backend.execute_mutation(plan)).unwrap();
            assert_eq!(
                report.items[0].outcome,
                if applied {
                    Outcome::Succeeded
                } else {
                    Outcome::Unknown
                }
            );
            if let Some(check) = report.check {
                let report = await_result(&mut backend.check_mutation(check)).unwrap();
                assert_eq!(report.items[0].outcome, Outcome::Unknown);
            }
            assert_eq!(writes.load(Ordering::SeqCst), 1);
        }
    }
}
