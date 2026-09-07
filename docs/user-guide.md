# User guide

Lightship organizes Kubernetes work around saved clusters, a resource sidebar, and independently
closable tabs. The active tab determines the cluster shown in the status bar and used by
cluster-scoped actions.

## Clusters and navigation

Use **Add cluster** to import one or more contexts from the default kubeconfig or pasted YAML.
**Manage clusters** can test, rename, reorder, or remove saved connections. Renaming changes only
the Lightship display name; removing a connection does not edit the source kubeconfig or cluster.

Select a cluster to expand its resources. Views open in tabs, so you can compare resources or
clusters without losing your place. `Cmd/Ctrl+W` closes the focused terminal session first, then
the active content tab, and finally the window when no tabs remain. `Cmd/Ctrl+K` opens the command
palette.

Namespaced lists have a namespace filter. Each open tab keeps its own filter selection, while new
tabs begin with the last applied selection.

## Resource coverage

| Area           | Resources and views                                                         |
| -------------- | --------------------------------------------------------------------------- |
| Cluster        | Overview, nodes, namespaces, and events                                     |
| Workloads      | Pods, Deployments, StatefulSets, DaemonSets, Jobs, and CronJobs             |
| Networking     | Services, Ingresses, and Endpoints                                          |
| Configuration  | ConfigMaps and Secrets                                                      |
| Storage        | PersistentVolumes and PersistentVolumeClaims                                |
| Access control | Roles, RoleBindings, ClusterRoles, ClusterRoleBindings, and ServiceAccounts |
| Extensions     | CustomResourceDefinitions and their live custom-resource instances          |
| Packages       | Helm 3 releases and revision history                                        |

Metrics in overview and node views depend on the cluster metrics API. Other data remains available
when metrics cannot be read, subject to the selected identity's RBAC permissions.

## Inspect and edit resources

Open a row to inspect its properties, YAML, and related events. Pod and workload details may also
offer logs, and supported objects expose port forwarding or configuration editors.

- **Create resource** accepts a Kubernetes YAML manifest.
- **Apply YAML** replaces the live object with the edited manifest after confirmation.
- **ConfigMaps and Secrets** have a key/value editor. Binary secret keys are shown but are not
  treated as editable text entries.
- **Deployments and StatefulSets** support scaling and rolling restarts.
- **DaemonSets** support rolling restarts.
- Workload and resource lists support confirmed deletion; supported bulk actions process selected
  rows and report partial failures.

Every write still depends on Kubernetes admission, validation, and RBAC. A confirmation in
Lightship does not bypass cluster policy.

## Pods and logs

Pod actions include opening details, streaming logs, executing a shell in a selected container,
and deleting the pod. Multi-container pods expose container choices for logs and exec.

The logs view can combine output from multiple pods, pause the stream, wrap long lines, and search
with `Cmd/Ctrl+F`. Closing the view tears down its active streams.

Pod exec launches the local `kubectl exec` command inside a pseudo-terminal. `kubectl` must be on
`PATH`; Lightship supplies a temporary kubeconfig for the selected cluster and removes it when the
terminal ends. A cluster terminal without a pod target opens the user's local shell with the same
temporary `KUBECONFIG` environment.

## Port forwarding

Pods, Services, Deployments, StatefulSets, DaemonSets, and Jobs can be port-forward targets. Choose
a remote port and optionally a local port; leaving the local port blank asks the operating system
to select one. Service and workload targets resolve to a backing pod.

Forwards listen only on `127.0.0.1`. Use the **Port forwards** view to inspect and stop active
sessions. Sessions are in-memory and end when stopped or when the application exits.

## Nodes and namespaces

Node views show readiness, conditions, capacity, allocatable resources, and requested or limited
pod resources. Available actions are:

- **Cordon** to prevent new scheduling.
- **Uncordon** to make the node schedulable again.
- **Drain** to cordon and best-effort evict eligible pods. DaemonSet pods, mirror/static pods, and
  completed pods are skipped; an individual eviction failure does not stop the remaining attempts.

Namespace views summarize pod state and, where accessible, quotas, limit ranges, and network
policies. You can create namespaces from a form or YAML. Deleting a namespace requires typing its
name, and `default` plus names beginning with `kube-` are protected in both the UI and backend.

## Custom resources and Helm

The **Custom Resources** tree groups discovered CRDs and opens live instances using the CRD's
storage version and server-provided printer columns. Instance detail provides properties, YAML,
and events. Availability depends on discovery and RBAC access to the CRD and its resources.

The **Helm** view reads Helm 3 release records from Kubernetes Secrets, shows the latest release
state, and opens revision history. It does not run the Helm CLI or provide install, upgrade,
rollback, or uninstall actions.

## Activity and preferences

Lightship records user-initiated mutations in a local activity history, including success or error
outcomes. The history keeps the 500 most recent records, can be filtered by cluster, exported as
JSON, or cleared.

Appearance settings support system, light, and dark themes. The controls currently displayed under
the **General** settings section are placeholders and do not change runtime behavior. Do not rely on
them to restore tabs, alter confirmations, control polling, or configure telemetry.

## Troubleshooting

### No kubeconfig contexts appear

Confirm that your default kubeconfig is valid and readable. If it lives outside the default lookup
path, load the file through **paste YAML** instead.

### A cluster cannot be saved

Lightship refuses to store credentials when Electron cannot access the operating system's secure
storage. Ensure the platform keychain or credential service is available and unlocked.

### A view is empty or reports forbidden

Test the cluster connection, then check the selected kubeconfig identity's RBAC permissions for the
resource and namespace. Optional namespace detail sections may be unavailable independently.

### Pod exec exits immediately

Confirm that `kubectl` is installed and on `PATH`, the pod is running, the selected container
exists, and the image provides `sh`.

### Metrics are missing

The cluster must expose the Kubernetes metrics API and grant the selected identity permission to
read it. Resource lists and non-metric details can still work without metrics.

### A port forward fails

Check that the remote port is valid, the target has a backing pod, the pod is reachable through the
Kubernetes API, and the requested local port is unused. Leave the local port blank to avoid a local
port collision.
