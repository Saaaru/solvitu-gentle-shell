import test from "node:test";
import assert from "node:assert/strict";
import {
	solviToolRenderer,
	resolveSolviToolRenderer,
	isSolviCardComponent,
	defaultCardFormatters,
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

// ---- collapsed: a two-line box, header only, count and hint in the bottom border ----

test("tool card - collapsed read is a two-line box: header border + count/hint bottom border", () => {
	const { calls, impl } = countingFormatters();
	const lines = draw("read", { path: "src/a.ts" }, numbered(40), {}, 80, impl);
	assert.equal(lines.length, 2, "collapsed card shows only the header and the bottom border");
	const head = stripAnsi(lines[0]);
	assert.ok(head.startsWith("┌─ "), `top border starts the frame: ${head}`);
	assert.ok(head.endsWith("┐"), `top border closes with ┐: ${head}`);
	assert.match(head, /✎ read src\/a\.ts/);
	assert.match(stripAnsi(lines[1]), /^└─ 40 lines · .*ctrl\+o.*expand/);
	assert.deepEqual(calls, {}, "no full formatter may run for a collapsed card");
});

test("tool card - collapsed bash no longer previews the tail, only the count", () => {
	const { calls, impl } = countingFormatters();
	const lines = draw("bash", { command: "npm test" }, numbered(30), {}, 80, impl);
	assert.equal(lines.length, 2);
	assert.match(stripAnsi(lines[0]), />_ bash npm test/);
	assert.match(stripAnsi(lines[1]), /30 lines ·/);
	assert.ok(!lines.some((l) => /line \d+/.test(stripAnsi(l))), "no content preview while collapsed");
	assert.deepEqual(calls, {});
});

test("tool card - a one-line result says '1 line' in the singular", () => {
	const lines = draw("grep", { pattern: "TODO", path: "src" }, "a.ts:1:x");
	assert.equal(lines.length, 2);
	assert.match(stripAnsi(lines[1]), /1 line ·/);
});

test("tool card - every collapsed border line has exactly the requested width", () => {
	for (const width of [80, 60, 40]) {
		const lines = draw("read", { path: "src/a.ts" }, numbered(40), {}, width);
		for (const line of lines) {
			assert.equal(stripAnsi(line).length, width, `width ${width}: ${stripAnsi(line)}`);
		}
	}
});

test("tool card - border color comes from the tool category tone", () => {
	const lines = draw("read", { path: "a.ts" }, "x");
	assert.match(lines[0], /^\[[a-zA-Z]+\]┌─ /, "the frame is painted in a theme tone");
});

// ---- expanded: framed rows with the full formatted output ----

test("tool card - expanded runs the matching formatter and frames every line", () => {
	for (const [tool, key] of [["read", "read"], ["bash", "bash"], ["grep", "grep"], ["write", "write"], ["ls", "generic"]] as const) {
		const { calls, impl } = countingFormatters();
		const lines = draw(tool, { path: "src/a.ts", command: "ls" }, numbered(40), { expanded: true }, 80, impl);
		assert.equal(calls[key], 1, `${tool} uses the ${key} formatter once`);
		const plain = lines.map(stripAnsi);
		assert.ok(plain.some((l) => l.includes("line 1")) && plain.some((l) => l.includes("line 40")), `${tool} shows all lines`);
		for (const row of plain.slice(1, -1)) {
			assert.ok(row.startsWith("│ "), `${tool} row framed: ${row}`);
		}
		assert.match(plain[plain.length - 1], /^└─+┘$/, `${tool} ends with a plain bottom border`);
		assert.ok(!plain.some((l) => /more lines/.test(l)), `${tool} expanded has no hint`);
		assert.ok(!plain.some((l) => /line \d+/.test(l) && l.length > 80), `${tool} rows never overflow`);
	}
});

test("tool card - edit expands to its diff inside the frame", () => {
	const lines = draw("edit", { path: "src/a.ts" }, "Successfully replaced 1 block", { expanded: true, details: { diff: "-1 old\n+1 new" } });
	const plain = lines.map(stripAnsi).join("\n");
	assert.match(plain, /old/);
	assert.match(plain, /new/);
	assert.doesNotMatch(plain, /Successfully replaced/);
});

test("tool card - MCP and unknown tools get the same boxed card", () => {
	const { calls, impl } = countingFormatters();
	const lines = draw("mcp__jira__search", { query: "bug", limit: 5 }, numbered(20), {}, 80, impl);
	const head = stripAnsi(lines[0]);
	assert.match(head, /⚙ mcp__jira__search query=bug/);
	assert.equal(lines.length, 2);
	assert.match(stripAnsi(lines[1]), /20 lines ·/);
	assert.deepEqual(calls, {});
	const expanded = draw("mcp__jira__search", { query: "bug" }, numbered(20), { expanded: true });
	assert.equal(expanded.map(stripAnsi).filter((l) => /line \d+/.test(l)).length, 20);
});

// ---- empty results and failures ----

test("tool card - an empty result closes the box with a plain bottom border", () => {
	const lines = draw("write", { path: "a.ts", content: "x" }, "");
	assert.equal(lines.length, 2);
	assert.match(stripAnsi(lines[1]), /^└─+┘$/);
});

test("tool card - errors frame in the error tone with the failure glyph", () => {
	const lines = draw("bash", { command: "boom" }, numbered(20, "err"), { isError: true });
	assert.match(stripAnsi(lines[0]), /✗ bash boom/);
	assert.match(lines[0], /\[error\]/, "header border uses the error tone");
	assert.match(lines[1], /\[error\]/, "bottom border uses the error tone");
	assert.match(stripAnsi(lines[1]), /20 lines ·/);
});

test("tool card - expanded failures show the raw lines in the error tone inside the frame", () => {
	const lines = draw("bash", { command: "boom" }, "err 1\nerr 2", { isError: true, expanded: true });
	assert.match(lines[1], /\[error\].*err 1/, "the framed row is painted in the error tone");
	assert.match(stripAnsi(lines[3]), /^└─+┘$/);
});

// ---- streaming (partial) stays cheap and bounded ----

test("tool card - partial results stay cheap and bounded", () => {
	const { calls, impl } = countingFormatters();
	const big = numbered(5000);
	const lines = draw("bash", { command: "yes" }, big, { isPartial: true }, 80, impl);
	assert.deepEqual(calls, {}, "streaming never runs the full formatters");
	assert.ok(lines.length <= 6, `partial collapsed is a peek of a few lines (${lines.length})`);
	assert.match(stripAnsi(lines[lines.length - 1]), /streaming/);
	const expanded = draw("bash", { command: "yes" }, big, { isPartial: true, expanded: true }, 80, impl);
	assert.ok(expanded.length <= 60, `partial expanded is bounded (${expanded.length} lines)`);
	assert.match(stripAnsi(expanded[expanded.length - 1]), /streaming/);
	assert.match(stripAnsi(expanded[expanded.length - 2]), /line 5000\b/);
});

// ---- width discipline ----

test("tool card - lines never exceed the width", () => {
	const lines = draw("read", { path: "x".repeat(200) }, "y".repeat(500), {}, 40);
	for (const line of lines) assert.ok(stripAnsi(line).length <= 40, `too wide: ${stripAnsi(line).length}`);
	const expanded = draw("read", { path: "x" }, "y".repeat(500), { expanded: true }, 40);
	for (const line of expanded) assert.ok(stripAnsi(line).length <= 40);
	const head = stripAnsi(draw("read", { path: "x".repeat(200) }, "y", {}, 40)[0]);
	assert.ok(head.endsWith("…┐") || head.endsWith(" ┐"), `long target clips inside the border: ${head}`);
});

// ---- resolver and dispatcher contract (unchanged) ----

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
	const cardLines = ["", "[read]┌─ ✎ read src/a.ts ───┐[/read]", "[dim]│ line 1 │[/dim]", "[dim]└─ 3 lines · ctrl+o ─┘[/dim]"];
	for (const toolName of ["read", "write", "bash", "grep", "fetch_content", "mem_save", "ls", "mcp__x__y"]) {
		const child = new FakeToolExecution(toolName, cardLines, solviToolRenderer(toolName));
		assert.equal(isSolviCardComponent(child as any), true);
		const out = formatTranscriptChildren([child as any], 80, theme);
		assert.deepEqual(out.lines, cardLines, toolName);
		assert.equal(child.renders, 1, `${toolName} rendered exactly once`);
		assert.equal(out.mouseChildren[0].component, child, "clicks reach Pi's own expand handler");
		assert.equal(out.mouseChildren[0].height, cardLines.length);
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
