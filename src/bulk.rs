//! Application-owned demo bulk commands. Never mutates fixtures or contacts a cluster.
use crate::{
    catalog::{Resource, Row},
    resource_page::{PanelState, ShowOutput},
};
use gpui::component::{
    ActiveTheme, Disableable, WindowExt,
    button::{Button, ButtonVariants},
    input::{Input, InputEvent, InputState},
};
use gpui::{prelude::*, *};
use pintle_gpui_kit::kit as gpui;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BulkAction {
    Delete,
    Scale,
    Restart,
}
impl BulkAction {
    pub fn for_resource(resource: Resource) -> &'static [Self] {
        match resource.key {
            "overview" => &[],
            "deployments" | "statefulsets" => &[Self::Delete, Self::Scale, Self::Restart],
            "daemonsets" => &[Self::Delete, Self::Restart],
            _ => &[Self::Delete],
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Delete => "Delete",
            Self::Scale => "Scale",
            Self::Restart => "Rolling restart",
        }
    }
    pub fn id(self) -> &'static str {
        match self {
            Self::Delete => "bulk-delete",
            Self::Scale => "bulk-scale",
            Self::Restart => "bulk-restart",
        }
    }
    fn confirm_label(self) -> &'static str {
        match self {
            Self::Delete => "Simulate delete",
            Self::Scale => "Simulate scale",
            Self::Restart => "Simulate restart",
        }
    }
}

pub fn parse_replicas(text: &str) -> Option<i32> {
    if text.is_empty() || !text.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

type RestoreFocus = Box<dyn Fn(&mut Window, &mut App)>;

pub struct BulkDialog {
    pub action: BulkAction,
    pub cluster: String,
    pub resource: Resource,
    pub targets: Vec<Row>,
    pub hidden: usize,
    pub replicas: Entity<InputState>,
    panel: Entity<PanelState>,
    restore: RestoreFocus,
    submitted: bool,
    _subscription: Subscription,
}
impl BulkDialog {
    pub fn new(
        action: BulkAction,
        rows: &crate::resource_page::Rows,
        restore: impl Fn(&mut Window, &mut App) + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let replicas = cx.new(|cx| InputState::new(window, cx).default_value("1"));
        let subscription = cx.subscribe(&replicas, |_, _, event, cx| {
            if matches!(event, InputEvent::Change) {
                cx.notify();
            }
        });
        Self {
            action,
            cluster: rows.cluster.clone(),
            resource: rows.resource,
            targets: rows
                .rows
                .iter()
                .filter(|row| rows.selected.contains(&row.id))
                .cloned()
                .collect(),
            hidden: rows.hidden_selected_count(),
            replicas,
            panel: rows.panel.clone(),
            restore: Box::new(restore),
            submitted: false,
            _subscription: subscription,
        }
    }
    pub fn confirm(&mut self, cx: &mut Context<Self>) -> bool {
        if self.submitted || self.targets.is_empty() {
            return false;
        }
        let replicas = if self.action == BulkAction::Scale {
            let Some(value) = parse_replicas(&self.replicas.read(cx).value()) else {
                return false;
            };
            format!(" · replicas={value}")
        } else {
            String::new()
        };
        let names = self
            .targets
            .iter()
            .map(target_label)
            .collect::<Vec<_>>()
            .join(", ");
        let message = format!(
            "Demo simulation · {} · {} / {} · {} selected · {} hidden by filters{replicas}\nTargets: {names}\nNo resources were changed.",
            self.action.label(),
            self.cluster,
            self.resource.title,
            self.targets.len(),
            self.hidden
        );
        self.submitted = true;
        self.panel.update(cx, |panel, cx| {
            panel.output.push(message);
            cx.emit(ShowOutput);
            cx.notify();
        });
        true
    }
    pub fn restore_focus(&self, window: &mut Window, cx: &mut App) {
        (self.restore)(window, cx);
    }
}
fn target_label(row: &Row) -> String {
    match &row.namespace {
        Some(namespace) => format!("{namespace}/{}", row.name),
        None => row.name.clone(),
    }
}
impl Render for BulkDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let valid = self.action != BulkAction::Scale
            || parse_replicas(&self.replicas.read(cx).value()).is_some();
        div()
            .id("bulk-dialog-content")
            .test_support()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div()
                    .id("bulk-target-summary")
                    .test_support()
                    .aria_label(format!(
                        "{} / {} · {} selected · {} hidden by filters",
                        self.cluster,
                        self.resource.title,
                        self.targets.len(),
                        self.hidden
                    ))
                    .child(format!(
                        "{} / {} · {} selected · {} hidden by filters",
                        self.cluster,
                        self.resource.title,
                        self.targets.len(),
                        self.hidden
                    )),
            )
            .child(
                div()
                    .text_color(cx.theme().muted_foreground)
                    .child("Demo — this simulates a command only. No resources will be changed."),
            )
            .child(
                div()
                    .id("bulk-target-list")
                    .max_h(px(180.))
                    .overflow_y_scroll()
                    .font_family(cx.theme().mono_font_family.clone())
                    .text_size(px(12.))
                    .children(
                        self.targets
                            .iter()
                            .map(|row| div().child(target_label(row))),
                    ),
            )
            .when(self.action == BulkAction::Scale, |content| {
                content.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child("Replicas for each selected resource")
                        .child(
                            Input::new(&self.replicas)
                                .id("bulk-replicas")
                                .aria_label("Replicas"),
                        )
                        .when(!valid, |d| {
                            d.child(
                                div()
                                    .id("bulk-replicas-error")
                                    .test_support()
                                    .text_color(cx.theme().danger)
                                    .child("Enter a whole number from 0 to 2,147,483,647."),
                            )
                        }),
                )
            })
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap_2()
                    .child(
                        Button::new("bulk-cancel")
                            .label("Cancel")
                            .on_click(cx.listener(|this, _, window, cx| {
                                window.close_dialog(cx);
                                this.restore_focus(window, cx);
                            })),
                    )
                    .child(
                        Button::new("bulk-confirm")
                            .label(self.action.confirm_label())
                            .primary()
                            .when(self.action == BulkAction::Delete, |button| button.danger())
                            .disabled(!valid)
                            .on_click(cx.listener(|this, _, window, cx| {
                                if this.confirm(cx) {
                                    window.close_dialog(cx);
                                    this.restore_focus(window, cx);
                                }
                            })),
                    ),
            )
    }
}
