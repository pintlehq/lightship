//! Retained multi-Pod log viewer. Each stream checks the Pod UID before opening.
use super::*;
use gpui::component::{
    Selectable,
    input::{Input, InputEvent, InputState},
    menu::{DropdownMenu, PopupMenuItem},
};
use serde_json::Value;
use std::{sync::Arc, time::Duration};
pub type LogRoutes = Rc<RefCell<HashMap<String, Vec<Value>>>>;
struct Source {
    pod: Value,
    name: String,
    container: String,
    job: Option<backend::Job<String>>,
    tail: String,
}
pub struct Logs {
    sources: Vec<Source>,
    backend: Arc<backend::Backend>,
    cluster: String,
    search: Entity<InputState>,
    find: bool,
    wrap: bool,
    paused: bool,
    focus: FocusHandle,
    _poll: gpui::Task<()>,
    _query: Subscription,
}
impl Logs {
    pub fn new(
        cluster: String,
        pods: Vec<Value>,
        backend: Arc<backend::Backend>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let sources = pods
            .into_iter()
            .map(|pod| {
                let container = pod["spec"]["containers"][0]["name"]
                    .as_str()
                    .unwrap_or("")
                    .to_owned();
                let name = format!(
                    "{}/{}",
                    pod["metadata"]["namespace"].as_str().unwrap_or(""),
                    pod["metadata"]["name"].as_str().unwrap_or("")
                );
                Source {
                    pod,
                    container,
                    name,
                    job: None,
                    tail: String::new(),
                }
            })
            .collect();
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Find in log messages"));
        let query = cx.subscribe(&search, |_, _, _: &InputEvent, cx| cx.notify());
        let timer = cx.background_executor().clone();
        let poll = cx.spawn(async move |owner, cx| {
            loop {
                timer.timer(Duration::from_millis(150)).await;
                if owner
                    .update(cx, |p: &mut Self, cx| {
                        if p.paused {
                            return;
                        }
                        let limit = (512 * 1024 / p.sources.len().max(1)).max(1);
                        let mut change = false;
                        for source in &mut p.sources {
                            if let Some(result) = source.job.as_mut().and_then(backend::Job::take) {
                                let text =
                                    result.unwrap_or_else(|e| format!("Logs unavailable · {e}"));
                                let mut start = text.len().saturating_sub(limit);
                                while !text.is_char_boundary(start) {
                                    start += 1;
                                }
                                source.tail = backend::presentation::plain_log(&text[start..]);
                                change = true;
                                if source.job.as_ref().is_some_and(backend::Job::finished) {
                                    source.job = None;
                                }
                            }
                        }
                        if change {
                            cx.notify()
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        let mut page = Self {
            sources,
            backend,
            cluster,
            search,
            find: false,
            wrap: true,
            paused: false,
            focus: cx.focus_handle(),
            _poll: poll,
            _query: query,
        };
        page.start();
        page
    }
    pub fn hide(&mut self, cx: &mut Context<Self>) {
        if self.sources.iter().any(|s| s.job.is_some()) {
            for s in &mut self.sources {
                s.job = None;
            }
            self.paused = true;
            cx.notify();
        }
    }
    fn start(&mut self) {
        for s in &mut self.sources {
            if s.job.is_none() {
                s.job = Some(self.backend.logs(
                    &self.cluster,
                    s.pod.clone(),
                    backend::LogOptions {
                        container: s.container.clone(),
                        follow: true,
                        timestamps: true,
                        previous: false,
                    },
                ));
            }
        }
        self.paused = false;
    }
}
impl Focusable for Logs {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Render for Logs {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let query = self.search.read(cx).value().to_lowercase();
        let mut lines = Vec::new();
        for s in &self.sources {
            for line in s.tail.lines() {
                if !self.find || query.is_empty() || line.to_lowercase().contains(&query) {
                    let (time, text) = line.split_once(' ').unwrap_or(("", line));
                    lines.push((time, &s.name, text));
                }
            }
        }
        lines.sort_by(|a, b| a.0.cmp(b.0));
        let text = lines
            .into_iter()
            .map(|(time, name, line)| format!("{time} [{name}] {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        div()
            .size_full()
            .flex()
            .flex_col()
            .track_focus(&self.focus)
            .key_context("LightshipLogs")
            .on_key_down(cx.listener(|p, event: &gpui::KeyDownEvent, w, cx| {
                let k = &event.keystroke;
                if (k.modifiers.platform || k.modifiers.control) && k.key == "f" {
                    p.find = true;
                    p.search.focus_handle(cx).focus(w, cx);
                    cx.stop_propagation();
                    cx.notify()
                }
            }))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap_2()
                    .p_2()
                    .child(format!("Logs · {} Pods", self.sources.len()))
                    .child(
                        Button::new("pause-streams")
                            .small()
                            .label(if self.paused { "Resume" } else { "Pause" })
                            .on_click(cx.listener(|p, _, _, cx| {
                                if p.paused {
                                    p.start()
                                } else {
                                    for s in &mut p.sources {
                                        s.job = None;
                                    }
                                    p.paused = true
                                }
                                cx.notify()
                            })),
                    )
                    .child(
                        Button::new("wrap-logs")
                            .small()
                            .label("Wrap")
                            .selected(self.wrap)
                            .on_click(cx.listener(|p, _, _, cx| {
                                p.wrap = !p.wrap;
                                cx.notify()
                            })),
                    )
                    .child(
                        Button::new("find-logs")
                            .small()
                            .label("Find")
                            .selected(self.find)
                            .on_click(cx.listener(|p, _, w, cx| {
                                p.find = !p.find;
                                if p.find {
                                    p.search.focus_handle(cx).focus(w, cx)
                                }
                                cx.notify()
                            })),
                    )
                    .child(
                        Button::new("containers")
                            .small()
                            .label("Containers")
                            .dropdown_menu({
                                let owner = cx.weak_entity();
                                let choices = self
                                    .sources
                                    .iter()
                                    .enumerate()
                                    .flat_map(|(i, s)| {
                                        s.pod["spec"]["containers"]
                                            .as_array()
                                            .into_iter()
                                            .flatten()
                                            .filter_map(move |c| {
                                                c["name"]
                                                    .as_str()
                                                    .map(|n| (i, s.name.clone(), n.to_owned()))
                                            })
                                    })
                                    .collect::<Vec<_>>();
                                move |mut menu, _, _| {
                                    for (i, pod, name) in &choices {
                                        let i = *i;
                                        let n = name.clone();
                                        let owner = owner.clone();
                                        menu = menu.item(
                                            PopupMenuItem::new(format!("{pod} / {name}")).on_click(
                                                move |_, _, cx| {
                                                    let _ = owner.update(cx, |p, cx| {
                                                        let s = &mut p.sources[i];
                                                        s.container = n.clone();
                                                        s.job = None;
                                                        s.tail.clear();
                                                        p.start();
                                                        cx.notify()
                                                    });
                                                },
                                            ),
                                        );
                                    }
                                    menu
                                }
                            }),
                    ),
            )
            .when(self.find, |d| d.child(Input::new(&self.search)))
            .child(
                div()
                    .id("combined-log-lines")
                    .flex_1()
                    .min_h_0()
                    .p_3()
                    .overflow_scroll()
                    .when(!self.wrap, |d| d.whitespace_nowrap())
                    .font_family(cx.theme().mono_font_family.clone())
                    .child(text),
            )
    }
}
