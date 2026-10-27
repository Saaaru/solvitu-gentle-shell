import test from "node:test";
import assert from "node:assert/strict";
import { buildSidebarRailLines } from "../src/sidebar-rail-builder.ts";
import { resetAll } from "./test-helpers.ts";

const PROBE = "​";

function makeTheme(tag = "a") {
	const code = tag === "a" ? 1 : 2;
	return {
		fg: (_role: string, text: string) => `\x1b[38;5;${code}m${text}\x1b[39m`,
		bold: (t: string) => t,
	} as any;
}

/** Card with a version signal: render is only needed when `version` (or width/height) changed. */
function versionedCard(label: string, rowsOf = 3) {
	const card: any = {
		version: 1,
		renders: 0,
		keyCalls: 0,
		text: label,
		render(width: number, height?: number) {
			card.renders++;
			const w = Math.max(10, width);
			const rows = height && height > 5 ? 4 : rowsOf;
			return Array.from({ length: rows }, (_, i) => `${card.text} v${card.version} r${i} w${w}`.padEnd(w, " "));
		},
		getRenderKey() {
			card.keyCalls++;
			return `v${card.version}`;
		},
		invalidate() {},
	};
	return card;
}

/** Card without any version signal (the fallback path). */
function plainCard(label: string) {
	const card: any = {
		renders: 0,
		tick: 0,
		render(width: number) {
			card.renders++;
			return [`${label} t${card.tick}`.padEnd(Math.max(10, width), " ")];
		},
		invalidate() {},
	};
	return card;
}

function setup(tab: string) {
	resetAll();
	const state: any = { parts: new Map(), activeTabId: tab };
	const tui: any = {
		requestRender() {},
		terminal: { rows: 50, columns: 120 },
		cwd: process.cwd(),
		__solviCtx: { scopedModels: [], sessionManager: { getEntries: () => [] } },
	};
	const theme = makeTheme();
	const build = (contentWidth = 44, t = theme) =>
		buildSidebarRailLines({ state, tui, theme: t, activeDock: undefined, activeTranscript: undefined, contentWidth });
	return { state, tui, theme, build };
}

test("rail cache: second frame with unchanged state renders zero cards", () => {
	const { state, build } = setup("git");
	const graph = versionedCard("graph");
	const tree = versionedCard("tree");
	const todo = versionedCard("todo");
	state.parts.set("gitGraph", graph);
	state.parts.set("workingTree", tree);
	state.parts.set("todo", todo);
	const first = build();
	assert.equal(first.success, true);
	const rendersAfterFirst = [graph.renders, tree.renders, todo.renders];
	const second = build();
	assert.deepEqual([graph.renders, tree.renders, todo.renders], rendersAfterFirst, "no card rendered again");
	assert.deepEqual(second.railLines, first.railLines);
	assert.deepEqual(second.sectionMappings.map((m) => [m.key, m.startLine, m.lineCount]), first.sectionMappings.map((m) => [m.key, m.startLine, m.lineCount]));
});

test("rail cache: the todo tab renders each prior card once per cold build", () => {
	const { state, build } = setup("git");
	const graph = versionedCard("graph");
	const tree = versionedCard("tree");
	const todo = versionedCard("todo");
	state.parts.set("gitGraph", graph);
	state.parts.set("workingTree", tree);
	state.parts.set("todo", todo);
	build();
	assert.equal(graph.renders, 1);
	assert.equal(tree.renders, 1);
});

test("rail cache: a bumped card version re-renders only that card and shows the new content", () => {
	const { state, build } = setup("git");
	const graph = versionedCard("graph");
	const tree = versionedCard("tree");
	const todo = versionedCard("todo");
	state.parts.set("gitGraph", graph);
	state.parts.set("workingTree", tree);
	state.parts.set("todo", todo);
	build();
	const before = [graph.renders, tree.renders, todo.renders];
	tree.version++;
	const out = build();
	assert.equal(graph.renders, before[0]);
	assert.equal(tree.renders, before[1] + 1);
	assert.equal(todo.renders, before[2]);
	assert.ok(out.railLines.join("\n").includes("tree v2"));
	assert.ok(!out.railLines.join("\n").includes("tree v1"));
});

test("rail cache: width change and theme change invalidate", () => {
	const { state, build, theme } = setup("git");
	const graph = versionedCard("graph");
	state.parts.set("gitGraph", graph);
	state.parts.set("workingTree", versionedCard("tree"));
	state.parts.set("todo", versionedCard("todo"));
	build(44);
	const r0 = graph.renders;
	const wide = build(60);
	assert.ok(graph.renders > r0, "new width re-renders");
	assert.ok(wide.railLines.some((l) => l.includes("w58")), "content follows the new width");
	const r1 = graph.renders;
	build(60, makeTheme("b"));
	assert.ok(graph.renders > r1, "new theme re-renders");
});

test("rail cache: cards without a version signal still update every frame (animated / fallback)", () => {
	const { state, build } = setup("solvi");
	const ticker = plainCard("solvi");
	state.parts.set("solviTab", ticker);
	const a = build();
	assert.ok(a.railLines.join("\n").includes("solvi t0"));
	ticker.tick = 1;
	const b = build();
	assert.ok(b.railLines.join("\n").includes("solvi t1"), "animation frame shows immediately");
	assert.equal(ticker.renders, 2);
	const c = build();
	assert.deepEqual(c.railLines, b.railLines);
});

test("rail cache: tab switch is immediate and switching back is correct", () => {
	const { state, build } = setup("git");
	state.parts.set("gitGraph", versionedCard("graph"));
	state.parts.set("workingTree", versionedCard("tree"));
	state.parts.set("todo", versionedCard("todo"));
	state.parts.set("solviTab", plainCard("solvi"));
	const git1 = build();
	state.activeTabId = "solvi";
	const solvi = build();
	assert.ok(solvi.railLines.join("\n").includes("solvi t0"));
	assert.ok(!solvi.railLines.join("\n").includes("graph v1"));
	assert.notDeepEqual(solvi.tabBarLineIndex, -1);
	state.activeTabId = "git";
	const git2 = build();
	assert.deepEqual(git2.railLines, git1.railLines);
});

for (const width of [40, 80, 120]) {
	test(`rail cache: memoized output is byte-identical to a cold build at content width ${width}`, () => {
		const make = () => {
			const { state, build } = setup("git");
			state.parts.set("gitGraph", versionedCard("graph"));
			state.parts.set("workingTree", versionedCard("tree"));
			state.parts.set("todo", versionedCard("todo"));
			return build;
		};
		const warmBuild = make();
		warmBuild(width);
		const warm = warmBuild(width);
		const cold = make()(width);
		assert.deepEqual(warm.railLines, cold.railLines);
		assert.deepEqual(warm.tabHitboxes, cold.tabHitboxes);
		assert.equal(warm.tabBarLineIndex, cold.tabBarLineIndex);
		assert.equal(warm.tabBarDividerLineIndex, cold.tabBarDividerLineIndex);
	});
}

test("rail cache: per-frame cost does not grow with card render cost when versions are stable", () => {
	const { state, build } = setup("git");
	const heavy = versionedCard("graph");
	// Simulate an expensive card: busy-wait ~0.5ms per render.
	const render = heavy.render;
	heavy.render = (w: number, h?: number) => {
		const t = performance.now();
		while (performance.now() - t < 0.5);
		return render(w, h);
	};
	state.parts.set("gitGraph", heavy);
	state.parts.set("workingTree", versionedCard("tree"));
	state.parts.set("todo", versionedCard("todo"));
	build();
	const t = performance.now();
	for (let i = 0; i < 100; i++) build();
	const perFrame = (performance.now() - t) / 100;
	assert.ok(perFrame < 0.4, `stable frame cost ${perFrame.toFixed(3)}ms`);
	void PROBE;
});

test("rail cache: edge, border and divider columns are reused until rows, width or theme change", async () => {
	const { filledColumn } = await import("../src/sidebar.ts");
	const theme = makeTheme();
	let made = 0;
	const make = () => {
		made++;
		return "x";
	};
	const a = filledColumn("k", 30, 4, theme, make);
	assert.equal(a.length, 30);
	assert.equal(filledColumn("k", 30, 4, theme, make), a, "same inputs reuse the array");
	assert.equal(made, 1);
	assert.notEqual(filledColumn("k", 31, 4, theme, make), a, "rows");
	assert.notEqual(filledColumn("k", 30, 5, theme, make), a, "width");
	assert.notEqual(filledColumn("k", 30, 4, makeTheme("b"), make), a, "theme");
	assert.notEqual(filledColumn("other", 30, 4, theme, make), a, "kind");
});
