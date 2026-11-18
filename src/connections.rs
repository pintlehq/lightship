//! Application-owned cluster onboarding and local settings.
use crate::backend::{
    Backend, Job, Spec,
    config::{self, Connection, Settings, Source},
};

use gpui::component::{
    ActiveTheme, Disableable, Sizable,
    button::{Button, ButtonVariants},
    input::{Input, InputState},
};
use gpui::{prelude::*, *};
use pintle_gpui_kit::{
    kit as gpui,
    shell::workspace::{Document, NavigationNode},
};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Duration,
};
type RemoveGuard = std::rc::Rc<dyn Fn(&str, &mut Window, &mut App) -> Task<bool>>;
pub struct RequestAddCluster;
impl EventEmitter<RequestAddCluster> for Connections {}
pub struct Connections {
    focus: FocusHandle,
    editing: Option<String>,
    pub backend: Arc<Backend>,
    pub settings: Settings,
    pub status: HashMap<String, String>,
    pub specs: HashMap<String, Vec<Spec>>,
    jobs: HashMap<String, Job<Vec<Spec>>>,
    descriptions: HashMap<String, String>,
    reviews: HashMap<String, Option<String>>,
    rename: Entity<InputState>,
    pub error: String,
    persistence_ok: bool,
    pub before_remove: Option<RemoveGuard>,
    remove_task: Option<Task<()>>,
    _poll: Task<()>,
}
impl Connections {
    pub fn new(backend: Arc<Backend>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        #[cfg(not(test))]
        let (settings, persistence_ok, error) = match config::load() {
            Ok(settings) => (settings, true, String::new()),
            Err(e) => (Settings::default(), false, e),
        };
        #[cfg(test)]
        let (settings, persistence_ok, error) = (Settings::default(), true, String::new());
        let rename = cx.new(|cx| InputState::new(window, cx).placeholder("New display name"));
        let timer = cx.background_executor().clone();
        let poll = cx.spawn(async move |entity, cx| {
            loop {
                timer.timer(Duration::from_millis(200)).await;
                if entity.update(cx, |this, cx| this.poll(cx)).is_err() {
                    break;
                }
            }
        });
        Self {
            backend,
            settings,
            status: HashMap::new(),
            specs: HashMap::new(),
            jobs: HashMap::new(),
            descriptions: HashMap::new(),
            reviews: HashMap::new(),
            rename,
            focus: cx.focus_handle(),
            editing: None,
            error,
            persistence_ok,
            before_remove: None,
            remove_task: None,
            _poll: poll,
        }
    }
    fn poll(&mut self, cx: &mut Context<Self>) {
        let mut complete = Vec::new();
        for (id, job) in &mut self.jobs {
            if let Some(result) = job.take() {
                match result {
                    Ok(specs) => {
                        self.specs.insert(id.clone(), specs);
                        self.status.insert(id.clone(), "Connected".into());
                    }
                    Err(e) => {
                        self.status.insert(id.clone(), e);
                    }
                }
                complete.push(id.clone());
            }
        }
        let mut changed = false;
        for c in &self.settings.connections {
            if (!self.jobs.contains_key(&c.id) || complete.contains(&c.id))
                && let Some(status) = self.backend.connection_status(&c.id)
                && self.status.get(&c.id) != Some(&status)
            {
                self.status.insert(c.id.clone(), status);
                changed = true;
            }
        }
        if !complete.is_empty() {
            for id in complete {
                self.jobs.remove(&id);
            }
            cx.notify();
        } else if changed {
            cx.notify();
        }
    }
    pub fn connect(&mut self, id: &str) {
        if let Some(connection) = self
            .settings
            .connections
            .iter()
            .find(|c| c.id == id)
            .cloned()
        {
            let description = connection
                .read()
                .map(|mut config| {
                    let fingerprint = config::prepare(&mut config, &connection.context)
                        .ok()
                        .flatten();
                    self.reviews.insert(id.into(), fingerprint);
                    config::plugin_description(&config, &connection.context)
                })
                .unwrap_or_default();
            self.descriptions.insert(id.into(), description);
            self.jobs.remove(id);
            self.status.insert(id.into(), "Connecting…".into());
            self.jobs
                .insert(id.into(), self.backend.connect(connection));
        }
    }
    fn save_settings(&self) -> Result<(), String> {
        #[cfg(not(test))]
        {
            config::save(&self.settings)
        }
        #[cfg(test)]
        {
            Ok(())
        }
    }
    fn persist(&mut self) -> bool {
        if !self.persistence_ok {
            self.error =
                "Local settings could not be loaded; repair that file before saving".into();
            return false;
        }
        if let Err(e) = self.save_settings() {
            self.error = e;
            false
        } else {
            self.error.clear();
            true
        }
    }
    pub fn save_appearance(&mut self, dark: bool) {
        self.settings.theme = Some(if dark { "dark" } else { "light" }.into());
        self.settings.dark = dark;
        self.persist();
    }
    pub fn save_theme(&mut self, theme: &str) {
        self.settings.theme = Some(theme.to_owned());
        self.settings.dark = theme == "dark";
        self.persist();
    }
    pub fn save_window(&mut self, state: WindowBounds) {
        let bounds = state.get_bounds();
        self.settings.window = Some(config::SavedWindow {
            bounds: [
                bounds.origin.x.into(),
                bounds.origin.y.into(),
                bounds.size.width.into(),
                bounds.size.height.into(),
            ],
            mode: match state {
                WindowBounds::Maximized(_) => "maximized",
                WindowBounds::Fullscreen(_) => "fullscreen",
                _ => "normal",
            }
            .into(),
        });
        self.persist();
    }
    fn move_connection(&mut self, id: &str, direction: isize, cx: &mut Context<Self>) {
        let Some(from) = self.settings.connections.iter().position(|c| c.id == id) else {
            return;
        };
        let Some(to) = from
            .checked_add_signed(direction)
            .filter(|&i| i < self.settings.connections.len())
        else {
            return;
        };
        self.settings.connections.swap(from, to);
        if !self.persist() {
            self.settings.connections.swap(from, to);
        }
        cx.notify();
    }
    /// Persist an already reviewed import atomically, then start guarded connections.
    pub fn import(
        &mut self,
        source: Option<&Source>,
        yaml: &str,
        targets: &[(String, Option<String>)],
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        self.import_using(
            source,
            yaml,
            targets,
            config::keychain_write,
            config::keychain_delete,
            cx,
        )
    }
    fn import_using(
        &mut self,
        source: Option<&Source>,
        yaml: &str,
        targets: &[(String, Option<String>)],
        mut write_key: impl FnMut(&str, &str) -> Result<(), String>,
        mut delete_key: impl FnMut(&str) -> Result<(), String>,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        let old = self.settings.connections.clone();
        let mut added = Vec::new();
        let mut saved_keys = Vec::new();
        let result = (|| {
            for (context, fingerprint) in targets {
                let id = uuid::Uuid::new_v4().to_string();
                let source = if let Some(source) = source {
                    source.clone()
                } else {
                    write_key(&id, yaml)?;
                    saved_keys.push(id.clone());
                    Source::Keychain(id.clone())
                };
                self.settings.connections.push(Connection {
                    id: id.clone(),
                    name: context.clone(),
                    context: context.clone(),
                    source,
                    trusted_exec: fingerprint.clone(),
                });
                added.push(id);
            }
            if self.persist() {
                Ok(())
            } else {
                Err(self.error.clone())
            }
        })();
        if let Err(error) = result {
            self.settings.connections = old;
            for id in saved_keys {
                let _ = delete_key(&id);
            }
            self.error = error.clone();
            cx.notify();
            return Err(error);
        }
        for id in added {
            self.connect(&id);
        }
        cx.notify();
        Ok(())
    }
    fn request_remove(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.remove_task.is_some() {
            return;
        }
        let Some(connection) = self.settings.connections.iter().find(|c| c.id == id) else {
            return;
        };
        let answer = crate::confirm::ask(
            "Remove cluster from Lightship?",
            format!(
                "Remove the saved connection for {} from this app.",
                connection.name
            ),
            "Remove",
            window,
            cx,
        );
        let guard = self.before_remove.clone();
        let id = id.to_owned();
        self.remove_task = Some(cx.spawn_in(window, async move |owner, cx| {
            let allowed = if answer.await {
                if let Some(guard) = guard {
                    match cx.update(|w, cx| guard(&id, w, cx)) {
                        Ok(permission) => permission.await,
                        Err(_) => false,
                    }
                } else {
                    true
                }
            } else {
                false
            };
            let _ = owner.update(cx, |m, cx| {
                m.remove_task = None;
                if allowed {
                    m.remove(&id, cx)
                }
            });
        }));
    }
    fn remove(&mut self, id: &str, cx: &mut Context<Self>) {
        let old = self.settings.connections.clone();
        let removed = old.iter().find(|c| c.id == id).cloned();
        self.settings.connections.retain(|c| c.id != id);
        if self.persist() {
            if let Some(Connection {
                source: Source::Keychain(key),
                ..
            }) = removed
                && let Err(e) = config::keychain_delete(&key)
            {
                self.settings.connections = old;
                let rollback = self.save_settings();
                self.error = if rollback.is_err() {
                    format!("{e}; could not restore local settings")
                } else {
                    e
                };
                cx.notify();
                return;
            }
            self.jobs.remove(id);
            self.backend.disconnect(id);
            self.specs.remove(id);
            self.status.remove(id);
            self.descriptions.remove(id);
        } else {
            self.settings.connections = old;
        }
        cx.notify();
    }
    fn trust_existing(&mut self, id: &str, cx: &mut Context<Self>) {
        if let Some(connection) = self
            .settings
            .connections
            .iter()
            .find(|c| c.id == id)
            .cloned()
        {
            let result = connection.read().and_then(|mut config| {
                let fingerprint = config::prepare(&mut config, &connection.context)?;
                Ok((
                    fingerprint,
                    config::plugin_description(&config, &connection.context),
                ))
            });
            match result {
                Ok((fingerprint, description)) => {
                    if self.reviews.get(id) != Some(&fingerprint) {
                        self.reviews.insert(id.into(), fingerprint);
                        self.descriptions.insert(id.into(), description);
                        self.error="Configuration changed. Review the updated program configuration, then confirm again.".into();
                    } else {
                        let old = self.settings.connections.clone();
                        if let Some(c) = self.settings.connections.iter_mut().find(|c| c.id == id) {
                            c.trusted_exec = fingerprint;
                        }
                        if self.persist() {
                            self.connect(id);
                        } else {
                            self.settings.connections = old;
                        }
                    }
                }
                Err(e) => self.error = e,
            }
        }
        cx.notify();
    }
    pub fn documents(&self) -> Vec<Document> {
        self.settings
            .connections
            .iter()
            .flat_map(|c| {
                crate::catalog::RESOURCES
                    .iter()
                    .map(|r| {
                        Document::new(
                            format!("{}/{}", c.id, r.key).as_str(),
                            r.title,
                            c.name.clone(),
                        )
                        .icon_path(r.icon().path())
                    })
                    .chain(self.specs.get(&c.id).into_iter().flatten().map(|r| {
                        Document::new(
                            format!("{}/{}", c.id, r.key).as_str(),
                            r.title.clone(),
                            c.name.clone(),
                        )
                    }))
                    .collect::<Vec<_>>()
            })
            .collect()
    }
    pub fn navigation(&self) -> Vec<NavigationNode> {
        self.settings
            .connections
            .iter()
            .map(|c| {
                let mut children = Vec::new();
                let mut groups = HashSet::new();
                for resource in crate::catalog::RESOURCES {
                    let node = |r: &crate::catalog::Resource| {
                        NavigationNode::resource(
                            Document::new(
                                format!("{}/{}", c.id, r.key).as_str(),
                                r.title,
                                c.name.clone(),
                            )
                            .icon_path(r.icon().path()),
                        )
                        .icon(r.icon())
                    };
                    if resource.group.is_empty() {
                        children.push(node(resource));
                    } else if groups.insert(resource.group) {
                        let mut grouped: Vec<_> = crate::catalog::RESOURCES
                            .iter()
                            .filter(|r| r.group == resource.group)
                            .map(node)
                            .collect();
                        if resource.group == "Custom Resources" {
                            let mut by_group =
                                std::collections::BTreeMap::<String, Vec<NavigationNode>>::new();
                            for spec in self.specs.get(&c.id).into_iter().flatten() {
                                by_group.entry(spec.group.clone()).or_default().push(
                                    NavigationNode::resource(Document::new(
                                        format!("{}/{}", c.id, spec.key).as_str(),
                                        spec.title.clone(),
                                        c.name.clone(),
                                    )),
                                );
                            }
                            grouped.extend(by_group.into_iter().map(|(group, items)| {
                                NavigationNode::folder(
                                    format!("{}/group:{group}", c.id),
                                    group,
                                    items,
                                )
                            }));
                        }
                        children.push(NavigationNode::folder(
                            format!("{}/{}", c.id, resource.group),
                            resource.group,
                            grouped,
                        ));
                    }
                }
                NavigationNode::folder(c.id.clone(), c.name.clone(), children)
                    .icon(gpui::assets::IconName::Server)
            })
            .collect()
    }
}
impl Focusable for Connections {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Render for Connections {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let chrome = cx.theme().sidebar;
        let border = cx.theme().border;
        let muted = cx.theme().muted_foreground;
        let manager_rows = self
            .settings
            .connections
            .iter()
            .enumerate()
            .map(|(index, c)| {
                let id = c.id.clone();
                let edit = id.clone();
                let save = id.clone();
                let remove = id.clone();
                let reconnect = id.clone();
                let trust = id.clone();
                let name = c.name.clone();
                let status = self
                    .status
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| "Not tested".into());
                let (server, version) = self
                    .backend
                    .server_version(&id)
                    .unwrap_or_else(|| ("—".into(), "—".into()));
                let plugin = self.descriptions.get(&id).cloned().unwrap_or_default();
                div()
                    .flex()
                    .flex_col()
                    .px_3()
                    .py_2()
                    .border_t_1()
                    .border_color(border)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div()
                                    .flex_1()
                                    .min_w(px(100.))
                                    .flex()
                                    .flex_col()
                                    .items_start()
                                    .when(self.editing.as_ref() != Some(&id), |d| {
                                        d.child(
                                            Button::new(SharedString::from(format!(
                                                "rename:{edit}"
                                            )))
                                            .label(name.clone())
                                            .ghost()
                                            .small()
                                            .tooltip("Rename cluster")
                                            .on_click(cx.listener(move |m, _, w, cx| {
                                                m.editing = Some(edit.clone());
                                                m.rename.update(cx, |t, cx| {
                                                    t.set_value(name.clone(), w, cx)
                                                });
                                                m.rename.focus_handle(cx).focus(w, cx);
                                                cx.notify()
                                            })),
                                        )
                                    })
                                    .when(self.editing.as_ref() == Some(&id), |d| {
                                        d.child(
                                            Input::new(&self.rename)
                                                .id("cluster-display-name")
                                                .small(),
                                        )
                                        .child(
                                            Button::new("save-cluster-name")
                                                .label("Save")
                                                .small()
                                                .on_click(cx.listener(move |m, _, _, cx| {
                                                    let name =
                                                        m.rename.read(cx).value().trim().to_owned();
                                                    if name.is_empty() {
                                                        return;
                                                    }
                                                    let previous = m.settings.connections.clone();
                                                    if let Some(c) = m
                                                        .settings
                                                        .connections
                                                        .iter_mut()
                                                        .find(|c| c.id == save)
                                                    {
                                                        c.name = name
                                                    }
                                                    if m.persist() {
                                                        m.editing = None
                                                    } else {
                                                        m.settings.connections = previous
                                                    }
                                                    cx.notify()
                                                })),
                                        )
                                    })
                                    .child(
                                        div()
                                            .truncate()
                                            .text_size(px(11.))
                                            .text_color(muted)
                                            .child(c.context.clone()),
                                    ),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .text_color(muted)
                                    .child(server),
                            )
                            .child(div().w(px(72.)).truncate().text_color(muted).child(version))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .text_color(muted)
                                    .child(status),
                            )
                            .children([(-1, "↑", "Move up"), (1, "↓", "Move down")].map(
                                |(dir, arrow, label)| {
                                    let id = id.clone();
                                    Button::new(SharedString::from(format!("{label}:{id}")))
                                        .label(arrow)
                                        .tooltip(label)
                                        .ghost()
                                        .xsmall()
                                        .disabled(if dir < 0 {
                                            index == 0
                                        } else {
                                            index + 1 == self.settings.connections.len()
                                        })
                                        .on_click(cx.listener(move |m, _, _, cx| {
                                            m.move_connection(&id, dir, cx)
                                        }))
                                },
                            ))
                            .child(
                                Button::new(SharedString::from(format!("reconnect:{reconnect}")))
                                    .icon(gpui::component::IconName::RefreshCw)
                                    .tooltip("Test connection")
                                    .accessibility_label("Test connection")
                                    .ghost()
                                    .small()
                                    .on_click(cx.listener(move |m, _, _, cx| {
                                        m.connect(&reconnect);
                                        cx.notify()
                                    })),
                            )
                            .child(
                                Button::new(SharedString::from(format!("remove:{remove}")))
                                    .label("×")
                                    .tooltip("Remove from app")
                                    .accessibility_label("Remove from app")
                                    .ghost()
                                    .small()
                                    .on_click(cx.listener(move |m, _, w, cx| {
                                        m.request_remove(&remove, w, cx)
                                    })),
                            ),
                    )
                    .when(!plugin.is_empty(), |d| {
                        d.child(plugin).child(
                            Button::new(SharedString::from(format!("retrust:{trust}")))
                                .small()
                                .label("Trust this configuration and reconnect")
                                .on_click(
                                    cx.listener(move |m, _, _, cx| m.trust_existing(&trust, cx)),
                                ),
                        )
                    })
            });
        div()
            .id("cluster-manager")
            .track_focus(&self.focus)
            .font_family(cx.theme().mono_font_family.clone())
            .text_size(px(13.))
            .size_full()
            .p_5()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        div()
                            .flex_1()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("Manage clusters"),
                    )
                    .child(
                        Button::new("test-all")
                            .small()
                            .label("Sync all")
                            .disabled(self.settings.connections.is_empty())
                            .on_click(cx.listener(|m, _, _, cx| {
                                for id in m
                                    .settings
                                    .connections
                                    .iter()
                                    .map(|c| c.id.clone())
                                    .collect::<Vec<_>>()
                                {
                                    m.connect(&id)
                                }
                                cx.notify()
                            })),
                    )
                    .child(
                        Button::new("manage-add-cluster")
                            .primary()
                            .small()
                            .label("+ Add cluster")
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(RequestAddCluster))),
                    ),
            )
            .when(!self.error.is_empty(), |d| {
                d.child(
                    div()
                        .text_color(cx.theme().danger)
                        .child(self.error.clone()),
                )
            })
            .child(
                div()
                    .rounded_md()
                    .overflow_hidden()
                    .border_1()
                    .border_color(border)
                    .bg(cx.theme().group_box)
                    .when(self.settings.connections.is_empty(), |d| {
                        d.child(
                            div()
                                .h(px(128.))
                                .flex()
                                .items_center()
                                .justify_center()
                                .text_color(muted)
                                .child("No saved clusters"),
                        )
                    })
                    .when(!self.settings.connections.is_empty(), |d| {
                        d.child(
                            div()
                                .px_3()
                                .py_2()
                                .flex()
                                .text_size(px(11.))
                                .text_color(muted)
                                .bg(chrome)
                                .child(div().flex_1().child("CONTEXT"))
                                .child(div().flex_1().child("SERVER"))
                                .child(div().w(px(72.)).child("VERSION"))
                                .child(div().flex_1().child("STATUS"))
                                .child(div().w(px(127.)).child("ACTIONS")),
                        )
                    })
                    .children(manager_rows),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::{Connection, Connections, Source};
    use crate::backend::Backend;
    use pintle_gpui_kit::kit::{AppContext, TestAppContext};

    #[gpui_kit::test]
    fn failed_keychain_import_rolls_back_all_metadata_and_new_keys(cx: &mut TestAppContext) {
        cx.update(|cx| {
            crate::initialize(cx);
            let (window, manager) = gpui::open_window(
                pintle_gpui_kit::shell::workbench::window_options(cx),
                cx,
                |window, cx| cx.new(|cx| Connections::new(Backend::new(), window, cx)),
            )
            .unwrap();
            window
                .update(cx, |_, _, cx| {
                    manager.update(cx, |m, cx| {
                        m.settings.connections.push(Connection {
                            id: "keep".into(),
                            name: "Existing".into(),
                            context: "old".into(),
                            source: Source::Files(vec![]),
                            trusted_exec: None,
                        });
                        let mut writes = Vec::new();
                        let mut deleted = Vec::new();
                        let result = m.import_using(
                            None,
                            "private test input",
                            &[("one".into(), None), ("two".into(), None)],
                            |id, _| {
                                writes.push(id.to_string());
                                if writes.len() == 2 {
                                    Err("Keychain unavailable".into())
                                } else {
                                    Ok(())
                                }
                            },
                            |id| {
                                deleted.push(id.to_string());
                                Ok(())
                            },
                            cx,
                        );
                        assert_eq!(result.unwrap_err(), "Keychain unavailable");
                        assert_eq!(deleted, vec![writes[0].clone()]);
                        assert_eq!(m.settings.connections.len(), 1);
                        assert_eq!(m.settings.connections[0].id, "keep");
                        assert!(m.jobs.is_empty());
                        assert!(!m.error.contains("private test input"));
                    });
                })
                .unwrap();
        });
    }
}
