//! Kubernetes-specific projection and redaction; no UI framework dependencies.
use crate::catalog::{Cell, Resource, Row};
use base64::Engine;
use serde_json::{Value, json};
use std::io::Read;
fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "—".into(),
        _ => v.to_string(),
    }
}
fn num(v: &Value) -> u64 {
    v.as_u64().unwrap_or(0)
}
fn count(v: &Value) -> usize {
    v.as_array()
        .map_or_else(|| v.as_object().map_or(0, |o| o.len()), |a| a.len())
}
fn items(v: &Value, f: impl Fn(&Value) -> String) -> String {
    v.as_array()
        .map(|a| a.iter().map(f).collect::<Vec<_>>().join(", "))
        .unwrap_or_else(|| "—".into())
}
fn cell(v: &Value) -> Cell {
    if let Some(n) = v.as_u64() {
        Cell::number(n)
    } else {
        Cell::text(text(v))
    }
}
pub fn healthy(v: &Value) -> bool {
    if let Some(conditions) = v.pointer("/status/conditions").and_then(Value::as_array) {
        if conditions.iter().any(|c| {
            matches!(c["type"].as_str(), Some("Failed" | "Degraded")) && c["status"] == "True"
        }) {
            return false;
        }
        if let Some(c) = conditions
            .iter()
            .find(|c| matches!(c["type"].as_str(), Some("Ready" | "Available")))
        {
            return c["status"] == "True";
        }
    }
    !matches!(
        v.pointer("/status/phase").and_then(Value::as_str),
        Some("Failed" | "Pending" | "Unknown")
    )
}
pub fn row(cluster: &str, resource: Resource, value: &Value) -> Row {
    if resource.key == "overview" {
        let name = text(&value["name"]);
        let cells = if value.get("metrics").is_some() {
            vec![
                Cell::text(&name),
                Cell::text(metrics_summary(&value["metrics"])),
                Cell::text("—"),
                Cell::text("—"),
            ]
        } else if value.get("error").is_some() {
            vec![
                Cell::text(&name),
                cell(&value["error"]),
                Cell::text("—"),
                Cell::text("—"),
            ]
        } else {
            vec![
                Cell::text(&name),
                cell(&value["count"]),
                cell(&value["healthy"]),
                cell(&value["attention"]),
            ]
        };
        return Row {
            id: format!("{cluster}/overview/{name}"),
            name,
            namespace: None,
            cells,
            healthy: value.get("error").is_none(),
        };
    }
    let name = if resource.key == "helm" {
        text(&value["name"])
    } else {
        text(&value["metadata"]["name"])
    };
    let namespace = value["metadata"]["namespace"].as_str().map(str::to_owned);
    let mut cells = vec![Cell::text(&name)];
    if resource.namespaced {
        cells.push(Cell::text(namespace.clone().unwrap_or_else(|| "—".into())));
    }
    let spec = &value["spec"];
    let status = &value["status"];
    for field in resource.fields {
        cells.push(match *field {
            "CPU" | "MEM" => Cell::text("—"),
            "Ready" | "Containers" => {
                let (ready, total) = if resource.key == "pods" {
                    (
                        status["containerStatuses"].as_array().map_or(0, |s| {
                            s.iter().filter(|s| s["ready"] == true).count() as u64
                        }),
                        count(&spec["containers"]) as u64,
                    )
                } else if resource.key == "daemonsets" {
                    (
                        num(&status["numberReady"]),
                        num(&status["desiredNumberScheduled"]),
                    )
                } else {
                    (
                        num(&status["readyReplicas"]),
                        spec["replicas"].as_u64().unwrap_or(1),
                    )
                };
                Cell::formatted(ready, format!("{ready}/{total}"))
            }
            "Up-to-date" => cell(&status["updatedReplicas"]),
            "Available" => cell(&status["availableReplicas"]),
            "Replicas" => cell(&spec["replicas"]),
            "Desired" => cell(&status["desiredNumberScheduled"]),
            "Current" => cell(&status["currentNumberScheduled"]),
            "Restarts" => Cell::number(
                status["containerStatuses"]
                    .as_array()
                    .map_or(0, |a| a.iter().map(|s| num(&s["restartCount"])).sum()),
            ),
            "Addresses" => Cell::number(
                value["subsets"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|v| count(&v["addresses"]) as u64)
                    .sum(),
            ),
            "Node" => cell(&spec["nodeName"]),
            "Service" => cell(&spec["serviceName"]),
            "Status" => Cell::text(match resource.key {
                "nodes" => {
                    if healthy(value) {
                        "Ready".into()
                    } else {
                        "NotReady".into()
                    }
                }
                "jobs" => {
                    if num(&status["succeeded"]) > 0 {
                        "Complete".into()
                    } else if num(&status["failed"]) > 0 {
                        "Failed".into()
                    } else {
                        "Active".into()
                    }
                }
                "pods" => {
                    if value["metadata"]["deletionTimestamp"].is_string() {
                        "Terminating".into()
                    } else if let Some(reason) = status["containerStatuses"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .find_map(|s| s.pointer("/state/waiting/reason").and_then(Value::as_str))
                    {
                        reason.into()
                    } else {
                        match status["phase"].as_str() {
                            Some("Succeeded") => "Completed".into(),
                            _ => text(&status["phase"]),
                        }
                    }
                }
                "helm" => text(&value["info"]["status"]),
                _ => text(&status["phase"]),
            }),
            "Role" if resource.key == "nodes" => Cell::text(
                value["metadata"]["labels"]
                    .as_object()
                    .map(|l| {
                        l.keys()
                            .filter_map(|k| k.strip_prefix("node-role.kubernetes.io/"))
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "worker".into()),
            ),
            "Role" => cell(&value["roleRef"]["name"]),
            "Version" if resource.key == "nodes" => cell(&status["nodeInfo"]["kubeletVersion"]),
            "Version" => cell(&value["chart"]["metadata"]["version"]),
            "Chart" => cell(&value["chart"]["metadata"]["name"]),
            "Revision" => cell(&value["version"]),
            "Completions" => Cell::formatted(
                num(&status["succeeded"]),
                format!(
                    "{}/{}",
                    num(&status["succeeded"]),
                    spec["completions"].as_u64().unwrap_or(1)
                ),
            ),
            "Duration" => {
                let seconds = timestamp(&status["completionTime"])
                    .unwrap_or_else(chrono::Utc::now)
                    .signed_duration_since(
                        timestamp(&status["startTime"]).unwrap_or_else(chrono::Utc::now),
                    )
                    .num_seconds()
                    .max(0) as u64;
                Cell::formatted(seconds, format!("{seconds}s"))
            }
            "Schedule" => cell(&spec["schedule"]),
            "Suspend" => Cell::text(spec["suspend"].as_bool().unwrap_or(false).to_string()),
            "Active" => Cell::number(count(&status["active"]) as u64),
            "Last schedule" => cell(&status["lastScheduleTime"]),
            "Type" => {
                if resource.key == "services" {
                    cell(&spec["type"])
                } else {
                    cell(&value["type"])
                }
            }
            "Cluster IP" => cell(&spec["clusterIP"]),
            "Ports" => Cell::text(items(&spec["ports"], |p| {
                format!("{}/{}", text(&p["port"]), text(&p["protocol"]))
            })),
            "Class" => cell(&spec["ingressClassName"]),
            "Hosts" => Cell::text(items(&spec["rules"], |p| text(&p["host"]))),
            "Address" => Cell::text(items(&status["loadBalancer"]["ingress"], |p| {
                if p["ip"].is_null() {
                    text(&p["hostname"])
                } else {
                    text(&p["ip"])
                }
            })),
            "Pod selector" => cell(&spec["podSelector"]),
            "Policy types" => Cell::text(items(&spec["policyTypes"], text)),
            "Keys" => Cell::number((count(&value["data"]) + count(&value["binaryData"])) as u64),
            "Volume" => cell(&spec["volumeName"]),
            "Capacity" => cell(if resource.key == "pvs" {
                &spec["capacity"]["storage"]
            } else {
                &status["capacity"]["storage"]
            }),
            "Access modes" => Cell::text(items(&spec["accessModes"], text)),
            "Storage class" => cell(&spec["storageClassName"]),
            "Provisioner" => cell(&value["provisioner"]),
            "Reclaim policy" => cell(&value["reclaimPolicy"]),
            "Binding mode" => cell(&value["volumeBindingMode"]),
            "Reason" => cell(&value["reason"]),
            "Object" => Cell::text(format!(
                "{}/{}",
                text(&value["involvedObject"]["kind"]),
                text(&value["involvedObject"]["name"])
            )),
            "Count" => cell(&value["count"]),
            "Secrets" => Cell::number(count(&value["secrets"]) as u64),
            "Rules" => Cell::number(count(&value["rules"]) as u64),
            "Subjects" => Cell::text(items(&value["subjects"], |s| {
                format!("{}:{}", text(&s["kind"]), text(&s["name"]))
            })),
            "Group" => cell(&spec["group"]),
            "Scope" => cell(&spec["scope"]),
            "Versions" => Cell::text(items(&spec["versions"], |v| text(&v["name"]))),
            "Kind" => cell(&value["kind"]),
            _ => Cell::text("—"),
        });
    }
    let age = timestamp(&value["metadata"]["creationTimestamp"]).map(|t| {
        chrono::Utc::now()
            .signed_duration_since(t)
            .num_seconds()
            .max(0) as u64
    });
    cells.push(
        age.map(|n| {
            Cell::formatted(
                n,
                if n >= 86400 {
                    format!("{}d", n / 86400)
                } else if n >= 3600 {
                    format!("{}h", n / 3600)
                } else {
                    format!("{}m", n / 60)
                },
            )
        })
        .unwrap_or_else(|| Cell::text("—")),
    );
    Row {
        id: format!("{cluster}/{}", text(&value["metadata"]["uid"])),
        name,
        namespace,
        cells,
        healthy: healthy(value),
    }
}
fn timestamp(v: &Value) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(v.as_str()?)
        .ok()
        .map(|t| t.with_timezone(&chrono::Utc))
}
/// Redact every Secret document, including nested objects and last-applied annotations.
pub fn redact(value: &Value, revealed: bool) -> Value {
    if revealed {
        return value.clone();
    }
    match value {
        Value::Array(a) => Value::Array(a.iter().map(|v| redact(v, false)).collect()),
        Value::Object(map) => {
            let secret = value["kind"] == "Secret"
                || value["type"]
                    .as_str()
                    .is_some_and(|t| t == "Opaque" || t.starts_with("kubernetes.io/"));
            let helm = value["kind"] == "HelmRelease";
            let mut result = map.clone();
            for (key, v) in &mut result {
                if secret && matches!(key.as_str(), "data" | "stringData") {
                    *v = v
                        .as_object()
                        .map(|m| {
                            Value::Object(m.keys().map(|k| (k.clone(), json!("••••••"))).collect())
                        })
                        .unwrap_or(json!("••••••"));
                } else if (secret && key == "metadata")
                    || (helm
                        && matches!(
                            key.as_str(),
                            "config" | "chart" | "manifest" | "hooks" | "info"
                        ))
                {
                    if key == "metadata" {
                        if let Some(o) = v.as_object_mut() {
                            o.remove("annotations");
                            o.remove("managedFields");
                        }
                    } else {
                        *v = json!("Hidden · Reveal to view potentially sensitive release data");
                    }
                } else {
                    *v = redact(v, false);
                }
            }
            Value::Object(result)
        }
        _ => value.clone(),
    }
}
pub fn decode_release(record: &Value, secret: bool) -> Result<Value, String> {
    let data = record["data"]["release"]
        .as_str()
        .ok_or("Missing release record")?;
    if data.len() > 16 * 1024 * 1024 {
        return Err("Oversized Helm record".into());
    }
    let outer = if secret {
        base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|_| "Invalid release encoding")?
    } else {
        data.as_bytes().to_vec()
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(outer)
        .map_err(|_| "Invalid Helm encoding")?;
    let mut decoded = Vec::new();
    if bytes.starts_with(&[0x1f, 0x8b]) {
        flate2::read::GzDecoder::new(bytes.as_slice())
            .take(16 * 1024 * 1024 + 1)
            .read_to_end(&mut decoded)
            .map_err(|_| "Invalid Helm compression")?;
    } else {
        decoded = bytes;
    }
    if decoded.len() > 16 * 1024 * 1024 {
        return Err("Oversized Helm release".into());
    }
    serde_json::from_slice(&decoded).map_err(|_| "Invalid Helm release".into())
}

fn quantity(value: &Value) -> Option<f64> {
    let text = value.as_str()?;
    for (suffix, factor) in [
        ("Ki", 1024.),
        ("Mi", 1048576.),
        ("Gi", 1073741824.),
        ("Ti", 1099511627776.),
        ("n", 1e-9),
        ("u", 1e-6),
        ("m", 1e-3),
        ("k", 1e3),
        ("M", 1e6),
        ("G", 1e9),
    ] {
        if let Some(number) = text.strip_suffix(suffix) {
            return number.parse::<f64>().ok().map(|n| n * factor);
        }
    }
    text.parse().ok()
}
fn metrics_summary(value: &Value) -> String {
    let mut cpu = 0.;
    let mut memory = 0.;
    let mut seen = false;
    for item in value["items"].as_array().into_iter().flatten() {
        let usage: Vec<_> = if let Some(containers) = item["containers"].as_array() {
            containers.iter().map(|c| &c["usage"]).collect()
        } else {
            vec![&item["usage"]]
        };
        for u in usage {
            if let (Some(c), Some(m)) = (quantity(&u["cpu"]), quantity(&u["memory"])) {
                cpu += c;
                memory += m;
                seen = true;
            }
        }
    }
    if seen {
        format!("CPU {cpu:.2} cores · Memory {:.1} MiB", memory / 1048576.)
    } else {
        "No metrics samples available".into()
    }
}

/// Logs are plain text, never a terminal. Drop ANSI control sequences (including OSC).
pub fn plain_log(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            match chars.next() {
                Some('[') => {
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    while let Some(c) = chars.next() {
                        if c == '\u{7}' {
                            break;
                        }
                        if c == '\u{1b}' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                _ => {}
            }
        } else if !ch.is_control() || matches!(ch, '\n' | '\t') {
            result.push(ch);
        }
    }
    result
}
