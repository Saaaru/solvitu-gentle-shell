import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { solviPalette } from "./solvi-theme.ts";
import { formatTokenCount, getContextThreshold } from "./solvi-metrics.ts";
import { shortModelName } from "./footer/footer-formatters.ts";
import { footerRegistry } from "./footer/footer-registry.ts";
import { cleanDynamicPoolLabel, getCachedAccounts, getQuotaThreshold, triggerUsageRefresh } from "./solvi-usage.ts";

// Single line below the input: model, tokens/context window, threshold label and the
// 5h/weekly plan limits share the row with the extension statuses (Permissions, engram...).
// The header above keeps only the path and the git branch.
export class WorkspaceStatuses implements Component {
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

	private renderMetrics(width: number): string {
		const usage = this.ctx.getContextUsage?.();
		const contextWindow = usage?.contextWindow ?? this.ctx.model?.contextWindow ?? 128_000;
		const tokens = usage?.tokens ?? 0;
		const rawPercent = usage?.percent ?? (contextWindow > 0 ? (tokens / contextWindow) * 100 : 0);
		const percent = Math.max(0, Math.min(100, rawPercent));
		const threshold = getContextThreshold(percent, solviPalette(this.theme));
		const dim = (s: string) => this.theme.fg("dim", s);

		const model = shortModelName(this.ctx.model?.id ?? "no-model");
		const core = [
			`${this.theme.fg("accent", model)}`,
			`${threshold.color(`${formatTokenCount(tokens)} / ${formatTokenCount(contextWindow)} tokens`)}`,
			`${threshold.color(`${threshold.label} ${Math.round(percent)}%`)}`,
		];
		// Degrade from the end: limits go before the core metrics ever do; the model always stays.
		const optional = [this.renderLimits()];
		const sep = (s: string) => `${dim("·")} ${s}`;
		let line = core.join(`  ${dim("·")}  `);
		for (const part of optional) {
			if (!part) continue;
			const candidate = `${line}  ${sep(part)}`;
			if (visibleWidth(candidate) > Math.max(0, width)) break;
			line = candidate;
		}
		return line;
	}

	render(width: number): string[] {
		const statuses = footerRegistry.latestFooterData?.getExtensionStatuses?.();
		const statusTexts: string[] = [];
		if (statuses) {
			for (const text of statuses.values()) {
				if (!text || text.trim().length === 0) continue;
				statusTexts.push(this.theme.fg("muted", text.trim()));
			}
		}

		const dim = (s: string) => this.theme.fg("dim", s);
		const metrics = this.renderMetrics(width);
		const all = [metrics, ...statusTexts.map((status) => `${dim("·")} ${status}`)];

		// Drop statuses first on narrow terminals, then keep whatever fits of the metrics row.
		let line = all.join("  ");
		while (all.length > 1 && visibleWidth(line) > Math.max(0, width)) {
			all.pop();
			line = all.join("  ");
		}
		return [truncateToWidth(line, Math.max(0, width), "…")];
	}

	invalidate(): void {}
}

export function installWorkspaceStatuses(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setWidget(
		"workspace-statuses",
		(tui: any, theme: any) => new WorkspaceStatuses(ctx, theme, tui) as any,
		{ placement: "belowEditor" },
	);
}
