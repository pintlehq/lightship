//! Shared application activity and resource-open requests; detail state belongs to each view.
use gpui::{Context, EventEmitter};
use pintle_gpui_kit::kit as gpui;
use serde_json::Value;
#[derive(Clone)]
pub struct Inspect {
    pub cluster: String,
    pub key: String,
    pub object: Value,
}
#[derive(Default)]
pub struct PanelState {
    pub output: Vec<String>,
}
impl EventEmitter<Inspect> for PanelState {}
impl PanelState {
    pub fn inspect(&mut self, cluster: String, key: String, object: Value, cx: &mut Context<Self>) {
        cx.emit(Inspect {
            cluster,
            key,
            object,
        });
    }
    pub fn record(&mut self, message: String, cx: &mut Context<Self>) {
        self.output.push(message);
        if self.output.len() > 200 {
            self.output.remove(0);
        }
        cx.notify();
    }
}
