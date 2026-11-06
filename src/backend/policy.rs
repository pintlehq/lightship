//! The final request boundary: no mutation or arbitrary GET subresource can pass.
use http::{Method, Request};
use kube::client::Body;
use std::collections::HashSet;
use std::sync::{Arc, RwLock};
#[derive(Clone, Default)]
pub struct Policy {
    collections: Arc<RwLock<HashSet<String>>>,
    revoked: Arc<std::sync::atomic::AtomicBool>,
}
impl Policy {
    pub fn revoke(&self) {
        self.revoked
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
    pub fn active(&self) -> bool {
        !self.revoked.load(std::sync::atomic::Ordering::SeqCst)
    }
    pub fn register(&self, collection: String) {
        self.collections.write().unwrap().insert(collection);
    }
    pub fn allows(&self, method: &Method, uri: &http::Uri) -> bool {
        if !self.active()
            || method != Method::GET
            || uri.scheme().is_some()
            || uri.authority().is_some()
        {
            return false;
        }
        let path = uri.path();
        if path.contains('%') || path.contains("..") || path.contains("//") {
            return false;
        }
        if let Some(query) = uri.query() {
            for pair in query.split('&') {
                let key = pair.split('=').next().unwrap_or_default();
                if !matches!(
                    key,
                    "watch"
                        | "resourceVersion"
                        | "resourceVersionMatch"
                        | "allowWatchBookmarks"
                        | "timeoutSeconds"
                        | "limit"
                        | "continue"
                        | "labelSelector"
                        | "fieldSelector"
                        | "container"
                        | "previous"
                        | "timestamps"
                        | "follow"
                        | "tailLines"
                        | "sinceSeconds"
                        | "pretty"
                ) {
                    return false;
                }
            }
        }
        let parts: Vec<_> = path.trim_start_matches('/').split('/').collect();
        if matches!(path, "/version" | "/api" | "/apis" | "/api/v1")
            || (parts.len() == 3 && parts[0] == "apis")
        {
            return true;
        }
        let base = if parts.first() == Some(&"api") {
            2
        } else if parts.first() == Some(&"apis") {
            3
        } else {
            return false;
        };
        if parts.len() <= base {
            return false;
        }
        let mut normalized = parts[..base].to_vec();
        let tail = if parts[base] == "namespaces" && parts.len() >= base + 3 {
            &parts[base + 2..]
        } else {
            &parts[base..]
        };
        normalized.push(tail[0]);
        let collection = format!("/{}", normalized.join("/"));
        self.collections.read().unwrap().contains(&collection)
            && (tail.len() <= 2
                || (tail.len() == 3 && collection == "/api/v1/pods" && tail[2] == "log"))
    }
    pub fn check(&self, request: Request<Body>) -> Result<Request<Body>, tower::BoxError> {
        if self.allows(request.method(), request.uri()) {
            Ok(request)
        } else {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "Blocked by Lightship read-only policy",
            )
            .into())
        }
    }
}
