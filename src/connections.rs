//! Application-owned cluster onboarding and local settings.
use crate::backend::{
    Backend, Job, Spec,
    config::{self, Connection, Settings, Source},
};
use gpui::component::{
    ActiveTheme, Sizable,
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
pub struct Connections {
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
        let mut result = Self {
            backend,
            settings,
            status: HashMap::new(),
            specs: HashMap::new(),
            jobs: HashMap::new(),
            descriptions: HashMap::new(),
            reviews: HashMap::new(),
            rename,
            error,
            persistence_ok,
            _poll: poll,
        };
        for connection in result.settings.connections.clone() {
            result.connect(&connection.id);
        }
        result
    }
    fn poll(&mut self, cx: &mut Context<Self>) {
        let mut complete = Vec::new();
        for (id, job) in &mut self.jobs {
            if let Some(result) = job.take() {
                match result {
                    Ok(specs) => {
                        self.specs.insert(id.clone(), specs);
                        self.status
                            .insert(id.clone(), "Connected · Read-only".into());
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
        self.settings.dark = dark;
        self.persist();
    }
    /// Persist an already reviewed import atomically, then start read-only connections.
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
                        NavigationNode::resource(Document::new(
                            format!("{}/{}", c.id, r.key).as_str(),
                            r.title,
                            c.name.clone(),
                        ))
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
                            grouped.extend(self.specs.get(&c.id).into_iter().flatten().map(|r| {
                                NavigationNode::resource(Document::new(
                                    format!("{}/{}", c.id, r.key).as_str(),
                                    r.title.clone(),
                                    c.name.clone(),
                                ))
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
impl Render for Connections {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("cluster-manager")
            .font_family(cx.theme().mono_font_family.clone())
            .text_size(px(13.))
            .max_h((window.viewport_size().height - px(180.)).max(px(200.)))
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_3()
            .child("Connections are saved on this Mac. Removing one only removes it from this app.")
            .when(self.settings.connections.is_empty(), |d| {
                d.child("No saved clusters. Use Add cluster to get started.")
            })
            .when(!self.error.is_empty(), |d| {
                d.child(
                    div()
                        .text_color(cx.theme().danger)
                        .child(self.error.clone()),
                )
            })
            .child(Input::new(&self.rename).id("cluster-display-name"))
            .children(self.settings.connections.clone().into_iter().map(|c| {
                let reconnect = c.id.clone();
                let remove = c.id.clone();
                let rename = c.id.clone();
                let trust = c.id.clone();
                let plugin = self.descriptions.get(&c.id).cloned().unwrap_or_default();
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(format!("{} · {}", c.name, c.context))
                    .child(
                        self.status
                            .get(&c.id)
                            .cloned()
                            .unwrap_or_else(|| "Disconnected".into()),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap_2()
                            .child(
                                Button::new(SharedString::from(format!("reconnect:{reconnect}")))
                                    .label("Reconnect")
                                    .small()
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.connect(&reconnect);
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Button::new(SharedString::from(format!("rename:{rename}")))
                                    .label("Rename")
                                    .small()
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        let name = this.rename.read(cx).value().trim().to_owned();
                                        if !name.is_empty() {
                                            let old = this.settings.connections.clone();
                                            if let Some(c) = this
                                                .settings
                                                .connections
                                                .iter_mut()
                                                .find(|c| c.id == rename)
                                            {
                                                c.name = name;
                                            }
                                            if !this.persist() {
                                                this.settings.connections = old;
                                            }
                                            cx.notify();
                                        }
                                    })),
                            )
                            .child(
                                Button::new(SharedString::from(format!("remove:{remove}")))
                                    .label("Remove from app")
                                    .small()
                                    .ghost()
                                    .on_click(
                                        cx.listener(move |this, _, _, cx| this.remove(&remove, cx)),
                                    ),
                            ),
                    )
                    .when(!plugin.is_empty(), |d| {
                        d.child(div().text_size(px(11.)).child(plugin)).child(
                            Button::new(SharedString::from(format!("retrust:{trust}")))
                                .label("Trust this configuration and reconnect")
                                .small()
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.trust_existing(&trust, cx)
                                })),
                        )
                    })
            }))
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
