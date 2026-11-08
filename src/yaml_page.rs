//! Memory-only manifest documents and per-detail YAML drafts.
use crate::{
    backend::{
        Backend, Job,
        mutation::{self, BatchReport, Prepared},
    },
    inspector::PanelState,
};
use gpui::component::{
    Disableable, Sizable,
    button::{Button, ButtonVariants},
    input::{EditorState, InputEvent},
};
use gpui::{
    App, AppContext, Context, Entity, FocusHandle, Focusable, IntoElement, PathPromptOptions,
    Render, Subscription, Task, TestSupportExt, Window, div, prelude::*, px,
};
use pintle_gpui_kit::kit as gpui;
use serde_json::Value;
use std::{io::Read, sync::Arc, time::Duration};

pub struct YamlPage {
    backend: Arc<Backend>,
    cluster: String,
    context: String,
    namespace: Option<String>,
    edit: Option<(String, Value)>,
    draft: String,
    baseline: String,
    editor: Option<Entity<EditorState>>,
    subscription: Option<Subscription>,
    revealed: bool,
    visible: bool,
    pub completed: bool,
    stale: bool,
    status: String,
    prepare: Option<Job<Prepared>>,
    ready: Option<Prepared>,
    confirming: bool,
    job: Option<Job<BatchReport>>,
    report: Option<BatchReport>,
    panel: Entity<PanelState>,
    focus: FocusHandle,
    _poll: Task<()>,
    action: Option<Task<()>>,
}
impl YamlPage {
    pub fn new(
        cluster: String,
        context: String,
        namespace: Option<String>,
        backend: Arc<Backend>,
        panel: Entity<PanelState>,
        cx: &mut Context<Self>,
    ) -> Self {
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
            cluster,
            context,
            namespace,
            edit: None,
            draft: String::new(),
            baseline: String::new(),
            editor: None,
            subscription: None,
            revealed: true,
            visible: true,
            completed: false,
            stale: false,
            status: String::new(),
            prepare: None,
            ready: None,
            confirming: false,
            job: None,
            report: None,
            panel,
            focus: cx.focus_handle(),
            _poll: poll,
            action: None,
        }
    }
    pub fn edit(&mut self, key: String, baseline: Value) {
        self.draft = serde_yaml::to_string(&mutation::editable(&baseline)).unwrap_or_default();
        self.baseline = self.draft.clone();
        self.edit = Some((key, baseline));
    }
    pub fn dirty(&self) -> bool {
        self.draft != self.baseline
    }
    pub fn unresolved(&self) -> bool {
        self.report.as_ref().is_some_and(|r| r.check.is_some())
    }
    pub fn rename(&mut self, context: String, cx: &mut Context<Self>) {
        if self.context != context {
            self.context = context;
            cx.notify();
        }
    }
    pub fn busy(&self) -> bool {
        self.prepare.is_some() || self.confirming || self.job.is_some()
    }
    pub fn set_visible(&mut self, visible: bool, cx: &mut Context<Self>) {
        if self.visible == visible {
            return;
        }
        self.visible = visible;
        if !visible {
            self.hide(cx);
        }
    }
    pub fn hide(&mut self, cx: &mut Context<Self>) {
        self.revealed = false;
        self.editor = None;
        self.subscription = None;
        cx.notify();
    }
    pub fn accept_external(&mut self, object: &Value, cx: &mut Context<Self>) {
        if let Some((_, baseline)) = &self.edit
            && (baseline["metadata"]["uid"] != object["metadata"]["uid"]
                || baseline["metadata"]["resourceVersion"] != object["metadata"]["resourceVersion"])
        {
            self.stale = true;
            self.status =
                "Resource changed · draft retained; Reset and Refresh before Apply".into();
            cx.notify();
        }
    }
    pub fn permit_close(&self, window: &mut Window, cx: &mut App) -> Task<bool> {
        if self.busy() {
            return Task::ready(false);
        }
        if !self.dirty() && self.report.as_ref().is_none_or(|r| r.check.is_none()) {
            return Task::ready(true);
        }
        crate::confirm::ask(
            "Discard YAML draft?",
            format!(
                "Cluster: {}\nDiscard this memory-only draft and any unresolved result. Closing never resubmits a request.",
                self.context
            ),
            "Discard and continue",
            window,
            cx,
        )
    }
    fn poll(&mut self, cx: &mut Context<Self>) {
        if let Some(result) = self.prepare.as_mut().and_then(Job::take) {
            self.prepare = None;
            match result {
                Ok(plan) => {
                    self.ready = Some(plan);
                    self.confirming = true;
                }
                Err(e) => self.status = e,
            }
            cx.notify();
        }
        if let Some(result) = self.job.as_mut().and_then(Job::take) {
            self.job = None;
            match result {
                Ok(mut result) => {
                    if let Some(old) = self.report.take() {
                        for old_item in old.items {
                            if !result
                                .items
                                .iter()
                                .any(|item| item.target == old_item.target)
                            {
                                result.items.push(old_item);
                            }
                        }
                    }
                    self.status = result.text();
                    if result.succeeded() {
                        self.baseline = self.draft.clone();
                        self.completed = self.edit.is_some();
                    }
                    self.report = Some(result);
                }
                Err(e) => self.status = e,
            }
            let message = format!("YAML mutation · {} · {}", self.context, self.status);
            self.panel.update(cx, |panel, cx| panel.record(message, cx));
            cx.notify();
        }
    }
    fn review(&mut self, cx: &mut Context<Self>) {
        if self.busy()
            || self.stale
            || !self.revealed
            || self.report.as_ref().is_some_and(|r| r.check.is_some())
        {
            return;
        }
        self.report = None;
        self.status = "Validating targets · no writes sent".into();
        self.prepare = Some(if let Some((key, baseline)) = &self.edit {
            self.backend
                .prepare_update(&self.cluster, key, baseline.clone(), self.draft.clone())
        } else {
            self.backend
                .prepare_yaml(&self.cluster, self.draft.clone(), self.namespace.clone())
        });
        cx.notify();
    }
    fn confirm(&mut self, plan: Prepared, window: &mut Window, cx: &mut Context<Self>) {
        let answer = crate::confirm::ask(
            "Apply YAML?",
            plan.review(&self.context),
            "Apply",
            window,
            cx,
        );
        self.action = Some(cx.spawn_in(window, async move |owner, cx| {
            let accepted = answer.await;
            let _ = owner.update(cx, |this, cx| {
                this.confirming = false;
                if accepted {
                    this.status = "Applying…".into();
                    this.job = Some(this.backend.execute_mutation(plan));
                } else {
                    this.status = "Cancelled · no writes sent".into();
                }
                cx.notify();
            });
        }));
    }
    fn reset(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.busy() {
            return;
        }
        let answer = crate::confirm::ask(
            "Reset YAML draft?",
            "Discard edits and restore the loaded YAML. No request is sent to Kubernetes.".into(),
            "Reset draft",
            window,
            cx,
        );
        self.action = Some(cx.spawn_in(window, async move |owner, cx| {
            if answer.await {
                let _ = owner.update(cx, |this, cx| {
                    this.draft = this.baseline.clone();
                    this.editor = None;
                    this.subscription = None;
                    // Keep unresolved results blocked until a GET-only check resolves them.
                    this.status = if this.stale {
                        "Draft reset · Refresh the resource before editing again"
                    } else {
                        "Draft reset"
                    }
                    .into();
                    cx.notify();
                });
            }
        }));
    }
    fn load(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.busy() || self.report.as_ref().is_some_and(|r| r.check.is_some()) {
            return;
        }
        let permission = self.permit_close(window, cx);
        self.action = Some(cx.spawn_in(window, async move |owner, cx| {
            if !permission.await {
                return;
            }
            let picker = cx.update(|_, cx| {
                cx.prompt_for_paths(PathPromptOptions {
                    files: true,
                    directories: false,
                    multiple: false,
                    prompt: Some("Open Kubernetes YAML or JSON".into()),
                })
            });
            let Ok(picker) = picker else {
                return;
            };
            let Ok(Ok(Some(paths))) = picker.await else {
                return;
            };
            let Some(path) = paths.first().cloned() else {
                return;
            };
            let loaded = cx
                .background_spawn(async move {
                    let file = std::fs::File::open(path)
                        .map_err(|_| "Could not open the selected file")?;
                    let mut source = String::new();
                    file.take((mutation::MAX_YAML + 1) as u64)
                        .read_to_string(&mut source)
                        .map_err(|_| "Could not read UTF-8 YAML/JSON")?;
                    if source.len() > mutation::MAX_YAML {
                        return Err("YAML exceeds the 4 MiB editor limit");
                    }
                    Ok(source)
                })
                .await;
            let _ = owner.update(cx, |this, cx| {
                if this.busy() || this.report.as_ref().is_some_and(|r| r.check.is_some()) {
                    return;
                }
                match loaded {
                    Ok(source) => {
                        this.draft = source;
                        this.editor = None;
                        this.subscription = None;
                        this.revealed = true;
                        this.report = None;
                        this.status.clear();
                    }
                    Err(e) => this.status = e.into(),
                }
                cx.notify();
            });
        }));
    }
}
impl Focusable for YamlPage {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Render for YamlPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.poll(cx);
        if let Some(plan) = self.ready.take() {
            let owner = cx.entity();
            window.defer(cx, move |window, cx| {
                owner.update(cx, |this, cx| this.confirm(plan, window, cx))
            });
        }
        if self.editor.is_none() && self.revealed {
            let editor = cx
                .new(|cx| crate::yaml_editor::state(window, cx).default_value(self.draft.clone()));
            self.subscription = Some(cx.subscribe(
                &editor,
                |this, input, event: &InputEvent, cx| {
                    if matches!(event, InputEvent::Change)
                        && !this.busy()
                        && this.report.as_ref().is_none_or(|r| r.check.is_none())
                    {
                        this.draft = input.read(cx).value().to_string();
                        cx.notify();
                    }
                },
            ));
            self.editor = Some(editor);
        }
        let busy = self.busy();
        let unknown = self.report.as_ref().is_some_and(|r| r.check.is_some());
        div()
            .id("yaml-mutation-page")
            .test_support()
            .size_full()
            .min_h_0()
            .min_w_0()
            .flex()
            .flex_col()
            .track_focus(&self.focus)
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap_2()
                    .p_3()
                    .child(
                        div()
                            .id("yaml-draft-context")
                            .test_support()
                            .flex_1()
                            .min_w_0()
                            .child(format!(
                                "{} · {}{}",
                                self.context,
                                if self.edit.is_some() {
                                    "Edit YAML"
                                } else {
                                    "Apply YAML"
                                },
                                if self.dirty() { " · Unsaved •" } else { "" }
                            )),
                    )
                    .when(self.revealed, |d| {
                        d.child(
                            Button::new("hide-yaml-draft")
                                .label("Hide YAML")
                                .small()
                                .on_click(cx.listener(|this, _, _, cx| this.hide(cx))),
                        )
                    })
                    .when(self.edit.is_none(), |d| {
                        d.child(
                            Button::new("load-yaml-file")
                                .label("Open file…")
                                .small()
                                .disabled(busy || unknown)
                                .on_click(cx.listener(|this, _, window, cx| this.load(window, cx))),
                        )
                    })
                    .child(
                        Button::new("reset-yaml-draft")
                            .label("Reset")
                            .small()
                            .disabled(busy || !self.dirty())
                            .on_click(cx.listener(|this, _, window, cx| this.reset(window, cx))),
                    )
                    .child(
                        Button::new("apply-yaml-draft")
                            .label("Apply")
                            .primary()
                            .small()
                            .disabled(
                                busy || unknown
                                    || self.stale
                                    || !self.revealed
                                    || (self.edit.is_some() && !self.dirty())
                                    || self.draft.trim().is_empty(),
                            )
                            .on_click(cx.listener(|this, _, _, cx| this.review(cx))),
                    )
                    .when(unknown, |d| {
                        d.child(
                            Button::new("check-yaml-result")
                                .label("Check result")
                                .small()
                                .disabled(busy)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    if let Some(plan) =
                                        this.report.as_ref().and_then(|r| r.check.clone())
                                    {
                                        this.job = Some(this.backend.check_mutation(plan));
                                        cx.notify();
                                    }
                                })),
                        )
                    }),
            )
            .when(!self.status.is_empty(), |d| {
                d.child(
                    div()
                        .id("yaml-mutation-status")
                        .test_support()
                        .max_h(px(150.))
                        .overflow_y_scroll()
                        .px_3()
                        .pb_2()
                        .text_size(px(12.))
                        .child(self.status.clone()),
                )
            })
            .child(if let Some(editor) = &self.editor {
                div()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .px_3()
                    .pb_3()
                    .child(
                        crate::yaml_editor::editor(editor, busy || unknown)
                            .aria_label("Kubernetes manifest YAML"),
                    )
                    .into_any_element()
            } else {
                div()
                    .flex_1()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        Button::new("reveal-yaml-draft")
                            .label("Reveal YAML draft")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.revealed = true;
                                cx.notify();
                            })),
                    )
                    .into_any_element()
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::tests::{await_result, mock_backend};
    use gpui::{AnyWindowHandle, TestAppContext, test::TestWindowExt};
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    fn source() -> &'static str {
        "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: config}\ndata: {key: private-value}\n"
    }
    fn open(cx: &mut TestAppContext) -> (AnyWindowHandle, Entity<YamlPage>, Arc<AtomicUsize>) {
        let writes = Arc::new(AtomicUsize::new(0));
        let count = writes.clone();
        let backend = mock_backend(move |r| {
            if r.method() != http::Method::GET {
                count.fetch_add(1, Ordering::SeqCst);
                return (200, json!({"kind":"ConfigMap"}).to_string());
            }
            if r.uri().path() == "/api/v1" {
                return (200,json!({"resources":[{"kind":"ConfigMap","name":"configmaps","namespaced":true,"verbs":["get","patch","create","update"]}]}).to_string());
            }
            (
                404,
                json!({"kind":"Status","apiVersion":"v1","status":"Failure","code":404})
                    .to_string(),
            )
        });
        let (handle, page) = cx.update(|cx| {
            crate::initialize(cx);
            let panel = cx.new(|_| PanelState::default());
            gpui::open_window(gpui::WindowOptions::default(), cx, |_, cx| {
                cx.new(|cx| {
                    YamlPage::new(
                        "test".into(),
                        "Test cluster".into(),
                        Some("apps".into()),
                        backend,
                        panel,
                        cx,
                    )
                })
            })
            .unwrap()
        });
        (handle, page, writes)
    }
    fn review(page: &Entity<YamlPage>, window: &mut Window, cx: &mut App) {
        page.update(cx, |page, cx| {
            page.review(cx);
            let prepared = await_result(page.prepare.as_mut().unwrap()).unwrap();
            page.prepare = None;
            page.confirming = true;
            page.confirm(prepared, window, cx);
        });
    }
    #[gpui_kit::test]
    fn review_cancel_then_apply_writes_once_and_logs_only_metadata(cx: &mut TestAppContext) {
        let (handle, page, writes) = open(cx);
        handle
            .update(cx, |_, window, cx| {
                page.update(cx, |page, _| page.draft = source().into());
                window.render_frame(cx);
                assert!(page.read(cx).dirty());
                review(&page, window, cx);
                window.render_frame(cx);
                assert_eq!(writes.load(Ordering::SeqCst), 0);
                window.click("confirm-cancel", cx);
            })
            .unwrap();
        cx.run_until_parked();
        handle
            .update(cx, |_, window, cx| {
                assert!(!page.read(cx).busy());
                assert!(page.read(cx).dirty());
                assert_eq!(writes.load(Ordering::SeqCst), 0);
                review(&page, window, cx);
                window.render_frame(cx);
                window.click("confirm-accept", cx);
            })
            .unwrap();
        cx.run_until_parked();
        handle
            .update(cx, |_, window, cx| {
                let start = std::time::Instant::now();
                while page.read(cx).job.is_some() {
                    page.update(cx, |page, cx| page.poll(cx));
                    assert!(start.elapsed() < Duration::from_secs(5));
                    std::thread::sleep(Duration::from_millis(1));
                }
                assert_eq!(writes.load(Ordering::SeqCst), 1);
                assert!(!page.read(cx).dirty());
                assert!(page.read(cx).report.as_ref().unwrap().succeeded());
                assert!(
                    page.read(cx)
                        .panel
                        .read(cx)
                        .output
                        .iter()
                        .all(|line| !line.contains("private-value"))
                );
                window.render_frame(cx);
                window.click("apply-yaml-draft", cx);
                assert!(
                    page.read(cx).busy(),
                    "unchanged manifests must still support declarative reapply"
                );
            })
            .unwrap();
    }
    #[gpui_kit::test]
    fn drafts_survive_hiding_and_close_reset_cancellation_without_secret_undo(
        cx: &mut TestAppContext,
    ) {
        let (handle, page, writes) = open(cx);
        let mut closing = None;
        handle
            .update(cx, |_, window, cx| {
                page.update(cx, |page, _| page.draft = source().into());
                window.render_frame(cx);
                let first = page.read(cx).editor.as_ref().unwrap().entity_id();
                page.update(cx, |page, cx| page.set_visible(false, cx));
                window.render_frame(cx);
                assert!(page.read(cx).editor.is_none());
                assert!(page.read(cx).dirty());
                page.update(cx, |page, cx| page.set_visible(true, cx));
                window.render_frame(cx);
                window.click("reveal-yaml-draft", cx);
                window.render_frame(cx);
                assert_ne!(first, page.read(cx).editor.as_ref().unwrap().entity_id());
                assert!(page.read(cx).draft.contains("private-value"));
                closing = Some(page.update(cx, |page, cx| page.permit_close(window, cx)));
                window.render_frame(cx);
                window.click("confirm-cancel", cx);
            })
            .unwrap();
        cx.run_until_parked();
        let allowed = cx.foreground_executor().block_test(closing.take().unwrap());
        assert!(!allowed);
        handle
            .update(cx, |_, window, cx| {
                page.update(cx, |page, cx| page.reset(window, cx));
                window.render_frame(cx);
                window.click("confirm-accept", cx);
            })
            .unwrap();
        cx.run_until_parked();
        cx.update(|cx| {
            assert!(!page.read(cx).dirty());
            assert!(page.read(cx).draft.is_empty());
        });
        assert_eq!(writes.load(Ordering::SeqCst), 0);
    }
    #[gpui_kit::test]
    fn external_changes_keep_yaml_draft_and_block_apply(cx: &mut TestAppContext) {
        let (handle, page, writes) = open(cx);
        handle.update(cx, |_, window, cx| {
            page.update(cx, |page,cx| {
                let baseline = json!({"apiVersion":"v1","kind":"Secret","metadata":{"name":"credentials","namespace":"apps","uid":"secret","resourceVersion":"1"},"data":{"token":"private-value"}});
                page.edit("secrets".into(),baseline.clone());
                page.draft.push_str("# draft\n");
                let mut changed = baseline; changed["metadata"]["resourceVersion"] = json!("2");
                page.accept_external(&changed,cx);
                page.review(cx);
                assert!(page.prepare.is_none());
                assert!(page.dirty());
                page.hide(cx);
                assert!(page.editor.is_none());
                assert!(page.draft.contains("private-value"));
            });
            window.render_frame(cx);
        }).unwrap();
        assert_eq!(writes.load(Ordering::SeqCst), 0);
    }
}
