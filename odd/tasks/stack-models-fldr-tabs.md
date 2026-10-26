# stack-models-fldr-tabs

## Objective
Rework the Solvitu sidebar tabs: MEM becomes the first tab `1:STACK` (Stack box + new Models box), and the old `1:MAIN` project tree becomes `4:FLDR` with a 50/50 split (tree + keyboard-navigable file viewer).

## Scope (authorized by the user)
- Tab order/labels: `1:STACK` (id `mem`), `2:GIT`, `3:PROF`, `4:FLDR` (id `tree`), `5:SKILLS`, `6:Solvi`.
- STACK tab keeps only the Stack (ecosystem) card. The "Active Handoff" card is removed from it and replaced by a "Models" card. The other former MEM cards (engram, persistentMemory, tools) are removed from the tab map only; their code stays.
- Models card lists the scoped models (Pi `enabledModels` setting, same set as `/scoped-models`) with context window, session tokens/cost and quota where resolvable.
- FLDR: tree uses 50% of the column height, the other 50% previews the selected file; selection and scrolling must work from the keyboard.

## Constraints
- Cards are `Component`s (`render(width,height) => string[]`), see `src/sidebar-rail-builder.ts`.
- No keyboard model exists for the tree today; keyboard goes through Pi shortcuts registered in `index.ts`.
- Uncommitted user edits exist in `index.ts` and `src/main-view.ts`; do not include them in work-unit commits unless a task needs the file.
- Baseline before changes: `npm test` = 142 pass, 2 fail (pre-existing: `solvi-engram ... WorkspaceEngramCard`, `solvi-tree ... Header must include nvim editor button`).
- Planning heuristic ~400 authored changed lines per task (advisory).

## Tasks
- [x] T1 Tab reorder and relabel (mem -> `1:STACK`, tree -> `4:FLDR`, STACK cards = ecosystem only for now; `models` joins in T2). Tests first: `test/sidebar.test.ts`, `test/tree.test.ts`, `test/engram.test.ts`, `test/ecosystem-card.test.ts`. Route: inline (2 non-trivial files? no: one source file, tests-led edits). Evidence: RED = 3 failures after test edits, GREEN = `npm test` 142 pass / 2 pre-existing fail (same two as baseline). Aliases added: `main`, `folder` -> tree.
- [x] T2 Models card: new `src/models/` card + per-model reducer, registered in `src/footer.ts`, added to the STACK card map. Route: delegated writer (2+ new non-trivial files). Evidence: RED 141/145 pass; GREEN `npm test` 150 pass / 2 pre-existing fail of 152 (parent re-ran). Scope source: `ctx.scopedModels` (same set as `/scoped-models`), fallback to `enabledModels` setting, then first 6 available. Real per model: context window, session tokens and cost. Active model only: context usage and quota (quota matched by account prefix). Not visually checked in a TUI.
- [x] T3 FLDR split: tree card at 50% height, new file-viewer card, keyboard cursor/open/scroll. Route: delegated writer (3 new non-trivial files). Evidence: RED 149/153 pass; GREEN `npm test` 159 pass / 2 pre-existing fail of 161 (parent re-ran). Split was already `floor(n/2)` + rest in `buildSidebarRailLines`; covered by a new test. Only the 3 lines the writer added to `index.ts` were staged; the user's own hunks (alt+h/alt+l tab shortcuts) stay uncommitted. Footer hint is truncated at 44 columns. Keys untested in a real terminal.
- [x] T5 (added mid-feature at user request) Two new Pi themes `Solvitu-Dark` and `Solvitu-Light` in `themes/`, same var/role keys as `Workspace.json`, palette from Anthropic brand colors (orange `#D97757`, cream `#FAF9F5`, blue `#6A9BCC`, green `#788C5D`). Route: inline (generated JSON, one script). Evidence: 43 vars / 53 color roles each, 0 unresolved role references. Pending: user visual check; exact Claude Code hex values were not available.
- [ ] T4 Verification: `npm test`, launch `gentle-shell`, visual check by the user.

## Keyboard design (as implemented)
Pi reserves Alt+Arrow keys (`keybindings.md`: models reorder, message dequeue, tree fold, word movement), so the planned bindings were replaced: Alt+W / Alt+X move the tree cursor, Alt+. expands a directory or opens the file, Alt+, collapses or goes to the parent, Alt+PageUp / Alt+PageDown scroll the viewer. All inert unless the active tab is FLDR. Existing Alt+H/L (tabs) and Alt+I/J (rail scroll) stay.

## Acceptance
- Tab bar reads `1:STACK 2:GIT 3:PROF 4:FLDR 5:SKILLS 6:Solvi`.
- STACK shows Stack box then Models box; no Active Handoff.
- FLDR shows tree (top half) and preview (bottom half); keyboard moves selection and updates the preview.
- `npm test`: no new failures vs. baseline.

## Progress
- Branch `feat/stack-models-fldr-tabs` created from `main`.
- Exploration done (sidebar-tabs.ts, ecosystem/engram/tree cards, usage/context helpers).

## Next step
T4 (visual check by the user in gentle-shell; each Alt key must be tried).
