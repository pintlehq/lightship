//! Read-only Kubernetes service. Raw clients and URLs never leave this module.
pub mod config;
mod details;
mod policy;
pub mod presentation;
use config::Connection;
use futures::{AsyncBufReadExt, AsyncReadExt, StreamExt};
use http::Request;
use kube::{Client, client::ClientBuilder};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::watch;

#[derive(Clone, Debug)]
pub struct Spec {
    pub key: String,
    pub title: String,
    pub group: String,
    pub version: String,
    pub plural: String,
    pub namespaced: bool,
}
impl Spec {
    fn collection(&self, namespace: Option<&str>) -> String {
        let base = if self.group.is_empty() {
            format!("/api/{}", self.version)
        } else {
            format!("/apis/{}/{}", self.group, self.version)
        };
        if let Some(ns) = namespace.filter(|_| self.namespaced) {
            format!("{base}/namespaces/{ns}/{}", self.plural)
        } else {
            format!("{base}/{}", self.plural)
        }
    }
    fn item(&self, object: &Value) -> String {
        format!(
            "{}/{}",
            self.collection(object["metadata"]["namespace"].as_str()),
            object["metadata"]["name"].as_str().unwrap_or_default()
        )
    }
}
pub fn builtin(key: &str) -> Spec {
    let (group, version, plural) = match key {
        "deployments" | "statefulsets" | "daemonsets" | "replicasets" => ("apps", "v1", key),
        "jobs" | "cronjobs" => ("batch", "v1", key),
        "ingresses" | "networkpolicies" => ("networking.k8s.io", "v1", key),
        "storageclasses" => ("storage.k8s.io", "v1", key),
        "roles" | "rolebindings" | "clusterroles" | "clusterrolebindings" => {
            ("rbac.authorization.k8s.io", "v1", key)
        }
        "definitions" => ("apiextensions.k8s.io", "v1", "customresourcedefinitions"),
        "pvcs" => ("", "v1", "persistentvolumeclaims"),
        "pvs" => ("", "v1", "persistentvolumes"),
        _ => ("", "v1", key),
    };
    let resource = crate::catalog::RESOURCES.iter().find(|r| r.key == key);
    Spec {
        key: key.into(),
        title: resource.map_or(key, |r| r.title).into(),
        group: group.into(),
        version: version.into(),
        plural: plural.into(),
        namespaced: resource.is_none_or(|r| r.namespaced),
    }
}
#[derive(Clone, Default)]
pub struct Snapshot {
    pub objects: Vec<Value>,
    pub status: String,
}
#[derive(Clone)]
pub struct Detail {
    pub object: Value,
    pub events: Value,
}
#[derive(Clone, Default)]
pub struct LogOptions {
    pub container: String,
    pub previous: bool,
    pub timestamps: bool,
    pub follow: bool,
}
pub struct Job<T: Clone> {
    receiver: watch::Receiver<Option<Result<T, String>>>,
    task: tokio::task::JoinHandle<()>,
    closed: bool,
}
impl<T: Clone> Job<T> {
    pub fn finished(&self) -> bool {
        self.closed
    }
    pub fn take(&mut self) -> Option<Result<T, String>> {
        if self.closed {
            return None;
        }
        match self.receiver.has_changed() {
            Ok(false) => None,
            state => {
                self.closed = state.is_err();
                self.receiver.borrow_and_update().clone()
            }
        }
    }
}
impl<T: Clone> Drop for Job<T> {
    fn drop(&mut self) {
        self.task.abort();
    }
}
pub struct Backend {
    runtime: tokio::runtime::Handle,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}
struct Session {
    client: Client,
    specs: Vec<Spec>,
    policy: policy::Policy,
    cancelled: watch::Sender<bool>,
    health: Mutex<String>,
}
impl Backend {
    pub fn new() -> Arc<Self> {
        static RUNTIME: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
        Arc::new(Self {
            runtime: RUNTIME
                .get_or_init(|| {
                    tokio::runtime::Builder::new_multi_thread()
                        .worker_threads(2)
                        .enable_all()
                        .build()
                        .expect("Kubernetes runtime")
                })
                .handle()
                .clone(),
            sessions: Mutex::new(HashMap::new()),
        })
    }
    fn job<T: Clone + Send + Sync + 'static>(
        &self,
        future: impl std::future::Future<Output = Result<T, String>> + Send + 'static,
    ) -> Job<T> {
        let (sender, receiver) = watch::channel(None);
        let task = self.runtime.spawn(async move {
            let _ = sender.send(Some(future.await));
        });
        Job {
            receiver,
            task,
            closed: false,
        }
    }
    pub fn connect(self: &Arc<Self>, connection: Connection) -> Job<Vec<Spec>> {
        self.disconnect(&connection.id);
        let backend = self.clone();
        self.job(async move {
            let config = connection.config().await?;
            let policy = policy::Policy::default();
            for resource in crate::catalog::RESOURCES {
                if !matches!(resource.key, "overview" | "helm") {
                    policy.register(builtin(resource.key).collection(None));
                }
            }
            policy.register(builtin("replicasets").collection(None));
            for kind in ["pods", "nodes"] {
                policy.register(format!("/apis/metrics.k8s.io/v1beta1/{kind}"));
            }
            let guard = policy.clone();
            let client = ClientBuilder::try_from(config)
                .map_err(|_| "Could not initialize verified TLS client")?
                .with_layer(&tower::filter::FilterLayer::new(move |req| {
                    guard.check(req)
                }))
                .build();
            client.apiserver_version().await.map_err(error)?;
            let mut specs = Vec::new();
            // Discover groups independently: an unavailable aggregated API must not hide core resources.
            if let Ok(groups) = client.list_api_groups().await {
                for group in groups.groups {
                    let Some(version) = group.preferred_version else {
                        continue;
                    };
                    if let Ok(resources) = client
                        .list_api_group_resources(&version.group_version)
                        .await
                    {
                        for r in resources.resources {
                            if r.name.contains('/') || !r.verbs.iter().any(|v| v == "list") {
                                continue;
                            }
                            let spec = Spec {
                                key: format!(
                                    "custom:{}:{}:{}",
                                    group.name, version.version, r.name
                                ),
                                title: r.kind,
                                group: group.name.clone(),
                                version: version.version.clone(),
                                plural: r.name,
                                namespaced: r.namespaced,
                            };
                            policy.register(spec.collection(None));
                            if !crate::catalog::RESOURCES.iter().any(|r| {
                                let b = builtin(r.key);
                                b.group == spec.group && b.plural == spec.plural
                            }) && spec.group != "metrics.k8s.io"
                            {
                                specs.push(spec);
                            }
                        }
                    }
                }
            }
            specs.sort_by(|a, b| a.title.cmp(&b.title));
            backend.sessions.lock().unwrap().insert(
                connection.id,
                Arc::new(Session {
                    client,
                    specs: specs.clone(),
                    policy,
                    cancelled: watch::channel(false).0,
                    health: Mutex::new("Connected · Read-only".into()),
                }),
            );
            Ok(specs)
        })
    }
    pub fn disconnect(&self, id: &str) {
        if let Some(session) = self.sessions.lock().unwrap().remove(id) {
            session.policy.revoke();
            let _ = session.cancelled.send(true);
        }
    }
    pub fn connection_status(&self, id: &str) -> Option<String> {
        self.session(id)
            .ok()
            .map(|s| s.health.lock().unwrap().clone())
    }
    fn session(&self, id: &str) -> Result<Arc<Session>, String> {
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| "Disconnected · connect this cluster from Manage clusters".into())
    }
    pub fn spec(&self, id: &str, key: &str) -> Spec {
        self.session(id)
            .ok()
            .and_then(|s| s.specs.iter().find(|s| s.key == key).cloned())
            .unwrap_or_else(|| builtin(key))
    }
    pub fn resources(self: &Arc<Self>, id: String, key: String) -> Job<Snapshot> {
        let backend = self.clone();
        let (sender, receiver) = watch::channel(None);
        let task = self.runtime.spawn(async move {
            let mut delay = 1u64;
            loop {
                let result = async {
                    let session = backend.session(&id)?;
                    let mut cancellation=session.cancelled.subscribe();
                    let spec = backend.spec(&id, &key);
                    if key == "overview" { let objects = session.overview().await; let _ = sender.send(Some(Ok(Snapshot { objects, status: "Read-only · refreshed every 30s".into() }))); tokio::time::sleep(Duration::from_secs(30)).await; return Ok(()); }
                    if key == "helm" { let objects = session.helm().await?; let _ = sender.send(Some(Ok(Snapshot { objects, status: "Read-only · refreshed every 30s".into() }))); tokio::time::sleep(Duration::from_secs(30)).await; return Ok(()); }
                    let (mut objects, version) = session.list(&spec, None).await?;
                    let _ = sender.send(Some(Ok(Snapshot { objects: objects.clone(), status: "Read-only · watching".into() })));
                    let url = format!("{}?watch=true&allowWatchBookmarks=true&timeoutSeconds=60&resourceVersion={}", spec.collection(None), encode(&version));
                    let stream = match session.client.request_stream(get(&url)).await {
                        Ok(stream) => stream,
                        Err(kube::Error::Api(e)) if e.code == 403 || e.code == 405 => { let _ = sender.send(Some(Ok(Snapshot { objects, status: "Watch unavailable · refreshed every 30s".into() }))); tokio::time::sleep(Duration::from_secs(30)).await; return Ok(()); },
                        Err(e) => return Err(error(e)),
                    };
                    let mut lines = stream.lines();
                    while let Some(line) = tokio::select! { biased; _=cancellation.changed()=>return Err("Disconnected · connection changed".into()), line=lines.next()=>line } {
                        let event: Value = serde_json::from_str(&line.map_err(|_| "Disconnected · watch interrupted")?).map_err(|_| "Invalid watch response")?;
                        match event["type"].as_str() {
                            Some("ADDED" | "MODIFIED") => { let object = &event["object"]; let uid = &object["metadata"]["uid"]; if let Some(old) = objects.iter_mut().find(|o| &o["metadata"]["uid"] == uid) { *old = object.clone(); } else { objects.push(object.clone()); } },
                            Some("DELETED") => objects.retain(|o| o["metadata"]["uid"] != event["object"]["metadata"]["uid"]),
                            Some("ERROR") if event["object"]["code"] == 410 => break,
                            Some("ERROR") => return Err("Watch failed · retrying".into()),
                            _ => continue,
                        }
                        let _ = sender.send(Some(Ok(Snapshot { objects: objects.clone(), status: "Read-only · watching".into() })));
                        // A removed/replaced connection must not keep delivering its old session.
                        if backend.session(&id).is_err() { return Err("Disconnected".into()); }
                    }
                    Ok::<(),String>(())
                }.await;
                if let Err(e) = result { let _ = sender.send(Some(Err(e))); tokio::time::sleep(Duration::from_secs(delay)).await; delay = (delay*2).min(30); } else { delay = 1; }
                if sender.is_closed() { break; }
            }
        });
        Job {
            receiver,
            task,
            closed: false,
        }
    }
    pub fn detail(&self, id: &str, key: &str, object: Value) -> Job<Detail> {
        let session = self.session(id);
        let spec = self.spec(id, key);
        self.job(async move { session?.detail_for(&spec, object).await })
    }
    pub fn related_pods(&self, id: &str, key: &str, object: Value) -> Job<Vec<Value>> {
        let session = self.session(id);
        let key = key.to_string();
        self.job(async move { session?.related_pods(&key, &object).await })
    }
    pub fn logs(&self, id: &str, object: Value, options: LogOptions) -> Job<String> {
        let session = self.session(id);
        let (sender, receiver) = watch::channel(None);
        let task = self.runtime.spawn(async move {
            let result = async {
                let session = session?;
                let mut cancellation=session.cancelled.subscribe();
                let current = session.json(&builtin("pods").item(&object)).await?;
                details::same_uid(&object, &current)?;
                let path = format!("{}/log?container={}&previous={}&timestamps={}&follow={}&tailLines=1000", builtin("pods").item(&object), encode(&options.container), options.previous, options.timestamps, options.follow);
                let mut stream = session.client.request_stream(get(&path)).await.map_err(error)?;
                let mut bytes = Vec::new(); let mut chunk = [0u8;8192];
                loop {
                    let count=tokio::select! {biased; _=cancellation.changed()=>return Err("Disconnected · logs stopped".into()), read=stream.read(&mut chunk)=>read.map_err(|_| "Log stream interrupted")?};
                    if count==0 { break; }
                    bytes.extend_from_slice(&chunk[..count]);
                    if bytes.len()>512*1024 {bytes.drain(..bytes.len()-512*1024);}
                    let _=sender.send(Some(Ok(String::from_utf8_lossy(&bytes).into_owned())));
                }
                if bytes.is_empty() { let _ = sender.send(Some(Ok("No log lines available".into()))); }
                Ok::<(),String>(())
            }.await;
            if let Err(e) = result { let _ = sender.send(Some(Err(e))); }
        });
        Job {
            receiver,
            task,
            closed: false,
        }
    }
}
#[cfg(test)]
fn trim_log(buffer: &mut String) {
    const LIMIT: usize = 512 * 1024;
    if buffer.len() > LIMIT {
        let mut start = buffer.len() - LIMIT;
        while !buffer.is_char_boundary(start) {
            start += 1;
        }
        buffer.drain(..start);
    }
}
fn get(path: &str) -> Request<Vec<u8>> {
    Request::get(path)
        .body(Vec::new())
        .expect("validated resource URL")
}
fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
fn error(error: kube::Error) -> String {
    match error {
        kube::Error::Api(e) => match e.code {
            401 => "Credentials expired or unauthorized · sign in and reconnect".into(),
            403 => "Forbidden · this identity cannot read this resource".into(),
            404 => "API or resource unavailable".into(),
            410 => "Resource version expired · refreshing".into(),
            code => format!("Kubernetes returned HTTP {code}"),
        },
        _ => "Disconnected · check network, TLS certificate and credential plugin login".into(),
    }
}
impl Session {
    async fn json(&self, path: &str) -> Result<Value, String> {
        let result = self.client.request(get(path)).await;
        *self.health.lock().unwrap() = match &result {
            Ok(_) => "Connected · Read-only".into(),
            Err(kube::Error::Api(e)) if e.code != 401 => "Connected · Read-only".into(),
            Err(_) => "Disconnected · check credentials or network".into(),
        };
        result.map_err(error)
    }
    async fn list(
        &self,
        spec: &Spec,
        labels: Option<&str>,
    ) -> Result<(Vec<Value>, String), String> {
        self.list_scoped(spec, None, labels, None).await
    }
    async fn list_scoped(
        &self,
        spec: &Spec,
        namespace: Option<&str>,
        labels: Option<&str>,
        fields: Option<&str>,
    ) -> Result<(Vec<Value>, String), String> {
        let mut objects = Vec::new();
        let mut continuation = String::new();
        let mut seen = std::collections::HashSet::new();
        loop {
            let url = format!(
                "{}?limit=500&continue={}&labelSelector={}&fieldSelector={}",
                spec.collection(namespace),
                encode(&continuation),
                encode(labels.unwrap_or_default()),
                encode(fields.unwrap_or_default())
            );
            let response = self.json(&url).await?;
            if !self.policy.active() {
                return Err("Disconnected · connection changed".into());
            }
            objects.extend(
                response["items"]
                    .as_array()
                    .ok_or("Invalid resource list")?
                    .iter()
                    .cloned()
                    .map(|mut object| {
                        if spec.key == "secrets" {
                            object["kind"] = json!("Secret");
                        }
                        object
                    }),
            );
            continuation = response["metadata"]["continue"]
                .as_str()
                .unwrap_or_default()
                .into();
            if continuation.is_empty() {
                return Ok((
                    objects,
                    response["metadata"]["resourceVersion"]
                        .as_str()
                        .unwrap_or_default()
                        .into(),
                ));
            }
            if !seen.insert(continuation.clone()) {
                return Err("Invalid repeated pagination token".into());
            }
        }
    }
    async fn overview(&self) -> Vec<Value> {
        let mut rows = Vec::new();
        for resource in crate::catalog::RESOURCES
            .iter()
            .filter(|r| !matches!(r.key, "overview" | "helm"))
        {
            let row = match self.list(&builtin(resource.key), None).await {
                Ok((objects, _)) => {
                    let healthy = objects.iter().filter(|o| presentation::healthy(o)).count();
                    json!({"name":resource.title,"count":objects.len(),"healthy":healthy,"attention":objects.len()-healthy})
                }
                Err(e) => json!({"name":resource.title,"error":e}),
            };
            rows.push(row);
        }
        for kind in ["nodes", "pods"] {
            rows.push(
                match self
                    .json(&format!("/apis/metrics.k8s.io/v1beta1/{kind}"))
                    .await
                {
                    Ok(value) => json!({"name":format!("{kind} metrics"),"metrics":value}),
                    Err(e) => json!({"name":format!("{kind} metrics"),"error":e}),
                },
            );
        }
        rows
    }
    async fn helm(&self) -> Result<Vec<Value>, String> {
        let mut releases = Vec::new();
        let mut errors = Vec::new();
        let mut successful = false;
        for kind in ["secrets", "configmaps"] {
            match self.list(&builtin(kind), Some("owner=helm")).await {
                Ok((records, _)) => {
                    successful = true;
                    for record in records {
                        match presentation::decode_release(&record, kind == "secrets") {
                            Ok(mut value) => {
                                value["metadata"] = record["metadata"].clone();
                                value["kind"] = json!("HelmRelease");
                                releases.push(value);
                            }
                            Err(_) => return Err("Invalid or oversized Helm release data".into()),
                        }
                    }
                }
                Err(e) => errors.push(e),
            }
        }
        if !successful {
            return Err(errors.join("; "));
        }
        // Never silently describe a partial backend result as a complete list.
        if !errors.is_empty() {
            return Err(format!(
                "Helm storage partially unavailable: {}",
                errors.join("; ")
            ));
        }
        Ok(releases)
    }
}
#[cfg(test)]
pub(crate) mod tests;
