use crate::catalog::{self, Resource, Row};
use gpui::component::{
    ActiveTheme, IconName, Sizable, WindowExt,
    button::{Button, ButtonVariants},
    checkbox::Checkbox,
    input::{Input, InputEvent, InputState},
    menu::{DropdownMenu, PopupMenuItem},
    table::{Column, ColumnSort, TableDelegate, TableEvent, TableState},
};
use gpui::{prelude::*, *};
use pintle_gpui_kit::{
    components::resource_table::{ResourceListHeader, ResourceTable},
    kit as gpui,
    shell::workspace::Document,
};
use std::collections::HashSet;

#[derive(Default)]
pub struct PanelState {
    pub details: String,
    pub output: Vec<String>,
}
pub struct Inspect;
impl EventEmitter<Inspect> for PanelState {}
impl PanelState {
    fn inspect(&mut self, cluster: &str, resource: Resource, row: &Row, cx: &mut Context<Self>) {
        self.details = format!(
            "Demo · {cluster} / {}\n\n{}",
            resource.title,
            resource
                .columns()
                .iter()
                .zip(&row.cells)
                .map(|(label, cell)| format!("{label}: {}", cell.text))
                .collect::<Vec<_>>()
                .join("\n")
        );
        cx.emit(Inspect);
        cx.notify();
    }
}
pub struct Rows {
    pub cluster: String,
    pub resource: Resource,
    pub rows: Vec<Row>,
    pub visible: Vec<usize>,
    pub query: String,
    pub namespace: Option<String>,
    pub selected: HashSet<String>,
    pub sort: Option<(usize, ColumnSort)>,
    panel: Entity<PanelState>,
}
impl Rows {
    pub fn new(cluster: String, resource: Resource, panel: Entity<PanelState>) -> Self {
        let rows = catalog::fixtures(&cluster, resource);
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
    pub fn refresh(&mut self) {
        self.rows = catalog::fixtures(&self.cluster, self.resource);
        self.selected
            .retain(|id| self.rows.iter().any(|r| &r.id == id));
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
                .width(px(44.))
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
    fn render_td(
        &mut self,
        row: usize,
        col: usize,
        _: &mut Window,
        cx: &mut Context<TableState<Self>>,
    ) -> impl IntoElement {
        let record = self.rows[self.visible[row]].clone();
        if col == 0 {
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
            let resource = self.resource;
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
                            let details = record.clone();
                            let name = record.name.clone();
                            menu.item(PopupMenuItem::new("View details").on_click(
                                move |_, _, cx| {
                                    panel.update(cx, |panel, cx| {
                                        panel.inspect(&cluster, resource, &details, cx)
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
        div()
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
            .child("No matching resources")
    }
}
pub struct ResourcePage {
    pub table: Entity<TableState<Rows>>,
    pub filter: Entity<InputState>,
    _subscriptions: Vec<Subscription>,
}
impl ResourcePage {
    pub fn new(
        document: &Document,
        panel: Entity<PanelState>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let (cluster, resource) = catalog::resolve(document);
        let table = cx.new(|cx| {
            TableState::new(Rows::new(cluster, resource, panel), window, cx)
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
        let selected = cx.subscribe(&table, |_, table, event: &TableEvent, cx| {
            if let TableEvent::SelectRow(row) = event {
                let rows = table.read(cx).delegate();
                let panel = rows.panel.clone();
                let cluster = rows.cluster.clone();
                let resource = rows.resource;
                let record = rows.visible.get(*row).map(|i| rows.rows[*i].clone());
                if let Some(record) = record {
                    panel.update(cx, |panel, cx| {
                        panel.inspect(&cluster, resource, &record, cx)
                    });
                }
            }
        });
        let observe = cx.observe(&table, |_, _, cx| cx.notify());
        Self {
            table,
            filter,
            _subscriptions: vec![changed, selected, observe],
        }
    }
    pub fn set_namespace(&mut self, namespace: Option<String>, cx: &mut Context<Self>) {
        self.table.update(cx, |table, cx| {
            table.delegate_mut().namespace = namespace;
            table.delegate_mut().rebuild();
            cx.notify();
        });
    }
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        self.table.update(cx, |table, cx| {
            let rows = table.delegate_mut();
            rows.refresh();
            let message = format!(
                "Refreshed {} / {} · Demo data",
                rows.cluster, rows.resource.title
            );
            rows.panel.update(cx, |panel, cx| {
                panel.output.push(message);
                cx.notify();
            });
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
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let rows = self.table.read(cx).delegate();
        let resource = rows.resource;
        let title = format!("{} / {}", rows.cluster, resource.title);
        let count = format!("{} items · Demo data", rows.visible.len());
        let namespace = rows.namespace.as_deref().unwrap_or("all").to_owned();
        let owner = cx.weak_entity();
        let filter = Input::new(&self.filter)
            .id("table-filter")
            .aria_label("Filter resources")
            .prefix(gpui::component::Icon::new(IconName::Search).size(px(14.)))
            .small()
            .map(|input| gpui::Styled::h(input, px(32.)));
        let namespaces = Button::new("namespace-filter")
            .icon(gpui::assets::IconName::Funnel)
            .label(format!("Namespace: {namespace}"))
            .small()
            .h(px(32.))
            .dropdown_menu(move |mut menu, _, _| {
                for namespace in [None]
                    .into_iter()
                    .chain(catalog::NAMESPACES.into_iter().map(Some))
                {
                    let owner = owner.clone();
                    menu = menu.item(PopupMenuItem::new(namespace.unwrap_or("all")).on_click(
                        move |_, _, cx| {
                            let _ = owner.update(cx, |page, cx| {
                                page.set_namespace(namespace.map(str::to_owned), cx)
                            });
                        },
                    ));
                }
                menu
            });
        let refresh = Button::new("refresh-resources")
            .icon(IconName::RefreshCw)
            .small()
            .h(px(32.))
            .accessibility_label("Refresh resources")
            .on_click(cx.listener(|this, _, _, cx| this.refresh(cx)));
        let create = Button::new("new-from-yaml")
            .label("+ New from YAML")
            .small()
            .h(px(32.))
            .bg(cx.theme().foreground)
            .text_color(cx.theme().background)
            .on_click(|_, window, cx| {
                window.open_dialog(cx, |dialog, _, _| {
                    dialog.title("New from YAML · Demo").child(
                        "Resource creation is not available in Demo mode. No cluster is connected.",
                    )
                });
            });
        let toolbar = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap_2()
            .min_w_0()
            .child(div().flex_1().min_w(px(90.)).child(filter))
            .when(resource.namespaced, |toolbar| toolbar.child(namespaces))
            .child(refresh)
            .child(create);
        div()
            .id(("resource-page", cx.entity_id()))
            .test_support()
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
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .child(ResourceTable::new(&self.table)),
            )
    }
}
