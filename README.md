# Lightship

A native Kubernetes GUI shell built with [Pintle GPUI Kit](https://github.com/pintlehq/pintle-gpui-kit).
Development, Staging and Production are offline **Demo** clusters. Each has a
complete Kubernetes navigation catalog and deterministic in-memory fixtures;
Deployments has 29 rows per cluster. Overview totals come from those same fixtures.
The app never reads kubeconfig, connects to clusters, runs shells or persists data.

Resource lists support case-insensitive search, namespace filtering, typed sorting,
checkbox selection, column resizing, row details and copying resource names.
Refresh reloads the same fixtures, retains filters/selection and records an Output
entry. Selecting one or more rows shows a floating bulk action bar. Selection
includes filtered-out rows, whose count is shown explicitly. Delete is offered
for all resource pages except Overview; Deployments and StatefulSets also offer
Scale and Rolling restart, and DaemonSets offer Rolling restart. Narrow panes
collapse additional actions into More. The bar overlays the rows without resizing
the table or changing scroll offsets; only its own surface blocks row clicks.
The dialogs snapshot selected targets;
Scale accepts integer replicas from 0 through 2,147,483,647. Confirmation only
records a Demo simulation in Output: no fixtures change. Cancel keeps selection,
and × or Escape in the table/action bar clears it. Checkbox clicks never inspect
a row. New from YAML explains the demo boundary; it does not create resources.

Each document retains its filter, sort, selection and scrolling. Splits create an
independent view of the same fixture source. The initial page is Development /
Deployments, with Details/Output collapsed until requested.

```sh
cargo run --locked
cargo test --locked
cargo clippy --all-targets --locked -- -D warnings
```

Rust 1.99.0 and GPUI Kit 0.8.1 are pinned. macOS requires Xcode and its command
line tools. UI chrome, palette, fonts, docking and resizable regions come from
the shared kit. Kubernetes navigation and page content belong to this app.

Use Cmd/Ctrl+K for resource/command search, Cmd/Ctrl+B for Explorer and
Cmd/Ctrl+J for Details/Output. Single-click a resource for preview, double-click
to keep it open. Document menus offer splits; drag tabs to rearrange them.
The activity bar switches light/dark appearance. Closing a region restores
focus to the active document and reopening retains layout state.

## Local kit development

The delivered manifest pins a Git commit of the kit. To work on sibling checkouts,
create an untracked `.cargo/config.toml` in Lightship:

```toml
[patch."https://github.com/pintlehq/pintle-gpui-kit"]
pintle-gpui-kit = { path = "../pintle-gpui-kit/crates/pintle-gpui-kit" }
```

Cargo resolves this path relative to the project root (the parent of `.cargo`).
Run `cargo check` to refresh the local lockfile, and restore the
committed Git-pinned lockfile before submitting application-only changes.

## Validation

On macOS, the published kit pin passes all 14 Lightship tests, strict all-target
Clippy and an independent locked build. Coverage includes all 78 resource pages,
fixture identity and totals, namespace/search filtering, numeric sorting,
checkbox selection, refresh, demo dialog, details, palette, preview/permanent
and split tabs, retained scrolling, panel focus and resize state. Bulk coverage
includes capability rules, hidden selections, snapshot targets, validation,
keyboard activation, focus restoration, fixture integrity, narrow panes, unchanged
viewport/scroll geometry and overlay pointer hit testing. Rendered checks
cover light/dark at 1440 × 900 and 1024 × 680; native smoke checks cover both
appearances, compact resizing, namespace menus and row inspection.
