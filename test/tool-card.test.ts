import test from "node:test";
import assert from "node:assert/strict";
import {
	solviToolRenderer,
	resolveSolviToolRenderer,
	isSolviCardComponent,
	defaultCardFormatters,
	COLLAPSED_PREVIEW_LINES,
	type CardFormatters,
} from "../src/tool-card.ts";
import { formatTranscriptChildren } from "../src/transcript/transcript-dispatcher.ts";
import { stripAnsi as stripEscapes } from "../src/solvi-theme.ts";

/** Plain text of a line: escape codes and the mock theme's [role] tags removed. */
const stripAnsi = (line: string): string => stripEscapes(line).replace(/\[\/?[a-zA-Z]+\]/g, "");

const theme = {
	fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	bold: (text: string) => text,
} as any;

/** Formatters that count how often the full (expensive) formatting runs. */
function countingFormatters(): { calls: Record<string, number>; impl: CardFormatters } {
	const calls: Record<string, number> = {};
	const wrap = <K extends keyof CardFormatters>(key: K): CardFormatters[K] =>
		((...args: unknown[]) => {
			calls[key] = (calls[key] ?? 0) + 1;
			return (defaultCardFormatters[key] as (...a: unknown[]) => unknown)(...args);
		}) as CardFormatters[K];
	return {
		calls,
		impl: {
			bash: wrap("bash"),
			read: wrap("read"),
			write: wrap("write"),
			grep: wrap("grep"),
			generic: wrap("generic"),
		},
	};
}

function numbered(count: number, label = "line"): string {
	return Array.from({ length: count }, (_, i) => `${label} ${i + 1}`).join("\n");
}

function draw(
	toolName: string,
	args: unknown,
	text: string,
	opts: { expanded?: boolean; isPartial?: boolean; isError?: boolean; details?: unknown } = {},
	width = 80,
	impl?: CardFormatters,
): string[] {
	const renderer = solviToolRenderer(toolName, impl) as any;
	const state = {};
	const base = { args, state, isError: opts.isError === true, expanded: opts.expanded === true, isPartial: opts.isPartial === true, invalidate() {} };
	const call = renderer.renderCall(args, theme, base);
	const result = renderer.renderResult(
		{ content: [{ type: "text", text }], details: opts.details },
		{ expanded: opts.expanded === true, isPartial: opts.isPartial === true },
		theme,
		base,
	);
	return [...call.render(width), ...result.render(width)];
}

test("tool card - collapsed read shows header, head preview and the expand hint without running the formatters", () => {
	const { calls, impl } = countingFormatters();
	const lines = draw("read", { path: "src/a.ts" }, numbered(40), {}, 80, impl);
	assert.equal(lines.length, 1 + COLLAPSED_PREVIEW_LINES + 1);
	assert.match(stripAnsi(lines[0]), /read.*src\/a\.ts/);
	assert.match(stripAnsi(lines[1]), /line 1$/);
	assert.match(stripAnsi(lines[COLLAPSED_PREVIEW_LINES]), /line 5$/);
	assert.match(stripAnsi(lines[lines.length - 1]), /\.\.\. \(35 more lines, .*ctrl\+o.*expand.*\)/);
	assert.deepEqual(calls, {}, "no full formatter may run for a collapsed card");
});

test("tool card - collapsed bash previews the tail of the output", () => {
	const { calls, impl } = countingFormatters();
	const lines = draw("bash", { command: "npm test" }, numbered(30), {}, 80, impl);
	assert.match(stripAnsi(lines[0]), /bash.*npm test/);
	assert.match(stripAnsi(lines[1]), /line 26$/);
	assert.match(stripAnsi(lines[COLLAPSED_PREVIEW_LINES]), /line 30$/);
	assert.match(stripAnsi(lines[lines.length - 1]), /\(25 more lines/);
	assert.deepEqual(calls, {});
});

test("tool card - a short result has no hint", () => {
	const lines = draw("grep", { pattern: "TODO", path: "src" }, "a.ts:1:x\nb.ts:2:y");
	assert.equal(lines.length, 3);
	assert.ok(!lines.some((l) => /expand/.test(stripAnsi(l))));
	assert.match(stripAnsi(lines[0]), /grep.*TODO/);
});

test("tool card - expanded runs the matching formatter and shows every line without a hint", () => {
	for (const [tool, key] of [["read", "read"], ["bash", "bash"], ["grep", "grep"], ["write", "write"], ["ls", "generic"]] as const) {
		const { calls, impl } = countingFormatters();
		const lines = draw(tool, { path: "src/a.ts", command: "ls" }, numbered(40), { expanded: true }, 80, impl);
		assert.equal(calls[key], 1, `${tool} uses the ${key} formatter once`);
		const plain = lines.map(stripAnsi);
		assert.ok(plain.some((l) => l.includes("line 1")) && plain.some((l) => l.includes("line 40")), `${tool} shows all lines`);
		assert.ok(!plain.some((l) => /more lines/.test(l)), `${tool} expanded has no hint`);
	}
});

test("tool card - edit expands to its diff", () => {
	const lines = draw("edit", { path: "src/a.ts" }, "Successfully replaced 1 block", { expanded: true, details: { diff: "-1 old\n+1 new" } });
	const plain = lines.map(stripAnsi).join("\n");
	assert.match(plain, /old/);
	assert.match(plain, /new/);
	assert.doesNotMatch(plain, /Successfully replaced/);
});

test("tool card - MCP and unknown tools get the same card", () => {
	const { calls, impl } = countingFormatters();
	const lines = draw("mcp__jira__search", { query: "bug", limit: 5 }, numbered(20), {}, 80, impl);
	const head = stripAnsi(lines[0]);
	assert.match(head, /mcp__jira__search/);
	assert.match(head, /bug/);
	assert.equal(lines.length, 1 + COLLAPSED_PREVIEW_LINES + 1);
	assert.match(stripAnsi(lines[lines.length - 1]), /\(15 more lines/);
	assert.deepEqual(calls, {});
	const expanded = draw("mcp__jira__search", { query: "bug" }, numbered(20), { expanded: true });
	assert.equal(expanded.map(stripAnsi).filter((l) => /^\s*line \d+/.test(l)).length, 20);
});

test("tool card - partial results stay cheap even when expanded", () => {
	const { calls, impl } = countingFormatters();
	const big = numbered(5000);
	const lines = draw("bash", { command: "yes" }, big, { isPartial: true, expanded: true }, 80, impl);
	assert.deepEqual(calls, {}, "streaming never runs the full formatters");
	assert.ok(lines.length <= 60, `partial output is bounded (${lines.length} lines)`);
	assert.match(stripAnsi(lines[lines.length - 1]), /line 5000$/);
});

test("tool card - errors show the first lines in the error tone", () => {
	const lines = draw("bash", { command: "boom" }, numbered(20, "err"), { isError: true });
	assert.match(lines[0], /\[error\]/);
	assert.match(lines[1], /\[error\].*err 1/);
	assert.match(stripAnsi(lines[lines.length - 1]), /more lines/);
});

test("tool card - lines never exceed the width", () => {
	const lines = draw("read", { path: "x".repeat(200) }, "y".repeat(500), { }, 40);
	for (const line of lines) assert.ok(stripEscapes(line).length <= 40, `too wide: ${stripEscapes(line).length}`);
	const expanded = draw("read", { path: "x" }, "y".repeat(500), { expanded: true }, 40);
	for (const line of expanded) assert.ok(stripEscapes(line).length <= 40);
});

test("tool card - the resolver covers every tool except those with bespoke grouping", () => {
	const sentinel = { sentinel: true };
	for (const name of ["read", "write", "edit", "bash", "grep", "find", "ls", "fetch_content", "mem_save", "mcp__x__y", "anything"]) {
		const r = resolveSolviToolRenderer(name, () => sentinel as any);
		assert.notEqual(r, sentinel, name);
		assert.equal((r as any).renderShell, "self");
	}
	for (const name of ["subagent_run", "subagent_status", "gentle_review_capture"]) {
		assert.equal(resolveSolviToolRenderer(name, () => sentinel as any), sentinel, name);
	}
});

// ---- dispatcher: cards are never framed or re-rendered a second time ----

class FakeToolExecution {
	toolName: string;
	toolDefinition: unknown;
	renders = 0;
	private readonly lines: string[];
	constructor(toolName: string, lines: string[], definition: unknown) {
		this.toolName = toolName;
		this.lines = lines;
		this.toolDefinition = definition;
	}
	render(_width: number): string[] {
		this.renders++;
		return this.lines;
	}
}
Object.defineProperty(FakeToolExecution, "name", { value: "ToolExecutionComponent" });

test("transcript dispatcher - a Solvitu card passes through untouched: no frame, one render", () => {
	const cardLines = ["", "[read]✎ read src/a.ts[/read]", "  line 1", "  ... (3 more lines, ctrl+o to expand)"];
	for (const toolName of ["read", "write", "bash", "grep", "fetch_content", "mem_save", "ls", "mcp__x__y"]) {
		const child = new FakeToolExecution(toolName, cardLines, solviToolRenderer(toolName));
		assert.equal(isSolviCardComponent(child as any), true);
		const out = formatTranscriptChildren([child as any], 80, theme);
		assert.deepEqual(out.lines, cardLines, toolName);
		assert.equal(child.renders, 1, `${toolName} rendered exactly once`);
		assert.equal(out.mouseChildren[0].component, child, "clicks reach Pi's own expand handler");
		assert.equal(out.mouseChildren[0].height, cardLines.length);
		assert.ok(!out.lines.some((l) => /[┌└│]/.test(l)), "no second frame");
	}
});

test("transcript dispatcher - consecutive bash and memory cards are not merged into one framed card", () => {
	const a = new FakeToolExecution("bash", ["", "a"], solviToolRenderer("bash"));
	const b = new FakeToolExecution("bash", ["", "b"], solviToolRenderer("bash"));
	const out = formatTranscriptChildren([a as any, b as any], 80, theme);
	assert.deepEqual(out.lines, ["", "a", "", "b"]);
});

// ---- performance: a collapsed card must not pay for the size of the output ----

test("tool card perf - collapsed cost does not scale with output size and frames are cached", () => {
	const { calls, impl } = countingFormatters();
	const renderer = solviToolRenderer("bash", impl) as any;
	const ctx = { args: { command: "big" }, state: {}, isError: false, invalidate() {} };
	const time = (lineCount: number): { first: number; frames: number } => {
		const text = numbered(lineCount, "output line with some typical width of text");
		const start = process.hrtime.bigint();
		const body = renderer.renderResult({ content: [{ type: "text", text }] }, { expanded: false, isPartial: false }, theme, ctx);
		body.render(100);
		const first = Number(process.hrtime.bigint() - start) / 1e6;
		const framesStart = process.hrtime.bigint();
		for (let i = 0; i < 2000; i++) body.render(100);
		return { first, frames: Number(process.hrtime.bigint() - framesStart) / 1e6 };
	};
	time(100); // warm up
	const small = time(100);
	const large = time(300_000);
	assert.ok(large.first < 150, `first collapsed render of 300k lines took ${large.first.toFixed(1)}ms`);
	assert.ok(large.frames < 50, `2000 cached frames took ${large.frames.toFixed(1)}ms`);
	assert.ok(large.frames < small.frames * 10 + 10, `per-frame cost scales with size (${small.frames.toFixed(2)}ms vs ${large.frames.toFixed(2)}ms)`);
	assert.deepEqual(calls, {}, "the full formatters never ran");
});

test("tool card perf - expanding is the only path that runs the formatter", () => {
	const { calls, impl } = countingFormatters();
	const renderer = solviToolRenderer("read", impl) as any;
	const ctx = { args: { path: "a.ts" }, state: {}, isError: false, invalidate() {} };
	const result = { content: [{ type: "text", text: numbered(500) }] };
	renderer.renderResult(result, { expanded: false }, theme, ctx).render(80);
	assert.equal(calls.read, undefined);
	renderer.renderResult(result, { expanded: true }, theme, ctx).render(80);
	assert.equal(calls.read, 1);
});
