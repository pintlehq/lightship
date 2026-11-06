use crate::backend::{Backend, Detail, Job, LogOptions, presentation};
use gpui::component::{
    Sizable,
    button::{Button, ButtonVariants},
    menu::{DropdownMenu, PopupMenuItem},
};
use gpui::{prelude::*, *};
use pintle_gpui_kit::kit as gpui;
use serde_json::Value;
use std::{sync::Arc, time::Duration};
pub struct Inspect;
pub struct PanelState {
    backend: Arc<Backend>,
    pub output: Vec<String>,
    detail: Option<Detail>,
    job: Option<Job<Detail>>,
    logs: Option<Job<String>>,
    cluster: String,
    key: String,
    status: String,
    log_text: String,
    options: LogOptions,
    tab: usize,
    revealed: bool,
    _poll: Task<()>,
}
impl EventEmitter<Inspect> for PanelState {}
impl PanelState {
    pub fn new(backend: Arc<Backend>, cx: &mut Context<Self>) -> Self {
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
            backend,
            output: vec![],
            detail: None,
            job: None,
            logs: None,
            cluster: String::new(),
            key: String::new(),
            status: "Select a resource to inspect".into(),
            log_text: String::new(),
            options: LogOptions {
                timestamps: true,
                follow: true,
                ..Default::default()
            },
            tab: 0,
            revealed: false,
            _poll: poll,
        }
    }
    fn poll(&mut self, cx: &mut Context<Self>) {
        if let Some(result) = self.job.as_mut().and_then(Job::take) {
            self.job = None;
            match result {
                Ok(detail) => {
                    self.detail = Some(detail);
                    self.status = "Read-only".into();
                }
                Err(e) => self.status = e,
            }
            cx.notify();
        }
        if let Some(result) = self.logs.as_mut().and_then(Job::take) {
            match result {
                Ok(text) => self.log_text = text,
                Err(e) => {
                    self.log_text = e;
                    self.logs = None;
                }
            }
            cx.notify();
        }
    }
    pub fn inspect(&mut self, cluster: String, key: String, object: Value, cx: &mut Context<Self>) {
        self.logs = None;
        self.log_text.clear();
        self.revealed = false;
        self.tab = 0;
        self.options.container.clear();
        self.status = "Loading details…".into();
        self.job = Some(self.backend.detail(&cluster, &key, object));
        self.cluster = cluster;
        self.key = key;
        self.detail = None;
        cx.emit(Inspect);
        cx.notify();
    }
    pub fn clear(&mut self, cx: &mut Context<Self>) {
        self.job = None;
        self.logs = None;
        self.detail = None;
        self.log_text.clear();
        self.revealed = false;
        self.status = "Select a resource to inspect".into();
        cx.notify();
    }
    pub fn record(&mut self, message: String, cx: &mut Context<Self>) {
        self.output.push(message);
        if self.output.len() > 200 {
            self.output.remove(0);
        }
        cx.notify();
    }
    pub fn stop_logs(&mut self) {
        self.logs = None;
    }
    fn start_logs(&mut self, cx: &mut Context<Self>) {
        if let Some(detail) = &self.detail {
            if self.options.container.is_empty() {
                self.options.container = detail.object["spec"]["containers"][0]["name"]
                    .as_str()
                    .unwrap_or_default()
                    .into();
            }
            self.logs = Some(self.backend.logs(
                &self.cluster,
                detail.object.clone(),
                self.options.clone(),
            ));
            self.log_text = "Loading logs…".into();
        }
        cx.notify();
    }
}
impl Render for PanelState {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let owner = cx.weak_entity();
        let containers = self
            .detail
            .as_ref()
            .map(|d| {
                ["containers", "initContainers", "ephemeralContainers"]
                    .into_iter()
                    .flat_map(|key| d.object["spec"][key].as_array().into_iter().flatten())
                    .filter_map(|c| c["name"].as_str().map(str::to_owned))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let text = if self.tab == 3 {
            crate::backend::presentation::plain_log(&self.log_text)
        } else if let Some(detail) = &self.detail {
            let object = presentation::redact(&detail.object, self.revealed);
            let shown = match self.tab {
                1 => object,
                2 => presentation::redact(&detail.events, false),
                _ => {
                    serde_json::json!({"metadata":object["metadata"],"conditions":object["status"]["conditions"],"status":object["status"],"spec":object["spec"],"type":object["type"],"data":object["data"],"stringData":object["stringData"],"binaryData":object["binaryData"],"rules":object["rules"],"roleRef":object["roleRef"],"subjects":object["subjects"],"release":if self.key=="helm"{object.clone()}else{Value::Null},"overview":if self.key=="overview"{object}else{Value::Null}})
                }
            };
            serde_yaml::to_string(&shown).unwrap_or_else(|_| "Cannot display resource".into())
        } else {
            self.status.clone()
        };
        div()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .gap_2()
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .children(
                        ["Details", "YAML", "Events", "Logs"]
                            .into_iter()
                            .enumerate()
                            .filter(|(i, _)| *i != 3 || self.key == "pods")
                            .map(|(index, label)| {
                                Button::new(("inspect-tab", index))
                                    .label(label)
                                    .small()
                                    .ghost()
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.tab = index;
                                        if index != 3 {
                                            this.logs = None;
                                        } else {
                                            this.start_logs(cx);
                                        }
                                        cx.notify();
                                    }))
                            }),
                    )
                    .when(matches!(self.key.as_str(), "secrets" | "helm"), |d| {
                        d.child(
                            Button::new("reveal-values")
                                .label(if self.revealed {
                                    "Hide sensitive values"
                                } else {
                                    "Reveal sensitive values"
                                })
                                .small()
                                .ghost()
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.revealed = !this.revealed;
                                    cx.notify();
                                })),
                        )
                    }),
            )
            .child(self.status.clone())
            .when(self.tab == 3, |d| {
                d.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap_2()
                        .child(
                            Button::new("log-container")
                                .label(format!("Container: {}", self.options.container))
                                .small()
                                .dropdown_menu(move |mut menu, _, _| {
                                    for name in &containers {
                                        let name = name.clone();
                                        let owner = owner.clone();
                                        menu =
                                            menu.item(PopupMenuItem::new(name.clone()).on_click(
                                                move |_, _, cx| {
                                                    let _ = owner.update(cx, |this, cx| {
                                                        this.options.container = name.clone();
                                                        this.start_logs(cx);
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
                                    this.options.previous = !this.options.previous;
                                    this.start_logs(cx);
                                })),
                        )
                        .child(
                            Button::new("timestamp-logs")
                                .label(format!("Timestamps: {}", self.options.timestamps))
                                .small()
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.options.timestamps = !this.options.timestamps;
                                    this.start_logs(cx);
                                })),
                        )
                        .child(
                            Button::new("follow-logs")
                                .label(format!("Follow: {}", self.options.follow))
                                .small()
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.options.follow = !this.options.follow;
                                    this.start_logs(cx);
                                })),
                        )
                        .child(Button::new("stop-logs").label("Stop").small().on_click(
                            cx.listener(|this, _, _, cx| {
                                this.logs = None;
                                cx.notify();
                            }),
                        ))
                        .child(
                            Button::new("start-logs")
                                .label("Start")
                                .small()
                                .on_click(cx.listener(|this, _, _, cx| this.start_logs(cx))),
                        ),
                )
            })
            .child(
                div()
                    .id("inspector-text")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(text),
            )
    }
}
