import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
	GENTLE_SHELL_REPLACEMENTS,
	PETAL_REPLACEMENTS,
	PROMPT_REPLACEMENTS,
	patchSource,
} from "../scripts/bee-window-patch.mjs";

// The pristine upstream sources come from the one-time backups the patch script leaves next to
// the launcher install. Until a file has been patched once, the live file is the pristine one.
const GENTLE_PI = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "npm", "node_modules", "gentle-pi");
const available = existsSync(join(GENTLE_PI, "lib", "shell-prompt.ts"));

function pristine(relative: string): string {
	const backup = join(GENTLE_PI, `${relative}.pre-bee.bak`);
	if (existsSync(backup)) return readFileSync(backup, "utf8");
	const live = readFileSync(join(GENTLE_PI, relative), "utf8");
	assert.ok(!live.includes("padPromptBlock"), `${relative} is already patched and has no .pre-bee.bak`);
	return live;
}

const strip = (text: string) => text.replace(/\x1b\[[\d;]*m/g, "");
const width = (text: string) => [...strip(text)].length;
const fg = (_role: string, text: string) => `\x1b[38;5;208m${text}\x1b[39m`;
const borderColor = (text: string) => `\x1b[38;5;99m${text}\x1b[39m`;
const bg = (_role: string, text: string) => `\x1b[48;5;236m${text}\x1b[49m`;

interface PromptModule {
	CARD: string;
	resolvePromptLayout: (width: number, style: string, bg: typeof bg | undefined) => Record<string, any>;
	framePromptLines: (lines: string[], width: number, options: Record<string, any>, layout?: Record<string, any>) => string[];
	floatPromptRow: (line: string, layout: Record<string, any>, borderColor: typeof borderColor, row?: number) => string;
	padPromptBlock: (rows: string[], layout: Record<string, any>, borderColor: typeof borderColor) => string[];
	BEE_FRAMES: readonly (readonly string[])[];
	beeFrameAt: (now?: number) => readonly string[];
}

const PATCHED_PROMPT = patchSource(available ? pristine("lib/shell-prompt.ts") : "", PROMPT_REPLACEMENTS, "shell-prompt.ts");

async function loadSandbox(): Promise<{ prompt: PromptModule; float: string }> {
	const sandbox = mkdtempSync(join(tmpdir(), "bee-window-"));
	cpSync(join(GENTLE_PI, "lib"), join(sandbox, "lib"), { recursive: true });
	symlinkSync(join(GENTLE_PI, "node_modules"), join(sandbox, "node_modules"), "junction");
	mkdirSync(join(sandbox, "extensions"), { recursive: true });
	writeFileSync(join(sandbox, "lib", "shell-prompt.ts"), PATCHED_PROMPT.source);
	const prompt = (await import(pathToFileURL(join(sandbox, "lib", "shell-prompt.ts")).href)) as PromptModule;
	const card = (await import(pathToFileURL(join(sandbox, "lib", "shell-card.ts")).href)) as { CARD_STYLE: { FLOAT: string } };
	return { prompt, float: card.CARD_STYLE.FLOAT };
}

const options = (extra: Record<string, unknown> = {}) => ({
	style: undefined as string | undefined,
	bg,
	state: "idle",
	tick: 0,
	borderColor,
	fg,
	...extra,
});

const IDLE_LINES = ["──── top", "type here", "──── bottom"];

test("bee-window - patching twice equals patching once, CRLF is preserved, upgrade from the one-line bee works", { skip: !available }, () => {
	for (const [label, table, file] of [
		["shell-prompt.ts", PROMPT_REPLACEMENTS, "lib/shell-prompt.ts"],
		["gentle-shell.ts", GENTLE_SHELL_REPLACEMENTS, "extensions/gentle-shell.ts"],
	] as const) {
		const original = pristine(file);
		const once = patchSource(original, table, label);
		assert.equal(once.changed, true);
		const twice = patchSource(once.source, table, label);
		assert.equal(twice.changed, false);
		assert.equal(twice.source, once.source);

		const crlf = patchSource(original.replace(/\n/g, "\r\n"), table, label);
		assert.equal(crlf.source, once.source.replace(/\n/g, "\r\n"));
		assert.equal(/(?<!\r)\n/.test(crlf.source), false);
	}
	const oneLineBee = patchSource(pristine("lib/shell-prompt.ts"), PETAL_REPLACEMENTS, "shell-prompt.ts").source;
	assert.equal(patchSource(oneLineBee, PROMPT_REPLACEMENTS, "shell-prompt.ts").source, PATCHED_PROMPT.source);
});

test("bee-window - a missing anchor fails loudly and produces no output", { skip: !available }, () => {
	const broken = pristine("extensions/gentle-shell.ts").replace("private startPulse(): void", "private startPulseRenamed(): void").replace("private pulse: NodeJS.Timeout | undefined;", "private pulses: number;");
	assert.throws(() => patchSource(broken, GENTLE_SHELL_REPLACEMENTS, "gentle-shell.ts"), /upstream gentle-shell\.ts changed/);
});

test("bee-window - patched gentle-shell.ts still parses and wires the idle timer", { skip: !available }, () => {
	const { source } = patchSource(pristine("extensions/gentle-shell.ts"), GENTLE_SHELL_REPLACEMENTS, "gentle-shell.ts");
	assert.doesNotThrow(() => stripTypeScriptTypes(source));
	assert.match(source, /padPromptBlock/);
	assert.match(source, /private syncIdlePulse\(\): void/);
	assert.match(source, /this\.stopIdlePulse\(\);\n\t\}\n/);
	assert.match(source, /"performance" \? 1000 : 200/);
	assert.equal(source.match(/this\.syncIdlePulse\(\)/g)?.length, 3);
});

test("bee-window - wide terminal draws the window and every line has the exact width", { skip: !available }, async () => {
	const { prompt, float } = await loadSandbox();
	const layout = prompt.resolvePromptLayout(100, float, bg);
	const rows = prompt.padPromptBlock(prompt.framePromptLines(IDLE_LINES, 100, options({ style: float }), layout), layout, borderColor);
	assert.ok(rows.length >= 5, `expected >= 5 rows, got ${rows.length}`);
	for (const row of rows) assert.equal(width(row), 100);
	const plain = rows.map(strip);
	assert.ok(plain[0].startsWith(" ╭─────────╮ ▎"), plain[0]);
	for (const index of [1, 2, 3]) {
		assert.ok(plain[index].startsWith(" │") && plain[index].slice(0, 13).endsWith("│ "), plain[index]);
		assert.match(plain[index].slice(2, 11), /[⠁-⣿]/);
	}
	assert.ok(plain[4].startsWith(" ╰─────────╯ ▎"), plain[4]);
	assert.match(plain[0], /waiting for input/);
});

test("bee-window - layout shifts prefix and native width by the window plus gap", { skip: !available }, async () => {
	const { prompt, float } = await loadSandbox();
	const wide = prompt.resolvePromptLayout(100, float, bg);
	const narrow = prompt.resolvePromptLayout(50, float, bg);
	assert.equal(narrow.beeWidth, 0);
	assert.equal(narrow.prefixWidth, 3);
	assert.equal(narrow.nativeWidth, 45);
	const oldNative = 100 - 5;
	assert.equal(wide.beeWidth, 11);
	assert.equal(oldNative - wide.nativeWidth, 12);
	assert.equal(wide.prefixWidth - 3, 12);
	assert.equal(wide.nativeWidth, 83);
	// Consumers (mouse, wrapping) rely on prefix + native + trailing chrome adding up to the width.
	assert.equal(wide.prefixWidth + wide.nativeWidth + 2, 100);
});

test("bee-window - narrow terminal keeps the old layout and draws no window", { skip: !available }, async () => {
	const { prompt, float } = await loadSandbox();
	const layout = prompt.resolvePromptLayout(50, float, bg);
	const rows = prompt.padPromptBlock(prompt.framePromptLines(IDLE_LINES, 50, options({ style: float }), layout), layout, borderColor);
	assert.equal(rows.length, 3);
	for (const row of rows) {
		assert.equal(width(row), 50);
		assert.doesNotMatch(strip(row), /[╭╮╰╯│]/);
	}
	// Neon fallback (no theme background) never hosts the window either.
	const neon = prompt.resolvePromptLayout(100, float, undefined);
	assert.equal(neon.beeWidth, 0);
	assert.equal(neon.prefixWidth, 1);
});

test("bee-window - multi-line input and autocomplete rows get blank window cells at exact width", { skip: !available }, async () => {
	const { prompt, float } = await loadSandbox();
	const layout = prompt.resolvePromptLayout(100, float, bg);
	const lines = ["──── top", "one", "two", "three", "four", "five", "six", "──── bottom"];
	const framed = prompt.framePromptLines(lines, 100, options({ style: float }), layout);
	framed.push(prompt.floatPromptRow("/model  switch model", layout, borderColor, framed.length));
	const rows = prompt.padPromptBlock(framed, layout, borderColor);
	assert.equal(rows.length, 9);
	for (const row of rows) assert.equal(width(row), 100);
	const plain = rows.map(strip);
	assert.ok(plain[4].startsWith(" ╰─────────╯ "));
	for (const index of [5, 6, 7, 8]) assert.ok(plain[index].startsWith(" ".repeat(13) + "▎"), plain[index]);
	// A block shorter than five rows is padded with window-carrying blank rows.
	const short = prompt.padPromptBlock([prompt.floatPromptRow("x", layout, borderColor, 0)], layout, borderColor);
	assert.equal(short.length, 5);
	assert.ok(strip(short[4]).startsWith(" ╰─────────╯ ▎"));
});

test("bee-window - frames are 3 lines of 9 cells and the animation changes over time", { skip: !available }, async () => {
	const { prompt } = await loadSandbox();
	assert.ok(prompt.BEE_FRAMES.length >= 3);
	for (const frame of prompt.BEE_FRAMES) {
		assert.equal(frame.length, 3);
		for (const line of frame) assert.equal([...line].length, 9, JSON.stringify(line));
	}
	const distinct = new Set(prompt.BEE_FRAMES.map((frame) => frame.join("\n")));
	assert.equal(distinct.size, 3, "wings open, wings folded and front-facing look");
	assert.notDeepEqual(prompt.beeFrameAt(0), prompt.beeFrameAt(200));
	assert.deepEqual(prompt.beeFrameAt(0), prompt.beeFrameAt(199));
	assert.deepEqual(prompt.beeFrameAt(0), prompt.beeFrameAt(200 * prompt.BEE_FRAMES.length));
});
