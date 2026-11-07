//! Retained resource details, owned independently by each workspace view.
use crate::{
    backend::{Backend, Detail, Job, LogOptions, presentation},
    catalog,
};
use gpui::assets::IconName;
use gpui::component::{
    ActiveTheme, Disableable, Selectable, Sizable,
    button::{Button, ButtonVariants},
    collapsible::Collapsible,
    menu::{DropdownMenu, PopupMenuItem},
};
use gpui::{
    App, Context, FocusHandle, Focusable, IntoElement, Render, ScrollHandle, SharedString, Task,
    TestSupportExt, Window, div, prelude::*, px,
};
use pintle_gpui_kit::{kit as gpui, shell::workspace::Document};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{cell::RefCell, collections::HashMap, rc::Rc, sync::Arc, time::Duration};

pub type Routes = Rc<RefCell<HashMap<String, DetailTarget>>>;
#[derive(Clone)]
pub struct DetailTarget {
    pub cluster: String,
    pub key: String,
    pub seed: Value,
}
impl DetailTarget {
    pub fn new(cluster: String, key: String, object: &Value) -> Option<Self> {
        object["metadata"]["name"]
            .as_str()
            .filter(|name| !name.is_empty())?;
        let seed = if key == "helm" {
            json!({"metadata": {"name":object["metadata"]["name"],"namespace":object["metadata"]["namespace"],"uid":object["metadata"]["uid"]},"kind":"HelmRelease","name":object["name"],"version":object["version"]})
        } else {
            json!({"metadata":{"name":object["metadata"]["name"],"namespace":object["metadata"]["namespace"],"uid":object["metadata"]["uid"]},"kind":object["kind"],"apiVersion":object["apiVersion"]})
        };
        Some(Self { cluster, key, seed })
    }
    pub fn name(&self) -> &str {
        if self.key == "helm" {
            self.seed["name"].as_str().unwrap_or("Release")
        } else {
            self.seed["metadata"]["name"].as_str().unwrap_or("Resource")
        }
    }
    pub fn resource(&self) -> catalog::Resource {
        *catalog::RESOURCES
            .iter()
            .find(|r| r.key == self.key)
            .unwrap_or(&catalog::CUSTOM)
    }
    pub fn list_key(&self) -> String {
        format!("{}/{}", self.cluster, self.key)
    }
    pub fn document(&self, cluster_name: &str) -> Document {
        let identity = json!([
            self.cluster,
            self.key,
            self.seed["metadata"]["namespace"],
            self.seed["metadata"]["name"],
            self.seed["metadata"]["uid"],
            if self.key == "helm" {
                self.seed["version"].clone()
            } else {
                Value::Null
            }
        ]);
        let digest = format!("{:x}", Sha256::digest(identity.to_string()));
        let namespace = self.seed["metadata"]["namespace"]
            .as_str()
            .filter(|s| !s.is_empty());
        let kind = self.seed["kind"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or(self.resource().title);
        let context = if let Some(ns) = namespace {
            format!("{cluster_name} / {ns} / {kind}")
        } else {
            format!("{cluster_name} / {kind}")
        };
        Document::new(
            format!("{}/detail:{digest}", self.cluster).as_str(),
            self.name().to_string(),
            context,
        )
        .icon_path(self.resource().icon().path())
    }
    fn logs_supported(&self) -> bool {
        matches!(
            self.key.as_str(),
            "pods" | "deployments" | "statefulsets" | "daemonsets" | "jobs"
        )
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DetailTab {
    Overview,
    Logs,
    Yaml,
    Events,
}
pub struct DetailPage {
    pub target: DetailTarget,
    backend: Arc<Backend>,
    pub(crate) detail: Option<Detail>,
    job: Option<Job<Detail>>,
    pods_job: Option<Job<Vec<Value>>>,
    logs: Option<Job<String>>,
    pods: Vec<Value>,
    pod_uid: String,
    options: LogOptions,
    pub(crate) tab: DetailTab,
    pub(crate) revealed: bool,
    visible: bool,
    pub(crate) status: String,
    log_status: String,
    log_text: String,
    additional: bool,
    context: String,
    focus: FocusHandle,
    scrolls: [ScrollHandle; 4],
    _poll: Task<()>,
}
impl DetailPage {
    pub fn new(
        target: DetailTarget,
        document: &Document,
        backend: Arc<Backend>,
        cx: &mut Context<Self>,
    ) -> Self {
        let job = Some(backend.detail(&target.cluster, &target.key, target.seed.clone()));
        let timer = cx.background_executor().clone();
        let poll = cx.spawn(async move |entity, cx| {
            loop {
                timer.timer(Duration::from_millis(100)).await;
                if entity.update(cx, |this, cx| this.poll(cx)).is_err() {
                    break;
                }
            }
        });
        Self {
            target,
            backend,
            detail: None,
            job,
            pods_job: None,
            logs: None,
            pods: Vec::new(),
            pod_uid: String::new(),
            options: LogOptions {
                timestamps: true,
                follow: true,
                ..Default::default()
            },
            tab: DetailTab::Overview,
            revealed: false,
            visible: true,
            status: "Loading details…".into(),
            log_status: String::new(),
            log_text: String::new(),
            additional: false,
            context: document.context.to_string(),
            focus: cx.focus_handle(),
            scrolls: std::array::from_fn(|_| ScrollHandle::new()),
            _poll: poll,
        }
    }
    #[cfg(test)]
    pub fn set_test_detail(&mut self, object: Value, events: Value, cx: &mut Context<Self>) {
        self.job = None;
        self.detail = Some(Detail { object, events });
        self.status = "Read-only".into();
        cx.notify();
    }
    pub fn rename(&mut self, document: &Document, cx: &mut Context<Self>) {
        if self.context != document.context.as_ref() {
            self.context = document.context.to_string();
            cx.notify();
        }
    }
    pub fn set_visible(&mut self, visible: bool, cx: &mut Context<Self>) {
        if self.visible == visible {
            return;
        }
        self.visible = visible;
        if !visible {
            self.stop_logs();
            self.pods_job = None;
            self.revealed = false;
        }
        cx.notify();
    }
    fn stop_logs(&mut self) {
        self.logs = None;
        if !self.log_status.is_empty() {
            self.log_status = "Stopped · choose Start to resume".into();
        }
    }
    fn poll(&mut self, cx: &mut Context<Self>) {
        let mut changed = false;
        if let Some(result) = self.job.as_mut().and_then(Job::take) {
            self.job = None;
            self.accept_detail(result, cx);
            changed = true;
        }
        if let Some(result) = self.pods_job.as_mut().and_then(Job::take) {
            self.pods_job = None;
            match result {
                Ok(pods) => {
                    self.pods = pods;
                    if !self
                        .pods
                        .iter()
                        .any(|p| p["metadata"]["uid"] == self.pod_uid)
                    {
                        self.pod_uid = self
                            .pods
                            .first()
                            .and_then(|p| p["metadata"]["uid"].as_str())
                            .unwrap_or_default()
                            .into();
                        self.options.container.clear();
                    }
                    self.choose_default_container();
                    self.log_status = if self.pods.is_empty() {
                        "No related Pods found"
                    } else {
                        "Choose Start to read logs"
                    }
                    .into();
                }
                Err(e) => {
                    self.pods.clear();
                    self.log_status = e;
                }
            }
            changed = true;
        }
        if let Some(result) = self.logs.as_mut().and_then(Job::take) {
            match result {
                Ok(text) => self.log_text = text,
                Err(e) => {
                    self.log_status = e;
                    self.logs = None;
                }
            }
            if self.logs.as_ref().is_some_and(Job::finished) {
                self.logs = None;
                self.log_status = "Log stream completed · choose Start to resume".into();
            }
            changed = true;
        }
        if changed {
            cx.notify();
        }
    }
    fn accept_detail(&mut self, result: Result<Detail, String>, cx: &mut Context<Self>) {
        match result {
            Ok(detail) => {
                self.detail = Some(detail);
                self.status = "Read-only".into();
                if self.visible && self.tab == DetailTab::Logs {
                    self.load_pods(cx);
                }
            }
            Err(e) => {
                self.revealed = false;
                self.stop_logs();
                self.pods_job = None;
                self.status = if self.detail.is_some() {
                    format!("Stale data · {e}")
                } else {
                    e
                };
            }
        }
    }
    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.stop_logs();
        self.pods_job = None;
        self.pods.clear();
        self.revealed = false;
        self.status = if self.detail.is_some() {
            "Refreshing · showing previous data"
        } else {
            "Loading details…"
        }
        .into();
        self.job = Some(self.backend.detail(
            &self.target.cluster,
            &self.target.key,
            self.target.seed.clone(),
        ));
        cx.notify();
    }
    fn select_tab(&mut self, tab: DetailTab, cx: &mut Context<Self>) {
        if self.tab == tab {
            return;
        }
        self.stop_logs();
        self.pods_job = None;
        self.tab = tab;
        if tab == DetailTab::Logs {
            self.load_pods(cx);
        }
        cx.notify();
    }
    fn load_pods(&mut self, cx: &mut Context<Self>) {
        if let Some(detail) = &self.detail {
            self.log_status = "Finding related Pods…".into();
            self.pods_job = Some(self.backend.related_pods(
                &self.target.cluster,
                &self.target.key,
                detail.object.clone(),
            ));
        } else {
            self.log_status = "Load resource details before reading logs".into();
        }
        cx.notify();
    }
    fn selected_pod(&self) -> Option<&Value> {
        self.pods
            .iter()
            .find(|p| p["metadata"]["uid"] == self.pod_uid)
    }
    fn containers(&self) -> Vec<String> {
        self.selected_pod()
            .into_iter()
            .flat_map(|pod| {
                ["containers", "initContainers", "ephemeralContainers"]
                    .into_iter()
                    .flat_map(move |key| pod["spec"][key].as_array().into_iter().flatten())
            })
            .filter_map(|c| c["name"].as_str().map(str::to_owned))
            .collect()
    }
    fn choose_default_container(&mut self) {
        let containers = self.containers();
        if !containers.contains(&self.options.container) {
            self.options.container = containers.first().cloned().unwrap_or_default();
        }
    }
    fn start_logs(&mut self, cx: &mut Context<Self>) {
        self.stop_logs();
        if !self.visible || self.tab != DetailTab::Logs || self.options.container.is_empty() {
            return;
        }
        if let Some(pod) = self.selected_pod().cloned() {
            self.logs = Some(
                self.backend
                    .logs(&self.target.cluster, pod, self.options.clone()),
            );
            self.log_text.clear();
            self.log_status = "Reading logs…".into();
        }
        cx.notify();
    }
    fn text_scroll(
        &self,
        id: &'static str,
        text: String,
        scroll: usize,
    ) -> impl IntoElement + use<> {
        div()
            .id(id)
            .test_support()
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&self.scrolls[scroll])
            .p_4()
            .child(text)
    }
    fn events(&self, recent: bool, cx: &App) -> gpui::AnyElement {
        let Some(detail) = &self.detail else {
            return div().child(self.status.clone()).into_any_element();
        };
        if let Some(error) = detail.events["unavailable"].as_str() {
            return div()
                .text_color(cx.theme().danger)
                .child(format!("Events unavailable · {error}"))
                .into_any_element();
        }
        let mut events: Vec<_> = detail.events["items"]
            .as_array()
            .into_iter()
            .flatten()
            .collect();
        events.sort_by_key(|event| std::cmp::Reverse(event_time(event)));
        if recent {
            events.truncate(5);
        }
        div()
            .flex()
            .flex_col()
            .gap_3()
            .when(events.is_empty(), |d| {
                d.min_h(px(64.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(cx.theme().muted_foreground)
                    .child("No events")
            })
            .children(events.into_iter().map(|event| {
                let time = ["lastTimestamp", "eventTime", "firstTimestamp"]
                    .into_iter()
                    .find_map(|key| event[key].as_str())
                    .unwrap_or("—");
                div()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .pb_2()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(format!(
                        "{} · {} · {}",
                        time,
                        string(&event["type"]),
                        string(&event["reason"])
                    ))
                    .child(string(&event["message"]))
            }))
            .into_any_element()
    }
    fn overview(&self, cx: &Context<Self>) -> gpui::AnyElement {
        let Some(detail) = &self.detail else {
            return self
                .text_scroll("details-loading", self.status.clone(), 0)
                .into_any_element();
        };
        let object = presentation::redact(&detail.object, self.revealed);
        let resource = self.target.resource();
        let row = presentation::row(&self.target.cluster, resource, &object);
        let columns = resource.columns();
        let summary = div()
            .id("detail-summary")
            .test_support()
            .flex_shrink_0()
            .flex()
            .flex_wrap()
            .gap_3()
            .children(
                resource
                    .fields
                    .iter()
                    .filter_map(|field| {
                        columns
                            .iter()
                            .position(|column| column == field)
                            .map(|i| (*field, row.cells[i].text.clone()))
                    })
                    .map(|(label, text)| {
                        div()
                            .flex_1()
                            .min_w(px(160.))
                            .border_1()
                            .border_color(cx.theme().border)
                            .rounded_lg()
                            .p_4()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(
                                div()
                                    .text_size(px(11.))
                                    .text_color(cx.theme().muted_foreground)
                                    .child(label.to_uppercase()),
                            )
                            .child(div().text_size(px(25.)).child(text))
                    }),
            );
        let metadata = [
            "name",
            "namespace",
            "uid",
            "creationTimestamp",
            "generation",
            "resourceVersion",
        ];
        let ports = ports(&object);
        let mut body = div().flex().flex_col().gap_4().child(
            div()
                .flex()
                .flex_col()
                .gap_2()
                .child(section_title("METADATA", cx))
                .children(metadata.into_iter().filter_map(|key| {
                    object["metadata"]
                        .get(key)
                        .filter(|v| !v.is_null())
                        .map(|value| {
                            div()
                                .flex()
                                .flex_wrap()
                                .gap_2()
                                .child(
                                    div()
                                        .w(px(150.))
                                        .text_color(cx.theme().muted_foreground)
                                        .child(key),
                                )
                                .child(string(value))
                        })
                })),
        );
        for field in resource
            .fields
            .iter()
            .copied()
            .chain(std::iter::once("Age"))
        {
            if let Some(index) = columns.iter().position(|column| *column == field) {
                body = body.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap_2()
                        .child(
                            div()
                                .w(px(150.))
                                .text_color(cx.theme().muted_foreground)
                                .child(field.to_lowercase()),
                        )
                        .child(row.cells[index].text.clone()),
                );
            }
        }
        if !ports.is_empty() {
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(section_title("PORTS", cx))
                    .child(chips(ports, cx)),
            );
        }
        for (key, label) in [("labels", "LABELS"), ("annotations", "ANNOTATIONS")] {
            if object["metadata"][key].is_object() {
                body = body.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(section_title(label, cx))
                        .child(chips(map_entries(&object["metadata"][key]), cx)),
                );
            }
        }
        if let Some(owners) = object["metadata"]["ownerReferences"].as_array() {
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(section_title("OWNERS", cx))
                    .children(owners.iter().map(|owner| {
                        div().child(format!(
                            "{} / {} · {}",
                            string(&owner["kind"]),
                            string(&owner["name"]),
                            string(&owner["uid"])
                        ))
                    })),
            );
        }
        if !object["status"]["conditions"].is_null() {
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(section_title("CONDITIONS", cx))
                    .child(yaml(&object["status"]["conditions"])),
            );
        }
        body = body.child(
            Collapsible::new()
                .open(self.additional)
                .child(
                    Button::new("toggle-additional-details")
                        .label(if self.additional {
                            "▾ Additional fields"
                        } else {
                            "▸ Additional fields"
                        })
                        .ghost()
                        .small()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.additional = !this.additional;
                            cx.notify();
                        })),
                )
                .content(
                    div()
                        .id("additional-detail-content")
                        .test_support()
                        .pt_3()
                        .child(yaml(&object)),
                ),
        );
        div()
            .id("detail-overview-scroll")
            .test_support()
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&self.scrolls[0])
            .p_4()
            .flex()
            .flex_col()
            .gap_4()
            .child(summary)
            .child(card("detail-metadata", self.target.name(), body, cx))
            .child(card(
                "recent-events",
                "RECENT EVENTS",
                self.events(true, cx),
                cx,
            ))
            .into_any_element()
    }
    fn logs_view(&self, cx: &Context<Self>) -> gpui::AnyElement {
        let owner = cx.weak_entity();
        let selected = self
            .selected_pod()
            .map(|p| string(&p["metadata"]["name"]))
            .unwrap_or_else(|| "Select Pod".into());
        let pods: Vec<_> = self
            .pods
            .iter()
            .map(|p| {
                (
                    string(&p["metadata"]["uid"]),
                    string(&p["metadata"]["name"]),
                )
            })
            .collect();
        let containers = self.containers();
        div()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .gap_3()
            .p_4()
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .child(
                        Button::new("log-pod")
                            .label(format!("Pod: {selected}"))
                            .small()
                            .disabled(pods.is_empty())
                            .dropdown_menu({
                                let owner = owner.clone();
                                move |mut menu, _, _| {
                                    for (uid, name) in &pods {
                                        let uid = uid.clone();
                                        let owner = owner.clone();
                                        menu =
                                            menu.item(PopupMenuItem::new(name.clone()).on_click(
                                                move |_, _, cx| {
                                                    let _ = owner.update(cx, |this, cx| {
                                                        this.stop_logs();
                                                        this.pod_uid = uid.clone();
                                                        this.options.container.clear();
                                                        this.choose_default_container();
                                                        this.log_text.clear();
                                                        cx.notify();
                                                    });
                                                },
                                            ));
                                    }
                                    menu
                                }
                            }),
                    )
                    .child(
                        Button::new("log-container")
                            .label(format!("Container: {}", self.options.container))
                            .small()
                            .disabled(containers.is_empty())
                            .dropdown_menu(move |mut menu, _, _| {
                                for name in &containers {
                                    let name = name.clone();
                                    let owner = owner.clone();
                                    menu = menu.item(PopupMenuItem::new(name.clone()).on_click(
                                        move |_, _, cx| {
                                            let _ = owner.update(cx, |this, cx| {
                                                this.stop_logs();
                                                this.options.container = name.clone();
                                                this.log_text.clear();
                                                cx.notify();
                                            });
                                        },
                                    ));
                                }
                                menu
                            }),
                    )
                    .child(
                        Button::new("previous-logs")
                            .label(format!("Previous: {}", self.options.previous))
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.stop_logs();
                                this.options.previous = !this.options.previous;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("timestamp-logs")
                            .label(format!("Timestamps: {}", self.options.timestamps))
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.stop_logs();
                                this.options.timestamps = !this.options.timestamps;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("follow-logs")
                            .label(format!("Follow: {}", self.options.follow))
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.stop_logs();
                                this.options.follow = !this.options.follow;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("reload-log-pods")
                            .label("Reload Pods")
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.stop_logs();
                                this.load_pods(cx);
                            })),
                    )
                    .child(
                        Button::new("start-logs")
                            .label("Start")
                            .small()
                            .disabled(
                                self.pods_job.is_some()
                                    || self.selected_pod().is_none()
                                    || self.options.container.is_empty(),
                            )
                            .on_click(cx.listener(|this, _, _, cx| this.start_logs(cx))),
                    )
                    .child(
                        Button::new("stop-logs")
                            .label("Stop")
                            .small()
                            .disabled(self.logs.is_none())
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.stop_logs();
                                cx.notify();
                            })),
                    ),
            )
            .child(self.log_status.clone())
            .child(self.text_scroll("resource-logs", presentation::plain_log(&self.log_text), 1))
            .into_any_element()
    }
}
fn event_time(event: &Value) -> Option<chrono::DateTime<chrono::Utc>> {
    ["lastTimestamp", "eventTime", "firstTimestamp"]
        .into_iter()
        .filter_map(|key| event[key].as_str())
        .chain(event["metadata"]["creationTimestamp"].as_str())
        .find_map(|text| {
            chrono::DateTime::parse_from_rfc3339(text)
                .ok()
                .map(|t| t.with_timezone(&chrono::Utc))
        })
}
fn string(value: &Value) -> String {
    value.as_str().map(str::to_owned).unwrap_or_else(|| {
        if value.is_null() {
            "—".into()
        } else {
            value.to_string()
        }
    })
}
fn yaml(value: &Value) -> String {
    serde_yaml::to_string(value).unwrap_or_else(|_| "Cannot display resource".into())
}
fn map_entries(value: &Value) -> Vec<String> {
    value
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, v)| format!("{k}={}", string(v)))
        .collect()
}
fn ports(object: &Value) -> Vec<String> {
    let mut result: Vec<_> = object["spec"]["ports"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| {
            format!(
                "{}/{}",
                string(&p["port"]),
                p["protocol"].as_str().unwrap_or("TCP")
            )
        })
        .collect();
    let spec = if object["spec"].get("containers").is_some() {
        &object["spec"]
    } else {
        &object["spec"]["template"]["spec"]
    };
    for c in spec["containers"].as_array().into_iter().flatten() {
        for p in c["ports"].as_array().into_iter().flatten() {
            result.push(format!(
                "{}/{}",
                string(&p["containerPort"]),
                p["protocol"].as_str().unwrap_or("TCP")
            ));
        }
    }
    result.sort();
    result.dedup();
    result
}
fn chips(values: Vec<String>, cx: &App) -> impl IntoElement + use<> {
    div()
        .flex()
        .flex_wrap()
        .gap_2()
        .children(values.into_iter().map(|value| {
            div()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .px_2()
                .py_0p5()
                .child(value)
        }))
}
fn section_title(title: &'static str, cx: &App) -> impl IntoElement + use<> {
    div()
        .text_size(px(11.))
        .text_color(cx.theme().muted_foreground)
        .child(title)
}
fn card(id: &'static str, title: &str, content: impl IntoElement, cx: &App) -> gpui::AnyElement {
    div()
        .id(id)
        .test_support()
        .flex_shrink_0()
        .border_1()
        .border_color(cx.theme().border)
        .rounded_lg()
        .p_4()
        .flex()
        .flex_col()
        .gap_4()
        .child(title.to_string())
        .child(content)
        .into_any_element()
}
impl Focusable for DetailPage {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Render for DetailPage {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("resource-detail-page")
            .test_support()
            .size_full()
            .min_h_0()
            .min_w_0()
            .flex()
            .flex_col()
            .track_focus(&self.focus)
            .font_family(cx.theme().mono_font_family.clone())
            .text_size(px(13.))
            .child(
                div()
                    .id("resource-detail-tabs")
                    .test_support()
                    .flex_shrink_0()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap_2()
                    .px_3()
                    .py_2()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .children(
                        [
                            (DetailTab::Overview, "Overview"),
                            (DetailTab::Logs, "Logs"),
                            (DetailTab::Yaml, "YAML"),
                            (DetailTab::Events, "Events"),
                        ]
                        .into_iter()
                        .filter(|(tab, _)| *tab != DetailTab::Logs || self.target.logs_supported())
                        .map(|(tab, label)| {
                            Button::new(SharedString::from(format!("detail-tab:{label}")))
                                .label(label)
                                .small()
                                .ghost()
                                .selected(self.tab == tab)
                                .when(self.tab == tab, |b| {
                                    b.border_b_2().border_color(cx.theme().foreground)
                                })
                                .on_click(
                                    cx.listener(move |this, _, _, cx| this.select_tab(tab, cx)),
                                )
                        }),
                    )
                    .child(div().flex_1())
                    .when(
                        matches!(self.target.key.as_str(), "secrets" | "helm"),
                        |d| {
                            d.child(
                                Button::new("reveal-values")
                                    .label(if self.revealed {
                                        "Hide sensitive values"
                                    } else {
                                        "Reveal sensitive values"
                                    })
                                    .small()
                                    .ghost()
                                    .disabled(self.detail.is_none())
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.revealed = !this.revealed;
                                        cx.notify();
                                    })),
                            )
                        },
                    )
                    .child(
                        Button::new("refresh-resource-detail")
                            .icon(IconName::RefreshCw)
                            .label("Refresh")
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
                    ),
            )
            .child(
                div()
                    .id("detail-status")
                    .test_support()
                    .px_4()
                    .py_2()
                    .text_size(px(11.))
                    .text_color(cx.theme().muted_foreground)
                    .child(format!("{} · {}", self.context, self.status)),
            )
            .child(match self.tab {
                DetailTab::Overview => self.overview(cx),
                DetailTab::Logs => self.logs_view(cx),
                DetailTab::Yaml => self
                    .text_scroll(
                        "resource-yaml",
                        self.detail
                            .as_ref()
                            .map(|d| yaml(&presentation::redact(&d.object, self.revealed)))
                            .unwrap_or_else(|| self.status.clone()),
                        2,
                    )
                    .into_any_element(),
                DetailTab::Events => div()
                    .id("detail-events-scroll")
                    .test_support()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .track_scroll(&self.scrolls[3])
                    .p_4()
                    .child(self.events(false, cx))
                    .into_any_element(),
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{TestAppContext, test::TestWindowExt};
    fn object() -> Value {
        json!({"kind":"Pod","apiVersion":"v1","metadata":{"name":"api","namespace":"apps","uid":"uid"},"spec":{"containers":[{"name":"main"},{"name":"sidecar"}],"initContainers":[{"name":"init"}]},"status":{"phase":"Running"}})
    }
    #[test]
    fn identities_isolate_clusters_namespaces_uids_and_helm_revisions() {
        let original = DetailTarget::new("one".into(), "pods".into(), &object()).unwrap();
        let document = original.document("Friendly");
        assert_eq!(document.key, original.document("Renamed").key);
        assert!(document.context.contains("Friendly / apps / Pod"));
        for (cluster, key, object) in [
            ("two", "pods", object()),
            ("one", "services", object()),
            ("one", "pods", {
                let mut o = object();
                o["metadata"]["namespace"] = json!("other");
                o
            }),
            ("one", "pods", {
                let mut o = object();
                o["metadata"]["uid"] = json!("new");
                o
            }),
        ] {
            assert_ne!(
                DetailTarget::new(cluster.into(), key.into(), &object)
                    .unwrap()
                    .document("Friendly")
                    .key,
                document.key
            );
        }
        let release = json!({"kind":"HelmRelease","name":"release-name","version":1,"metadata":{"name":"storage-record","namespace":"apps","uid":"record"},"config":{"password":"private"},"manifest":"private manifest"});
        let first = DetailTarget::new("one".into(), "helm".into(), &release).unwrap();
        let mut second = release.clone();
        second["version"] = json!(2);
        assert_eq!(first.name(), "release-name");
        assert!(!first.seed.to_string().contains("private"));
        assert_ne!(
            first.document("c").key,
            DetailTarget::new("one".into(), "helm".into(), &second)
                .unwrap()
                .document("c")
                .key
        );
        assert!(!original.seed.to_string().contains("containers"));
    }
    #[gpui_kit::test]
    fn logs_stop_on_hide_tab_and_container_change_without_resuming(cx: &mut TestAppContext) {
        let backend = crate::backend::tests::mock_backend(|r| {
            if r.uri().path().ends_with("/log") {
                (200, "a line\n".into())
            } else if r.uri().path().ends_with("/events") {
                (200, json!({"items":[]}).to_string())
            } else {
                (200, object().to_string())
            }
        });
        let (handle, page) = cx.update(|cx| {
            crate::initialize(cx);
            let target = DetailTarget::new("test".into(), "pods".into(), &object()).unwrap();
            let doc = target.document("Test");
            gpui::open_window(
                pintle_gpui_kit::shell::workbench::window_options(cx),
                cx,
                |_, cx| cx.new(|cx| DetailPage::new(target, &doc, backend, cx)),
            )
            .unwrap()
        });
        handle
            .update(cx, |_, _, cx| {
                page.update(cx, |page, cx| {
                    let result = crate::backend::tests::await_result(page.job.as_mut().unwrap());
                    page.job = None;
                    page.accept_detail(result, cx);
                    page.select_tab(DetailTab::Logs, cx);
                    let pods = crate::backend::tests::await_result(page.pods_job.as_mut().unwrap())
                        .unwrap();
                    page.pods_job = None;
                    page.pods = pods;
                    page.pod_uid = "uid".into();
                    page.choose_default_container();
                    assert_eq!(page.containers(), ["main", "sidecar", "init"]);
                    page.start_logs(cx);
                    assert!(page.logs.is_some());
                    page.set_visible(false, cx);
                    assert!(page.logs.is_none());
                    page.set_visible(true, cx);
                    assert!(page.logs.is_none());
                    page.start_logs(cx);
                    page.select_tab(DetailTab::Yaml, cx);
                    assert!(page.logs.is_none());
                    page.select_tab(DetailTab::Logs, cx);
                    page.pods_job = None;
                    page.start_logs(cx);
                    assert!(page.logs.is_some());
                })
            })
            .unwrap();
        handle
            .update(cx, |_, window, cx| {
                window.render_frame(cx);
                window.click("log-container", cx);
            })
            .unwrap();
        handle
            .update(cx, |_, window, cx| {
                window.render_frame(cx);
                window.press("down", cx);
                window.press("enter", cx);
            })
            .unwrap();
        cx.update(|cx| assert!(page.read(cx).logs.is_none()));
    }
    #[gpui_kit::test]
    fn refresh_failure_keeps_old_detail_and_masks_sensitive_values(cx: &mut TestAppContext) {
        let (handle, page) = cx.update(|cx| {
            crate::initialize(cx);
            let target = DetailTarget::new("missing".into(), "secrets".into(), &object()).unwrap();
            let doc = target.document("Test");
            gpui::open_window(
                pintle_gpui_kit::shell::workbench::window_options(cx),
                cx,
                |_, cx| cx.new(|cx| DetailPage::new(target, &doc, Backend::new(), cx)),
            )
            .unwrap()
        });
        handle.update(cx,|_,_,cx|page.update(cx,|page,cx|{
            let secret=json!({"kind":"Secret","metadata":{"name":"api","uid":"uid"},"data":{"password":"private-value"}});
            page.set_test_detail(secret,json!({"unavailable":"Forbidden"}),cx);page.revealed=true;page.refresh(cx);
            let result=crate::backend::tests::await_result(page.job.as_mut().unwrap());page.job=None;page.accept_detail(result,cx);
            assert!(page.status.starts_with("Stale data"));assert!(page.detail.is_some());assert!(!page.revealed);
            assert!(!yaml(&presentation::redact(&page.detail.as_ref().unwrap().object,page.revealed)).contains("private-value"));
        })).unwrap();
    }
}
