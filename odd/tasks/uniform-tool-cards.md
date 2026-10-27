# Uniform lazy-expanding tool cards

Branch: perf/uniform-tool-cards (from feat/spotify-solvi-player @ 43a0db6)

## Objective
Every tool call (built-in, MCP, unknown) renders the same compact Solvitu card: colored header, short
preview, "... (K more lines, ctrl+o to expand)". The full output is formatted only when expanded.
Remove the per-frame pre-render of collapsed cards; make ctrl+o and click work through Pi's `expanded` flag.

## Tasks
- [x] T1 Failing tests (RED): test/tool-card.test.ts (module missing). Route: inline (one new test file). Evidence: ERR_MODULE_NOT_FOUND.
- [x] T2 src/tool-card.ts renderer + resolver, registered in index.ts, compactToolRenderer/COMPACT_TOOLS retired. Route: inline (one non-trivial new file, already designed). Evidence: 12 tool-card tests green.
- [x] T3 Dispatcher passes Solvitu cards through (no frame, one render, Pi owns the click); delete read/write/fetch/search/grep/memory branches, pushToolCard, expandedTools, ToolToggleMouseProxy. Update broken tests. Route: delegated-equivalent mapping done earlier by caller; edits inline (single file cuts).
- [x] T4 Perf tests: collapsed cost independent of output size; formatter only on expand.
- [x] T5 Headless smoke (see Evidence).

## Design
- Pi re-invokes renderCall/renderResult when `expanded` flips; the component returned renders lazily and caches per width.
- Collapsed: head (bash: tail) 5 lines found with indexOf/lastIndexOf, no split of the whole text, no formatters.
- Expanded: existing formatters (bash/read/write+diff/grep/generic), wrapped, indented, no box (the old box would be a second frame).
- Partial (streaming): tail only (5 lines, 40 when expanded), never formatted.
- Excluded (fall to next renderer + Layer B grouping): subagent_*, gentle_review*.
- Layer B keeps: user messages, user `!` bash (BashExecutionComponent), review, subagent grouping, error text, assistant prose.
- Clicks: Pi's ToolExecutionComponent MouseRegion toggles its own expanded flag; dispatcher forwards the child as mouse target.

## Deviations / notes
- Memory (mem_*) calls are no longer merged into one framed card; each is its own card.
- Expanded cards are indented, not boxed.
- Legacy `formatTranscriptChild` (single child, exported API) keeps its old branches for components without a Solvitu renderer.

## Evidence
- RED: `node --test test/tool-card.test.ts` -> ERR_MODULE_NOT_FOUND src/tool-card.ts (pass 0, fail 1).
- GREEN: 14 tests in test/tool-card.test.ts pass.
- Baseline `npm test`: 270 tests, 269 pass, 1 fail (solvi-tree). After: 281 tests, 280 pass, 1 fail (solvi-tree).
- Smoke: `pi -p --no-session --no-extensions -e <worktree> "call ls once..."` exited 0 and answered; no extension load errors. Print mode does not draw the TUI, so card rendering itself is verified by unit tests only (no interactive TUI check).
- Commits: 90d1c3a feat(tools): uniform lazy-expanding Solvitu card for every tool.
