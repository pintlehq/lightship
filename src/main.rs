//! Lightship owns Kubernetes presentation; Pintle owns the shared desktop UI.
use gpui::TestSupportExt;
use gpui::assets::IconName;
use gpui::component::{
    ActiveTheme, Sizable, WindowExt,
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
gpui::actions!(
    lightship,
    [
        Quit,
        Search,
        ToggleSidebar,
        TogglePanel,
        OpenSettings,
        SwitchTheme
    ]
);

mod backend;
mod catalog;
mod confirm;
mod connections;
mod data_editor;
mod desktop;
mod detail_page;
mod inspector;
mod logs;
mod onboarding;
mod overview_chart;
mod overview_page;
mod resource_page;
mod sessions;
mod yaml_editor;
mod yaml_page;
use detail_page::{DetailPage, DetailTarget, Routes};
use overview_page::OverviewPage;
use resource_page::{Inspect, PanelState, ResourcePage};
struct Lightship {
    workspace: Entity<Workspace>,
    connections: Entity<connections::Connections>,
    navigation: Entity<NavigationTree>,
    layout: Entity<WorkbenchState>,
    sidebar_size: Entity<gpui::component::resizable::ResizableState>,
    panel_size: Entity<gpui::component::resizable::ResizableState>,
    sessions: Entity<sessions::Sessions>,
    show_terminal: bool,
    metric_cluster: Option<String>,
    metric_lease: Option<backend::overview::OverviewLease>,
    metrics: Option<backend::overview::OverviewSnapshot>,
    _metric_poll: gpui::Task<()>,
    palette: CommandPalette,
    detail_routes: Routes,
    log_routes: logs::LogRoutes,
    panel_state: Entity<PanelState>,
    panel_focus: FocusHandle,
    closing: bool,
    close_task: Option<gpui::Task<()>>,
    _subscriptions: Vec<Subscription>,
}
impl Lightship {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let backend = backend::Backend::new();
        let connections = cx.new(|cx| connections::Connections::new(backend.clone(), window, cx));
        let preference = connections.read(cx).settings.appearance().to_owned();
        desktop::set_appearance(&preference, window, cx);
        let appearance = cx.observe_window_appearance(window, |this: &mut Self, window, cx| {
            if this.connections.read(cx).settings.appearance() == "system" {
                desktop::set_appearance("system", window, cx);
            }
        });
        let documents = connections.read(cx).documents();
        let panel_state = cx.new(|_| PanelState::load());
        let detail_routes: Routes = Rc::new(RefCell::new(HashMap::new()));
        let routes = detail_routes.clone();
        let log_routes: logs::LogRoutes = Default::default();
        let logs = log_routes.clone();
        let sessions = cx.new(sessions::Sessions::new);
        let session_observer = cx.observe(&sessions, |_, _, cx| cx.notify());
        let forward_page = sessions.clone();
        let page_panel = panel_state.clone();
        let page_connections = connections.clone();
        let workspace = cx.new(|cx| {
            Workspace::new(
                Rc::new(move |document, window, cx| {
                    if let Some(pods) = logs.borrow().get(document.key.0.as_ref()).cloned() {
                        let cluster = document.key.0.split_once('/').unwrap().0.to_owned();
                        return WorkspacePage::new(
                            cx.new(|cx| {
                                logs::Logs::new(cluster, pods, backend.clone(), window, cx)
                            }),
                            cx,
                        );
                    }
                    if document.key.0.as_ref() == "app/forwards" {
                        return WorkspacePage::new(forward_page.clone(), cx);
                    }
                    if document.key.0.as_ref() == "app/clusters" {
                        return WorkspacePage::new(page_connections.clone(), cx);
                    }
                    if document.key.0.as_ref() == "app/history" {
                        let panel = page_panel.clone();
                        return WorkspacePage::new(
                            cx.new(|cx| desktop::History::new(panel, window, cx)),
                            cx,
                        );
                    }
                    if let Some(target) = routes.borrow().get(document.key.0.as_ref()).cloned() {
                        let cluster_name = page_connections
                            .read(cx)
                            .settings
                            .connections
                            .iter()
                            .find(|c| c.id == target.cluster)
                            .map(|c| c.name.clone())
                            .unwrap_or_else(|| document.context.to_string());
                        let page =
                            cx.new(|cx| DetailPage::new(target, document, backend.clone(), cx));
                        page.update(cx, |page, _| page.cluster_name = cluster_name);
                        page.update(cx, |page, _| page.output = Some(page_panel.clone()));
                        let guard = page.clone();
                        return WorkspacePage::new(page, cx).before_close(move |window, cx| {
                            guard.update(cx, |page, cx| page.permit_close(window, cx))
                        });
                    }
                    if let Some((cluster, namespace)) = document.key.0.split_once("/apply-yaml:") {
                        let page = cx.new(|cx| {
                            yaml_page::YamlPage::new(
                                cluster.into(),
                                document.context.to_string(),
                                (namespace != "_").then(|| namespace.to_string()),
                                backend.clone(),
                                page_panel.clone(),
                                cx,
                            )
                        });
                        let guard = page.clone();
                        return WorkspacePage::new(page, cx).before_close(move |window, cx| {
                            guard.update(cx, |page, cx| page.permit_close(window, cx))
                        });
                    }
                    if document
                        .key
                        .0
                        .split_once('/')
                        .is_some_and(|(_, key)| key == "overview")
                    {
                        return WorkspacePage::new(
                            cx.new(|cx| {
                                OverviewPage::new(document, page_panel.clone(), backend.clone(), cx)
                            }),
                            cx,
                        );
                    }
                    let page = cx.new(|cx| {
                        ResourcePage::new(document, page_panel.clone(), backend.clone(), window, cx)
                    });
                    let guard = page.clone();
                    WorkspacePage::new(page, cx).before_close(move |window, cx| {
                        guard.update(cx, |page, cx| page.permit_close(window, cx))
                    })
                }),
                window,
                cx,
            )
        });
        let close_owner = cx.weak_entity();
        window.on_window_should_close(cx, move |window, cx| {
            let _ = close_owner.update(cx, |this, cx| this.request_close(false, window, cx));
            false
        });
        let close_workspace = workspace.downgrade();
        connections.update(cx, |manager, _| {
            manager.before_remove = Some(Rc::new(move |id, window, cx| {
                let Some(workspace) = close_workspace.upgrade() else {
                    return gpui::Task::ready(true);
                };
                let prefix = format!("{id}/");
                let ids = workspace
                    .read(cx)
                    .groups(cx)
                    .into_iter()
                    .flat_map(|g| g.views)
                    .filter(|id| {
                        workspace
                            .read(cx)
                            .document(*id, cx)
                            .is_some_and(|d| d.key.0.starts_with(&prefix))
                    })
                    .collect::<Vec<_>>();
                workspace.update(cx, |w, cx| w.confirm_close(&ids, window, cx))
            }))
        });
        let navigation = cx.new(|cx| {
            NavigationTree::with_options(
                connections.read(cx).navigation(),
                pintle_gpui_kit::shell::workspace::NavigationTreeOptions {
                    row_height: px(26.),
                    font_family: Some("JetBrains Mono".into()),
                    initial_expanded: Some(
                        connections
                            .read(cx)
                            .settings
                            .connections
                            .iter()
                            .map(|c| format!("{}/Workloads", c.id).into())
                            .collect(),
                    ),
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
                                    .unwrap_or("not checked");
                                div()
                                    .text_size(px(10.))
                                    .text_color(cx.theme().muted_foreground)
                                    .child(if status.starts_with("Connected") {
                                        "● connected"
                                    } else if status.starts_with("Connecting") {
                                        "● connecting"
                                    } else if status == "not checked" {
                                        "●"
                                    } else {
                                        "● error"
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
        let menu_owner = cx.weak_entity();
        navigation.update(cx, |nav, _| {
            nav.set_context_menu(Rc::new(move |id, mut menu, _, cx| {
                use gpui::component::menu::PopupMenuItem;
                let Some(owner) = menu_owner.upgrade() else {
                    return menu;
                };
                let manager = owner.read(cx).connections.clone();
                let cluster = id.split('/').next().unwrap_or("").to_owned();
                if !manager
                    .read(cx)
                    .settings
                    .connections
                    .iter()
                    .any(|c| c.id == cluster)
                {
                    return menu;
                }
                if let Some(doc) = manager
                    .read(cx)
                    .documents()
                    .into_iter()
                    .find(|d| d.key.0 == id)
                {
                    let workspace = owner.read(cx).workspace.clone();
                    menu = menu.item(PopupMenuItem::new("Open tab").on_click(move |_, w, cx| {
                        workspace.update(cx, |ws, cx| {
                            ws.open(doc.clone(), OpenMode::Permanent, w, cx)
                        });
                    }));
                }
                let reconnect = cluster.clone();
                menu.item(
                    PopupMenuItem::new("Refresh connection").on_click(move |_, _, cx| {
                        manager.update(cx, |m, cx| {
                            m.connect(&reconnect);
                            cx.notify()
                        })
                    }),
                )
                .item(
                    PopupMenuItem::new("New terminal").on_click(move |_, w, cx| {
                        owner.update(cx, |p, cx| p.new_terminal(Some(&cluster), None, w, cx))
                    }),
                )
            }));
        });
        navigation.read(cx).search.clone().update(cx, |field, cx| {
            field.set_placeholder("filter tree…", window, cx)
        });
        let timer = cx.background_executor().clone();
        let metric_poll = cx.spawn(async move |owner, cx| {
            loop {
                timer.timer(std::time::Duration::from_secs(1)).await;
                if owner
                    .update(cx, |p: &mut Lightship, cx| {
                        let doc = p
                            .workspace
                            .read(cx)
                            .active_view(cx)
                            .and_then(|v| p.workspace.read(cx).document(v, cx));
                        let manager = p.connections.read(cx);
                        let cluster = doc
                            .as_ref()
                            .and_then(|d| d.key.0.split_once('/'))
                            .and_then(|(id, _)| {
                                manager.settings.connections.iter().find(|c| c.id == id)
                            })
                            .filter(|c| {
                                manager
                                    .status
                                    .get(&c.id)
                                    .is_some_and(|s| s.starts_with("Connected"))
                            })
                            .map(|c| c.id.clone());
                        if cluster != p.metric_cluster
                            || p.metric_lease.as_ref().is_some_and(|l| l.invalidated())
                        {
                            p.metrics = None;
                            p.metric_lease =
                                cluster.as_deref().map(|id| manager.backend.overview(id));
                            p.metric_cluster = cluster;
                            cx.notify();
                        }
                        if let Some(s) = p.metric_lease.as_mut().and_then(|l| l.take()) {
                            p.metrics = s.snapshot;
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        let tree_state = navigation.read(cx).state.clone();
        let expand = cx.subscribe(
            &tree_state,
            |this: &mut Self, _, e: &gpui::component::tree::TreeEvent, cx| {
                if let gpui::component::tree::TreeEvent::Expanded(id) = e {
                    this.connections.update(cx, |m, cx| {
                        if m.settings.connections.iter().any(|c| c.id == id.as_ref())
                            && !m.status.get(id.as_ref()).is_some_and(|s| {
                                s.starts_with("Connected") || s.starts_with("Connecting")
                            })
                        {
                            m.connect(id);
                            cx.notify();
                        }
                    });
                }
            },
        );
        let layout = cx.new(|cx| {
            let mut layout = WorkbenchState::new(cx);
            layout.panel_visible = false;
            layout
        });
        let panel_observe = cx.observe(&panel_state, |_, _, cx| cx.notify());
        let add_from_manager = cx.subscribe_in(
            &connections,
            window,
            |this, _, _: &connections::RequestAddCluster, w, cx| this.add_cluster(w, cx),
        );
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
                    workspace.open(event.document.clone(), OpenMode::Permanent, window, cx);
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
                if !visible.contains(&view)
                    && let Some(page) = workspace
                        .read(cx)
                        .page(view, cx)
                        .and_then(|p| p.downcast::<logs::Logs>().ok())
                {
                    page.update(cx, |p, cx| p.hide(cx));
                }
                if let Some(page) = workspace
                    .read(cx)
                    .page(view, cx)
                    .and_then(|p| p.downcast::<DetailPage>().ok())
                {
                    page.update(cx, |page, cx| page.set_visible(visible.contains(&view), cx));
                }
                if let Some(page) = workspace
                    .read(cx)
                    .page(view, cx)
                    .and_then(|p| p.downcast::<yaml_page::YamlPage>().ok())
                {
                    page.update(cx, |page, cx| page.set_visible(visible.contains(&view), cx));
                }
            }
            this.log_routes
                .borrow_mut()
                .retain(|key, _| open_keys.contains(key));
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
        entries.extend(Self::commands());
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
                this.sessions.update(cx, |s, cx| {
                    s.retain(&connections.iter().map(|c| c.id.clone()).collect(), cx)
                });
                removed.extend(
                    this.detail_routes
                        .borrow()
                        .iter()
                        .filter(|(_, target)| !connections.iter().any(|c| c.id == target.cluster))
                        .map(|(key, _)| key.as_str().into()),
                );
                for view in this
                    .workspace
                    .read(cx)
                    .groups(cx)
                    .into_iter()
                    .flat_map(|g| g.views)
                {
                    if let Some(doc) = this.workspace.read(cx).document(view, cx)
                        && let Some((id, _)) = doc.key.0.split_once('/').filter(|(_, key)| {
                            key.starts_with("apply-yaml:") || key.starts_with("logs:")
                        })
                        && !connections.iter().any(|c| c.id == id)
                    {
                        removed.push(doc.key.clone());
                    }
                }
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
                    for view in workspace.groups(cx).into_iter().flat_map(|g| g.views) {
                        if let Some(document) = workspace.document(view, cx)
                            && let Some((id, _)) = document.key.0.split_once("/apply-yaml:")
                            && let Some(connection) = connections.iter().find(|c| c.id == id)
                        {
                            let updated = pintle_gpui_kit::shell::workspace::Document::new(
                                document.key.clone(),
                                "Apply YAML",
                                connection.name.clone(),
                            );
                            workspace.update_document_metadata(&updated, cx);
                            if let Some(page) = workspace
                                .page(view, cx)
                                .and_then(|p| p.downcast::<yaml_page::YamlPage>().ok())
                            {
                                page.update(cx, |page, cx| {
                                    page.rename(connection.name.clone(), cx)
                                });
                            }
                        }
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
                            page.update(cx, |page, cx| {
                                page.rename(&document, cx);
                                if let Some(connection) =
                                    connections.iter().find(|c| c.id == page.target.cluster)
                                {
                                    page.cluster_name = connection.name.clone();
                                    if let Some(data) = &page.data_editor {
                                        data.update(cx, |data, cx| {
                                            data.rename_context(connection.name.clone(), cx)
                                        });
                                    }
                                }
                            });
                        }
                        if let Some(document) = workspace.document(view, cx)
                            && let Some(page) = workspace
                                .page(view, cx)
                                .and_then(|p| p.downcast::<OverviewPage>().ok())
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
            sessions,
            show_terminal: true,
            metric_cluster: None,
            metric_lease: None,
            metrics: None,
            _metric_poll: metric_poll,
            layout,
            palette,
            detail_routes,
            log_routes,
            panel_state,
            panel_focus: cx.focus_handle(),
            sidebar_size: cx.new(|_| Default::default()),
            panel_size: cx.new(|_| Default::default()),
            closing: false,
            close_task: None,
            _subscriptions: vec![
                nav,
                layout_sub,
                session_observer,
                appearance,
                expand,
                workspace_sub,
                panel_observe,
                inspect,
                connection_changes,
                add_from_manager,
            ],
        }
    }
    fn commands() -> Vec<CommandEntry> {
        vec![
            CommandEntry::new("apply-yaml", "Commands", "Apply YAML…"),
            CommandEntry::new("add-cluster", "Commands", "Add Cluster"),
            CommandEntry::new("manage-clusters", "Commands", "Manage Clusters"),
            CommandEntry::new("toggle-sidebar", "Commands", "Toggle Sidebar"),
            CommandEntry::new("toggle-panel", "Commands", "Toggle Panel"),
            CommandEntry::new("terminal", "Commands", "New cluster terminal"),
            CommandEntry::new("port-forwards", "Commands", "Port forwards"),
            CommandEntry::new("history", "Commands", "History"),
            CommandEntry::new("settings", "Commands", "Open settings"),
            CommandEntry::new("toggle-theme", "Commands", "Toggle Appearance"),
        ]
    }
    fn request_close(&mut self, quit: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.closing {
            return;
        }
        self.closing = true;
        let ids = self
            .workspace
            .read(cx)
            .groups(cx)
            .into_iter()
            .flat_map(|g| g.views)
            .collect::<Vec<_>>();
        let permission = self
            .workspace
            .update(cx, |w, cx| w.confirm_close(&ids, window, cx));
        self.close_task = Some(cx.spawn_in(window, async move |owner, cx| {
            let allowed = permission.await;
            let _ = cx.update(|window, cx| {
                owner.update(cx, |this, cx| {
                    this.closing = false;
                    if allowed {
                        this.connections
                            .update(cx, |m, _| m.save_window(window.window_bounds()));
                        if quit {
                            cx.quit();
                        } else {
                            window.remove_window();
                        }
                    }
                })
            });
        }));
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
        crate::desktop::open_dialog(window, cx, move |dialog, window, cx| {
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
        self.open_utility("app/clusters", "Manage clusters", window, cx);
    }
    fn open_utility(
        &mut self,
        key: &'static str,
        title: &'static str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let doc = pintle_gpui_kit::shell::workspace::Document::new(key, title, "Lightship");
        self.workspace
            .update(cx, |w, cx| w.open(doc, OpenMode::Permanent, window, cx));
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
                        "terminal" => this.new_terminal(None, None, window, cx),
                        "port-forwards" => {
                            this.open_utility("app/forwards", "Port forwards", window, cx)
                        }
                        "history" => this.open_utility("app/history", "History", window, cx),
                        "settings" => this.settings(window, cx),
                        "toggle-theme" => this.toggle_theme(cx),
                        "add-cluster" => this.add_cluster(window, cx),
                        "apply-yaml" => this.apply_yaml(window, cx),
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
    fn apply_yaml(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let connections = self.connections.read(cx).settings.connections.clone();
        let active = self.workspace.read(cx).active_view(cx);
        let document = active.and_then(|view| self.workspace.read(cx).document(view, cx));
        let cluster = document
            .as_ref()
            .and_then(|doc| doc.key.0.split_once('/'))
            .map(|(id, _)| id.to_string())
            .filter(|id| connections.iter().any(|c| c.id == *id))
            .or_else(|| (connections.len() == 1).then(|| connections[0].id.clone()));
        if let Some(cluster) = cluster {
            let namespace = active
                .and_then(|view| self.workspace.read(cx).page(view, cx))
                .and_then(|p| {
                    if let Ok(page) = p.clone().downcast::<ResourcePage>() {
                        return page
                            .read(cx)
                            .table
                            .read(cx)
                            .delegate()
                            .single_namespace()
                            .map(str::to_owned);
                    }
                    if let Ok(page) = p.downcast::<DetailPage>() {
                        return page.read(cx).target.seed["metadata"]["namespace"]
                            .as_str()
                            .map(str::to_owned);
                    }
                    None
                });
            self.open_resource(
                &Inspect {
                    cluster,
                    key: "apply-yaml".into(),
                    object: serde_json::json!({"metadata":{"namespace":namespace}}),
                },
                window,
                cx,
            );
            return;
        }
        let owner = cx.entity();
        crate::desktop::open_dialog(window, cx, move |dialog, _, _| {
            dialog.title("Choose cluster for Apply YAML").child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .children(connections.iter().map(|connection| {
                        let owner = owner.clone();
                        let cluster = connection.id.clone();
                        Button::new(gpui::SharedString::from(cluster.clone()))
                            .label(connection.name.clone())
                            .on_click(move |_, window, cx| {
                                window.close_dialog(cx);
                                owner.update(cx, |this, cx| {
                                    this.open_resource(
                                        &Inspect {
                                            cluster: cluster.clone(),
                                            key: "apply-yaml".into(),
                                            object: serde_json::json!({}),
                                        },
                                        window,
                                        cx,
                                    )
                                });
                            })
                    })),
            )
        });
    }
    fn open_resource(&mut self, event: &Inspect, window: &mut Window, cx: &mut Context<Self>) {
        if event.key == "logs" {
            if let Some(pods) = event.object.as_array().filter(|p| !p.is_empty()) {
                if pods.len() > 16 {
                    crate::desktop::open_dialog(window, cx, |d, _, _| {
                        d.title("Open Pod logs")
                            .centered()
                            .child("Select up to 16 Pods to stream their logs together.")
                    });
                    return;
                }
                use sha2::{Digest, Sha256};
                let mut ids = pods
                    .iter()
                    .filter_map(|p| p["metadata"]["uid"].as_str())
                    .collect::<Vec<_>>();
                ids.sort_unstable();
                ids.dedup();
                if ids.len() != pods.len() {
                    return;
                }
                let key = format!(
                    "{}/logs:{:x}",
                    event.cluster,
                    Sha256::digest(ids.join("\n"))
                );
                self.log_routes
                    .borrow_mut()
                    .insert(key.clone(), pods.clone());
                let context = self
                    .connections
                    .read(cx)
                    .settings
                    .connections
                    .iter()
                    .find(|c| c.id == event.cluster)
                    .map(|c| c.name.clone())
                    .unwrap_or_else(|| event.cluster.clone());
                let doc = pintle_gpui_kit::shell::workspace::Document::new(
                    key.as_str(),
                    format!("Logs · {} Pods", pods.len()),
                    context,
                );
                self.workspace
                    .update(cx, |w, cx| w.open(doc, OpenMode::Permanent, window, cx));
            }
            return;
        }
        if event.key == "terminal" || event.key == "forward" {
            let value = &event.object;
            if let (Some(ns), Some(name)) = (value["namespace"].as_str(), value["name"].as_str()) {
                if event.key == "terminal" {
                    if let Some(container) = value["container"].as_str() {
                        self.new_terminal(
                            Some(&event.cluster),
                            Some((ns, name, container, value["uid"].as_str().unwrap_or(""))),
                            window,
                            cx,
                        );
                    }
                } else if let Some(kind) = value["resource"].as_str() {
                    self.forward_dialog(
                        &event.cluster,
                        format!("{kind}/{name}"),
                        ns.to_string(),
                        value["uid"].as_str().unwrap_or("").into(),
                        window,
                        cx,
                    );
                }
            }
            return;
        }
        let cluster_name = self
            .connections
            .read(cx)
            .settings
            .connections
            .iter()
            .find(|c| c.id == event.cluster)
            .map(|c| c.name.clone())
            .unwrap_or_else(|| event.cluster.clone());
        if event.key == "apply-yaml" {
            let namespace = event.object["metadata"]["namespace"]
                .as_str()
                .unwrap_or("_");
            let document = pintle_gpui_kit::shell::workspace::Document::new(
                format!("{}/apply-yaml:{namespace}", event.cluster).as_str(),
                "Apply YAML",
                cluster_name,
            );
            self.workspace.update(cx, |workspace, cx| {
                workspace.open(document, OpenMode::Permanent, window, cx);
            });
            return;
        }
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
    fn panel(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        chrome::frame("lightship-panel", cx)
            .bg(cx.theme().background)
            .child(
                chrome::panel_tabs("lightship-panel-tabs")
                    .child(
                        chrome::panel_tab("terminal-panel-tab", "Terminal", self.show_terminal)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.show_terminal = true;
                                cx.notify()
                            })),
                    )
                    .child(
                        chrome::panel_tab("output-panel-tab", "Output", !self.show_terminal)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.show_terminal = false;
                                cx.notify()
                            }))
                            .track_focus(&self.panel_focus),
                    )
                    .child(div().flex_1())
                    .child(
                        Button::new("new-terminal")
                            .ghost()
                            .xsmall()
                            .icon(IconName::Plus)
                            .tooltip("New cluster terminal")
                            .on_click(
                                cx.listener(|this, _, w, cx| this.new_terminal(None, None, w, cx)),
                            ),
                    )
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
            .when(self.show_terminal, |d| {
                let sessions = self.sessions.read(cx);
                if sessions.terminal_count() == 0 && sessions.error.is_empty() {
                    d.child(
                        div()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .items_center()
                            .justify_center()
                            .gap_4()
                            .text_color(cx.theme().muted_foreground)
                            .child(gpui::component::Icon::new(IconName::Terminal).size(px(23.)))
                            .child("Open a shell in the selected cluster context.")
                            .child(
                                Button::new("panel-start-terminal")
                                    .primary()
                                    .small()
                                    .icon(IconName::Plus)
                                    .label("New terminal")
                                    .on_click(
                                        cx.listener(|p, _, w, cx| {
                                            p.new_terminal(None, None, w, cx)
                                        }),
                                    ),
                            ),
                    )
                } else {
                    d.child(sessions::terminal_surface(&self.sessions, cx))
                }
            })
            .when(!self.show_terminal, |d| {
                d.child(
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
            })
    }
}
impl Focusable for Lightship {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.workspace.read(cx).active_focus_handle(cx)
    }
}
impl Render for Lightship {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let desktop = self.desktop(window, cx);
        div()
            .size_full()
            .key_context("Lightship")
            .on_action(cx.listener(|this, _: &Quit, window, cx| {
                cx.stop_propagation();
                this.request_close(true, window, cx);
            }))
            .on_action(cx.listener(|this, _: &Search, window, cx| this.search(window, cx)))
            .on_action(
                cx.listener(|this, _: &ToggleSidebar, window, cx| this.toggle_sidebar(window, cx)),
            )
            .on_action(
                cx.listener(|this, _: &TogglePanel, window, cx| this.toggle_panel(window, cx)),
            )
            .on_action(cx.listener(|this, _: &OpenSettings, w, cx| this.settings(w, cx)))
            .on_action(cx.listener(|this, _: &SwitchTheme, _, cx| this.toggle_theme(cx)))
            .child(desktop)
    }
}
fn initialize(cx: &mut App) {
    pintle_gpui_kit::init(cx);
    desktop::install_theme(cx);
    cx.bind_keys([
        KeyBinding::new(
            if cfg!(target_os = "macos") {
                "cmd-,"
            } else {
                "ctrl-,"
            },
            OpenSettings,
            Some("Lightship"),
        ),
        KeyBinding::new(
            if cfg!(target_os = "macos") {
                "cmd-shift-l"
            } else {
                "ctrl-shift-l"
            },
            SwitchTheme,
            Some("Lightship"),
        ),
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
    #[cfg(not(target_os = "macos"))]
    cx.on_window_closed(|cx, _| {
        if cx.windows().is_empty() {
            cx.quit();
        }
    })
    .detach();
}
fn open_desktop(cx: &mut App) {
    gpui::open_window(desktop::window_options(cx), cx, |w, cx| {
        w.set_window_title("Lightship");
        cx.new(|cx| Lightship::new(w, cx))
    })
    .expect("open Lightship window");
    cx.activate(true);
}
fn main() {
    let app = gpui::application().with_assets(gpui::assets::AllAssets);
    app.on_reopen(|cx| {
        if cx.windows().is_empty() {
            open_desktop(cx)
        } else {
            cx.activate(true)
        }
    });
    app.run(|cx| {
        initialize(cx);
        open_desktop(cx)
    });
}
