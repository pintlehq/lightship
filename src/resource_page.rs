use crate::backend::{Backend, Job, Snapshot, presentation};
use crate::catalog::{self, Resource, Row};
use gpui::base::ElementExt;
use gpui::component::{
    ActiveTheme, Disableable, IconName, Sizable, WindowExt,
    button::{Button, ButtonVariants},
    checkbox::Checkbox,
    input::{Input, InputEvent, InputState},
    menu::{DropdownMenu, PopupMenuItem},
    table::{Column, ColumnSort, TableDelegate, TableState},
};
use gpui::{prelude::*, *};
use pintle_gpui_kit::{
    components::resource_table::{FloatingActionBar, ResourceListHeader, ResourceTable},
    kit as gpui,
    shell::workspace::Document,
};
use std::collections::HashSet;
use std::{sync::Arc, time::Duration};

pub use crate::inspector::{Inspect, PanelState};
#[derive(Clone)]
pub struct Rows {
    pub cluster: String,
    pub resource: Resource,
    pub rows: Vec<Row>,
    pub visible: Vec<usize>,
    pub query: String,
    pub namespace: Option<String>,
    pub selected: HashSet<String>,
    pub sort: Option<(usize, ColumnSort)>,
    pub(crate) panel: Entity<PanelState>,
    pub key: String,
    pub objects: std::collections::HashMap<String, serde_json::Value>,
    pub status: String,
}
impl Rows {
    pub fn new(
        cluster: String,
        resource: Resource,
        panel: Entity<PanelState>,
        key: String,
    ) -> Self {
        let rows = Vec::new();
        let mut result = Self {
            cluster,
            resource,
            rows,
            visible: vec![],
            query: String::new(),
            namespace: None,
            selected: HashSet::new(),
            sort: None,
            panel,
            key,
            objects: Default::default(),
            status: "Loading…".into(),
        };
        result.rebuild();
        result
    }
    pub fn rebuild(&mut self) {
        let query = self.query.trim().to_lowercase();
        self.visible = self
            .rows
            .iter()
            .enumerate()
            .filter(|(_, row)| {
                self.namespace
                    .as_ref()
                    .is_none_or(|ns| row.namespace.as_ref() == Some(ns))
                    && (query.is_empty()
                        || row
                            .cells
                            .iter()
                            .any(|c| c.text.to_lowercase().contains(&query)))
            })
            .map(|(i, _)| i)
            .collect();
        if let Some((column, direction)) = self.sort
            && direction != ColumnSort::Default
        {
            self.visible.sort_by(|a, b| {
                let a = &self.rows[*a].cells[column];
                let b = &self.rows[*b].cells[column];
                let order = match (a.number, b.number) {
                    (Some(a), Some(b)) => a.cmp(&b),
                    _ => a.text.to_lowercase().cmp(&b.text.to_lowercase()),
                };
                if direction == ColumnSort::Descending {
                    order.reverse()
                } else {
                    order
                }
            });
        }
    }
    pub fn hidden_selected_count(&self) -> usize {
        self.selected.len()
            - self
                .visible
                .iter()
                .filter(|i| self.selected.contains(&self.rows[**i].id))
                .count()
    }
    pub fn selection_state(&self) -> (bool, bool) {
        let count = self
            .visible
            .iter()
            .filter(|i| self.selected.contains(&self.rows[**i].id))
            .count();
        (
            count > 0 && count == self.visible.len(),
            count > 0 && count < self.visible.len(),
        )
    }
    pub fn select_visible(&mut self, checked: bool) {
        for index in &self.visible {
            let id = self.rows[*index].id.clone();
            if checked {
                self.selected.insert(id);
            } else {
                self.selected.remove(&id);
            }
        }
    }
    pub fn replace(&mut self, snapshot: Snapshot) {
        self.status = snapshot.status;
        self.objects.clear();
        self.rows = snapshot
            .objects
            .into_iter()
            .map(|object| {
                let row = presentation::row(&self.cluster, self.resource, &object);
                self.objects.insert(row.id.clone(), object);
                row
            })
            .collect();
        self.selected.retain(|id| self.objects.contains_key(id));
        self.rebuild();
    }
}
impl TableDelegate for Rows {
    fn rows_count(&self, _: &App) -> usize {
        self.visible.len()
    }
    fn columns_count(&self, _: &App) -> usize {
        self.resource.columns().len() + 2
    }
    fn column(&self, col: usize, _: &App) -> Column {
        if col == 0 {
            return Column::new("select", "")
                .width(px(if self.resource.key == "overview" {
                    0.
                } else {
                    44.
                }))
                .resizable(false)
                .movable(false);
        }
        let columns = self.resource.columns();
        if col > columns.len() {
            return Column::new("actions", "")
                .width(px(40.))
                .resizable(false)
                .movable(false);
        }
        let label = columns[col - 1];
        let column = Column::new(label, label.to_uppercase())
            .width(px(if col == 1 {
                270.
            } else if label == "Namespace" {
                150.
            } else {
                125.
            }))
            .min_width(px(70.))
            .movable(false)
            .sort(
                self.sort
                    .filter(|(index, _)| *index == col - 1)
                    .map_or(ColumnSort::Default, |(_, direction)| direction),
            );
        if matches!(
            label,
            "Up-to-date" | "Available" | "Replicas" | "Count" | "Restarts"
        ) {
            column.text_right()
        } else {
            column
        }
    }
    fn perform_sort(
        &mut self,
        col: usize,
        sort: ColumnSort,
        _: &mut Window,
        _: &mut Context<TableState<Self>>,
    ) {
        if col > 0 && col <= self.resource.columns().len() {
            self.sort = Some((col - 1, sort));
            self.rebuild();
        }
    }
    fn render_th(
        &mut self,
        col: usize,
        _: &mut Window,
        cx: &mut Context<TableState<Self>>,
    ) -> impl IntoElement {
        if col == 0 {
            if self.resource.key == "overview" {
                return div().into_any_element();
            }
            let (all, mixed) = self.selection_state();
            let owner = cx.weak_entity();
            return gpui::base::Checkbox::new("select-visible")
                .accessibility_label("Select visible rows")
                .checked(all)
                .indeterminate(mixed)
                .size(px(28.))
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .size(rems(1.125))
                        .flex_shrink_0()
                        .border_1()
                        .border_color(cx.theme().input)
                        .rounded(px(4.))
                        .text_size(px(14.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(if mixed {
                            "−"
                        } else if all {
                            "✓"
                        } else {
                            ""
                        }),
                )
                .on_change(move |state, _, _, cx| {
                    cx.stop_propagation();
                    let _ = owner.update(cx, |table, cx| {
                        table
                            .delegate_mut()
                            .select_visible(state == gpui::base::CheckboxState::Checked);
                        cx.notify();
                    });
                })
                .into_any_element();
        }
        div()
            .text_size(px(11.))
            .child(self.column(col, cx).name)
            .into_any_element()
    }
    fn render_tr(
        &mut self,
        row: usize,
        _: &mut Window,
        cx: &mut Context<TableState<Self>>,
    ) -> Stateful<Div> {
        let selected = self
            .visible
            .get(row)
            .is_some_and(|i| self.selected.contains(&self.rows[*i].id));
        div()
            .id(("resource-row", row))
            .when(selected, |row| row.bg(cx.theme().accent))
    }
    fn render_td(
        &mut self,
        row: usize,
        col: usize,
        _: &mut Window,
        cx: &mut Context<TableState<Self>>,
    ) -> impl IntoElement {
        let record = self.rows[self.visible[row]].clone();
        if col == 0 {
            if self.resource.key == "overview" {
                return div().into_any_element();
            }
            let id = record.id.clone();
            let owner = cx.weak_entity();
            return div()
                .h_full()
                .flex()
                .items_center()
                .child(
                    Checkbox::new(SharedString::from(format!("select:{id}")))
                        .large()
                        .size(px(28.))
                        .items_center()
                        .justify_center()
                        .checked(self.selected.contains(&id))
                        .accessibility_label(format!("Select {}", record.name))
                        .on_change(move |checked, _, cx| {
                            cx.stop_propagation();
                            let _ = owner.update(cx, |table, cx| {
                                let rows = table.delegate_mut();
                                if *checked {
                                    rows.selected.insert(id.clone());
                                } else {
                                    rows.selected.remove(&id);
                                }
                                cx.notify();
                            });
                        }),
                )
                .into_any_element();
        }
        if col > record.cells.len() {
            let panel = self.panel.clone();
            let cluster = self.cluster.clone();
            let key = self.key.clone();
            let object = self.objects.get(&record.id).cloned();
            return div()
                .h_full()
                .flex()
                .items_center()
                .child(
                    Button::new(SharedString::from(format!("actions:{}", record.id)))
                        .label("···")
                        .ghost()
                        .xsmall()
                        .accessibility_label(format!("Actions for {}", record.name))
                        .dropdown_menu(move |menu, _, _| {
                            let panel = panel.clone();
                            let cluster = cluster.clone();
                            let object = object.clone();
                            let key = key.clone();
                            let name = record.name.clone();
                            menu.item(PopupMenuItem::new("View details").on_click(
                                move |_, _, cx| {
                                    panel.update(cx, |panel, cx| {
                                        if let Some(object) = &object {
                                            panel.inspect(
                                                cluster.clone(),
                                                key.clone(),
                                                object.clone(),
                                                cx,
                                            );
                                        }
                                    });
                                },
                            ))
                            .item(
                                PopupMenuItem::new("Copy name").on_click(move |_, _, cx| {
                                    cx.write_to_clipboard(ClipboardItem::new_string(name.clone()))
                                }),
                            )
                        }),
                )
                .into_any_element();
        }
        let panel = self.panel.clone();
        let cluster = self.cluster.clone();
        let key = self.key.clone();
        let object = self.objects.get(&record.id).cloned();
        div()
            .id(SharedString::from(format!(
                "resource-cell:{}:{col}",
                record.id
            )))
            .test_support()
            .on_click(move |_, _, cx| {
                if let Some(object) = &object {
                    panel.update(cx, |panel, cx| {
                        panel.inspect(cluster.clone(), key.clone(), object.clone(), cx)
                    });
                }
            })
            .h_full()
            .flex()
            .items_center()
            .when(
                matches!(
                    self.resource.columns()[col - 1],
                    "Up-to-date" | "Available" | "Replicas" | "Count" | "Restarts"
                ),
                |cell| cell.justify_end(),
            )
            .w_full()
            .min_w_0()
            .overflow_hidden()
            .text_ellipsis()
            .whitespace_nowrap()
            .text_color(if col == 1 {
                cx.theme().foreground
            } else {
                cx.theme().muted_foreground
            })
            .child(record.cells[col - 1].text.clone())
            .into_any_element()
    }
    fn cell_label(&self, row: usize, col: usize, _: &App) -> Option<SharedString> {
        self.rows
            .get(*self.visible.get(row)?)
            .and_then(|r| col.checked_sub(1).and_then(|i| r.cells.get(i)))
            .map(|c| c.text.clone().into())
    }
    fn render_empty(
        &mut self,
        _: &mut Window,
        _: &mut Context<TableState<Self>>,
    ) -> impl IntoElement {
        div()
            .id("no-results")
            .aria_label("No matching resources")
            .test_support()
            .p_6()
            .child(
                if self.status.starts_with("Loading")
                    || self.status.contains("Forbidden")
                    || self.status.contains("Disconnected")
                    || self.status.contains("unavailable")
                {
                    self.status.clone()
                } else {
                    "No matching resources".into()
                },
            )
    }
}
pub struct ResourcePage {
    pub table: Entity<TableState<Rows>>,
    pub filter: Entity<InputState>,
    pub compact_actions: bool,
    action_focus: [FocusHandle; 5],
    backend: Arc<Backend>,
    job: Job<Snapshot>,
    title: String,
    seen_data_revision: u64,
    seen_mutation_revision: u64,
    restart_prepare: Option<Job<crate::backend::mutation::Prepared>>,
    restart_ready: Option<crate::backend::mutation::Prepared>,
    restart_job: Option<Job<crate::backend::mutation::BatchReport>>,
    restart_report: Option<crate::backend::mutation::BatchReport>,
    restart_confirming: bool,
    restart_task: Option<Task<()>>,
    restart_status: String,
    _poll: Task<()>,
    _subscriptions: Vec<Subscription>,
}
impl ResourcePage {
    pub fn new(
        document: &Document,
        panel: Entity<PanelState>,
        backend: Arc<Backend>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let (cluster, mut resource) = catalog::resolve(document);
        let key = document.key.0.split_once('/').unwrap().1.to_owned();
        if resource.key == "custom" {
            resource.namespaced = backend.spec(&cluster, &key).namespaced;
        }
        let job = backend.resources(cluster.clone(), key.clone());
        let title = format!("{} / {}", document.context, document.title);
        let table = cx.new(|cx| {
            TableState::new(Rows::new(cluster, resource, panel, key), window, cx)
                .row_selectable(true)
                .col_selectable(false)
        });
        let filter = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(format!("Filter {}…", resource.title.to_lowercase()))
        });
        let changed = cx.subscribe(&filter, |this, input, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                let query = input.read(cx).value().to_string();
                this.table.update(cx, |table, cx| {
                    table.delegate_mut().query = query;
                    table.delegate_mut().rebuild();
                    cx.notify();
                });
            }
        });
        let observe = cx.observe(&table, |_, _, cx| cx.notify());
        let timer = cx.background_executor().clone();
        let poll = cx.spawn(async move |entity, cx| {
            loop {
                timer.timer(Duration::from_millis(100)).await;
                if entity
                    .update(cx, |this, cx| {
                        this.poll_restart(cx);
                        let cluster = this.table.read(cx).delegate().cluster.clone();
                        let mutation_revision = this.backend.mutation_revision(&cluster);
                        if this.seen_mutation_revision != mutation_revision {
                            this.seen_mutation_revision = mutation_revision;
                            this.refresh(cx);
                        }
                        let (revision, updates) =
                            this.backend.data_updates(this.seen_data_revision);
                        this.seen_data_revision = revision;
                        if !updates.is_empty() {
                            this.table.update(cx, |table, cx| {
                                let rows = table.delegate_mut();
                                let mut changed = false;
                                for update in updates {
                                    if update.connection != rows.cluster {
                                        continue;
                                    }
                                    if let Some(object) = rows.objects.values_mut().find(|o| {
                                        o["metadata"]["uid"] == update.object["metadata"]["uid"]
                                            && (o["metadata"]["resourceVersion"]
                                                == update.before_version
                                                || o["metadata"]["resourceVersion"]
                                                    == update.object["metadata"]["resourceVersion"])
                                    }) {
                                        *object = update.object;
                                        changed = true;
                                    }
                                }
                                if changed {
                                    let objects = rows
                                        .rows
                                        .iter()
                                        .filter_map(|row| rows.objects.get(&row.id).cloned())
                                        .collect();
                                    let status = rows.status.clone();
                                    rows.replace(Snapshot { objects, status });
                                    cx.notify();
                                }
                            });
                        }
                        if let Some(result) = this.job.take() {
                            this.table.update(cx, |table, cx| {
                                let rows = table.delegate_mut();
                                match result {
                                    Ok(mut snapshot) => {
                                        this.backend
                                            .overlay_data(&rows.cluster, &mut snapshot.objects);
                                        rows.replace(snapshot);
                                    }
                                    Err(e) => {
                                        rows.status = if rows.rows.is_empty() {
                                            e
                                        } else {
                                            format!("Stale data · {e}")
                                        }
                                    }
                                }
                                cx.notify();
                            });
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        Self {
            table,
            filter,
            compact_actions: false,
            seen_data_revision: 0,
            seen_mutation_revision: 0,
            restart_prepare: None,
            restart_ready: None,
            restart_job: None,
            restart_report: None,
            restart_confirming: false,
            restart_task: None,
            restart_status: String::new(),
            action_focus: std::array::from_fn(|_| cx.focus_handle()),
            backend,
            job,
            title,
            _poll: poll,
            _subscriptions: vec![changed, observe],
        }
    }
    pub fn rename(&mut self, document: &Document, cx: &mut Context<Self>) {
        let title = format!("{} / {}", document.context, document.title);
        if self.title != title {
            self.title = title;
            cx.notify();
        }
    }
    pub fn clear_selection(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.table.update(cx, |table, cx| {
            table.delegate_mut().selected.clear();
            cx.notify();
        });
        self.table.focus_handle(cx).focus(window, cx);
    }
    fn restart_busy(&self) -> bool {
        self.restart_prepare.is_some() || self.restart_confirming || self.restart_job.is_some()
    }
    pub fn permit_close(&self, _: &mut Window, _: &mut App) -> Task<bool> {
        Task::ready(!self.restart_busy())
    }
    fn restart(&mut self, cx: &mut Context<Self>) {
        if self.restart_busy()
            || self
                .restart_report
                .as_ref()
                .is_some_and(|r| r.check.is_some())
        {
            return;
        }
        let rows = self.table.read(cx).delegate();
        let objects = rows
            .rows
            .iter()
            .filter(|row| rows.selected.contains(&row.id))
            .filter_map(|row| rows.objects.get(&row.id).cloned())
            .collect();
        self.restart_prepare = Some(self.backend.prepare_restart(
            &rows.cluster,
            &rows.key,
            objects,
        ));
        self.restart_report = None;
        self.restart_status = "Reviewing selected targets · no writes sent".into();
        cx.notify();
    }
    fn poll_restart(&mut self, cx: &mut Context<Self>) {
        if let Some(result) = self.restart_prepare.as_mut().and_then(Job::take) {
            self.restart_prepare = None;
            match result {
                Ok(plan) => {
                    self.restart_ready = Some(plan);
                    self.restart_confirming = true;
                }
                Err(e) => self.restart_status = e,
            }
            cx.notify();
        }
        if let Some(result) = self.restart_job.as_mut().and_then(Job::take) {
            self.restart_job = None;
            match result {
                Ok(mut report) => {
                    if let Some(old) = self.restart_report.take() {
                        for item in old.items {
                            if !report.items.iter().any(|r| r.target == item.target) {
                                report.items.push(item);
                            }
                        }
                    }
                    self.restart_status = report.text();
                    self.table.update(cx, |table, cx| {
                        let rows = table.delegate_mut();
                        for item in &report.items {
                            if item.outcome == crate::backend::mutation::Outcome::Succeeded {
                                let ids: Vec<_> = rows
                                    .objects
                                    .iter()
                                    .filter(|(_, o)| {
                                        o["metadata"]["uid"].as_str() == item.uid.as_deref()
                                    })
                                    .map(|(id, _)| id.clone())
                                    .collect();
                                for id in ids {
                                    rows.selected.remove(&id);
                                }
                            }
                        }
                        cx.notify();
                    });
                    self.restart_report = Some(report);
                }
                Err(e) => self.restart_status = e,
            }
            let panel = self.table.read(cx).delegate().panel.clone();
            let message = format!("Bulk restart · {} · {}", self.title, self.restart_status);
            panel.update(cx, |panel, cx| panel.record(message, cx));
            self.refresh(cx);
            cx.notify();
        }
    }
    fn confirm_restart(
        &mut self,
        plan: crate::backend::mutation::Prepared,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let answer = crate::confirm::ask(
            "Restart selected resources?",
            plan.review(&self.title),
            "Restart",
            window,
            cx,
        );
        self.restart_task = Some(cx.spawn_in(window, async move |owner, cx| {
            let accepted = answer.await;
            let _ = owner.update(cx, |this, cx| {
                this.restart_confirming = false;
                if accepted {
                    this.restart_job = Some(this.backend.execute_mutation(plan));
                    this.restart_status = "Requesting restart…".into();
                } else {
                    this.restart_status = "Cancelled · no writes sent".into();
                }
                cx.notify();
            });
        }));
    }
    fn bulk_bar(&self, cx: &Context<Self>) -> impl IntoElement {
        let rows = self.table.read(cx).delegate();
        let count = rows.selected.len();
        let hidden = rows.hidden_selected_count();

        let summary = format!(
            "{count} selected{}",
            if hidden > 0 {
                format!(" · {hidden} hidden by filters")
            } else {
                String::new()
            }
        );
        FloatingActionBar::new(
            div()
                .id("bulk-selection-summary")
                .test_support()
                .aria_label(summary)
                .flex()
                .flex_col()
                .min_w_0()
                .text_size(px(12.))
                .child(div().truncate().child(format!("{count} selected")))
                .when(hidden > 0, |d| {
                    d.child(
                        div()
                            .truncate()
                            .text_size(px(10.))
                            .text_color(cx.theme().muted_foreground)
                            .child(format!("{hidden} hidden by filters")),
                    )
                }),
            div()
                .flex()
                .min_w_0()
                .items_center()
                .gap_1()
                .when(
                    matches!(
                        rows.key.as_str(),
                        "deployments" | "statefulsets" | "daemonsets" | "pods"
                    ),
                    |d| {
                        d.child(
                            Button::new("bulk-restart")
                                .label("Restart")
                                .small()
                                .ghost()
                                .track_focus(&self.action_focus[1])
                                .disabled(
                                    self.restart_busy()
                                        || self
                                            .restart_report
                                            .as_ref()
                                            .is_some_and(|r| r.check.is_some()),
                                )
                                .on_click(cx.listener(|this, _, _, cx| this.restart(cx))),
                        )
                    },
                )
                .child(
                    Button::new("bulk-copy-names")
                        .label(if self.compact_actions {
                            ""
                        } else {
                            "Copy names"
                        })
                        .when(self.compact_actions, |button| button.icon(IconName::Copy))
                        .accessibility_label("Copy names")
                        .tooltip("Copy names")
                        .small()
                        .ghost()
                        .track_focus(&self.action_focus[0])
                        .on_click(cx.listener(|page, _, _, cx| {
                            let rows = page.table.read(cx).delegate();
                            let names = rows
                                .rows
                                .iter()
                                .filter(|r| rows.selected.contains(&r.id))
                                .map(|r| r.name.clone())
                                .collect::<Vec<_>>()
                                .join("\n");
                            cx.write_to_clipboard(ClipboardItem::new_string(names));
                        })),
                ),
            Button::new("bulk-clear")
                .icon(IconName::Close)
                .small()
                .ghost()
                .track_focus(&self.action_focus[4])
                .accessibility_label("Clear selection")
                .on_click(cx.listener(|page, _, window, cx| page.clear_selection(window, cx))),
        )
    }
    pub fn set_namespace(&mut self, namespace: Option<String>, cx: &mut Context<Self>) {
        self.table.update(cx, |table, cx| {
            table.delegate_mut().namespace = namespace;
            table.delegate_mut().rebuild();
            cx.notify();
        });
    }
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        let rows = self.table.read(cx).delegate();
        self.job = self
            .backend
            .resources(rows.cluster.clone(), rows.key.clone());
        let panel = rows.panel.clone();
        panel.update(cx, |panel, cx| {
            panel.record(format!("Refresh requested · {}", self.title), cx)
        });
        self.table.update(cx, |table, cx| {
            table.delegate_mut().status = "Loading…".into();
            cx.notify();
        });
    }
}
impl Focusable for ResourcePage {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.table.focus_handle(cx)
    }
}
impl Render for ResourcePage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(plan) = self.restart_ready.take() {
            let owner = cx.entity();
            window.defer(cx, move |window, cx| {
                owner.update(cx, |this, cx| this.confirm_restart(plan, window, cx))
            });
        }
        let rows = self.table.read(cx).delegate();
        let resource = rows.resource;
        let title = self.title.clone();
        let summary = if rows.status.starts_with("Connected") {
            "Watching"
        } else if rows.status.starts_with("Read-only") {
            "Read-only"
        } else if rows.status.starts_with("Watch unavailable") {
            "Polling"
        } else if rows.status.starts_with("Loading") {
            "Loading…"
        } else {
            "Unavailable / stale"
        };
        let status = rows.status.clone();
        let failed = !rows.status.starts_with("Connected")
            && !rows.status.starts_with("Read-only")
            && !rows.status.starts_with("Watch unavailable")
            && !rows.status.starts_with("Loading");
        let count = format!("{} items · {summary}", rows.visible.len());
        let namespace = rows.namespace.as_deref().unwrap_or("all").to_owned();
        let selected = !rows.selected.is_empty() && resource.key != "overview";
        let measure = cx.weak_entity();
        let compact = self.compact_actions;
        let owner = cx.weak_entity();
        let filter = Input::new(&self.filter)
            .id("table-filter")
            .aria_label("Filter resources")
            .prefix(gpui::component::Icon::new(IconName::Search).size(px(14.)))
            .small()
            .map(|input| gpui::Styled::h(input, px(32.)));
        let mut available: Vec<_> = rows
            .rows
            .iter()
            .filter_map(|r| r.namespace.clone())
            .collect();
        available.sort();
        available.dedup();
        let namespaces = Button::new("namespace-filter")
            .icon(gpui::assets::IconName::Funnel)
            .label(format!("Namespace: {namespace}"))
            .small()
            .h(px(32.))
            .dropdown_menu(move |mut menu, _, _| {
                for namespace in [None]
                    .into_iter()
                    .chain(available.clone().into_iter().map(Some))
                {
                    let owner = owner.clone();
                    menu = menu.item(
                        PopupMenuItem::new(namespace.clone().unwrap_or_else(|| "all".into()))
                            .on_click(move |_, _, cx| {
                                let _ = owner.update(cx, |page, cx| {
                                    page.set_namespace(namespace.clone(), cx)
                                });
                            }),
                    );
                }
                menu
            });
        let refresh = Button::new("refresh-resources")
            .icon(IconName::RefreshCw)
            .small()
            .h(px(32.))
            .accessibility_label("Refresh resources")
            .on_click(cx.listener(|this, _, _, cx| this.refresh(cx)));
        let apply = Button::new("apply-yaml")
            .label(if compact {
                "Apply YAML"
            } else {
                "Apply YAML…"
            })
            .small()
            .h(px(32.))
            .on_click(cx.listener(|this, _, _, cx| {
                let rows = this.table.read(cx).delegate();
                let (panel, cluster, namespace) = (
                    rows.panel.clone(),
                    rows.cluster.clone(),
                    rows.namespace.clone(),
                );
                panel.update(cx, |panel, cx| {
                    panel.inspect(
                        cluster,
                        "apply-yaml".into(),
                        serde_json::json!({"metadata":{"namespace":namespace}}),
                        cx,
                    )
                });
            }));
        let toolbar = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap_2()
            .min_w_0()
            .child(div().flex_1().min_w(px(90.)).child(filter))
            .when(resource.namespaced, |toolbar| toolbar.child(namespaces))
            .child(apply)
            .child(refresh);
        div()
            .id(("resource-page", cx.entity_id()))
            .test_support()
            .on_prepaint(move |bounds, window, cx| {
                let next = bounds.size.width < px(560.);
                if next != compact {
                    let measure = measure.clone();
                    window.defer(cx, move |_, cx| {
                        let _ = measure.update(cx, |page, cx| {
                            page.compact_actions = next;
                            cx.notify();
                        });
                    });
                }
            })
            .on_key_down(cx.listener(|page, event: &KeyDownEvent, window, cx| {
                if event.keystroke.key == "enter"
                    && !window.has_active_dialog(cx)
                    && page.table.focus_handle(cx).contains_focused(window, cx)
                {
                    let table = page.table.read(cx);
                    let rows = table.delegate();
                    if let Some(index) = table.selected_row().and_then(|row| rows.visible.get(row))
                        && let Some(object) = rows.objects.get(&rows.rows[*index].id)
                    {
                        let (panel, cluster, key, object) = (
                            rows.panel.clone(),
                            rows.cluster.clone(),
                            rows.key.clone(),
                            object.clone(),
                        );
                        panel.update(cx, |panel, cx| panel.inspect(cluster, key, object, cx));
                        cx.stop_propagation();
                    }
                }
                if event.keystroke.key == "escape"
                    && !window.has_active_dialog(cx)
                    && (page.table.focus_handle(cx).contains_focused(window, cx)
                        || page
                            .action_focus
                            .iter()
                            .any(|focus| focus.is_focused(window)))
                    && !page.table.read(cx).delegate().selected.is_empty()
                {
                    page.clear_selection(window, cx);
                    cx.stop_propagation();
                }
            }))
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .p_4()
            .gap_3()
            .font_family(cx.theme().mono_font_family.clone())
            .text_size(px(13.))
            .child(ResourceListHeader::new(
                div()
                    .id("resource-title")
                    .aria_label(title.clone())
                    .test_support()
                    .font_weight(FontWeight::SEMIBOLD)
                    .truncate()
                    .child(title),
                div()
                    .id("resource-count")
                    .aria_label(count.clone())
                    .test_support()
                    .text_size(px(11.))
                    .text_color(cx.theme().success)
                    .child(count),
                toolbar,
            ))
            .when(!self.restart_status.is_empty(), |d| {
                d.child(
                    div()
                        .id("bulk-restart-status")
                        .test_support()
                        .max_h(px(130.))
                        .overflow_y_scroll()
                        .text_size(px(12.))
                        .child(self.restart_status.clone())
                        .when(
                            self.restart_report
                                .as_ref()
                                .is_some_and(|r| r.check.is_some()),
                            |d| {
                                d.child(
                                    Button::new("check-restart-result")
                                        .label("Check result")
                                        .small()
                                        .disabled(self.restart_busy())
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            if let Some(plan) = this
                                                .restart_report
                                                .as_ref()
                                                .and_then(|r| r.check.clone())
                                            {
                                                this.restart_job =
                                                    Some(this.backend.check_mutation(plan));
                                                cx.notify();
                                            }
                                        })),
                                )
                            },
                        ),
                )
            })
            .when(failed, |d| {
                d.child(
                    div()
                        .text_color(cx.theme().danger)
                        .text_size(px(12.))
                        .child(status),
                )
            })
            .child(
                div().flex_1().min_h_0().min_w_0().child(
                    ResourceTable::new(&self.table)
                        .when(selected, |table| table.floating_actions(self.bulk_bar(cx))),
                ),
            )
    }
}

#[cfg(test)]
mod mutation_tests {
    use super::*;
    use crate::backend::tests::{await_result, mock_backend};
    use core::prelude::v1::test;
    use gpui::{AnyWindowHandle, TestAppContext, size, test::TestWindowExt};
    use serde_json::{Value, json};
    use std::sync::atomic::{AtomicUsize, Ordering};
    fn objects() -> Vec<Value> {
        ["api","worker"].iter().map(|name| json!({"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":name,"namespace":"apps","uid":format!("uid-{name}"),"resourceVersion":"1"},"spec":{"template":{"metadata":{"annotations":{}}}}})).collect()
    }
    fn open(cx: &mut TestAppContext) -> (AnyWindowHandle, Entity<ResourcePage>, Arc<AtomicUsize>) {
        let writes = Arc::new(AtomicUsize::new(0));
        let count = writes.clone();
        let backend = mock_backend(move |r| {
            if r.method() != http::Method::GET {
                count.fetch_add(1, Ordering::SeqCst);
                if r.uri().path().ends_with("/worker") {
                    return (
                        403,
                        json!({"kind":"Status","apiVersion":"v1","status":"Failure","code":403})
                            .to_string(),
                    );
                }
                return (200, objects()[0].to_string());
            }
            if let Some(object) = objects().into_iter().find(|o| {
                r.uri()
                    .path()
                    .ends_with(&format!("/{}", o["metadata"]["name"].as_str().unwrap()))
            }) {
                return (200, object.to_string());
            }
            (200,json!({"apiVersion":"apps/v1","kind":"DeploymentList","metadata":{"resourceVersion":"1"},"items":objects()}).to_string())
        });
        let (handle, page) = cx.update(|cx| {
            crate::initialize(cx);
            let panel = cx.new(|_| PanelState::default());
            let document = Document::new("test/deployments", "Deployments", "Test");
            gpui::open_window(gpui::WindowOptions::default(), cx, |window, cx| {
                cx.new(|cx| ResourcePage::new(&document, panel, backend, window, cx))
            })
            .unwrap()
        });
        handle
            .update(cx, |_, _, cx| {
                page.read(cx).table.clone().update(cx, |table, cx| {
                    let rows = table.delegate_mut();
                    rows.replace(Snapshot {
                        objects: objects(),
                        status: "Connected · fixture".into(),
                    });
                    rows.selected = rows.rows.iter().map(|r| r.id.clone()).collect();
                    rows.query = "api".into();
                    rows.rebuild();
                    cx.notify();
                })
            })
            .unwrap();
        (handle, page, writes)
    }
    #[gpui_kit::test]
    fn restart_reviews_hidden_selection_cancel_sends_nothing_and_partial_success_retains_failures(
        cx: &mut TestAppContext,
    ) {
        let (handle, page, writes) = open(cx);
        handle
            .update(cx, |_, window, cx| {
                page.update(cx, |page, cx| {
                    page.restart(cx);
                    let plan = await_result(page.restart_prepare.as_mut().unwrap()).unwrap();
                    page.restart_prepare = None;
                    assert!(plan.review("Test").contains("api"));
                    assert!(plan.review("Test").contains("worker"));
                    page.restart_confirming = true;
                    page.confirm_restart(plan, window, cx);
                });
                window.render_frame(cx);
                window.click("confirm-cancel", cx);
            })
            .unwrap();
        cx.run_until_parked();
        assert_eq!(writes.load(Ordering::SeqCst), 0);
        handle
            .update(cx, |_, window, cx| {
                page.update(cx, |page, cx| {
                    assert_eq!(page.table.read(cx).delegate().selected.len(), 2);
                    page.restart(cx);
                    let plan = await_result(page.restart_prepare.as_mut().unwrap()).unwrap();
                    page.restart_prepare = None;
                    page.restart_confirming = true;
                    page.confirm_restart(plan, window, cx);
                });
                window.render_frame(cx);
                window.click("confirm-accept", cx);
            })
            .unwrap();
        cx.run_until_parked();
        handle
            .update(cx, |_, _, cx| {
                let start = std::time::Instant::now();
                while page.read(cx).restart_job.is_some() {
                    page.update(cx, |page, cx| page.poll_restart(cx));
                    assert!(start.elapsed() < Duration::from_secs(5));
                    std::thread::sleep(Duration::from_millis(1));
                }
                let rows = page.read(cx).table.read(cx).delegate();
                assert_eq!(writes.load(Ordering::SeqCst), 2);
                assert_eq!(rows.selected.len(), 1);
                assert!(rows.selected.contains("test/uid-worker"));
            })
            .unwrap();
    }
    #[gpui_kit::test]
    fn restart_controls_fit_light_dark_and_small_panes(cx: &mut TestAppContext) {
        let (handle, _, writes) = open(cx);
        for mode in [
            pintle_gpui_kit::theme::ThemeMode::Light,
            pintle_gpui_kit::theme::ThemeMode::Dark,
        ] {
            for (width, height) in [(1440., 900.), (1024., 680.), (440., 680.)] {
                cx.simulate_window_resize(handle, size(px(width), px(height)));
                handle
                    .update(cx, |_, window, cx| {
                        pintle_gpui_kit::theme::set_mode(mode, cx);
                        window.render_frame(cx);
                        window.render_frame(cx);
                        let bar = window.find("floating-action-bar").bounds();
                        let restart = window.find("bulk-restart").bounds();
                        let clear = window.find("bulk-clear").bounds();
                        let viewport = window.find("resource-table-viewport").bounds();
                        assert!(restart.left() >= bar.left() && restart.right() <= bar.right());
                        assert!(clear.left() >= bar.left() && clear.right() <= bar.right());
                        assert!(bar.left() >= viewport.left() && bar.right() <= viewport.right());
                    })
                    .unwrap();
            }
        }
        assert_eq!(writes.load(Ordering::SeqCst), 0);
    }
}
