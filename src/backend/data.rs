//! Narrow, version-conditional data editing. Never exposes a raw request/client to UI.
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use std::collections::BTreeMap;

pub const MAX_DATA: usize = 1024 * 1024;
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DataKind {
    Secret,
    ConfigMap,
}
impl DataKind {
    pub fn key(self) -> &'static str {
        match self {
            Self::Secret => "secrets",
            Self::ConfigMap => "configmaps",
        }
    }
}
#[derive(Clone, PartialEq, Eq)]
pub struct DataTarget {
    pub kind: DataKind,
    pub namespace: String,
    pub name: String,
    pub uid: String,
    pub version: String,
}
impl DataTarget {
    pub fn from_object(key: &str, object: &Value) -> Result<Self, String> {
        let kind = match key {
            "secrets" => DataKind::Secret,
            "configmaps" => DataKind::ConfigMap,
            _ => return Err("Data editing is only available for Secrets and ConfigMaps".into()),
        };
        let field = |key: &str| {
            object["metadata"][key]
                .as_str()
                .filter(|v| !v.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| format!("Missing resource {key}; refresh details"))
        };
        let result = Self {
            kind,
            namespace: field("namespace")?,
            name: field("name")?,
            uid: field("uid")?,
            version: field("resourceVersion")?,
        };
        if [&result.namespace, &result.name].iter().any(|v| {
            !v.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b))
                || v.starts_with('.')
                || v.ends_with('.')
        }) {
            return Err("Invalid resource identity".into());
        }
        Ok(result)
    }
    pub fn path(&self) -> String {
        format!(
            "/api/v1/namespaces/{}/{}/{}",
            self.namespace,
            self.kind.key(),
            self.name
        )
    }
}
#[derive(Clone, Default, PartialEq, Eq)]
pub struct DataValues {
    pub text: BTreeMap<String, Vec<u8>>,
    pub binary: BTreeMap<String, Vec<u8>>,
}
impl DataValues {
    pub fn read(kind: DataKind, object: &Value) -> Result<Self, String> {
        let mut result = Self::default();
        for (field, binary) in [("data", kind == DataKind::Secret), ("binaryData", true)] {
            if kind == DataKind::Secret && field == "binaryData" {
                continue;
            }
            if object[field].is_null() {
                continue;
            }
            let map = object[field].as_object().ok_or("Invalid data map")?;
            for (name, value) in map {
                let value = value.as_str().ok_or("Invalid data value")?;
                let bytes = if binary {
                    STANDARD
                        .decode(value)
                        .map_err(|_| "Invalid Base64 in resource data")?
                } else {
                    value.as_bytes().to_vec()
                };
                if field == "binaryData" {
                    result.binary.insert(name.clone(), bytes);
                } else {
                    result.text.insert(name.clone(), bytes);
                }
            }
        }
        result.validate(kind)?;
        Ok(result)
    }
    pub fn validate(&self, kind: DataKind) -> Result<(), String> {
        let mut size = 0usize;
        for (key, value) in self.text.iter().chain(self.binary.iter()) {
            if key.is_empty()
                || key.len() > 253
                || !key
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            {
                return Err(
                    "Keys must contain 1–253 ASCII letters, digits, '-', '_' or '.'".into(),
                );
            }
            size =
                size.saturating_add(value.len())
                    .saturating_add(if kind == DataKind::ConfigMap {
                        key.len()
                    } else {
                        0
                    });
        }
        if kind == DataKind::Secret && !self.binary.is_empty() {
            return Err("Secret values must use data".into());
        }
        if self.text.keys().any(|k| self.binary.contains_key(k)) {
            return Err("Duplicate key across text and binary data".into());
        }
        if kind == DataKind::ConfigMap
            && self.text.values().any(|v| std::str::from_utf8(v).is_err())
        {
            return Err("Text values must be valid UTF-8; use Binary for other data".into());
        }
        if size > MAX_DATA {
            return Err("Resource data exceeds the 1 MiB limit".into());
        }
        Ok(())
    }
    pub(super) fn map(&self, kind: DataKind, binary: bool) -> Value {
        Value::Object(
            if binary { &self.binary } else { &self.text }
                .iter()
                .map(|(k, v)| {
                    let value = if binary || kind == DataKind::Secret {
                        STANDARD.encode(v)
                    } else {
                        String::from_utf8(v.clone()).expect("validated UTF-8")
                    };
                    (k.clone(), json!(value))
                })
                .collect(),
        )
    }
}
#[derive(Clone)]
pub struct DataEdit {
    pub target: DataTarget,
    pub values: DataValues,
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ApplyState {
    Applied,
    Unchanged,
    Conflict,
    Replaced,
    Forbidden,
    Invalid,
    Immutable,
    Unknown,
}
#[derive(Clone)]
pub struct ApplyReport {
    pub state: ApplyState,
    pub message: String,
    pub object: Option<Value>,
}
impl ApplyReport {
    fn new(state: ApplyState, message: &str) -> Self {
        Self {
            state,
            message: message.into(),
            object: None,
        }
    }
    fn applied(mut object: Value, kind: DataKind) -> Self {
        object["kind"] = json!(if kind == DataKind::Secret {
            "Secret"
        } else {
            "ConfigMap"
        });
        Self {
            state: ApplyState::Applied,
            message: "Data applied successfully".into(),
            object: Some(object),
        }
    }
}
#[derive(Clone)]
pub struct DataUpdate {
    pub before_version: String,
    pub connection: String,
    pub object: Value,
}
#[derive(Default)]
pub(super) struct DataUpdates {
    revision: u64,
    pub(super) items: std::collections::VecDeque<(u64, DataUpdate)>,
}
impl Backend {
    pub fn overlay_data(&self, id: &str, objects: &mut [Value]) {
        let updates = self.data_updates.lock().unwrap();
        for (_, update) in &updates.items {
            if update.connection != id {
                continue;
            }
            if let Some(object) = objects.iter_mut().find(|o| {
                o["metadata"]["uid"] == update.object["metadata"]["uid"]
                    && o["metadata"]["resourceVersion"] == update.before_version
            }) {
                *object = update.object.clone();
            }
        }
    }
    pub fn data_updates(&self, since: u64) -> (u64, Vec<DataUpdate>) {
        let updates = self.data_updates.lock().unwrap();
        (
            updates.revision,
            updates
                .items
                .iter()
                .filter(|(revision, _)| *revision > since)
                .map(|(_, u)| u.clone())
                .collect(),
        )
    }
    pub fn apply_data(self: &Arc<Self>, id: &str, edit: DataEdit) -> Job<ApplyReport> {
        let session = self.session(id);
        let backend = self.clone();
        let id = id.to_string();
        self.job(async move {
            let session = session?;
            let before_version = edit.target.version.clone();
            let result = session.apply_data(edit).await?;
            if !session.policy.active()
                || !backend
                    .session(&id)
                    .is_ok_and(|current| Arc::ptr_eq(&current, &session))
            {
                return Ok(ApplyReport::new(
                    ApplyState::Unknown,
                    "Connection changed · Apply result must be checked before retrying",
                ));
            }
            backend.publish_data(&id, before_version, &session, &result);
            Ok(result)
        })
    }
    fn publish_data(
        &self,
        id: &str,
        before_version: String,
        session: &Arc<Session>,
        result: &ApplyReport,
    ) {
        if let Some(object) = &result.object
            && session.policy.active()
            && self
                .session(id)
                .is_ok_and(|current| Arc::ptr_eq(&current, session))
        {
            let mut updates = self.data_updates.lock().unwrap();
            updates.revision += 1;
            let revision = updates.revision;
            updates.items.push_back((
                revision,
                DataUpdate {
                    before_version,
                    connection: id.to_string(),
                    object: object.clone(),
                },
            ));
            if updates.items.len() > 100 {
                updates.items.pop_front();
            }
        }
    }
    pub fn reconcile_data(self: &Arc<Self>, id: &str, edit: DataEdit) -> Job<ApplyReport> {
        let session = self.session(id);
        let backend = self.clone();
        let id = id.to_string();
        self.job(async move {
            let session = session?;
            let report = session.reconcile_data(&edit).await?;
            backend.publish_data(&id, edit.target.version, &session, &report);
            Ok(report)
        })
    }
}
impl Session {
    async fn reconcile_data(&self, edit: &DataEdit) -> Result<ApplyReport, String> {
        let read =
            tokio::time::timeout(Duration::from_secs(10), self.json(&edit.target.path())).await;
        let Ok(Ok(object)) = read else {
            return Ok(ApplyReport::new(
                ApplyState::Unknown,
                "Result unknown · could not verify the resource. Check again before retrying.",
            ));
        };
        if object["metadata"]["uid"] != edit.target.uid {
            return Ok(ApplyReport::new(
                ApplyState::Replaced,
                "Resource replaced · reopen the new resource; draft retained",
            ));
        }
        if DataValues::read(edit.target.kind, &object).ok().as_ref() == Some(&edit.values) {
            return Ok(ApplyReport::applied(object, edit.target.kind));
        }
        if object["metadata"]["resourceVersion"] == edit.target.version {
            return Ok(ApplyReport::new(
                ApplyState::Unchanged,
                "Verified unchanged · review and Apply again to retry",
            ));
        }
        Ok(ApplyReport::new(
            ApplyState::Conflict,
            "Resource changed · draft retained. Reset and refresh before applying.",
        ))
    }
    async fn apply_data(&self, edit: DataEdit) -> Result<ApplyReport, String> {
        edit.values.validate(edit.target.kind)?;
        let current = match tokio::time::timeout(
            Duration::from_secs(10),
            self.client.request::<Value>(get(&edit.target.path())),
        )
        .await
        {
            Ok(Ok(value)) => value,
            Ok(Err(kube::Error::Api(e))) if e.code == 401 => {
                return Err("Credentials expired · reconnect before applying".into());
            }
            Ok(Err(kube::Error::Api(e))) if e.code == 404 => {
                return Ok(ApplyReport::new(
                    ApplyState::Replaced,
                    "Resource no longer exists · draft retained",
                ));
            }
            Ok(Err(kube::Error::Api(e))) if e.code == 403 => {
                return Ok(ApplyReport::new(
                    ApplyState::Forbidden,
                    "Forbidden · this identity cannot read the resource",
                ));
            }
            _ => return Err("Could not read the resource before Apply; no patch was sent".into()),
        };
        if current["metadata"]["uid"] != edit.target.uid {
            return Ok(ApplyReport::new(
                ApplyState::Replaced,
                "Resource replaced · draft retained; reopen the resource",
            ));
        }
        if current["metadata"]["resourceVersion"] != edit.target.version {
            return Ok(ApplyReport::new(
                ApplyState::Conflict,
                "Resource changed · draft retained. Reset and refresh before applying.",
            ));
        }
        if current["immutable"] == true {
            return Ok(ApplyReport::new(
                ApplyState::Immutable,
                "Immutable resource · data cannot be changed",
            ));
        }
        let request = self.policy.data_patch(&edit)?;
        let result = tokio::time::timeout(
            Duration::from_secs(20),
            self.client.request::<Value>(request),
        )
        .await;
        match result {
            Ok(Ok(object)) if object["metadata"]["uid"] == edit.target.uid => {
                Ok(ApplyReport::applied(object, edit.target.kind))
            }
            Ok(Err(kube::Error::Api(e))) if e.code == 403 => Ok(ApplyReport::new(
                ApplyState::Forbidden,
                "Forbidden · this identity cannot patch resource data",
            )),
            Ok(Err(kube::Error::Api(e))) if e.code == 401 => {
                Err("Credentials expired · reconnect before applying".into())
            }
            Ok(Err(kube::Error::Api(e))) if e.code == 409 => Ok(ApplyReport::new(
                ApplyState::Conflict,
                "Resource changed · draft retained. Reset and refresh before applying.",
            )),
            Ok(Err(kube::Error::Api(e))) if matches!(e.code, 400 | 404 | 413 | 422) => {
                let report = self.reconcile_data(&edit).await?;
                if report.state == ApplyState::Unchanged {
                    Ok(ApplyReport::new(
                        ApplyState::Invalid,
                        "Kubernetes rejected the data · check keys, encoding, size and Secret type requirements",
                    ))
                } else {
                    Ok(report)
                }
            }
            _ => self.reconcile_data(&edit).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::tests::{await_result, mock_backend};
    use futures::FutureExt;
    use std::sync::atomic::{AtomicUsize, Ordering};
    fn resource() -> Value {
        json!({"apiVersion":"v1","kind":"Secret","metadata":{"name":"credentials","namespace":"apps","uid":"secret-uid","resourceVersion":"10"},"type":"Opaque","data":{"password":STANDARD.encode(b"old"),"binary":STANDARD.encode([0,255,1])}})
    }
    fn edit(object: &Value) -> DataEdit {
        let target = DataTarget::from_object("secrets", object).unwrap();
        let mut values = DataValues::read(target.kind, object).unwrap();
        values
            .text
            .insert("password".into(), b"new-private-value".to_vec());
        DataEdit { target, values }
    }
    #[test]
    fn data_round_trips_binary_and_validates_keys_types_and_size() {
        let original = resource();
        let secret = DataValues::read(DataKind::Secret, &original).unwrap();
        assert_eq!(secret.text["binary"], [0, 255, 1]);
        assert_eq!(secret.map(DataKind::Secret, false), original["data"]);
        let cm = json!({"data":{"config.yaml":"replicas: 3\n"},"binaryData":{"icon":STANDARD.encode([0,255])}});
        let mut values = DataValues::read(DataKind::ConfigMap, &cm).unwrap();
        assert_eq!(values.map(DataKind::ConfigMap, false), cm["data"]);
        assert_eq!(values.map(DataKind::ConfigMap, true), cm["binaryData"]);
        values.binary.insert("config.yaml".into(), vec![]);
        assert!(values.validate(DataKind::ConfigMap).is_err());
        values.binary.clear();
        values.text.insert("bad/key".into(), vec![]);
        assert!(values.validate(DataKind::ConfigMap).is_err());
        values.text.clear();
        values.text.insert("x".into(), vec![0; MAX_DATA + 1]);
        assert!(values.validate(DataKind::Secret).is_err());
    }
    #[test]
    fn only_the_sealed_exact_patch_can_pass_the_http_boundary() {
        let policy = policy::Policy::default();
        let edit = edit(&resource());
        let request = policy.data_patch(&edit).unwrap();
        let payload: Value = serde_json::from_slice(request.body()).unwrap();
        assert_eq!(
            payload[0],
            json!({"op":"test","path":"/metadata/uid","value":"secret-uid"})
        );
        assert_eq!(payload[1]["path"], "/metadata/resourceVersion");
        assert_eq!(payload[2]["path"], "/data");
        assert!(policy.check(request.map(kube::client::Body::from)).is_ok());
        let mut wrong = policy.data_patch(&edit).unwrap();
        *wrong.uri_mut() = "/api/v1/namespaces/other/secrets/credentials"
            .parse()
            .unwrap();
        assert!(policy.check(wrong.map(kube::client::Body::from)).is_err());
        let wrong = policy
            .data_patch(&edit)
            .unwrap()
            .map(|_| kube::client::Body::from(b"[]".to_vec()));
        assert!(policy.check(wrong).is_err());
        let wrong = Request::patch(edit.target.path())
            .header("Content-Type", "application/json-patch+json")
            .body(kube::client::Body::from(b"[]".to_vec()))
            .unwrap();
        assert!(policy.check(wrong).is_err());
        policy.revoke();
        assert!(
            policy
                .check(
                    policy
                        .data_patch(&edit)
                        .unwrap()
                        .map(kube::client::Body::from)
                )
                .is_err()
        );
    }
    #[test]
    fn apply_changes_only_data_and_publishes_a_safe_update() {
        let object = resource();
        let original = object.clone();
        let changes = edit(&object);
        let desired = changes.values.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let backend = mock_backend(move |request| {
            assert_eq!(
                request.uri().path(),
                "/api/v1/namespaces/apps/secrets/credentials"
            );
            if request.method() == http::Method::PATCH {
                seen.fetch_add(1, Ordering::SeqCst);
                let bytes = request
                    .body()
                    .try_clone()
                    .unwrap()
                    .collect_bytes()
                    .now_or_never()
                    .unwrap()
                    .unwrap();
                let patch: Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(patch.as_array().unwrap().len(), 3);
                assert_eq!(patch[2]["path"], "/data");
                assert_eq!(patch[2]["value"]["binary"], original["data"]["binary"]);
                let mut updated = original.clone();
                updated["data"] = patch[2]["value"].clone();
                updated["metadata"]["resourceVersion"] = json!("11");
                (200, updated.to_string())
            } else {
                (200, original.to_string())
            }
        });
        let report = await_result(&mut backend.apply_data("test", changes)).unwrap();
        assert!(report.state == ApplyState::Applied);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(DataValues::read(DataKind::Secret, &report.object.unwrap()).unwrap() == desired);
        assert_eq!(backend.data_updates(0).1.len(), 1);
    }
    #[test]
    fn immutable_replaced_conflict_and_forbidden_never_retry_or_leak_values() {
        for scenario in ["immutable", "uid", "version", "forbidden", "race"] {
            let calls = Arc::new(AtomicUsize::new(0));
            let seen = calls.clone();
            let backend = mock_backend(move |request| {
                let mut current = resource();
                match scenario {
                    "immutable" => current["immutable"] = json!(true),
                    "uid" => current["metadata"]["uid"] = json!("new-uid"),
                    "version" => current["metadata"]["resourceVersion"] = json!("11"),
                    _ => {}
                }
                if request.method() == http::Method::PATCH {
                    seen.fetch_add(1, Ordering::SeqCst);
                    let code = if scenario == "forbidden" { 403 } else { 409 };
                    (code,json!({"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","message":"private-server-value","code":code}).to_string())
                } else {
                    (200, current.to_string())
                }
            });
            let report = await_result(&mut backend.apply_data("test", edit(&resource()))).unwrap();
            assert!(report.state != ApplyState::Applied);
            assert!(!report.message.contains("private"));
            assert_eq!(
                calls.load(Ordering::SeqCst),
                usize::from(matches!(scenario, "forbidden" | "race"))
            );
        }
    }
    #[test]
    fn uncertain_reconciliation_is_get_only_and_does_not_resubmit() {
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let expected = edit(&resource());
        let target = expected.clone();
        let backend = mock_backend(move |request| {
            assert_eq!(request.method(), http::Method::GET);
            seen.fetch_add(1, Ordering::SeqCst);
            let mut value = resource();
            value["data"] = target.values.map(DataKind::Secret, false);
            value["metadata"]["resourceVersion"] = json!("11");
            (200, value.to_string())
        });
        let report = await_result(&mut backend.reconcile_data("test", expected)).unwrap();
        assert!(report.state == ApplyState::Applied);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
    #[tokio::test(start_paused = true)]
    async fn timeout_reads_back_once_and_never_retries_the_patch() {
        use tower::ServiceBuilder;
        for scenario in ["applied", "unchanged", "unreachable"] {
            let calls = Arc::new(AtomicUsize::new(0));
            let seen = calls.clone();
            let desired = edit(&resource());
            let wanted = desired.values.clone();
            let policy = policy::Policy::default();
            policy.register("/api/v1/secrets".into());
            let guard = policy.clone();
            let service = tower::service_fn(move |request: http::Request<kube::client::Body>| {
                let patch = request.method() == http::Method::PATCH;
                if patch {
                    seen.fetch_add(1, Ordering::SeqCst);
                }
                let attempted = seen.load(Ordering::SeqCst) > 0;
                let wanted = wanted.clone();
                async move {
                    if patch {
                        tokio::time::sleep(Duration::from_secs(60)).await;
                    }
                    let mut value = resource();
                    let mut code = 200;
                    if attempted && scenario == "applied" {
                        value["data"] = wanted.map(DataKind::Secret, false);
                        value["metadata"]["resourceVersion"] = json!("11");
                    }
                    if attempted && scenario == "unreachable" {
                        code = 503;
                        value = json!({"kind":"Status","apiVersion":"v1","status":"Failure","reason":"ServiceUnavailable","code":503});
                    }
                    Ok::<_, tower::BoxError>(
                        http::Response::builder()
                            .status(code)
                            .body(kube::client::Body::from(value.to_string().into_bytes()))
                            .unwrap(),
                    )
                }
            });
            let client = ClientBuilder::new(ServiceBuilder::new().service(service), "default")
                .with_layer(&tower::filter::FilterLayer::new(move |r| guard.check(r)))
                .build();
            let backend = Arc::new(Backend {
                runtime: tokio::runtime::Handle::current(),
                sessions: Mutex::default(),
                overviews: Mutex::default(),
                data_updates: Mutex::default(),
            });
            backend.sessions.lock().unwrap().insert(
                "test".into(),
                Arc::new(Session {
                    client,
                    policy,
                    specs: vec![],
                    cancelled: watch::channel(false).0,
                    health: Mutex::default(),
                }),
            );
            let mut job = backend.apply_data("test", desired);
            while calls.load(Ordering::SeqCst) == 0 {
                tokio::task::yield_now().await;
            }
            tokio::time::advance(Duration::from_secs(21)).await;
            let report = loop {
                if let Some(report) = job.take() {
                    break report.unwrap();
                }
                tokio::task::yield_now().await;
            };
            assert_eq!(calls.load(Ordering::SeqCst), 1);
            assert!(
                report.state
                    == match scenario {
                        "applied" => ApplyState::Applied,
                        "unchanged" => ApplyState::Unchanged,
                        _ => ApplyState::Unknown,
                    }
            );
        }
    }
    #[test]
    fn configmap_patch_preserves_metadata_and_binary_values() {
        let current = json!({"kind":"ConfigMap","metadata":{"name":"config","namespace":"apps","uid":"cm","resourceVersion":"1","labels":{"owner":"unchanged"}},"data":{"old.yaml":"replicas: 1\n"},"binaryData":{"bytes":STANDARD.encode([0,255,1])}});
        let target = DataTarget::from_object("configmaps", &current).unwrap();
        let mut values = DataValues::read(DataKind::ConfigMap, &current).unwrap();
        values.text.remove("old.yaml");
        values
            .text
            .insert("config.yaml".into(), b"replicas: 2\n".to_vec());
        let backend = mock_backend(move |request| {
            assert_eq!(
                request.uri().path(),
                "/api/v1/namespaces/apps/configmaps/config"
            );
            let mut object = current.clone();
            if request.method() == http::Method::PATCH {
                let bytes = request
                    .body()
                    .try_clone()
                    .unwrap()
                    .collect_bytes()
                    .now_or_never()
                    .unwrap()
                    .unwrap();
                let patch: Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(patch.as_array().unwrap().len(), 4);
                assert_eq!(patch[2]["path"], "/data");
                assert_eq!(patch[3]["path"], "/binaryData");
                object["data"] = patch[2]["value"].clone();
                object["binaryData"] = patch[3]["value"].clone();
                object["metadata"]["resourceVersion"] = json!("2");
            }
            (200, object.to_string())
        });
        let report =
            await_result(&mut backend.apply_data("test", DataEdit { target, values })).unwrap();
        assert!(report.state == ApplyState::Applied);
        let object = report.object.unwrap();
        assert_eq!(object["metadata"]["labels"]["owner"], "unchanged");
        assert_eq!(object["data"]["config.yaml"], "replicas: 2\n");
        assert!(object["data"].get("old.yaml").is_none());
        assert_eq!(
            DataValues::read(DataKind::ConfigMap, &object)
                .unwrap()
                .binary["bytes"],
            [0, 255, 1]
        );
    }
}
