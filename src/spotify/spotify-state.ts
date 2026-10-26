import type { PlaybackState, SpotifyError, SpotifyResult } from "./spotify-client.ts";
import { describeSpotifyError } from "./spotify-commands.ts";

/** Subset of SpotifyClient the poller needs (keeps tests free of the real client). */
export interface SpotifyClientLike {
	readonly clientId: string | undefined;
	isConnected(): boolean;
	getPlayback(): Promise<SpotifyResult<PlaybackState | null>>;
	play(): Promise<SpotifyResult<void>>;
	pause(): Promise<SpotifyResult<void>>;
	next(): Promise<SpotifyResult<void>>;
	previous(): Promise<SpotifyResult<void>>;
	seek(positionMs: number): Promise<SpotifyResult<void>>;
}

export type SpotifyViewStatus = "needs-client-id" | "needs-login" | "idle" | "playing" | "paused" | "error";

export interface SpotifyView {
	status: SpotifyViewStatus;
	playback: PlaybackState | null;
	error?: SpotifyError;
	notice?: { text: string; type: string; until: number };
	/** False until the first poll finished (lets the card show "connecting" instead of "idle"). */
	loaded: boolean;
}

export type SpotifyControl = "play" | "pause" | "toggle" | "next" | "previous" | { seek: number };

export interface SpotifyPollerOptions {
	client: SpotifyClientLike | (() => SpotifyClientLike);
	now?: () => number;
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
	onChange?: () => void;
	visibleWindowMs?: number;
	describe?: (e: SpotifyError) => { message: string; type: string };
}

const PLAYING_MS = 2000;
const IDLE_MS = 5000;
const GATE_RECHECK_MS = 2000;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 30_000;
const REFRESH_AFTER_CONTROL_MS = 400;
const NOTICE_MS = 5000;

const defaultSetTimer = (fn: () => void, ms: number): unknown => {
	const t: any = setTimeout(fn, ms);
	t?.unref?.();
	return t;
};
const defaultClearTimer = (h: unknown): void => clearTimeout(h as any);

/**
 * Polls Spotify playback only while the card is visible (the card calls touch() from render).
 * Pure of TUI concerns: clock and timers are injectable.
 */
export class SpotifyPoller {
	private readonly getClient: () => SpotifyClientLike;
	private readonly now: () => number;
	private readonly setTimer: (fn: () => void, ms: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;
	private readonly onChange: () => void;
	private readonly visibleWindowMs: number;
	private readonly describe: (e: SpotifyError) => { message: string; type: string };

	private timer: unknown = null;
	private lastTouch = Number.NEGATIVE_INFINITY;
	private inFlight = false;
	private disposed = false;
	private failures = 0;
	private playback: PlaybackState | null = null;
	private status: SpotifyViewStatus = "idle";
	private error: SpotifyError | undefined;
	private notice: SpotifyView["notice"];
	private loaded = false;

	constructor(opts: SpotifyPollerOptions) {
		const c = opts.client;
		this.getClient = typeof c === "function" ? c : () => c;
		this.now = opts.now ?? Date.now;
		this.setTimer = opts.setTimer ?? defaultSetTimer;
		this.clearTimer = opts.clearTimer ?? defaultClearTimer;
		this.onChange = opts.onChange ?? (() => {});
		this.visibleWindowMs = opts.visibleWindowMs ?? 3000;
		this.describe = opts.describe ?? describeSpotifyError;
	}

	/** Called by the card on every render: keeps polling alive and re-checks the cheap gates. */
	touch(): void {
		if (this.disposed) return;
		this.lastTouch = this.now();
		const wasGated = this.status === "needs-login" || this.status === "needs-client-id";
		const gate = this.gate();
		if (gate) {
			this.status = gate;
			if (this.timer === null) this.schedule(GATE_RECHECK_MS);
			return;
		}
		if (wasGated) {
			// A login finished in the meantime: poll right away.
			this.schedule(0);
			return;
		}
		if (this.timer === null && !this.inFlight) this.schedule(0);
	}

	getView(): SpotifyView {
		const view: SpotifyView = { status: this.status, playback: this.playback, loaded: this.loaded };
		if (this.error) view.error = this.error;
		if (this.notice && this.notice.until > this.now()) view.notice = this.notice;
		return view;
	}

	displayProgressMs(): number {
		const pb = this.playback;
		if (!pb) return 0;
		let ms = pb.progressMs;
		if (pb.isPlaying) ms += this.now() - pb.fetchedAt;
		const max = pb.durationMs > 0 ? pb.durationMs : Number.POSITIVE_INFINITY;
		return Math.min(max, Math.max(0, ms));
	}

	async control(action: SpotifyControl): Promise<void> {
		if (this.disposed) return;
		const now = this.now();
		this.lastTouch = now;
		const pb = this.playback;
		const progress = this.displayProgressMs();
		let op: "play" | "pause" | "next" | "previous" | "seek";
		let seekMs = 0;
		if (typeof action === "object") {
			op = "seek";
			seekMs = Math.max(0, Math.round(action.seek));
		} else if (action === "toggle") {
			op = pb?.isPlaying ? "pause" : "play";
		} else {
			op = action;
		}
		if (pb) {
			const next: PlaybackState = { ...pb, fetchedAt: now, progressMs: progress };
			if (op === "play") next.isPlaying = true;
			else if (op === "pause") next.isPlaying = false;
			else if (op === "seek") next.progressMs = pb.durationMs > 0 ? Math.min(pb.durationMs, seekMs) : seekMs;
			else next.progressMs = 0;
			this.playback = next;
			this.status = this.statusOf(next);
		}
		this.onChange();

		let res: SpotifyResult<void>;
		try {
			const client = this.getClient();
			res = op === "seek" ? await client.seek(seekMs) : await client[op]();
		} catch {
			res = { ok: false, error: { kind: "network" } };
		}
		if (this.disposed) return;
		if (!res.ok) {
			const d = this.describe(res.error);
			this.notice = { text: d.message, type: d.type, until: this.now() + NOTICE_MS };
		}
		this.schedule(REFRESH_AFTER_CONTROL_MS);
		this.onChange();
	}

	dispose(): void {
		this.disposed = true;
		this.cancel();
	}

	// ---- internals ----

	private statusOf(pb: PlaybackState | null): SpotifyViewStatus {
		if (!pb) return "idle";
		return pb.isPlaying ? "playing" : "paused";
	}

	private gate(): "needs-client-id" | "needs-login" | null {
		let client: SpotifyClientLike;
		try {
			client = this.getClient();
			if (!client.clientId) return "needs-client-id";
			return client.isConnected() ? null : "needs-login";
		} catch {
			return "needs-login";
		}
	}

	private visible(): boolean {
		return this.now() - this.lastTouch <= this.visibleWindowMs;
	}

	private cancel(): void {
		if (this.timer !== null) {
			try {
				this.clearTimer(this.timer);
			} catch {}
			this.timer = null;
		}
	}

	private schedule(ms: number): void {
		if (this.disposed) return;
		this.cancel();
		const handle = this.setTimer(() => this.tick(), ms);
		(handle as any)?.unref?.();
		this.timer = handle;
	}

	private tick(): void {
		this.timer = null;
		if (this.disposed || !this.visible()) return;
		const gate = this.gate();
		if (gate) {
			const changed = this.status !== gate;
			this.status = gate;
			this.schedule(GATE_RECHECK_MS);
			if (changed) this.onChange();
			return;
		}
		void this.poll();
	}

	private async poll(): Promise<void> {
		if (this.inFlight) return;
		this.inFlight = true;
		let res: SpotifyResult<PlaybackState | null>;
		try {
			res = await this.getClient().getPlayback();
		} catch {
			res = { ok: false, error: { kind: "network" } };
		}
		this.inFlight = false;
		if (this.disposed) return;
		this.loaded = true;
		let delay: number;
		if (res.ok) {
			this.failures = 0;
			this.error = undefined;
			this.playback = res.value;
			this.status = this.statusOf(res.value);
			delay = res.value?.isPlaying ? PLAYING_MS : IDLE_MS;
		} else {
			const e = res.error;
			this.error = e;
			if (e.kind === "not-connected") {
				this.status = "needs-login";
				delay = GATE_RECHECK_MS;
			} else if (e.kind === "no-client-id") {
				this.status = "needs-client-id";
				delay = GATE_RECHECK_MS;
			} else {
				this.status = "error";
				if (e.kind === "rate-limited") {
					delay = Math.max(1000, e.retryAfterMs);
				} else if (e.kind === "network" || e.kind === "http") {
					this.failures++;
					delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.failures);
				} else {
					delay = IDLE_MS;
				}
			}
		}
		if (this.visible()) this.schedule(delay);
		this.onChange();
	}
}
