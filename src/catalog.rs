//! Application-owned Kubernetes catalog and deterministic, offline fixtures.
use pintle_gpui_kit::{kit::assets::IconName, shell::workspace::Document};

#[cfg(test)]
pub const CLUSTERS: [&str; 3] = ["Development", "Staging", "Production"];
#[cfg(test)]
pub const NAMESPACES: [&str; 4] = ["default", "apps", "monitoring", "kube-system"];
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Resource {
    pub key: &'static str,
    pub title: &'static str,
    pub group: &'static str,
    pub namespaced: bool,
    pub fields: &'static [&'static str],
}
macro_rules! resources { ($($key:literal, $title:literal, $group:literal, $ns:literal, [$($field:literal),*];)*) => {
    pub const RESOURCES: &[Resource] = &[$(Resource { key: $key, title: $title, group: $group, namespaced: $ns, fields: &[$($field),*] }),*];
}; }
resources! {
    "overview", "Overview", "", false, ["Resources", "Healthy", "Attention"];
    "nodes", "Nodes", "", false, ["Status", "Role", "Version"];
    "namespaces", "Namespaces", "", false, ["Status"];
    "pods", "Pods", "Workloads", true, ["Status", "Containers", "Restarts", "CPU", "MEM", "Node"];
    "deployments", "Deployments", "Workloads", true, ["Ready", "Up-to-date", "Available"];
    "statefulsets", "StatefulSets", "Workloads", true, ["Ready", "Replicas", "Service"];
    "daemonsets", "DaemonSets", "Workloads", true, ["Desired", "Current", "Ready", "Available"];
    "jobs", "Jobs", "Workloads", true, ["Completions", "Duration", "Status"];
    "cronjobs", "CronJobs", "Workloads", true, ["Schedule", "Suspend", "Active", "Last schedule"];
    "services", "Services", "Network", true, ["Type", "Cluster IP", "Ports"];
    "ingresses", "Ingresses", "Network", true, ["Class", "Hosts", "Address"];
    "endpoints", "Endpoints", "Network", true, ["Addresses"];
    "networkpolicies", "NetworkPolicies", "Network", true, ["Pod selector", "Policy types"];
    "configmaps", "ConfigMaps", "Config", true, ["Keys"];
    "secrets", "Secrets", "Config", true, ["Type", "Keys"];
    "pvcs", "PersistentVolumeClaims", "Storage", true, ["Status", "Volume", "Capacity", "Access modes"];
    "pvs", "PersistentVolumes", "Storage", false, ["Status", "Capacity", "Access modes", "Storage class"];
    "storageclasses", "StorageClasses", "Storage", false, ["Provisioner", "Reclaim policy", "Binding mode"];
    "events", "Events", "", true, ["Type", "Reason", "Object", "Count"];
    "helm", "Helm Releases", "", true, ["Chart", "Version", "Status", "Revision"];
    "serviceaccounts", "ServiceAccounts", "Access Control", true, ["Secrets"];
    "roles", "Roles", "Access Control", true, ["Rules"];
    "rolebindings", "RoleBindings", "Access Control", true, ["Role", "Subjects"];
    "clusterroles", "ClusterRoles", "Access Control", false, ["Rules"];
    "clusterrolebindings", "ClusterRoleBindings", "Access Control", false, ["Role", "Subjects"];
    "definitions", "Definitions", "Custom Resources", false, ["Group", "Scope", "Versions"];
}
impl Resource {
    #[cfg(test)]
    pub fn document(self, cluster: &str) -> Document {
        Document::new(
            format!("{cluster}/{}", self.key).as_str(),
            self.title,
            cluster.to_owned(),
        )
    }
    pub fn columns(self) -> Vec<&'static str> {
        let mut columns = vec![if self.key == "overview" {
            "Resource"
        } else {
            "Name"
        }];
        if self.namespaced {
            columns.push("Namespace");
        }
        columns.extend(self.fields);
        if self.key != "overview" {
            columns.push("Age");
        }
        columns
    }
    pub fn icon(self) -> IconName {
        match self.key {
            "overview" => IconName::Activity,
            "nodes" => IconName::Server,
            "namespaces" => IconName::Folder,
            "pods" => IconName::Box,
            "events" => IconName::Bell,
            "helm" => IconName::Zap,
            _ => IconName::Layers,
        }
    }
}
pub fn resolve(document: &Document) -> (String, Resource) {
    let (cluster, key) = document
        .key
        .0
        .split_once('/')
        .expect("resource document key");
    (
        cluster.to_owned(),
        *RESOURCES.iter().find(|r| r.key == key).unwrap_or(&CUSTOM),
    )
}
pub const CUSTOM: Resource = Resource {
    key: "custom",
    title: "Custom Resource",
    group: "Custom Resources",
    namespaced: true,
    fields: &["Kind"],
};
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cell {
    pub text: String,
    pub number: Option<u64>,
}
impl Cell {
    pub fn text(value: impl Into<String>) -> Self {
        Self {
            text: value.into(),
            number: None,
        }
    }
    pub fn number(value: u64) -> Self {
        Self {
            text: value.to_string(),
            number: Some(value),
        }
    }
    pub fn formatted(value: u64, text: String) -> Self {
        Self {
            text,
            number: Some(value),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    pub id: String,
    pub name: String,
    pub namespace: Option<String>,
    pub cells: Vec<Cell>,
    pub healthy: bool,
}
#[cfg(test)]
pub fn fixtures(cluster: &str, resource: Resource) -> Vec<Row> {
    if resource.key == "overview" {
        return RESOURCES
            .iter()
            .filter(|r| r.key != "overview")
            .map(|r| {
                let rows = fixtures(cluster, *r);
                let healthy = rows.iter().filter(|r| r.healthy).count() as u64;
                Row {
                    id: format!("{cluster}/overview/{}", r.key),
                    name: r.title.into(),
                    namespace: None,
                    cells: vec![
                        Cell::text(r.title),
                        Cell::number(rows.len() as u64),
                        Cell::number(healthy),
                        Cell::number(rows.len() as u64 - healthy),
                    ],
                    healthy: healthy == rows.len() as u64,
                }
            })
            .collect();
    }
    let count = match resource.key {
        "deployments" => 29,
        "namespaces" => 4,
        "nodes" => 3,
        _ => 8,
    };
    let offset = CLUSTERS.iter().position(|c| *c == cluster).unwrap_or(0) as u64;
    (0..count)
        .map(|i| {
            let n = i as u64;
            let namespace = resource.namespaced.then(|| NAMESPACES[i % 4].to_owned());
            let name = match resource.key {
                "namespaces" => NAMESPACES[i].to_owned(),
                "nodes" => format!("{}-worker-{}", cluster.to_lowercase(), i + 1),
                "deployments" | "pods" => format!(
                    "{}-{}-{:02}",
                    cluster.to_lowercase(),
                    [
                        "api",
                        "web",
                        "worker",
                        "metrics",
                        "scheduler",
                        "gateway",
                        "notifications"
                    ][i % 7],
                    i + 1
                ),
                _ => format!("{}-{}-{:02}", cluster.to_lowercase(), resource.key, i + 1),
            };
            let healthy = i % 7 != 6;
            let replicas = 1 + (n + offset) % 4;
            let ready = if healthy { replicas } else { replicas - 1 };
            let mut cells = vec![Cell::text(&name)];
            if let Some(ns) = &namespace {
                cells.push(Cell::text(ns));
            }
            cells.extend(resource.fields.iter().map(|field| match *field {
                "CPU" => Cell::formatted(n * 15, format!("{}m", n * 15)),
                "MEM" => Cell::formatted(n * 70, format!("{}Mi", n * 70)),
                "Addresses" => Cell::number(n + 1),
                "Ready" | "Containers" | "Completions" => {
                    Cell::formatted(ready, format!("{ready}/{replicas}"))
                }
                "Replicas" | "Desired" | "Current" | "Up-to-date" => Cell::number(replicas),
                "Available" => Cell::number(ready),
                "Restarts" => Cell::number(if healthy { n % 3 } else { 12 }),
                "Status" => Cell::text(match resource.key {
                    "pods" => {
                        if healthy {
                            "Running"
                        } else {
                            "Pending"
                        }
                    }
                    "pvcs" | "pvs" => {
                        if healthy {
                            "Bound"
                        } else {
                            "Pending"
                        }
                    }
                    "namespaces" => "Active",
                    "jobs" => {
                        if healthy {
                            "Complete"
                        } else {
                            "Failed"
                        }
                    }
                    "helm" => {
                        if healthy {
                            "Deployed"
                        } else {
                            "Pending"
                        }
                    }
                    _ => {
                        if healthy {
                            "Ready"
                        } else {
                            "NotReady"
                        }
                    }
                }),
                "Node" => Cell::text(format!("{}-worker-{}", cluster.to_lowercase(), i % 3 + 1)),
                "Role" => Cell::text(if resource.key == "nodes" {
                    "worker"
                } else {
                    "viewer"
                }),
                "Version" => Cell::text(if resource.key == "nodes" {
                    "v1.32.2"
                } else {
                    "1.4.0"
                }),
                "Schedule" => Cell::text("*/15 * * * *"),
                "Suspend" => Cell::text("False"),
                "Active" => Cell::number(n % 2),
                "Last schedule" => Cell::formatted(n + 1, format!("{}m", n + 1)),
                "Duration" => Cell::formatted(30 + n * 12, format!("{}s", 30 + n * 12)),
                "Service" => Cell::text(format!("{name}-headless")),
                "Type" => Cell::text(match resource.key {
                    "services" => {
                        if i % 3 == 0 {
                            "LoadBalancer"
                        } else {
                            "ClusterIP"
                        }
                    }
                    "secrets" => "Opaque",
                    _ => {
                        if healthy {
                            "Normal"
                        } else {
                            "Warning"
                        }
                    }
                }),
                "Cluster IP" => Cell::text(format!("10.{}.0.{}", offset + 96, i + 10)),
                "Ports" => Cell::text("80/TCP, 443/TCP"),
                "Class" => Cell::text("nginx"),
                "Hosts" => Cell::text(format!("{name}.example.test")),
                "Address" => Cell::text(format!("192.0.2.{}", i + 1)),
                "Pod selector" => Cell::text("app=api"),
                "Policy types" => Cell::text("Ingress, Egress"),
                "Keys" | "Rules" | "Subjects" | "Secrets" | "Count" | "Revision" => {
                    Cell::number(n + 1)
                }
                "Volume" => Cell::text(format!("demo-volume-{i}")),
                "Capacity" => Cell::formatted((n + 1) * 10, format!("{} Gi", (n + 1) * 10)),
                "Access modes" => Cell::text("ReadWriteOnce"),
                "Storage class" => Cell::text("standard"),
                "Provisioner" => Cell::text("demo.csi.example.test"),
                "Reclaim policy" => Cell::text("Retain"),
                "Binding mode" => Cell::text("WaitForFirstConsumer"),
                "Reason" => Cell::text(if healthy {
                    "Scheduled"
                } else {
                    "FailedScheduling"
                }),
                "Object" => Cell::text(format!("Pod/demo-api-{i}")),
                "Chart" => Cell::text("demo-app"),
                "Group" => Cell::text("demo.example.test"),
                "Scope" => Cell::text("Namespaced"),
                "Versions" => Cell::text("v1alpha1"),
                "Size" => Cell::text(if healthy { "Small" } else { "Large" }),
                _ => unreachable!("all catalog fields have fixtures"),
            }));
            let age = 126 - n * 3 - offset;
            cells.push(Cell::formatted(age, format!("{age}d")));
            Row {
                id: format!("{cluster}/{}/{name}", resource.key),
                name,
                namespace,
                cells,
                healthy,
            }
        })
        .collect()
}
