//! Asynchronous confirmation shared by Data editing and close guards.
use gpui::component::{
    WindowExt,
    button::{Button, ButtonVariants},
};
use gpui::{App, Task, Window, div, prelude::*};
use pintle_gpui_kit::kit as gpui;
use std::{cell::RefCell, rc::Rc};
pub fn ask(
    title: &str,
    body: String,
    label: &str,
    window: &mut Window,
    cx: &mut App,
) -> Task<bool> {
    let (tx, rx) = futures::channel::oneshot::channel();
    let sender = Rc::new(RefCell::new(Some(tx)));
    let title = title.to_string();
    let label = label.to_string();
    let focus = window.focused(cx);
    window.open_dialog(cx, move |dialog, _, _| {
        let confirm = sender.clone();
        let cancel = sender.clone();
        let close = sender.clone();
        let focus = focus.clone();
        dialog
            .title(title.clone())
            .width(gpui::px(560.))
            .overlay_closable(false)
            .child(
                div()
                    .id("confirmation-body")
                    .max_h(gpui::px(280.))
                    .overflow_y_scroll()
                    .child(body.clone()),
            )
            .footer(
                div()
                    .flex()
                    .justify_end()
                    .gap_2()
                    .child(Button::new("confirm-cancel").label("Cancel").on_click(
                        move |_, window, cx| {
                            if let Some(tx) = cancel.borrow_mut().take() {
                                let _ = tx.send(false);
                            }
                            window.close_dialog(cx);
                        },
                    ))
                    .child(
                        Button::new("confirm-accept")
                            .label(label.clone())
                            .primary()
                            .on_click(move |_, window, cx| {
                                if let Some(tx) = confirm.borrow_mut().take() {
                                    let _ = tx.send(true);
                                }
                                window.close_dialog(cx);
                            }),
                    ),
            )
            .on_close(move |_, window, cx| {
                if let Some(tx) = close.borrow_mut().take() {
                    let _ = tx.send(false);
                }
                if let Some(focus) = &focus {
                    focus.focus(window, cx);
                }
            })
    });
    cx.spawn(async move |_| rx.await.unwrap_or(false))
}
