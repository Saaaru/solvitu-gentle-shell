import { test } from "node:test";
import assert from "node:assert/strict";
import { SpotifyClient } from "../src/spotify/spotify-client.ts";
import { memoryTokenStore, type SpotifyToken } from "../src/spotify/spotify-config.ts";

type Call = { url: string; method: string; auth?: string; body?: string };
type Step = Response | Error;

function script(steps: Step[]) {
	const calls: Call[] = [];
	const fetchFn = (async (url: string, init: any = {}) => {
		calls.push({ url, method: init.method ?? "GET", auth: init.headers?.Authorization, body: init.body?.toString() });
		const step = steps.shift();
		if (!step) throw new Error("unexpected fetch " + url);
		if (step instanceof Error) throw step;
		return step;
	}) as any;
	return { fetchFn, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers });
const empty = (status = 204) => new Response(null, { status });
const TOKEN: SpotifyToken = { accessToken: "AT", refreshToken: "RT", expiresAt: 10_000_000, scope: "s" };
const NOW = 1_000_000;

function make(steps: Step[], token: SpotifyToken | null = TOKEN, clientId: string | undefined = "cid") {
	const store = memoryTokenStore(token ?? undefined);
	const { fetchFn, calls } = script(steps);
	const client = new SpotifyClient({ store, clientId, fetch: fetchFn, now: () => NOW });
	return { client, store, calls };
}

test("spotify client: no client id and no token", async () => {
	assert.deepEqual(await make([], TOKEN, "").client.play(), { ok: false, error: { kind: "no-client-id" } });
	const r = await make([], null).client.getPlayback();
	assert.deepEqual(r, { ok: false, error: { kind: "not-connected" } });
});

test("spotify client: 204 playback is null", async () => {
	const { client, calls } = make([empty()]);
	assert.deepEqual(await client.getPlayback(), { ok: true, value: null });
	assert.equal(calls[0].url, "https://api.spotify.com/v1/me/player?additional_types=episode");
	assert.equal(calls[0].auth, "Bearer AT");
});

test("spotify client: normalises a track", async () => {
	const { client } = make([
		json({
			is_playing: true,
			progress_ms: 1234,
			shuffle_state: true,
			repeat_state: "track",
			currently_playing_type: "track",
			device: { name: "PC", type: "Computer", volume_percent: 40 },
			item: {
				type: "track",
				id: "t1",
				name: "Song",
				uri: "spotify:track:t1",
				duration_ms: 200000,
				artists: [{ name: "A" }, { name: "B" }],
				album: { name: "Alb" },
			},
		}),
	]);
	const r = await client.getPlayback();
	assert.ok(r.ok && r.value);
	assert.deepEqual(r.value, {
		isPlaying: true,
		progressMs: 1234,
		durationMs: 200000,
		fetchedAt: NOW,
		itemType: "track",
		track: { id: "t1", name: "Song", artists: ["A", "B"], album: "Alb", uri: "spotify:track:t1" },
		device: { name: "PC", type: "Computer", volumePercent: 40 },
		shuffle: true,
		repeat: "track",
	});
});

test("spotify client: normalises an episode and an ad", async () => {
	const ep = make([
		json({
			is_playing: false,
			progress_ms: 5,
			currently_playing_type: "episode",
			repeat_state: "off",
			item: { type: "episode", id: "e1", name: "Ep", uri: "spotify:episode:e1", duration_ms: 99, show: { name: "Show", publisher: "Pub" } },
		}),
	]);
	const r = await ep.client.getPlayback();
	assert.ok(r.ok && r.value);
	assert.equal(r.value.itemType, "episode");
	assert.deepEqual(r.value.track, { id: "e1", name: "Ep", artists: ["Pub"], album: "Show", uri: "spotify:episode:e1" });
	assert.equal(r.value.shuffle, false);
	assert.equal(r.value.device, undefined);
	const ad = make([json({ is_playing: true, progress_ms: 0, currently_playing_type: "ad", item: null })]);
	const a = await ad.client.getPlayback();
	assert.ok(a.ok && a.value);
	assert.equal(a.value.itemType, "ad");
	assert.equal(a.value.track, undefined);
	assert.equal(a.value.durationMs, 0);
});

test("spotify client: control endpoints use the right method and url", async () => {
	const { client, calls } = make([empty(), empty(), empty(), empty(), empty()]);
	for (const r of [await client.play(), await client.pause(), await client.next(), await client.previous(), await client.seek(4321.7)]) {
		assert.deepEqual(r, { ok: true, value: undefined });
	}
	assert.deepEqual(
		calls.map((c) => `${c.method} ${c.url.replace("https://api.spotify.com/v1", "")}`),
		["PUT /me/player/play", "PUT /me/player/pause", "POST /me/player/next", "POST /me/player/previous", "PUT /me/player/seek?position_ms=4322"],
	);
});

test("spotify client: refreshes proactively when expiring within 60 s", async () => {
	const soon = { ...TOKEN, expiresAt: NOW + 30_000 };
	const { client, store, calls } = make([json({ access_token: "NEW", expires_in: 3600 }), empty()], soon);
	assert.equal((await client.next()).ok, true);
	assert.equal(calls[0].url, "https://accounts.spotify.com/api/token");
	assert.equal(calls[1].auth, "Bearer NEW");
	assert.equal(store.load()?.refreshToken, "RT");
	assert.equal(store.load()?.accessToken, "NEW");
});

test("spotify client: reactive refresh on 401 then one retry", async () => {
	const { client, calls } = make([
		json({ error: { status: 401, message: "expired" } }, 401),
		json({ access_token: "NEW", expires_in: 3600 }),
		empty(),
	]);
	assert.equal((await client.pause()).ok, true);
	assert.equal(calls.length, 3);
	assert.equal(calls[2].auth, "Bearer NEW");
});

test("spotify client: a second 401 does not loop", async () => {
	const { client, calls } = make([json({}, 401), json({ access_token: "NEW", expires_in: 3600 }), json({}, 401)]);
	assert.deepEqual(await client.pause(), { ok: false, error: { kind: "unauthorized" } });
	assert.equal(calls.length, 3);
});

test("spotify client: invalid_grant on refresh clears the store", async () => {
	const { client, store } = make([json({}, 401), json({ error: "invalid_grant" }, 400)]);
	assert.deepEqual(await client.play(), { ok: false, error: { kind: "not-connected" } });
	assert.equal(store.load(), null);
});

test("spotify client: premium, no device, rate limit, http and network errors", async () => {
	const premium = make([json({ error: { status: 403, reason: "PREMIUM_REQUIRED" } }, 403)]);
	assert.deepEqual(await premium.client.play(), { ok: false, error: { kind: "premium-required" } });
	const nodev = make([json({ error: { status: 404, reason: "NO_ACTIVE_DEVICE" } }, 404)]);
	assert.deepEqual(await nodev.client.play(), { ok: false, error: { kind: "no-device" } });
	const rl = make([json({}, 429, { "Retry-After": "3" })]);
	assert.deepEqual(await rl.client.getPlayback(), { ok: false, error: { kind: "rate-limited", retryAfterMs: 3000 } });
	const http = make([json({ error: { message: "boom" } }, 500)]);
	assert.deepEqual(await http.client.getPlayback(), { ok: false, error: { kind: "http", status: 500 } });
	const net = make([new TypeError("fetch failed")]);
	assert.deepEqual(await net.client.getPlayback(), { ok: false, error: { kind: "network" } });
});
