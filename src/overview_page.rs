//! Cluster dashboard presentation. Each view owns only its scroll/focus, sharing its sampler.
use crate::{
    backend::{
        Backend,
        overview::{self, Allocation, OverviewLease, OverviewSnapshot, OverviewState, Usage},
    },
    inspector::PanelState,
    overview_chart::UsagePlot,
};
use chrono::{DateTime, Local, Utc};
use gpui::component::{
    ActiveTheme, Sizable,
    button::{Button, ButtonVariants},
    tooltip::Tooltip,
};
use gpui::{
    App, AppContext, Context, Entity, FocusHandle, Focusable, IntoElement, Render, ScrollHandle,
    Task, TestSupportExt, Window, canvas, div, prelude::*, px, relative,
};
use pintle_gpui_kit::{kit as gpui, shell::workspace::Document};
use std::{sync::Arc, time::Duration};

pub struct OverviewPage {
    backend: Arc<Backend>,
    cluster: String,
    title: String,
    panel: Entity<PanelState>,
    lease: Option<OverviewLease>,
    pub(crate) state: OverviewState,
    focus: FocusHandle,
    pub(crate) scroll: ScrollHandle,
    width: gpui::Pixels,
    _poll: Task<()>,
}
impl OverviewPage {
    pub fn new(
        document: &Document,
        panel: Entity<PanelState>,
        backend: Arc<Backend>,
        cx: &mut Context<Self>,
    ) -> Self {
        let cluster = document
            .key
            .0
            .split_once('/')
            .expect("cluster overview key")
            .0
            .to_string();
        let lease = backend.overview(&cluster);
        let timer = cx.background_executor().clone();
        let poll = cx.spawn(async move |entity, cx| {
            loop {
                timer.timer(Duration::from_secs(1)).await;
                if entity
                    .update(cx, |page, cx| {
                        if page.lease.as_ref().is_some_and(OverviewLease::invalidated) {
                            page.state = OverviewState::default();
                            page.lease = Some(page.backend.overview(&page.cluster));
                        }
                        if let Some(state) = page.lease.as_mut().and_then(OverviewLease::take) {
                            page.state = state;
                        }
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        Self {
            backend,
            cluster,
            title: document.context.to_string(),
            panel,
            lease: Some(lease),
            state: OverviewState::default(),
            focus: cx.focus_handle(),
            scroll: ScrollHandle::new(),
            width: px(1100.),
            _poll: poll,
        }
    }
    pub fn rename(&mut self, document: &Document, cx: &mut Context<Self>) {
        if self.title != document.context.as_ref() {
            self.title = document.context.to_string();
            cx.notify();
        }
    }
    fn open_list(&self, name: &str, cx: &mut Context<Self>) {
        self.panel.update(cx, |panel, cx| {
            panel.inspect(
                self.cluster.clone(),
                "overview".into(),
                serde_json::json!({"name":name}),
                cx,
            )
        });
    }
    fn refresh(&self, cx: &mut Context<Self>) {
        if let Some(lease) = &self.lease {
            lease.refresh();
        }
        cx.notify();
    }
    #[cfg(test)]
    pub fn set_test_state(&mut self, state: OverviewState, cx: &mut Context<Self>) {
        self.lease = None;
        self.state = state;
        cx.notify();
    }
    fn cards(
        &self,
        snapshot: Option<&OverviewSnapshot>,
        now: DateTime<Utc>,
        card_width: gpui::Pixels,
        cx: &Context<Self>,
    ) -> Vec<gpui::AnyElement> {
        let neutral = cx.theme().foreground;
        let amber = cx.theme().warning;
        let nodes = snapshot
            .map(|s| s.nodes.clone())
            .unwrap_or_else(|| Err("Loading nodes…".into()));
        let all_ready = nodes
            .as_ref()
            .is_ok_and(|n| n.total > 0 && n.ready == n.total);
        let (value, caption, ratio) = match nodes {
            Ok(n) => (
                n.total.to_string(),
                if n.total == 0 {
                    "No nodes".into()
                } else if n.ready == n.total {
                    "all ready".into()
                } else {
                    format!("{} / {} ready", n.ready, n.total)
                },
                (n.total > 0).then(|| n.ready as f64 / n.total as f64 * 100.),
            ),
            Err(e) => ("—".into(), e, None),
        };
        let node_note = caption.clone();
        let nodes = card(
            "overview-nodes",
            "NODES",
            value,
            div()
                .id("node-readiness")
                .truncate()
                .text_color(if all_ready {
                    cx.theme().success
                } else {
                    cx.theme().muted_foreground
                })
                .tooltip(move |_, cx| cx.new(|_| Tooltip::new(node_note.clone())).into())
                .child(caption),
            ratio,
            neutral,
            cx,
        )
        .test_support()
        .w(card_width)
        .on_click(cx.listener(|page, _, _, cx| page.open_list("Nodes", cx)))
        .into_any_element();
        let pods = snapshot
            .map(|s| s.pods.clone())
            .unwrap_or_else(|| Err("Loading pods…".into()));
        let capacity = snapshot
            .map(|s| s.pod_capacity.clone())
            .unwrap_or_else(|| Err("Loading capacity…".into()));
        let (value, pending, ratio, problem) = match (pods, capacity) {
            (Ok(p), Ok(total)) => (
                format!("{} / {total:.0}", p.active),
                p.pending,
                Some(p.active as f64 / total * 100.),
                None,
            ),
            (Ok(p), Err(e)) => (format!("{} / —", p.active), p.pending, None, Some(e)),
            (Err(e), _) => ("—".into(), 0, None, Some(e)),
        };
        let namespaces = snapshot
            .map(|s| s.namespaces.clone())
            .unwrap_or_else(|| Err("Loading namespaces…".into()));
        let (label, namespace_note) = match namespaces {
            Ok(n) => (
                format!("{n} namespaces"),
                format!("{n} namespaces · {pending} pending Pods"),
            ),
            Err(e) => ("Namespaces unavailable".into(), e),
        };
        let caption = div()
            .flex()
            .flex_col()
            .min_w_0()
            .gap_1()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_1()
                    .child(
                        Button::new("overview-namespaces")
                            .label(label)
                            .tooltip(namespace_note)
                            .ghost()
                            .xsmall()
                            .on_click(cx.listener(|page, _, _, cx| {
                                cx.stop_propagation();
                                page.open_list("Namespaces", cx);
                            })),
                    )
                    .when(pending > 0, |d| d.child(format!("· {pending} pending"))),
            )
            .when_some(problem, |d, problem| d.child(note_text(problem, cx)));
        let pods = card("overview-pods", "PODS", value, caption, ratio, amber, cx)
            .test_support()
            .w(card_width)
            .on_click(cx.listener(|page, _, _, cx| page.open_list("Pods", cx)))
            .into_any_element();
        let cpu = snapshot
            .map(|s| fresh(&s.cpu, now))
            .unwrap_or_else(|| Err("Loading metrics…".into()));
        let memory = snapshot
            .map(|s| fresh(&s.memory, now))
            .unwrap_or_else(|| Err("Loading metrics…".into()));
        let cpu_requests = snapshot
            .map(|s| s.cpu_requests.clone())
            .unwrap_or_else(|| Err("Loading requests…".into()));
        let memory_requests = snapshot
            .map(|s| s.memory_requests.clone())
            .unwrap_or_else(|| Err("Loading requests…".into()));
        let mut cards = vec![nodes, pods];
        for (id, title, part, memory, color) in [
            ("overview-cpu", "CPU", cpu, false, neutral),
            ("overview-memory", "MEMORY", memory, true, amber),
            (
                "overview-cpu-requests",
                "CPU REQUESTS",
                cpu_requests,
                false,
                neutral,
            ),
            (
                "overview-memory-requests",
                "MEMORY REQUESTS",
                memory_requests,
                true,
                neutral,
            ),
        ] {
            let (value, caption, ratio) = allocation_text(&part, memory);
            cards.push(
                card(id, title, value, note_text(caption, cx), ratio, color, cx)
                    .test_support()
                    .w(card_width)
                    .into_any_element(),
            );
        }
        cards
    }
    fn chart(
        &self,
        id: &'static str,
        title: &'static str,
        memory: bool,
        width: gpui::Pixels,
        now: DateTime<Utc>,
        cx: &App,
    ) -> impl IntoElement + use<> {
        let samples = if memory {
            self.state.memory_history.clone()
        } else {
            self.state.cpu_history.clone()
        };
        let part = self
            .state
            .snapshot
            .as_ref()
            .map(|s| fresh(if memory { &s.memory } else { &s.cpu }, now))
            .unwrap_or_else(|| Err("Loading metrics…".into()));
        let (value, problem, _) = allocation_text(&part, memory);
        let points = samples.iter().filter(|p| p.value.is_some()).count();
        let note = if part.is_err() {
            problem
        } else if points < 2 {
            "Collecting samples · 30 minute window".into()
        } else {
            "Last 30 minutes · sampled every 30s".into()
        };
        div()
            .id(id)
            .test_support()
            .w(width)
            .flex_shrink_0()
            .border_1()
            .border_color(cx.theme().border)
            .rounded_lg()
            .bg(cx.theme().group_box)
            .p_4()
            .flex()
            .flex_col()
            .gap_2()
            .child(label(title, cx))
            .child(div().text_size(px(28.)).child(value))
            .child(note_text(note, cx))
            .child(
                div()
                    .id(if memory {
                        "overview-memory-plot"
                    } else {
                        "overview-cpu-plot"
                    })
                    .test_support()
                    .h(px(95.))
                    .w_full()
                    .child(UsagePlot {
                        id: if memory {
                            "memory-series"
                        } else {
                            "cpu-series"
                        },
                        samples,
                        now,
                        color: if memory {
                            cx.theme().warning
                        } else {
                            cx.theme().foreground
                        },
                        memory,
                    }),
            )
    }
    fn events(&self, now: DateTime<Utc>, cx: &Context<Self>) -> gpui::AnyElement {
        let events = self
            .state
            .snapshot
            .as_ref()
            .map(|s| s.events.clone())
            .unwrap_or_else(|| Err("Loading events…".into()));
        let mut body = div()
            .id("overview-recent-events")
            .test_support()
            .flex_shrink_0()
            .border_1()
            .border_color(cx.theme().border)
            .rounded_lg()
            .bg(cx.theme().group_box)
            .p_4()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div()
                    .flex()
                    .items_center()
                    .child(label("RECENT EVENTS", cx))
                    .child(div().flex_1())
                    .child(
                        Button::new("overview-all-events")
                            .label("View all")
                            .small()
                            .ghost()
                            .on_click(cx.listener(|page, _, _, cx| page.open_list("Events", cx))),
                    ),
            );
        match events {
            Err(e) => body = body.child(div().text_color(cx.theme().muted_foreground).child(e)),
            Ok(events) => {
                if events.is_empty() {
                    body = body.child(
                        div()
                            .py_4()
                            .text_color(cx.theme().muted_foreground)
                            .child("No events"),
                    );
                }
                for (index, event) in events.into_iter().enumerate() {
                    let age = overview::event_time(&event)
                        .map(|at| age(now, at))
                        .unwrap_or_else(|| "—".into());
                    let warning = event["type"] == "Warning";
                    let message = event["message"].as_str().unwrap_or("—").to_string();
                    let reason = event["reason"].as_str().unwrap_or("Event").to_string();
                    body = body.child(
                        div()
                            .id(("overview-event", index))
                            .test_support()
                            .border_b_1()
                            .border_color(cx.theme().border.opacity(0.5))
                            .pb_1()
                            .flex()
                            .items_start()
                            .gap_3()
                            .cursor_pointer()
                            .child(
                                div()
                                    .text_color(if warning {
                                        cx.theme().warning
                                    } else {
                                        cx.theme().primary
                                    })
                                    .child("●"),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .child(format!("{reason}  {message}")),
                            )
                            .child(
                                div()
                                    .w(px(42.))
                                    .text_size(px(11.))
                                    .text_color(cx.theme().muted_foreground)
                                    .child(age),
                            )
                            .on_click(cx.listener(move |page, _, _, cx| {
                                page.panel.update(cx, |panel, cx| {
                                    panel.inspect(
                                        page.cluster.clone(),
                                        "events".into(),
                                        event.clone(),
                                        cx,
                                    )
                                });
                            })),
                    );
                }
            }
        }
        body.into_any_element()
    }
}
fn note_text(text: String, cx: &App) -> gpui::AnyElement {
    let tooltip = text.clone();
    div()
        .id("overview-note")
        .min_w_0()
        .truncate()
        .text_size(px(11.))
        .text_color(cx.theme().muted_foreground)
        .tooltip(move |_, cx| cx.new(|_| Tooltip::new(tooltip.clone())).into())
        .child(text)
        .into_any_element()
}
fn label(text: &'static str, cx: &App) -> impl IntoElement + use<> {
    div()
        .text_size(px(11.))
        .text_color(cx.theme().muted_foreground)
        .child(text)
}
fn fresh(part: &Result<Usage, String>, now: DateTime<Utc>) -> Result<Allocation, String> {
    let usage = part.as_ref().map_err(Clone::clone)?;
    if !usage.fresh(now) {
        return Err("Metrics are stale · waiting for a fresh sample".into());
    }
    Ok(usage.allocation.clone())
}
fn allocation_text(
    part: &Result<Allocation, String>,
    memory: bool,
) -> (String, String, Option<f64>) {
    match part {
        Ok(a) => (
            format!("{:.0}%", a.percent()),
            if memory {
                format!(
                    "{:.1} / {:.1} GiB",
                    a.used / 1073741824.,
                    a.total / 1073741824.
                )
            } else {
                format!("{:.2} / {:.2} cores", a.used, a.total)
            },
            Some(a.percent()),
        ),
        Err(e) => ("—".into(), e.clone(), None),
    }
}
fn age(now: DateTime<Utc>, at: DateTime<Utc>) -> String {
    let seconds = (now - at).num_seconds().max(0);
    if seconds >= 86400 {
        format!("{}d", seconds / 86400)
    } else if seconds >= 3600 {
        format!("{}h", seconds / 3600)
    } else if seconds >= 60 {
        format!("{}m", seconds / 60)
    } else {
        format!("{seconds}s")
    }
}
fn card(
    id: &'static str,
    title: &'static str,
    value: String,
    caption: impl IntoElement,
    ratio: Option<f64>,
    color: gpui::Hsla,
    cx: &App,
) -> gpui::Stateful<gpui::Div> {
    let basis = match title {
        "NODES" => "Progress is Ready nodes / all nodes.",
        "PODS" => {
            "Active Pods exclude Succeeded and Failed. Capacity is total Node allocatable Pod slots."
        }
        _ => {
            "Percentages use Node allocatable capacity. Requests include only scheduled active Pods."
        }
    };
    let tip = format!("{title}: {value}. {basis}");
    div()
        .id(id)
        .aria_label(format!("{title}: {value}"))
        .h(px(118.))
        .flex_shrink_0()
        .border_1()
        .border_color(cx.theme().border)
        .rounded_lg()
        .bg(cx.theme().group_box)
        .p_4()
        .flex()
        .flex_col()
        .gap_2()
        .tooltip(move |_, cx| cx.new(|_| Tooltip::new(tip.clone())).into())
        .child(label(title, cx))
        .child(div().text_size(px(28.)).child(value))
        .child(
            div()
                .text_size(px(11.))
                .text_color(cx.theme().muted_foreground)
                .min_w_0()
                .child(caption),
        )
        .child(div().flex_1())
        .child(
            div()
                .h(px(4.))
                .w_full()
                .rounded_full()
                .bg(cx.theme().muted)
                .when_some(ratio, |d, ratio| {
                    d.child(
                        div()
                            .h_full()
                            .rounded_full()
                            .w(relative((ratio / 100.).clamp(0., 1.) as f32))
                            .bg(color),
                    )
                }),
        )
}
impl Focusable for OverviewPage {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Render for OverviewPage {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let now = Utc::now();
        let snapshot = self.state.snapshot.as_ref();
        let usable = (self.width - px(40.)).max(px(120.));
        let columns = if usable >= px(1000.) {
            4
        } else if usable >= px(520.) {
            2
        } else {
            1
        };
        let card_width = (usable - px(12. * (columns - 1) as f32)) / columns as f32;
        let chart_width = if usable >= px(760.) {
            (usable - px(12.)) / 2.
        } else {
            usable
        };
        let status = match snapshot {
            None => "Read-only · Loading…".into(),
            Some(s) if (now - s.collected_at).num_seconds() > 90 => "Read-only · Stale data".into(),
            Some(s) => format!(
                "Read-only · {} · Updated {}",
                if s.partial(now) {
                    "Partial data"
                } else {
                    "Connected"
                },
                s.collected_at.with_timezone(&Local).format("%H:%M:%S")
            ),
        };
        let owner = cx.weak_entity();
        div()
            .id("cluster-overview-page")
            .test_support()
            .size_full()
            .min_w_0()
            .min_h_0()
            .relative()
            .flex()
            .flex_col()
            .track_focus(&self.focus)
            .font_family(cx.theme().mono_font_family.clone())
            .text_size(px(13.))
            .child(
                canvas(
                    |_, _, _| (),
                    move |bounds, _, _, cx| {
                        let width = bounds.size.width;
                        let owner = owner.clone();
                        cx.defer(move |cx| {
                            let _ = owner.update(cx, |page, cx| {
                                if (page.width - width).abs() > px(1.) {
                                    page.width = width;
                                    cx.notify();
                                }
                            });
                        });
                    },
                )
                .absolute()
                .inset_0(),
            )
            .child(
                div()
                    .id("overview-header")
                    .test_support()
                    .flex_shrink_0()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .p_5()
                    .gap_3()
                    .child(div().flex_1().child(format!("{} / Overview", self.title)))
                    .child(
                        div()
                            .id("overview-status")
                            .test_support()
                            .text_size(px(11.))
                            .text_color(cx.theme().muted_foreground)
                            .child(status),
                    )
                    .child(
                        Button::new("refresh-overview")
                            .label("Refresh")
                            .small()
                            .on_click(cx.listener(|page, _, _, cx| page.refresh(cx))),
                    ),
            )
            .child(
                div()
                    .id("overview-scroll")
                    .test_support()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .track_scroll(&self.scroll)
                    .px_4()
                    .pb_4()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(
                        div()
                            .id("overview-cards")
                            .test_support()
                            .flex_shrink_0()
                            .flex()
                            .flex_wrap()
                            .gap_3()
                            .children(self.cards(snapshot, now, card_width, cx)),
                    )
                    .child(
                        div()
                            .id("overview-charts")
                            .test_support()
                            .flex_shrink_0()
                            .flex()
                            .flex_wrap()
                            .gap_3()
                            .child(self.chart(
                                "overview-cpu-chart",
                                "CPU USAGE",
                                false,
                                chart_width,
                                now,
                                cx,
                            ))
                            .child(self.chart(
                                "overview-memory-chart",
                                "MEMORY USAGE",
                                true,
                                chart_width,
                                now,
                                cx,
                            )),
                    )
                    .child(self.events(now, cx)),
            )
    }
}
