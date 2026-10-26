import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { solviGlyphs, solviPalette, frameFg } from "../solvi-theme.ts";
import { loadSolviLayout } from "../solvi-layout.ts";
import { formatProfileDisplay, loadSolviStrings, matchBracketProfile } from "../solvi-strings.ts";
import { getContextThreshold } from "../solvi-metrics.ts";

export function separator(theme: Theme): string {
	return frameFg(theme, solviGlyphs(theme).separator);
}

export function gaugeGlyphs(theme: Theme): { filled: string; empty: string } {
	const g = solviGlyphs(theme);
	return { filled: g.gaugeFilled, empty: g.gaugeEmpty };
}

/** Render a host "[name]" status as icon plus name; other statuses pass through. */
export function prettifyExtraStatus(raw: string, theme: Theme): string {
	const name = matchBracketProfile(raw);
	if (name === null) return raw.trim();
	return formatProfileDisplay(solviGlyphs(theme).profileIcon, loadSolviStrings().profileFormat, name);
}

export function shortModelName(modelId: string): string {
	const parts = modelId.split("/");
	return parts.length > 1 ? parts[parts.length - 1] : modelId;
}

export function sessionCost(ctx: ExtensionContext): number {
	let total = 0;
	try {
		for (const entry of (ctx.sessionManager?.getEntries() ?? []) as any[]) {
			if (entry.type === "message" && entry.message?.role === "assistant") {
				total += entry.message.usage?.cost?.total ?? 0;
			}
		}
	} catch {}
	return total;
}

export function formatCost(total: number): string {
	const layout = loadSolviLayout().footer;
	return `$${total >= 1 ? total.toFixed(layout.costDecimalsAboveOne) : total.toFixed(layout.costDecimalsBelowOne)}`;
}

export function renderGauge(theme: Theme, percent: number | null): string {
	const c = solviPalette(theme);
	const gauge = gaugeGlyphs(theme);
	const cells = loadSolviLayout().footer.gaugeCells;
	if (percent === null) {
		return c.dim(gauge.empty.repeat(cells));
	}
	const clamped = Math.max(0, Math.min(100, percent));
	const filledCount = Math.round((clamped / 100) * cells);
	const emptyCount = cells - filledCount;
	const threshold = getContextThreshold(clamped, c);
	const filledStr = threshold.color(gauge.filled.repeat(filledCount));
	const emptyStr = c.dim(gauge.empty.repeat(emptyCount));
	return filledStr + emptyStr;
}
