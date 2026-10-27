import test from "node:test";
import assert from "node:assert/strict";
import {
	calcVisibleWidth,
	truncateAnsiAware,
	frameCategoryBox,
	ESCAPE_ATOM,
	ESCAPE_ATOM_SINGLE,
} from "../src/transcript/transcript-ansi.ts";
import { safeFg, stripAnsi } from "../src/solvi-theme.ts";

const mockTheme = {
	fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
} as any;

// ---------------------------------------------------------------------------
// Reference implementations (the quadratic originals). They are the oracle the
// optimized code must match byte for byte.
// ---------------------------------------------------------------------------

function referenceTruncateAnsiAware(text: string, maxWidth: number): string {
	if (calcVisibleWidth(text) <= maxWidth) return text;
	const parts = text.split(/(\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x1b]*(?:\x1b\\|\x07)|\x1b_[^\x1b]*\x1b\\)/g);
	let out = "";
	let cut = false;
	for (const part of parts) {
		if (!part) continue;
		if (ESCAPE_ATOM_SINGLE.test(part)) {
			out += part;
			continue;
		}
		for (const char of part) {
			if (calcVisibleWidth(out + char) > maxWidth) {
				cut = true;
				break;
			}
			out += char;
		}
		if (cut) break;
	}
	ESCAPE_ATOM.lastIndex = 0;
	if (cut && ESCAPE_ATOM.test(text)) out += "\x1b[39m";
	return out;
}

function referenceFrameCategoryBox(
	rawLines: string[],
	title: string,
	toneKey: string,
	width: number,
	theme?: any,
): string[] {
	const color = (s: string): string => (theme ? safeFg(theme, toneKey, s) : s);
	const safeWidth = Math.max(30, width);
	const innerWidth = safeWidth - 4;
	const lines = [...rawLines];
	while (lines.length && stripAnsi(lines[0] ?? "").trim() === "") lines.shift();
	while (lines.length && stripAnsi(lines[lines.length - 1] ?? "").trim() === "") lines.pop();
	if (!lines.length) return [];
	const titleStr = title ? ` ${title} ` : "";
	const titleWidth = calcVisibleWidth(titleStr);
	const fillLen = Math.max(0, safeWidth - titleWidth - 3);
	const top = color("┌─" + titleStr + "─".repeat(fillLen) + "┐");
	const bot = color("└" + "─".repeat(safeWidth - 2) + "┘");
	const body = lines.map((line) => {
		const truncated = referenceTruncateAnsiAware(line, innerWidth);
		const w = calcVisibleWidth(truncated);
		const pad = " ".repeat(Math.max(0, innerWidth - w));
		return color("│") + " " + truncated + pad + " " + color("│");
	});
	return [top, ...body, bot];
}

// ---------------------------------------------------------------------------
// Deterministic corpus: plain, colored, emoji, CJK, variation selectors, OSC,
// APC, stray escapes and empty/blank lines.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const FRAGMENTS = [
	"hello",
	" world ",
	"function foo() { return 1; }",
	"\x1b[31m",
	"\x1b[0m",
	"\x1b[38;2;10;20;30m",
	"\x1b[39m",
	"\x1b]8;;https://example.com\x07",
	"\x1b]8;;\x1b\\",
	"\x1b_Gf=100;AAAA\x1b\\",
	"🤖",
	"🌷",
	"☁\ufe0f",
	"☁",
	"\ufe0e",
	"日本語のテキスト",
	"한글",
	"ｆｕｌｌ",
	"é",
	"\t",
	"\x1b",
	"\x1b[?25h",
	"a".repeat(40),
	"-".repeat(25),
];

function buildLine(rand: () => number): string {
	const n = 1 + Math.floor(rand() * 14);
	let line = "";
	for (let i = 0; i < n; i++) line += FRAGMENTS[Math.floor(rand() * FRAGMENTS.length)];
	return line;
}

const WIDTHS = [1, 2, 5, 10, 27, 40, 76, 120];

test("truncateAnsiAware - matches the reference implementation on a mixed ANSI/Unicode corpus", () => {
	const rand = mulberry32(20260427);
	for (let i = 0; i < 1500; i++) {
		const line = buildLine(rand);
		for (const width of WIDTHS) {
			assert.equal(
				truncateAnsiAware(line, width),
				referenceTruncateAnsiAware(line, width),
				`line=${JSON.stringify(line)} width=${width}`,
			);
		}
	}
});

test("truncateAnsiAware - keeps short lines untouched and appends a color reset when a colored line is cut", () => {
	assert.equal(truncateAnsiAware("short", 20), "short");
	const cut = truncateAnsiAware("\x1b[31mabcdefghij\x1b[0m", 4);
	assert.equal(stripAnsi(cut), "abcd\x1b[39m".replace(/\x1b\[39m/, ""));
	assert.ok(cut.endsWith("\x1b[39m"));
	assert.ok(calcVisibleWidth(cut) <= 4);
});

test("frameCategoryBox - matches the reference implementation for plain and themed output", () => {
	const rand = mulberry32(777);
	for (let i = 0; i < 120; i++) {
		const count = 1 + Math.floor(rand() * 12);
		const lines: string[] = [];
		if (rand() < 0.3) lines.push("");
		for (let j = 0; j < count; j++) lines.push(buildLine(rand));
		if (rand() < 0.3) lines.push("   ");
		for (const width of [10, 30, 60, 100]) {
			for (const theme of [undefined, mockTheme]) {
				assert.deepEqual(
					frameCategoryBox(lines, "🤖 assistant", "gentle", width, theme),
					referenceFrameCategoryBox(lines, "🤖 assistant", "gentle", width, theme),
				);
			}
		}
	}
});

test("frameCategoryBox - repeated calls with the same lines return identical output and every row has the frame width", () => {
	const lines = ["alpha", "\x1b[32mbeta\x1b[0m", "🌷 gamma", "x".repeat(300)];
	const first = frameCategoryBox(lines, "title", "gentle", 50, mockTheme);
	const second = frameCategoryBox(lines, "title", "gentle", 50, mockTheme);
	assert.deepEqual(second, first);
	for (const row of first.slice(1, -1)) assert.equal(calcVisibleWidth(stripAnsi(row).replace(/\[\/?gentle\]/g, "")), 50);
});

test("frameCategoryBox - a changed last line (streaming) is reflected while earlier lines keep their framing", () => {
	const base = ["first line", "second line"];
	const a = frameCategoryBox([...base, "partial"], "t", "gentle", 40, mockTheme);
	const b = frameCategoryBox([...base, "partial answer"], "t", "gentle", 40, mockTheme);
	assert.equal(a[1], b[1]);
	assert.equal(a[2], b[2]);
	assert.notEqual(a[3], b[3]);
	assert.ok(stripAnsi(b[3]).includes("partial answer"));
});

test("frameCategoryBox - the same line framed at two widths is not mixed up by the cache", () => {
	const line = "y".repeat(100);
	const narrow = frameCategoryBox([line], "t", "gentle", 40, mockTheme);
	const wide = frameCategoryBox([line], "t", "gentle", 90, mockTheme);
	assert.deepEqual(narrow, referenceFrameCategoryBox([line], "t", "gentle", 40, mockTheme));
	assert.deepEqual(wide, referenceFrameCategoryBox([line], "t", "gentle", 90, mockTheme));
});

// ---------------------------------------------------------------------------
// Performance guards. Bounds are far above the optimized cost and far below
// the quadratic cost, so they are stable on slow machines.
// ---------------------------------------------------------------------------

test("truncateAnsiAware - cutting long colored lines stays linear", () => {
	const long = ("\x1b[36mword\x1b[0m ".repeat(2000)).trim();
	const start = performance.now();
	for (let i = 0; i < 40; i++) truncateAnsiAware(long, 76);
	const elapsed = performance.now() - start;
	assert.ok(elapsed < 250, `40 cuts of a 20k char line took ${elapsed.toFixed(0)}ms`);
});

test("frameCategoryBox - re-framing an unchanged long message is served mostly from cache", () => {
	const lines = Array.from(
		{ length: 400 },
		(_, i) => `\x1b[36mline ${i}\x1b[0m ${"lorem ipsum dolor sit amet ".repeat(8)}`,
	);
	frameCategoryBox(lines, "🤖 assistant", "gentle", 100, mockTheme);
	const start = performance.now();
	for (let i = 0; i < 20; i++) frameCategoryBox(lines, "🤖 assistant", "gentle", 100, mockTheme);
	const elapsed = performance.now() - start;
	assert.ok(elapsed < 150, `20 re-frames of a 400 line message took ${elapsed.toFixed(0)}ms`);
});
