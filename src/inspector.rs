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
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Activity {
    pub time: String,
    pub cluster: String,
    pub message: String,
}
#[derive(Default)]
pub struct PanelState {
    pub output: Vec<String>,
    pub history: Vec<Activity>,
    pub error: String,
    path: Option<std::path::PathBuf>,
}
impl EventEmitter<Inspect> for PanelState {}
impl PanelState {
    pub fn load() -> Self {
        #[cfg(test)]
        return Self::default();
        #[cfg(not(test))]
        {
            let mut panel = Self::default();
            let path = crate::backend::config::settings_path().with_file_name("history.json");
            match std::fs::read(&path) {
                Ok(bytes) => match serde_json::from_slice(&bytes) {
                    Ok(rows) => panel.history = rows,
                    Err(_) => {
                        panel.error = "Could not read saved history".into();
                        return panel;
                    }
                },
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => {
                    panel.error = "Could not read saved history".into();
                    return panel;
                }
            }
            panel.path = Some(path);
            panel
        }
    }
    fn save(&mut self) {
        if let Some(path) = &self.path {
            self.error = crate::backend::config::write_json(path, &self.history)
                .err()
                .unwrap_or_default();
        }
    }
    pub fn clear(&mut self, cx: &mut Context<Self>) {
        self.history.clear();
        self.save();
        cx.notify();
    }
    pub fn activity(&mut self, cluster: &str, message: String, cx: &mut Context<Self>) {
        self.history.push(Activity {
            time: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            cluster: cluster.to_string(),
            message: message.clone(),
        });
        self.history.drain(..self.history.len().saturating_sub(500));
        self.save();
        self.record(message, cx);
    }
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
