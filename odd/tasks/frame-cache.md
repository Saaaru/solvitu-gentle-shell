# frame-cache

Branch: `perf/frame-cache` (worktree `solvitu-gentle-shell-worktrees/frame-cache`, from `feat/spotify-solvi-player` fbb74fd).

## Objective

Make Solvitu's per-frame CPU independent of transcript history and of unchanged sidebar content, so it approaches Pi's native cost (~0.05 ms) instead of 0.7 ms @ 40 children, 2.6 ms @ 160, 6.8-9 ms @ 400.

## Problem (verified)

- `chatContainer.render` is replaced by `formatTranscriptChildren`, which re-formats and re-frames every non-assistant child every frame (user, bash/review/subagent/error groups, generic).
- `transformTranscriptLines` (regex + stripAnsi per line) ran 3-4 times over the same lines per frame (doc, scroll view, left wrapper, widget docks).
- `buildSidebarRailLines` re-renders every dock entry and card every frame.

## Constraints

- Output must stay byte-identical to the uncached path (parity checked against HEAD with a hash script on a mixed fixture at 40/80/120).
- Streaming or partial children must never be served stale.
- ~400 changed lines per task is a planning heuristic only.
- Edit surfaces limited to the allow-list of the delegation (no changes to `src/git/git-swr.ts`, `src/solvi-*.ts` shims).

## Tasks

- [x] T1 Transcript per-child cache + single idempotent transform (route: delegated writer; inline edits by the same worker, 3 files + tests)
  - `src/transcript/transcript-child-cache.ts`: WeakMap per anchor child; key = variant, width, theme identity + theme paint stamp, colors/strings identity, member list, and element-wise equality of the raw lines each member rendered (snapshot copies, so in-place mutation is detected).
  - `transformTranscriptLines` memoizes per (theme, carried state, line) and passes through lines it produced itself, so repeated passes are idempotent and cost a map lookup per line. `transformTranscriptLinesUncached` is the reference.
  - Finding: the legacy transform was NOT idempotent (Gentle AI card lines were re-wrapped in nested color codes on every extra pass). Visual output is identical; bytes now differ only for those nested codes in the sidebar-wrapped path.
- [x] T2 Rail memoization (route: delegated writer, same worker; builder + 2 cards + sidebar.ts)
  - `sidebar-rail-builder.ts`: optional `getRenderKey(width, height)` per card; per-card memo (key or element-wise raw-lines equality) skips render and unifySidebarCardFrame; todo-tab prior cards render once (first pass reused by the section pass); whole-rail result memo keyed by width, tab, theme paint, banner, git badge and section line identity.
  - `git-graph-card.ts` and `git-working-tree-card.ts` expose `getRenderKey` (SWR reads keep ticking; key covers data, view mode, expansion, scroll, size, config identity).
  - `sidebar.ts`: `filledColumn` caches edge spacer / left border / middle divider arrays by (kind, rows, width, theme).
  - Not done: version keys for profiles, tree and solvi-tab cards; dock/editor measurement still renders once per frame (~0.1 ms, no safe unchanged signal available before layout); footer refreshDirty and ecosystem detection render side effects; requestRender coalescing.

## Test evidence

- T1 RED (before dispatcher cache): `test/transcript-child-cache.test.ts` -> 4 failures: second frame formatter work > 0, stale/invalidation expectations, transform idempotence (legacy double wrap), perf (400 children 135.6 ms/frame with the mock theme).
- T1 GREEN: 10/10 in that file; full suite 290/291 (only known solvi-tree failure).
- Parity: sha1 of `lines` + mouse heights identical before/after at widths 40/80/120.
- Bench (bench3, ms/frame solvi pipeline, 40/160/400 children): before 0.825 / 2.801 / 9.014; after 0.082 / 0.164 / 0.771.

- T2 RED: `test/rail-cache.test.ts` 4 failures (zero card renders on frame 2, todo first pass, version bump, flat cost). GREEN: 11/11 plus `test/git-graph-card-key.test.ts` 3/3.
- Full suite after T2: 304/305 pass (only the known solvi-tree failure).
- Bench rail warm ms/frame (bench2), before -> after: git 1.34 -> 0.11, mem 0.07 -> 0.05, solvi 0.27 -> 0.18, prof 0.51 -> ~0.5 and tree 0.72 -> ~0.7-0.9 (unchanged, no card key yet).
- Bench transcript (bench3) 40/160/400 children after T2: 0.080 / 0.17 / 0.69 ms.

## Route per task

- T1: delegated direct (this worker is the single writer); mapping done inline within budget (dispatcher, theme-adapter, cache pattern reused).
- T2: same.

## Next step

Add version keys to profiles, tree and solvi-tab cards; cache classification renders (tryRender at width 80) in transcript-tools-special.
