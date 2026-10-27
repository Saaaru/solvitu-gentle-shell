# git-async-swr

## Objective
Remove blocking `execFileSync` git calls from the sidebar render path. Serve cached (stale) values, refresh asynchronously with `execFile`, dedupe per key, and request a re-render only when the value changed.

## Problem (profiler evidence)
`src/git/git-cli.ts` TTL-cached calls block the render thread on each TTL expiry: status ~62ms, file-changes ~65ms, log graph ~32ms, branches ~30ms. `getGitSyncBadge` runs every frame from the rail tab bar.

## Scope
`src/git/*.ts`, `src/sidebar-rail-builder.ts`, `test/git*.test.ts`. Public fetch* signatures stay synchronous; cold start returns an empty/loading default.

## Constraints
- Pattern: `src/ecosystem/ecosystem-client.ts` (stale + background refresh + re-render).
- Baseline: 2 known failures (solvi-engram WorkspaceEngramCard, solvi-tree nvim button).
- ~400 changed lines is a planning heuristic only.

## Tasks
- [ ] T1 RED: tests for SWR core (stale served while pending, no sync spawn, dedupe, re-render only on change, error keeps last good).
- [ ] T2 GREEN: `src/git/git-swr.ts` + convert git-cli fetchers; wire render hook in rail builder.
- [ ] T3 Update existing git tests for cold-start semantics; refactor.

## Route
Inline (single coherent module, one writer, understood design).

## Evidence
(filled in below)
