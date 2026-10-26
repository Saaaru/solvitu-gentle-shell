/** Pure, width-safe ASCII/box helpers for the Spotify player. Plain text only (no ANSI). */

const BARS = "▁▂▃▄▅▆▇█";

const len = (s: string): number => [...s].length;

export function formatClock(ms: number): string {
	const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** `━━━━●────`: filled part, marker, remaining part. Always exactly `width` characters. */
export function renderProgressBar(ratio: number, width: number): string {
	const w = Math.max(0, Math.floor(width));
	if (w === 0) return "";
	const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
	const pos = Math.round(r * (w - 1));
	return "━".repeat(pos) + "●" + "─".repeat(w - 1 - pos);
}

function hashSeed(seed: string): number {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0) % 10_000;
}

/** Animated block-bar row. Deterministic for (width, timeMs, seed). Flat low bars when inactive. */
export function equalizerRow(width: number, timeMs: number, seed: string, active: boolean): string {
	const w = Math.max(0, Math.floor(width));
	if (!active) return BARS[0].repeat(w);
	const phase = hashSeed(seed) / 1000;
	const t = Number.isFinite(timeMs) ? timeMs : 0;
	let out = "";
	for (let i = 0; i < w; i++) {
		const a = Math.sin(i * 0.65 + t / 170 + phase);
		const b = Math.sin(i * 0.29 - t / 260 + phase * 2.3);
		const c = Math.sin(i * 1.7 + t / 90 + phase * 0.7);
		const v = (a + b + 0.5 * c + 2.5) / 5; // ~[0,1]
		const level = Math.min(BARS.length - 1, Math.max(0, Math.floor(v * BARS.length)));
		out += BARS[level];
	}
	return out;
}

export function truncatePlain(text: string, width: number): string {
	const w = Math.max(0, Math.floor(width));
	const chars = [...text];
	if (chars.length <= w) return text;
	if (w === 0) return "";
	return chars.slice(0, w - 1).join("") + "…";
}

export function centerPad(text: string, width: number): string {
	const w = Math.max(0, Math.floor(width));
	const t = truncatePlain(text, w);
	const free = w - len(t);
	const left = Math.floor(free / 2);
	return " ".repeat(left) + t + " ".repeat(free - left);
}

/** Greedy word wrap; tokens longer than `width` are hard-split. */
export function wrapText(text: string, width: number): string[] {
	const w = Math.max(1, Math.floor(width));
	const lines: string[] = [];
	let cur = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		let rest = [...word];
		while (rest.length > w) {
			if (cur) {
				lines.push(cur);
				cur = "";
			}
			lines.push(rest.slice(0, w).join(""));
			rest = rest.slice(w);
		}
		const piece = rest.join("");
		if (!cur) cur = piece;
		else if (len(cur) + 1 + rest.length <= w) cur += " " + piece;
		else {
			lines.push(cur);
			cur = piece;
		}
	}
	if (cur || lines.length === 0) lines.push(cur);
	return lines;
}
