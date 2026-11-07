//! Per-document drafts. Sensitive values never leave memory or enter activity messages.
use crate::backend::{
    Backend, Job,
    data::{ApplyReport, ApplyState, DataEdit, DataKind, DataTarget, DataValues, MAX_DATA},
};
use crate::inspector::PanelState;
use base64::{Engine, engine::general_purpose::STANDARD};
use gpui::assets::IconName;
use gpui::base::ElementExt;
use gpui::component::{
    ActiveTheme, Disableable, Icon, Selectable,
    button::{Button, ButtonVariants},
    input::{EditorState, Input, InputEvent, InputState},
    menu::{DropdownMenu, PopupMenuItem},
};
use gpui::{
    AnyElement, App, AppContext, Context, Entity, EventEmitter, FocusHandle, IntoElement,
    PathPromptOptions, Render, SharedString, Subscription, Task, TestSupportExt, Window, div,
    prelude::*, px,
};
use pintle_gpui_kit::kit as gpui;
use serde_json::Value;
use std::{io::Read, sync::Arc};

#[derive(Clone)]
struct Field {
    original: Option<String>,
    name: String,
    value: String,
    binary: bool,
    base64: bool,
}
impl Field {
    fn bytes(&self) -> Result<Vec<u8>, String> {
        if self.base64 {
            STANDARD
                .decode(&self.value)
                .map_err(|_| "Invalid Base64 value".into())
        } else {
            Ok(self.value.as_bytes().to_vec())
        }
    }
}
#[derive(Clone)]
pub struct DataApplied(pub Value);
pub struct DataEditor {
    backend: Arc<Backend>,
    cluster: String,
    context: String,
    target: DataTarget,
    baseline: DataValues,
    fields: Vec<Field>,
    selected: usize,
    revealed: bool,
    immutable: bool,
    name: Entity<InputState>,
    editor: Option<Entity<EditorState>>,
    syncing: bool,
    error: String,
    status: String,
    blocked: bool,
    unknown: Option<DataEdit>,
    job: Option<Job<ApplyReport>>,
    focus: FocusHandle,
    restore_focus: bool,
    compact: bool,
    panel: Option<Entity<PanelState>>,
    _subscriptions: Vec<Subscription>,
    _action: Option<Task<()>>,
}
impl EventEmitter<DataApplied> for DataEditor {}
impl DataEditor {
    pub fn new(
        document: &crate::detail_page::DetailTarget,
        context: String,
        object: &Value,
        backend: Arc<Backend>,
        panel: Option<Entity<PanelState>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Self, String> {
        let target = DataTarget::from_object(&document.key, object)?;
        let cluster = document.cluster.clone();
        let baseline = DataValues::read(target.kind, object)?;
        let name = cx.new(|cx| InputState::new(window, cx).placeholder("Key name"));
        let change = cx.subscribe(&name, |this, input, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change)
                && !this.syncing
                && this.job.is_none()
                && !this.immutable
                && this.unknown.is_none()
            {
                if let Some(field) = this.fields.get_mut(this.selected) {
                    field.name = input.read(cx).value().to_string();
                }
                this.clear_editor();
                this.validate();
                cx.notify();
            }
        });
        let mut result = Self {
            backend,
            cluster,
            context,
            target,
            baseline: baseline.clone(),
            fields: fields(&baseline),
            selected: 0,
            revealed: false,
            immutable: object["immutable"] == true,
            name,
            editor: None,
            syncing: false,
            error: String::new(),
            status: String::new(),
            blocked: false,
            unknown: None,
            job: None,
            focus: cx.focus_handle(),
            restore_focus: false,
            compact: false,
            panel,
            _subscriptions: vec![change],
            _action: None,
        };
        result.sync_name(window, cx);
        Ok(result)
    }
    pub fn rename_context(&mut self, context: String, cx: &mut Context<Self>) {
        self.context = context;
        cx.notify();
    }
    pub fn dirty(&self) -> bool {
        self.values().as_ref() != Ok(&self.baseline)
    }
    pub fn busy(&self) -> bool {
        self.job.is_some()
    }
    fn clear_editor(&mut self) {
        self.editor = None;
        self._subscriptions.truncate(1);
    }
    pub fn hide(&mut self, cx: &mut Context<Self>) {
        self.restore_focus = true;
        self.revealed = false;
        if self.target.kind == DataKind::Secret {
            self.clear_editor();
        }
        cx.notify();
    }
    pub fn permit_close(&self, window: &mut Window, cx: &mut App) -> Task<bool> {
        if self.busy() {
            let answer = crate::confirm::ask(
                "Apply in progress",
                "Wait for the request to finish before closing this document.".into(),
                "Keep document open",
                window,
                cx,
            );
            return cx.spawn(async move |_| {
                answer.await;
                false
            });
        }
        if !self.dirty() {
            return Task::ready(true);
        }
        crate::confirm::ask(
            "Discard unsaved Data changes?",
            format!(
                "{} / {} / {}\nThe draft is stored only in this document. Closing does not send another request.",
                self.context, self.target.namespace, self.target.name
            ),
            "Discard and continue",
            window,
            cx,
        )
    }
    pub fn accept_external(&mut self, object: &Value, cx: &mut Context<Self>) {
        if object["metadata"]["resourceVersion"] == self.target.version {
            return;
        }
        if self.busy() || self.dirty() {
            self.blocked = true;
            self.status =
                "Resource changed in another view · draft retained; Reset and Refresh before Apply"
                    .into();
            cx.notify();
            return;
        }
        if let (Ok(target), Ok(values)) = (
            DataTarget::from_object(self.target.kind.key(), object),
            DataValues::read(self.target.kind, object),
        ) {
            self.target = target;
            self.baseline = values.clone();
            self.fields = fields(&values);
            self.selected = self.selected.min(self.fields.len().saturating_sub(1));
            self.revealed = false;
            self.clear_editor();
            self.immutable = object["immutable"] == true;
            cx.notify();
        }
    }
    fn values(&self) -> Result<DataValues, String> {
        let mut values = DataValues::default();
        for f in &self.fields {
            if values.text.contains_key(&f.name) || values.binary.contains_key(&f.name) {
                return Err("Key names must be unique".into());
            }
            let map = if f.binary {
                &mut values.binary
            } else {
                &mut values.text
            };
            map.insert(f.name.clone(), f.bytes()?);
        }
        values.validate(self.target.kind)?;
        Ok(values)
    }
    fn validate(&mut self) {
        self.error = self.values().err().unwrap_or_default();
    }
    fn sync_name(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.syncing = true;
        let name = self
            .fields
            .get(self.selected)
            .map(|f| f.name.clone())
            .unwrap_or_default();
        self.name
            .update(cx, |input, cx| input.set_value(name, window, cx));
        self.syncing = false;
    }
    fn choose(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        if index == self.selected {
            return;
        }
        self.selected = index;
        self.revealed = false;
        self.clear_editor();
        self.sync_name(window, cx);
        cx.notify();
    }
    fn add(&mut self, binary: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.immutable || self.busy() || self.unknown.is_some() {
            return;
        }
        let mut n = 1;
        let name = loop {
            let key = format!("new-field-{n}");
            if !self.fields.iter().any(|f| f.name == key) {
                break key;
            }
            n += 1;
        };
        self.fields.push(Field {
            original: None,
            name,
            value: String::new(),
            binary,
            base64: binary,
        });
        self.selected = self.fields.len() - 1;
        self.revealed = false;
        self.clear_editor();
        self.sync_name(window, cx);
        self.name.update(cx, |input, cx| input.focus(window, cx));
        cx.notify();
    }
    fn reset(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.busy() {
            return;
        }
        let answer=crate::confirm::ask("Reset Data draft?","Discard all edits and restore the last loaded data. Nothing will be sent to Kubernetes.".into(),"Reset draft",window,cx);
        self._action = Some(cx.spawn_in(window, async move |owner, cx| {
            if answer.await {
                let _ = cx.update(|window, cx| {
                    owner.update(cx, |this, cx| {
                        this.fields = fields(&this.baseline);
                        this.selected = 0;
                        this.revealed = false;
                        this.clear_editor();
                        this.error.clear();
                        this.restore_focus = true;
                        this.sync_name(window, cx);
                        cx.notify();
                    })
                });
            }
        }));
    }
    fn review(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Ok(values) = self.values() else {
            return;
        };
        if self.immutable || self.busy() || self.blocked || !self.dirty() {
            return;
        }
        let changes = self
            .fields
            .iter()
            .filter_map(|f| {
                let old = if f.binary {
                    &self.baseline.binary
                } else {
                    &self.baseline.text
                };
                match &f.original {
                    None => Some(format!("Added: {}", f.name)),
                    Some(name) if name != &f.name => Some(format!("Renamed: {name} → {}", f.name)),
                    Some(name) if old.get(name) != f.bytes().ok().as_ref() => {
                        Some(format!("Updated: {}", f.name))
                    }
                    _ => None,
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        let edit = DataEdit {
            target: self.target.clone(),
            values,
        };
        let answer = crate::confirm::ask(
            "Apply resource data?",
            format!(
                "Cluster: {}\nNamespace: {}\n{}: {}\n\n{}\n\nThis sends the data changes to Kubernetes. Values are omitted from this review.",
                self.context,
                self.target.namespace,
                self.target.kind.key(),
                self.target.name,
                changes
            ),
            "Apply changes",
            window,
            cx,
        );
        self._action = Some(cx.spawn_in(window, async move |owner, cx| {
            if answer.await {
                let _ = owner.update(cx, |this, cx| {
                    this.status = "Applying data…".into();
                    this.job = Some(this.backend.apply_data(&this.cluster, edit));
                    cx.notify();
                });
            }
        }));
    }
    fn upload(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.immutable
            || self.busy()
            || self.unknown.is_some()
            || (self.target.kind == DataKind::Secret && !self.revealed)
        {
            return;
        }
        let picker = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Load data value".into()),
        });
        let index = self.selected;
        self._action = Some(cx.spawn_in(window, async move |owner, cx| {
            let Ok(Ok(Some(paths))) = picker.await else {
                return;
            };
            let Some(path) = paths.first().cloned() else {
                return;
            };
            let result = cx
                .background_spawn(async move {
                    let file = std::fs::File::open(path)
                        .map_err(|_| "Could not open the selected file")?;
                    let mut bytes = Vec::new();
                    file.take((MAX_DATA + 1) as u64)
                        .read_to_end(&mut bytes)
                        .map_err(|_| "Could not read the selected file")?;
                    if bytes.len() > MAX_DATA {
                        return Err("File exceeds the 1 MiB limit");
                    }
                    Ok(bytes)
                })
                .await;
            let _ = owner.update(cx, |this, cx| {
                if this.selected != index
                    || this.busy()
                    || this.immutable
                    || this.unknown.is_some()
                    || (this.target.kind == DataKind::Secret && !this.revealed)
                {
                    return;
                }
                match result {
                    Ok(bytes) => {
                        if let Err(error) = this.store_upload(index, bytes) {
                            this.error = error;
                        }
                    }
                    Err(error) => this.error = error.into(),
                }
                cx.notify();
            });
        }));
    }
    fn store_upload(&mut self, index: usize, bytes: Vec<u8>) -> Result<(), String> {
        if bytes.len() > MAX_DATA {
            return Err("File exceeds the 1 MiB limit".into());
        }
        let field = self
            .fields
            .get_mut(index)
            .ok_or("Select a key before uploading")?;
        if field.binary || std::str::from_utf8(&bytes).is_err() {
            if self.target.kind == DataKind::ConfigMap && !field.binary {
                return Err("Binary file requires a Binary field".into());
            }
            field.base64 = true;
            field.value = STANDARD.encode(bytes);
        } else {
            field.base64 = false;
            field.value = String::from_utf8(bytes).expect("validated UTF-8");
        }
        self.clear_editor();
        self.validate();
        Ok(())
    }
    pub fn poll(&mut self, cx: &mut Context<Self>) {
        let Some(result) = self.job.as_mut().and_then(Job::take) else {
            return;
        };
        self.job = None;
        match result {
            Ok(report) => {
                self.status = report.message;
                self.blocked = matches!(
                    report.state,
                    ApplyState::Unknown
                        | ApplyState::Conflict
                        | ApplyState::Replaced
                        | ApplyState::Immutable
                );
                if report.state == ApplyState::Immutable {
                    self.immutable = true;
                }
                if report.state == ApplyState::Unknown {
                    self.unknown = self.values().ok().map(|values| DataEdit {
                        target: self.target.clone(),
                        values,
                    });
                } else {
                    self.unknown = None;
                }
                if let Some(object) = report.object
                    && let (Ok(target), Ok(values)) = (
                        DataTarget::from_object(self.target.kind.key(), &object),
                        DataValues::read(self.target.kind, &object),
                    )
                {
                    self.target = target;
                    self.baseline = values.clone();
                    self.fields = fields(&values);
                    self.selected = self.selected.min(self.fields.len().saturating_sub(1));
                    self.revealed = false;
                    self.clear_editor();
                    self.error.clear();
                    self.restore_focus = true;
                    cx.emit(DataApplied(object));
                }
            }
            Err(error) => self.status = error,
        }
        if let Some(panel) = &self.panel {
            panel.update(cx, |panel, cx| {
                panel.record(
                    format!(
                        "Data Apply · {} / {} / {} · {} keys · {}",
                        self.context,
                        self.target.namespace,
                        self.target.name,
                        self.fields.len(),
                        self.status
                    ),
                    cx,
                )
            });
        }
        cx.notify();
    }
    fn value_view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(field) = self.fields.get(self.selected) else {
            return div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .child("No keys · Add a field to begin")
                .into_any_element();
        };
        if self.target.kind == DataKind::Secret && !self.revealed {
            return div()
                .id("data-value-hidden")
                .test_support()
                .flex_1()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap_3()
                .child(Icon::new(IconName::Lock).size(px(20.)))
                .child("Value hidden")
                .child(
                    Button::new("reveal-data-value")
                        .icon(IconName::Eye)
                        .label("Reveal to view / edit")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.revealed = true;
                            cx.notify();
                        })),
                )
                .into_any_element();
        }
        if self.editor.is_none() {
            let language = if field.base64 {
                "plaintext"
            } else {
                language(&field.name)
            };
            let value = field.value.clone();
            let editor = cx.new(|cx| {
                crate::yaml_editor::state(window, cx)
                    .language(language)
                    .default_value(value)
            });
            let change = cx.subscribe(&editor, |this, input, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change)
                    && !this.busy()
                    && !this.immutable
                    && this.unknown.is_none()
                {
                    if let Some(field) = this.fields.get_mut(this.selected) {
                        field.value = input.read(cx).value().to_string();
                    }
                    this.validate();
                    cx.notify();
                }
            });
            // Only the current value editor is retained; dropping it clears its undo history.
            self._subscriptions.truncate(1);
            self._subscriptions.push(change);
            self.editor = Some(editor);
        }
        div()
            .id("data-value-editor")
            .test_support()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .child(crate::yaml_editor::editor(
                self.editor.as_ref().unwrap(),
                self.immutable || self.busy() || self.unknown.is_some(),
            ))
            .into_any_element()
    }
}
fn language(name: &str) -> &'static str {
    match name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "yaml" | "yml" => "yaml",
        "json" => "json",
        _ => "plaintext",
    }
}
fn fields(values: &DataValues) -> Vec<Field> {
    values
        .text
        .iter()
        .map(|(k, v)| (k, v, false))
        .chain(values.binary.iter().map(|(k, v)| (k, v, true)))
        .map(|(name, bytes, binary)| {
            let (value, base64) = if binary {
                (STANDARD.encode(bytes), true)
            } else {
                match std::str::from_utf8(bytes) {
                    Ok(s) => (s.to_string(), false),
                    Err(_) => (STANDARD.encode(bytes), true),
                }
            };
            Field {
                original: Some(name.clone()),
                name: name.clone(),
                value,
                binary,
                base64,
            }
        })
        .collect()
}
impl Render for DataEditor {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.poll(cx);
        if self.restore_focus {
            self.restore_focus = false;
            window.focus(&self.focus, cx);
        }
        if self.name.read(cx).value().as_ref()
            != self
                .fields
                .get(self.selected)
                .map(|f| f.name.as_str())
                .unwrap_or("")
        {
            self.sync_name(window, cx);
        }
        let busy = self.busy();
        let readonly = self.immutable || busy || self.unknown.is_some();
        let compact = self.compact;
        let measure = cx.weak_entity();
        let hidden = self.target.kind == DataKind::Secret && !self.revealed;
        let items: Vec<_> = self
            .fields
            .iter()
            .enumerate()
            .map(|(i, f)| {
                let baseline = if f.binary {
                    &self.baseline.binary
                } else {
                    &self.baseline.text
                };
                let dirty = f.original.as_ref() != Some(&f.name)
                    || baseline.get(&f.name) != f.bytes().ok().as_ref();
                (
                    i,
                    format!(
                        "{}{}{}",
                        f.name,
                        if f.binary { " · binary" } else { "" },
                        if dirty { " •" } else { "" }
                    ),
                )
            })
            .collect();
        let list = div()
            .flex_1()
            .min_h_0()
            .id("data-keys")
            .test_support()
            .overflow_y_scroll()
            .children(items.iter().map(|(i, label)| {
                let i = *i;
                Button::new(SharedString::from(format!("data-key:{i}")))
                    .label(label.clone())
                    .ghost()
                    .selected(i == self.selected)
                    .w_full()
                    .justify_start()
                    .rounded_none()
                    .disabled(busy)
                    .on_click(cx.listener(move |this, _, window, cx| this.choose(i, window, cx)))
            }));
        let add = if self.target.kind == DataKind::ConfigMap {
            let owner = cx.entity().downgrade();
            Button::new("add-data-field")
                .label("+ Add field")
                .w_full()
                .disabled(readonly)
                .dropdown_menu(move |menu, _, _| {
                    let text = owner.clone();
                    let binary = owner.clone();
                    menu.item(
                        PopupMenuItem::new("Text field").on_click(move |_, window, cx| {
                            let _ = text.update(cx, |this, cx| this.add(false, window, cx));
                        }),
                    )
                    .item(
                        PopupMenuItem::new("Binary field").on_click(move |_, window, cx| {
                            let _ = binary.update(cx, |this, cx| this.add(true, window, cx));
                        }),
                    )
                })
                .into_any_element()
        } else {
            Button::new("add-data-field")
                .label("+ Add field")
                .w_full()
                .disabled(readonly)
                .on_click(cx.listener(|this, _, window, cx| this.add(false, window, cx)))
                .into_any_element()
        };
        let mut add = Some(add);
        let selector_owner = cx.entity().downgrade();
        let selector = Button::new("data-key-selector")
            .label(
                self.fields
                    .get(self.selected)
                    .map(|f| f.name.clone())
                    .unwrap_or("Select key".into()),
            )
            .disabled(busy)
            .dropdown_menu(move |mut menu, _, _| {
                for (i, label) in &items {
                    let owner = selector_owner.clone();
                    let index = *i;
                    menu = menu.item(PopupMenuItem::new(label.clone()).on_click(
                        move |_, window, cx| {
                            let _ = owner.update(cx, |this, cx| this.choose(index, window, cx));
                        },
                    ));
                }
                menu
            });
        let detail = div()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .gap_2()
            .p_3()
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap_2()
                    .child(
                        div().flex_1().min_w(px(100.)).child(
                            Input::new(&self.name).disabled(readonly || self.fields.is_empty()),
                        ),
                    )
                    .child(
                        Button::new("upload-data-value")
                            .label("Upload")
                            .disabled(readonly || hidden || self.fields.is_empty())
                            .on_click(cx.listener(|this, _, window, cx| this.upload(window, cx))),
                    )
                    .when(self.target.kind == DataKind::Secret && self.revealed, |d| {
                        d.child(
                            Button::new("hide-data-value")
                                .label("Hide")
                                .on_click(cx.listener(|this, _, _, cx| this.hide(cx))),
                        )
                    }),
            )
            .when(
                self.fields.get(self.selected).is_some_and(|f| f.base64),
                |d| {
                    d.child(
                        div()
                            .text_size(px(11.))
                            .child("Binary · Base64 representation; decoded before Apply"),
                    )
                },
            )
            .when(self.target.kind == DataKind::Secret, |d| {
                d.child(
                    div()
                        .text_size(px(11.))
                        .text_color(cx.theme().muted_foreground)
                        .child("Decoded value · re-encoded as Base64 on Apply"),
                )
            })
            .child(self.value_view(window, cx));
        div()
            .track_focus(&self.focus)
            .id("resource-data-page")
            .test_support()
            .size_full()
            .min_h_0()
            .min_w_0()
            .flex()
            .flex_col()
            .on_prepaint(move |bounds, window, cx| {
                let next = bounds.size.width < px(560.);
                if next != compact {
                    let measure = measure.clone();
                    window.defer(cx, move |_, cx| {
                        let _ = measure.update(cx, |this, cx| {
                            this.compact = next;
                            cx.notify();
                        });
                    });
                }
            })
            .child(
                div()
                    .flex_shrink_0()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .px_3()
                    .py_2()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap_2()
                    .child(format!(
                        "{} keys{}",
                        self.fields.len(),
                        if self.dirty() {
                            " · Unsaved changes"
                        } else {
                            ""
                        }
                    ))
                    .child(div().flex_1())
                    .child(
                        Button::new("reset-data")
                            .label("Reset")
                            .disabled(busy || !self.dirty())
                            .on_click(cx.listener(|this, _, window, cx| this.reset(window, cx))),
                    )
                    .child(
                        Button::new("apply-data")
                            .label("Apply")
                            .primary()
                            .disabled(
                                readonly || self.blocked || !self.dirty() || !self.error.is_empty(),
                            )
                            .on_click(cx.listener(|this, _, window, cx| this.review(window, cx))),
                    ),
            )
            .when(self.immutable, |d| {
                d.child(div().px_3().py_2().child("Immutable · data is read-only"))
            })
            .when(!self.error.is_empty(), |d| {
                d.child(
                    div()
                        .id("data-validation")
                        .test_support()
                        .px_3()
                        .text_color(cx.theme().danger)
                        .child(self.error.clone()),
                )
            })
            .when(!self.status.is_empty(), |d| {
                d.child(
                    div()
                        .id("data-status")
                        .test_support()
                        .px_3()
                        .child(self.status.clone()),
                )
            })
            .when(self.unknown.is_some(), |d| {
                d.child(
                    Button::new("check-data-result")
                        .label("Check Apply result")
                        .disabled(busy)
                        .on_click(cx.listener(|this, _, _, cx| {
                            if let Some(edit) = this.unknown.clone() {
                                this.job = Some(this.backend.reconcile_data(&this.cluster, edit));
                                cx.notify();
                            }
                        })),
                )
            })
            .when(compact, |d| d.child(selector).child(add.take().unwrap()))
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .flex()
                    .when(!compact, |d| {
                        d.child(
                            div()
                                .w(px(200.))
                                .min_w(px(120.))
                                .flex_shrink_0()
                                .border_r_1()
                                .border_color(cx.theme().border)
                                .flex()
                                .flex_col()
                                .child(list)
                                .child(div().p_2().child(add.take().unwrap())),
                        )
                    })
                    .child(detail),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{AnyWindowHandle, TestAppContext, WindowOptions, size, test::TestWindowExt};
    fn object(secret: bool) -> Value {
        serde_json::json!({"kind":if secret{"Secret"}else{"ConfigMap"},"metadata":{"name":"config","namespace":"apps","uid":"id","resourceVersion":"1"},"data":if secret{serde_json::json!({"a.yaml":STANDARD.encode(b"password: private-one"),"b":STANDARD.encode([0,255,1])})}else{serde_json::json!({"a.yaml":"replicas: 1\n","b":"second"})}})
    }
    fn open(cx: &mut TestAppContext, secret: bool) -> (AnyWindowHandle, Entity<DataEditor>) {
        cx.update(|cx| {
            crate::initialize(cx);
            let object = object(secret);
            let key = if secret { "secrets" } else { "configmaps" };
            let target =
                crate::detail_page::DetailTarget::new("test".into(), key.into(), &object).unwrap();
            gpui::open_window(WindowOptions::default(), cx, |window, cx| {
                cx.new(|cx| {
                    DataEditor::new(
                        &target,
                        "Test".into(),
                        &object,
                        Backend::new(),
                        None,
                        window,
                        cx,
                    )
                    .unwrap()
                })
            })
            .unwrap()
        })
    }
    #[gpui_kit::test]
    fn secret_reveal_is_per_key_and_draft_survives_masking(cx: &mut TestAppContext) {
        let (handle, view) = open(cx, true);
        handle
            .update(cx, |_, window, cx| {
                window.render_frame(cx);
                assert!(view.read(cx).editor.is_none());
                window.click("reveal-data-value", cx);
                window.render_frame(cx);
                let editor = view.read(cx).editor.clone().unwrap();
                editor.update(cx, |input, cx| {
                    input.replace_all("password: private-edited", window, cx)
                });
            })
            .unwrap();
        cx.run_until_parked();
        handle
            .update(cx, |_, window, cx| {
                assert!(view.read(cx).dirty());
                view.update(cx, |this, cx| this.choose(1, window, cx));
                window.render_frame(cx);
                assert!(!view.read(cx).revealed);
                assert!(view.read(cx).editor.is_none());
                window.click("reveal-data-value", cx);
                window.render_frame(cx);
                assert!(view.read(cx).fields[1].base64);
                assert_eq!(view.read(cx).fields[1].bytes().unwrap(), [0, 255, 1]);
                view.update(cx, |this, cx| this.choose(0, window, cx));
                window.render_frame(cx);
                window.click("reveal-data-value", cx);
                window.render_frame(cx);
                assert!(
                    view.read(cx)
                        .editor
                        .as_ref()
                        .unwrap()
                        .read(cx)
                        .value()
                        .contains("private-edited")
                );
                view.update(cx, |this, cx| this.hide(cx));
                assert!(view.read(cx).editor.is_none());
                assert!(view.read(cx).dirty());
            })
            .unwrap();
    }
    #[gpui_kit::test]
    fn configmap_draft_add_rename_validation_and_reset_cancel(cx: &mut TestAppContext) {
        let (handle, view) = open(cx, false);
        handle
            .update(cx, |_, window, cx| {
                window.render_frame(cx);
                view.update(cx, |this, cx| this.add(false, window, cx));
                window.render_frame(cx);
                let name = view.read(cx).name.clone();
                name.update(cx, |input, cx| input.replace_all("a.yaml", window, cx));
            })
            .unwrap();
        cx.run_until_parked();
        handle
            .update(cx, |_, window, cx| {
                assert!(!view.read(cx).error.is_empty());
                let name = view.read(cx).name.clone();
                name.update(cx, |input, cx| input.replace_all("new.json", window, cx));
            })
            .unwrap();
        cx.run_until_parked();
        handle
            .update(cx, |_, window, cx| {
                window.render_frame(cx);
                assert!(view.read(cx).error.is_empty());
                let editor = view.read(cx).editor.clone().unwrap();
                editor.update(cx, |input, cx| input.replace_all("{}", window, cx));
            })
            .unwrap();
        cx.run_until_parked();
        handle
            .update(cx, |_, window, cx| {
                assert_eq!(view.read(cx).fields.len(), 3);
                assert!(view.read(cx).dirty());
                view.update(cx, |this, cx| this.reset(window, cx));
                window.render_frame(cx);
                window.click("confirm-cancel", cx);
            })
            .unwrap();
        cx.run_until_parked();
        handle
            .update(cx, |_, window, cx| {
                assert!(view.read(cx).dirty());
                view.update(cx, |this, cx| this.reset(window, cx));
                window.render_frame(cx);
                window.click("confirm-accept", cx);
            })
            .unwrap();
        cx.run_until_parked();
        cx.update(|cx| {
            assert!(!view.read(cx).dirty());
            assert_eq!(view.read(cx).fields.len(), 2);
        });
    }
    #[gpui_kit::test]
    fn data_editor_toolbar_and_selector_fit_theme_size_matrix(cx: &mut TestAppContext) {
        let (handle, view) = open(cx, false);
        for dimensions in [
            size(px(1440.), px(900.)),
            size(px(1024.), px(680.)),
            size(px(420.), px(680.)),
        ] {
            cx.simulate_window_resize(handle, dimensions);
            for mode in [
                pintle_gpui_kit::theme::ThemeMode::Light,
                pintle_gpui_kit::theme::ThemeMode::Dark,
            ] {
                cx.update(|cx| pintle_gpui_kit::theme::set_mode(mode, cx));
                handle
                    .update(cx, |_, window, cx| {
                        window.render_frame(cx);
                    })
                    .unwrap();
                cx.run_until_parked();
                handle
                    .update(cx, |_, window, cx| {
                        window.render_frame(cx);
                        let bounds = window.find("resource-data-page").bounds();
                        assert!(bounds.size.width <= dimensions.width);
                        assert!(window.find("apply-data").bounds().bottom() < bounds.bottom());
                        if view.read(cx).compact {
                            assert!(!window.find_all("data-key-selector").is_empty());
                        }
                    })
                    .unwrap();
            }
        }
    }
    #[gpui_kit::test]
    fn apply_cancel_then_confirm_masks_values_and_records_only_metadata(cx: &mut TestAppContext) {
        use futures::FutureExt;
        use std::sync::atomic::{AtomicUsize, Ordering};
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let backend = crate::backend::tests::mock_backend(move |request| {
            let mut value = object(true);
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
                value["data"] = patch[2]["value"].clone();
                value["metadata"]["resourceVersion"] = serde_json::json!("2");
            }
            (200, value.to_string())
        });
        let (handle, view) = open(cx, true);
        handle
            .update(cx, |_, window, cx| {
                let panel = cx.new(|_| PanelState::default());
                view.update(cx, |this, cx| {
                    this.backend = backend;
                    this.panel = Some(panel);
                    this.fields[0].value = "private-updated".into();
                    this.review(window, cx);
                });
                window.render_frame(cx);
                window.click("confirm-cancel", cx);
            })
            .unwrap();
        cx.run_until_parked();
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        handle
            .update(cx, |_, window, cx| {
                view.update(cx, |this, cx| {
                    assert!(this.dirty());
                    this.review(window, cx);
                });
                window.render_frame(cx);
                window.click("confirm-accept", cx);
            })
            .unwrap();
        cx.run_until_parked();
        let started = std::time::Instant::now();
        loop {
            let done = cx.update(|cx| {
                view.update(cx, |this, cx| {
                    this.poll(cx);
                    !this.busy()
                })
            });
            if done {
                break;
            }
            assert!(started.elapsed() < std::time::Duration::from_secs(3));
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        cx.update(|cx| {
            let data = view.read(cx);
            assert!(!data.dirty());
            assert!(!data.revealed);
            assert!(data.editor.is_none());
            assert_eq!(calls.load(Ordering::SeqCst), 1);
            let output = &data.panel.as_ref().unwrap().read(cx).output;
            assert!(!output.is_empty());
            assert!(output.iter().all(|line| !line.contains("private")));
        });
    }
    #[gpui_kit::test]
    fn binary_upload_external_conflicts_and_independent_drafts(cx: &mut TestAppContext) {
        let (handle, first) = open(cx, false);
        let (_, second) = open(cx, false);
        handle
            .update(cx, |_, window, cx| {
                first.update(cx, |data, cx| {
                    assert!(data.store_upload(0, vec![0, 255]).is_err());
                    data.add(true, window, cx);
                    let selected = data.selected;
                    data.store_upload(selected, vec![0, 255, 1]).unwrap();
                    assert_eq!(data.fields[selected].bytes().unwrap(), [0, 255, 1]);
                    let mut newer = object(false);
                    newer["metadata"]["resourceVersion"] = serde_json::json!("2");
                    data.accept_external(&newer, cx);
                    assert!(data.blocked);
                    assert!(data.dirty());
                });
                assert!(!second.read(cx).dirty());
                assert_eq!(second.read(cx).fields.len(), 2);
            })
            .unwrap();
    }
}
