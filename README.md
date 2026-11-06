# Lightship

A read-only Kubernetes desktop application, using the public `pintle_gpui_kit`
facade. Rust **1.99.0**, GPUI Kit **0.8.1**, and the kit's verified Git revision
remain pinned. The installed Electron `/Applications/Lightship.app` is a reference;
this application has a separate identity and settings directory.

## Connect

Choose **Add cluster**, browse or enter a kubeconfig path, or paste kubeconfig YAML.
Leaving the path blank reads `KUBECONFIG`, otherwise `~/.kube/config`. Select the
contexts to import. The application never changes the original kubeconfig or its
current context. Display names can be changed independently of stable connection IDs.
**Remove from app** removes only local connection metadata and its imported Keychain
entry, never a Kubernetes cluster or resource.

Connection metadata and appearance are stored in
`~/Library/Application Support/Lightship GPUI/settings.json`. File imports retain
references to the original files. Pasted kubeconfig is stored in **macOS Keychain**,
with no plaintext fallback. Resource objects, logs, and revealed values are memory-only.

Client certificates and tokens are supported. Exec credential programs require
explicit trust of the resolved program, arguments, environment, context and cluster
configuration before they run. Changed configurations require renewed trust.
Programs must already be installed and logged in; Lightship does not install them,
run a shell, or perform interactive CLI login. HTTPS certificate validation is
required; insecure TLS and endpoint URL path prefixes are not supported.

## Browse

- Core resources, workloads, networking, configuration, storage, RBAC and Events.
- API discovery adds available resource types beneath Custom Resources.
- Namespace and text filters, numeric sorting, retained preview/permanent tabs,
  independent splits, resizable columns and virtualized tables.
- Details, conditions, ownership/relationship metadata, Events and read-only YAML.
- Pod logs: container selection, previous logs, timestamps, follow, start/stop;
  the in-memory tail is limited to 512 KiB.
- Overview counts and health summaries, plus CPU/memory totals when Metrics API is
  available. Missing APIs and permission errors remain explicit.
- Helm release revisions, charts, values and manifests from Secrets/ConfigMaps.
  SQL Helm storage is not supported. Inaccessible storage is reported, not mistaken
  for an empty release list.
- Secrets and potentially sensitive Helm payloads are hidden until **Reveal**.
  Closing/changing the inspected resource resets reveal state. No payload is logged.
- Checkboxes offer **Copy names** and clear selection only. There is no create,
  edit, delete, scale, restart, exec, attach, terminal, proxy or port-forward command.

The HTTP boundary rejects non-GET methods, unregistered resource paths and unsafe
subresources, independently of UI controls. Discovery, list/watch, resource details,
Pod logs and metrics use that same boundary. Pages list all pages of results, then
watch with reconnect/backoff; denied watches fall back to polling every 30 seconds.
Overview and Helm refresh every 30 seconds. Closing pages cancels their jobs;
removing/reconnecting a cluster revokes the old session. Errors preserve existing
rows with a stale indicator rather than presenting a false empty result.

## Build and validate

```sh
cargo fmt --all -- --check
cargo check --locked
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
RUSTDOCFLAGS='-D warnings' cargo doc --no-deps --locked
cargo build --locked
./scripts/bundle-macos.sh
```

The bundle is `dist/Lightship GPUI.app`, signed ad hoc for local development, not
notarized. It never overwrites the reference application. To package a development
build, set `LIGHTSHIP_BUILD_PROFILE=dev`. The deliverable currently targets macOS;
other platforms have not been validated for cluster onboarding or secure storage.

Tests use deterministic fixtures and a loopback mock API, never a user's kubeconfig
by default. Real-cluster smoke tests are explicitly opt-in:

```sh
LIGHTSHIP_TEST_CONTEXT='<approved-context>' cargo test --locked live_readonly_smoke -- --ignored --nocapture
```

That test performs guarded reads only and reports counts instead of resource
contents or credentials. Do not run it against an unapproved context.

The UI checks cover selection, filtering, sorting, splits, preview/permanent tabs,
keyboard Escape/modal isolation, and the floating overlay geometry in light/dark at
1440 × 900 and 1024 × 680. There is no Demo mode in the shipped application.

## Coordinated kit development

The normal build uses the committed Git pin and lockfile. For local kit work only,
create the ignored `.cargo/config.toml`:

```toml
[patch."https://github.com/pintlehq/pintle-gpui-kit"]
pintle-gpui-kit = { path = "../pintle-gpui-kit/crates/pintle-gpui-kit" }
```

Remove the override and verify a locked build from the published Git revision before
shipping. Kubernetes clients, credentials, catalog, projections and command wiring
belong in Lightship; the kit owns shared presentation and workbench behavior.
