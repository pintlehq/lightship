# Lightship

A Kubernetes desktop application with YAML apply/editing, workload/Pod restart and Secret/ConfigMap data editing, using the public `pintle_gpui_kit`
facade. Rust **1.99.0**, GPUI Kit **0.8.1**, and the kit's verified Git revision
remain pinned. The installed Electron `/Applications/Lightship.app` is a reference;
this application has a separate identity and settings directory.

## Connect

Choose **Add cluster** to automatically detect contexts from `KUBECONFIG` or
`~/.kube/config`, or use **Choose file…** for another kubeconfig. The **paste YAML**
tab detects contexts after you stop typing; **Load from file…** fills that editor.
Select the contexts to import and review any credential programs shown. Clicking
**Add cluster** (or **Add clusters** for multiple contexts) approves those programs for
the selected contexts. Detection only reads configuration and never runs a
credential program or connects to Kubernetes.

Previously imported contexts are disabled and marked **ADDED**, using the context,
server and user reference rather than display name or source file. Unreadable saved
configurations produce a warning instead of a guessed duplicate result. Header and
footer remain visible while long context lists and plugin reviews scroll. Cancel,
close and Escape discard the import form and restore focus.

**Manage clusters** opens a workspace tab, also available through the command palette,
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
- Namespace, status and text filters, numeric sorting, permanent sidebar tabs,
  independent splits, resizable columns and virtualized tables.
- Click a resource row or **View details** to open a permanent document tab.
  Reopening the same resource in a pane selects its existing tab. The original
  list retains its filters, sorting, checkbox selection and scroll position.
  Arrow keys navigate the list; Enter opens the selected resource.
- Details have Overview cards, metadata, labels, annotations, ports, conditions,
  owner references, recent Events, YAML viewing/editing and full Events. Additional
  resource fields are collapsible. YAML uses a monospace editor with line numbers,
  Tree-sitter syntax highlighting matched to the active light/dark theme,
  indent guides, search and horizontal scrolling, including
  the editable kubeconfig import field. Resource YAML starts read-only; choose
  **Edit YAML** to create a draft. Sensitive values are masked again when hiding
  their document tab.
  The bottom panel holds cluster terminals and activity Output. History stores up to 500 activity records, with filtering, JSON export and clearing.
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
  The status bar also subscribes to the active cluster. Closing the final subscriber stops polling while retaining its bounded in-memory
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
- Checkboxes offer **Copy names**, **Restart** for supported types, and clear selection.
  Restart includes selected rows hidden by filters and reviews every target first.

The HTTP boundary allows GET for registered discovery/resource paths and Pod logs.
Writes require typed backend operations with exact, session-bound permits checking
method, URI/query, content type and payload digest. Disconnecting revokes the previous session's permits.

## Cluster tools

- Choose **Scale** or **Delete** on a row or selection to review the affected objects. The Namespaces page also supports creation and typed-name deletion. Nodes offer **Cordon**, **Uncordon** and **Drain**. Drain uses Kubernetes evictions, respects disruption budgets and reports Pods that prevent eviction.
- From Pod details, choose a container in **Logs** to open an interactive shell. The lower panel supports multiple cluster terminal sessions. These tools require a locally installed `kubectl`. Sessions use the reviewed context and its credential configuration.
- **Port forward** starts a local IPv4 loopback listener. Enter a remote port and optionally a local port. The Port forwards tab shows the assigned port and can stop the process.
- Choose **Logs** for up to 16 Pods to combine their timestamped streams. Find, wrap, pause and container selection apply to the log tab.
- **Read-only** blocks application write requests and opening new shells. Existing external shell sessions retain their own permissions.
- Choose **Settings** for appearance and keyboard shortcuts. The system option follows the macOS theme.

## Apply and edit YAML

Choose **Apply YAML…** in a resource list or the command palette. The permanent
workspace document accepts pasted YAML/JSON or **Open file…**, including multiple
YAML documents and Kubernetes Lists (up to 4 MiB of UTF-8 source). Each document/split
owns its memory-only draft. The cluster is fixed for that document. Namespaces use
manifest metadata first, then the originating list filter, then the connection's
default namespace. Cluster-scoped resources must omit namespace metadata.

Apply validates all documents and resolves exact API versions/kinds through discovery
before reviewing cluster, kind, namespace and name. APIs/CRDs must already be served;
install a CRD separately before applying its custom resources. Server-Side Apply uses
field manager `lightship`, strict field validation and no force takeover. Secret
`stringData` is normalized into Base64 `data` before submission. Resource status and
server-owned metadata are omitted. Existing targets carry the reviewed UID/version.
Documents are applied in order, stopping at the first failure; previous successes
are retained and remaining targets are marked skipped. There is no rollback.

In resource details, **Edit YAML** creates a single-resource draft. Identity is locked;
status and server-owned metadata are excluded. **Apply** performs a full resource
update conditional on the loaded UID/resourceVersion. Use the standalone Apply YAML
flow for declarative Server-Side Apply. Helm release payloads remain read-only.
Secret YAML must be revealed before editing. Data and YAML drafts cannot write
concurrently within a detail view. External changes retain drafts and require Reset
and Refresh before editing again. Reset, Refresh and normal close/remove/quit paths
confirm before discarding drafts; requests in progress must finish before closing.
Hidden YAML draft editors are discarded with their undo history; the draft remains
only in memory and can be explicitly revealed again. No draft is persisted.

Timeout/transport failures trigger GET-only read-back. Unresolved results disable
Apply/Restart and provide **Check result**; no write is retried automatically. RBAC,
conflicts and validation failures retain drafts. Activity Output records targets and
statuses only, never YAML, Secret values or API response bodies.

## Bulk restart

Select Deployments, StatefulSets, DaemonSets or Pods and choose **Restart**. Workloads
receive a JSON Patch changing only the Pod template's `kubectl.kubernetes.io/restartedAt`
annotation, guarded by UID/resourceVersion tests. Paused Deployments, OnDelete workload
strategies and terminating resources are skipped with an explanation.

Pod restart is a graceful DELETE with UID/resourceVersion preconditions, using the
normal grace period. Its controller must create a replacement. Confirmation warns
that unmanaged Pods may never return, Job Pods may rerun work or have no replacement,
and direct deletion bypasses PodDisruptionBudgets. Static/mirror Pods are unsupported.
Requests run sequentially, continuing after target-specific failures and stopping
unsent operations if their connection is revoked. Only successful targets are cleared
from selection. **Restart requested** means the API accepted the request, not that a
replacement or rollout is Ready. Lists and other detail views refresh after mutations.

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
the merge review combines independent edits and offers a per-key choice for conflicting edits. Apply the merged draft after review. Uncertain results are read
back before a manual retry can be offered. Closing documents, removing a
connection and normal window/quit actions confirm before discarding drafts.
Other views receive successful updates without overwriting their own drafts.
Activity Output contains targets/counts/status only, never values or API bodies.
All mutation tests use mock servers exclusively; live smoke tests remain read-only.
Never use production `cpjobs` for mutation development or testing.

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

The bundle is `dist/Lightship.app`, signed ad hoc for local development, not
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
