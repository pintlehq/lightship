use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use tower::{Layer, ServiceExt};

#[test]
fn policy_blocks_all_writes_and_unsafe_gets_before_transport() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let policy = policy::Policy::default();
        policy.register("/api/v1/pods".into());
        policy.register("/apis/apps/v1/deployments".into());
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = calls.clone();
        let transport = tower::service_fn(move |_: http::Request<kube::client::Body>| {
            counted.fetch_add(1, Ordering::SeqCst);
            async { Ok::<_, tower::BoxError>(()) }
        });
        let guard = policy.clone();
        let service = tower::filter::FilterLayer::new(move |r| guard.check(r)).layer(transport);
        for method in ["POST", "PATCH", "PUT", "DELETE", "CONNECT"] {
            assert!(
                service
                    .clone()
                    .oneshot(
                        Request::builder()
                            .method(method)
                            .uri("/api/v1/pods")
                            .body(kube::client::Body::empty())
                            .unwrap()
                    )
                    .await
                    .is_err()
            );
        }
        for path in [
            "/api/v1/namespaces/default/pods/p/exec",
            "/api/v1/namespaces/default/pods/p/attach",
            "/api/v1/namespaces/default/pods/p/portforward",
            "/api/v1/namespaces/default/pods/p/proxy",
            "/api/v1/nodes/n/proxy",
            "/api/v1/pods/%2e%2e/secrets",
            "/api/v1//pods",
            "https://other.example/api/v1/pods",
            "/api/v1/secrets",
            "/api/v1/pods?command=delete",
        ] {
            assert!(
                service
                    .clone()
                    .oneshot(
                        Request::get(path)
                            .body(kube::client::Body::empty())
                            .unwrap()
                    )
                    .await
                    .is_err(),
                "{path}"
            );
        }
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        for path in [
            "/version",
            "/api/v1",
            "/apis/apps/v1",
            "/api/v1/pods?watch=true",
            "/apis/apps/v1/deployments",
            "/api/v1/namespaces/default/pods/p/log?follow=true",
        ] {
            assert!(
                service
                    .clone()
                    .oneshot(
                        Request::get(path)
                            .body(kube::client::Body::empty())
                            .unwrap()
                    )
                    .await
                    .is_ok(),
                "{path}"
            );
        }
        assert_eq!(calls.load(Ordering::SeqCst), 6);
    });
}
fn kubeconfig() -> kube::config::Kubeconfig {
    config::parse_yaml("apiVersion: v1\nkind: Config\nclusters:\n- name: shared\n  cluster:\n    server: https://cluster.example\nusers:\n- name: reader\n  user:\n    token: private-token\ncontexts:\n- name: first\n  context:\n    cluster: shared\n    user: reader\n- name: second\n  context:\n    cluster: shared\n    user: reader\n").unwrap()
}
#[test]
fn import_multiple_contexts_and_tls_policy() {
    let mut c = kubeconfig();
    assert_eq!(c.contexts.len(), 2);
    assert!(config::prepare(&mut c, "first").unwrap().is_none());
    c.clusters[0]
        .cluster
        .as_mut()
        .unwrap()
        .insecure_skip_tls_verify = Some(true);
    assert!(config::prepare(&mut c, "first").is_err());
    c.clusters[0]
        .cluster
        .as_mut()
        .unwrap()
        .insecure_skip_tls_verify = None;
    c.clusters[0].cluster.as_mut().unwrap().server = Some("http://cluster.example".into());
    assert!(config::prepare(&mut c, "first").is_err());
    assert!(config::parse_yaml("secret: [not valid").is_err());
}
#[test]
fn plugin_trust_changes_with_configuration_and_never_executes_while_parsing() {
    let mut c = kubeconfig();
    c.auth_infos[0].auth_info.as_mut().unwrap().exec=Some(serde_json::from_value(json!({"command":"/usr/bin/true","args":["first"],"apiVersion":"client.authentication.k8s.io/v1","interactiveMode":"Never"})).unwrap());
    let original = config::prepare(&mut c, "first").unwrap().unwrap();
    c.auth_infos[0]
        .auth_info
        .as_mut()
        .unwrap()
        .exec
        .as_mut()
        .unwrap()
        .args = Some(vec!["second".into()]);
    assert_ne!(original, config::prepare(&mut c, "first").unwrap().unwrap());
    assert_ne!(
        config::prepare(&mut c, "first").unwrap(),
        config::prepare(&mut c, "second").unwrap()
    );
    c.auth_infos[0]
        .auth_info
        .as_mut()
        .unwrap()
        .exec
        .as_mut()
        .unwrap()
        .command = Some("/bin/sh".into());
    assert!(config::prepare(&mut c, "first").is_err());
}
#[test]
fn secret_and_nested_helm_redaction() {
    let v = json!({"kind":"Secret","metadata":{"annotations":{"kubectl.kubernetes.io/last-applied-configuration":"private-value"}},"data":{"password":"private-value"},"stringData":{"password":"private-value"}});
    let redacted = presentation::redact(&json!([v.clone()]), false).to_string();
    assert!(!redacted.contains("private-value"));
    assert!(redacted.contains("password"));
    assert_eq!(presentation::redact(&v, true), v);
    let helm = json!({"kind":"HelmRelease","config":{"password":"private-value"},"chart":{"files":["private-value"]},"manifest":"private-value","hooks":["private-value"]});
    assert!(
        !presentation::redact(&helm, false)
            .to_string()
            .contains("private-value")
    );
}
#[test]
fn helm_storage_decodes_both_backends_and_rejects_bad_input() {
    use base64::Engine;
    use std::io::Write;
    let release = json!({"name":"app","version":2,"config":{"password":"secret"}});
    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(release.to_string().as_bytes()).unwrap();
    let encoded = base64::engine::general_purpose::STANDARD.encode(gzip.finish().unwrap());
    let configmap = json!({"data":{"release":encoded}});
    assert_eq!(
        presentation::decode_release(&configmap, false).unwrap(),
        release
    );
    let secret =
        json!({"data":{"release":base64::engine::general_purpose::STANDARD.encode(encoded)}});
    assert_eq!(
        presentation::decode_release(&secret, true).unwrap(),
        release
    );
    assert!(presentation::decode_release(&json!({"data":{"release":"bad"}}), true).is_err());
}
#[test]
fn bounded_log_buffer_preserves_utf8() {
    let mut text = "ก".repeat(300_000);
    trim_log(&mut text);
    assert!(text.len() <= 512 * 1024);
    assert!(text.ends_with('ก'));
}
#[test]
fn projection_uses_uid_numeric_values_and_resource_specific_columns() {
    let v = json!({"metadata":{"uid":"uid","name":"app","namespace":"apps","creationTimestamp":"2026-01-01T00:00:00Z"},"spec":{"replicas":12},"status":{"readyReplicas":10,"updatedReplicas":11,"availableReplicas":10}});
    let r = *crate::catalog::RESOURCES
        .iter()
        .find(|r| r.key == "deployments")
        .unwrap();
    let row = presentation::row("cluster-id", r, &v);
    assert_eq!(row.id, "cluster-id/uid");
    assert_eq!(row.cells[2].number, Some(10));
    assert_eq!(row.cells[3].number, Some(11));
    assert_eq!(row.cells.len(), r.columns().len());
    for r in crate::catalog::RESOURCES {
        assert_eq!(
            presentation::row("c", *r, &v).cells.len(),
            r.columns().len()
        );
    }
}
#[test]
fn network_mock_pagination_details_and_readonly_requests() {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let mut paths = Vec::new();
        for index in 0..3 {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut buffer = [0; 8192];
            let size = socket.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..size]);
            let line = request.lines().next().unwrap().to_string();
            assert!(line.starts_with("GET "));
            paths.push(line);
            let body=if index==0 {json!({"metadata":{"continue":"next token","resourceVersion":"1"},"items":[{"metadata":{"uid":"one"}}]})}else if index==1 {json!({"metadata":{"resourceVersion":"1"},"items":[{"metadata":{"uid":"two"}}]})}else{json!({"kind":"Pod","metadata":{"name":"p"}})}.to_string();
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        }
        paths
    });
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let policy = policy::Policy::default();
        policy.register("/api/v1/pods".into());
        let guard = policy.clone();
        let client = ClientBuilder::try_from(kube::Config::new(
            format!("http://{address}").parse().unwrap(),
        ))
        .unwrap()
        .with_layer(&tower::filter::FilterLayer::new(move |r| guard.check(r)))
        .build();
        let session = Session {
            client,
            specs: vec![],
            policy,
            cancelled: watch::channel(false).0,
            health: Mutex::new("Connected · Read-only".into()),
        };
        let (rows, version) = session.list(&builtin("pods"), None).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(version, "1");
        assert_eq!(
            session
                .json("/api/v1/namespaces/default/pods/p")
                .await
                .unwrap()["metadata"]["name"],
            "p"
        );
    });
    let paths = server.join().unwrap();
    assert!(paths[1].contains("continue=next%20token"));
}
#[test]
fn errors_never_echo_server_messages_or_credentials() {
    for (code, word) in [
        (401, "Credentials"),
        (403, "Forbidden"),
        (404, "unavailable"),
    ] {
        let message = error(kube::Error::Api(Box::new(kube::core::Status {
            message: "private-token".into(),
            reason: "test".into(),
            code,
            ..Default::default()
        })));
        assert!(message.contains(word));
        assert!(!message.contains("private-token"));
    }
}

#[test]
#[ignore = "Requires an explicitly selected real context; performs only guarded reads"]
fn live_readonly_smoke() {
    let context = std::env::var("LIGHTSHIP_TEST_CONTEXT").expect("Choose a context explicitly");
    let connection = config::Connection {
        id: "smoke".into(),
        name: "Smoke test".into(),
        context,
        source: config::Source::Files(config::default_files()),
        trusted_exec: None,
    };
    let backend = Backend::new();
    let mut job = backend.connect(connection);
    let start = std::time::Instant::now();
    loop {
        if let Some(result) = job.take() {
            println!(
                "Discovered {} additional resource kinds",
                result.unwrap().len()
            );
            break;
        }
        assert!(
            start.elapsed() < Duration::from_secs(120),
            "Connection timed out"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    backend.runtime.block_on(async {
        let session = backend.session("smoke").unwrap();
        for key in [
            "namespaces",
            "nodes",
            "deployments",
            "pods",
            "services",
            "events",
        ] {
            let (objects, _) = session.list(&builtin(key), None).await.unwrap();
            println!("{key}: {} resources", objects.len());
            if key == "deployments"
                && let Some(object) = objects.first()
            {
                session.json(&builtin(key).item(object)).await.unwrap();
                println!("Deployment details: readable");
            }
        }
        match session.helm().await {
            Ok(releases) => println!("Helm: {} release revisions", releases.len()),
            Err(e) => println!("Helm: {e}"),
        }
    });
    backend.disconnect("smoke");
}

fn mock_backend(
    handler: impl Fn(&http::Request<kube::client::Body>) -> (u16, String) + Send + Sync + 'static,
) -> Arc<Backend> {
    let backend = Backend::new();
    let _entered = backend.runtime.enter();
    let policy = policy::Policy::default();
    for r in crate::catalog::RESOURCES {
        policy.register(builtin(r.key).collection(None));
    }
    let guard = policy.clone();
    let handler = Arc::new(handler);
    let service = tower::service_fn(move |request: http::Request<kube::client::Body>| {
        let (status, body) = handler(&request);
        async move {
            Ok::<_, tower::BoxError>(
                http::Response::builder()
                    .status(status)
                    .body(kube::client::Body::from(body.into_bytes()))
                    .unwrap(),
            )
        }
    });
    let client = ClientBuilder::new(service, "default")
        .with_layer(&tower::filter::FilterLayer::new(move |r| guard.check(r)))
        .build();
    backend.sessions.lock().unwrap().insert(
        "test".into(),
        Arc::new(Session {
            client,
            specs: vec![],
            policy,
            cancelled: watch::channel(false).0,
            health: Mutex::new("Connected · Read-only".into()),
        }),
    );
    drop(_entered);
    backend
}
fn await_result<T: Clone>(job: &mut Job<T>) -> Result<T, String> {
    let start = std::time::Instant::now();
    loop {
        if let Some(result) = job.take() {
            return result;
        }
        assert!(start.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[test]
fn watch_expiration_relists_and_forbidden_watch_falls_back_without_losing_rows() {
    let lists = Arc::new(AtomicUsize::new(0));
    let watches = Arc::new(AtomicUsize::new(0));
    let list_count = lists.clone();
    let watch_count = watches.clone();
    let backend = mock_backend(move |request| {
        if request
            .uri()
            .query()
            .is_some_and(|q| q.contains("watch=true"))
        {
            if watch_count.fetch_add(1, Ordering::SeqCst) == 0 {
                (
                    200,
                    "{\"type\":\"ERROR\",\"object\":{\"code\":410}}\n".into(),
                )
            } else {
                (
                    403,
                    json!({"kind":"Status","status":"Failure","code":403,"message":"no watch"})
                        .to_string(),
                )
            }
        } else {
            let n = list_count.fetch_add(1, Ordering::SeqCst);
            (200,json!({"metadata":{"resourceVersion":format!("{n}")},"items":[{"metadata":{"uid":"same","name":format!("version-{n}")}}]}).to_string())
        }
    });
    let mut job = backend.resources("test".into(), "pods".into());
    let start = std::time::Instant::now();
    loop {
        let snapshot = await_result(&mut job).unwrap();
        if snapshot.status.contains("Watch unavailable") {
            assert_eq!(snapshot.objects[0]["metadata"]["name"], "version-1");
            break;
        }
        assert!(start.elapsed() < Duration::from_secs(5));
    }
    assert_eq!(lists.load(Ordering::SeqCst), 2);
    assert_eq!(watches.load(Ordering::SeqCst), 2);
    drop(job);
}
#[test]
fn missing_metrics_and_forbidden_resources_are_not_empty_successes() {
    let backend = mock_backend(|_| {
        (
            403,
            json!({"kind":"Status","status":"Failure","code":403}).to_string(),
        )
    });
    backend.runtime.block_on(async {
        let rows = backend.session("test").unwrap().overview().await;
        assert!(rows.iter().all(|r| r.get("error").is_some()));
        assert!(rows.iter().any(|r| r["name"] == "pods metrics"));
    });
}
#[test]
fn logs_query_options_and_completed_job_are_retained_once() {
    let paths = Arc::new(Mutex::new(Vec::new()));
    let recorded = paths.clone();
    let backend = mock_backend(move |r| {
        recorded.lock().unwrap().push(r.uri().to_string());
        (200, "first\nsecond\n".into())
    });
    let object = json!({"metadata":{"name":"pod","namespace":"apps"}});
    let mut job = backend.logs(
        "test",
        object,
        LogOptions {
            container: "main".into(),
            previous: true,
            timestamps: true,
            follow: false,
        },
    );
    assert_eq!(await_result(&mut job).unwrap(), "first\nsecond\n");
    std::thread::sleep(Duration::from_millis(20));
    let _ = job.take();
    assert!(job.take().is_none());
    let path = &paths.lock().unwrap()[0];
    assert!(path.contains("/namespaces/apps/pods/pod/log?"));
    assert!(path.contains("previous=true"));
    assert!(path.contains("follow=false"));
}
#[test]
fn disconnect_revokes_retained_session_and_job_drop_cancels_work() {
    let backend = mock_backend(|_| (200, "{}".into()));
    let old = backend.session("test").unwrap();
    backend.disconnect("test");
    assert!(backend.runtime.block_on(old.json("/api/v1/pods")).is_err());
    assert!(backend.session("test").is_err());
    struct Guard(Arc<AtomicUsize>);
    impl Drop for Guard {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
    let cancelled = Arc::new(AtomicUsize::new(0));
    let counter = cancelled.clone();
    let (start_tx, start_rx) = std::sync::mpsc::channel();
    let job = backend.job(async move {
        let _guard = Guard(counter);
        start_tx.send(()).unwrap();
        futures::future::pending::<()>().await;
        Ok(())
    });
    start_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    drop(job);
    let start = std::time::Instant::now();
    while cancelled.load(Ordering::SeqCst) == 0 {
        assert!(start.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn logs_are_displayed_as_text_without_terminal_control_sequences() {
    assert_eq!(
        presentation::plain_log("\u{1b}[32mhello\u{1b}[0m\n\u{1b}]0;title\u{7}world\t✓"),
        "hello\nworld\t✓"
    );
}
#[cfg(target_os = "macos")]
#[test]
fn missing_keychain_item_is_an_error_without_plaintext_fallback() {
    let connection = config::Connection {
        id: "missing".into(),
        name: "test".into(),
        context: "test".into(),
        source: config::Source::Keychain(format!("nonexistent-test-{}", uuid::Uuid::new_v4())),
        trusted_exec: None,
    };
    assert!(connection.read().unwrap_err().contains("Keychain"));
}

#[test]
fn credential_fingerprint_is_stable_across_environment_map_order() {
    let mut original = None;
    for index in 0..30 {
        let mut c = kubeconfig();
        let mut env = std::collections::HashMap::new();
        if index % 2 == 0 {
            env.insert("name".to_owned(), "REGION".to_owned());
            env.insert("value".to_owned(), "test".to_owned());
        } else {
            env.insert("value".to_owned(), "test".to_owned());
            env.insert("name".to_owned(), "REGION".to_owned());
        }
        let mut exec: kube::config::ExecConfig =
            serde_json::from_value(json!({"command":"/usr/bin/true","interactiveMode":"Never"}))
                .unwrap();
        exec.env = Some(vec![env]);
        c.auth_infos[0].auth_info.as_mut().unwrap().exec = Some(exec);
        let fingerprint = config::prepare(&mut c, "first").unwrap();
        if index == 0 {
            original = fingerprint;
        } else {
            assert_eq!(fingerprint, original);
        }
    }
}
#[test]
fn overview_metrics_summarize_real_cpu_and_memory_quantities() {
    let value = json!({"name":"pods metrics","metrics":{"items":[{"containers":[{"usage":{"cpu":"150000000n","memory":"1024Ki"}},{"usage":{"cpu":"100m","memory":"1Mi"}}]}]}});
    let row = presentation::row("c", crate::catalog::RESOURCES[0], &value);
    assert!(row.cells[1].text.contains("CPU 0.25 cores"));
    assert!(row.cells[1].text.contains("Memory 2.0 MiB"));
}
