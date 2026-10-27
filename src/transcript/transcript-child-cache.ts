import type { Component } from "@earendil-works/pi-tui";
import { themeStamp } from "../theme/theme-adapter.ts";

/**
 * Per-child cache for the framed transcript cards (user messages, bash / review / subagent / error groups and
 * the generic fallback). Pi components cache their own lines, so the raw lines a child returns are the cheapest
 * trustworthy signal that its content did not change: a card is reused only when the child (or every member of a
 * group) returned the same lines as when the card was built, at the same width, theme paint and color/string
 * config. The lines are compared element by element, so a component that mutates its array in place, or streams
 * a new line, can never be served stale output. Pointer-equal strings compare in constant time.
 */

export interface CachedMouseEntry {
	component: Component;
	height: number;
}

export interface CachedChildOutput {
	lines: string[];
	mouse: CachedMouseEntry[];
	/** Free slot for formatter specific flags (for example "rendered as ascii art"). */
	flag?: boolean;
}

interface Entry {
	variant: string;
	width: number;
	themeId: object | undefined;
	stamp: string;
	context: readonly unknown[];
	members: readonly Component[];
	raws: string[][];
	value: CachedChildOutput;
}

const entries = new WeakMap<object, Entry>();

function sameLines(a: readonly string[], b: readonly string[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/**
 * Returns the cached output for `members` when nothing it depends on changed; otherwise builds it with
 * `compute` and remembers it. `raws` are the lines each member rendered this frame (one array per member that
 * feeds the card), `context` holds identity-compared config objects (colors, strings...).
 */
export function memoizeChildCard(
	variant: string,
	members: readonly Component[],
	raws: readonly string[][],
	width: number,
	theme: unknown,
	context: readonly unknown[],
	compute: () => CachedChildOutput,
): CachedChildOutput {
	const anchor = members[0] as unknown as object | undefined;
	if (!anchor || typeof anchor !== "object") return compute();
	const stamp = themeStamp(theme as any);
	const hit = entries.get(anchor);
	if (
		hit &&
		hit.variant === variant &&
		hit.width === width &&
		hit.themeId === theme &&
		hit.stamp === stamp &&
		sameList(hit.context, context) &&
		sameList(hit.members, members) &&
		hit.raws.length === raws.length &&
		hit.raws.every((lines, i) => sameLines(lines, raws[i]))
	) {
		return hit.value;
	}
	const value = compute();
	entries.set(anchor, {
		variant,
		width,
		themeId: theme as object | undefined,
		stamp,
		context: [...context],
		members: [...members],
		// Shallow copies: a component that later mutates the array it returned must not alias our snapshot.
		raws: raws.map((lines) => lines.slice()),
		value,
	});
	return value;
}
