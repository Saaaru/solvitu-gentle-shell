import type { Theme } from "@earendil-works/pi-coding-agent";
import { loadSolviColors } from "../solvi-colors.ts";
import { safeFg, bolden, stripAnsi } from "./theme-color.ts";
import { solviGlyphs } from "./theme-glyphs.ts";

// Sidebar cards (Changes, Agents, Todo) remain uniformly colored in the theme's border
// tone (no green override on diff additions or status).
export function unifySidebarCardFrame(raw: string, theme?: Theme): string {
	if (!theme) return raw;
	const g = solviGlyphs(theme);
	const colors = loadSolviColors();
	const toConfigured: Record<string, string> = {
		"╭": g.tl,
		"╮": g.tr,
		"╰": g.bl,
		"╯": g.br,
		"│": g.v,
		"─": g.h,
	};

	// One pass over the ORIGINAL string: either an ANSI-colored run of frame glyphs, or one
	// bare (unstyled) frame glyph. Scanning in two separate passes (ANSI runs, then "remaining
	// bare glyphs") used to re-match characters the first pass already emitted — "─" maps to
	// itself (g.h is "─" too), so it survived pass one unescaped and pass two wrapped it a
	// second time, nesting the color codes and splitting "┌─" apart for any caller checking
	// adjacency.
	return raw.replace(
		/\x1b\[[0-9;]*m[ ╭╮╰╯│─]*[╭╮╰╯│─][ ╭╮╰╯│─]*(?:\x1b\[39m|\x1b\[0m)?|[╭╮╰╯│─]/g,
		(token) => {
			if (token.length === 1) {
				return safeFg(theme, colors.sidebarBorder, toConfigured[token] ?? token);
			}
			const open = token.match(/^\x1b\[[0-9;]*m/)?.[0] ?? "";
			const close = token.match(/(?:\x1b\[39m|\x1b\[0m)$/)?.[0] ?? "";
			const glyphs = token.slice(open.length, close ? token.length - close.length : undefined);
			const doubled = glyphs.replace(/[╭╮╰╯│─]/g, (c) => toConfigured[c] ?? c);
			return safeFg(theme, colors.sidebarBorder, doubled);
		},
	);
}

export type SolviCardTone = "success" | "warning" | "error" | "border";

// Gentle AI card lines in transcript & dock: double-line frame, appropriate tone
// (warning = yellow #F2B86D, success = green #78A588, error = coral #FF718F),
// and robot glyph 🤖 replacing rose, tulip, or flower.
export function formatGentleAiCardLine(raw: string, theme?: Theme, tone: SolviCardTone = "success"): string {
	if (!theme) return raw;
	const g = solviGlyphs(theme);
	const colors = loadSolviColors();
	const resolvedTone =
		tone === "warning"
			? colors.gentleCardWarning
			: tone === "error"
				? colors.gentleCardError
				: tone === "border"
					? colors.sidebarBorder
					: colors.gentleCardSuccess;

	const toConfigured: Record<string, string> = {
		"╭": g.tl,
		"╮": g.tr,
		"╰": g.bl,
		"╯": g.br,
		"│": g.v,
		"─": g.h,
	};

	// 1. Detectar si contiene flor de 1 columna (✿) para compensar el ancho del título
	const hadSingleColFlower = /✿\s*(?=Gentle AI)/u.test(raw);

	// 2. Reemplazar rosa, tulipán o flor por EXACTAMENTE UN robot 🤖
	let line = raw
		.replace(/(?:\u{1F339}\uFE0E|\u{1F339}|🌹|\u{1F337}|🌷|✿)\s*(?=Gentle AI)/gu, "🤖 ")
		.replace(/(?:\u{1F339}\uFE0E|\u{1F339}|🌹|\u{1F337}|🌷)/gu, "🤖");

	// 3. Reemplazar tokens ANSI de marco y pintarlos con el tono correspondiente
	line = line.replace(
		/\x1b\[[0-9;]*m[ ╭╮╰╯│─┌┐└┘│─]*[╭╮╰╯│─┌┐└┘│─][ ╭╮╰╯│─┌┐└┘│─]*(?:\x1b\[39m|\x1b\[0m)?/g,
		(token) => {
			const open = token.match(/^\x1b\[[0-9;]*m/)?.[0] ?? "";
			const close = token.match(/(?:\x1b\[39m|\x1b\[0m)$/)?.[0] ?? "";
			const glyphs = token.slice(open.length, close ? token.length - close.length : undefined);
			const doubled = glyphs.replace(/[╭╮╰╯│─]/g, (c) => toConfigured[c] ?? c);
			return safeFg(theme, resolvedTone, doubled);
		},
	);

	// 4. Reemplazar cualquier glifo de marco restante fuera de ANSI
	line = line.replace(/[╭╮╰╯│─]/g, (c) => safeFg(theme, resolvedTone, toConfigured[c] ?? c));

	// 5. Si reemplazamos ✿ (1 columna) por 🤖 (2 columnas), el título creció 1 columna:
	// acortamos la regla horizontal por 1 columna para que el marco cierre perfectamente simétrico.
	if (hadSingleColFlower) {
		line = line.replace(/─{3,}/, (r) => r.slice(1));
	}

	return line;
}

interface TranscriptLineState {
	gentle: boolean;
	tone: SolviCardTone;
	fence: boolean;
}

const INITIAL_LINE_STATE: TranscriptLineState = { gentle: false, tone: "success", fence: false };

/** Transforms one line given the state carried over from the previous line; returns the output and the next state. */
function transformLineStep(
	line: string,
	theme: Theme,
	state: TranscriptLineState,
): { out: string; next: TranscriptLineState } {
	let { gentle: inGentleCard, tone: currentTone, fence: inFence } = state;
	const plain = stripAnsi(line);
	const hasGentleTitle = plain.includes("Gentle AI");
	const isTopRule = (plain.includes("╭") || plain.includes("┌")) && hasGentleTitle;
	const isBottomRule = plain.includes("╰") || plain.includes("└") || plain.includes("╯") || plain.includes("┘");

	if (/^\s*```/.test(plain)) inFence = !inFence;

	if (isTopRule) {
		inGentleCard = true;
		if (
			plain.includes("dev binary override") ||
			plain.includes("field-test only") ||
			plain.includes("warning") ||
			plain.includes("preparing")
		) {
			currentTone = "warning";
		} else if (plain.includes("failed") || plain.includes("error") || plain.includes("invalid")) {
			currentTone = "error";
		} else {
			currentTone = "success";
		}
	}

	if (inGentleCard) {
		const transformed = formatGentleAiCardLine(line, theme, currentTone);
		if (isBottomRule && !isTopRule) {
			inGentleCard = false;
			currentTone = "success";
		}
		return { out: transformed, next: { gentle: inGentleCard, tone: currentTone, fence: inFence } };
	}

	// Markdown headings get a slightly heavier typeface (bold, same color).
	// Skipped inside fenced code blocks so `#` comments in code never bolden.
	const out = !inFence && /^\s*#{1,6}\s+\S/.test(plain) ? bolden(theme, line) : line;
	return { out, next: { gentle: inGentleCard, tone: currentTone, fence: inFence } };
}

/**
 * Reference implementation of the line processor: no memoization. The cached entry point must match it byte for byte.
 */
export function transformTranscriptLinesUncached(rawLines: string[], theme?: Theme): string[] {
	if (!theme || !rawLines.length) return rawLines;
	let state = INITIAL_LINE_STATE;
	return rawLines.map((line) => {
		const step = transformLineStep(line, theme, state);
		state = step.next;
		return step.out;
	});
}

/** Cheap signature of what the active theme paints, so a theme switch invalidates every cache built on it. */
export function themeStamp(theme?: Theme): string {
	if (!theme) return "";
	try {
		return safeFg(theme, "accent", "​");
	} catch {
		return "?";
	}
}

const TONES: SolviCardTone[] = ["success", "warning", "error", "border"];
const MEMO_LIMIT = 20000;

interface LineMemo {
	stamp: string;
	colors: unknown;
	/** One map per incoming state (gentle x fence x tone). */
	maps: Map<string, { out: string; next: TranscriptLineState }>[];
	/** Lines this transform already produced: feeding them back in is a no-op (makes repeated passes idempotent). */
	outputs: Set<string>;
	size: number;
}

const lineMemos = new WeakMap<object, LineMemo>();

function stateIndex(state: TranscriptLineState): number {
	return (state.gentle ? 1 : 0) + (state.fence ? 2 : 0) + TONES.indexOf(state.tone) * 4;
}

function memoFor(theme: Theme): LineMemo {
	const stamp = themeStamp(theme);
	const colors = loadSolviColors();
	let memo = lineMemos.get(theme as object);
	if (!memo || memo.stamp !== stamp || memo.colors !== colors) {
		memo = { stamp, colors, maps: TONES.flatMap(() => Array.from({ length: 4 }, () => new Map())), outputs: new Set(), size: 0 };
		lineMemos.set(theme as object, memo);
	}
	return memo;
}

// Stateful processor for transcript & dock lines: transforms Gentle AI cards into double-line
// themed frames (warning = yellow, success = green) with robot 🤖, bolds markdown headings
// outside fenced code blocks, and leaves other lines intact.
// Each line's result depends only on the line, the theme and the carried state, so results are memoized
// per (theme, state, line): repeated passes over an unchanged transcript cost a map lookup per line.
// Lines the transform itself produced pass through untouched, so applying it again (the layout wraps
// the transcript, the scroll view and the whole screen) does not nest the color codes a second time.
export function transformTranscriptLines(rawLines: string[], theme?: Theme): string[] {
	if (!theme || !rawLines.length) return rawLines;
	let memo = memoFor(theme);
	if (memo.size > MEMO_LIMIT) {
		lineMemos.delete(theme as object);
		memo = memoFor(theme);
	}
	let state = INITIAL_LINE_STATE;
	const out = new Array<string>(rawLines.length);
	for (let i = 0; i < rawLines.length; i++) {
		const line = rawLines[i];
		const map = memo.maps[stateIndex(state)];
		let step = map.get(line);
		if (!step) {
			step = transformLineStep(line, theme, state);
			if (memo.outputs.has(line)) {
				// Already a themed line from an earlier pass: keep the state machine moving, never wrap it twice.
				step = { out: line, next: step.next };
			} else if (step.out !== line) {
				memo.outputs.add(step.out);
			}
			map.set(line, step);
			memo.size++;
		}
		state = step.next;
		out[i] = step.out;
	}
	return out;
}

// Las cards de gentle-pi adaptadas: si es Gentle AI se formatea con robot y tono adecuado,
// de lo contrario se formatea con marco doble en tono border.
export function unifyCardFrame(raw: string, theme?: Theme): string {
	if (!theme) return raw;
	const plain = stripAnsi(raw);
	if (plain.includes("Gentle AI") || plain.includes("🤖") || /[\u{1F339}\uFE0E\u{1F339}🌹\u{1F337}🌷]/.test(raw)) {
		let tone: SolviCardTone = "success";
		if (
			plain.includes("dev binary override") ||
			plain.includes("field-test only") ||
			plain.includes("warning") ||
			plain.includes("preparing")
		) {
			tone = "warning";
		} else if (plain.includes("failed") || plain.includes("error") || plain.includes("invalid")) {
			tone = "error";
		}
		return formatGentleAiCardLine(raw, theme, tone);
	}
	return unifySidebarCardFrame(raw, theme);
}

/**
 * Intercepts ctx.ui.setHeader to protect la Gentlewoman Welcome Dashboard
 * against late overwrites from external extensions (such as gentle-pi startup-banner with setTimeout(50)),
 * while still adapting any external headers with double lines and theme tones if welcome is disabled.
 */