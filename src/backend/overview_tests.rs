use super::*;
use std::sync::atomic::AtomicUsize;

type FixtureData = (Vec<Value>, Vec<Value>, Vec<Value>, Vec<Value>, Vec<Value>);
fn data(now: DateTime<Utc>) -> FixtureData {
    let nodes=(1..=2).map(|i|json!({"metadata":{"name":format!("node-{i}"),"uid":format!("uid-{i}"),"creationTimestamp":(now-chrono::Duration::days(1)).to_rfc3339()},"status":{"allocatable":{"cpu":"4","memory":"8Gi","pods":"48"},"conditions":[{"type":"Ready","status":"True"}]}})).collect();
    let pod = |name: &str, node: &str, phase: &str, cpu: &str, memory: &str| json!({"metadata":{"name":name,"namespace":"apps","uid":name},"spec":{"nodeName":node,"containers":[{"name":"main","resources":{"requests":{"cpu":cpu,"memory":memory}}}]},"status":{"phase":phase}});
    let pods = vec![
        pod("api", "node-1", "Running", "750m", "192Mi"),
        pod("waiting", "", "Pending", "100", "1Ti"),
        pod("done", "node-1", "Succeeded", "100", "1Ti"),
        pod("scheduled", "node-2", "Pending", "1", "256Mi"),
        pod("unknown-node", "missing", "Running", "100", "1Ti"),
        pod("failed", "node-2", "Failed", "100", "1Ti"),
    ];
    let namespaces = vec![
        json!({"metadata":{"name":"default"}}),
        json!({"metadata":{"name":"apps"}}),
    ];
    let events=(0..20).map(|i|json!({"metadata":{"name":format!("event-{i}"),"namespace":"apps","uid":format!("event-{i}")},"type":"Normal","reason":"Started","message":"Container started","lastTimestamp":(now-chrono::Duration::minutes(i)).to_rfc3339()})).rev().collect();
    let metrics=(1..=2).map(|i|json!({"metadata":{"name":format!("node-{i}")},"timestamp":now.to_rfc3339(),"usage":{"cpu":format!("{}m",i*200),"memory":format!("{i}Gi")}})).collect();
    (nodes, pods, namespaces, events, metrics)
}
pub(crate) fn snapshot(now: DateTime<Utc>) -> OverviewSnapshot {
    let (n, p, ns, e, m) = data(now);
    aggregate(Ok(n), Ok(p), Ok(ns), Ok(e), Ok(m), now)
}
pub(crate) fn state(now: DateTime<Utc>) -> OverviewState {
    let mut cache = Cache::default();
    for i in (0..3).rev() {
        cache.insert(snapshot(now - chrono::Duration::seconds(i * 30)));
    }
    cache.state
}
#[test]
fn quantities_cover_binary_decimal_and_exponents_and_reject_invalid_values() {
    for (text, expected) in [
        ("100n", 1e-7),
        ("200u", 0.0002),
        ("500m", 0.5),
        ("1.5", 1.5),
        ("2Ki", 2048.),
        ("3Mi", 3. * 1048576.),
        ("1Gi", 1073741824.),
        ("1Ti", 2f64.powi(40)),
        ("1Pi", 2f64.powi(50)),
        ("1Ei", 2f64.powi(60)),
        ("1k", 1000.),
        ("1K", 1000.),
        ("2M", 2e6),
        ("2G", 2e9),
        ("2T", 2e12),
        ("2P", 2e15),
        ("2E", 2e18),
        ("2e3", 2000.),
        ("1e-3", 0.001),
    ] {
        let actual = quantity(&json!(text)).unwrap();
        assert!((actual - expected).abs() <= expected.abs() * 1e-10);
    }
    for value in [
        Value::Null,
        json!("bad"),
        json!("NaN"),
        json!("1e999"),
        json!("-1"),
        json!({}),
    ] {
        assert!(quantity(&value).is_err(), "{value}");
    }
}
#[test]
fn overview_uses_real_node_capacity_and_scheduled_active_requests() {
    let now = Utc::now();
    let s = snapshot(now);
    assert_eq!(s.nodes.unwrap().ready, 2);
    let pods = s.pods.unwrap();
    assert_eq!(pods.active, 4);
    assert_eq!(pods.pending, 2);
    assert_eq!(s.pod_capacity.unwrap(), 96.);
    assert_eq!(s.namespaces.unwrap(), 2);
    assert!((s.cpu.unwrap().allocation.percent() - 7.5).abs() < 1e-8);
    assert!((s.memory.unwrap().allocation.percent() - 18.75).abs() < 1e-8);
    assert_eq!(s.cpu_requests.unwrap().used, 1.75);
    assert_eq!(s.memory_requests.unwrap().used, 448. * 1048576.);
    let events = s.events.unwrap();
    assert_eq!(events.len(), 10);
    assert_eq!(events[0]["metadata"]["name"], "event-0");
    assert_eq!(events[9]["metadata"]["name"], "event-9");
}
#[test]
fn effective_requests_include_ordered_sidecars_init_pod_level_and_overhead() {
    let mut pod = json!({"spec":{"containers":[{"name":"app","resources":{"requests":{"cpu":"1"}}}],"initContainers":[{"name":"first-sidecar","restartPolicy":"Always","resources":{"requests":{"cpu":"200m"}}},{"name":"setup","resources":{"requests":{"cpu":"3"}}},{"name":"second-sidecar","restartPolicy":"Always","resources":{"requests":{"cpu":"300m"}}}],"overhead":{"cpu":"100m"}}});
    assert!((pod_requests(&pod, "cpu").unwrap() - 3.3).abs() < 1e-8);
    pod["spec"]["resources"] = json!({"requests":{"cpu":"4"}});
    assert!((pod_requests(&pod, "cpu").unwrap() - 4.1).abs() < 1e-8);
    assert_eq!(pod_requests(&pod, "memory").unwrap(), 0.);
    pod["spec"]["resources"]["requests"]["cpu"] = json!("malformed");
    assert!(pod_requests(&pod, "cpu").is_err());
}
#[test]
fn resize_uses_allocated_status_and_infeasible_rules() {
    let mut pod = json!({"spec":{"containers":[{"name":"main","resources":{"requests":{"cpu":"2"}}}]},"status":{"containerStatuses":[{"name":"main","resources":{"requests":{"cpu":"1"}},"allocatedResources":{"cpu":"1500m"}}]}});
    assert_eq!(pod_requests(&pod, "cpu").unwrap(), 2.);
    pod["status"]["conditions"] = json!([{"type":"PodResizePending","reason":"Infeasible"}]);
    assert_eq!(pod_requests(&pod, "cpu").unwrap(), 1.5);
    pod["status"]["containerStatuses"][0]["allocatedResources"]["cpu"] = json!("bad");
    assert!(pod_requests(&pod, "cpu").is_err());
}
#[test]
fn partial_metrics_missing_capacity_and_empty_clusters_are_not_zero_percent() {
    let now = Utc::now();
    let (n, p, ns, e, mut m) = data(now);
    m.pop();
    let s = aggregate(
        Ok(n.clone()),
        Ok(p.clone()),
        Ok(ns.clone()),
        Ok(e.clone()),
        Ok(m),
        now,
    );
    assert!(s.cpu.unwrap_err().contains("1/2"));
    assert!(s.cpu_requests.is_ok());
    let mut bad = n;
    bad[0]["status"]["allocatable"]["cpu"] = Value::Null;
    let s = aggregate(Ok(bad), Ok(p), Ok(ns), Ok(e), Ok(data(now).4), now);
    assert!(s.cpu.is_err());
    assert!(s.cpu_requests.is_err());
    assert!(s.memory.is_ok());
    let empty = aggregate(
        Ok(vec![]),
        Ok(vec![]),
        Ok(vec![]),
        Ok(vec![]),
        Ok(vec![]),
        now,
    );
    assert_eq!(empty.nodes.unwrap().total, 0);
    assert!(empty.cpu.is_err());
    assert!(empty.pod_capacity.is_err());
    assert!(empty.memory_requests.is_err());
}
#[test]
fn stale_future_and_invalid_timestamps_and_quantities_are_rejected_per_metric() {
    let now = Utc::now();
    for offset in [-91, 16] {
        let (n, p, ns, e, mut m) = data(now);
        m[0]["timestamp"] = json!((now + chrono::Duration::seconds(offset)).to_rfc3339());
        let s = aggregate(Ok(n), Ok(p), Ok(ns), Ok(e), Ok(m), now);
        assert!(s.cpu.is_err());
        assert!(s.memory.is_err());
    }
    let (n, p, ns, e, mut m) = data(now);
    m[0]["usage"]["cpu"] = json!("bad");
    let s = aggregate(Ok(n), Ok(p), Ok(ns), Ok(e), Ok(m), now);
    assert!(s.cpu.is_err());
    assert!(s.memory.is_ok());
    let mut s = snapshot(now);
    s.events = Err("Forbidden".into());
    assert!(s.partial(now));
    assert!(s.cpu.is_ok());
    assert!(s.partial(now + chrono::Duration::seconds(91)));
}
#[test]
fn history_is_bounded_deduplicates_refresh_and_keeps_real_gaps() {
    let now = Utc::now();
    let mut cache = Cache::default();
    for i in 0..400 {
        cache.insert(snapshot(now + chrono::Duration::seconds(i * 30)));
        assert!(cache.state.cpu_history.len() <= 61);
    }
    assert_eq!(cache.state.cpu_history.len(), 61);
    let last = cache.state.snapshot.clone().unwrap();
    let count = cache.state.cpu_history.len();
    cache.insert(last.clone());
    assert_eq!(cache.state.cpu_history.len(), count);
    let later = last.collected_at + chrono::Duration::seconds(30);
    let mut duplicate = last;
    duplicate.collected_at = later;
    cache.insert(duplicate);
    assert!(cache.state.cpu_history.last().unwrap().value.is_none());
    cache.insert(snapshot(later + chrono::Duration::seconds(30)));
    assert!(cache.state.cpu_history.last().unwrap().value.is_some());
    let at = cache.state.cpu_history.last().unwrap().at;
    let mut fail = OverviewSnapshot::unavailable("Disconnected".into(), at);
    fail.collected_at = at;
    cache.insert(fail);
    assert!(cache.state.cpu_history.last().unwrap().value.is_some());
    cache.prune(at + chrono::Duration::seconds(WINDOW + 1));
    assert!(cache.state.cpu_history.is_empty());
}
#[test]
fn dashboard_paginates_only_required_endpoints_and_keeps_metrics_errors_local() {
    let counts = Arc::new(Mutex::new(HashMap::<String, usize>::new()));
    let seen = counts.clone();
    let now = Utc::now();
    let backend = super::super::tests::mock_backend(move |r| {
        assert_eq!(r.method(), http::Method::GET);
        let path = r.uri().path();
        *seen.lock().unwrap().entry(path.into()).or_default() += 1;
        let (n, p, ns, e, m) = data(now);
        let (items, token) = match path {
            "/api/v1/nodes" => (n, None),
            "/api/v1/pods" => {
                if r.uri().query().unwrap().contains("continue=next") {
                    (p[1..].to_vec(), None)
                } else {
                    (p[..1].to_vec(), Some("next"))
                }
            }
            "/api/v1/namespaces" => (ns, None),
            "/api/v1/events" => (e, None),
            "/apis/metrics.k8s.io/v1beta1/nodes" => {
                let _ = m;
                return (404, json!({"kind":"Status","code":404}).to_string());
            }
            other => panic!("Unexpected endpoint {other}"),
        };
        (
            200,
            json!({"metadata":{"continue":token.unwrap_or("")},"items":items}).to_string(),
        )
    });
    let s = backend
        .runtime
        .block_on(backend.session("test").unwrap().dashboard());
    assert_eq!(s.pods.unwrap().active, 4);
    assert!(s.cpu_requests.is_ok());
    assert!(s.cpu.unwrap_err().contains("Metrics API unavailable"));
    assert!(s.events.is_ok());
    let seen = counts.lock().unwrap();
    assert_eq!(seen.len(), 5);
    assert_eq!(seen["/api/v1/pods"], 2);
}
#[test]
fn sampler_shares_polling_stops_on_last_view_and_clears_on_disconnect() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        tokio::time::pause();
        let rounds = Arc::new(AtomicUsize::new(0));
        let counted = rounds.clone();
        let backend =
            super::super::tests::mock_backend_on(tokio::runtime::Handle::current(), move |r| {
                let now = Utc::now();
                let (n, p, ns, e, m) = data(now);
                let items = match r.uri().path() {
                    "/api/v1/nodes" => n,
                    "/api/v1/pods" => p,
                    "/api/v1/namespaces" => ns,
                    "/api/v1/events" => e,
                    "/apis/metrics.k8s.io/v1beta1/nodes" => {
                        counted.fetch_add(1, Ordering::SeqCst);
                        m
                    }
                    other => panic!("{other}"),
                };
                (200, json!({"items":items}).to_string())
            });
        let mut first = backend.overview("test");
        let second = backend.overview("test");
        assert!(Arc::ptr_eq(&first.hub, &second.hub));
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_millis(1)).await;
        for _ in 0..100 {
            tokio::task::yield_now().await;
        }
        assert_eq!(rounds.load(Ordering::SeqCst), 1);
        assert!(first.take().unwrap().snapshot.is_some());
        tokio::time::advance(Duration::from_secs(30)).await;
        for _ in 0..100 {
            tokio::task::yield_now().await;
        }
        assert_eq!(rounds.load(Ordering::SeqCst), 2);
        first.refresh();
        for _ in 0..100 {
            tokio::task::yield_now().await;
        }
        assert_eq!(rounds.load(Ordering::SeqCst), 3);
        drop(first);
        tokio::time::advance(Duration::from_secs(30)).await;
        for _ in 0..100 {
            tokio::task::yield_now().await;
        }
        assert_eq!(rounds.load(Ordering::SeqCst), 4);
        drop(second);
        tokio::time::advance(Duration::from_secs(90)).await;
        for _ in 0..100 {
            tokio::task::yield_now().await;
        }
        assert_eq!(rounds.load(Ordering::SeqCst), 4);
        let mut reopened = backend.overview("test");
        assert!(reopened.take().unwrap().snapshot.is_some());
        backend.disconnect("test");
        assert!(reopened.invalidated());
        assert!(reopened.take().unwrap().cpu_history.is_empty());
        let mut fresh = backend.overview("test");
        assert!(!Arc::ptr_eq(&fresh.hub, &reopened.hub));
        assert!(fresh.take().unwrap().snapshot.is_none());
    });
}

#[test]
fn endpoint_timeout_does_not_discard_successful_parts() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        tokio::time::pause();
        let (slow, fast) = tokio::join!(
            timed_part(std::future::pending::<Part<usize>>()),
            timed_part(async { Ok(42usize) })
        );
        assert!(slow.unwrap_err().contains("timed out"));
        assert_eq!(fast.unwrap(), 42);
    });
}
