//! Local connection metadata. Credentials are never serialized into this file.
use kube::config::{KubeConfigOptions, Kubeconfig};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum Source {
    Files(Vec<PathBuf>),
    Keychain(String),
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub context: String,
    pub source: Source,
    pub trusted_exec: Option<String>,
}
#[derive(Default, Serialize, Deserialize)]
pub struct Settings {
    pub connections: Vec<Connection>,
    pub dark: bool,
}
const SERVICE: &str = "app.pintle.lightship.readonly.kubeconfig";

#[cfg(not(test))]
pub fn settings_path() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
        .join("Library/Application Support/Lightship GPUI/settings.json")
}
#[cfg(not(test))]
pub fn load() -> Result<Settings, String> {
    match std::fs::read(settings_path()) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "Invalid local settings; file has not been overwritten".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(_) => Err("Cannot read local settings".into()),
    }
}
#[cfg(not(test))]
pub fn save(settings: &Settings) -> Result<(), String> {
    save_to(&settings_path(), settings)
}
fn save_to(path: &std::path::Path, settings: &Settings) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("Invalid settings path")?;
    std::fs::create_dir_all(parent).map_err(|_| "Cannot create settings directory")?;
    let temp = parent.join(format!(".settings-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|_| "Cannot write settings")?;
        file.write_all(&serde_json::to_vec_pretty(settings).map_err(|_| "Cannot encode settings")?)
            .map_err(|_| "Cannot write settings")?;
        file.sync_all().map_err(|_| "Cannot sync settings")?;
        std::fs::rename(&temp, path).map_err(|_| "Cannot replace settings")
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result.map_err(str::to_owned)
}
pub fn default_files() -> Vec<PathBuf> {
    std::env::var_os("KUBECONFIG")
        .map(|v| {
            std::env::split_paths(&v)
                .filter(|p| !p.as_os_str().is_empty())
                .collect()
        })
        .unwrap_or_else(|| {
            vec![PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".kube/config")]
        })
}
pub fn read_files(paths: &[PathBuf]) -> Result<Kubeconfig, String> {
    let mut config = Kubeconfig::default();
    for path in paths {
        config = config
            .merge(Kubeconfig::read_from(path).map_err(|_| "Cannot read kubeconfig file")?)
            .map_err(|_| "Cannot merge kubeconfig files")?;
    }
    Ok(config)
}
pub fn parse_yaml(text: &str) -> Result<Kubeconfig, String> {
    Kubeconfig::from_yaml(text).map_err(|_| "Invalid kubeconfig YAML".into())
}
impl Connection {
    pub fn read(&self) -> Result<Kubeconfig, String> {
        match &self.source {
            Source::Files(paths) => read_files(paths),
            Source::Keychain(id) => parse_yaml(&keychain_read(id)?),
        }
    }
    pub async fn config(&self) -> Result<kube::Config, String> {
        let mut config = self.read()?;
        let fingerprint = prepare(&mut config, &self.context)?;
        if fingerprint.is_some() && fingerprint != self.trusted_exec {
            return Err(
                "Credential plugin requires trust. Open Manage clusters and review configuration."
                    .into(),
            );
        }
        let mut client = kube::Config::from_custom_kubeconfig(
            config,
            &KubeConfigOptions {
                context: Some(self.context.clone()),
                ..Default::default()
            },
        )
        .await
        .map_err(|_| {
            "Cannot load credentials. Check certificate files and credential plugin login."
                .to_string()
        })?;
        if client.accept_invalid_certs
            || client.cluster_url.scheme_str() != Some("https")
            || !matches!(client.cluster_url.path(), "" | "/")
        {
            return Err(
                "A verified HTTPS Kubernetes endpoint without a path prefix is required".into(),
            );
        }
        client.connect_timeout = Some(std::time::Duration::from_secs(10));
        client.read_timeout = Some(std::time::Duration::from_secs(310));
        Ok(client)
    }
}
/// Resolve the executable before fingerprinting, and reject implicit shell commands.
pub fn prepare(config: &mut Kubeconfig, context: &str) -> Result<Option<String>, String> {
    let ctx = config
        .contexts
        .iter()
        .find(|c| c.name == context)
        .and_then(|c| c.context.as_ref())
        .ok_or("Context not found")?
        .clone();
    let cluster = config
        .clusters
        .iter()
        .find(|c| c.name == ctx.cluster)
        .and_then(|c| c.cluster.as_ref())
        .ok_or("Cluster not found")?;
    let endpoint: http::Uri = cluster
        .server
        .as_deref()
        .ok_or("Missing cluster endpoint")?
        .parse()
        .map_err(|_| "Invalid cluster endpoint")?;
    if endpoint.scheme_str() != Some("https")
        || !matches!(endpoint.path(), "" | "/")
        || endpoint
            .authority()
            .is_none_or(|a| a.as_str().contains('@'))
    {
        return Err(
            "A verified HTTPS endpoint without credentials or path prefix is required".into(),
        );
    }
    if cluster.insecure_skip_tls_verify == Some(true) {
        return Err("Insecure TLS is not supported".into());
    }
    let cluster_value = serde_json::to_value(cluster).map_err(|_| "Invalid cluster")?;
    let Some(auth) = config
        .auth_infos
        .iter_mut()
        .find(|a| Some(&a.name) == ctx.user.as_ref())
        .and_then(|a| a.auth_info.as_mut())
    else {
        return Ok(None);
    };
    if auth.auth_provider.is_some() {
        return Err("Legacy auth-provider is unsupported; use an exec credential plugin".into());
    }
    let Some(exec) = auth.exec.as_mut() else {
        return Ok(None);
    };
    let command = exec
        .command
        .as_ref()
        .ok_or("Credential plugin command is missing")?;
    let executable = if command.contains('/') {
        std::fs::canonicalize(command).ok()
    } else {
        std::env::var_os("PATH")
            .into_iter()
            .flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
            .map(|p| p.join(command))
            .find(|p| p.is_file())
            .and_then(|p| std::fs::canonicalize(p).ok())
    }
    .ok_or("Credential plugin was not found. Install it and sign in outside Lightship.")?;
    if matches!(
        executable.file_name().and_then(|v| v.to_str()),
        Some("sh" | "bash" | "zsh" | "fish" | "cmd" | "powershell")
    ) {
        return Err("Shell credential commands are not supported".into());
    }
    exec.command = Some(executable.to_string_lossy().into_owned());
    if matches!(
        exec.interactive_mode,
        Some(kube::config::ExecInteractiveMode::Always)
    ) {
        return Err("Interactive credential plugins must be signed in outside Lightship".into());
    }
    let value = serde_json::to_value((context, &cluster_value, &exec))
        .map_err(|_| "Invalid plugin configuration")?;
    let bytes =
        serde_json::to_vec(&canonical(value)).map_err(|_| "Invalid plugin configuration")?;
    Ok(Some(format!("{:x}", Sha256::digest(bytes))))
}
fn canonical(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut entries: Vec<_> = map.into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            serde_json::Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key, canonical(value)))
                    .collect(),
            )
        }
        serde_json::Value::Array(values) => {
            serde_json::Value::Array(values.into_iter().map(canonical).collect())
        }
        other => other,
    }
}
pub fn plugin_description(config: &Kubeconfig, context: &str) -> String {
    let user = config
        .contexts
        .iter()
        .find(|c| c.name == context)
        .and_then(|c| c.context.as_ref())
        .and_then(|c| c.user.as_ref());
    config
        .auth_infos
        .iter()
        .find(|a| Some(&a.name) == user)
        .and_then(|a| a.auth_info.as_ref())
        .and_then(|a| a.exec.as_ref())
        .map(|e| serde_yaml::to_string(e).unwrap_or_default())
        .unwrap_or_default()
}
#[cfg(target_os = "macos")]
pub fn keychain_write(id: &str, text: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(SERVICE, id, text.as_bytes())
        .map_err(|_| "Keychain write failed; nothing was saved in plaintext".into())
}
#[cfg(target_os = "macos")]
pub fn keychain_read(id: &str) -> Result<String, String> {
    let bytes = security_framework::passwords::get_generic_password(SERVICE, id)
        .map_err(|_| "Cannot read kubeconfig from Keychain")?;
    String::from_utf8(bytes).map_err(|_| "Invalid Keychain kubeconfig".into())
}
#[cfg(target_os = "macos")]
pub fn keychain_delete(id: &str) -> Result<(), String> {
    security_framework::passwords::delete_generic_password(SERVICE, id)
        .map_err(|_| "Cannot remove saved kubeconfig from Keychain".into())
}
#[cfg(not(target_os = "macos"))]
pub fn keychain_write(_: &str, _: &str) -> Result<(), String> {
    Err("Pasted credentials require macOS Keychain".into())
}
#[cfg(not(target_os = "macos"))]
pub fn keychain_read(_: &str) -> Result<String, String> {
    Err("Pasted credentials require macOS Keychain".into())
}
#[cfg(not(target_os = "macos"))]
pub fn keychain_delete(_: &str) -> Result<(), String> {
    Err("Pasted credentials require macOS Keychain".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_atomic_roundtrip_and_file_failure_do_not_touch_kubeconfig() {
        let root =
            std::env::temp_dir().join(format!("lightship-settings-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("kubeconfig");
        std::fs::write(&source, "untouched credentials").unwrap();
        let path = root.join("settings.json");
        let connection = Connection {
            id: "one".into(),
            name: "same name".into(),
            context: "one".into(),
            source: Source::Files(vec![source.clone()]),
            trusted_exec: None,
        };
        let mut settings = Settings {
            connections: vec![
                connection.clone(),
                Connection {
                    id: "two".into(),
                    ..connection
                },
            ],
            dark: true,
        };
        save_to(&path, &settings).unwrap();
        let saved: Settings = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved.connections.len(), 2);
        assert_ne!(saved.connections[0].id, saved.connections[1].id);
        settings.connections.clear();
        save_to(&path, &settings).unwrap();
        assert_eq!(
            std::fs::read_to_string(source).unwrap(),
            "untouched credentials"
        );
        assert!(save_to(&path.join("invalid"), &settings).is_err());
        assert!(
            !std::fs::read_to_string(&path)
                .unwrap()
                .contains("untouched credentials")
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
