import test from "node:test";
import assert from "node:assert/strict";
import { formatTranscriptChildren } from "../src/transcript/transcript-dispatcher.ts";
import { transformTranscriptLines, transformTranscriptLinesUncached, themeStamp } from "../src/theme/theme-adapter.ts";
import { stripAnsi } from "../src/solvi-theme.ts";
import "./test-helpers.ts";

const PROBE = "​";

/** Mock theme that counts every painted fragment except the cache-signature probe. */
function makeTheme(tag = "a") {
	const counter = { fg: 0 };
	const theme = {
		fg: (role: string, text: string) => {
			if (text !== PROBE) counter.fg++;
			return `\x1b[38;5;1m<${tag}${role}>${text}\x1b[39m`;
		},
		bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
	} as any;
	return { theme, counter };
}

function make(name: string, lines: string[], extra: Record<string, unknown> = {}) {
	const state = { lines, renders: 0 };
	const C = {
		[name]: class {
			constructor() {
				Object.assign(this, extra);
			}
			render(_w: number) {
				state.renders++;
				return state.lines;
			}
			invalidate() {}
		},
	}[name];
	const c: any = new C();
	c.__state = state;
	return c;
}

const body = (n: number, tag = "x") =>
	Array.from({ length: n }, (_, i) => `\x1b[38;5;240m${tag} line ${i}\x1b[39m with src/foo/bar.ts:${i} and \x1b[1mbold\x1b[22m`);

function mixedFixture() {
	return [
		make("UserMessageComponent", body(3, "user")),
		make("Spacer", [""]),
		make("ToolExecutionComponent", ["$ ls", ...body(6, "out")], { toolName: "bash" }),
		make("Spacer", [""]),
		make("ToolExecutionComponent", ["$ pwd", ...body(2, "out2")], { toolName: "bash" }),
		make("ToolExecutionComponent", ["read src/a.ts", ...body(5, "r")], { toolName: "read" }),
		make("ToolExecutionComponent", ["write src/a.ts", ...body(5, "w")], { toolName: "write" }),
		make("ToolExecutionComponent", ["fetch https://x", ...body(4, "f")], { toolName: "web_fetch" }),
		make("ToolExecutionComponent", ["subagent run", ...body(3, "s")], { toolName: "subagent_run" }),
		make("ToolExecutionComponent", ["review", ...body(3, "rv")], { toolName: "gentle_review_status" }),
		make("Text", ["Error: boom", ...body(2, "e")]),
		make("Text", ["# Heading", "plain text", "```", "# not heading", "```"]),
		make("UserMessageComponent", body(2, "user2")),
	];
}

for (const width of [40, 80, 120]) {
	test(`child cache: output is byte-identical between cold and cached frames at width ${width}`, () => {
		const { theme } = makeTheme();
		const kids = mixedFixture();
		const cold = formatTranscriptChildren(kids, width, theme);
		const warm = formatTranscriptChildren(kids, width, theme);
		assert.deepEqual(warm.lines, cold.lines);
		assert.deepEqual(
			warm.mouseChildren.map((m) => m.height),
			cold.mouseChildren.map((m) => m.height),
		);
		// A fresh set of identical components (no cache entries) formats to the same bytes.
		const fresh = formatTranscriptChildren(mixedFixture(), width, theme);
		assert.deepEqual(fresh.lines, cold.lines);
		assert.deepEqual(
			fresh.mouseChildren.map((m) => m.height),
			cold.mouseChildren.map((m) => m.height),
		);
	});
}

test("child cache: an unchanged second frame runs zero formatter work", () => {
	const { theme, counter } = makeTheme();
	const kids = mixedFixture();
	formatTranscriptChildren(kids, 100, theme);
	assert.ok(counter.fg > 0, "first frame formats");
	counter.fg = 0;
	formatTranscriptChildren(kids, 100, theme);
	assert.equal(counter.fg, 0, "second frame must be served from the cache");
});

test("child cache: changed content, width or theme invalidates; streaming never serves stale output", () => {
	const { theme, counter } = makeTheme();
	const kids = mixedFixture();
	formatTranscriptChildren(kids, 100, theme);
	counter.fg = 0;

	// Streaming: the last user message grows by one line.
	const last = kids[kids.length - 1];
	last.__state.lines = [...last.__state.lines, "streamed token"];
	const out = formatTranscriptChildren(kids, 100, theme);
	assert.ok(counter.fg > 0, "changed child is re-formatted");
	assert.ok(stripAnsi(out.lines.join("\n")).includes("streamed token"), "new content is visible");
	const afterChange = counter.fg;
	counter.fg = 0;
	formatTranscriptChildren(kids, 100, theme);
	assert.equal(counter.fg, 0, "stable again after the change");
	assert.ok(afterChange < 40, `only the changed child was re-formatted (${afterChange} paints)`);

	// In-place mutation of the same array must also be noticed.
	last.__state.lines[0] = "mutated in place";
	const mutated = formatTranscriptChildren(kids, 100, theme);
	assert.ok(stripAnsi(mutated.lines.join("\n")).includes("mutated in place"));

	// Width change.
	counter.fg = 0;
	const narrow = formatTranscriptChildren(kids, 60, theme);
	assert.ok(counter.fg > 0);
	assert.ok(narrow.lines.length > 0);

	// Theme change (a different theme object with different paint).
	const other = makeTheme("b");
	const recolored = formatTranscriptChildren(kids, 60, other.theme);
	assert.ok(other.counter.fg > 0);
	assert.ok(recolored.lines.join("").includes("<b"));
	assert.ok(!recolored.lines.join("").includes("<aa"));
});

test("child cache: same theme object whose paint changes is not served stale", () => {
	const paint = { tag: "a" };
	const theme: any = {
		fg: (role: string, text: string) => `\x1b[38;5;1m<${paint.tag}${role}>${text}\x1b[39m`,
		bold: (t: string) => t,
	};
	const kids = mixedFixture();
	const first = formatTranscriptChildren(kids, 100, theme).lines.join("\n");
	paint.tag = "z";
	const second = formatTranscriptChildren(kids, 100, theme).lines.join("\n");
	assert.notEqual(first, second);
	assert.ok(second.includes("<z"));
});

test("child cache: group membership change (a bash call joins the group) rebuilds the group", () => {
	const { theme } = makeTheme();
	const a = make("ToolExecutionComponent", ["$ a", "out a"], { toolName: "bash" });
	const b = make("ToolExecutionComponent", ["$ b", "out b"], { toolName: "bash" });
	const one = formatTranscriptChildren([a], 100, theme).lines.join("\n");
	const two = formatTranscriptChildren([a, b], 100, theme).lines.join("\n");
	assert.ok(!one.includes("out b"));
	assert.ok(two.includes("out b"));
});

test("transform: transformTranscriptLines is idempotent and matches the uncached reference", () => {
	const { theme } = makeTheme();
	const lines = [
		"# Title",
		"plain",
		"```",
		"# in fence",
		"```",
		"## After",
		"╭─ Gentle AI ─ warning ─╮",
		"│ body line │",
		"╰───────────╯",
		"# Done",
	];
	const once = transformTranscriptLinesUncached(lines, theme);
	const cached = transformTranscriptLines(lines, theme);
	assert.deepEqual(cached, once, "first pass matches the uncached reference byte for byte");
	assert.deepEqual(transformTranscriptLines(lines, theme), once, "memoized pass matches");
	const twice = transformTranscriptLines(cached, theme);
	assert.deepEqual(twice, cached, "transform(transform(x)) === transform(x)");
	assert.deepEqual(transformTranscriptLines(transformTranscriptLines(twice, theme), theme), cached);
});

test("transform: memo reacts to theme paint change", () => {
	const paint = { tag: "a" };
	const theme: any = { fg: (r: string, t: string) => `<${paint.tag}${r}>${t}`, bold: (t: string) => `*${t}*` };
	const a = transformTranscriptLines(["╭─ Gentle AI ─╮"], theme)[0];
	paint.tag = "q";
	const b = transformTranscriptLines(["╭─ Gentle AI ─╮"], theme)[0];
	assert.notEqual(a, b);
	assert.equal(themeStamp(undefined), "");
});

test("perf: per-frame cost stays flat as history grows", () => {
	const { theme } = makeTheme();
	const build = (n: number) => {
		const kids: any[] = [];
		for (let i = 0; i < n; i++) {
			kids.push(
				make(
					i % 3 === 0 ? "UserMessageComponent" : "ToolExecutionComponent",
					body(i % 3 === 0 ? 4 : 12),
					i % 3 === 0 ? {} : { toolName: i % 2 ? "read" : "bash" },
				),
			);
			kids.push(make("Spacer", [""]));
		}
		return kids;
	};
	const frame = (kids: any[]) => transformTranscriptLines(formatTranscriptChildren(kids, 100, theme).lines, theme);
	const perFrame = (n: number) => {
		const kids = build(n);
		for (let i = 0; i < 5; i++) frame(kids);
		const iterations = 60;
		const t = performance.now();
		for (let i = 0; i < iterations; i++) frame(kids);
		return (performance.now() - t) / iterations;
	};
	const small = perFrame(20); // 40 children
	const large = perFrame(200); // 400 children
	// Uncached cost grows ~10x and costs several ms; cached it only pays cheap per-child bookkeeping.
	assert.ok(large < 3, `400 children cost ${large.toFixed(3)}ms (40 children ${small.toFixed(3)}ms)`);
});
