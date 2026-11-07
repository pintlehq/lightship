//! Final request boundary. Only typed Secret/ConfigMap data patches may write.
use futures::FutureExt;
use http::{Method, Request};
use kube::client::Body;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::{Arc, RwLock};
#[derive(Clone)]
struct DataPermit {
    path: String,
    digest: [u8; 32],
}
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
    pub(super) fn data_patch(
        &self,
        edit: &super::data::DataEdit,
    ) -> Result<Request<Vec<u8>>, String> {
        use super::data::DataKind;
        edit.values.validate(edit.target.kind)?;
        // Revalidate identity even for targets built directly inside the backend.
        let identity = serde_json::json!({"metadata":{"namespace":edit.target.namespace,"name":edit.target.name,"uid":edit.target.uid,"resourceVersion":edit.target.version}});
        super::data::DataTarget::from_object(edit.target.kind.key(), &identity)?;
        let mut operations = vec![
            serde_json::json!({"op":"test","path":"/metadata/uid","value":edit.target.uid}),
            serde_json::json!({"op":"test","path":"/metadata/resourceVersion","value":edit.target.version}),
            serde_json::json!({"op":"add","path":"/data","value":edit.values.map(edit.target.kind,false)}),
        ];
        if edit.target.kind == DataKind::ConfigMap {
            operations.push(serde_json::json!({"op":"add","path":"/binaryData","value":edit.values.map(edit.target.kind,true)}));
        }
        let path = edit.target.path();
        let mut request = Request::patch(&path)
            .header("Content-Type", "application/json-patch+json")
            .body(serde_json::to_vec(&operations).map_err(|_| "Could not encode data patch")?)
            .map_err(|_| "Invalid data patch target")?;
        let digest = Sha256::digest(request.body()).into();
        request.extensions_mut().insert(DataPermit { path, digest });
        Ok(request)
    }
    pub fn check(&self, request: Request<Body>) -> Result<Request<Body>, tower::BoxError> {
        let data_write = self.active()
            && request.method() == Method::PATCH
            && request.uri().scheme().is_none()
            && request.uri().authority().is_none()
            && request.uri().query().is_none()
            && request
                .headers()
                .get("Content-Type")
                .is_some_and(|v| v == "application/json-patch+json")
            && request.extensions().get::<DataPermit>().is_some_and(|p| {
                p.path == request.uri().path()
                    && request
                        .body()
                        .try_clone()
                        .and_then(|body| body.collect_bytes().now_or_never())
                        .is_some_and(|result| {
                            result.is_ok_and(|bytes| {
                                <[u8; 32]>::from(Sha256::digest(bytes)) == p.digest
                            })
                        })
            });
        if self.allows(request.method(), request.uri()) || data_write {
            Ok(request)
        } else {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "Blocked by Lightship resource policy",
            )
            .into())
        }
    }
}
