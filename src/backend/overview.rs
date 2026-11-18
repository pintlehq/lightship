//! Cluster dashboard snapshots and one bounded, in-memory sampler per connection.
use super::*;
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::sync::{
    Weak,
    atomic::{AtomicBool, Ordering},
};
use tokio::sync::Notify;

pub const PERIOD: i64 = 30;
pub const WINDOW: i64 = 1800;
pub const FRESHNESS: i64 = 90;
pub type Part<T> = Result<T, String>;
#[derive(Clone, Debug)]
pub struct Nodes {
    pub total: usize,
    pub ready: usize,
}
#[derive(Clone, Debug)]
pub struct Pods {
    pub active: usize,
    pub pending: usize,
}
#[derive(Clone, Debug)]
pub struct Allocation {
    pub used: f64,
    pub total: f64,
}
impl Allocation {
    pub fn percent(&self) -> f64 {
        self.used / self.total * 100.
    }
}
#[derive(Clone, Debug)]
pub struct Usage {
    pub allocation: Allocation,
    pub timestamp: DateTime<Utc>,
    fingerprint: String,
}
impl Usage {
    pub fn fresh(&self, now: DateTime<Utc>) -> bool {
        let age = (now - self.timestamp).num_seconds();
        (-15..=FRESHNESS).contains(&age)
    }
}
#[derive(Clone, Debug)]
pub struct OverviewSnapshot {
    pub collected_at: DateTime<Utc>,
    pub nodes: Part<Nodes>,
    pub pods: Part<Pods>,
    pub namespaces: Part<usize>,
    pub pod_capacity: Part<f64>,
    pub cpu: Part<Usage>,
    pub memory: Part<Usage>,
    pub cpu_requests: Part<Allocation>,
    pub memory_requests: Part<Allocation>,
    pub events: Part<Vec<Value>>,
}
impl OverviewSnapshot {
    fn unavailable(error: String, now: DateTime<Utc>) -> Self {
        Self {
            collected_at: now,
            nodes: Err(error.clone()),
            pods: Err(error.clone()),
            namespaces: Err(error.clone()),
            pod_capacity: Err(error.clone()),
            cpu: Err(error.clone()),
            memory: Err(error.clone()),
            cpu_requests: Err(error.clone()),
            memory_requests: Err(error.clone()),
            events: Err(error),
        }
    }
    pub fn partial(&self, now: DateTime<Utc>) -> bool {
        self.nodes.is_err()
            || self.pods.is_err()
            || self.namespaces.is_err()
            || self.pod_capacity.is_err()
            || self.cpu.as_ref().map_or(true, |u| !u.fresh(now))
            || self.memory.as_ref().map_or(true, |u| !u.fresh(now))
            || self.cpu_requests.is_err()
            || self.memory_requests.is_err()
            || self.events.is_err()
    }
}
#[derive(Clone, Debug)]
pub struct Point {
    pub at: DateTime<Utc>,
    pub value: Option<Usage>,
}
#[derive(Clone, Default, Debug)]
pub struct OverviewState {
    pub snapshot: Option<OverviewSnapshot>,
    pub cpu_history: Vec<Point>,
    pub memory_history: Vec<Point>,
}
#[derive(Default)]
struct Series {
    points: BTreeMap<i64, Point>,
    last: Option<String>,
}
impl Series {
    fn prune(&mut self, now: DateTime<Utc>) {
        self.points
            .retain(|_, point| (now - point.at).num_seconds() <= WINDOW);
        while self.points.len() > 61 {
            self.points.pop_first();
        }
    }
    fn insert(&mut self, now: DateTime<Utc>, value: &Part<Usage>) {
        let bucket = now.timestamp().div_euclid(PERIOD);
        let valid = value
            .as_ref()
            .ok()
            .filter(|u| u.fresh(now))
            .filter(|u| self.last.as_ref() != Some(&u.fingerprint))
            .cloned();
        if let Some(value) = &valid {
            self.last = Some(value.fingerprint.clone());
        }
        // A failed manual refresh must not erase a real measurement in this bucket.
        if valid.is_some() || !self.points.contains_key(&bucket) {
            self.points.insert(
                bucket,
                Point {
                    at: now,
                    value: valid,
                },
            );
        }
        self.prune(now);
    }
    fn values(&self) -> Vec<Point> {
        self.points.values().cloned().collect()
    }
}
#[derive(Default)]
struct Cache {
    cpu: Series,
    memory: Series,
    state: OverviewState,
}
impl Cache {
    fn insert(&mut self, snapshot: OverviewSnapshot) {
        self.cpu.insert(snapshot.collected_at, &snapshot.cpu);
        self.memory.insert(snapshot.collected_at, &snapshot.memory);
        self.state = OverviewState {
            snapshot: Some(snapshot),
            cpu_history: self.cpu.values(),
            memory_history: self.memory.values(),
        };
    }
    fn prune(&mut self, now: DateTime<Utc>) {
        self.cpu.prune(now);
        self.memory.prune(now);
        self.state.cpu_history = self.cpu.values();
        self.state.memory_history = self.memory.values();
    }
}
#[derive(Default)]
struct Control {
    users: usize,
    task: Option<tokio::task::JoinHandle<()>>,
}
pub(super) struct OverviewHub {
    cache: Mutex<Cache>,
    control: Mutex<Control>,
    sender: watch::Sender<OverviewState>,
    refresh: Notify,
    invalidated: AtomicBool,
}
impl OverviewHub {
    fn new() -> Self {
        Self {
            cache: Mutex::new(Cache::default()),
            control: Mutex::new(Control::default()),
            sender: watch::channel(OverviewState::default()).0,
            refresh: Notify::new(),
            invalidated: AtomicBool::new(false),
        }
    }
    fn acquire(
        self: &Arc<Self>,
        backend: Weak<Backend>,
        id: String,
        runtime: &tokio::runtime::Handle,
    ) -> OverviewLease {
        let mut control = self.control.lock().unwrap();
        control.users += 1;
        {
            let mut cache = self.cache.lock().unwrap();
            cache.prune(Utc::now());
            self.sender.send_replace(cache.state.clone());
        }
        if control.task.is_none() {
            let hub = self.clone();
            control.task = Some(runtime.spawn(async move {
                let mut timer = tokio::time::interval(Duration::from_secs(PERIOD as u64));
                timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    tokio::select! {_=timer.tick()=>{},_=hub.refresh.notified()=>{}}
                    let session = backend
                        .upgrade()
                        .ok_or_else(|| "Disconnected".to_string())
                        .and_then(|backend| backend.session(&id));
                    let snapshot = match session {
                        Ok(session) => session.dashboard().await,
                        Err(error) => OverviewSnapshot::unavailable(error, Utc::now()),
                    };
                    let mut cache = hub.cache.lock().unwrap();
                    if hub.invalidated.load(Ordering::Acquire) {
                        break;
                    }
                    cache.insert(snapshot);
                    hub.sender.send_replace(cache.state.clone());
                }
            }));
        }
        OverviewLease {
            hub: self.clone(),
            receiver: self.sender.subscribe(),
            initial: true,
        }
    }
    pub(super) fn invalidate(&self) {
        self.invalidated.store(true, Ordering::Release);
        if let Some(task) = self.control.lock().unwrap().task.take() {
            task.abort();
        }
        let mut cache = self.cache.lock().unwrap();
        *cache = Cache::default();
        self.sender.send_replace(OverviewState::default());
    }
    pub(super) fn refresh(&self) {
        self.refresh.notify_one();
    }
}
pub struct OverviewLease {
    hub: Arc<OverviewHub>,
    receiver: watch::Receiver<OverviewState>,
    initial: bool,
}
impl OverviewLease {
    pub fn take(&mut self) -> Option<OverviewState> {
        if self.initial || self.receiver.has_changed().unwrap_or(false) {
            self.initial = false;
            Some(self.receiver.borrow_and_update().clone())
        } else {
            None
        }
    }
    pub fn refresh(&self) {
        self.hub.refresh();
    }
    pub fn invalidated(&self) -> bool {
        self.hub.invalidated.load(Ordering::Acquire)
    }
}
impl Drop for OverviewLease {
    fn drop(&mut self) {
        let mut control = self.hub.control.lock().unwrap();
        control.users -= 1;
        if control.users == 0
            && let Some(task) = control.task.take()
        {
            task.abort();
        }
    }
}
pub type PodUsage =
    std::collections::HashMap<String, std::collections::HashMap<String, (u64, u64)>>;
impl Backend {
    pub fn pod_usage(&self, id: &str) -> super::Job<PodUsage> {
        let session = self.session(id);
        self.job(async move {
            let spec = Spec {
                group: "metrics.k8s.io".into(),
                version: "v1beta1".into(),
                ..builtin("pods")
            };
            let metrics = session?.dashboard_list(&spec).await?;
            let mut result = PodUsage::new();
            for pod in metrics {
                let (Some(namespace), Some(name), Some(containers)) = (
                    pod["metadata"]["namespace"].as_str(),
                    pod["metadata"]["name"].as_str(),
                    pod["containers"].as_array(),
                ) else {
                    continue;
                };
                if containers.is_empty() {
                    continue;
                }
                let usage = containers.iter().try_fold((0., 0.), |(cpu, mem), c| {
                    Ok::<_, String>((
                        cpu + quantity(&c["usage"]["cpu"])?,
                        mem + quantity(&c["usage"]["memory"])?,
                    ))
                });
                if let Ok((cpu, mem)) = usage {
                    result.entry(namespace.into()).or_default().insert(
                        name.into(),
                        (
                            (cpu * 1000.).round() as u64,
                            (mem / 1048576.).round() as u64,
                        ),
                    );
                }
            }
            Ok(result)
        })
    }
    pub fn overview(self: &Arc<Self>, id: &str) -> OverviewLease {
        let hub = self
            .overviews
            .lock()
            .unwrap()
            .entry(id.into())
            .or_insert_with(|| Arc::new(OverviewHub::new()))
            .clone();
        hub.acquire(Arc::downgrade(self), id.to_string(), &self.runtime)
    }
}
impl Session {
    pub(super) async fn dashboard(&self) -> OverviewSnapshot {
        let nodes_spec = builtin("nodes");
        let pods_spec = builtin("pods");
        let namespaces_spec = builtin("namespaces");
        let events_spec = builtin("events");
        let (nodes, pods, namespaces, events, metrics) = tokio::join!(
            self.dashboard_list(&nodes_spec),
            self.dashboard_list(&pods_spec),
            self.dashboard_list(&namespaces_spec),
            self.dashboard_list(&events_spec),
            self.metric_nodes(),
        );
        aggregate(nodes, pods, namespaces, events, metrics, Utc::now())
    }
    async fn dashboard_list(&self, spec: &Spec) -> Part<Vec<Value>> {
        timed_part(async { self.list(spec, None).await.map(|(items, _)| items) }).await
    }
    async fn metric_nodes(&self) -> Part<Vec<Value>> {
        let spec = Spec {
            key: "node-metrics".into(),
            title: "Node Metrics".into(),
            group: "metrics.k8s.io".into(),
            version: "v1beta1".into(),
            plural: "nodes".into(),
            namespaced: false,
        };
        self.dashboard_list(&spec).await.map_err(|e| {
            if e == "API or resource unavailable" {
                "Metrics API unavailable".into()
            } else {
                e
            }
        })
    }
}

async fn timed_part<T>(future: impl std::future::Future<Output = Part<T>>) -> Part<T> {
    tokio::time::timeout(Duration::from_secs(25), future)
        .await
        .map_err(|_| "Overview endpoint timed out".to_string())?
}

/// Kubernetes quantity suffixes, including decimal exponents. No missing/invalid value becomes zero.
pub fn quantity(value: &Value) -> Part<f64> {
    let text = value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_number().map(ToString::to_string))
        .ok_or("Missing resource quantity")?;
    let suffixes = [
        ("Ei", 2f64.powi(60)),
        ("Pi", 2f64.powi(50)),
        ("Ti", 2f64.powi(40)),
        ("Gi", 2f64.powi(30)),
        ("Mi", 2f64.powi(20)),
        ("Ki", 1024.),
        ("n", 1e-9),
        ("u", 1e-6),
        ("m", 1e-3),
        ("k", 1e3),
        ("K", 1e3),
        ("M", 1e6),
        ("G", 1e9),
        ("T", 1e12),
        ("P", 1e15),
        ("E", 1e18),
    ];
    let (number, multiplier) = suffixes
        .iter()
        .find_map(|(suffix, multiplier)| text.strip_suffix(suffix).map(|s| (s, *multiplier)))
        .unwrap_or((&text, 1.));
    let value = number
        .parse::<f64>()
        .map_err(|_| "Invalid resource quantity")?
        * multiplier;
    if !value.is_finite() || value < 0. {
        return Err("Invalid resource quantity".into());
    }
    Ok(value)
}
fn optional_quantity(value: &Value, key: &str) -> Part<f64> {
    value.get(key).map(quantity).unwrap_or(Ok(0.))
}
fn container_request(
    pod: &Value,
    container: &Value,
    statuses: &str,
    resource: &str,
    use_status: bool,
) -> Part<f64> {
    let spec = optional_quantity(&container["resources"]["requests"], resource)?;
    if !use_status {
        return Ok(spec);
    }
    let status = pod["status"][statuses]
        .as_array()
        .into_iter()
        .flatten()
        .find(|s| s["name"] == container["name"]);
    let Some(status) = status.filter(|s| !s["resources"].is_null()) else {
        return Ok(spec);
    };
    let current = optional_quantity(&status["resources"]["requests"], resource)?;
    let allocated = optional_quantity(&status["allocatedResources"], resource)?;
    let infeasible = pod["status"]["conditions"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|c| c["type"] == "PodResizePending" && c["reason"] == "Infeasible");
    Ok(if infeasible {
        current.max(allocated)
    } else {
        spec.max(current).max(allocated)
    })
}
/// Mirrors Kubernetes v1.34 PodRequests with status resources and Pod overhead:
/// <https://github.com/kubernetes/kubernetes/blob/v1.34.0/staging/src/k8s.io/component-helpers/resource/helpers.go>
pub fn pod_requests(pod: &Value, resource: &str) -> Part<f64> {
    let mut running = 0.;
    for container in pod["spec"]["containers"].as_array().into_iter().flatten() {
        running += container_request(pod, container, "containerStatuses", resource, true)?;
    }
    let mut sidecars = 0.;
    let mut init_max = 0f64;
    for container in pod["spec"]["initContainers"]
        .as_array()
        .into_iter()
        .flatten()
    {
        let restartable = container["restartPolicy"] == "Always";
        let request = container_request(
            pod,
            container,
            "initContainerStatuses",
            resource,
            restartable,
        )?;
        let effective = if restartable {
            running += request;
            sidecars += request;
            sidecars
        } else {
            sidecars + request
        };
        init_max = init_max.max(effective);
    }
    let mut request = running.max(init_max);
    if let Some(pod_level) = pod["spec"]["resources"]["requests"].get(resource) {
        request = quantity(pod_level)?;
    }
    request += optional_quantity(&pod["spec"]["overhead"], resource)?;
    if request.is_finite() {
        Ok(request)
    } else {
        Err("Resource requests overflow".into())
    }
}
fn active(pod: &Value) -> bool {
    !matches!(
        pod["status"]["phase"].as_str(),
        Some("Succeeded" | "Failed")
    )
}
fn capacity(nodes: &Part<Vec<Value>>, resource: &str) -> Part<f64> {
    let nodes = nodes.as_ref().map_err(Clone::clone)?;
    let mut total = 0.;
    for node in nodes {
        let value = quantity(&node["status"]["allocatable"][resource])
            .map_err(|_| format!("Node allocatable {resource} is missing or invalid"))?;
        if resource == "pods" && value.fract() != 0. {
            return Err("Invalid Pod capacity".into());
        }
        total += value;
    }
    if total <= 0. || !total.is_finite() {
        return Err(format!("No positive allocatable {resource} capacity"));
    }
    Ok(total)
}
fn requests(
    nodes: &Part<Vec<Value>>,
    pods: &Part<Vec<Value>>,
    resource: &str,
    total: Part<f64>,
) -> Part<Allocation> {
    let total = total?;
    let nodes = nodes.as_ref().map_err(Clone::clone)?;
    let pods = pods.as_ref().map_err(Clone::clone)?;
    let names: HashSet<_> = nodes
        .iter()
        .filter_map(|n| n["metadata"]["name"].as_str())
        .collect();
    let mut used = 0.;
    for pod in pods.iter().filter(|pod| {
        active(pod)
            && pod["spec"]["nodeName"]
                .as_str()
                .is_some_and(|n| names.contains(n))
    }) {
        used += pod_requests(pod, resource)?;
    }
    if used.is_finite() && (used / total * 100.).is_finite() {
        Ok(Allocation { used, total })
    } else {
        Err("Resource requests overflow".into())
    }
}
fn usage(
    nodes: &Part<Vec<Value>>,
    metrics: &Part<Vec<Value>>,
    resource: &str,
    total: Part<f64>,
    now: DateTime<Utc>,
) -> Part<Usage> {
    let total = total?;
    let nodes = nodes.as_ref().map_err(Clone::clone)?;
    let metrics = metrics.as_ref().map_err(Clone::clone)?;
    let mut used = 0.;
    let mut times = Vec::new();
    let mut fingerprints = Vec::new();
    let mut covered = 0;
    for node in nodes {
        let name = node["metadata"]["name"]
            .as_str()
            .ok_or("Node has no name")?;
        let matching: Vec<_> = metrics
            .iter()
            .filter(|m| m["metadata"]["name"] == name)
            .collect();
        if matching.len() != 1 {
            continue;
        }
        let metric = matching[0];
        let timestamp = metric["timestamp"]
            .as_str()
            .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
            .map(|t| t.with_timezone(&Utc))
            .ok_or("Metrics timestamp missing or invalid")?;
        let age = (now - timestamp).num_seconds();
        if !(-15..=FRESHNESS).contains(&age) {
            return Err("Node metrics are stale or have a future timestamp".into());
        }
        if node["metadata"]["creationTimestamp"]
            .as_str()
            .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
            .is_some_and(|created| timestamp < created)
        {
            return Err("Node metrics predate the current Node".into());
        }
        used += quantity(&metric["usage"][resource])
            .map_err(|_| format!("Invalid {resource} metrics"))?;
        times.push(timestamp);
        covered += 1;
        fingerprints.push(format!("{name}:{}:{timestamp}", node["metadata"]["uid"]));
    }
    if covered != nodes.len() {
        return Err(format!("Metrics coverage {covered}/{} nodes", nodes.len()));
    }
    if !used.is_finite() || !(used / total * 100.).is_finite() {
        return Err("Metrics sum overflow".into());
    }
    fingerprints.sort();
    Ok(Usage {
        allocation: Allocation { used, total },
        timestamp: *times.iter().min().ok_or("No metrics samples")?,
        fingerprint: format!("{:x}", Sha256::digest(fingerprints.join("|").as_bytes())),
    })
}
pub fn event_time(event: &Value) -> Option<DateTime<Utc>> {
    event["series"]["lastObservedTime"]
        .as_str()
        .into_iter()
        .chain(
            ["lastTimestamp", "eventTime", "firstTimestamp"]
                .into_iter()
                .filter_map(|key| event[key].as_str()),
        )
        .chain(event["metadata"]["creationTimestamp"].as_str())
        .find_map(|t| {
            DateTime::parse_from_rfc3339(t)
                .ok()
                .map(|t| t.with_timezone(&Utc))
        })
}
fn aggregate(
    nodes: Part<Vec<Value>>,
    pods: Part<Vec<Value>>,
    namespaces: Part<Vec<Value>>,
    events: Part<Vec<Value>>,
    metrics: Part<Vec<Value>>,
    now: DateTime<Utc>,
) -> OverviewSnapshot {
    let cpu_capacity = capacity(&nodes, "cpu");
    let memory_capacity = capacity(&nodes, "memory");
    let cpu = usage(&nodes, &metrics, "cpu", cpu_capacity.clone(), now);
    let memory = usage(&nodes, &metrics, "memory", memory_capacity.clone(), now);
    let cpu_requests = requests(&nodes, &pods, "cpu", cpu_capacity);
    let memory_requests = requests(&nodes, &pods, "memory", memory_capacity);
    let pod_capacity = capacity(&nodes, "pods");
    let nodes = nodes.map(|nodes| Nodes {
        total: nodes.len(),
        ready: nodes
            .iter()
            .filter(|node| {
                node["status"]["conditions"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|c| c["type"] == "Ready" && c["status"] == "True")
            })
            .count(),
    });
    let pods = pods.map(|pods| Pods {
        active: pods.iter().filter(|p| active(p)).count(),
        pending: pods
            .iter()
            .filter(|p| active(p) && p["status"]["phase"] == "Pending")
            .count(),
    });
    let events = events.map(|mut events| {
        events.sort_by_key(|event| std::cmp::Reverse(event_time(event)));
        events.truncate(10);
        events
    });
    OverviewSnapshot {
        collected_at: now,
        nodes,
        pods,
        namespaces: namespaces.map(|n| n.len()),
        pod_capacity,
        cpu,
        memory,
        cpu_requests,
        memory_requests,
        events,
    }
}

#[cfg(test)]
#[path = "overview_tests.rs"]
pub(crate) mod tests;
