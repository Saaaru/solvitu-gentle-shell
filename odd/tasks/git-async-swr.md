# git-async-swr

## Objective
Remove blocking `execFileSync` git calls from the sidebar render path. Serve cached (stale) values, refresh asynchronously with `execFile`, dedupe per key, and request a re-render only when the value changed.

## Problem (profiler evidence)
`src/git/git-cli.ts` TTL-cached calls blocked the render thread on each TTL expiry: status ~62ms, file-changes ~65ms, log graph ~32ms, branches ~30ms. `getGitSyncBadge` ran every frame from the rail tab bar.

## Scope
`src/git/*.ts`, `src/sidebar-rail-builder.ts`, git-related tests. Public fetch* signatures stay synchronous; cold start returns an empty default.

## Tasks
- [x] T1 RED: `test/git-swr.test.ts`. Evidence: 7 of 8 tests failing before implementation (commit ff0cde4).
- [x] T2 GREEN: `src/git/git-swr.ts` store plus git-cli fetchers (status, file changes, graph, branches, branch diff) via async execFile; `bindGitRenderHost(tui)` in sidebar-rail-builder. Evidence: 8/8 pass.
- [x] T3 Existing git, tree and sidebar tests warm caches with `awaitGitIdle`; default runner skips spawning outside a git repo. Evidence: `npm test` 247 pass, 1 fail (pre-existing solvi-tree nvim button).

## Route
Inline: one coherent module and an already-understood design.

## Evidence and notes
- Reset functions mark entries stale (values kept, no flicker); `clearAllGitCaches()` is the hard reset.
- Risk: first paint of git tabs shows empty defaults until the first refresh completes (~30-65ms).
