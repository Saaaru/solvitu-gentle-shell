import type { Component } from "@earendil-works/pi-tui";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { safeFg } from "./solvi-theme.ts";
import { loadSolviColors } from "./solvi-colors.ts";
import { compactToolTarget } from "./tool-lines.ts";
import { truncateAnsiAware } from "./transcript/transcript-ansi.ts";
import { toolFilePath } from "./transcript/transcript-highlight.ts";
import {
	formatBashOutputLines,
	formatGrepLines,
	formatReadLines,
	formatWriteDiffLines,
} from "./transcript/transcript-tools-system.ts";

/**
 * One uniform, lazily expanding card for every tool call.
 *
 * Pi calls `renderCall` / `renderResult` when a call changes and whenever the expanded flag flips (ctrl+o or a
 * click), and calls the returned component's `render(width)` on every frame. So the expensive work (syntax
 * highlighting, wrapping) lives only on the expanded path, and the collapsed path slices a few lines out of the
 * raw text once per width and caches them.
 */

/** Lines a collapsed card previews before the "... (K more lines)" hint. */
export const COLLAPSED_PREVIEW_LINES = 5;
/** Lines shown while a result is still streaming, collapsed or expanded. */
const PARTIAL_EXPANDED_LINES = 40;
const INDENT = "  ";

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

function headLines(text: string, n: number): string[] {
	const out: string[] = [];
	let from = 0;
	while (out.length < n && from <= text.length) {
		const at = text.indexOf("\n", from);
		if (at === -1) {
			if (from < text.length) out.push(text.slice(from));
			break;
		}
		out.push(text.slice(from, at));
		from = at + 1;
	}
	return out;
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
		const lines = [truncateAnsiAware(this.build(width), Math.max(1, width))];
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

function fit(line: string, width: number): string {
	return truncateAnsiAware(INDENT + line, Math.max(1, width));
}

function hintLine(hidden: number, theme: Theme, width: number): string {
	const label = hidden === 1 ? "line" : "lines";
	const text =
		safeFg(theme, "muted", `... (${hidden} more ${label}, `, "dim") + expandHint() + safeFg(theme, "muted", ")", "dim");
	return fit(text, width);
}

export interface ToolCardRenderer {
	renderShell: "self";
	renderCall(args: unknown, theme: Theme, context: any): Component;
	renderResult(result: any, options: { expanded?: boolean; isPartial?: boolean }, theme: Theme, context: any): Component;
	[SOLVI_CARD]: true;
}

/** Renderer for one tool: colored header, a short preview collapsed, the fully formatted output expanded. */
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
				const target = toolCardTarget(toolName, args);
				const room = Math.max(0, width - title.length - 1);
				const clipped = target.length > room ? `${target.slice(0, Math.max(0, room - 1))}…` : target;
				return safeFg(theme, tone, title) + (clipped ? ` ${safeFg(theme, "muted", clipped, "dim")}` : "");
			});
		},

		renderResult(result, options, theme, context) {
			const expanded = options?.expanded === true;
			const partial = options?.isPartial === true;
			const failed = context?.isError === true;
			const text = resultText(result);
			const tone = failed ? colors.errorMessage : undefined;
			const paint = (line: string) => (tone ? safeFg(theme, tone, line) : safeFg(theme, "toolOutput", line, "muted"));

			return new BodyLines((width) => {
				if (!text) return [];
				const room = Math.max(1, width - INDENT.length);

				// Streaming: never format, never scan the whole text.
				if (partial) {
					const n = expanded ? PARTIAL_EXPANDED_LINES : COLLAPSED_PREVIEW_LINES;
					return tailLines(text, n).map((line) => fit(paint(line), width));
				}

				if (!expanded) {
					const total = countLines(text);
					const shown = category.kind === "bash" && !failed ? tailLines(text, COLLAPSED_PREVIEW_LINES) : headLines(text, COLLAPSED_PREVIEW_LINES);
					const out = shown.map((line) => fit(paint(line), width));
					if (total > shown.length) out.push(hintLine(total - shown.length, theme, width));
					return out;
				}

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

				const out: string[] = [];
				for (const line of formatted) {
					const wrapped = wrapTextWithAnsi(line, room);
					for (const piece of wrapped.length ? wrapped : [""]) out.push(INDENT + piece);
				}
				return out;
			});
		},
	};
}

/** Resolver for Pi's `registerToolRenderer`: our card for every tool, except those with bespoke grouping. */
export function resolveSolviToolRenderer<T>(toolName: string, next: () => T): ToolCardRenderer | T {
	return isCardExcluded(toolName) ? next() : solviToolRenderer(toolName);
}

/** True for a Pi tool-execution component whose renderer is a Solvitu card (already formatted, never re-framed). */
export function isSolviCardComponent(child: unknown): boolean {
	const definition = (child as { toolDefinition?: Record<symbol, unknown> } | null | undefined)?.toolDefinition;
	return definition?.[SOLVI_CARD] === true;
}
