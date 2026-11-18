use super::*;
use gpui::component::{
    Disableable, Selectable, TitleBar,
    input::{Input, InputState},
    resizable::{h_resizable, resizable_panel, v_resizable},
};
use gpui::{Bounds, WindowBounds, WindowOptions, point, size};

pub fn install_theme(cx: &mut App) {
    let mut options = theme::ThemeOptions::default();
    for config in [&mut options.light, &mut options.dark] {
        let dark = config.mode.is_dark();
        config.font_family = Some("JetBrains Mono".into());
        let c = &mut config.colors;
        macro_rules! paint { ($l:literal,$d:literal; $($field:ident),+) => {$(c.$field=Some(if dark {$d} else {$l}.into());)+} }
        paint!("#ffffff","#0f0f11";background,list,list_even,tab_active,button);
        paint!("#fafafa","#141417";sidebar,title_bar,status_bar,tab,tab_bar,table_head,table_foot,list_head);
        paint!("#ffffff","#19191c";table,table_even,group_box,description_list_label);
        paint!("#ffffff","#1c1c1f";popover);
        paint!("#09090b","#fafafa";foreground,button_foreground,tab_active_foreground,sidebar_foreground,popover_foreground,group_box_foreground);
        paint!("#3f3f46","#c2c2cc";muted_foreground,table_head_foreground,tab_foreground);
        paint!("#e4e4e7","#27272a";border,sidebar_border,table_row_border,title_bar_border,status_bar_border);
        paint!("#e4e4e7","#303036";list_active,table_active,sidebar_accent,button_active);
        paint!("#f4f4f5","#222226";list_hover,table_hover,button_hover,muted,accent,secondary);
        paint!("#18181b","#fafafa";primary,button_primary,sidebar_primary,link,caret,list_active_border,table_active_border);
        paint!("#fafafa","#18181b";primary_foreground,button_primary_foreground,sidebar_primary_foreground);
        paint!("#18181b","#d4d4d8";ring);
    }
    theme::install(options, cx);
}

pub fn set_appearance(value: &str, window: &Window, cx: &mut App) {
    theme::set_mode(
        match value {
            "dark" => theme::ThemeMode::Dark,
            "light" => theme::ThemeMode::Light,
            _ => window.appearance().into(),
        },
        cx,
    );
}

#[cfg_attr(test, allow(dead_code))]
pub fn window_options(cx: &App) -> WindowOptions {
    let mut options = chrome::window_options(cx);
    let fallback = options.window_bounds.unwrap_or_default().get_bounds();
    #[cfg(not(test))]
    let saved = backend::config::load().ok().and_then(|s| s.window);
    #[cfg(test)]
    let saved: Option<backend::config::SavedWindow> = None;
    options.window_bounds = Some(
        saved
            .map(|s| {
                let [x, y, w, h] = s.bounds;
                let b = Bounds::new(point(px(x), px(y)), size(px(w), px(h)));
                let visible = w >= 500.
                    && h >= 300.
                    && cx
                        .displays()
                        .iter()
                        .any(|d| d.bounds().contains(&point(px(x + 60.), px(y + 15.))));
                let b = if visible { b } else { fallback };
                match s.mode.as_str() {
                    "maximized" => WindowBounds::Maximized(b),
                    "fullscreen" => WindowBounds::Fullscreen(b),
                    _ => WindowBounds::Windowed(b),
                }
            })
            .unwrap_or(WindowBounds::Maximized(fallback)),
    );
    options
}

fn icon_button(id: &'static str, icon: IconName, label: &'static str) -> Button {
    Button::new(id)
        .ghost()
        .xsmall()
        .icon(icon)
        .tooltip(label)
        .accessibility_label(label)
}

impl Lightship {
    pub(super) fn desktop(&self, window: &Window, cx: &mut Context<Self>) -> gpui::AnyElement {
        let workspace = self.workspace.read(cx);
        let count: usize = workspace.groups(cx).iter().map(|g| g.views.len()).sum();
        let active = workspace
            .active_view(cx)
            .and_then(|v| workspace.document(v, cx));
        let manager = self.connections.read(cx);
        let connection = active
            .as_ref()
            .and_then(|doc| doc.key.0.split_once('/'))
            .and_then(|(id, _)| manager.settings.connections.iter().find(|c| c.id == id));
        let cluster_name = connection
            .map(|c| c.name.clone())
            .unwrap_or_else(|| "No cluster".into());
        let snapshot = connection
            .filter(|c| Some(&c.id) == self.metric_cluster.as_ref())
            .and(self.metrics.as_ref());
        let mut counts = Vec::new();
        let mut usage = Vec::new();
        if let Some(s) = snapshot {
            if let Ok(n) = &s.nodes {
                counts.push(format!("{}/{} nodes", n.ready, n.total));
            }
            if let Ok(p) = &s.pods {
                counts.push(format!("{} pods", p.active));
            }
            if let Ok(n) = s.namespaces {
                counts.push(format!("{n} ns"));
            }
            for (label, part) in [("CPU", &s.cpu), ("MEM", &s.memory)] {
                if let Ok(u) = part
                    && u.fresh(chrono::Utc::now())
                {
                    usage.push(format!("{label} {:.0}%", u.allocation.percent()));
                }
            }
        }
        let live = connection.and_then(|c| manager.status.get(&c.id)).cloned();
        let empty_clusters = manager.settings.connections.is_empty();
        let readonly = manager.backend.is_read_only();
        let sidebar_visible = self.layout.read(cx).sidebar_visible;
        let panel_visible = self.layout.read(cx).panel_visible;

        let search = chrome::search_button("search clusters, resources, actions…", cx)
            .bg(cx.theme().background)
            .on_click(cx.listener(|this, _, w, cx| this.search(w, cx)));
        let actions = div()
            .flex()
            .items_center()
            .gap_1()
            .child(icon_button("history", IconName::Clock, "History").on_click(
                cx.listener(|this, _, w, cx| this.open_utility("app/history", "History", w, cx)),
            ))
            .child(
                icon_button(
                    "theme",
                    if cx.theme().mode.is_dark() {
                        IconName::Sun
                    } else {
                        IconName::Moon
                    },
                    "Toggle theme",
                )
                .on_click(cx.listener(|this, _, _, cx| this.toggle_theme(cx))),
            )
            .child(
                icon_button("settings", IconName::Settings, "Settings")
                    .on_click(cx.listener(|this, _, w, cx| this.settings(w, cx))),
            );
        let title = TitleBar::new()
            .h(px(36.))
            .bg(cx.theme().title_bar)
            .border_b_1()
            .border_color(cx.theme().border)
            .child(chrome::title_content(search, actions));
        let sidebar = div()
            .id("lightship-sidebar")
            .test_support()
            .size_full()
            .min_h_0()
            .flex()
            .flex_col()
            .bg(cx.theme().sidebar)
            .border_r_1()
            .border_color(cx.theme().border)
            .child(
                div()
                    .flex()
                    .items_center()
                    .px_3()
                    .h(px(36.))
                    .flex_shrink_0()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .child(
                        div()
                            .flex_1()
                            .text_size(px(11.))
                            .text_color(cx.theme().muted_foreground)
                            .child("CLUSTERS"),
                    )
                    .child(
                        icon_button("add-cluster", IconName::Plus, "Add cluster")
                            .on_click(cx.listener(|this, _, w, cx| this.add_cluster(w, cx))),
                    )
                    .child(
                        icon_button("manage-clusters", IconName::Layers, "Manage clusters")
                            .on_click(cx.listener(|this, _, w, cx| this.manage_clusters(w, cx))),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .relative()
                    .child(self.navigation.clone())
                    .when(empty_clusters, |d| {
                        d.child(
                            div()
                                .absolute()
                                .top(px(72.))
                                .left_0()
                                .right_0()
                                .flex()
                                .flex_col()
                                .items_center()
                                .gap_3()
                                .child(gpui::component::Icon::new(IconName::Server).size(px(28.)))
                                .child("No clusters yet")
                                .child(
                                    Button::new("add-first-cluster")
                                        .label("Add cluster")
                                        .icon(IconName::Plus)
                                        .small()
                                        .on_click(
                                            cx.listener(|this, _, w, cx| this.add_cluster(w, cx)),
                                        ),
                                ),
                        )
                    }),
            );
        let toggle = icon_button("toggle-panel", IconName::Terminal, "Terminal")
            .on_click(cx.listener(|this, _, w, cx| this.toggle_panel(w, cx)));
        let editor = if count == 0 {
            div()
                .size_full()
                .flex()
                .flex_col()
                .child(
                    div()
                        .h(px(36.))
                        .px_2()
                        .flex()
                        .items_center()
                        .justify_end()
                        .bg(cx.theme().tab_bar)
                        .border_b_1()
                        .border_color(cx.theme().border)
                        .child(toggle),
                )
                .child(
                    div()
                        .id("empty-workspace")
                        .test_support()
                        .track_focus(&self.workspace.read(cx).active_focus_handle(cx))
                        .flex_1()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(cx.theme().muted_foreground)
                        .child("No tab open · ⌘K to search"),
                )
                .into_any_element()
        } else {
            div()
                .size_full()
                .relative()
                .child(self.workspace.clone())
                .into_any_element()
        };
        let main = if panel_visible {
            v_resizable("lightship-panels")
                .with_state(&self.panel_size)
                .child(resizable_panel().child(editor))
                .child(
                    resizable_panel()
                        .fixed()
                        .size(px(280.))
                        .size_range(px(110.)..(window.viewport_size().height * 0.65))
                        .child(self.panel(cx)),
                )
                .into_any_element()
        } else {
            editor
        };
        let body = if sidebar_visible {
            h_resizable("lightship-columns")
                .with_state(&self.sidebar_size)
                .child(
                    resizable_panel()
                        .fixed()
                        .size(px(280.))
                        .size_range(px(200.)..(window.viewport_size().width * 0.5).min(px(600.)))
                        .child(sidebar),
                )
                .child(resizable_panel().child(main))
                .into_any_element()
        } else {
            main
        };
        let terminals = self.sessions.read(cx).terminal_count();
        let status = div()
            .id("workspace-status")
            .test_support()
            .h(px(24.))
            .px_2()
            .flex_shrink_0()
            .flex()
            .items_center()
            .gap_3()
            .border_t_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().status_bar)
            .text_size(px(11.))
            .text_color(cx.theme().muted_foreground)
            .child(cluster_name)
            .children(counts)
            .child(div().flex_1())
            .children(usage)
            .children(live)
            .when(terminals > 0, |d| d.child(format!("{terminals} terminals")))
            .child(format!("{count} tabs"))
            .child(
                Button::new("toggle-read-only")
                    .ghost()
                    .xsmall()
                    .label(if readonly { "read-only" } else { "read-write" })
                    .on_click(cx.listener(|this, _, _, cx| {
                        let backend = &this.connections.read(cx).backend;
                        backend.set_read_only(!backend.is_read_only());
                        cx.notify();
                    })),
            )
            .when(count > 0, |d| {
                d.child(
                    icon_button("show-output", IconName::Terminal, "Terminal")
                        .on_click(cx.listener(|this, _, w, cx| this.toggle_panel(w, cx))),
                )
            });
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .font_family(cx.theme().mono_font_family.clone())
            .text_size(px(13.))
            .child(title)
            .child(div().flex_1().min_h_0().child(body))
            .child(status)
            .into_any_element()
    }
    pub(super) fn settings(&self, window: &mut Window, cx: &mut Context<Self>) {
        let manager = self.connections.clone();
        let section = Rc::new(std::cell::Cell::new("appearance"));
        window.open_dialog(cx, move |dialog, window, cx| {
            let active = section.get();
            let selected = manager.read(cx).settings.appearance().to_owned();
            let content = match active {
                "appearance" => div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child("Theme")
                    .child(
                        div()
                            .text_color(cx.theme().muted_foreground)
                            .child("Pick the surface palette."),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .children(["system", "light", "dark"].map(|v| {
                                let manager = manager.clone();
                                Button::new(v)
                                    .h(px(48.))
                                    .min_w(px(88.))
                                    .label(match v {
                                        "system" => "System",
                                        "dark" => "Dark",
                                        _ => "Light",
                                    })
                                    .selected(selected == v)
                                    .on_click(move |_, w, cx| {
                                        manager.update(cx, |m, cx| {
                                            m.save_theme(v);
                                            cx.notify()
                                        });
                                        set_appearance(v, w, cx);
                                        w.refresh();
                                    })
                            })),
                    ),
                "general" => {
                    let backend = manager.read(cx).backend.clone();
                    div().child(
                        Button::new("settings-readonly")
                            .label("Read-only mode")
                            .selected(backend.is_read_only())
                            .on_click(move |_, w, _| {
                                backend.set_read_only(!backend.is_read_only());
                                w.refresh()
                            }),
                    )
                }
                "keymap" => div().flex().flex_col().gap_2().children(
                    [
                        ("Command palette", "⌘ K"),
                        ("Sidebar", "⌘ B"),
                        ("Bottom panel", "⌘ J"),
                        ("Settings", "⌘ ,"),
                        ("Toggle theme", "⌘ ⇧ L"),
                    ]
                    .map(|(label, keys)| {
                        div()
                            .flex()
                            .justify_between()
                            .py_2()
                            .border_b_1()
                            .border_color(cx.theme().border)
                            .child(label)
                            .child(keys)
                    }),
                ),
                _ => div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child("Lightship GPUI")
                    .child(format!(
                        "Version {} · Rust and GPUI",
                        env!("CARGO_PKG_VERSION")
                    ))
                    .child("Pintle Company Limited"),
            };
            dialog
                .title("Settings")
                .width(px(860.).min(window.viewport_size().width * 0.92))
                .centered()
                .child(
                    div()
                        .h(px(480.).min(window.viewport_size().height * 0.65))
                        .flex()
                        .border_t_1()
                        .border_color(cx.theme().border)
                        .child(
                            div()
                                .w(px(175.))
                                .flex()
                                .flex_col()
                                .gap_1()
                                .p_2()
                                .border_r_1()
                                .border_color(cx.theme().border)
                                .bg(cx.theme().sidebar)
                                .children(["appearance", "general", "keymap", "about"].map(
                                    |item| {
                                        let section = section.clone();
                                        Button::new(item)
                                            .ghost()
                                            .label(item)
                                            .selected(active == item)
                                            .on_click(move |_, w, _| {
                                                section.set(item);
                                                w.refresh()
                                            })
                                    },
                                )),
                        )
                        .child(div().flex_1().p_5().child(content)),
                )
        });
    }
}

pub struct History {
    panel: Entity<PanelState>,
    filter: Entity<InputState>,
    focus: FocusHandle,
    _subscriptions: Vec<Subscription>,
}
impl History {
    pub fn new(panel: Entity<PanelState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let filter =
            cx.new(|cx| InputState::new(window, cx).placeholder("Filter by cluster or action…"));
        Self {
            _subscriptions: vec![
                cx.observe(&panel, |_, _, cx| cx.notify()),
                cx.observe(&filter, |_, _, cx| cx.notify()),
            ],
            panel,
            filter,
            focus: cx.focus_handle(),
        }
    }
}
impl Focusable for History {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Render for History {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let filter = self.filter.read(cx).value().to_lowercase();
        let panel = self.panel.read(cx);
        div()
            .id("activity-history")
            .test_support()
            .track_focus(&self.focus)
            .size_full()
            .flex()
            .flex_col()
            .gap_3()
            .p_4()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(div().flex_1().child("History"))
                    .child(
                        Button::new("export-history")
                            .small()
                            .label("Export JSON")
                            .disabled(panel.history.is_empty())
                            .on_click(cx.listener(|this, _, _, cx| {
                                let path = cx.prompt_for_new_path(
                                    &std::env::temp_dir(),
                                    Some("lightship-history.json"),
                                );
                                let rows = this.panel.read(cx).history.clone();
                                let source = this.panel.clone();
                                cx.spawn(async move |_, cx| {
                                    if let Ok(Ok(Some(path))) = path.await
                                        && let Err(e) =
                                            crate::backend::config::write_json(&path, &rows)
                                    {
                                        source.update(cx, |p, cx| {
                                            p.error = e;
                                            cx.notify()
                                        });
                                    }
                                })
                                .detach();
                            })),
                    )
                    .child(
                        Button::new("clear-history")
                            .small()
                            .label("Clear")
                            .disabled(panel.history.is_empty())
                            .on_click(cx.listener(|this, _, w, cx| {
                                let answer = crate::confirm::ask(
                                    "Clear history?",
                                    "Remove all saved activity records.".into(),
                                    "Clear",
                                    w,
                                    cx,
                                );
                                let panel = this.panel.clone();
                                cx.spawn(async move |_, cx| {
                                    if answer.await {
                                        panel.update(cx, |p, cx| p.clear(cx));
                                    }
                                })
                                .detach();
                            })),
                    ),
            )
            .child(Input::new(&self.filter))
            .when(!panel.error.is_empty(), |d| d.child(panel.error.clone()))
            .child(
                div()
                    .id("history-rows")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .when(panel.history.is_empty(), |d| d.child("No activity yet"))
                    .children(
                        panel
                            .history
                            .iter()
                            .rev()
                            .filter(|r| {
                                r.cluster.to_lowercase().contains(&filter)
                                    || r.message.to_lowercase().contains(&filter)
                            })
                            .map(|r| {
                                div()
                                    .py_2()
                                    .border_b_1()
                                    .border_color(cx.theme().border)
                                    .child(format!("{}   {}   {}", r.time, r.cluster, r.message))
                            }),
                    ),
            )
    }
}
