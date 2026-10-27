# sidebar-toggle

Objective: toggleable sidebar so the terminal can run fullscreen without it. `/sidebar [toggle|on|off]`.

Decisions
- Alt+B collides with Pi `tui.editor.cursorWordLeft` (also bound in the user's keybindings.json). Alt+W was first chosen but collides with pi-btw; Alt+/ also collides with pi-btw (its shortcuts are not discoverable by grep), so the shortcut was dropped and only /sidebar remains.
- State lives in `<agent-dir>/solvi/sidebar-state.json` (`{"visible":bool}`), not in the layered Workspace.layout.json, which is read-only config. Default visible; read/write never throw.
- Hidden: `prepare()` returns early (no rail build, no card renders), left border dropped, the foreign rail is still discarded; chat component is the only hstack entry.
- Width caches (filledColumn, child card cache, rail memo) are keyed by width/signature; toggling also clears the rail memo and rail lines.

Tasks
- [x] T1 RED tests (test/sidebar-toggle.test.ts); hidden/cache/dock tests failed before the change
- [x] T2 sidebar-visibility module, sidebar.ts, rail memo invalidation, index.ts wiring (GREEN)
- [x] T3 README

Route: inline (small, understood change). Checks: `npm test` 313 tests, only pre-existing solvi-tree fails.
