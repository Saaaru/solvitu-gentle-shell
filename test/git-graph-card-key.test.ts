import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceGitGraphCard } from "../src/git/git-graph-card.ts";
import { buildSidebarRailLines } from "../src/sidebar-rail-builder.ts";
import { awaitGitIdle, clearAllGitCaches, setGitRunner } from "../src/git/git-swr.ts";
import { setGitTabViewMode } from "../src/git/git-state.ts";
import { resetAll } from "./test-helpers.ts";

const CWD = "/virtual/repo";

let outputs: Record<string, string> = {};
function fakeRunner(args: string[]): Promise<string> {
	const key = args[0] === "diff" ? "numstat" : args[0];
	return Promise.resolve(outputs[key] ?? "");
}

function setup() {
	resetAll();
	outputs = {
		status: " M a.txt\n",
		numstat: "3\t1\ta.txt\n",
		log: "* abc123 init\n* def456 second\n",
		"for-each-ref": "refs/heads/main\tmain\torigin/main\t[ahead 2, behind 1]\t2 hours ago\n",
	};
	setGitRunner(fakeRunner);
	clearAllGitCaches();
}

const theme: any = { fg: (_r: string, t: string) => `\x1b[38;5;1m${t}\x1b[39m`, bold: (t: string) => t };

function mockTui(): any {
	return { requestRender() {}, terminal: { rows: 50, columns: 120 }, cwd: CWD, __solviCtx: { scopedModels: [], sessionManager: { getEntries: () => [] } } };
}

test("git graph card: render key is stable while nothing changes and moves with each input", async () => {
	setup();
	try {
		const tui = mockTui();
		const card = new WorkspaceGitGraphCard({ cwd: CWD } as any, tui, theme);
		card.getRenderKey(44, 20); // cold: schedules the load
		await awaitGitIdle();
		const base = card.getRenderKey(44, 20);
		assert.equal(card.getRenderKey(44, 20), base, "unchanged inputs give the same key");
		assert.notEqual(card.getRenderKey(50, 20), base, "width");
		assert.notEqual(card.getRenderKey(44, 30), base, "height");
		card.setExpanded(false);
		assert.notEqual(card.getRenderKey(44, 20), base, "collapsed state");
		card.setExpanded(true);
		assert.equal(card.getRenderKey(44, 20), base);
		setGitTabViewMode("branches", tui);
		assert.notEqual(card.getRenderKey(44, 20), base, "view mode");
		setGitTabViewMode("graph", tui);
		assert.equal(card.getRenderKey(44, 20), base);

		// New git data shows up in the key as soon as the SWR store publishes it.
		outputs.log = "* abc123 init\n* def456 second\n* 999999 third\n";
		card.invalidate();
		card.getRenderKey(44, 20);
		await awaitGitIdle();
		assert.notEqual(card.getRenderKey(44, 20), base, "git data");
	} finally {
		setGitRunner(undefined);
	}
});

test("git graph card: the rail skips its render while stable and refreshes on async git completion", async () => {
	setup();
	try {
		const tui = mockTui();
		const card = new WorkspaceGitGraphCard({ cwd: CWD } as any, tui, theme);
		let renders = 0;
		const original = card.render.bind(card);
		card.render = (w: number, h?: number) => {
			renders++;
			return original(w, h);
		};
		const state: any = { parts: new Map(), activeTabId: "git" };
		state.parts.set("gitGraph", card);
		state.parts.set("workingTree", { render: () => ["wt"], invalidate() {} });
		state.parts.set("todo", { render: () => ["todo"], invalidate() {} });
		const build = () => buildSidebarRailLines({ state, tui, theme, activeDock: undefined, activeTranscript: undefined, contentWidth: 44 });

		build();
		await awaitGitIdle();
		const first = build();
		const afterLoad = renders;
		assert.ok(first.railLines.join("\n").includes("def456"), "loaded git graph is shown");
		build();
		build();
		assert.equal(renders, afterLoad, "stable frames do not render the git card");

		outputs.log = "* abc123 init\n* def456 second\n* 777777 newest\n";
		card.invalidate();
		build();
		await awaitGitIdle();
		const refreshed = build();
		assert.ok(renders > afterLoad, "async completion re-renders");
		assert.ok(refreshed.railLines.join("\n").includes("777777"), "new commit is visible immediately after completion");
	} finally {
		setGitRunner(undefined);
	}
});

test("working tree card: render key is stable and follows file changes, size and expansion", async () => {
	const { WorkspaceWorkingTreeCard } = await import("../src/git/git-working-tree-card.ts");
	setup();
	try {
		const tui = mockTui();
		const card = new WorkspaceWorkingTreeCard({ cwd: CWD } as any, tui, theme);
		card.getRenderKey(44, 20);
		await awaitGitIdle();
		const base = card.getRenderKey(44, 20);
		assert.equal(card.getRenderKey(44, 20), base);
		assert.notEqual(card.getRenderKey(60, 20), base, "width");
		card.toggleExpanded();
		assert.notEqual(card.getRenderKey(44, 20), base, "expansion");
		card.toggleExpanded();
		assert.equal(card.getRenderKey(44, 20), base);
		outputs.status = " M a.txt\n M b.txt\n";
		outputs.numstat = "3\t1\ta.txt\n5\t0\tb.txt\n";
		card.invalidate();
		card.getRenderKey(44, 20);
		await awaitGitIdle();
		assert.notEqual(card.getRenderKey(44, 20), base, "file list");
	} finally {
		setGitRunner(undefined);
	}
});
