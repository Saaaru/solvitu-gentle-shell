import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { get } from "node:http";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildAuthorizeUrl,
	createPkcePair,
	exchangeCode,
	loginFlow,
	redirectUriFor,
	refreshAccessToken,
	waitForAuthCallback,
	SPOTIFY_SCOPES,
} from "../src/spotify/spotify-auth.ts";
import {
	fileTokenStore,
	memoryTokenStore,
	readSpotifyConfig,
	spotifyPaths,
	writeSpotifyConfig,
} from "../src/spotify/spotify-config.ts";

function hit(port: number, path: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		get({ host: "127.0.0.1", port, path, agent: false }, (res) => {
			let body = "";
			res.on("data", (c) => (body += c));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
		}).on("error", reject);
	});
}

function listening(opts: { state: string; timeoutMs?: number }) {
	let onPort!: (p: number) => void;
	const portP = new Promise<number>((r) => (onPort = r));
	const result = waitForAuthCallback({ port: 0, state: opts.state, timeoutMs: opts.timeoutMs, onListening: onPort });
	return { portP, result };
}

test("spotify pkce: verifier is 64 chars and challenge is base64url sha256", () => {
	const { verifier, challenge } = createPkcePair();
	assert.equal(verifier.length, 64);
	assert.match(verifier, /^[A-Za-z0-9_-]+$/);
	assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
	assert.notEqual(createPkcePair().verifier, verifier);
});

test("spotify authorize url carries all required params", () => {
	const url = new URL(
		buildAuthorizeUrl({ clientId: "abc", redirectUri: "http://127.0.0.1:8888/callback", state: "st", challenge: "ch" }),
	);
	assert.equal(url.origin + url.pathname, "https://accounts.spotify.com/authorize");
	assert.equal(url.searchParams.get("client_id"), "abc");
	assert.equal(url.searchParams.get("response_type"), "code");
	assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:8888/callback");
	assert.equal(url.searchParams.get("scope"), SPOTIFY_SCOPES);
	assert.equal(url.searchParams.get("state"), "st");
	assert.equal(url.searchParams.get("code_challenge_method"), "S256");
	assert.equal(url.searchParams.get("code_challenge"), "ch");
	assert.equal(redirectUriFor(9000), "http://127.0.0.1:9000/callback");
});

test("spotify callback server: valid state resolves with the code and shows the page", async () => {
	const { portP, result } = listening({ state: "good" });
	const port = await portP;
	const res = await hit(port, "/callback?code=THECODE&state=good");
	assert.equal(res.status, 200);
	assert.match(res.body, /Spotify connected/);
	assert.equal(await result, "THECODE");
	await assert.rejects(hit(port, "/callback?code=x&state=good"), "server closed");
});

test("spotify callback server: wrong state rejects", async () => {
	const { portP, result } = listening({ state: "good" });
	const port = await portP;
	const settled = result.then(() => "ok", (e) => e.message);
	const res = await hit(port, "/callback?code=THECODE&state=evil");
	assert.equal(res.status, 400);
	assert.match(await settled, /state/i);
});

test("spotify callback server: access_denied rejects", async () => {
	const { portP, result } = listening({ state: "good" });
	const port = await portP;
	const settled = result.then(() => "ok", (e) => e.message);
	await hit(port, "/callback?error=access_denied&state=good");
	assert.match(await settled, /access_denied/);
});

test("spotify callback server: other paths 404 without settling", async () => {
	const { portP, result } = listening({ state: "good" });
	const port = await portP;
	assert.equal((await hit(port, "/favicon.ico")).status, 404);
	await hit(port, "/callback?code=C&state=good");
	assert.equal(await result, "C");
});

test("spotify callback server: timeout rejects and closes the server", async () => {
	const { portP, result } = listening({ state: "good", timeoutMs: 30 });
	const port = await portP;
	const settled = result.then(() => "ok", (e) => e.message);
	assert.match(await settled, /timed out/i);
	await assert.rejects(hit(port, "/callback?code=x&state=good"));
});

test("spotify callback server: port in use rejects cleanly", async () => {
	const blocker = createServer();
	await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
	const port = (blocker.address() as any).port;
	try {
		await assert.rejects(waitForAuthCallback({ port, state: "s" }), /in use/i);
	} finally {
		blocker.close();
	}
});

function tokenResponse(body: object, status = 200): typeof fetch {
	return (async () => new Response(JSON.stringify(body), { status })) as any;
}

test("spotify exchangeCode posts the PKCE form and builds a token", async () => {
	const calls: { url: string; init: any }[] = [];
	const fetchFn = (async (url: string, init: any) => {
		calls.push({ url, init });
		return new Response(
			JSON.stringify({ access_token: "A", refresh_token: "R", expires_in: 3600, scope: "s1 s2" }),
			{ status: 200 },
		);
	}) as any;
	const token = await exchangeCode({
		clientId: "cid",
		code: "cd",
		redirectUri: "http://127.0.0.1:8888/callback",
		verifier: "ver",
		fetch: fetchFn,
		now: () => 1000,
	});
	assert.deepEqual(token, { accessToken: "A", refreshToken: "R", expiresAt: 1000 + 3600_000, scope: "s1 s2" });
	assert.equal(calls[0].url, "https://accounts.spotify.com/api/token");
	assert.equal(calls[0].init.method, "POST");
	const body = new URLSearchParams(calls[0].init.body);
	assert.equal(body.get("grant_type"), "authorization_code");
	assert.equal(body.get("client_id"), "cid");
	assert.equal(body.get("code"), "cd");
	assert.equal(body.get("redirect_uri"), "http://127.0.0.1:8888/callback");
	assert.equal(body.get("code_verifier"), "ver");
});

test("spotify refreshAccessToken sends refresh grant and keeps the old refresh token when omitted", async () => {
	let sent: URLSearchParams | undefined;
	const fetchFn = (async (_u: string, init: any) => {
		sent = new URLSearchParams(init.body);
		return new Response(JSON.stringify({ access_token: "A2", expires_in: 3600 }), { status: 200 });
	}) as any;
	const token = await refreshAccessToken({
		clientId: "cid",
		refreshToken: "OLD",
		previousScope: "sc",
		fetch: fetchFn,
		now: () => 5,
	});
	assert.equal(sent!.get("grant_type"), "refresh_token");
	assert.equal(sent!.get("refresh_token"), "OLD");
	assert.equal(sent!.get("client_id"), "cid");
	assert.deepEqual(token, { accessToken: "A2", refreshToken: "OLD", expiresAt: 5 + 3600_000, scope: "sc" });
});

test("spotify refreshAccessToken uses a rotated refresh token and surfaces invalid_grant", async () => {
	const rotated = await refreshAccessToken({
		clientId: "c",
		refreshToken: "OLD",
		fetch: tokenResponse({ access_token: "A", refresh_token: "NEW", expires_in: 10 }),
		now: () => 0,
	});
	assert.equal(rotated.refreshToken, "NEW");
	await assert.rejects(
		refreshAccessToken({
			clientId: "c",
			refreshToken: "OLD",
			fetch: tokenResponse({ error: "invalid_grant" }, 400),
		}),
		(e: any) => e.code === "invalid_grant",
	);
});

test("spotify loginFlow opens the browser, waits, exchanges and saves", async () => {
	const store = memoryTokenStore();
	let opened = "";
	let seenState = "";
	const fetchFn = tokenResponse({ access_token: "A", refresh_token: "R", expires_in: 60, scope: "x" });
	const token = await loginFlow({
		clientId: "cid",
		port: 8888,
		store,
		fetch: fetchFn,
		now: () => 0,
		openUrl: (u) => {
			opened = u;
			return { ok: true, url: u };
		},
		waitForCallback: async ({ state }) => {
			seenState = state;
			return "CODE";
		},
	});
	assert.equal(new URL(opened).searchParams.get("state"), seenState);
	assert.equal(token.accessToken, "A");
	assert.equal(store.load()?.refreshToken, "R");
	assert.equal(new URL(opened).searchParams.get("redirect_uri"), "http://127.0.0.1:8888/callback");
});

test("spotify config: paths, read/write and env fallback", () => {
	const dir = mkdtempSync(join(tmpdir(), "spotify-cfg-"));
	const paths = spotifyPaths(dir);
	assert.equal(paths.config, join(dir, "solvi", "spotify.json"));
	assert.equal(paths.token, join(dir, "solvi", "spotify-token.json"));
	assert.deepEqual(readSpotifyConfig(paths, {}), {});
	assert.deepEqual(readSpotifyConfig(paths, { SPOTIFY_CLIENT_ID: "envid" }), { clientId: "envid" });
	writeSpotifyConfig({ clientId: "fileid", port: 9001 }, paths);
	assert.deepEqual(readSpotifyConfig(paths, { SPOTIFY_CLIENT_ID: "envid" }), { clientId: "fileid", port: 9001 });
});

test("spotify file token store: round trips, writes atomically and clears", () => {
	const dir = mkdtempSync(join(tmpdir(), "spotify-tok-"));
	const paths = spotifyPaths(dir);
	const store = fileTokenStore(paths.token);
	assert.equal(store.load(), null);
	const token = { accessToken: "a", refreshToken: "r", expiresAt: 123, scope: "s" };
	store.save(token);
	assert.deepEqual(store.load(), token);
	assert.deepEqual(JSON.parse(readFileSync(paths.token, "utf8")), token);
	assert.deepEqual(readdirSync(paths.dir), ["spotify-token.json"], "no temp file left behind");
	if (process.platform !== "win32") assert.equal(statSync(paths.token).mode & 0o777, 0o600);
	store.clear();
	assert.equal(store.load(), null);
	store.clear();
});

test("spotify file token store: corrupt file loads as null", () => {
	const dir = mkdtempSync(join(tmpdir(), "spotify-bad-"));
	const paths = spotifyPaths(dir);
	const store = fileTokenStore(paths.token);
	store.save({ accessToken: "a", refreshToken: "r", expiresAt: 1, scope: "" });
	writeFileSync(paths.token, "{nope");
	assert.equal(store.load(), null);
});
