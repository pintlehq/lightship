//! Transient onboarding UI. Detection reads configuration, never contacts a cluster.
use crate::{
    backend::config::{self, Connection, Source},
    connections::Connections,
};
use gpui::TestSupportExt;
use gpui::assets::IconName;
use gpui::component::{
    ActiveTheme, Disableable, Icon, Selectable, Sizable, WindowExt,
    button::{Button, ButtonVariants},
    checkbox::Checkbox,
    input::{EditorState, InputEvent},
    tooltip::Tooltip,
};
use gpui::{
    AppContext, Context, Entity, IntoElement, PathPromptOptions, Render, SharedString,
    Subscription, Task, Window, div, prelude::*, px, relative,
};
use kube::config::Kubeconfig;
use pintle_gpui_kit::kit as gpui;
use std::{collections::HashSet, path::PathBuf, time::Duration};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Identity {
    context: String,
    server: String,
    user: Option<String>,
}
fn identity(config: &Kubeconfig, name: &str) -> Option<Identity> {
    let context = config
        .contexts
        .iter()
        .find(|c| c.name == name)?
        .context
        .as_ref()?;
    let cluster = config
        .clusters
        .iter()
        .find(|c| c.name == context.cluster)?
        .cluster
        .as_ref()?;
    Some(Identity {
        context: name.into(),
        server: cluster.server.as_ref()?.trim_end_matches('/').to_string(),
        user: context.user.clone(),
    })
}
#[derive(Clone)]
struct Candidate {
    name: String,
    identity: Option<Identity>,
    plugin: String,
    validation: Result<Option<String>, String>,
}
fn candidates(config: &Kubeconfig) -> Vec<Candidate> {
    config
        .contexts
        .iter()
        .map(|c| {
            let mut prepared = config.clone();
            let validation = config::prepare(&mut prepared, &c.name);
            Candidate {
                name: c.name.clone(),
                identity: identity(config, &c.name),
                plugin: config::plugin_description(&prepared, &c.name),
                validation,
            }
        })
        .collect()
}
fn existing(connections: &[Connection]) -> (HashSet<Identity>, usize) {
    let mut known = HashSet::new();
    let mut unreadable = 0;
    for c in connections {
        match c
            .read()
            .ok()
            .and_then(|config| identity(&config, &c.context))
        {
            Some(id) => {
                known.insert(id);
            }
            None => unreadable += 1,
        }
    }
    (known, unreadable)
}
fn read_files(paths: &[PathBuf]) -> Result<Kubeconfig, String> {
    if paths.is_empty() || paths.iter().any(|p| !p.exists()) {
        return Err("Kubeconfig file not found. Choose a file or paste YAML.".into());
    }
    config::read_files(paths).map_err(|_| "Cannot read or parse kubeconfig. Check the file and its permissions, or choose another file.".into())
}

pub struct AddCluster {
    manager: Entity<Connections>,
    yaml: Entity<EditorState>,
    paths: Vec<PathBuf>,
    pasted: bool,
    rows: Vec<Candidate>,
    selected: HashSet<String>,
    known: HashSet<Identity>,
    unreadable: usize,
    loading_known: bool,
    loading: bool,
    active: bool,
    generation: u64,
    error: String,
    _load: Option<Task<()>>,
    _known: Option<Task<()>>,
    _picker: Option<Task<()>>,
    _changes: Subscription,
}
impl AddCluster {
    pub fn new(
        manager: Entity<Connections>,
        paths: Vec<PathBuf>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let paths = paths
            .into_iter()
            .map(|path| std::fs::canonicalize(&path).unwrap_or(path))
            .collect();
        let yaml = cx.new(|cx| crate::yaml_editor::state(window, cx).placeholder(
            "apiVersion: v1\nkind: Config\nclusters:\n  - name: my-cluster\n    cluster:\n      server: https://…"));
        let changes = cx.subscribe(&yaml, |this, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) && this.active && this.pasted {
                this.detect(Duration::from_millis(300), cx);
            }
        });
        let saved = manager.read(cx).settings.connections.clone();
        let known = cx.spawn(async move |entity, cx| {
            let result = cx.background_spawn(async move { existing(&saved) }).await;
            let _ = entity.update(cx, |this, cx| {
                this.known = result.0;
                this.unreadable = result.1;
                this.loading_known = false;
                this.selected.retain(|name| {
                    !this.rows.iter().any(|r| {
                        r.name == *name
                            && r.identity
                                .as_ref()
                                .is_some_and(|id| this.known.contains(id))
                    })
                });
                cx.notify();
            });
        });
        let mut this = Self {
            manager,
            yaml,
            paths,
            pasted: false,
            rows: Vec::new(),
            selected: HashSet::new(),
            known: HashSet::new(),
            unreadable: 0,
            loading_known: true,
            loading: false,
            active: true,
            generation: 0,
            error: String::new(),
            _load: None,
            _known: Some(known),
            _picker: None,
            _changes: changes,
        };
        this.detect(Duration::ZERO, cx);
        this
    }
    pub fn clear(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.active = false;
        self._load = None;
        self._known = None;
        self._picker = None;
        self.rows.clear();
        self.selected.clear();
        self.yaml
            .update(cx, |input, cx| input.set_value("", window, cx));
    }
    fn added(&self, row: &Candidate) -> bool {
        row.identity
            .as_ref()
            .is_some_and(|id| self.known.contains(id))
    }
    fn can_add(&self) -> bool {
        !self.loading
            && !self.loading_known
            && !self.selected.is_empty()
            && self.selected.iter().all(|name| {
                self.rows
                    .iter()
                    .any(|r| r.name == *name && !self.added(r) && r.validation.is_ok())
            })
    }
    fn detect(&mut self, delay: Duration, cx: &mut Context<Self>) {
        self.generation += 1;
        self.rows.clear();
        self.selected.clear();
        self.error.clear();
        self._load = None;
        let pasted = self.pasted;
        let text = self.yaml.read(cx).value().to_string();
        if pasted && text.trim().is_empty() {
            self.loading = false;
            cx.notify();
            return;
        }
        self.loading = true;
        let paths = self.paths.clone();
        let generation = self.generation;
        self._load = Some(cx.spawn(async move |entity, cx| {
            cx.background_executor().timer(delay).await;
            let result = cx
                .background_spawn(async move {
                    let config = if pasted {
                        config::parse_yaml(&text)
                    } else {
                        read_files(&paths)
                    }?;
                    Ok::<_, String>(candidates(&config))
                })
                .await;
            let _ = entity.update(cx, |this, cx| {
                if !this.active || generation != this.generation {
                    return;
                }
                this.loading = false;
                match result {
                    Ok(rows) => this.rows = rows,
                    Err(e) => this.error = e,
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
    fn switch(&mut self, pasted: bool, cx: &mut Context<Self>) {
        if self.pasted != pasted {
            self.pasted = pasted;
            self._picker = None;
            self.detect(Duration::ZERO, cx);
        }
    }
    fn browse(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Choose kubeconfig".into()),
        });
        let pasted = self.pasted;
        let generation = self.generation;
        self._picker = Some(cx.spawn_in(window, async move |entity, cx| {
            if let Ok(Ok(Some(paths))) = paths.await
                && let Some(path) = paths.into_iter().next()
            {
                let result = cx
                    .background_spawn(async move {
                        if pasted {
                            std::fs::read_to_string(&path)
                                .map(|text| (path, Some(text)))
                                .map_err(|_| {
                                    "Cannot read this file as UTF-8 kubeconfig".to_string()
                                })
                        } else {
                            Ok((std::fs::canonicalize(&path).unwrap_or(path), None))
                        }
                    })
                    .await;
                let _ = entity.update_in(cx, |this, window, cx| {
                    if !this.active || this.generation != generation {
                        return;
                    }
                    match result {
                        Ok((_, Some(text))) => {
                            this.yaml
                                .update(cx, |input, cx| input.set_value(text, window, cx));
                            this.detect(Duration::from_millis(300), cx);
                        }
                        Ok((path, None)) => {
                            this.paths = vec![path];
                            this.detect(Duration::ZERO, cx);
                        }
                        Err(e) => {
                            this.error = e;
                            cx.notify();
                        }
                    }
                });
            }
        }));
    }
    fn add(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.can_add() {
            return;
        }
        // Re-read file sources before committing: plugin trust belongs to the reviewed snapshot.
        let text = self.yaml.read(cx).value().to_string();
        let current = if self.pasted {
            config::parse_yaml(&text)
        } else {
            read_files(&self.paths)
        };
        let result = current.and_then(|config| {
            let current = candidates(&config);
            let mut targets = Vec::new();
            for row in &self.rows {
                if !self.selected.contains(&row.name) { continue; }
                let Some(now) = current.iter().find(|r| r.name == row.name) else {
                    return Err("Configuration changed. Reload and select contexts again.".into());
                };
                if now.identity != row.identity || now.validation != row.validation || now.plugin != row.plugin {
                    return Err("Configuration changed. Reload and review the updated contexts and credential program.".into());
                }
                targets.push((row.name.clone(), now.validation.clone()?));
            }
            let source = (!self.pasted).then(|| Source::Files(self.paths.clone()));
            self.manager.update(cx, |manager, cx| manager.import(source.as_ref(), &text, &targets, cx))
        });
        match result {
            Ok(()) => {
                self.clear(window, cx);
                window.close_dialog(cx);
            }
            Err(e) => {
                self.error = e;
                cx.notify();
            }
        }
    }
    pub fn preferred_height(&self) -> gpui::Pixels {
        px(if self.pasted { 560. } else { 460. })
    }
    pub fn footer(&self, cx: &Context<Self>) -> impl IntoElement {
        let uses_program = self
            .rows
            .iter()
            .any(|row| self.selected.contains(&row.name) && matches!(row.validation, Ok(Some(_))));
        div()
            .id("add-cluster-footer")
            .test_support()
            .rounded_b_xl()
            .h(px(60.))
            .flex_shrink_0()
            .px_5()
            .flex()
            .items_center()
            .justify_end()
            .gap_2()
            .border_t_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().muted.opacity(0.3))
            .when(uses_program, |footer| {
                footer.child(
                    div()
                        .id("add-credential-notice")
                        .test_support()
                        .min_w_0()
                        .flex_1()
                        .text_size(px(12.))
                        .text_color(cx.theme().muted_foreground)
                        .child("Adding allows Lightship to run the listed credential programs."),
                )
            })
            .child(
                Button::new("cancel-add-cluster")
                    .label("Cancel")
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.clear(window, cx);
                        window.close_dialog(cx);
                    })),
            )
            .child(
                Button::new("add-selected-clusters")
                    .icon(IconName::Plus)
                    .label(if self.selected.len() == 1 {
                        "Add cluster"
                    } else {
                        "Add clusters"
                    })
                    .primary()
                    .disabled(!self.can_add())
                    .on_click(cx.listener(|this, _, window, cx| this.add(window, cx))),
            )
    }
    #[cfg(test)]
    pub fn set_test_candidates(&mut self, config: Kubeconfig, cx: &mut Context<Self>) {
        self._load = None;
        self._known = None;
        self.loading = false;
        self.loading_known = false;
        self.rows = candidates(&config);
        cx.notify();
    }
    fn path_label(&self) -> String {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        self.paths
            .iter()
            .map(|path| {
                if let Some(home) = &home
                    && let Ok(rest) = path.strip_prefix(home)
                {
                    return format!("~/{}", rest.display());
                }
                path.display().to_string()
            })
            .collect::<Vec<_>>()
            .join(", ")
    }
}
impl Render for AddCluster {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let added = self.rows.iter().filter(|r| self.added(r)).count();
        let summary = if added > 0 {
            format!(
                "{} selected · {added} already added · skipped",
                self.selected.len()
            )
        } else {
            format!("{} selected", self.selected.len())
        };
        let empty = if self.loading {
            "Reading contexts…"
        } else if self.pasted && self.yaml.read(cx).value().trim().is_empty() {
            "Paste a kubeconfig to detect contexts"
        } else if !self.error.is_empty() {
            "No contexts available"
        } else {
            "No contexts found in this kubeconfig"
        };
        div().id("add-cluster-body").test_support().size_full().min_h_0().flex().flex_col().p_5().gap_4()
            .font_family(cx.theme().mono_font_family.clone()).font_weight(gpui::FontWeight::NORMAL).text_size(px(13.))
            .child(div().id("cluster-source-tabs").test_support().flex_shrink_0().flex().p_1().gap_1().border_1().border_color(cx.theme().border).rounded_lg().bg(cx.theme().muted)
                .child(Button::new("use-file").icon(IconName::File).label("kubeconfig").ghost().selected(!self.pasted).flex_1().justify_start().px_3()
                    .when(!self.pasted, |b| b.bg(cx.theme().background))
                    .on_click(cx.listener(|this, _, _, cx| this.switch(false, cx))))
                .child(Button::new("use-yaml").icon(IconName::Code).label("paste YAML").ghost().selected(self.pasted).flex_1().justify_start().px_3()
                    .when(self.pasted, |b| b.bg(cx.theme().background))
                    .on_click(cx.listener(|this, _, _, cx| this.switch(true, cx)))))
            .child(div().id("cluster-import-scroll").test_support().flex_1().min_h_0().overflow_y_scroll().flex().flex_col().gap_4()
                .child(div().flex().items_start().gap_3().flex_shrink_0()
                    .child(div().flex_1().min_w_0().text_color(cx.theme().muted_foreground).child(if self.pasted {
                        "Paste a raw kubeconfig. Credentials are stored in macOS Keychain, never in plaintext files.".into()
                    } else if self.loading { format!("Reading {}…", self.path_label()) }
                    else if !self.error.is_empty() { "Choose a kubeconfig file or switch to paste YAML.".into() }
                    else { format!("Detected {} with {} contexts. Pick the ones to add.", self.path_label(), self.rows.len()) }))
                    .child(Button::new("browse-kubeconfig").label(if self.pasted { "Load from file…" } else { "Choose file…" }).small()
                        .on_click(cx.listener(|this, _, window, cx| this.browse(window, cx)))))
                .when(self.pasted, |d| d.child(div().id("kubeconfig-editor").h(px(170.)).flex_shrink_0().child(crate::yaml_editor::editor(&self.yaml, false).h(px(170.)))))
                .when(!self.error.is_empty(), |d| d.child(div().id("import-error").test_support().text_color(cx.theme().danger).child(self.error.clone())))
                .when(!self.pasted && !self.error.is_empty(), |d| d.child(Button::new("reload-kubeconfig").label("Reload kubeconfig").small()
                    .on_click(cx.listener(|this, _, _, cx| this.detect(Duration::ZERO, cx)))))
                .child(div().id("context-list").flex_shrink_0().border_1().border_color(cx.theme().border).rounded_lg().overflow_hidden()
                    .when(self.rows.is_empty(), |d| d.child(div().h(px(100.)).flex().items_center().justify_center().text_color(cx.theme().muted_foreground).child(empty)))
                    .children(self.rows.iter().enumerate().map(|(index, row)| {
                        let name = row.name.clone();
                        let selected = self.selected.contains(&name); let added = self.added(row);
                        let server = row.identity.as_ref().map(|id| id.server.clone()).unwrap_or_else(|| "Missing server".into());
                        let tooltip = server.clone();
                        div().id(SharedString::from(format!("context-row:{name}"))).px_3().py_3().flex().flex_col().gap_2()
                            .when(index > 0, |d| d.border_t_1().border_color(cx.theme().border.opacity(0.5)))
                            .when(added, |d| d.text_color(cx.theme().muted_foreground))
                            .child(div().flex().items_center().gap_3()
                                .child(Checkbox::new(SharedString::from(format!("context:{name}"))).accessibility_label(format!("Select {}", row.name)).checked(selected).disabled(added || row.validation.is_err() || self.loading_known)
                                    .on_change(cx.listener(move |this, checked, _, cx| { if *checked { this.selected.insert(name.clone()); } else { this.selected.remove(&name); } cx.notify(); })))
                                .child(Icon::new(IconName::Server).size(px(14.)).flex_shrink_0())
                                .child(div().w(relative(0.43)).min_w_0().child(row.name.clone()))
                                .child(div().id(SharedString::from(format!("context-server:{}",row.name))).flex_1().min_w_0().truncate().text_size(px(12.)).text_color(cx.theme().muted_foreground)
                                    .tooltip(move |_, cx| cx.new(|_| Tooltip::new(tooltip.clone())).into()).child(server))
                                .when(added, |d| d.child(div().id(SharedString::from(format!("context-added:{}",row.name))).test_support().px_2().py_0p5().rounded_full().bg(cx.theme().muted).text_size(px(10.)).child("ADDED"))))
                            .when_some(row.validation.as_ref().err(), |d, error| d.child(div().text_size(px(11.)).text_color(cx.theme().danger).child(error.clone())))
                            .when(selected && !row.plugin.is_empty(), |d| d.child(
                                div().id(SharedString::from(format!("credential-program:{}", row.name))).test_support()
                                    .p_2().rounded_md().bg(cx.theme().muted).text_size(px(11.)).child(row.plugin.clone())
                            ))
                    })))
                .when(self.loading_known, |d| d.child("Checking saved clusters…"))
                .when(self.unreadable > 0, |d| d.child(div().id("duplicate-check-warning").text_color(cx.theme().muted_foreground)
                    .child(format!("Could not read configuration for {} saved connection(s). Duplicate detection is incomplete for those connections.", self.unreadable))))
                .when(!self.rows.is_empty(), |d| d.child(div().id("context-selection-summary").text_color(cx.theme().muted_foreground).child(summary))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{AnyWindowHandle, TestAppContext, size, test::TestWindowExt};
    use gpui::{App, Focusable};
    const YAML: &str = "apiVersion: v1\nkind: Config\nclusters:\n- name: test\n  cluster:\n    server: https://example.invalid\nusers:\n- name: reader\n  user: {}\ncontexts:\n- name: development\n  context:\n    cluster: test\n    user: reader\n";
    fn exec_config() -> String {
        YAML.replace("user: {}", "user:\n    exec:\n      command: /usr/bin/true\n      apiVersion: client.authentication.k8s.io/v1\n      interactiveMode: Never")
    }
    struct TempConfig(PathBuf);
    impl TempConfig {
        fn new(text: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "lightship-onboarding-{}.yaml",
                uuid::Uuid::new_v4()
            ));
            std::fs::write(&path, text).unwrap();
            Self(path)
        }
    }
    impl Drop for TempConfig {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    fn saved(path: PathBuf) -> Connection {
        Connection {
            id: "stable-id".into(),
            name: "Renamed display label".into(),
            context: "development".into(),
            source: Source::Files(vec![path]),
            trusted_exec: None,
        }
    }
    fn open(
        cx: &mut TestAppContext,
        paths: Vec<PathBuf>,
        saved: Vec<Connection>,
    ) -> (
        AnyWindowHandle,
        Entity<AddCluster>,
        Entity<crate::Lightship>,
    ) {
        cx.update(|cx| {
            crate::initialize(cx);
            let (handle, app) = gpui::open_window(
                pintle_gpui_kit::shell::workbench::window_options(cx),
                cx,
                |window, cx| cx.new(|cx| crate::Lightship::new(window, cx)),
            )
            .unwrap();
            let form = handle
                .update(cx, |_, window, cx| {
                    app.read(cx).focus_handle(cx).focus(window, cx);
                    let manager = app.read(cx).connections.clone();
                    manager.update(cx, |m, _| m.settings.connections = saved);
                    let form = cx.new(|cx| AddCluster::new(manager, paths, window, cx));
                    app.update(cx, |app, cx| app.open_add_cluster(form.clone(), window, cx));
                    form
                })
                .unwrap();
            (handle, form, app)
        })
    }
    fn step(
        cx: &mut TestAppContext,
        window: AnyWindowHandle,
        f: impl FnOnce(&mut Window, &mut App),
    ) {
        cx.update_window(window, |_, window, cx| {
            window.render_frame(cx);
            f(window, cx);
        })
        .unwrap();
    }
    fn wait(cx: &mut TestAppContext, ms: u64) {
        cx.run_until_parked();
        cx.executor().advance_clock(Duration::from_millis(ms));
        cx.run_until_parked();
    }
    #[test]
    fn duplicate_identity_uses_context_server_and_user_not_display_name_or_source() {
        let original = config::parse_yaml(YAML).unwrap();
        let id = identity(&original, "development").unwrap();
        assert_eq!(
            id,
            identity(
                &config::parse_yaml(&YAML.replace("example.invalid", "example.invalid/")).unwrap(),
                "development"
            )
            .unwrap()
        );
        for changed in [
            YAML.replace("example.invalid", "other.invalid"),
            YAML.replace("reader", "admin"),
        ] {
            assert_ne!(
                id,
                identity(&config::parse_yaml(&changed).unwrap(), "development").unwrap()
            );
        }
        let file = TempConfig::new(YAML);
        let (known, unreadable) = existing(&[
            saved(file.0.clone()),
            saved(PathBuf::from("/does-not-exist/lightship-kubeconfig")),
        ]);
        assert!(known.contains(&id));
        assert_eq!(unreadable, 1);
    }
    #[test]
    fn missing_invalid_and_empty_sources_are_distinct() {
        assert!(read_files(&[]).unwrap_err().contains("not found"));
        let invalid = TempConfig::new("contexts: [invalid YAML");
        assert!(
            read_files(std::slice::from_ref(&invalid.0))
                .unwrap_err()
                .contains("parse")
        );
        let empty = TempConfig::new("apiVersion: v1\nkind: Config\ncontexts: []\n");
        assert!(candidates(&read_files(std::slice::from_ref(&empty.0)).unwrap()).is_empty());
    }
    #[gpui_kit::test]
    fn automatic_detection_marks_added_and_does_not_connect(cx: &mut TestAppContext) {
        let file = TempConfig::new(YAML);
        let (handle, form, app) = open(cx, vec![file.0.clone()], vec![saved(file.0.clone())]);
        wait(cx, 1);
        step(cx, handle, |window, cx| {
            assert_eq!(form.read(cx).rows.len(), 1);
            assert!(form.read(cx).added(&form.read(cx).rows[0]));
            assert!(!window.find_all("context-added:development").is_empty());
            window.click("context:development", cx);
            assert!(!form.read(cx).can_add());
            assert!(app.read(cx).connections.read(cx).status.is_empty());
            assert!(window.find_all("cluster-manager").is_empty());
        });
    }
    #[gpui_kit::test]
    fn yaml_debounce_cancels_stale_results_and_clears_selection(cx: &mut TestAppContext) {
        let (handle, form, _) = open(cx, vec![], vec![]);
        wait(cx, 1);
        step(cx, handle, |window, cx| {
            window.click("use-yaml", cx);
            let yaml = form.read(cx).yaml.clone();
            yaml.update(cx, |input, cx| input.replace_all(YAML, window, cx));
        });
        wait(cx, 299);
        cx.update(|cx| assert!(form.read(cx).rows.is_empty()));
        step(cx, handle, |window, cx| {
            let yaml = form.read(cx).yaml.clone();
            yaml.update(cx, |input, cx| {
                input.replace_all(YAML.replace("development", "latest"), window, cx)
            });
        });
        wait(cx, 300);
        step(cx, handle, |window, cx| {
            assert_eq!(form.read(cx).rows[0].name, "latest");
            window.click("context:latest", cx);
            assert!(form.read(cx).can_add());
            let yaml = form.read(cx).yaml.clone();
            yaml.update(cx, |input, cx| input.replace_all("invalid: [", window, cx));
        });
        wait(cx, 0);
        cx.update(|cx| {
            assert!(form.read(cx).selected.is_empty());
            assert!(!form.read(cx).can_add());
        });
        wait(cx, 300);
        step(cx, handle, |window, cx| {
            assert!(!form.read(cx).error.is_empty());
            assert!(!window.find_all("import-error").is_empty());
        });
    }
    #[gpui_kit::test]
    fn selecting_plugin_shows_add_consent_and_cancel_clears_transient_credentials(
        cx: &mut TestAppContext,
    ) {
        let text = exec_config();
        let (handle, form, app) = open(cx, vec![], vec![]);
        wait(cx, 1);
        step(cx, handle, |window, cx| {
            window.click("use-yaml", cx);
            form.read(cx)
                .yaml
                .clone()
                .update(cx, |input, cx| input.replace_all(text, window, cx));
        });
        wait(cx, 300);
        step(cx, handle, |window, cx| {
            assert!(window.find_all("add-credential-notice").is_empty());
            window.click("context:development", cx);
            assert!(form.read(cx).can_add());
            assert!(!window.find_all("credential-program:development").is_empty());
            assert!(!window.find_all("add-credential-notice").is_empty());
            window.click("cancel-add-cluster", cx);
            assert!(!window.has_active_dialog(cx));
            assert!(form.read(cx).yaml.read(cx).value().is_empty());
            assert!(form.read(cx).selected.is_empty());
            assert!(
                app.read(cx)
                    .connections
                    .read(cx)
                    .settings
                    .connections
                    .is_empty()
            );
        });
    }
    #[gpui_kit::test]
    fn escape_restores_focus_and_manage_preserves_file_and_identity(cx: &mut TestAppContext) {
        let file = TempConfig::new(YAML);
        let (handle, form, app) = open(cx, vec![file.0.clone()], vec![saved(file.0.clone())]);
        wait(cx, 1);
        step(cx, handle, |window, cx| {
            window.press("escape", cx);
            assert!(!window.has_active_dialog(cx));
            assert!(!form.read(cx).active);
            assert!(app.read(cx).focus_handle(cx).contains_focused(window, cx));
        });
        wait(cx, 300);
        step(cx, handle, |window, cx| {
            app.update(cx, |app, cx| app.manage_clusters(window, cx));
        });
        step(cx, handle, |window, cx| {
            assert!(window.find_all("use-yaml").is_empty());
            assert!(!window.find_all("reconnect:stable-id").is_empty());
            window.click("rename:stable-id", cx);
            window.click("cluster-display-name", cx);
            window.press("secondary-a", cx);
            window.input("Renamed", cx);
            window.click("save-cluster-name", cx);
            let manager = app.read(cx).connections.read(cx);
            assert_eq!(manager.settings.connections[0].name, "Renamed");
            assert_eq!(manager.settings.connections[0].id, "stable-id");
            window.click("remove:stable-id", cx);
            window.click("confirm-accept", cx);
        });
        cx.run_until_parked();
        step(cx, handle, |_, cx| {
            assert!(
                app.read(cx)
                    .connections
                    .read(cx)
                    .settings
                    .connections
                    .is_empty()
            );
            assert_eq!(std::fs::read_to_string(&file.0).unwrap(), YAML);
        });
    }
    #[gpui_kit::test]
    fn add_click_approves_only_the_selected_context_program(cx: &mut TestAppContext) {
        let text =
            exec_config() + "- name: staging\n  context:\n    cluster: test\n    user: reader\n";
        let file = TempConfig::new(&text);
        let (handle, form, app) = open(cx, vec![file.0.clone()], vec![]);
        wait(cx, 1);
        step(cx, handle, |window, cx| {
            window.click("context:development", cx);
            let reviewed = form.read(cx).rows[0].validation.clone().unwrap().unwrap();
            assert!(
                app.read(cx)
                    .connections
                    .read(cx)
                    .settings
                    .connections
                    .is_empty()
            );
            window.click("add-selected-clusters", cx);
            let saved = &app.read(cx).connections.read(cx).settings.connections;
            assert_eq!(saved.len(), 1);
            assert_eq!(saved[0].context, "development");
            assert_eq!(saved[0].trusted_exec.as_ref(), Some(&reviewed));
            assert!(!window.has_active_dialog(cx));
        });
    }
    #[gpui_kit::test]
    fn changed_file_revokes_plugin_consent_before_import(cx: &mut TestAppContext) {
        let text = exec_config();
        let file = TempConfig::new(&text);
        let (handle, form, app) = open(cx, vec![file.0.clone()], vec![]);
        wait(cx, 1);
        step(cx, handle, |window, cx| {
            window.click("context:development", cx);
            assert!(form.read(cx).can_add());
        });
        std::fs::write(
            &file.0,
            text.replace(
                "command: /usr/bin/true",
                "command: /usr/bin/true\n      args: [changed]",
            ),
        )
        .unwrap();
        step(cx, handle, |window, cx| {
            window.click("add-selected-clusters", cx);
            assert!(window.has_active_dialog(cx));
            assert!(form.read(cx).error.contains("Configuration changed"));
            assert!(
                app.read(cx)
                    .connections
                    .read(cx)
                    .settings
                    .connections
                    .is_empty()
            );
            assert!(app.read(cx).connections.read(cx).status.is_empty());
        });
    }
    #[gpui_kit::test]
    fn header_footer_stay_visible_in_both_themes_and_sizes(cx: &mut TestAppContext) {
        let (handle, form, _) = open(cx, vec![], vec![]);
        wait(cx, 1);
        for dimensions in [size(px(1440.), px(900.)), size(px(1024.), px(680.))] {
            cx.simulate_window_resize(handle, dimensions);
            for mode in [
                crate::theme::ThemeMode::Light,
                crate::theme::ThemeMode::Dark,
            ] {
                cx.update(|cx| crate::theme::set_mode(mode, cx));
                for pasted in [false, true] {
                    step(cx, handle, |_, cx| {
                        form.update(cx, |form, cx| {
                            form.pasted = pasted;
                            let mut config = config::parse_yaml(YAML).unwrap();
                            let original = config.contexts[0].clone();
                            config.contexts = (0..40)
                                .map(|i| {
                                    let mut c = original.clone();
                                    c.name = format!("long-context-name-with-many-characters-{i}");
                                    c
                                })
                                .collect();
                            form.set_test_candidates(config, cx);
                        });
                    });
                    step(cx, handle, |window, _| {
                        let body = window.find("add-cluster-body").bounds();
                        let footer = window.find("add-cluster-footer").bounds();
                        let add = window.find("add-selected-clusters").bounds();
                        assert!(body.bottom() <= footer.top() + px(1.));
                        assert!(footer.bottom() < dimensions.height);
                        assert!(add.top() >= footer.top());
                        assert!(window.find("cluster-source-tabs").bounds().top() > px(0.));
                    });
                }
            }
        }
    }
}
