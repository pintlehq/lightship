//! Application-owned cluster onboarding and local settings.
use crate::backend::{
    Backend, Job, Spec,
    config::{self, Connection, Settings, Source},
};
use gpui::component::{
    ActiveTheme, Disableable, Sizable,
    button::{Button, ButtonVariants},
    checkbox::Checkbox,
    input::{Input, InputState, Textarea, TextareaState},
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
    path: Entity<InputState>,
    yaml: Entity<TextareaState>,
    rename: Entity<InputState>,
    pasted: bool,
    candidate: Option<kube::config::Kubeconfig>,
    source: Option<Source>,
    selected: HashSet<String>,
    trusted: HashSet<String>,
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
        let path = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("Kubeconfig file path (blank uses KUBECONFIG / ~/.kube/config)")
        });
        let yaml = cx.new(|cx| TextareaState::new(window, cx).placeholder("Paste kubeconfig YAML"));
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
            path,
            yaml,
            rename,
            pasted: false,
            candidate: None,
            source: None,
            selected: HashSet::new(),
            trusted: HashSet::new(),
            error,
            persistence_ok,
            _poll: poll,
        };
        for connection in result.settings.connections.clone() {
            result.connect(&connection.id);
        }
        result
    }
    pub fn clear_transient(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.candidate = None;
        self.selected.clear();
        self.trusted.clear();
        self.source = None;
        self.yaml
            .update(cx, |input, cx| input.set_value("", window, cx));
        cx.notify();
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
    fn browse(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Choose kubeconfig".into()),
        });
        cx.spawn_in(window, async move |entity, cx| {
            if let Ok(Ok(Some(paths))) = paths.await
                && let Some(path) = paths.first()
            {
                let _ = entity.update_in(cx, |this, window, cx| {
                    this.path.update(cx, |input, cx| {
                        input.set_value(path.to_string_lossy().into_owned(), window, cx)
                    });
                    this.pasted = false;
                    this.load_candidates(cx);
                });
            }
        })
        .detach();
    }
    fn load_candidates(&mut self, cx: &mut Context<Self>) {
        self.candidate = None;
        self.selected.clear();
        self.trusted.clear();
        self.error.clear();
        let result = if self.pasted {
            self.source = None;
            config::parse_yaml(self.yaml.read(cx).value().as_ref())
        } else {
            let text = self.path.read(cx).value().to_string();
            let paths = if text.trim().is_empty() {
                config::default_files()
            } else {
                let path = text.trim();
                vec![if let Some(tail) = path.strip_prefix("~/") {
                    std::path::PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                        .join(tail)
                } else {
                    std::path::PathBuf::from(path)
                }]
            };
            let paths: Vec<_> = paths
                .into_iter()
                .map(|p| std::fs::canonicalize(&p).unwrap_or(p))
                .collect();
            self.source = Some(Source::Files(paths.clone()));
            config::read_files(&paths)
        };
        match result {
            Ok(config) => self.candidate = Some(config),
            Err(e) => self.error = e,
        }
        cx.notify();
    }
    fn add(&mut self, cx: &mut Context<Self>) {
        let Some(candidate) = self.candidate.clone() else {
            return;
        };
        let old = self.settings.connections.clone();
        let mut added = Vec::new();
        let mut saved_keys = Vec::new();
        let result = (|| {
            for context in &self.selected {
                let mut config = candidate.clone();
                let fingerprint = config::prepare(&mut config, context)?;
                if fingerprint.is_some() && !self.trusted.contains(context) {
                    return Err(
                        "Review and trust the credential plugin for every selected context".into(),
                    );
                }
                if self
                    .settings
                    .connections
                    .iter()
                    .any(|c| c.context == *context && self.source.as_ref() == Some(&c.source))
                {
                    continue;
                }
                let id = uuid::Uuid::new_v4().to_string();
                let source = if let Some(source) = &self.source {
                    source.clone()
                } else {
                    config::keychain_write(&id, self.yaml.read(cx).value().as_ref())?;
                    saved_keys.push(id.clone());
                    Source::Keychain(id.clone())
                };
                self.settings.connections.push(Connection {
                    id: id.clone(),
                    name: context.clone(),
                    context: context.clone(),
                    source,
                    trusted_exec: fingerprint,
                });
                added.push(id);
            }
            if self.persist() {
                Ok(())
            } else {
                Err(self.error.clone())
            }
        })();
        if let Err(e) = result {
            self.settings.connections = old;
            for id in saved_keys {
                let _ = config::keychain_delete(&id);
            }
            self.error = e;
        } else {
            self.selected.clear();
            for id in added {
                self.connect(&id);
            }
        }
        cx.notify();
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
    #[cfg(test)]
    pub fn set_test_candidates(
        &mut self,
        config: kube::config::Kubeconfig,
        cx: &mut Context<Self>,
    ) {
        self.candidate = Some(config);
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
        let contexts: Vec<_> = self
            .candidate
            .as_ref()
            .map(|c| {
                c.contexts
                    .iter()
                    .map(|v| {
                        let mut prepared = c.clone();
                        let result = config::prepare(&mut prepared, &v.name);
                        (
                            v.name.clone(),
                            config::plugin_description(&prepared, &v.name),
                            result,
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        div()
            .id("cluster-manager")
            .max_h((window.viewport_size().height - px(180.)).max(px(200.)))
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_3()
            .child("Read-only · connections are saved on this Mac. Cluster data is never changed.")
            .child(
                div()
                    .flex()
                    .gap_2()
                    .child(
                        Button::new("use-file")
                            .label("Kubeconfig file")
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.pasted = false;
                                this.candidate = None;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("use-yaml")
                            .label("Paste YAML")
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.pasted = true;
                                this.candidate = None;
                                cx.notify();
                            })),
                    ),
            )
            .child(if self.pasted {
                div()
                    .h(px(150.))
                    .child(Textarea::new(&self.yaml))
                    .into_any_element()
            } else {
                div()
                    .flex()
                    .gap_2()
                    .child(div().flex_1().child(Input::new(&self.path)))
                    .child(
                        Button::new("browse-kubeconfig")
                            .label("Browse…")
                            .small()
                            .on_click(cx.listener(|this, _, window, cx| this.browse(window, cx))),
                    )
                    .into_any_element()
            })
            .child(
                Button::new("read-contexts")
                    .label("Read contexts")
                    .small()
                    .on_click(cx.listener(|this, _, _, cx| this.load_candidates(cx))),
            )
            .children(contexts.into_iter().map(|(name, plugin, result)| {
                let key = name.clone();
                let trust_key = name.clone();
                let checked = self.selected.contains(&name);
                let trusted = self.trusted.contains(&name);
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        Checkbox::new(SharedString::from(format!("context:{name}")))
                            .label(name)
                            .checked(checked)
                            .on_change(cx.listener(move |this, checked, _, cx| {
                                if *checked {
                                    this.selected.insert(key.clone());
                                } else {
                                    this.selected.remove(&key);
                                }
                                cx.notify();
                            })),
                    )
                    .when(!plugin.is_empty() && checked, |d| {
                        d.child(div().text_size(px(11.)).child(plugin)).child(
                            Checkbox::new(SharedString::from(format!("trust:{trust_key}")))
                                .label("Trust this credential program and configuration")
                                .checked(trusted)
                                .on_change(cx.listener(move |this, checked, _, cx| {
                                    if *checked {
                                        this.trusted.insert(trust_key.clone());
                                    } else {
                                        this.trusted.remove(&trust_key);
                                    }
                                    cx.notify();
                                })),
                        )
                    })
                    .when_some(result.err(), |d, e| {
                        d.child(div().text_color(cx.theme().danger).child(e))
                    })
            }))
            .child(
                Button::new("add-selected-clusters")
                    .label("Add selected clusters")
                    .small()
                    .disabled(self.selected.is_empty())
                    .on_click(cx.listener(|this, _, _, cx| this.add(cx))),
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
                    .border_t_1()
                    .border_color(cx.theme().border)
                    .pt_3()
                    .child("Saved clusters"),
            )
            .child(Input::new(&self.rename))
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
