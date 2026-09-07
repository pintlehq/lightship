# Lightship Contributor Guide

This file applies to the entire repository. Lightship is a focused Kubernetes desktop client built
with Electron, React, and TypeScript. Treat this file as the authoritative source for repository
engineering guidance.

## Working Practices

- Use `pnpm` for dependencies and scripts. Do not add npm or Yarn lockfiles.
- Read the relevant implementation and nearby tests before changing behavior. Prefer established
  repository patterns over generic framework conventions.
- Keep changes focused on the request and preserve unrelated work already present in the working
  tree.
- Do not edit generated or dependency output such as `dist/`, `out/`, `node_modules/`, test
  results, or packaged artifacts.
- Avoid new dependencies when the existing stack or a small local implementation is sufficient.
- Do not run repository-wide formatting for a focused change. Format only files you touched.

## Process Boundaries

- `src/main` is the privileged Electron process. It owns Electron integration, persistence,
  Kubernetes clients, watches, logs, terminals, port forwarding, Helm operations, and resource
  mutations.
- `src/preload` is the narrow, typed context bridge. Expose only the renderer capabilities that are
  required, and preserve teardown handles for subscriptions.
- `src/shared` owns Zod schemas and schema-derived IPC types. These schemas are the source of truth
  for values that cross process boundaries.
- `src/renderer` is the browser-safe React application. It must not directly access Node.js,
  Electron, the filesystem, or Kubernetes clients.
- `e2e` contains Playwright journeys that exercise the renderer through its Vite testing seam,
  without Electron or a real Kubernetes cluster.

Privileged behavior belongs in main-process services and reaches the renderer only through the
typed preload API.

## IPC Changes

Implement an IPC contract change in this order:

1. Add or update the Zod input and output schemas and inferred types in
   `src/shared/ipc-types.ts`.
2. Implement privileged behavior in the appropriate `src/main/services` module.
3. Register the main-process handler in `src/main/ipc.ts` with `parseArgs` and
   `registerInvokeHandler`.
4. Expose the smallest required operation from `src/preload/index.ts` and the `LightshipApi`
   contract.
5. Add the browser-safe facade in `src/renderer/src/lib/ipc.ts`, then connect queries, mutations,
   hooks, and views as needed.
6. Add focused coverage at the contract, service, renderer, and E2E layers affected by the change.

Treat renderer input as untrusted. Validate arguments before they reach a service and validate
returned DTOs before they cross back to the renderer. Streaming operations must subscribe before
starting work, use collision-safe subscription identifiers, and provide deterministic teardown.

## Renderer Conventions

- Use TanStack Query for Kubernetes, cluster, and other backend-owned state. Define keys in the
  central query-key module and explicitly invalidate every affected query after mutations.
- Use Zustand only for local UI state such as tabs, filters, panels, and preferences. Do not copy
  query-owned server data into a store.
- Keep browser fallbacks explicit and read-only. Reads may use established mock data or safe empty
  values when `window.api` is unavailable; mutations must report that they are unavailable.
- Dispose watches, log streams, terminal sessions, port forwards, listeners, timers, and other
  subscriptions with their owning component or hook.
- Reuse primitives from `src/renderer/src/ui/components` and nearby view patterns before creating a
  new abstraction.
- Use semantic design tokens instead of hard-coded theme colors. Preserve light and dark themes,
  keyboard navigation, visible focus, accessible names, and readable contrast.
- Route user-facing failures through the established error helpers and toaster. Do not silently
  swallow rejected IPC calls.

## Kubernetes Safety

- Keep explicit confirmation flows for delete, drain, apply, and other destructive or disruptive
  actions. New destructive operations require confirmation before execution.
- Preserve protected-resource checks and namespace/resource identity through validation,
  confirmation, execution, cache invalidation, and activity recording.
- Validate Kubernetes names, selectors, replica counts, YAML, resource references, and other
  structured input at the boundary closest to the user.
- Record both successful and failed user-initiated mutations in activity history.
- Invalidate or update every affected query after a mutation; do not rely on polling to repair stale
  state.
- Treat intentional cancellation and teardown as normal lifecycle events for logs, watches,
  terminals, and port forwards.
- Unit, renderer, and E2E tests must not read the user's kubeconfig or require a real cluster.
  Cluster-backed tests must be explicitly named and documented as integration tests.

## TypeScript and Style

- Use two-space indentation, single quotes, no semicolons, and the configured 100-column formatting
  preference.
- Keep types precise. Avoid `any`, unchecked casts, duplicated hand-written versions of
  schema-derived types, and non-null assertions without a clear local invariant.
- Prefer small pure helpers for mapping and validation. Keep Electron and Kubernetes side effects at
  service boundaries.
- Comment non-obvious lifecycle, validation, cleanup, or process-boundary behavior. Do not narrate
  self-explanatory code.
- Place focused tests next to implementations as `*.test.ts` or `*.test.tsx`; keep complete user
  journeys in `e2e/*.spec.ts`.

## Verification

Run focused checks while developing and add a regression test for every bug fix. Before completing a
normal code change, run:

```bash
pnpm typecheck
pnpm test
pnpm lint
```

Run additional checks based on the affected surface:

- User-visible renderer workflows: run the relevant Playwright spec while iterating, then
  `pnpm test:e2e` before completion.
- IPC, preload, shared contracts, or build configuration: run `pnpm build`.
- Packaging, native dependencies, icons, entitlements, or builder configuration: run
  `pnpm build:unpack`.

If a required command cannot run, report the exact command and reason instead of claiming it passed.
