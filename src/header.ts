import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { solviPalette } from "./solvi-theme.ts";
import { formatTokenCount, getContextThreshold } from "./solvi-metrics.ts";
import { shortModelName } from "./footer/footer-formatters.ts";
import { footerRegistry } from "./footer/footer-registry.ts";
import { cleanDynamicPoolLabel, getCachedAccounts, getQuotaThreshold, triggerUsageRefresh } from "./solvi-usage.ts";

// Top of the transcript: path on the left, git branch on the right; model, tokens, context %
// and (when there's room) the 5h/weekly plan limits on the line below.
class WorkspaceHeader implements Component {
	private readonly ctx: ExtensionContext;
	private readonly theme: any;
	private readonly tui?: TUI;

	constructor(ctx: ExtensionContext, theme: any, tui?: TUI) {
		this.ctx = ctx;
		this.theme = theme;
		this.tui = tui;
	}

	private renderLimits(): string {
		triggerUsageRefresh(this.ctx, this.tui as any, 15000);
		const account = getCachedAccounts()?.[0];
		if (!account) return "";

		const parts: string[] = [];
		for (const label of ["5h", "Semanal"] as const) {
			const pool = account.pools.find((p) => cleanDynamicPoolLabel(p.label) === label);
			if (!pool) continue;
			const threshold = getQuotaThreshold(pool.availablePercent, solviPalette(this.theme));
			parts.push(`${this.theme.fg("dim", `${label} `)}${threshold.color(`${Math.round(pool.availablePercent)}%`)}`);
		}
		if (parts.length === 0) return "";
		return `${this.theme.fg("dim", "Límite: ")}${parts.join(this.theme.fg("dim", " | "))}`;
	}

	render(width: number): string[] {
		const cwd = (this.ctx.cwd ?? process.cwd()).replace(homedir(), "~");
		const branch = footerRegistry.latestFooterData?.getGitBranch() || "no-git";
		const left = this.theme.fg("text", cwd);
		const right = this.theme.fg("muted", `⎇ ${branch}`);
		const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
		const pathLine = truncateToWidth(`${left}${" ".repeat(gap)}${right}`, Math.max(0, width));

		const usage = this.ctx.getContextUsage?.();
		const contextWindow = usage?.contextWindow ?? this.ctx.model?.contextWindow ?? 128_000;
		const tokens = usage?.tokens ?? 0;
		const rawPercent = usage?.percent ?? (contextWindow > 0 ? (tokens / contextWindow) * 100 : 0);
		const percent = Math.max(0, Math.min(100, rawPercent));
		const threshold = getContextThreshold(percent, solviPalette(this.theme));
		const model = shortModelName(this.ctx.model?.id ?? "no-model");
		const modelStr = `${this.theme.fg("accent", model)}  ${this.theme.fg("dim", "·")}  ${threshold.color(`${formatTokenCount(tokens)} / ${formatTokenCount(contextWindow)} tokens`)}  ${this.theme.fg("dim", "·")}  ${threshold.color(`${threshold.label} ${Math.round(percent)}%`)}`;

		const limitsStr = this.renderLimits();
		let modelLine = modelStr;
		if (limitsStr) {
			const modelLen = visibleWidth(modelStr);
			const limitsLen = visibleWidth(limitsStr);
			const modelGap = width - modelLen - limitsLen;
			// Only append the right-aligned limits when they actually fit with some breathing room.
			if (modelGap >= 2) {
				modelLine = `${modelStr}${" ".repeat(modelGap)}${limitsStr}`;
			}
		}
		return [pathLine, truncateToWidth(modelLine, Math.max(0, width))];
	}

	invalidate(): void {}
}

export function installWorkspaceHeader(ctx: ExtensionContext): void {
	if (!ctx.hasUI || ctx.mode !== "tui") return;
	ctx.ui.setHeader((tui: any, theme: any) => new WorkspaceHeader(ctx, theme, tui));
}
