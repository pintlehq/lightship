//! Interactive sessions share only the reviewed context. The kubectl launcher reads it through
//! a private Unix socket into a per-invocation pipe, including for Keychain-backed imports.
use super::*;
use crate::backend::config::{self, Connection};
use gpui::component::input::{Input, InputState};
use pintle_gpui_kit::terminal::{TerminalOptions, TerminalSession, TerminalView};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    io::{BufRead, BufReader, Write},
    os::unix::{
        fs::PermissionsExt,
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};

struct CliContext {
    root: tempfile::TempDir,
    env: BTreeMap<OsString, OsString>,
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl CliContext {
    fn new(connection: &Connection) -> Result<Self, String> {
        let mut cfg = connection.read()?;
        let trust = config::prepare(&mut cfg, &connection.context)?;
        if trust.is_some() && trust != connection.trusted_exec {
            return Err("Review the credential program in Manage clusters first".into());
        }
        cfg.contexts.retain(|c| c.name == connection.context);
        let context = cfg
            .contexts
            .first()
            .and_then(|c| c.context.as_ref())
            .ok_or("Missing context")?;
        cfg.clusters.retain(|c| c.name == context.cluster);
        cfg.auth_infos
            .retain(|u| Some(&u.name) == context.user.as_ref());
        cfg.current_context = Some(connection.context.clone());
        cfg.api_version = Some("v1".into());
        cfg.kind = Some("Config".into());
        let bytes = serde_json::to_vec(&cfg).map_err(|_| "Cannot prepare session context")?;
        let path = std::env::var_os("PATH").unwrap_or_default();
        let mut dirs: Vec<_> = std::env::split_paths(&path).collect();
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
        let binary = dirs
            .iter()
            .map(|p| p.join("kubectl"))
            .find(|p| p.is_absolute() && p.is_file())
            .ok_or("Install kubectl to start this session")?;
        let root = tempfile::Builder::new()
            .prefix("lightship-cli-")
            .tempdir_in("/tmp")
            .map_err(|_| "Cannot create session directory")?;
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot secure session directory")?;
        let socket = root.path().join("context.sock");
        let listener =
            UnixListener::bind(&socket).map_err(|_| "Cannot open session context socket")?;
        let wrapper = root.path().join("kubectl");
        let script = br#"#!/bin/bash
if [[ -n "${LIGHTSHIP_TARGET_UID:-}" ]]; then
    uid=$("$LIGHTSHIP_KUBECTL" --kubeconfig <(/usr/bin/nc -U "$LIGHTSHIP_CONTEXT_SOCKET" </dev/null) --request-timeout=10s get -n "$LIGHTSHIP_NAMESPACE" "$LIGHTSHIP_TARGET" -o 'jsonpath={.metadata.uid}') || exit 1
    if [[ "$uid" != "$LIGHTSHIP_TARGET_UID" ]]; then
        echo 'The selected resource has been replaced. Refresh its details.' >&2
        exit 1
    fi
fi
exec "$LIGHTSHIP_KUBECTL" --kubeconfig <(/usr/bin/nc -U "$LIGHTSHIP_CONTEXT_SOCKET" </dev/null) "$@"
"#;
        std::fs::write(&wrapper, script).map_err(|_| "Cannot create kubectl launcher")?;
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot enable kubectl launcher")?;
        dirs.insert(0, root.path().to_owned());
        let env = BTreeMap::from([
            (
                "PATH".into(),
                std::env::join_paths(dirs).map_err(|_| "Invalid executable path")?,
            ),
            ("LIGHTSHIP_KUBECTL".into(), binary.into_os_string()),
            ("LIGHTSHIP_CONTEXT_SOCKET".into(), socket.into_os_string()),
            ("KUBECONFIG".into(), OsString::from("/dev/null")),
        ]);
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let worker = std::thread::Builder::new()
            .name("lightship-cli-context".into())
            .spawn(move || {
                for stream in listener.incoming() {
                    if stopping.load(Ordering::Acquire) {
                        break;
                    }
                    let Ok(mut stream) = stream else { break };
                    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
                    let _ = stream.write_all(&bytes);
                }
            })
            .map_err(|_| "Cannot start session context")?;
        Ok(Self {
            root,
            env,
            stop,
            worker: Some(worker),
        })
    }
    fn bind_target(&mut self, namespace: &str, target: &str, uid: &str) -> Result<(), String> {
        if uid.is_empty() {
            return Err("Refresh details to verify the selected resource".into());
        }
        for (name, value) in [
            ("LIGHTSHIP_TARGET_UID", uid),
            ("LIGHTSHIP_NAMESPACE", namespace),
            ("LIGHTSHIP_TARGET", target),
        ] {
            self.env.insert(name.into(), value.into());
        }
        Ok(())
    }
    fn launcher(&self) -> PathBuf {
        self.root.path().join("kubectl")
    }
}
impl Drop for CliContext {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = UnixStream::connect(self.root.path().join("context.sock"));
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
    }
}
struct Terminal {
    cluster: String,
    label: String,
    view: Entity<TerminalView>,
    session: Entity<TerminalSession>,
    _context: CliContext,
}
struct Forward {
    cluster: String,
    label: String,
    child: Child,
    messages: mpsc::Receiver<String>,
    status: String,
    _context: CliContext,
}
impl Drop for Forward {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
pub struct Sessions {
    terminals: Vec<Terminal>,
    active: usize,
    forwards: Vec<Forward>,
    pub error: String,
    focus: FocusHandle,
    _poll: gpui::Task<()>,
}
impl Sessions {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let timer = cx.background_executor().clone();
        let poll = cx.spawn(async move |owner, cx| {
            loop {
                timer.timer(Duration::from_millis(300)).await;
                if owner
                    .update(cx, |this, cx| {
                        let mut changed = false;
                        for f in &mut this.forwards {
                            for status in f.messages.try_iter() {
                                f.status = status;
                                changed = true;
                            }
                            if !f.status.starts_with("Stopped")
                                && let Ok(Some(exit)) = f.child.try_wait()
                            {
                                f.status = format!("Stopped ({exit})");
                                changed = true;
                            }
                        }
                        if changed {
                            cx.notify()
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        Self {
            terminals: Vec::new(),
            active: 0,
            forwards: Vec::new(),
            error: String::new(),
            focus: cx.focus_handle(),
            _poll: poll,
        }
    }
    pub fn retain(&mut self, ids: &HashSet<String>, cx: &mut Context<Self>) {
        self.terminals.retain(|t| {
            if ids.contains(&t.cluster) {
                true
            } else {
                t.session.update(cx, |s, cx| s.close(cx));
                false
            }
        });
        self.active = self.active.min(self.terminals.len().saturating_sub(1));
        self.forwards.retain(|f| ids.contains(&f.cluster));
        cx.notify();
    }
    pub fn terminal(
        &mut self,
        connection: &Connection,
        pod: Option<(&str, &str, &str, &str)>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        let mut context = CliContext::new(connection)?;
        if let Some((ns, name, _, uid)) = pod {
            context.bind_target(ns, &format!("pods/{name}"), uid)?;
        }
        let mut options = TerminalOptions {
            env: context.env.clone(),
            ..Default::default()
        };
        let mut label = connection.name.clone();
        if let Some((namespace, name, container, _)) = pod {
            options.program = Some(context.launcher().into_os_string());
            options.args = [
                "exec", "-it", "-n", namespace, name, "-c", container, "--", "sh",
            ]
            .map(Into::into)
            .to_vec();
            label = format!("{name} / {container}");
        } else {
            // A login shell can reset PATH before the first kubectl command.
            options.program = Some(
                std::env::var_os("SHELL")
                    .filter(|s| Path::new(s).is_absolute())
                    .unwrap_or_else(|| "/bin/sh".into()),
            );
            if options
                .program
                .as_ref()
                .and_then(|p| Path::new(p).file_name())
                .is_some_and(|p| p == "zsh")
            {
                options.args = vec!["-f".into(), "-i".into()];
            }
        }
        let session = cx.new(|cx| TerminalSession::new(options, cx));
        let view = cx.new(|cx| TerminalView::new(session.clone(), window, cx));
        view.focus_handle(cx).focus(window, cx);
        self.active = self.terminals.len();
        self.terminals.push(Terminal {
            cluster: connection.id.clone(),
            label,
            view,
            session,
            _context: context,
        });
        self.error.clear();
        cx.notify();
        Ok(())
    }
    fn forward(
        &mut self,
        connection: &Connection,
        target: (&str, &str),
        namespace: &str,
        local: Option<u16>,
        remote: u16,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        if remote == 0 || local == Some(0) {
            return Err("Ports must be between 1 and 65535".into());
        }
        let mut context = CliContext::new(connection)?;
        let (target, uid) = target;
        context.bind_target(namespace, target, uid)?;
        let mapping = format!(
            "{}:{remote}",
            local.map(|v| v.to_string()).unwrap_or_default()
        );
        let mut child = Command::new(context.launcher())
            .envs(&context.env)
            .args([
                "port-forward",
                "--address",
                "127.0.0.1",
                "-n",
                namespace,
                target,
                &mapping,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Could not start kubectl port-forward")?;
        let stdout = child.stdout.take().expect("piped stdout");
        let (tx, messages) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(port) = line
                    .strip_prefix("Forwarding from 127.0.0.1:")
                    .and_then(|s| s.split_whitespace().next())
                    .and_then(|p| p.parse::<u16>().ok())
                {
                    let _ = tx.send(format!("127.0.0.1:{port} → {remote}"));
                }
            }
        });
        self.error.clear();
        self.forwards.push(Forward {
            cluster: connection.id.clone(),
            label: format!("{} / {namespace} / {target}", connection.name),
            status: "Starting…".into(),
            child,
            messages,
            _context: context,
        });
        cx.notify();
        Ok(())
    }
    pub fn terminal_count(&self) -> usize {
        self.terminals.len()
    }
    pub fn terminal_panel(&self, cx: &Context<Self>) -> gpui::AnyElement {
        div()
            .size_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_1()
                    .flex_wrap()
                    .children(self.terminals.iter().enumerate().map(|(idx, t)| {
                        Button::new(("terminal-tab", idx))
                            .ghost()
                            .small()
                            .label(t.label.clone())
                            .on_click(cx.listener(move |this, _, w, cx| {
                                this.active = idx;
                                this.terminals[idx].view.focus_handle(cx).focus(w, cx);
                                cx.notify()
                            }))
                    }))
                    .when(!self.terminals.is_empty(), |d| {
                        d.child(
                            Button::new("close-terminal")
                                .ghost()
                                .xsmall()
                                .label("Close session")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    let t = this.terminals.remove(this.active);
                                    t.session.update(cx, |s, cx| s.close(cx));
                                    this.active = this.active.saturating_sub(1);
                                    cx.notify();
                                })),
                        )
                    }),
            )
            .when(!self.error.is_empty(), |d| d.child(self.error.clone()))
            .when_some(self.terminals.get(self.active), |d, t| {
                d.child(div().flex_1().min_h_0().child(t.view.clone()))
            })
            .into_any_element()
    }
}
pub fn terminal_surface(sessions: &Entity<Sessions>, cx: &mut App) -> gpui::AnyElement {
    sessions.update(cx, |s, cx| s.terminal_panel(cx))
}
impl Focusable for Sessions {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Render for Sessions {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("port-forwards")
            .track_focus(&self.focus)
            .overflow_y_scroll()
            .size_full()
            .p_4()
            .flex()
            .flex_col()
            .gap_3()
            .child("Port forwards")
            .when(!self.error.is_empty(), |d| {
                d.child(
                    div()
                        .text_color(cx.theme().danger)
                        .child(self.error.clone()),
                )
            })
            .when(self.forwards.is_empty(), |d| {
                d.child("No active port forwards")
            })
            .children(self.forwards.iter().enumerate().map(|(index, f)| {
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(div().flex_1().child(f.label.clone()))
                    .child(f.status.clone())
                    .child(
                        Button::new(("stop-forward", index))
                            .small()
                            .label("Stop")
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.forwards.remove(index);
                                cx.notify()
                            })),
                    )
            }))
    }
}
impl Lightship {
    pub fn new_terminal(
        &mut self,
        cluster: Option<&str>,
        pod: Option<(&str, &str, &str, &str)>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let current = self
            .workspace
            .read(cx)
            .active_view(cx)
            .and_then(|v| self.workspace.read(cx).document(v, cx));
        let current = cluster.or_else(|| {
            current
                .as_ref()
                .and_then(|d| d.key.0.split_once('/').map(|(id, _)| id))
        });
        let manager = self.connections.read(cx);
        let locked = manager.backend.is_read_only();
        let connection = manager
            .settings
            .connections
            .iter()
            .find(|c| Some(c.id.as_str()) == current)
            .or_else(|| {
                if cluster.is_none() {
                    manager.settings.connections.first()
                } else {
                    None
                }
            })
            .cloned();
        self.show_terminal = true;
        if !self.layout.read(cx).panel_visible {
            self.toggle_panel(window, cx)
        }
        self.sessions.update(cx, |sessions, cx| {
            let result = if locked {
                Err("Switch to read-write mode to open an interactive shell".to_owned())
            } else {
                connection
                    .ok_or_else(|| "Add a cluster to start a terminal".to_string())
                    .and_then(|c| sessions.terminal(&c, pod, window, cx))
            };
            if let Err(e) = result {
                sessions.error = e;
                cx.notify()
            }
        });
        cx.notify();
    }
    pub fn forward_dialog(
        &mut self,
        cluster: &str,
        target: String,
        namespace: String,
        uid: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(connection) = self
            .connections
            .read(cx)
            .settings
            .connections
            .iter()
            .find(|c| c.id == cluster)
            .cloned()
        else {
            return;
        };
        let local = cx.new(|cx| InputState::new(window, cx).placeholder("Local port (automatic)"));
        let remote = cx.new(|cx| InputState::new(window, cx).placeholder("Remote port"));
        let owner = cx.weak_entity();
        let error = Rc::new(RefCell::new(String::new()));
        window.open_dialog(cx, move |dialog, _, cx| {
            let error=error.clone();let message=error.borrow().clone();let uid=uid.clone();
            let owner = owner.clone();
            let target = target.clone();
            let ns = namespace.clone();
            let connection = connection.clone();
            let local = local.clone();
            let remote = remote.clone();
            dialog
                .title("Port forward")
                .centered()
                .child(format!("{} / {ns} / {target}", connection.name))
                .child(Input::new(&remote))
                .child(Input::new(&local))
                .child(div().text_color(cx.theme().danger).child(message))
                .child(
                    Button::new("start-forward")
                        .label("Start")
                        .on_click(move |_, w, cx| {
                            let _ = owner.update(cx, |this, cx| {
                                let remote=remote.read(cx).value().parse::<u16>().ok().filter(|p|*p>0);
                                let text=local.read(cx).value();
                                let local=text.parse::<u16>().ok().filter(|p|*p>0);
                                let Some(remote)=remote.filter(|_|text.is_empty()||local.is_some()) else {
                                    *error.borrow_mut()="Enter a port from 1 to 65535. Leave the local port empty for automatic allocation.".into();w.refresh();return
                                };
                                let outcome = this.sessions.update(cx, |s, cx| {
                                    s.forward(&connection, (&target,&uid), &ns, local, remote, cx)
                                });
                                w.close_dialog(cx);
                                if let Err(e) = outcome {
                                    this.sessions.update(cx, |s, cx| {
                                        s.error = e;
                                        cx.notify()
                                    });
                                }
                                this.open_utility("app/forwards", "Port forwards", w, cx);
                            });
                        }),
                )
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Uses the locally installed kubectl and a private Unix socket"]
    fn kubectl_session_reads_only_the_selected_context() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("source.json");
        let cfg = serde_json::json!({
            "apiVersion":"v1","kind":"Config","current-context":"another",
            "contexts":[{"name":"another","context":{"cluster":"another"}},{"name":"selected","context":{"cluster":"selected","user":"reviewed"}}],
            "clusters":[{"name":"another","cluster":{"server":"https://unselected.invalid"}},{"name":"selected","cluster":{"server":"https://selected.invalid"}}],
            "users":[{"name":"reviewed","user":{"token":"fixture-token"}},{"name":"other","user":{"token":"other-fixture"}}]
        });
        std::fs::write(&path, cfg.to_string()).unwrap();
        let connection = Connection {
            id: "test".into(),
            name: "Test".into(),
            context: "selected".into(),
            source: config::Source::Files(vec![path]),
            trusted_exec: None,
        };
        let context = CliContext::new(&connection).unwrap();
        let output = Command::new(context.launcher())
            .envs(&context.env)
            .args(["config", "view", "--raw", "-o", "json"])
            .output()
            .unwrap();
        assert!(output.status.success());
        let config: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(config["current-context"], "selected");
        assert_eq!(config["contexts"].as_array().unwrap().len(), 1);
        assert_eq!(config["clusters"].as_array().unwrap().len(), 1);
        assert_eq!(config["users"].as_array().unwrap().len(), 1);
        assert_eq!(config["users"][0]["user"]["token"], "fixture-token");
        let root = context.root.path().to_owned();
        drop(context);
        assert!(!root.exists());
    }
}
