# Security

Lightship is a local Kubernetes client. Its effective access is the access granted to the identity
in each imported kubeconfig; Lightship does not add a separate authorization layer around the
Kubernetes API.

## Credential storage

When a context is imported, Lightship exports a minimal kubeconfig containing that context and its
referenced cluster and user. It stores the imported clusters in Electron's platform-specific
`userData/lightship-data/configs/clusters.json` file.

- Each record contains display metadata plus a Base64-encoded `safeStorage` ciphertext. Base64 is
  only the JSON encoding; the kubeconfig itself is encrypted before persistence.
- Renderer and IPC cluster records contain display metadata only and never include ciphertext or
  plaintext kubeconfig data.
- Lightship refuses to persist a cluster if the operating system's secure storage is unavailable.
- Removing a saved cluster removes the complete persisted record and leaves the original kubeconfig
  unchanged.

The security of `safeStorage` depends on the platform credential service and the user's operating
system account. Protect and lock that account as you would for any application holding cluster
credentials.

## Terminal credentials

Terminals need a filesystem path because `kubectl` and local shell tools consume `KUBECONFIG`.
Lightship decrypts the selected kubeconfig into Electron's temporary directory, creates it with
owner-only permissions, and points the terminal environment at that path. The file is removed when
the terminal exits, is closed, or fails to start.

A crash or forced process termination can prevent best-effort cleanup. Treat access to the local
temporary directory and operating system account as security-sensitive.

## Kubernetes permissions

All reads and writes use the credentials in the selected kubeconfig. Kubernetes RBAC, admission
controllers, API validation, and network policy remain authoritative. Grant the imported identity
only the verbs, resources, and namespaces its operator needs.

Lightship can perform high-impact operations when the identity permits them, including resource
deletion, manifest replacement, workload scaling or restart, namespace deletion, node cordon or
drain, and pod exec. Review cluster and namespace context before confirming a mutation.

## Safety controls

- Destructive and disruptive operations have explicit confirmation dialogs.
- Namespace deletion requires typing the namespace name.
- `default` and every namespace beginning with `kube-` are protected from deletion in both the UI
  and main-process service.
- Renderer arguments are parsed with shared Zod schemas before services use them.
- Returned IPC data is validated before reaching the renderer.
- User-initiated mutations record success or error outcomes in local activity history.

These controls reduce accidental changes; they are not a replacement for least-privilege RBAC,
admission policy, backups, or normal production change controls.

## Port forwarding and network access

Local port forwards bind to `127.0.0.1`, not all network interfaces. A Service or workload is
resolved to a backing pod, and traffic is proxied through the Kubernetes API. Anyone able to access
the local user session may still connect to the chosen local port while the forward is active.

Application links are handed to the operating system's external browser instead of being opened as
new Electron windows.

## Local non-secret data

The following data is stored without `safeStorage`:

- Cluster display metadata in `lightship-data/configs/clusters.json` (the credential field is
  encrypted)
- Up to 500 remembered resource-detail tab selections in
  `lightship-data/configs/preferences.json`
- Up to 500 mutation records in `lightship-data/history/activity.json`, including cluster,
  resource, action, outcome, and timestamp
- Theme and namespace-filter preferences in renderer `localStorage`

Activity history can expose operational names and failure messages. Exported activity JSON is also
plaintext; handle it according to your organization's data policy.

Tabs, terminal sessions, and active port forwards are in-memory and are not restored after restart.
The controls displayed in the current **General** settings section are placeholders; in particular,
they do not enable telemetry or change persistence, confirmation, or polling behavior.

## Distribution status

The repository's updater URL is a placeholder, and macOS notarization is disabled. There is no
production download channel documented by the project. Review and build the source in an
appropriate trusted environment rather than treating local packages as signed official releases.
