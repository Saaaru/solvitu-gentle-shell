# profile-sync

Objective: repo is source of truth for the Saaaru profile; sync to global dir at startup without overwriting.

- [x] T1 Restore profiles/Saaaru.json (from 65826e5)
- [x] T2 syncBundledProfiles (src/profiles/profile-sync.ts), hooked in index.ts; tests first (RED: module missing, GREEN after)
- [x] T3 package.json files includes profiles; not gitignored
- [x] T4 README note

Route: inline (small). Commit: see git log (feat(profiles)).
