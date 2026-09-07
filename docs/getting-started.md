# Getting started

Lightship currently runs and packages from source. There is no production download or update
channel yet.

## Prerequisites

- macOS, Windows, or Linux
- Node.js `^20.19.0` or `>=22.12.0`, as required by the current Vite toolchain
- [pnpm](https://pnpm.io/)
- A reachable Kubernetes cluster and a kubeconfig containing a usable context
- An available OS credential store for Electron `safeStorage`
- `kubectl` on `PATH` if you want to open an exec terminal inside a pod

Lightship uses the Kubernetes JavaScript client for cluster reads, mutations, logs, watches, and
port forwarding. It does not require `kubectl` for those features. The Helm CLI is not required;
Lightship reads Helm 3 release secrets through the Kubernetes API.

## Install and run

```bash
git clone https://github.com/pintlehq/lightship.git
cd lightship
pnpm install
pnpm dev
```

The development command starts the Electron main process, preload bridge, and renderer through
electron-vite. Closing the development window stops the app; restart `pnpm dev` when needed.

## Add a cluster

1. Select **Add cluster** in the sidebar.
2. Use **kubeconfig** to load contexts from the default kubeconfig resolution, normally
   `~/.kube/config`. Alternatively, use **paste YAML** or **Load from file…**.
3. Select one or more contexts and add them.
4. Open **Manage clusters** and use the connection test to confirm access.

Lightship exports a minimal kubeconfig for each selected context and saves it as a separate
encrypted credential. Removing a cluster removes Lightship's saved copy; it does not change the
original kubeconfig or delete anything from the cluster.

The selected Kubernetes identity controls what Lightship can read or change. If a view is empty or
an operation is rejected, check that identity's RBAC permissions and cluster connectivity.

## Build locally

Create a production build of the Electron main process, preload, and renderer:

```bash
pnpm build
```

Create an unpacked application directory for the current platform:

```bash
pnpm build:unpack
```

Create platform installers or packages:

```bash
pnpm build:mac
pnpm build:win
pnpm build:linux
```

The configured targets are a macOS DMG, Windows NSIS installer, and Linux AppImage, Snap, and DEB.
Build platform-specific artifacts on the matching operating system unless your environment has an
explicitly configured cross-compilation toolchain. Generated output is written under `dist/` and
must not be committed.

The current generic updater URL in `electron-builder.yml` is a placeholder, and macOS notarization
is disabled. Local packages should therefore be treated as development builds rather than an
official distribution.

## Next steps

- Read the [user guide](user-guide.md) for cluster workflows.
- Read the [security guide](security.md) before using write access against important clusters.
- Read the [development guide](development.md) before changing the codebase.
