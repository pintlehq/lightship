//! Lightship owns Kubernetes presentation; Pintle owns the shared desktop UI.
use gpui::TestSupportExt;
use gpui::assets::IconName;
use gpui::component::{
    ActiveTheme, Selectable, Sizable, WindowExt,
    button::{Button, ButtonVariants},
};
use gpui::{
    App, AppContext, Context, Entity, FocusHandle, Focusable, IntoElement, KeyBinding, Menu,
    MenuItem, Render, Subscription, Window, div, prelude::*, px,
};
use pintle_gpui_kit::kit as gpui_kit;
use pintle_gpui_kit::{
    kit as gpui,
    shell::{
        command_palette::{CommandEntry, CommandPalette},
        workbench::{self as chrome, WorkbenchState},
        workspace::{NavigationEvent, NavigationTree, OpenMode, Workspace, WorkspacePage},
    },
    theme,
};
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    rc::Rc,
};

#[cfg(test)]
mod tests;
gpui::actions!(lightship, [Quit, Search, ToggleSidebar, TogglePanel]);

mod backend;
mod catalog;
mod connections;
mod detail_page;
mod inspector;
mod onboarding;
mod resource_page;
use detail_page::{DetailPage, DetailTarget, Routes};
use resource_page::{Inspect, PanelState, ResourcePage};
struct Lightship {
    workspace: Entity<Workspace>,
    connections: Entity<connections::Connections>,
    navigation: Entity<NavigationTree>,
    layout: Entity<WorkbenchState>,
    palette: CommandPalette,
    detail_routes: Routes,
    panel_state: Entity<PanelState>,
    panel_focus: FocusHandle,
    _subscriptions: Vec<Subscription>,
}
impl Lightship {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let backend = backend::Backend::new();
        let connections = cx.new(|cx| connections::Connections::new(backend.clone(), window, cx));
        theme::set_mode(
            if connections.read(cx).settings.dark {
                theme::ThemeMode::Dark
            } else {
                theme::ThemeMode::Light
            },
            cx,
        );
        let documents = connections.read(cx).documents();
        let panel_state = cx.new(|_| PanelState::default());
        let detail_routes: Routes = Rc::new(RefCell::new(HashMap::new()));
        let routes = detail_routes.clone();
        let page_panel = panel_state.clone();
        let workspace = cx.new(|cx| {
            Workspace::new(
                Rc::new(move |document, window, cx| {
                    if let Some(target) = routes.borrow().get(document.key.0.as_ref()).cloned() {
                        return WorkspacePage::new(
                            cx.new(|cx| DetailPage::new(target, document, backend.clone(), cx)),
                            cx,
                        );
                    }
                    WorkspacePage::new(
                        cx.new(|cx| {
                            ResourcePage::new(
                                document,
                                page_panel.clone(),
                                backend.clone(),
                                window,
                                cx,
                            )
                        }),
                        cx,
                    )
                }),
                window,
                cx,
            )
        });
        let navigation = cx.new(|cx| {
            NavigationTree::with_options(
                connections.read(cx).navigation(),
                pintle_gpui_kit::shell::workspace::NavigationTreeOptions {
                    row_height: px(28.),
                    font_family: Some("JetBrains Mono".into()),
                    initial_expanded: Some(Default::default()),
                    decoration: Some({
                        let connections = connections.clone();
                        Rc::new(move |id, cx| {
                            let manager = connections.read(cx);
                            if manager
                                .settings
                                .connections
                                .iter()
                                .any(|c| c.id == id.as_ref())
                            {
                                let status = manager
                                    .status
                                    .get(id.as_ref())
                                    .map(String::as_str)
                                    .unwrap_or("Disconnected");
                                div()
                                    .text_size(px(10.))
                                    .text_color(cx.theme().muted_foreground)
                                    .child(if status.starts_with("Connected") {
                                        "● Read-only"
                                    } else if status.starts_with("Connecting") {
                                        "Connecting…"
                                    } else {
                                        "Offline"
                                    })
                                    .into_any_element()
                            } else {
                                div().into_any_element()
                            }
                        })
                    }),
                },
                window,
                cx,
            )
        });
        let layout = cx.new(|cx| {
            let mut layout = WorkbenchState::new(cx);
            layout.panel_visible = false;
            layout
        });
        let panel_observe = cx.observe(&panel_state, |_, _, cx| cx.notify());
        let inspect = cx.subscribe_in(
            &panel_state,
            window,
            |this, _, event: &Inspect, window, cx| {
                this.open_resource(event, window, cx);
            },
        );
        let nav = cx.subscribe_in(
            &navigation,
            window,
            |this, _, event: &NavigationEvent, window, cx| {
                this.workspace.update(cx, |workspace, cx| {
                    workspace.open(event.document.clone(), event.mode, window, cx);
                });
            },
        );
        let layout_sub = cx.observe(&layout, |_, _, cx| cx.notify());
        let workspace_sub = cx.observe(&workspace, |this, workspace, cx| {
            let selected = workspace
                .read(cx)
                .active_view(cx)
                .and_then(|view| workspace.read(cx).document(view, cx));
            if let Some(document) = selected {
                let list_key = this
                    .detail_routes
                    .borrow()
                    .get(document.key.0.as_ref())
                    .map(DetailTarget::list_key);
                let state = this.navigation.read(cx).state.clone();
                state.update(cx, |state, cx| {
                    state.set_selected_item(
                        Some(&gpui::component::tree::TreeItem::new(
                            list_key.map(Into::into).unwrap_or(document.key.0),
                            document.title,
                        )),
                        cx,
                    )
                });
            }
            let groups = workspace.read(cx).groups(cx);
            let visible: HashSet<_> = groups.iter().filter_map(|g| g.active).collect();
            let mut open_keys = HashSet::new();
            for view in groups.into_iter().flat_map(|g| g.views) {
                if let Some(doc) = workspace.read(cx).document(view, cx) {
                    open_keys.insert(doc.key.0.to_string());
                }
                if let Some(page) = workspace
                    .read(cx)
                    .page(view, cx)
                    .and_then(|p| p.downcast::<DetailPage>().ok())
                {
                    page.update(cx, |page, cx| page.set_visible(visible.contains(&view), cx));
                }
            }
            this.detail_routes
                .borrow_mut()
                .retain(|key, _| open_keys.contains(key));
            cx.notify();
        });
        let mut entries: Vec<_> = documents
            .iter()
            .map(|doc| {
                CommandEntry::new(
                    doc.key.0.clone(),
                    "Resources",
                    format!("{} / {}", doc.context, doc.title),
                )
                .keywords(["Kubernetes"])
            })
            .collect();
        entries.extend([
            CommandEntry::new("toggle-sidebar", "Commands", "Toggle Sidebar"),
            CommandEntry::new("toggle-panel", "Commands", "Toggle Panel"),
            CommandEntry::new("toggle-theme", "Commands", "Toggle Appearance"),
            CommandEntry::new("add-cluster", "Commands", "Add Cluster"),
            CommandEntry::new("manage-clusters", "Commands", "Manage Clusters"),
        ]);
        let palette = CommandPalette::new(entries, window, cx);
        let mut previous_documents = documents.clone();
        let connection_changes =
            cx.observe_in(&connections, window, move |this, manager, window, cx| {
                let docs = manager.read(cx).documents();
                let mut removed: Vec<_> = previous_documents
                    .iter()
                    .filter(|old| !docs.iter().any(|new| new.key == old.key))
                    .map(|d| d.key.clone())
                    .collect();
                let connections = manager.read(cx).settings.connections.clone();
                removed.extend(
                    this.detail_routes
                        .borrow()
                        .iter()
                        .filter(|(_, target)| !connections.iter().any(|c| c.id == target.cluster))
                        .map(|(key, _)| key.as_str().into()),
                );
                if !removed.is_empty() {
                    this.workspace.update(cx, |workspace, cx| {
                        workspace.close_resources(
                            &removed,
                            pintle_gpui_kit::shell::workspace::ClosePolicy::Discard,
                            window,
                            cx,
                        );
                    });
                }
                this.workspace.update(cx, |workspace, cx| {
                    for document in &docs {
                        workspace.update_document_metadata(document, cx);
                    }
                    for target in this.detail_routes.borrow().values() {
                        if let Some(connection) =
                            connections.iter().find(|c| c.id == target.cluster)
                        {
                            workspace
                                .update_document_metadata(&target.document(&connection.name), cx);
                        }
                    }
                    for view in workspace.groups(cx).into_iter().flat_map(|g| g.views) {
                        if let Some(document) = workspace.document(view, cx)
                            && let Some(page) = workspace
                                .page(view, cx)
                                .and_then(|p| p.downcast::<ResourcePage>().ok())
                        {
                            page.update(cx, |page, cx| page.rename(&document, cx));
                        }
                        if let Some(document) = workspace.document(view, cx)
                            && let Some(page) = workspace
                                .page(view, cx)
                                .and_then(|p| p.downcast::<DetailPage>().ok())
                        {
                            page.update(cx, |page, cx| page.rename(&document, cx));
                        }
                    }
                });
                previous_documents = docs.clone();
                let nodes = manager.read(cx).navigation();
                this.navigation
                    .update(cx, |nav, cx| nav.set_nodes(nodes, cx));
                let mut entries: Vec<_> = docs
                    .iter()
                    .map(|doc| {
                        CommandEntry::new(
                            doc.key.0.clone(),
                            "Resources",
                            format!("{} / {}", doc.context, doc.title),
                        )
                    })
                    .collect();
                entries.extend(Self::commands());
                this.palette.set_entries(entries);
                cx.notify();
            });
        Self {
            workspace,
            connections,
            navigation,
            layout,
            palette,
            detail_routes,
            panel_state,
            panel_focus: cx.focus_handle(),
            _subscriptions: vec![
                nav,
                layout_sub,
                workspace_sub,
                panel_observe,
                inspect,
                connection_changes,
            ],
        }
    }
    fn commands() -> Vec<CommandEntry> {
        vec![
            CommandEntry::new("add-cluster", "Commands", "Add Cluster"),
            CommandEntry::new("manage-clusters", "Commands", "Manage Clusters"),
            CommandEntry::new("toggle-sidebar", "Commands", "Toggle Sidebar"),
            CommandEntry::new("toggle-panel", "Commands", "Toggle Panel"),
            CommandEntry::new("toggle-theme", "Commands", "Toggle Appearance"),
        ]
    }
    fn add_cluster(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        #[cfg(not(test))]
        let paths = backend::config::default_files();
        #[cfg(test)]
        let paths = Vec::new();
        let form =
            cx.new(|cx| onboarding::AddCluster::new(self.connections.clone(), paths, window, cx));
        self.open_add_cluster(form, window, cx);
    }
    fn open_add_cluster(
        &mut self,
        form: Entity<onboarding::AddCluster>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let return_focus = window.focused(cx).unwrap_or_else(|| self.focus_handle(cx));
        window.open_dialog(cx, move |dialog, window, cx| {
            let close = form.clone();
            let return_focus = return_focus.clone();
            let footer = form.update(cx, |form, cx| form.footer(cx).into_any_element());
            dialog
                .title(
                    div()
                        .h(px(52.))
                        .px_5()
                        .flex()
                        .items_center()
                        .gap_3()
                        .border_b_1()
                        .border_color(cx.theme().border)
                        .child(gpui::component::Icon::new(IconName::Server).size(px(18.)))
                        .child("Add cluster"),
                )
                .width(px(720.))
                .h((window.viewport_size().height - px(64.)).min(form.read(cx).preferred_height()))
                .centered()
                .p_0()
                .gap_0()
                .rounded_xl()
                .font_family(cx.theme().mono_font_family.clone())
                .text_size(px(13.))
                .overlay_closable(false)
                .content({
                    let form = form.clone();
                    move |content, _, _| {
                        content
                            .min_h_0()
                            .overflow_hidden()
                            .p_0()
                            .child(form.clone())
                    }
                })
                .footer(footer)
                .on_close(move |_, window, cx| {
                    close.update(cx, |form, cx| form.clear(window, cx));
                    return_focus.focus(window, cx);
                })
        });
    }
    fn manage_clusters(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let manager = self.connections.clone();
        let return_focus = window.focused(cx).unwrap_or_else(|| self.focus_handle(cx));
        window.open_dialog(cx, move |dialog, _, cx| {
            let return_focus = return_focus.clone();
            dialog
                .title("Manage clusters · Read-only")
                .width(px(720.))
                .centered()
                .font_family(cx.theme().mono_font_family.clone())
                .text_size(px(13.))
                .child(manager.clone())
                .on_close(move |_, window, cx| return_focus.focus(window, cx))
        });
    }
    fn toggle_sidebar(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let focus = self.workspace.read(cx).active_focus_handle(cx);
        self.layout.update(cx, |layout, cx| {
            layout.set_sidebar_visible(!layout.sidebar_visible, &focus, window, cx)
        });
    }
    fn toggle_panel(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let focus = self.workspace.read(cx).active_focus_handle(cx);
        self.layout.update(cx, |layout, cx| {
            layout.set_panel_visible(!layout.panel_visible, &focus, window, cx)
        });
    }
    fn toggle_theme(&mut self, cx: &mut Context<Self>) {
        let mode = if cx.theme().mode.is_dark() {
            theme::ThemeMode::Light
        } else {
            theme::ThemeMode::Dark
        };
        theme::set_mode(mode, cx);
        self.connections
            .update(cx, |manager, _| manager.save_appearance(mode.is_dark()));
    }
    fn search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let owner = cx.entity().downgrade();
        self.palette.open(window, cx, move |_, cx| {
            let Some(entity) = owner.upgrade() else {
                return div().into_any_element();
            };
            let owner = owner.clone();
            entity
                .read(cx)
                .palette
                .render(cx, move |id, window, cx| {
                    let _ = owner.update(cx, |this, cx| match id.as_ref() {
                        "toggle-sidebar" => this.toggle_sidebar(window, cx),
                        "toggle-panel" => this.toggle_panel(window, cx),
                        "toggle-theme" => this.toggle_theme(cx),
                        "add-cluster" => this.add_cluster(window, cx),
                        "manage-clusters" => this.manage_clusters(window, cx),
                        _ => {
                            if let Some(doc) = this
                                .connections
                                .read(cx)
                                .documents()
                                .into_iter()
                                .find(|doc| doc.key.0 == id)
                            {
                                this.workspace.update(cx, |workspace, cx| {
                                    workspace.open(doc, OpenMode::Permanent, window, cx);
                                });
                            }
                        }
                    });
                })
                .into_any_element()
        });
    }
    fn open_resource(&mut self, event: &Inspect, window: &mut Window, cx: &mut Context<Self>) {
        let cluster_name = self
            .connections
            .read(cx)
            .settings
            .connections
            .iter()
            .find(|c| c.id == event.cluster)
            .map(|c| c.name.clone())
            .unwrap_or_else(|| event.cluster.clone());
        if event.key == "overview" {
            if let Some(resource) = catalog::RESOURCES
                .iter()
                .find(|r| event.object["name"] == r.title && r.key != "overview")
            {
                let doc = pintle_gpui_kit::shell::workspace::Document::new(
                    format!("{}/{}", event.cluster, resource.key).as_str(),
                    resource.title,
                    cluster_name,
                );
                self.workspace.update(cx, |workspace, cx| {
                    workspace.open(doc, OpenMode::Permanent, window, cx);
                });
            }
            return;
        }
        if let Some(target) =
            DetailTarget::new(event.cluster.clone(), event.key.clone(), &event.object)
        {
            let document = target.document(&cluster_name);
            self.detail_routes
                .borrow_mut()
                .insert(document.key.0.to_string(), target);
            self.workspace.update(cx, |workspace, cx| {
                workspace.open(document, OpenMode::Permanent, window, cx);
            });
        }
    }
    fn panel(&self, cx: &Context<Self>) -> impl IntoElement + use<> {
        chrome::frame("lightship-panel", cx)
            .child(
                chrome::panel_tabs("lightship-panel-tabs")
                    .child(
                        chrome::panel_tab("output-panel-tab", "Output", true)
                            .track_focus(&self.panel_focus),
                    )
                    .child(div().flex_1())
                    .child(
                        Button::new("close-panel")
                            .icon(IconName::X)
                            .ghost()
                            .xsmall()
                            .accessibility_label("Close panel")
                            .on_click(
                                cx.listener(|this, _, window, cx| this.toggle_panel(window, cx)),
                            ),
                    ),
            )
            .child(
                div()
                    .id("panel-content")
                    .aria_label("Activity output")
                    .test_support()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .p_4()
                    .font_family(cx.theme().mono_font_family.clone())
                    .text_size(px(12.))
                    .text_color(cx.theme().muted_foreground)
                    .child(self.panel_state.read(cx).output.join("\n")),
            )
    }
}
impl Focusable for Lightship {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.workspace.read(cx).active_focus_handle(cx)
    }
}
impl Render for Lightship {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let search = chrome::search_button("Lightship", cx)
            .on_click(cx.listener(|this, _, window, cx| this.search(window, cx)));
        let title = chrome::title_bar(cx).child(chrome::title_content(
            search,
            Button::new("toggle-panel")
                .icon(IconName::PanelBottom)
                .ghost()
                .xsmall()
                .accessibility_label("Toggle panel")
                .on_click(cx.listener(|this, _, window, cx| this.toggle_panel(window, cx))),
        ));
        let activity = chrome::activity_bar()
            .child(
                Button::new("activity-explorer")
                    .icon(IconName::Files)
                    .ghost()
                    .size(px(36.))
                    .selected(self.layout.read(cx).sidebar_visible)
                    .accessibility_label("Explorer")
                    .tooltip("Toggle Explorer")
                    .on_click(cx.listener(|this, _, window, cx| this.toggle_sidebar(window, cx))),
            )
            .child(
                Button::new("activity-search")
                    .icon(IconName::Search)
                    .ghost()
                    .size(px(36.))
                    .accessibility_label("Search")
                    .on_click(cx.listener(|this, _, window, cx| this.search(window, cx))),
            )
            .child(div().flex_1())
            .child(
                Button::new("toggle-appearance")
                    .icon(if cx.theme().mode.is_dark() {
                        IconName::Sun
                    } else {
                        IconName::Moon
                    })
                    .ghost()
                    .size(px(36.))
                    .accessibility_label("Toggle appearance")
                    .on_click(cx.listener(|this, _, _, cx| this.toggle_theme(cx))),
            );
        div()
            .size_full()
            .key_context("Lightship")
            .on_action(cx.listener(|this, _: &Search, window, cx| this.search(window, cx)))
            .on_action(
                cx.listener(|this, _: &ToggleSidebar, window, cx| this.toggle_sidebar(window, cx)),
            )
            .on_action(
                cx.listener(|this, _: &TogglePanel, window, cx| this.toggle_panel(window, cx)),
            )
            .child(
                chrome::Workbench::new(
                    &self.layout,
                    if self.connections.read(cx).settings.connections.is_empty() {
                        div()
                            .size_full()
                            .flex()
                            .flex_col()
                            .items_center()
                            .justify_center()
                            .gap_4()
                            .child("Lightship · Kubernetes, read-only")
                            .child("Add a cluster to browse resources, events and logs.")
                            .child(
                                Button::new("add-first-cluster")
                                    .label("Add cluster")
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.add_cluster(window, cx)
                                    })),
                            )
                            .into_any_element()
                    } else {
                        self.workspace.clone().into_any_element()
                    },
                )
                .title(title)
                .activity(activity)
                .sidebar(chrome::sidebar(
                    "lightship-sidebar",
                    "Clusters · Read-only",
                    div()
                        .size_full()
                        .min_h_0()
                        .flex()
                        .flex_col()
                        .child(
                            Button::new("add-cluster")
                                .label("+ Add cluster")
                                .small()
                                .on_click(
                                    cx.listener(|this, _, window, cx| this.add_cluster(window, cx)),
                                ),
                        )
                        .child(
                            Button::new("manage-clusters")
                                .label("Manage clusters")
                                .small()
                                .ghost()
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.manage_clusters(window, cx)
                                })),
                        )
                        .child(div().flex_1().min_h_0().child(self.navigation.clone())),
                    cx,
                ))
                .panel(self.panel(cx))
                .status(chrome::status_bar(
                    "Lightship",
                    "Read-only · No cluster mutations",
                    cx,
                )),
            )
    }
}
fn initialize(cx: &mut App) {
    pintle_gpui_kit::init(cx);
    cx.bind_keys([
        KeyBinding::new(
            if cfg!(target_os = "macos") {
                "cmd-k"
            } else {
                "ctrl-k"
            },
            Search,
            Some("Lightship"),
        ),
        KeyBinding::new(
            if cfg!(target_os = "macos") {
                "cmd-b"
            } else {
                "ctrl-b"
            },
            ToggleSidebar,
            Some("Lightship"),
        ),
        KeyBinding::new(
            if cfg!(target_os = "macos") {
                "cmd-j"
            } else {
                "ctrl-j"
            },
            TogglePanel,
            Some("Lightship"),
        ),
        KeyBinding::new(
            if cfg!(target_os = "macos") {
                "cmd-q"
            } else {
                "ctrl-q"
            },
            Quit,
            None,
        ),
    ]);
    cx.on_action(|_: &Quit, cx| cx.quit());
    cx.set_menus(vec![Menu {
        name: "Lightship".into(),
        items: vec![MenuItem::action("Quit", Quit)],
        disabled: false,
    }]);
    cx.on_window_closed(|cx, _| {
        if cx.windows().is_empty() {
            cx.quit();
        }
    })
    .detach();
}
fn main() {
    gpui::application()
        .with_assets(gpui::assets::AllAssets)
        .run(|cx| {
            initialize(cx);
            gpui::open_window(chrome::window_options(cx), cx, |window, cx| {
                window.set_window_title("Lightship");
                cx.new(|cx| Lightship::new(window, cx))
            })
            .expect("open Lightship window");
            cx.activate(true);
        });
}
