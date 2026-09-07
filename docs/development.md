# Development

Read the repository [engineering handbook](../AGENTS.md) before making changes. It is the
authoritative source for architecture, safety, code style, and verification rules.

## Local setup

```bash
pnpm install
pnpm dev
```

The project uses pnpm workspaces, electron-vite, React, TypeScript, Tailwind CSS, Vitest, and
Playwright. Use Node.js `^20.19.0` or `>=22.12.0` for the current build toolchain.

## Repository layout

| Path                    | Responsibility                                                                  |
| ----------------------- | ------------------------------------------------------------------------------- |
| `src/main`              | Privileged Electron process, IPC handlers, Kubernetes services, and persistence |
| `src/preload`           | Narrow typed context bridge exposed as `window.api`                             |
| `src/shared`            | Zod IPC schemas, schema-derived types, and cross-process capabilities           |
| `src/renderer`          | Browser-safe React application, queries, local UI stores, and views             |
| `e2e`                   | Playwright journeys against the renderer's mock-backed Vite seam                |
| `build` and `resources` | Packaging metadata and application assets                                       |

Do not edit generated output in `dist/`, `out/`, dependency directories, or test-report folders.

## Working conventions

- Use two-space indentation, single quotes, no semicolons, and a 100-column print-width preference.
- Keep types precise and derive IPC types from the shared Zod schemas.
- Keep Node.js, Electron, filesystem, and Kubernetes access out of the renderer.
- Use TanStack Query for backend-owned state and invalidate every affected query after mutations.
- Use Zustand only for local UI state.
- Reuse renderer UI primitives and semantic design tokens.
- Preserve keyboard access, focus states, accessible labels, light theme, and dark theme.
- Add focused tests next to the implementation and full journeys under `e2e/`.
- Do not add a dependency when the existing stack or a small local implementation is sufficient.

## Cross-process changes

Implement IPC contract changes in this order:

1. Add or update input, output, and event schemas in `src/shared/ipc-types.ts`; infer their types.
2. Implement privileged behavior in an appropriate `src/main/services` module.
3. Register the handler in `src/main/ipc.ts` with `parseArgs` and `registerInvokeHandler`.
4. Add the minimum renderer-facing operation to the typed preload bridge and `LightshipApi`.
5. Add the browser-safe facade in `src/renderer/src/lib/ipc.ts` and connect its query or mutation.
6. Add contract, service, renderer, and E2E coverage appropriate to the behavior.

Validate renderer arguments before they reach a service and validate returned DTOs before they
cross back. Streaming operations must subscribe before starting, use unique subscription IDs, and
provide deterministic teardown.

## Kubernetes changes

Treat all renderer input as untrusted. Validate Kubernetes names, selectors, counts, references,
and YAML near the boundary. Destructive or disruptive actions need an explicit confirmation path,
protected-resource checks, query invalidation, and both success and failure activity records.

Tests must use mocks unless they are explicitly documented integration tests. Do not read the
developer's kubeconfig or require a real cluster from ordinary test suites.

## Verification

Run focused Vitest coverage while iterating. Before completing a normal code change, run:

```bash
pnpm typecheck
pnpm test
pnpm lint
```

Then run the checks required by the affected surface:

| Change                                                                             | Additional check    |
| ---------------------------------------------------------------------------------- | ------------------- |
| User-visible renderer workflow                                                     | `pnpm test:e2e`     |
| IPC, preload, or cross-process behavior                                            | `pnpm build`        |
| Electron packaging, native dependency, icon, entitlement, or builder configuration | `pnpm build:unpack` |

Useful iteration commands include:

```bash
pnpm test:watch
pnpm test:e2e:ui
```

Do not run `pnpm format` as blanket cleanup for a focused change because it rewrites the entire
repository. Format only the files you touched.

## E2E behavior

`pnpm test:e2e` starts Vite on port `5273` in `e2e` mode and drives Chromium. The renderer receives
a mock cluster and deterministic mock data; Electron, the main process, native terminals, and real
Kubernetes access are outside this suite. Add service or contract tests for behavior that cannot be
covered through the browser seam.

## Packaging

```bash
pnpm build
pnpm build:unpack
pnpm build:mac
pnpm build:win
pnpm build:linux
```

The configured package targets are documented in [Getting started](getting-started.md#build-locally).
The update URL is still a placeholder and macOS notarization is disabled, so packaging commands
produce development artifacts rather than an official release.
