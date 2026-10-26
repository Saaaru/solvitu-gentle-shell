import test from "node:test";
import assert from "node:assert/strict";
import { SpotifyPoller } from "../src/spotify/spotify-state.ts";
import type { PlaybackState, SpotifyResult } from "../src/spotify/spotify-client.ts";

function pb(over: Partial<PlaybackState> = {}): PlaybackState {
	return {
		isPlaying: true,
		progressMs: 10_000,
		durationMs: 200_000,
		fetchedAt: 0,
		itemType: "track",
		track: { id: "t1", name: "Song", artists: ["A"], album: "Alb", uri: "spotify:track:t1" },
		device: { name: "PC", type: "Computer", volumePercent: 50 },
		shuffle: false,
		repeat: "off",
		...over,
	};
}

type Res = SpotifyResult<PlaybackState | null>;

function harness(opts: { clientId?: string | undefined; connected?: boolean; results?: Res[]; visibleWindowMs?: number } = {}) {
	let clock = 0;
	const timers: { id: number; fn: () => void; at: number; cleared: boolean }[] = [];
	let nextId = 1;
	const calls: string[] = [];
	const state = {
		connected: opts.connected ?? true,
		results: opts.results ?? ([{ ok: true, value: pb() }] as Res[]),
		control: { ok: true, value: undefined } as SpotifyResult<void>,
		pollCount: 0,
		throwOnControl: false,
	};
	const client: any = {
		clientId: "clientId" in opts ? opts.clientId : "cid",
		isConnected: () => state.connected,
		getPlayback: async () => {
			state.pollCount++;
			const r = state.results.length > 1 ? state.results.shift()! : state.results[0];
			return r.ok && r.value ? { ok: true, value: { ...r.value, fetchedAt: clock } } : r;
		},
	};
	for (const m of ["play", "pause", "next", "previous"]) {
		client[m] = async () => {
			calls.push(m);
			if (state.throwOnControl) throw new Error("boom");
			return state.control;
		};
	}
	client.seek = async (ms: number) => {
		calls.push(`seek:${ms}`);
		return state.control;
	};
	let changes = 0;
	const poller = new SpotifyPoller({
		client,
		now: () => clock,
		setTimer: (fn, ms) => {
			const t = { id: nextId++, fn, at: clock + ms, cleared: false };
			timers.push(t);
			return t.id;
		},
		clearTimer: (h) => {
			const t = timers.find((x) => x.id === h);
			if (t) t.cleared = true;
		},
		onChange: () => {
			changes++;
		},
		visibleWindowMs: opts.visibleWindowMs ?? 1e9,
	});
	const live = () => timers.filter((t) => !t.cleared);
	/** Fire the earliest live timer, advancing the clock to it, then flush microtasks. */
	const fire = async () => {
		const t = live().sort((a, b) => a.at - b.at)[0];
		assert.ok(t, "expected a pending timer");
		t.cleared = true;
		clock = Math.max(clock, t.at);
		t.fn();
		for (let i = 0; i < 6; i++) await Promise.resolve();
	};
	return { poller, state, calls, live, fire, setClock: (v: number) => (clock = v), getClock: () => clock, changes: () => changes };
}

test("poller - no timer and no network until the card touches it", async () => {
	const h = harness();
	assert.equal(h.live().length, 0);
	assert.equal(h.state.pollCount, 0);
	h.poller.touch();
	assert.equal(h.live().length, 1);
	assert.equal(h.state.pollCount, 0);
	await h.fire();
	assert.equal(h.state.pollCount, 1);
	assert.equal(h.poller.getView().status, "playing");
	assert.equal(h.poller.getView().playback?.track?.id, "t1");
});

test("poller - polls every 2s while playing and every 5s otherwise", async () => {
	const h = harness({ results: [{ ok: true, value: pb({ isPlaying: true }) }, { ok: true, value: pb({ isPlaying: false }) }] });
	h.poller.touch();
	await h.fire();
	assert.equal(h.live()[0].at - h.getClock(), 2000);
	h.poller.touch();
	await h.fire();
	assert.equal(h.poller.getView().status, "paused");
	assert.equal(h.live()[0].at - h.getClock(), 5000);
});

test("poller - pauses polling when the card stops touching it, resumes on touch", async () => {
	const h = harness({ visibleWindowMs: 3000 });
	h.poller.touch();
	await h.fire();
	assert.equal(h.live().length, 1);
	h.setClock(10_000);
	await h.fire();
	assert.equal(h.state.pollCount, 1, "the stale tick must not poll");
	assert.equal(h.live().length, 0, "no timer runs while hidden");
	h.poller.touch();
	assert.equal(h.live().length, 1);
});

test("poller - idle when nothing plays (null playback)", async () => {
	const h = harness({ results: [{ ok: true, value: null }] });
	h.poller.touch();
	await h.fire();
	const v = h.poller.getView();
	assert.equal(v.status, "idle");
	assert.equal(v.playback, null);
	assert.equal(h.live()[0].at - h.getClock(), 5000);
});

test("poller - network errors back off exponentially up to 30s and recover", async () => {
	const h = harness({ results: [{ ok: false, error: { kind: "network" } }] });
	const delays: number[] = [];
	for (let i = 0; i < 7; i++) {
		h.poller.touch();
		await h.fire();
		delays.push(h.live()[0].at - h.getClock());
	}
	assert.deepEqual(delays.slice(0, 3), [4000, 8000, 16000]);
	assert.equal(delays[6], 30000);
	assert.ok(delays.every((d) => d <= 30000));
	assert.equal(h.poller.getView().status, "error");
	assert.equal(h.poller.getView().error?.kind, "network");
	h.state.results = [{ ok: true, value: pb() }];
	h.poller.touch();
	await h.fire();
	assert.equal(h.poller.getView().status, "playing");
	assert.equal(h.live()[0].at - h.getClock(), 2000);
});

test("poller - http errors also back off; rate-limit honours retryAfterMs", async () => {
	const h = harness({ results: [{ ok: false, error: { kind: "http", status: 500 } }] });
	h.poller.touch();
	await h.fire();
	assert.equal(h.live()[0].at - h.getClock(), 4000);
	const r = harness({ results: [{ ok: false, error: { kind: "rate-limited", retryAfterMs: 12_000 } }] });
	r.poller.touch();
	await r.fire();
	assert.equal(r.live()[0].at - r.getClock(), 12_000);
	assert.equal(r.poller.getView().error?.kind, "rate-limited");
});

test("poller - needs-client-id and needs-login never hit the network", async () => {
	const a = harness({ clientId: undefined });
	a.poller.touch();
	await a.fire();
	assert.equal(a.poller.getView().status, "needs-client-id");
	assert.equal(a.state.pollCount, 0);

	const b = harness({ connected: false });
	b.poller.touch();
	await b.fire();
	assert.equal(b.poller.getView().status, "needs-login");
	assert.equal(b.state.pollCount, 0);
});

test("poller - a login that completes in the meantime triggers a poll on the next check", async () => {
	const h = harness({ connected: false });
	h.poller.touch();
	await h.fire();
	assert.equal(h.poller.getView().status, "needs-login");
	h.state.connected = true;
	await h.fire();
	assert.equal(h.state.pollCount, 1);
	assert.equal(h.poller.getView().status, "playing");
});

test("poller - not-connected from the API maps to needs-login", async () => {
	const h = harness({ results: [{ ok: false, error: { kind: "not-connected" } }] });
	h.poller.touch();
	await h.fire();
	assert.equal(h.poller.getView().status, "needs-login");
});

test("displayProgressMs - interpolates while playing, clamps to [0,duration], static when paused", async () => {
	const h = harness();
	h.poller.touch();
	await h.fire();
	h.setClock(1500);
	assert.equal(h.poller.displayProgressMs(), 11_500);
	h.setClock(1_000_000);
	assert.equal(h.poller.displayProgressMs(), 200_000);

	const p = harness({ results: [{ ok: true, value: pb({ isPlaying: false, progressMs: 42_000 }) }] });
	p.poller.touch();
	await p.fire();
	p.setClock(50_000);
	assert.equal(p.poller.displayProgressMs(), 42_000);

	const n = harness({ results: [{ ok: true, value: null }] });
	assert.equal(n.poller.displayProgressMs(), 0);
});

test("control - toggle is optimistic, calls pause/play and schedules a refresh ~400ms later", async () => {
	const h = harness();
	h.poller.touch();
	await h.fire();
	await h.poller.control("toggle");
	assert.deepEqual(h.calls, ["pause"]);
	assert.equal(h.poller.getView().status, "paused");
	assert.equal(h.poller.getView().playback?.isPlaying, false);
	assert.equal(h.live().length, 1);
	assert.equal(h.live()[0].at - h.getClock(), 400);
	await h.poller.control("toggle");
	assert.deepEqual(h.calls, ["pause", "play"]);
	assert.equal(h.poller.getView().status, "playing");
});

test("control - seek sets progress optimistically; next/previous reset it", async () => {
	const h = harness();
	h.poller.touch();
	await h.fire();
	await h.poller.control({ seek: 90_000 });
	assert.deepEqual(h.calls, ["seek:90000"]);
	assert.equal(h.poller.displayProgressMs(), 90_000);
	await h.poller.control("next");
	assert.equal(h.poller.displayProgressMs(), 0);
	await h.poller.control({ seek: 5000 });
	await h.poller.control("previous");
	assert.deepEqual(h.calls.slice(-2), ["seek:5000", "previous"]);
	assert.equal(h.poller.displayProgressMs(), 0);
});

test("control - failures surface a 5s notice (premium-required, no-device) and still refresh", async () => {
	const h = harness();
	h.poller.touch();
	await h.fire();
	h.state.control = { ok: false, error: { kind: "premium-required" } };
	await h.poller.control("next");
	const n = h.poller.getView().notice;
	assert.ok(n);
	assert.match(n.text, /Premium/);
	assert.equal(n.type, "warning");
	assert.equal(n.until, h.getClock() + 5000);
	assert.equal(h.live()[0].at - h.getClock(), 400);
	h.setClock(h.getClock() + 5001);
	assert.equal(h.poller.getView().notice, undefined);

	h.state.control = { ok: false, error: { kind: "no-device" } };
	await h.poller.control("play");
	assert.match(h.poller.getView().notice!.text, /dispositivo/);
});

test("control - a rejecting client never throws and produces a notice", async () => {
	const h = harness();
	h.poller.touch();
	await h.fire();
	h.state.throwOnControl = true;
	await h.poller.control("pause");
	assert.ok(h.poller.getView().notice);
});

test("dispose - clears timers and ignores late poll results", async () => {
	const h = harness();
	h.poller.touch();
	const t = h.live()[0];
	t.cleared = true;
	t.fn();
	h.poller.dispose();
	for (let i = 0; i < 6; i++) await Promise.resolve();
	assert.equal(h.live().length, 0);
	assert.equal(h.poller.getView().playback, null, "late result must be ignored");
	const before = h.changes();
	h.poller.touch();
	await h.poller.control("next");
	assert.equal(h.live().length, 0);
	assert.equal(h.changes(), before);
});
