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
- [ ] T2 Rail memoization (see below)

## Test evidence

- T1 RED (before dispatcher cache): `test/transcript-child-cache.test.ts` -> 4 failures: second frame formatter work > 0, stale/invalidation expectations, transform idempotence (legacy double wrap), perf (400 children 135.6 ms/frame with the mock theme).
- T1 GREEN: 10/10 in that file; full suite 290/291 (only known solvi-tree failure).
- Parity: sha1 of `lines` + mouse heights identical before/after at widths 40/80/120.
- Bench (bench3, ms/frame solvi pipeline, 40/160/400 children): before 0.825 / 2.801 / 9.014; after 0.082 / 0.164 / 0.771.

## Route per task

- T1: delegated direct (this worker is the single writer); mapping done inline within budget (dispatcher, theme-adapter, cache pattern reused).
- T2: same.

## Next step

T2 rail memoization.
