# Lightship

A Kubernetes desktop application with limited Secret/ConfigMap data editing, using the public `pintle_gpui_kit`
facade. Rust **1.99.0**, GPUI Kit **0.8.1**, and the kit's verified Git revision
remain pinned. The installed Electron `/Applications/Lightship.app` is a reference;
this application has a separate identity and settings directory.

## Connect

Choose **Add cluster** to automatically detect contexts from `KUBECONFIG` or
`~/.kube/config`, or use **Choose file…** for another kubeconfig. The **paste YAML**
tab detects contexts after you stop typing; **Load from file…** fills that editor.
Select the contexts to import, review any credential programs, then choose
**Add clusters**. Detection only reads configuration and never runs a credential
program or connects to Kubernetes.

Previously imported contexts are disabled and marked **ADDED**, using the context,
server and user reference rather than display name or source file. Unreadable saved
configurations produce a warning instead of a guessed duplicate result. Header and
footer remain visible while long context lists and plugin reviews scroll. Cancel,
close and Escape discard the import form and restore focus.

**Manage clusters** is a separate dialog, also available through the command palette,
for reconnecting, renaming and removing saved connections. The application never
changes the original kubeconfig or its current context. Display names can be changed
independently of stable connection IDs. **Remove from app** removes only local
connection metadata and its imported Keychain entry, never a Kubernetes cluster or
resource.

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
- Click a resource row or **View details** to open a permanent document tab.
  Reopening the same resource in a pane selects its existing tab. The original
  list retains its filters, sorting, checkbox selection and scroll position.
  Arrow keys navigate the list; Enter opens the selected resource.
- Details have Overview cards, metadata, labels, annotations, ports, conditions,
  owner references, recent Events, read-only YAML and full Events. Additional
  resource fields are collapsible. YAML uses a monospace editor with line numbers,
  Tree-sitter syntax highlighting matched to the active light/dark theme,
  indent guides, search and horizontal scrolling, including
  the editable kubeconfig import field. Resource YAML remains read-only and
  sensitive values are masked again when hiding their document tab.
  The bottom panel contains activity Output.
- Each detail view retains its own subtab, scroll and log options across docking
  and splits. Refresh preserves older data with an explicit stale/error status
  on failure. UID checks detect resources replaced under the same name.
- Pod logs support container selection, previous logs, timestamps, follow and
  Start/Stop. Deployments, StatefulSets, DaemonSets and Jobs can select related
  Pods, checked by controller UID in the same namespace; Deployments resolve
  their ReplicaSets first. Streams stop when changing targets/options, leaving
  Logs, hiding/closing the document or removing its connection. Returning does
  not automatically resume a stream. The in-memory tail is limited to 512 KiB.
- Cluster Overview dashboard with Nodes, active Pods/capacity, CPU, Memory, CPU
  Requests and Memory Requests cards; CPU/Memory area charts and the 10 most recent
  Events. Cards navigate to Nodes, Pods and Namespaces; Events open detail tabs.
- Usage percentages use Node Metrics and Node allocatable capacity. Request totals
  include scheduled nonterminal Pods and Kubernetes 1.34 effective-request rules
  for init/sidecar containers, Pod-level resources, overhead and in-place resize.
- Overview keeps real observations for the last 30 minutes, sampled every 30 seconds,
  with at most 61 buckets. One sampler serves all Overview tabs/splits per connection.
  Closing the last Overview stops polling while retaining its bounded in-memory
  history; reconnect/removal clears it. Manual refresh preserves history. There is
  no historical backfill, disk cache or generated data; unsampled/failed intervals
  remain gaps. Stale (>90 seconds), incomplete or inaccessible metrics remain
  explicit instead of being displayed as zero. Each endpoint has its own timeout,
  so one failed source does not suppress successful parts of the dashboard.
- Helm release revisions, charts, values and manifests from Secrets/ConfigMaps.
  SQL Helm storage is not supported. Inaccessible storage is reported, not mistaken
  for an empty release list.
- Secrets and potentially sensitive Helm payloads are hidden until **Reveal**.
  Hiding/closing its document resets reveal state. No payload is logged.
- Checkboxes offer **Copy names** and clear selection only. There is no create,
  bulk edit, delete, scale, restart, exec, attach, terminal, proxy or port-forward command.

The HTTP boundary allows GET for registered discovery/resource paths and Pod logs.
All other writes remain blocked except exact, typed JSON Patch requests produced
by the Data editor for a namespaced Secret or ConfigMap. The boundary verifies the
sealed request's method, target, content type and payload digest. UID and
resourceVersion tests make the patch conditional; type, metadata and immutable
flags are never edited. There is no terminal, exec, attach, proxy or port-forward.

## Edit Secret and ConfigMap data

Open a resource's **Data** tab to select a key, edit its name/value, add fields or
upload a file into the selected key. Secret values start hidden; Reveal is local
to the current key, and switching keys/tabs hides the value and clears editor undo
history. Binary fields use Base64 without lossy decoding. YAML/JSON values use
syntax highlighting; other values use plain text. Existing keys have no Delete
operation. Immutable resources remain read-only.

Drafts are memory-only and independent per document/split. Reset discards local
edits after confirmation. Apply reviews changed key names (never Secret values),
then writes only resource data. RBAC and version conflicts preserve the draft;
there is no force overwrite or automatic write retry. Uncertain results are read
back before a manual retry can be offered. Closing documents, removing a
connection and normal window/quit actions confirm before discarding drafts.
Other views receive successful updates without overwriting their own drafts.
Activity Output contains targets/counts/status only, never values or API bodies.
Data-write tests use mock servers exclusively; live smoke tests remain read-only.

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
1440 × 900 and 1024 × 680. Onboarding checks also cover automatic detection,
YAML debounce, duplicate identities, plugin consent, cancellation and fixed dialog
footer geometry. Detail checks cover permanent tabs, duplicate activation, pane
isolation, cluster rename/removal, UID replacement, scoped workload ownership,
Events pagination/RBAC, sensitive-value masking, log lifecycle and stale refresh.
Overview tests also cover effective requests, quantity units, coverage/freshness,
partial failures, pagination, bounded history and a shared sampler with a controlled
clock, responsive light/dark charts, navigation and independent pane scroll.
There is no Demo mode in the shipped application.

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
