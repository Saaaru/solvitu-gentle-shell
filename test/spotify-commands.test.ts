import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSpotifyCommands } from "../src/spotify/spotify-commands.ts";
import { fileTokenStore, readSpotifyConfig, spotifyPaths, writeSpotifyConfig } from "../src/spotify/spotify-config.ts";

function setup(steps: (Response | Error)[] = [], opts: { clientId?: string } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "spotify-cmd-"));
	const paths = spotifyPaths(dir);
	if (opts.clientId) writeSpotifyConfig({ clientId: opts.clientId }, paths);
	let command: any;
	const pi = { registerCommand: (name: string, o: any) => (command = { name, ...o }) } as any;
	const fetchFn = (async () => {
		const s = steps.shift();
		if (!s) throw new Error("unexpected fetch");
		if (s instanceof Error) throw s;
		return s;
	}) as any;
	registerSpotifyCommands(pi, {
		paths,
		fetch: fetchFn,
		now: () => 1_000_000,
		env: {},
		openUrl: () => ({ ok: true, url: "u" }),
	});
	const notes: { message: string; type: string }[] = [];
	const ctx = { hasUI: true, ui: { notify: (message: string, type: string) => notes.push({ message, type }) } } as any;
	const run = (args: string) => command.handler(args, ctx);
	return { command, run, notes, paths };
}

const tok = { accessToken: "AT", refreshToken: "RT", expiresAt: 9_000_000, scope: "s" };

test("spotify command: registered with completions", () => {
	const { command } = setup();
	assert.equal(command.name, "spotify");
	const all = command.getArgumentCompletions("").map((i: any) => i.value);
	assert.deepEqual(all, ["client", "login", "logout", "status", "play", "pause", "next", "prev"]);
	assert.deepEqual(command.getArgumentCompletions("pl").map((i: any) => i.value), ["play"]);
});

test("spotify command: client writes the trimmed config", async () => {
	const { run, notes, paths } = setup();
	await run("client   abc123  ");
	assert.equal(readSpotifyConfig(paths, {}).clientId, "abc123");
	assert.equal(notes[0].type, "info");
	await run("client");
	assert.equal(notes[1].type, "warning");
});

test("spotify command: login without client id prints the setup steps", async () => {
	const { run, notes } = setup();
	await run("login");
	const m = notes[0].message;
	assert.match(m, /developer\.spotify\.com\/dashboard/);
	assert.match(m, /http:\/\/127\.0\.0\.1:8888\/callback/);
	assert.match(m, /Web API/);
	assert.match(m, /\/spotify client <id>/);
});

test("spotify command: status reports not connected, then device and track", async () => {
	const s = setup([], { clientId: "cid" });
	await s.run("status");
	assert.match(s.notes[0].message, /no conectado/i);
	const playing = {
		is_playing: true,
		progress_ms: 1,
		currently_playing_type: "track",
		device: { name: "PC", type: "Computer", volume_percent: 10 },
		item: { type: "track", id: "t", name: "Song", uri: "u", duration_ms: 5, artists: [{ name: "Art" }], album: { name: "Alb" } },
	};
	const s2 = setup([new Response(JSON.stringify(playing), { status: 200 })], { clientId: "cid" });
	fileTokenStore(s2.paths.token).save(tok);
	await s2.run("status");
	assert.match(s2.notes[0].message, /Conectado/);
	assert.match(s2.notes[0].message, /PC/);
	assert.match(s2.notes[0].message, /Song/);
	assert.match(s2.notes[0].message, /Art/);
});

test("spotify command: play maps typed errors to Spanish messages", async () => {
	const s = setup([new Response(JSON.stringify({ error: { reason: "PREMIUM_REQUIRED" } }), { status: 403 })], { clientId: "cid" });
	fileTokenStore(s.paths.token).save(tok);
	await s.run("play");
	assert.equal(s.notes[0].message, "Spotify Premium requerido para controlar la reproducción");
	assert.equal(s.notes[0].type, "warning");
	const n = setup([], { clientId: "cid" });
	await n.run("pause");
	assert.match(n.notes[0].message, /\/spotify login/);
});

test("spotify command: logout clears the token", async () => {
	const s = setup([], { clientId: "cid" });
	const store = fileTokenStore(s.paths.token);
	store.save(tok);
	await s.run("logout");
	assert.equal(store.load(), null);
});

test("spotify command: unknown subcommand shows usage", async () => {
	const s = setup();
	await s.run("wat");
	assert.match(s.notes[0].message, /Uso/);
});
