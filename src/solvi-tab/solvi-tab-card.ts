import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { deleteKittyImage } from "@earendil-works/pi-tui";
import { solviGlyphs, safeFg, bolden } from "../solvi-theme.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../solvi-transcript.ts";
import { describeSpotifyError, getSpotifyClient, setupSteps } from "../spotify/spotify-commands.ts";
import { equalizerRow, formatClock, renderProgressBar, truncatePlain, wrapText } from "../spotify/spotify-ascii.ts";
import { SpotifyPoller, type SpotifyClientLike, type SpotifyView } from "../spotify/spotify-state.ts";
import type { ClickableHitbox } from "./solvi-tab-types.ts";

/** Minimal poller surface the card depends on (lets tests inject a stub). */
export interface SolviPollerLike {
	touch(): void;
	getView(): SpotifyView;
	displayProgressMs(): number;
	control(action: "toggle" | "next" | "previous" | { seek: number }): Promise<void>;
	dispose(): void;
}

export interface SolviTabCardDeps {
	client?: SpotifyClientLike;
	poller?: SolviPollerLike;
	now?: () => number;
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
	setTicker?: (fn: () => void, ms: number) => unknown;
	clearTicker?: (handle: unknown) => void;
}

const TICK_MS = 250;
const TICK_IDLE_STOP_MS = 1000;
const INDENT = 2;

const defaultSetTicker = (fn: () => void, ms: number): unknown => {
	const t: any = setInterval(fn, ms);
	t?.unref?.();
	return t;
};
const defaultClearTicker = (h: unknown): void => clearInterval(h as any);

/**
 * "Solvi" sidebar card: an ASCII-style Spotify player (now playing, progress, controls).
 * State comes from a SpotifyPoller that only polls while this card keeps rendering.
 */
export class WorkspaceSolviTabCard {
	private tui: TUI;
	private theme?: Theme;
	private ctx?: any;
	private hitboxes: ClickableHitbox[] = [];
	private activeCoverImageId?: number;
	private readonly poller: SolviPollerLike;
	private readonly now: () => number;
	private readonly setTicker: (fn: () => void, ms: number) => unknown;
	private readonly clearTicker: (handle: unknown) => void;
	private ticker: unknown = null;
	private lastRenderAt = Number.NEGATIVE_INFINITY;

	constructor(tui: TUI, theme?: Theme, ctx?: any, deps: SolviTabCardDeps = {}) {
		this.tui = tui;
		this.theme = theme;
		this.ctx = ctx;
		this.now = deps.now ?? Date.now;
		this.setTicker = deps.setTicker ?? defaultSetTicker;
		this.clearTicker = deps.clearTicker ?? defaultClearTicker;
		this.poller =
			deps.poller ??
			new SpotifyPoller({
				client: deps.client ?? getSpotifyClient,
				now: deps.now,
				setTimer: deps.setTimer,
				clearTimer: deps.clearTimer,
				onChange: () => this.requestRender(),
			});
	}

	private requestRender(): void {
		try {
			this.tui.requestRender();
		} catch {}
	}

	public dispose(): void {
		this.clearCover();
		this.stopTicker();
		try {
			this.poller.dispose();
		} catch {}
	}

	public clearCover(specificId?: number): void {
		const id = specificId ?? this.activeCoverImageId;
		if (id !== undefined) {
			try {
				if (typeof this.tui?.terminal?.write === "function") {
					this.tui.terminal.write(deleteKittyImage(id));
				}
			} catch {}
			if (!specificId || specificId === this.activeCoverImageId) {
				this.activeCoverImageId = undefined;
			}
		}
	}

	public invalidate(): void {}

	public handleRailWheel(_delta: number): boolean {
		return false;
	}

	public handleRailClick(localY: number, _button?: string, localX = 0): boolean {
		const match = this.hitboxes.find((h) => h.line === localY && localX >= h.startX && localX <= h.endX);
		if (match) {
			try {
				if (match.actionAt) match.actionAt(localX);
				else match.action();
			} catch {}
			this.requestRender();
			return true;
		}
		return false;
	}

	private startTicker(): void {
		if (this.ticker !== null) return;
		const handle = this.setTicker(() => {
			if (this.now() - this.lastRenderAt > TICK_IDLE_STOP_MS) {
				this.stopTicker();
				return;
			}
			this.requestRender();
		}, TICK_MS);
		(handle as any)?.unref?.();
		this.ticker = handle;
	}

	private stopTicker(): void {
		if (this.ticker === null) return;
		try {
			this.clearTicker(this.ticker);
		} catch {}
		this.ticker = null;
	}

	private control(action: "toggle" | "next" | "previous" | { seek: number }): void {
		try {
			void this.poller.control(action).catch(() => {});
		} catch {}
	}

	public render(width: number, _availableHeight?: number): string[] {
		try {
			return this.renderInner(width);
		} catch {
			this.hitboxes = [];
			return this.fallbackBox(width);
		}
	}

	private fallbackBox(width: number): string[] {
		const w = Math.max(0, width);
		if (w < 2) return [" ".repeat(w)];
		const g = solviGlyphs(this.theme);
		return [g.tl + g.h.repeat(w - 2) + g.tr, g.v + " ".repeat(w - 2) + g.v, g.bl + g.h.repeat(w - 2) + g.br];
	}

	private renderInner(width: number): string[] {
		this.hitboxes = [];
		const now = this.now();
		this.lastRenderAt = now;
		this.poller.touch();
		const view = this.poller.getView();

		const g = solviGlyphs(this.theme);
		const paint = (key: string, s: string): string => (this.theme ? safeFg(this.theme, key, s) : s);
		const border = (s: string): string => paint("border", s);
		const accent = (s: string): string => paint("accent", s);
		const pink = (s: string): string => paint("pinkBright", s);
		const muted = (s: string): string => paint("muted", s);
		const innerWidth = Math.max(0, width - 2);
		const contentW = Math.max(0, innerWidth - INDENT * 2);
		const margin = " ".repeat(INDENT);

		const boxLine = (content: string): string => {
			const trunc = truncateAnsiAware(content, innerWidth);
			const pad = " ".repeat(Math.max(0, innerWidth - calcVisibleWidth(trunc)));
			return `${border(g.v)}${trunc}${pad}${border(g.v)}`;
		};

		const lines: string[] = [];
		let titleStr = " 🐝 Solvi · Spotify ";
		if (calcVisibleWidth(titleStr) > innerWidth) titleStr = " 🐝 Solvi ";
		if (calcVisibleWidth(titleStr) > innerWidth) titleStr = "";
		const hLine = g.h.repeat(Math.max(0, innerWidth - calcVisibleWidth(titleStr)));
		lines.push(`${border(g.tl)}${accent(bolden(this.theme, titleStr))}${border(hLine)}${border(g.tr)}`);

		const blank = (): void => void lines.push(boxLine(""));
		const text = (styled: string): void => void lines.push(boxLine(margin + styled));
		const wrapped = (s: string, style: (t: string) => string, max = Infinity): void => {
			for (const l of wrapText(s, contentW).slice(0, max)) text(style(l));
		};

		const pbk = view.playback;
		const showPlayer = (view.status === "playing" || view.status === "paused") && pbk !== null;

		if (showPlayer && pbk) {
			const isAd = pbk.itemType === "ad";
			const playing = pbk.isPlaying;
			blank();
			if (contentW >= 12) {
				text(pink(equalizerRow(contentW, now, pbk.track?.id ?? "ad", playing && !isAd)));
				blank();
			}
			if (isAd) {
				text(bolden(this.theme, truncatePlain("Anuncio", contentW)));
				text(muted(truncatePlain("La música vuelve en un momento", contentW)));
			} else {
				text(bolden(this.theme, truncatePlain(pbk.track?.name || "Reproducción en curso", contentW)));
				if (pbk.track?.artists.length) text(truncatePlain(pbk.track.artists.join(", "), contentW));
				if (pbk.track?.album) text(muted(truncatePlain(pbk.track.album, contentW)));
			}
			blank();

			// Progress bar (click = seek).
			const progress = this.poller.displayProgressMs();
			const duration = pbk.durationMs;
			const seekable = !isAd && duration > 0 && contentW >= 6;
			if (contentW > 0) {
				const right = formatClock(duration);
				const left = formatClock(progress).padStart(right.length);
				const withClocks = contentW - left.length - right.length - 2 >= 6;
				const barW = withClocks ? contentW - left.length - right.length - 2 : contentW;
				const bar = renderProgressBar(duration > 0 ? progress / duration : 0, barW);
				const barX = 1 + INDENT + (withClocks ? left.length + 1 : 0);
				const paintedBar = isAd || duration <= 0 ? muted(bar) : accent(bar);
				const row = withClocks ? `${muted(left)} ${paintedBar} ${muted(right)}` : paintedBar;
				if (seekable) {
					const startX = barX;
					const endX = barX + barW - 1;
					this.hitboxes.push({
						line: lines.length,
						startX,
						endX,
						action: () => {},
						actionAt: (x: number) => {
							const offset = Math.min(barW - 1, Math.max(0, x - startX));
							this.control({ seek: Math.round((duration * offset) / Math.max(1, barW - 1)) });
						},
					});
				}
				text(row);
			}
			blank();

			// Controls.
			const buttons: { label: string; action: "toggle" | "next" | "previous"; style: (s: string) => string }[] = [
				{ label: "[ |< ]", action: "previous", style: accent },
				{ label: playing ? "[ || ]" : "[ > ]", action: "toggle", style: (s) => bolden(this.theme, pink(s)) },
				{ label: "[ >| ]", action: "next", style: accent },
			];
			const sum = buttons.reduce((n, b) => n + b.label.length, 0);
			const gap = [4, 2, 1].find((gp) => sum + gp * 2 <= contentW) ?? 1;
			const total = sum + gap * 2;
			let x = 1 + INDENT + Math.max(0, Math.floor((contentW - total) / 2));
			const parts: string[] = [];
			for (const b of buttons) {
				const startX = x;
				const endX = Math.min(width - 2, x + b.label.length - 1);
				if (!isAd && startX <= endX) {
					this.hitboxes.push({ line: lines.length, startX, endX, action: () => this.control(b.action) });
				}
				parts.push(isAd ? muted(b.label) : b.style(b.label));
				x += b.label.length + gap;
			}
			const lead = " ".repeat(Math.max(0, Math.floor((contentW - total) / 2)));
			text(lead + parts.join(" ".repeat(gap)));
			blank();

			// Notice or device info.
			if (view.notice) {
				const key = view.notice.type === "error" ? "error" : "warning";
				wrapped(view.notice.text, (t) => paint(key, t), 2);
			} else {
				const bits: string[] = [];
				if (pbk.device?.name) bits.push(pbk.device.name);
				if (pbk.device) bits.push(`vol ${pbk.device.volumePercent}%`);
				bits.push(`shuffle ${pbk.shuffle ? "on" : "off"}`);
				text(muted(truncatePlain(`♪ ${bits.join(" · ")}`, contentW)));
			}
		} else if (view.status === "needs-client-id") {
			blank();
			const steps = setupSteps().split("\n");
			steps.forEach((step, i) => {
				wrapped(step, (t) => (i === 0 ? paint("warning", bolden(this.theme, t)) : t));
			});
		} else if (view.status === "needs-login") {
			blank();
			wrapped("Spotify no está conectado", (t) => paint("warning", bolden(this.theme, t)));
			blank();
			wrapped("Ejecuta en el chat:", muted);
			wrapped("/spotify login", accent);
		} else if (view.status === "error") {
			blank();
			const d = view.error ? describeSpotifyError(view.error) : { message: "Error de Spotify", type: "error" as const };
			wrapped(d.message, (t) => paint(d.type === "error" ? "error" : "warning", t));
			blank();
			wrapped("Reintentando automáticamente...", muted);
		} else if (!view.loaded) {
			blank();
			wrapped("Conectando con Spotify...", muted);
		} else {
			blank();
			wrapped("Nada sonando", (t) => bolden(this.theme, t));
			blank();
			wrapped("Abre Spotify en algún dispositivo y dale play", muted);
		}

		blank();
		lines.push(`${border(g.bl)}${border(g.h.repeat(innerWidth))}${border(g.br)}`);

		const playingNow = view.status === "playing" && pbk?.itemType !== "ad";
		if (playingNow) this.startTicker();
		else this.stopTicker();
		return lines;
	}
}
