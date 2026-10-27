import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
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

	constructor(ctx: ExtensionContext, tui: TUI, theme?: Theme) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
	}

	invalidate(): void {
		this.patternsAt = 0;
		this.tui.requestRender();
	}

	handleClick(_localIndex?: number, _button?: string): boolean {
		return false;
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

		for (const row of result.rows) {
			const f = formatModelRow(row);
			const name = row.active ? c.mint(f.title) : c.text(f.title);
			lines.push(boxLine(name, c.dim(f.right)));
			lines.push(boxLine(c.muted(f.detail)));
			if (f.bar) {
				const paint = f.bar.level === "high" ? c.coral : f.bar.level === "warn" ? c.yellow : c.mint;
				lines.push(boxLine(`  ${paint(f.bar.text)} ${c.dim(f.bar.label)}`));
			}
			if (f.extra) lines.push(boxLine(c.gold(f.extra)));
		}
		if (result.hidden > 0) {
			lines.push(boxLine(c.dim(`+${result.hidden} más`)));
		}

		lines.push(bottom);
		return lines;
	}
}
