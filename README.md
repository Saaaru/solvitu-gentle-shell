# solvitu

Personal sidebar and theme for Pi, built from [pi-cinlodev-cute](https://github.com/CinloDev/pi-cinlodev-cute) (MIT, see LICENSE).

- Right sidebar (fullscreen, 140+ columns) with tabs: `1:MAIN` (status, context, todos), `2:GIT` (graph, working tree), `3:TREE` (project tree).
- `/sidebar [toggle|on|off]` hides or shows the sidebar (full-width chat when hidden; the choice is saved in `<agent-dir>/solvi/sidebar-state.json`). There is no shortcut: Alt+B (Pi word-left), Alt+W and Alt+/ (pi-btw) all collide.
- Theme `Workspace Neon Violet`: Windows Terminal "Neon Violet" palette. Select it in `/settings`.
- Thin single-line frames, no icons.

Install locally: add the folder path to `packages` in `~/.pi/agent/settings.json`.

## Bundled profiles

Profiles in `profiles/` are copied to the global profiles dir (`~/.pi/agent/profiles/`) on first start if absent. A local copy is never overwritten. To update one, edit the global copy, then copy it back to `profiles/` and commit.
