import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { deleteKittyImage } from "@earendil-works/pi-tui";
import { solviGlyphs, safeFg, bolden } from "../solvi-theme.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../solvi-transcript.ts";
import { YOUTUBE_PLAYER_SYMBOL, type ClickableHitbox } from "./solvi-tab-types.ts";

/**
 * "Solvi" sidebar card. The YouTube Music player UI (cover, scrubber, queue) is parked
 * for now, pending a decision on what this tab becomes; it renders a placeholder.
 * Player subscription plumbing (getPlayer/dispose) stays wired for a future revival.
 */
export class WorkspaceSolviTabCard {
	private tui: TUI;
	private theme?: Theme;
	private ctx?: any;
	private hitboxes: ClickableHitbox[] = [];
	private unsubscribe?: () => void;
	private activeCoverImageId?: number;

	// Estado de acordeones modulares (expandido/colapsado)
	public sections = {
		nowPlaying: true,
		queue: true,
	};
	public queueScrollOffset = 0;

	constructor(tui: TUI, theme?: Theme, ctx?: any) {
		this.tui = tui;
		this.theme = theme;
		this.ctx = ctx;
		this.ensureSubscribed();
	}

	private ensureSubscribed(): void {
		if (this.unsubscribe) return;
		const player = this.getPlayer();
		if (player && typeof player.on === "function") {
			this.unsubscribe = player.on("stateChange", () => {
				this.tui.requestRender();
			});
		}
	}

	public dispose(): void {
		this.clearCover();
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = undefined;
		}
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

	private getPlayer(): any {
		return (globalThis as any)[YOUTUBE_PLAYER_SYMBOL];
	}

	public handleRailWheel(delta: number): boolean {
		if (delta === 0) return false;
		const player = this.getPlayer();
		const state = player?.getState?.();
		const queue = Array.isArray(state?.queue) ? state.queue : [];
		if (queue.length <= 10) return false;

		const maxOffset = Math.max(0, queue.length - 10);
		const newOffset = Math.max(0, Math.min(maxOffset, this.queueScrollOffset + (delta > 0 ? 1 : -1)));
		if (newOffset !== this.queueScrollOffset) {
			this.queueScrollOffset = newOffset;
			this.tui.requestRender();
			return true;
		}
		return false;
	}

	public handleRailClick(localY: number, _button?: string, localX = 0): boolean {
		const match = this.hitboxes.find(
			(h) => h.line === localY && localX >= h.startX && localX <= h.endX
		);
		if (match) {
			match.action();
			this.tui.requestRender();
			return true;
		}
		return false;
	}

	public render(width: number, _availableHeight?: number): string[] {
		this.hitboxes = [];
		const g = solviGlyphs(this.theme);
		const border = (s: string): string => (this.theme ? safeFg(this.theme, "border", s) : s);
		const accent = (s: string): string => (this.theme ? safeFg(this.theme, "accent", s) : s);
		const pinkBright = (s: string): string => (this.theme ? safeFg(this.theme, "pinkBright", s) : s);
		const muted = (s: string): string => (this.theme ? safeFg(this.theme, "muted", s) : s);
		const innerWidth = width - 2;

		const boxLine = (content: string, right = ""): string => {
			const rightW = calcVisibleWidth(right);
			const maxContentW = Math.max(0, innerWidth - (rightW > 0 ? rightW + 1 : 0));
			const truncContent = truncateAnsiAware(content, maxContentW);
			const contentW = calcVisibleWidth(truncContent);
			const padLen = Math.max(0, innerWidth - contentW - rightW);
			const pad = " ".repeat(padLen);
			return `${border(g.v)}${truncContent}${pad}${right}${border(g.v)}`;
		};

		// Placeholder: the player UI below is parked while we figure out what this tab becomes.
		this.clearCover();
		const titleStr = " 🐝 Solvi ";
		const hLine = g.h.repeat(Math.max(0, width - 2 - calcVisibleWidth(titleStr)));
		const lines: string[] = [`${border(g.tl)}${accent(bolden(this.theme, titleStr))}${border(hLine)}${border(g.tr)}`];
		const art = [
			"⠀⡠⢄⣎⡱⡠⢄⠀⡰⡭⣵⣀",
			"⠀⠈⠁⠫⡝⠈⣁⠀⠙⠉⠋",
			"⠀⠀⠀⠀⡧⠊⠐⠁",
		];
		lines.push(boxLine(""));
		for (const row of art) {
			const pad = Math.max(0, Math.floor((innerWidth - calcVisibleWidth(row)) / 2));
			lines.push(boxLine(`${" ".repeat(pad)}${pinkBright(row)}`));
		}
		lines.push(boxLine(""));
		lines.push(boxLine(`  ${muted("Por definir todavía...")}`));
		lines.push(boxLine(""));
		lines.push(`${border(g.bl)}${border(g.h.repeat(Math.max(0, width - 2)))}${border(g.br)}`);
		return lines;
	}
}
