# Lightship Engineering Handbook

This file applies to the entire repository. Lightship is a focused Kubernetes desktop client built
with Electron, React, and TypeScript. The project uses `pnpm`.

## Working Rules

- Prefix every shell command with `rtk`, including Git and `pnpm` commands.
- Read the relevant implementation and nearby tests before editing. Follow existing repository
  patterns when they are more specific than general framework guidance.
- Keep changes scoped to the request. Do not modify generated output in `dist/`, `out/`, test
  results, dependency directories, or unrelated user changes.
- Use `pnpm`; do not introduce npm or Yarn lockfiles.
- Do not add dependencies when the existing stack or a small local implementation is sufficient.

## Architecture and Process Boundaries

- `src/main` is the privileged Electron process. It owns Electron integration, local persistence,
  Kubernetes clients, logs, watches, terminals, port forwarding, Helm operations, and resource
  mutations.
- `src/preload` is the narrow, typed context bridge. Expose only the minimum renderer-facing API
  and preserve subscription teardown handles.
- `src/shared` contains Zod schemas and the shared IPC types inferred from those schemas. Treat the
  schemas as the source of truth for data crossing process boundaries.
- `src/renderer` is the React application. It must remain browser-safe for tests and mock-backed
  development, with no direct access to Node.js, Electron, the filesystem, or Kubernetes clients.
- `e2e` contains Playwright tests that run the renderer through the Vite E2E seam without Electron
  or a real Kubernetes cluster.

Do not bypass these boundaries for convenience. Privileged behavior belongs in main-process
services and reaches the renderer only through the typed preload API.

## IPC Contract Changes

Implement IPC additions or changes in this order:

1. Add or update the Zod input/output schemas and inferred types in `src/shared/ipc-types.ts`.
2. Implement the privileged behavior in an appropriate `src/main/services` module.
3. Register a main-process handler in `src/main/ipc.ts` using `parseArgs` and
   `registerInvokeHandler`.
4. Expose the operation through the typed bridge in `src/preload/index.ts` and the corresponding
   `LightshipApi` contract.
5. Add the browser-safe renderer facade in `src/renderer/src/lib/ipc.ts`, then connect it through
   fetchers, queries, mutations, and views as appropriate.
6. Add focused contract, service, renderer, and E2E coverage for the behavior changed.

All renderer-supplied data is untrusted. Validate every argument before it reaches a service and
validate every returned DTO before it crosses back to the renderer. Streaming APIs must subscribe
before starting work, use collision-safe subscription IDs, and expose deterministic teardown.

## Renderer Conventions

- Use TanStack Query for Kubernetes, cluster, and other backend-owned state. Define query keys in
  the central query-key module and explicitly invalidate every affected cache after mutations.
- Use Zustand only for local UI state such as tabs, filters, panels, and preferences. Do not mirror
  query-owned server data into a store.
- Keep browser fallbacks explicit and read-only. When `window.api` is unavailable, reads may use the
  established mock data or safe empty values; mutations must not pretend to succeed.
- Clean up watches, log streams, terminal sessions, port forwards, event listeners, timers, and
  other subscriptions when their owning component or hook is disposed.
- Reuse primitives from `src/renderer/src/ui/components` and existing view patterns before adding a
  new abstraction.
- Use semantic design tokens from the renderer styles instead of hard-coded theme colors. Preserve
  light and dark themes, keyboard access, visible focus states, and accessible labels.
- Route user-facing failures through the established error helpers and toaster. Avoid silently
  swallowing rejected IPC calls.

## Kubernetes Safety

- Preserve confirmation steps for delete, drain, apply, and other destructive or disruptive
  operations. New destructive actions require an explicit confirmation path.
- Preserve protected-resource checks and namespace/resource identity throughout validation,
  confirmation, execution, cache invalidation, and activity recording.
- Validate Kubernetes names, selectors, replica counts, YAML, resource references, and other
  structured input at the boundary closest to untrusted input.
- Record both success and failure outcomes for user-initiated mutations in activity history.
- Invalidate or update all affected queries after a mutation; do not rely on polling to repair stale
  UI state.
- Treat cancellation and teardown as normal lifecycle events for logs, watches, terminals, and port
  forwards. Do not report deliberate aborts as unexpected failures.
- Tests must not access the user's kubeconfig or require a real Kubernetes cluster unless they are
  explicitly named and documented as integration tests.

## Code Style

- Use two-space indentation, single quotes, no semicolons, and a 100-column print-width preference,
  as configured by EditorConfig and Prettier.
- Keep TypeScript types precise. Avoid `any`, unchecked casts, duplicated hand-written versions of
  schema-derived types, and non-null assertions unless the invariant is local and evident.
- Prefer small pure helpers for mapping and validation, and keep Electron/Kubernetes side effects at
  service boundaries.
- Add comments for non-obvious lifecycle, process-boundary, validation, or cleanup behavior. Do not
  narrate code that is already self-explanatory.
- Keep tests next to the implementation as `*.test.ts` or `*.test.tsx`; keep full user journeys in
  `e2e/*.spec.ts`.

## Verification

Run focused Vitest coverage while developing and add a regression test for every bug fix. Before
completing a normal code change, run:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm lint
```

Also run the checks required by the change:

- User-visible renderer workflow: `rtk pnpm test:e2e`, or the narrow relevant Playwright spec while
  iterating followed by the full suite before completion.
- IPC, preload, build configuration, or cross-process change: `rtk pnpm build`.
- Electron packaging, native dependency, icon, entitlement, or builder configuration change:
  `rtk pnpm build:unpack`.

Do not use `pnpm format` as a blanket cleanup for a focused task because it rewrites the repository.
Format only touched files when needed. If a required check cannot run, report the exact command and
reason instead of claiming verification.
