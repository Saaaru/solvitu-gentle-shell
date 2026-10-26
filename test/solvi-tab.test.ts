import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { WorkspaceSolviTabCard, computeCoverColumns } from "../src/solvi-tab.ts";
import type { PlaybackState } from "../src/spotify/spotify-client.ts";

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function pb(over: Partial<PlaybackState> = {}): PlaybackState {
	return {
		isPlaying: true,
		progressMs: 83_000,
		durationMs: 225_000,
		fetchedAt: 0,
		itemType: "track",
		track: { id: "t1", name: "Bohemian Rhapsody", artists: ["Queen", "David Bowie"], album: "A Night at the Opera", uri: "spotify:track:t1" },
		device: { name: "Mi PC", type: "Computer", volumePercent: 60 },
		shuffle: false,
		repeat: "off",
		...over,
	};
}

function stubPoller(view: any) {
	const controls: any[] = [];
	return {
		controls,
		touch: () => {},
		getView: () => ({ loaded: true, playback: null, ...view }),
		displayProgressMs: () => view.playback?.progressMs ?? 0,
		control: async (a: any) => {
			controls.push(a);
		},
		dispose: () => {},
	};
}

const fakeTheme: any = {
	fg: (_k: string, s: string) => `\x1b[38;5;1m${s}\x1b[39m`,
	bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
};
const mockTui: any = { requestRender: () => {} };
const noTimers = { setTicker: () => 0, clearTicker: () => {} };

function makeCard(view: any, theme?: any) {
	const poller = stubPoller(view);
	const card = new WorkspaceSolviTabCard(mockTui, theme, undefined, { poller: poller as any, ...noTimers });
	return { card, poller };
}

const STATES: Record<string, any> = {
	playing: { status: "playing", playback: pb() },
	paused: { status: "paused", playback: pb({ isPlaying: false }), notice: { text: "Spotify Premium requerido para controlar la reproducción", type: "warning", until: 9e9 } },
	"needs-client-id": { status: "needs-client-id" },
	"needs-login": { status: "needs-login" },
	idle: { status: "idle" },
	ad: { status: "playing", playback: pb({ itemType: "ad", track: undefined }) },
	error: { status: "error", error: { kind: "network" } },
	"long-title": { status: "playing", playback: pb({ track: { id: "x", name: "Un título larguísimo ".repeat(6), artists: ["Artista ".repeat(10)], album: "Álbum ".repeat(9), uri: "" } }) },
	"no-device-info": { status: "playing", playback: pb({ device: undefined, durationMs: 0 }) },
};

test("WorkspaceSolviTabCard - every state renders exactly `width` columns, with and without theme", () => {
	for (const [name, view] of Object.entries(STATES)) {
		for (const width of [30, 44, 49, 52]) {
			for (const theme of [undefined, fakeTheme]) {
				const { card } = makeCard(view, theme);
				const lines = card.render(width, 40);
				assert.ok(lines.length >= 4, `${name}: too few lines`);
				assert.ok(strip(lines[0]).includes("Solvi"), `${name}: title`);
				for (const [i, line] of lines.entries()) {
					assert.equal(visibleWidth(line), width, `${name} w=${width} theme=${!!theme} line ${i}: ${JSON.stringify(strip(line))}`);
				}
				card.dispose();
			}
		}
	}
});

test("WorkspaceSolviTabCard - state specific content", () => {
	const text = (name: string) => strip(makeCard(STATES[name]).card.render(52, 40).join("\n"));
	assert.match(text("playing"), /Bohemian Rhapsody/);
	assert.match(text("playing"), /Queen, David Bowie/);
	assert.match(text("playing"), /A Night at the Opera/);
	assert.match(text("playing"), /1:23/);
	assert.match(text("playing"), /3:45/);
	assert.match(text("playing"), /\[ \|\| \]/);
	assert.match(text("playing"), /Mi PC/);
	assert.match(text("playing"), /vol 60%/);
	assert.match(text("paused"), /\[ > \]/);
	assert.match(text("paused"), /Premium/);
	assert.match(text("needs-client-id"), /\/spotify client <id>/);
	assert.match(text("needs-client-id"), /developer\.spotify\.com/);
	assert.match(text("needs-login"), /\/spotify login/);
	assert.match(text("idle"), /Nada sonando/);
	assert.match(text("ad"), /Anuncio/);
	assert.match(text("error"), /red/);
});

test("WorkspaceSolviTabCard - playing hitboxes line up with the drawn buttons and the seek bar", () => {
	const { card } = makeCard(STATES.playing);
	const lines = card.render(49, 40).map(strip);
	const hb = (card as any).hitboxes as { line: number; startX: number; endX: number }[];
	assert.equal(hb.length, 4);
	const ctrlLine = lines.findIndex((l) => l.includes("[ |< ]"));
	const find = (token: string) => {
		const x = lines[ctrlLine].indexOf(token);
		return { startX: x, endX: x + token.length - 1 };
	};
	const expected = [find("[ |< ]"), find("[ || ]"), find("[ >| ]")];
	for (const [i, e] of expected.entries()) {
		const h = hb.find((x) => x.line === ctrlLine && x.startX === e.startX);
		assert.ok(h, `button ${i} hitbox`);
		assert.equal(h.endX, e.endX);
	}
	const barLine = lines.findIndex((l) => l.includes("1:23"));
	const seek = hb.find((x) => x.line === barLine);
	assert.ok(seek);
	const row = [...lines[barLine]];
	assert.ok("━●".includes(row[seek.startX]));
	assert.ok("●─━".includes(row[seek.endX]));
	assert.ok(lines[barLine].slice(seek.endX + 1).trimStart().startsWith("3:45"));
});

test("WorkspaceSolviTabCard - non-playing states register no control hitboxes", () => {
	for (const name of ["needs-client-id", "needs-login", "idle", "ad", "error"]) {
		const { card } = makeCard(STATES[name]);
		card.render(49, 40);
		assert.equal((card as any).hitboxes.length, 0, name);
	}
});

test("WorkspaceSolviTabCard - handleRailWheel never consumes the wheel", () => {
	const { card } = makeCard(STATES.playing);
	card.render(49, 40);
	assert.equal(card.handleRailWheel(1), false);
	assert.equal(card.handleRailWheel(-1), false);
	assert.equal(card.handleRailWheel(0), false);
});

function liveCard(first: PlaybackState | null) {
	let clock = 0;
	const timers: { fn: () => void; at: number; cleared: boolean }[] = [];
	const calls: string[] = [];
	const ok = async () => ({ ok: true as const, value: undefined });
	const client: any = {
		clientId: "cid",
		isConnected: () => true,
		getPlayback: async () => ({ ok: true, value: first && { ...first, fetchedAt: clock } }),
		play: async () => (calls.push("play"), ok()),
		pause: async () => (calls.push("pause"), ok()),
		next: async () => (calls.push("next"), ok()),
		previous: async () => (calls.push("previous"), ok()),
		seek: async (ms: number) => (calls.push(`seek:${ms}`), ok()),
	};
	const card = new WorkspaceSolviTabCard(mockTui, undefined, undefined, {
		client,
		now: () => clock,
		setTimer: (fn: () => void, ms: number) => {
			const t = { fn, at: clock + ms, cleared: false };
			timers.push(t);
			return t;
		},
		clearTimer: (h: any) => {
			h.cleared = true;
		},
		...noTimers,
	} as any);
	const settle = async () => {
		const t = timers.find((x) => !x.cleared);
		if (!t) return;
		t.cleared = true;
		t.fn();
		for (let i = 0; i < 10; i++) await Promise.resolve();
	};
	return { card, calls, settle };
}

async function click(card: WorkspaceSolviTabCard, width: number, token: string, offset: number) {
	const lines = card.render(width, 40).map(strip);
	const y = lines.findIndex((x) => x.includes(token));
	assert.ok(y >= 0, token);
	card.handleRailClick(y, "left", lines[y].indexOf(token) + offset);
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

test("WorkspaceSolviTabCard - play/pause click pauses when playing and plays when paused; prev/next call the client", async () => {
	const a = liveCard(pb());
	a.card.render(49, 40);
	await a.settle();
	await click(a.card, 49, "[ || ]", 2);
	assert.deepEqual(a.calls, ["pause"]);
	await click(a.card, 49, "[ |< ]", 1);
	await click(a.card, 49, "[ >| ]", 1);
	assert.deepEqual(a.calls, ["pause", "previous", "next"]);
	a.card.dispose();

	const b = liveCard(pb({ isPlaying: false }));
	b.card.render(49, 40);
	await b.settle();
	await click(b.card, 49, "[ > ]", 2);
	assert.deepEqual(b.calls, ["play"]);
	b.card.dispose();
});

test("WorkspaceSolviTabCard - clicking the progress bar seeks proportionally", async () => {
	const a = liveCard(pb({ isPlaying: false, durationMs: 200_000, progressMs: 0 }));
	a.card.render(49, 40);
	await a.settle();
	a.card.render(49, 40);
	const seek = ((a.card as any).hitboxes as { line: number; startX: number; endX: number }[]).find((h) => h.endX - h.startX > 10)!;
	assert.ok(seek);
	const barW = seek.endX - seek.startX + 1;
	const midOff = Math.round((barW - 1) / 2);
	a.card.handleRailClick(seek.line, "left", seek.startX);
	a.card.handleRailClick(seek.line, "left", seek.endX);
	a.card.handleRailClick(seek.line, "left", seek.startX + midOff);
	for (let i = 0; i < 10; i++) await Promise.resolve();
	assert.equal(a.calls[0], "seek:0");
	assert.equal(a.calls[1], "seek:200000");
	assert.equal(a.calls[2], `seek:${Math.round((200_000 * midOff) / (barW - 1))}`);
	a.card.dispose();
});

test("WorkspaceSolviTabCard - a rejecting client never throws from render or clicks", async () => {
	const boom = async () => {
		throw new Error("boom");
	};
	const client: any = { clientId: "cid", isConnected: () => true, getPlayback: boom, play: boom, pause: boom };
	const card = new WorkspaceSolviTabCard(mockTui, undefined, undefined, { client, ...noTimers } as any);
	assert.doesNotThrow(() => card.render(49, 40));
	assert.doesNotThrow(() => card.handleRailClick(3, "left", 5));
	await new Promise((r) => setTimeout(r, 5));
	assert.doesNotThrow(() => card.render(49, 40));
	card.dispose();
});

test("WorkspaceSolviTabCard - the render ticker runs only while playing and is stopped by dispose", () => {
	let intervals = 0;
	let cleared = 0;
	let tick: (() => void) | undefined;
	let renders = 0;
	let clock = 0;
	const poller = stubPoller({ status: "playing", playback: pb() });
	const card = new WorkspaceSolviTabCard({ requestRender: () => renders++ } as any, undefined, undefined, {
		poller: poller as any,
		now: () => clock,
		setTicker: (fn: () => void) => {
			intervals++;
			tick = fn;
			return 1;
		},
		clearTicker: () => {
			cleared++;
		},
	});
	card.render(49, 40);
	card.render(49, 40);
	assert.equal(intervals, 1, "started once");
	tick!();
	assert.equal(renders, 1);
	clock = 5000; // not rendered for > 1s
	tick!();
	assert.equal(cleared, 1);
	assert.equal(renders, 1);
	card.render(49, 40);
	assert.equal(intervals, 2);
	card.dispose();
	assert.equal(cleared, 2);
});

test("WorkspaceSolviTabCard - clearCover and dispose emit deleteKittyImage to terminal", () => {
	let writes: string[] = [];
	const mockTerminal: any = {
		write: (data: string) => writes.push(data),
	};
	const mockTui: any = {
		terminal: mockTerminal,
		requestRender: () => {},
	};

	const card = new WorkspaceSolviTabCard(mockTui);
	(card as any).activeCoverImageId = 4242;

	card.clearCover();
	assert.ok(writes.some((w) => w.includes("i=4242")), "clearCover debe emitir deleteKittyImage con el ID activo");
	assert.equal((card as any).activeCoverImageId, undefined);

	// dispose también debe ser idempotente
	writes = [];
	(card as any).activeCoverImageId = 9999;
	card.dispose();
	assert.ok(writes.some((w) => w.includes("i=9999")), "dispose debe emitir deleteKittyImage");
});

test("computeCoverColumns - adapts dynamically for 1:1, widescreen 16:9 and invalid dimensions", () => {
	// 1:1 portada cuadrada tradicional de álbum
	assert.equal(computeCoverColumns({ widthPx: 500, heightPx: 500 }), 7);
	assert.equal(computeCoverColumns({ widthPx: 128, heightPx: 128 }), 7);

	// 16:9 widescreen miniatura de video musical en YouTube
	const cols169 = computeCoverColumns({ widthPx: 1280, heightPx: 720 });
	assert.equal(cols169, 12, "Debe calcular 12 columnas para aspect ratio 16:9");

	// 4:3 formato estándar intermedio
	const cols43 = computeCoverColumns({ widthPx: 640, heightPx: 480 });
	assert.equal(cols43, 9, "Debe calcular 9 columnas para aspect ratio 4:3");

	// Fallback para dimensiones ausentes o anómalas
	assert.equal(computeCoverColumns(undefined), 7);
	assert.equal(computeCoverColumns({ widthPx: 0, heightPx: 100 }), 7);
	assert.equal(computeCoverColumns({ widthPx: 100, heightPx: 0 }), 7);
});
