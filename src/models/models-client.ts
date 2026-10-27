import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Minimal structural view of a Pi model (kept structural so this module stays pure). */
export interface ModelLike {
	provider: string;
	id: string;
	name?: string;
	contextWindow?: number;
}

export interface ModelUsage {
	messages: number;
	input: number;
	output: number;
	cacheRead: number;
	cost: number;
}

export interface ModelRow {
	key: string;
	id: string;
	provider: string;
	name: string;
	active: boolean;
	contextWindow?: number;
	messages: number;
	input: number;
	output: number;
	cacheRead: number;
	cost: number;
	/** Only set for the active model (Pi reports context usage for the active model only). */
	contextTokens?: number;
	contextPercent?: number;
	/** Only set for the active model, and only when the caller can match quota reliably. */
	quotaPercent?: number;
}

export interface ModelRowsResult {
	rows: ModelRow[];
	/** Number of models not shown (fallback cap). */
	hidden: number;
	/** True when the list comes from Pi's scoped models / `enabledModels`; false when falling back to all available. */
	scoped: boolean;
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

/** Pi resolves its agent dir from PI_CODING_AGENT_DIR, defaulting to ~/.pi/agent (config.d.ts getAgentDir). */
export function resolveAgentDir(env: Record<string, string | undefined> = process.env, home = homedir()): string {
	const fromEnv = (env.PI_CODING_AGENT_DIR || "").trim();
	if (fromEnv) return fromEnv;
	return join(home, ".pi", "agent");
}

function readEnabled(file: string): string[] | undefined {
	try {
		if (!existsSync(file)) return undefined;
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		const list = parsed?.enabledModels;
		if (!Array.isArray(list)) return undefined;
		const clean = list.filter((p: unknown): p is string => typeof p === "string" && p.trim().length > 0);
		return clean.length ? clean : undefined;
	} catch {
		return undefined;
	}
}

/** `enabledModels` from the project `.pi/settings.json` (wins) or the global agent-dir `settings.json`. */
export function readEnabledModelPatterns(opts: { cwd?: string; agentDir?: string } = {}): string[] | undefined {
	const project = opts.cwd ? readEnabled(join(opts.cwd, ".pi", "settings.json")) : undefined;
	if (project) return project;
	return readEnabled(join(opts.agentDir ?? resolveAgentDir(), "settings.json"));
}

function globToRegExp(glob: string): RegExp {
	const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`, "i");
}

function stripThinking(pattern: string): string {
	const idx = pattern.lastIndexOf(":");
	if (idx > 0 && THINKING_LEVELS.has(pattern.slice(idx + 1).toLowerCase())) return pattern.slice(0, idx);
	return pattern;
}

/**
 * Resolves `enabledModels`-style patterns (`id`, `provider/id`, globs, `:thinking` suffix) against a catalogue.
 * Result keeps first-seen pattern order and is de-duplicated.
 */
export function matchModelPatterns<T extends ModelLike>(patterns: string[], models: readonly T[]): T[] {
	const out: T[] = [];
	const seen = new Set<string>();
	const add = (m: T) => {
		const k = `${m.provider}/${m.id}`;
		if (!seen.has(k)) {
			seen.add(k);
			out.push(m);
		}
	};
	for (const raw of patterns) {
		const pattern = stripThinking(raw.trim());
		if (!pattern) continue;
		const lower = pattern.toLowerCase();
		let hits: T[];
		if (/[*?]/.test(pattern)) {
			const re = globToRegExp(pattern);
			hits = models.filter((m) => re.test(`${m.provider}/${m.id}`) || re.test(m.id));
		} else {
			hits = models.filter((m) => `${m.provider}/${m.id}`.toLowerCase() === lower || m.id.toLowerCase() === lower);
			if (!hits.length) hits = models.filter((m) => m.id.toLowerCase().includes(lower));
		}
		hits.forEach(add);
	}
	return out;
}

/** Groups assistant messages by `provider/model`. Messages carry `provider` and `model` (pi-ai AssistantMessage). */
export function aggregateSessionUsage(entries: readonly any[]): Record<string, ModelUsage> {
	const out: Record<string, ModelUsage> = {};
	for (const entry of entries ?? []) {
		const msg = entry?.type === "message" ? entry.message : undefined;
		if (!msg || msg.role !== "assistant") continue;
		const key = `${msg.provider ?? "?"}/${msg.model ?? "?"}`;
		const acc = (out[key] ??= { messages: 0, input: 0, output: 0, cacheRead: 0, cost: 0 });
		acc.messages += 1;
		acc.input += Number(msg.usage?.input) || 0;
		acc.output += Number(msg.usage?.output) || 0;
		acc.cacheRead += Number(msg.usage?.cacheRead) || 0;
		acc.cost += Number(msg.usage?.cost?.total) || 0;
	}
	return out;
}

export interface BuildRowsOptions {
	/** Override `enabledModels` patterns (pass `undefined` to force "unset"). Omitted: read from settings. */
	enabledPatterns?: string[] | undefined;
	/** Cap for the all-available fallback list. */
	maxFallback?: number;
	/** Quota percent (available) for the active model, or undefined when it cannot be matched. */
	quotaForActive?: () => number | undefined;
}

function safeAvailable(ctx: any): ModelLike[] {
	try {
		const res = ctx?.modelRegistry?.getAvailable?.();
		return Array.isArray(res) ? res : [];
	} catch {
		return [];
	}
}

export function buildModelRows(ctx: any, opts: BuildRowsOptions = {}): ModelRowsResult {
	const available = safeAvailable(ctx);
	let selected: ModelLike[] = [];
	let scoped = false;

	// 1. Pi's own resolved set (same as /scoped-models).
	const pre = Array.isArray(ctx?.scopedModels) ? (ctx.scopedModels as any[]) : [];
	if (pre.length) {
		selected = pre.map((s) => s?.model ?? s).filter((m) => m && m.id);
		scoped = selected.length > 0;
	}
	// 2. enabledModels settings resolved against the catalogue.
	if (!scoped) {
		const patterns = "enabledPatterns" in opts ? opts.enabledPatterns : readEnabledModelPatterns({ cwd: ctx?.cwd });
		if (patterns?.length) {
			selected = matchModelPatterns(patterns, available);
			scoped = selected.length > 0;
		}
	}
	// 3. Fallback: everything authenticated, capped.
	let hidden = 0;
	if (!scoped) {
		const cap = opts.maxFallback ?? 6;
		hidden = Math.max(0, available.length - cap);
		selected = available.slice(0, cap);
	}

	let entries: any[] = [];
	try {
		entries = (ctx?.sessionManager?.getEntries?.() ?? []) as any[];
	} catch {}
	const usage = aggregateSessionUsage(entries);
	const active = ctx?.model as ModelLike | undefined;

	const rows = selected.map((m): ModelRow => {
		const key = `${m.provider}/${m.id}`;
		const u = usage[key];
		const isActive = !!active && active.provider === m.provider && active.id === m.id;
		const row: ModelRow = {
			key,
			id: m.id,
			provider: m.provider,
			name: m.name || m.id,
			active: isActive,
			contextWindow: m.contextWindow,
			messages: u?.messages ?? 0,
			input: u?.input ?? 0,
			output: u?.output ?? 0,
			cacheRead: u?.cacheRead ?? 0,
			cost: u?.cost ?? 0,
		};
		if (isActive) {
			try {
				const cu = ctx?.getContextUsage?.();
				if (cu && typeof cu.tokens === "number") {
					row.contextTokens = cu.tokens;
					const win = cu.contextWindow ?? m.contextWindow;
					row.contextPercent =
						typeof cu.percent === "number" ? cu.percent : win ? (cu.tokens / win) * 100 : undefined;
				}
			} catch {}
			try {
				const q = opts.quotaForActive?.();
				if (typeof q === "number") row.quotaPercent = q;
			} catch {}
		}
		return row;
	});

	return { rows, hidden, scoped };
}

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${n >= 10_000_000 ? Math.round(n / 1_000_000) : (n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${n >= 10_000 ? Math.round(n / 1_000) : (n / 1_000).toFixed(1)}K`;
	return String(n);
}

export type UsageLevel = "ok" | "warn" | "high";

export interface UsageBar {
	/** Filled and empty cells, e.g. "███░░░░░░░░░". */
	text: string;
	/** Session tokens over the context window, capped at 100. */
	percent: number;
	level: UsageLevel;
	/** Short readable summary, e.g. "160K/200K (80%)". */
	label: string;
}

const USAGE_BAR_CELLS = 12;
const USAGE_WARN_PERCENT = 60;
const USAGE_HIGH_PERCENT = 85;

/** Fills a bar by used tokens over the context window; the caller colors it by `level`. */
export function usageBar(used: number, contextWindow: number | undefined, cells = USAGE_BAR_CELLS): UsageBar {
	const percent = contextWindow && contextWindow > 0 ? Math.min(100, Math.round((used / contextWindow) * 100)) : 0;
	const filled = Math.round((percent / 100) * cells);
	const level: UsageLevel = percent >= USAGE_HIGH_PERCENT ? "high" : percent >= USAGE_WARN_PERCENT ? "warn" : "ok";
	const label = contextWindow ? `${fmtTokens(used)}/${fmtTokens(contextWindow)} (${percent}%)` : `${fmtTokens(used)} sin ventana`;
	return { text: "█".repeat(filled) + "░".repeat(cells - filled), percent, level, label };
}

export interface FormattedModelRow {
	/** Left part of line 1 (name + provider). */
	title: string;
	/** Right part of line 1 (context window or "-"). */
	right: string;
	/** Line 2: session tokens and cost. */
	detail: string;
	/** Line 2b: session consumption bar; absent when the model has no session usage. */
	bar?: UsageBar;
	/** Line 3 (active model only): live context usage and quota. */
	extra?: string;
}

export function formatModelRow(row: ModelRow): FormattedModelRow {
	const title = `${row.active ? "●" : "○"} ${row.name} · ${row.provider}`;
	const right = row.contextWindow ? `${fmtTokens(row.contextWindow)} ctx` : "- ctx";
	const detail =
		row.messages > 0
			? `  ${fmtTokens(row.input)} in / ${fmtTokens(row.output)} out · $${row.cost.toFixed(2)}`
			: "  - sin uso en sesión";
	const bar = row.messages > 0 ? usageBar(row.input + row.output, row.contextWindow) : undefined;
	let extra: string | undefined;
	if (row.active) {
		const parts: string[] = [];
		if (typeof row.contextTokens === "number") {
			const pct = typeof row.contextPercent === "number" ? ` (${Math.round(row.contextPercent)}%)` : "";
			parts.push(`ctx ${fmtTokens(row.contextTokens)}${pct}`);
		}
		parts.push(typeof row.quotaPercent === "number" ? `cuota ${Math.round(row.quotaPercent)}%` : "cuota -");
		extra = `  ${parts.join(" · ")}`;
	}
	return { title, right, detail, bar, extra };
}
