import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { solviGlyphs, solviPalette, safeFg } from "../solvi-theme.ts";
import { loadSolviColors } from "../solvi-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../solvi-transcript.ts";
import { getCachedAccounts, resolveActiveOrchestratorPrefix } from "../usage/usage-client.ts";
import { buildModelRows, formatModelRow, readEnabledModelPatterns } from "./models-client.ts";

const SETTINGS_TTL_MS = 5000;

/** Lowest available quota percent across the pools of the active account prefix, or undefined when not matchable. */
function activeQuotaPercent(ctx: ExtensionContext): number | undefined {
	const accounts = getCachedAccounts();
	if (!accounts?.length) return undefined;
	const prefix = resolveActiveOrchestratorPrefix(ctx);
	if (!prefix) return undefined;
	const acc = accounts.find((a) => a.prefix === prefix);
	if (!acc?.pools?.length) return undefined;
	const vals = acc.pools.filter((p) => !p.unlimited).map((p) => p.availablePercent);
	return vals.length ? Math.min(...vals) : undefined;
}

/**
 * WorkspaceModelsCard:
 * - STACK tab card listing the models enabled in Pi (`enabledModels` / `/scoped-models`).
 * - Per model: context window, session tokens/cost; active model also shows live context and cached quota.
 * - Recomputed on every render from in-memory session data only (no network).
 */
export class WorkspaceModelsCard implements Component {
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;
	private patterns: string[] | undefined;
	private patternsAt = 0;

	private readonly pi?: ExtensionAPI;
	private selectedIndex: number | undefined = undefined;

	constructor(ctx: ExtensionContext, tui: TUI, theme?: Theme, pi?: ExtensionAPI) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
		this.pi = pi ?? (tui as any)?.__solviPi;
	}

	invalidate(): void {
		this.patternsAt = 0;
		this.tui.requestRender();
	}

	private rows() {
		return buildModelRows(this.ctx, {
			enabledPatterns: this.enabledPatterns(),
			quotaForActive: () => activeQuotaPercent(this.ctx),
		}).rows;
	}

	getSelectedIndex(): number | undefined {
		return this.selectedIndex;
	}

	moveCursor(delta: number): boolean {
		const rows = this.rows();
		if (rows.length === 0) return false;
		let base = this.selectedIndex;
		if (base === undefined) base = Math.max(0, rows.findIndex((r) => r.active));
		this.selectedIndex = (((base + delta) % rows.length) + rows.length) % rows.length;
		this.tui.requestRender();
		return true;
	}

	async activateSelected(): Promise<boolean> {
		const rows = this.rows();
		const index = this.selectedIndex ?? rows.findIndex((r) => r.active);
		return this.activateModelAt(index);
	}

	async activateModelAt(rowIndex: number): Promise<boolean> {
		const row = this.rows()[rowIndex];
		if (!row || typeof this.pi?.setModel !== "function") return false;
		const ctx: any = this.ctx;
		const same = (m: any) => m?.provider === row.provider && m?.id === row.id;
		let target: any;
		const scoped = Array.isArray(ctx?.scopedModels) ? ctx.scopedModels : [];
		for (const s of scoped) {
			const m = s?.model ?? s;
			if (same(m)) {
				target = m;
				break;
			}
		}
		target ??= ctx?.modelRegistry?.find?.(row.provider, row.id);
		target ??= (ctx?.modelRegistry?.getAvailable?.() ?? []).find(same);
		target ??= { provider: row.provider, id: row.id, name: row.name };
		await this.pi.setModel(target);
		this.selectedIndex = rowIndex;
		this.tui.requestRender();
		return true;
	}

	/** Line 0 is the top border; lines 1..rows.length are the model rows. */
	handleClick(localIndex?: number, _button?: string): boolean {
		if (localIndex === undefined || localIndex < 1) return false;
		const rowIndex = localIndex - 1;
		if (rowIndex >= this.rows().length) return false;
		this.selectedIndex = rowIndex;
		void this.activateModelAt(rowIndex).catch(() => {});
		return true;
	}

	handleRailClick(localIndex?: number, button?: string): boolean {
		return this.handleClick(localIndex, button);
	}

	private enabledPatterns(): string[] | undefined {
		const now = Date.now();
		if (now - this.patternsAt > SETTINGS_TTL_MS) {
			this.patterns = readEnabledModelPatterns({ cwd: (this.ctx as any)?.cwd });
			this.patternsAt = now;
		}
		return this.patterns;
	}

	render(width: number): string[] {
		const g = solviGlyphs(this.theme);
		const colors = loadSolviColors();
		const theme = this.theme;
		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4;
		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);
		const c = solviPalette(theme);

		const boxLine = (left: string, right = ""): string => {
			const rightWidth = calcVisibleWidth(right);
			const maxLeftWidth = Math.max(0, innerWidth - (rightWidth > 0 ? rightWidth + 1 : 0));
			const truncatedLeft = truncateAnsiAware(left, maxLeftWidth);
			const pad = " ".repeat(Math.max(0, innerWidth - calcVisibleWidth(truncatedLeft) - rightWidth));
			return `${frame(g.v)} ${truncatedLeft}${pad}${right} ${frame(g.v)}`;
		};

		const titleStr = `${c.pinkAccent(g.brand || "")} ${c.gold("Models")}`;
		const fillTop = Math.max(0, safeWidth - 5 - calcVisibleWidth(titleStr));
		const top = `${frame(`${g.tl}${g.h} `)}${titleStr}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const lines: string[] = [top];
		const result = buildModelRows(this.ctx, {
			enabledPatterns: this.enabledPatterns(),
			quotaForActive: () => activeQuotaPercent(this.ctx),
		});

		if (result.rows.length === 0) {
			lines.push(boxLine(c.dim("Sin modelos habilitados")));
			lines.push(bottom);
			return lines;
		}

		const selected =
			this.selectedIndex === undefined ? undefined : Math.min(this.selectedIndex, result.rows.length - 1);
		result.rows.forEach((row, i) => {
			const f = formatModelRow(row);
			const prefix = i === selected ? `${c.pinkBright("›")} ` : "";
			lines.push(boxLine(prefix + (row.active ? c.mint(f.title) : c.text(f.title))));
		});
		if (result.hidden > 0) {
			lines.push(boxLine(c.dim(`+${result.hidden} más`)));
		}

		lines.push(bottom);
		return lines;
	}
}
