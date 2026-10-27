import type { Component } from "@earendil-works/pi-tui";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { safeFg } from "./solvi-theme.ts";
import { loadSolviColors } from "./solvi-colors.ts";
import { compactToolTarget } from "./tool-lines.ts";
import { calcVisibleWidth, truncateAnsiAware, truncateToVisibleWidth } from "./transcript/transcript-ansi.ts";
import { toolFilePath } from "./transcript/transcript-highlight.ts";
import {
	formatBashOutputLines,
	formatGrepLines,
	formatReadLines,
	formatWriteDiffLines,
} from "./transcript/transcript-tools-system.ts";

/**
 * One uniform, boxed, lazily expanding card for every tool call.
 *
 * ┌─ ✎ read src/a.ts ─────────────────────────────┐
 * └─ 40 lines · ctrl+o to expand ─────────────────┘
 *
 * Every tool (built-in, MCP, unknown) draws a double-line SOLVI frame in its category
 * tone; the collapsed box shows only the header, and the bottom border carries the line
 * count with the expand hint. The full output is formatted only once Pi flips `expanded`
 * (ctrl+o or a click), so the expensive work (syntax highlighting, wrapping) lives only
 * on the expanded path; the collapsed path counts lines and draws two borders.
 */

/** Lines shown while a result is still streaming, collapsed. */
const PARTIAL_PREVIEW_LINES = 3;
/** Lines shown while a result is still streaming, expanded. */
const PARTIAL_EXPANDED_LINES = 40;
/** Minimum frame width: below this the border compresses instead of overflowing. */
const MIN_FRAME_WIDTH = 24;

/** Marks a renderer definition as ours so the transcript dispatcher can pass the finished card through. */
export const SOLVI_CARD = Symbol.for("solvitu.tool-card");

/** Tools that keep their bespoke grouping in the transcript dispatcher and fall through to the next renderer. */
export function isCardExcluded(toolName: string): boolean {
	return toolName.startsWith("subagent_") || toolName.startsWith("gentle_review");
}

export interface CardFormatters {
	bash(lines: string[], theme: Theme): string[];
	read(lines: string[], path: string | undefined, theme: Theme): string[];
	write(lines: string[], path: string | undefined, theme: Theme, toolName: string): string[];
	grep(lines: string[], theme: Theme): string[];
	generic(lines: string[], theme: Theme): string[];
}

export const defaultCardFormatters: CardFormatters = {
	bash: (lines, theme) => formatBashOutputLines(lines, theme, loadSolviColors().bashOutput),
	read: (lines, path, theme) => formatReadLines(lines, path, theme),
	write: (lines, path, theme, toolName) => formatWriteDiffLines(lines, path, theme, toolName),
	grep: (lines, theme) => formatGrepLines(lines, theme),
	generic: (lines, theme) => lines.map((line) => (line ? safeFg(theme, "toolOutput", line, "muted") : line)),
};

let expandHint: () => string = () => "ctrl+o to expand";

/** Lets the extension entry point supply Pi's own key hint (it follows the user's keybindings). */
export function setExpandHint(fn: (() => string) | undefined): void {
	expandHint = fn ?? (() => "ctrl+o to expand");
}

type Kind = "bash" | "read" | "write" | "grep" | "generic";

interface Category {
	glyph: string;
	kind: Kind;
	tone: string;
}

/** Glyph, formatter family and header tone for a tool, using the colors of the existing Solvitu categories. */
export function toolCategory(toolName: string): Category {
	const colors = loadSolviColors();
	const name = toolName.toLowerCase();
	if (name === "bash") return { glyph: ">_", kind: "bash", tone: colors.bashMessage };
	if (name === "read") return { glyph: "✎", kind: "read", tone: colors.readMessage };
	if (name === "write" || name === "edit") return { glyph: "✎", kind: "write", tone: colors.writeMessage };
	if (name === "grep") return { glyph: "⌕", kind: "grep", tone: "warning" };
	if (name === "find" || name === "ls") return { glyph: "⌕", kind: "generic", tone: colors.readMessage };
	if (name === "fetch" || name === "fetch_content") return { glyph: "↓", kind: "generic", tone: colors.fetchMessage };
	if (name === "search" || name === "web_search") return { glyph: "⌕", kind: "generic", tone: colors.searchMessage };
	if (name.startsWith("mem_") || name.startsWith("memory_")) return { glyph: "\u{1F9E0}", kind: "generic", tone: colors.memoryMessage };
	return { glyph: "⚙", kind: "generic", tone: "accent" };
}

/** Argument summary for tools without a path, command or pattern (MCP tools): `key=value` for the first scalars. */
function fallbackTarget(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const parts: string[] = [];
	for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
		if (parts.length >= 3) break;
		if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
			parts.push(`${key}=${String(value).replace(/\s*\n\s*/g, " ")}`);
		}
	}
	return parts.join(" ");
}

export function toolCardTarget(toolName: string, args: unknown): string {
	const record = (args ?? {}) as Record<string, unknown>;
	if (toolName === "grep" && typeof record.pattern === "string") {
		return typeof record.path === "string" ? `${record.pattern} in ${compactToolTarget({ path: record.path })}` : record.pattern;
	}
	return compactToolTarget(args) || fallbackTarget(args);
}

// ---- cheap line slicing: no split of the whole text ----

/** Number of lines in `text`, not counting one trailing newline. */
function countLines(text: string): number {
	if (!text) return 0;
	let count = 1;
	let at = text.indexOf("\n");
	while (at !== -1) {
		count++;
		at = text.indexOf("\n", at + 1);
	}
	return text.endsWith("\n") ? count - 1 : count;
}

function tailLines(text: string, n: number): string[] {
	const body = text.endsWith("\n") ? text.slice(0, -1) : text;
	const out: string[] = [];
	let end = body.length;
	while (out.length < n && end >= 0) {
		const at = body.lastIndexOf("\n", end - 1);
		out.unshift(body.slice(at + 1, end));
		if (at === -1) break;
		end = at;
	}
	return out;
}

function resultText(result: any): string {
	if (!Array.isArray(result?.content)) return "";
	let out = "";
	for (const part of result.content) {
		if (part?.type === "text" && typeof part.text === "string") out += (out ? "\n" : "") + part.text;
	}
	return out;
}

// ---- components ----

class HeaderLine implements Component {
	private cache?: { width: number; lines: string[] };
	private readonly build: (width: number) => string;

	constructor(build: (width: number) => string) {
		this.build = build;
	}

	render(width: number): string[] {
		if (this.cache?.width === width) return this.cache.lines;
		const lines = [this.build(width)];
		this.cache = { width, lines };
		return lines;
	}

	invalidate(): void {
		this.cache = undefined;
	}
}

/** Result body. `build` runs at most once per width, so a collapsed card costs nothing per frame. */
class BodyLines implements Component {
	private cache?: { width: number; lines: string[] };
	private readonly build: (width: number) => string[];

	constructor(build: (width: number) => string[]) {
		this.build = build;
	}

	render(width: number): string[] {
		if (this.cache?.width === width) return this.cache.lines;
		const lines = this.build(width);
		this.cache = { width, lines };
		return lines;
	}

	invalidate(): void {
		this.cache = undefined;
	}
}

// ---- SOLVI frame drawing ----

/**
 * Top border with the card header: `┌─ {title} {target} ────┐`.
 * Width math runs on the plain strings before coloring, so the border always lands on
 * exactly `width` visible columns; the target clips with an ellipsis, never the border.
 */
function frameTop(theme: Theme, tone: string, title: string, target: string, width: number): string {
	const w = Math.max(MIN_FRAME_WIDTH, width);
	const border = (s: string) => safeFg(theme, tone, s);
	// "┌─ " (3) + title (+ " " + target) + " " (1) + fill + "┐" (1) = w
	const titleRoom = w - 5;
	let titleStr = title;
	if (calcVisibleWidth(titleStr) > titleRoom) titleStr = truncateToVisibleWidth(titleStr, Math.max(0, titleRoom - 1)) + "…";
	let targetStr = target;
	const targetRoom = titleRoom - calcVisibleWidth(titleStr) - 1;
	if (targetStr && calcVisibleWidth(targetStr) > targetRoom) {
		targetStr = targetRoom > 1 ? truncateToVisibleWidth(targetStr, targetRoom - 1) + "…" : "";
	}
	const contentWidth = calcVisibleWidth(titleStr) + (targetStr ? 1 + calcVisibleWidth(targetStr) : 0);
	const fill = Math.max(0, w - 5 - contentWidth);
	return (
		border("┌─ ") +
		border(titleStr) +
		(targetStr ? " " + safeFg(theme, "muted", targetStr, "dim") : "") +
		border(" " + "─".repeat(fill) + "┐")
	);
}

/**
 * Bottom border with an optional muted label: `└─ {label} ────┘`, or a plain `└────┘`
 * without one. The label is measured plain, so the border closes on exactly `width`.
 */
function frameBottom(theme: Theme, tone: string, label: string, width: number): string {
	const w = Math.max(MIN_FRAME_WIDTH, width);
	const border = (s: string) => safeFg(theme, tone, s);
	if (!label) return border("└" + "─".repeat(w - 2) + "┘");
	// "└─ " (3) + label + " " (1) + fill + "┘" (1) = w
	const labelRoom = w - 5;
	let labelStr = label;
	if (calcVisibleWidth(labelStr) > labelRoom) labelStr = truncateToVisibleWidth(labelStr, Math.max(0, labelRoom - 1)) + "…";
	const fill = Math.max(0, w - 5 - calcVisibleWidth(labelStr));
	return border("└─ ") + safeFg(theme, "muted", labelStr, "dim") + border(" " + "─".repeat(fill) + "┘");
}

/** Content rows framed as `│ {row padded to width-4} │`, wrapped ANSI-aware. */
function frameRows(rows: string[], theme: Theme, tone: string, width: number): string[] {
	const w = Math.max(MIN_FRAME_WIDTH, width);
	const inner = w - 4;
	const border = (s: string) => safeFg(theme, tone, s);
	const out: string[] = [];
	for (const row of rows) {
		const wrapped = wrapTextWithAnsi(row, inner);
		const pieces = wrapped.length ? wrapped : [""];
		for (let piece of pieces) {
			if (calcVisibleWidth(piece) > inner) piece = truncateAnsiAware(piece, inner);
			out.push(border("│ ") + piece + " ".repeat(Math.max(0, inner - calcVisibleWidth(piece))) + border(" │"));
		}
	}
	return out;
}

export interface ToolCardRenderer {
	renderShell: "self";
	renderCall(args: unknown, theme: Theme, context: any): Component;
	renderResult(result: any, options: { expanded?: boolean; isPartial?: boolean }, theme: Theme, context: any): Component;
	[SOLVI_CARD]: true;
}

/** Renderer for one tool: a double-line SOLVI box, header only while collapsed, the fully formatted output expanded. */
export function solviToolRenderer(toolName: string, formatters: CardFormatters = defaultCardFormatters): ToolCardRenderer {
	const category = toolCategory(toolName);
	const colors = loadSolviColors();

	return {
		renderShell: "self",
		[SOLVI_CARD]: true,

		renderCall(args, theme, context) {
			// A write's content only exists in the call, so keep it for the expanded view.
			if (context?.state && typeof (args as any)?.content === "string") context.state.writeContent = (args as any).content;
			return new HeaderLine((width) => {
				const failed = context?.isError === true;
				const tone = failed ? colors.errorMessage : category.tone;
				const title = `${failed ? "✗" : category.glyph} ${toolName}`;
				return frameTop(theme, tone, title, toolCardTarget(toolName, args), width);
			});
		},

		renderResult(result, options, theme, context) {
			const expanded = options?.expanded === true;
			const partial = options?.isPartial === true;
			const failed = context?.isError === true;
			const text = resultText(result);
			const tone = failed ? colors.errorMessage : category.tone;
			const paint = (line: string) => (failed ? safeFg(theme, tone, line) : safeFg(theme, "toolOutput", line, "muted"));

			return new BodyLines((width) => {
				// No output yet: close the frame opened by the header.
				if (!text) return [frameBottom(theme, tone, "", width)];

				// Streaming: never format, never scan the whole text; a bounded tail peek keeps the box alive.
				if (partial) {
					const n = expanded ? PARTIAL_EXPANDED_LINES : PARTIAL_PREVIEW_LINES;
					const rows = tailLines(text, n).map(paint);
					return [...frameRows(rows, theme, tone, width), frameBottom(theme, tone, "streaming", width)];
				}

				// Collapsed: header only; the count and the expand hint travel in the bottom border.
				if (!expanded) {
					const total = countLines(text);
					const label = `${total} ${total === 1 ? "line" : "lines"} · ${expandHint()}`;
					return [frameBottom(theme, tone, label, width)];
				}

				// Expanded: the full formatted output, framed row by row.
				let source = text;
				if (toolName === "edit" && typeof result?.details?.diff === "string") source = result.details.diff;
				else if (toolName === "write" && typeof context?.state?.writeContent === "string") source = context.state.writeContent;
				const raw = source.split("\n");
				if (raw.length && raw[raw.length - 1] === "") raw.pop();

				let formatted: string[];
				if (failed) formatted = raw.map(paint);
				else if (category.kind === "bash") formatted = formatters.bash(raw, theme);
				else if (category.kind === "read") formatted = formatters.read(raw, toolFilePath({ args: context?.args } as any, []), theme);
				else if (category.kind === "write") formatted = formatters.write(raw, toolFilePath({ args: context?.args } as any, []), theme, toolName);
				else if (category.kind === "grep") formatted = formatters.grep(raw, theme);
				else formatted = formatters.generic(raw, theme);

				return [...frameRows(formatted, theme, tone, width), frameBottom(theme, tone, "", width)];
			});
		},
	};
}

/** Resolver for Pi's `registerToolRenderer`: our boxed card for every tool, except those with bespoke grouping. */
export function resolveSolviToolRenderer<T>(toolName: string, next: () => T): ToolCardRenderer | T {
	return isCardExcluded(toolName) ? next() : solviToolRenderer(toolName);
}

/** True for a Pi tool-execution component whose renderer is a Solvitu card (already formatted, never re-framed). */
export function isSolviCardComponent(child: unknown): boolean {
	const definition = (child as { toolDefinition?: Record<symbol, unknown> } | null | undefined)?.toolDefinition;
	return definition?.[SOLVI_CARD] === true;
}
