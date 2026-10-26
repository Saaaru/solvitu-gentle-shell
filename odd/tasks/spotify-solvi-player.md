# spotify-solvi-player

## Objective
Turn the sidebar tab `6:Solvi` (card `solviTab`, currently a placeholder) into an ASCII-style Spotify player for the user's personal account: now playing, progress, and playback controls.

## Why / feasibility (verified against developer.spotify.com on 2026-10-26)
- Web API with OAuth Authorization Code + PKCE (no client secret). Redirect URI must be an explicit loopback literal, `http://127.0.0.1:PORT/...` (`localhost` is not allowed; HTTP is allowed only for loopback).
- Development-mode app: up to 5 allow-listed users, owner needs Premium. User confirmed Premium.
- Read: `GET /v1/me/player` (or `/currently-playing`): track, artists, `progress_ms`, `duration_ms`, `is_playing`. Control endpoints (play, pause, next, previous, seek) need Premium and scope `user-modify-playback-state`.
- The Web API only remote-controls an already open Spotify device; it does not stream audio.

## Scope
- Scopes: `user-read-playback-state user-read-currently-playing user-modify-playback-state`.
- Slash command `/spotify` with `client <id>`, `login`, `logout`, `status`, `play`, `pause`, `next`, `prev`.
- Tab `6:Solvi`: connection/help state, now playing (title, artists, album, device), progress bar with local interpolation, animated ASCII equalizer, clickable controls and seek bar. No album cover in this iteration (no JPEG decoder is available and the repo has no installed dependencies); cover is a possible later step.
- Files and secrets under `<agentDir>/solvi/` (agent dir from Pi's `getAgentDir()` with `resolveAgentDir()` fallback, see `src/models/models-client.ts`): `spotify.json` for the client id and `spotify-token.json` (mode 0600, atomic write) for tokens.

## Out of scope
Album cover rendering, queue, volume, search, playlists, audio streaming.

## Constraints
- User action required (cannot be done by the agent): create the app at developer.spotify.com/dashboard, add redirect URI `http://127.0.0.1:8888/callback`, and give the Client ID.
- Uncommitted user edits exist in `index.ts` and `src/main-view.ts`; stage only own hunks (rebuild the blob from HEAD plus own lines, never `git apply -U0`; that misplaced lines once).
- Baseline before this feature: `npm test` = 161 tests, 159 pass, 2 pre-existing failures (`solvi-engram ... WorkspaceEngramCard`, `solvi-tree ... header`).
- No registerCommand, no setInterval pattern and no fetch mocks exist in the repo; inject `fetch`, clock and storage for tests.
- Tests must not call the real Spotify API.

## Tasks
- [x] S1 (evidence: RED = 3 suites `ERR_MODULE_NOT_FOUND`; GREEN = `npm test` 191 pass / 2 pre-existing fail of 193, parent re-ran; 29 new tests with injected fetch, no real network; only 2 lines added to `index.ts`, staged from a HEAD-based blob; agent dir via `resolveAgentDir()` because the launcher sets `PI_CODING_AGENT_DIR`; Windows opener = `rundll32 url.dll,FileProtocolHandler`; untested against the real Spotify API) Auth, token store, API client and `/spotify` commands: `src/spotify/*` (PKCE + loopback callback server, browser opener safe on Windows, token store with refresh, client with 401 refresh, 429 Retry-After, typed errors for not-connected, premium-required, no-device, network), commands registered from `index.ts` (add-only lines). Route: delegated writer.
- [ ] S2 Now-playing state and UI: poller with dispose and backoff, ASCII renderer (progress, equalizer, controls, error/help states), rewrite `src/solvi-tab/solvi-tab-card.ts` and `test/solvi-tab.test.ts`, remove YouTube-only types. Route: delegated writer, after S1.
- [ ] S3 Live verification with the user's Client ID (login, now playing, each control).

## Acceptance
- `/spotify client <id>` then `/spotify login` opens the browser, completes PKCE, stores tokens; `/spotify status` reports the connection.
- `6:Solvi` shows the current track with a moving progress bar and equalizer; clicking prev/play-pause/next and the seek bar controls Spotify.
- Not connected, missing client id, no active device and non-Premium each show a clear message instead of an error.
- `npm test`: no new failures vs. baseline, new tests cover auth, client and rendering with mocked fetch.

## Progress
- Branch `feat/spotify-solvi-player` created from `feat/stack-models-fldr-tabs`.
- Exploration done (Solvi card, wiring, commands API, config dirs, image libs, test patterns).

## Next step
S2 (UI on top of `getSpotifyClient()` from `src/spotify/spotify-commands.ts`).
