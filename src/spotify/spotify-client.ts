import { refreshAccessToken, SpotifyAuthError, type FetchLike } from "./spotify-auth.ts";
import type { SpotifyToken, TokenStore } from "./spotify-config.ts";

export const API_BASE = "https://api.spotify.com/v1";
const REFRESH_MARGIN_MS = 60_000;

export type SpotifyError =
	| { kind: "no-client-id" }
	| { kind: "not-connected" }
	| { kind: "premium-required" }
	| { kind: "no-device" }
	| { kind: "rate-limited"; retryAfterMs: number }
	| { kind: "unauthorized" }
	| { kind: "network" }
	| { kind: "http"; status: number };

export type SpotifyResult<T> = { ok: true; value: T } | { ok: false; error: SpotifyError };

export interface PlaybackState {
	isPlaying: boolean;
	progressMs: number;
	durationMs: number;
	/** Client clock (ms) when this snapshot was received; use it to interpolate progress. */
	fetchedAt: number;
	itemType: "track" | "episode" | "ad" | "unknown";
	track?: { id: string; name: string; artists: string[]; album: string; uri: string };
	device?: { name: string; type: string; volumePercent: number };
	shuffle: boolean;
	repeat: string;
}

export interface SpotifyClientOptions {
	store: TokenStore;
	clientId?: string;
	fetch?: FetchLike;
	now?: () => number;
}

const fail = (error: SpotifyError): { ok: false; error: SpotifyError } => ({ ok: false, error });

export function normalizePlayback(raw: any, fetchedAt: number): PlaybackState {
	const item = raw?.item ?? null;
	const type = raw?.currently_playing_type;
	let itemType: PlaybackState["itemType"] = "unknown";
	if (type === "ad") itemType = "ad";
	else if (item?.type === "track" || type === "track") itemType = "track";
	else if (item?.type === "episode" || type === "episode") itemType = "episode";
	const state: PlaybackState = {
		isPlaying: Boolean(raw?.is_playing),
		progressMs: Number(raw?.progress_ms ?? 0),
		durationMs: Number(item?.duration_ms ?? 0),
		fetchedAt,
		itemType,
		shuffle: Boolean(raw?.shuffle_state),
		repeat: String(raw?.repeat_state ?? "off"),
	};
	if (item && itemType !== "ad") {
		const isEpisode = itemType === "episode" || Boolean(item.show);
		state.track = {
			id: String(item.id ?? ""),
			name: String(item.name ?? ""),
			artists: isEpisode
				? item.show?.publisher
					? [String(item.show.publisher)]
					: []
				: Array.isArray(item.artists)
					? item.artists.map((a: any) => String(a?.name ?? ""))
					: [],
			album: String((isEpisode ? item.show?.name : item.album?.name) ?? ""),
			uri: String(item.uri ?? ""),
		};
	}
	if (raw?.device) {
		state.device = {
			name: String(raw.device.name ?? ""),
			type: String(raw.device.type ?? ""),
			volumePercent: Number(raw.device.volume_percent ?? 0),
		};
	}
	return state;
}

export class SpotifyClient {
	readonly clientId: string | undefined;
	private readonly store: TokenStore;
	private readonly fetchFn: FetchLike;
	private readonly now: () => number;
	private refreshing: Promise<SpotifyResult<SpotifyToken>> | null = null;

	constructor(opts: SpotifyClientOptions) {
		this.store = opts.store;
		this.clientId = opts.clientId;
		this.fetchFn = opts.fetch ?? (fetch as FetchLike);
		this.now = opts.now ?? Date.now;
	}

	isConnected(): boolean {
		return this.store.load() !== null;
	}

	async getPlayback(): Promise<SpotifyResult<PlaybackState | null>> {
		const res = await this.request("GET", "/me/player?additional_types=episode");
		if (!res.ok) return res;
		if (res.value.status === 204) return { ok: true, value: null };
		const text = await safeText(res.value);
		if (!text.trim()) return { ok: true, value: null };
		try {
			return { ok: true, value: normalizePlayback(JSON.parse(text), this.now()) };
		} catch {
			return fail({ kind: "http", status: res.value.status });
		}
	}

	play() {
		return this.control("PUT", "/me/player/play");
	}
	pause() {
		return this.control("PUT", "/me/player/pause");
	}
	next() {
		return this.control("POST", "/me/player/next");
	}
	previous() {
		return this.control("POST", "/me/player/previous");
	}
	seek(positionMs: number) {
		const ms = Math.max(0, Math.round(positionMs));
		return this.control("PUT", `/me/player/seek?position_ms=${ms}`);
	}

	private async control(method: string, path: string): Promise<SpotifyResult<void>> {
		const res = await this.request(method, path);
		return res.ok ? { ok: true, value: undefined } : res;
	}

	private async refresh(token: SpotifyToken): Promise<SpotifyResult<SpotifyToken>> {
		if (!this.refreshing) {
			this.refreshing = this.doRefresh(token).finally(() => {
				this.refreshing = null;
			});
		}
		return this.refreshing;
	}

	private async doRefresh(token: SpotifyToken): Promise<SpotifyResult<SpotifyToken>> {
		try {
			const next = await refreshAccessToken({
				clientId: this.clientId as string,
				refreshToken: token.refreshToken,
				previousScope: token.scope,
				fetch: this.fetchFn,
				now: this.now,
			});
			this.store.save(next);
			return { ok: true, value: next };
		} catch (err) {
			if (err instanceof SpotifyAuthError) {
				if (err.code === "invalid_grant") {
					this.store.clear();
					return fail({ kind: "not-connected" });
				}
				return fail({ kind: "unauthorized" });
			}
			return fail({ kind: "network" });
		}
	}

	private async request(method: string, path: string): Promise<SpotifyResult<Response>> {
		if (!this.clientId) return fail({ kind: "no-client-id" });
		let token = this.store.load();
		if (!token) return fail({ kind: "not-connected" });
		if (token.expiresAt - this.now() < REFRESH_MARGIN_MS) {
			const r = await this.refresh(token);
			if (!r.ok) return r;
			token = r.value;
		}
		let retried = false;
		for (;;) {
			let res: Response;
			try {
				res = await this.fetchFn(API_BASE + path, { method, headers: { Authorization: `Bearer ${token.accessToken}` } });
			} catch {
				return fail({ kind: "network" });
			}
			if (res.status === 401 && !retried) {
				retried = true;
				const r = await this.refresh(token);
				if (!r.ok) return r;
				token = r.value;
				continue;
			}
			return this.classify(res);
		}
	}

	private async classify(res: Response): Promise<SpotifyResult<Response>> {
		if (res.ok) return { ok: true, value: res };
		if (res.status === 401) return fail({ kind: "unauthorized" });
		if (res.status === 429) {
			const secs = Number(res.headers.get("Retry-After"));
			return fail({ kind: "rate-limited", retryAfterMs: (Number.isFinite(secs) && secs > 0 ? secs : 1) * 1000 });
		}
		let reason = "";
		try {
			reason = String(JSON.parse(await safeText(res))?.error?.reason ?? "");
		} catch {
			// body is not JSON
		}
		if (res.status === 403 && reason === "PREMIUM_REQUIRED") return fail({ kind: "premium-required" });
		if (res.status === 404 && reason === "NO_ACTIVE_DEVICE") return fail({ kind: "no-device" });
		return fail({ kind: "http", status: res.status });
	}
}

async function safeText(res: Response): Promise<string> {
	try {
		return await res.text();
	} catch {
		return "";
	}
}
