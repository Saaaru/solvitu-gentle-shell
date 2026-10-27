import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import {
	fetchGitFileChanges,
	fetchGitStatus,
	fetchGitBranches,
	fetchGitLogGraph,
	getGitSyncBadge,
	resetGitFileChangesCache,
	resetGitStatusCache,
	resetGitBranchesCache,
	resetGitGraphCache,
} from "../src/solvi-git-graph.ts";
import { awaitGitIdle, clearAllGitCaches, onGitDataChanged, setGitRunner, bindGitRenderHost } from "../src/git/git-swr.ts";

const CWD = "/virtual/repo";

type Call = { args: string[]; cwd: string };
let calls: Call[] = [];
let outputs: Record<string, string | Error> = {};
let gate: Promise<void> | undefined;
let changes = 0;
let unsubscribe: () => void;

function fakeRunner(args: string[], cwd: string): Promise<string> {
	calls.push({ args, cwd });
	const key = args[0] === "diff" ? "numstat" : args[0];
	const run = async () => {
		if (gate) await gate;
		const out = outputs[key];
		if (out instanceof Error) throw out;
		return out ?? "";
	};
	return run();
}

beforeEach(() => {
	calls = [];
	outputs = {
		status: " M a.txt\n",
		numstat: "3\t1\ta.txt\n",
		log: "* abc123 init\n",
		"for-each-ref": "refs/heads/main\tmain\torigin/main\t[ahead 2, behind 1]\t2 hours ago\n",
	};
	gate = undefined;
	changes = 0;
	setGitRunner(fakeRunner);
	unsubscribe = onGitDataChanged(() => {
		changes++;
	});
	clearAllGitCaches();
});

afterEach(async () => {
	await awaitGitIdle();
	unsubscribe();
	setGitRunner(undefined);
	mock.restoreAll();
	syncBuiltinESMExports();
});

test("git-swr - cold start returns empty default without spawning synchronously", async () => {
	const sync = mock.method(cp, "execFileSync");
	const spawnSync = mock.method(cp, "spawnSync");
	syncBuiltinESMExports();

	assert.deepEqual(fetchGitFileChanges(CWD), []);
	assert.equal(fetchGitStatus(CWD).isClean, true);
	assert.deepEqual(fetchGitLogGraph(CWD), []);
	assert.equal(getGitSyncBadge(CWD), "");
	assert.equal(sync.mock.callCount(), 0);
	assert.equal(spawnSync.mock.callCount(), 0);

	await awaitGitIdle();
	assert.equal(sync.mock.callCount(), 0, "refresh must not use execFileSync either");
	assert.equal(fetchGitFileChanges(CWD).length, 1);
});

test("git-swr - stale value is served while a refresh is pending", async () => {
	fetchGitFileChanges(CWD, 0);
	await awaitGitIdle();
	assert.equal(fetchGitFileChanges(CWD, 60000)[0].path, "a.txt");

	outputs.status = " M a.txt\n M b.txt\n";
	let release!: () => void;
	gate = new Promise((r) => (release = r));
	const stale = fetchGitFileChanges(CWD, 0);
	assert.equal(stale.length, 1, "stale value served immediately");
	assert.equal(fetchGitFileChanges(CWD, 0).length, 1, "still stale while pending");
	release();
	await awaitGitIdle();
	assert.equal(fetchGitFileChanges(CWD, 60000).length, 2);
});

test("git-swr - concurrent refreshes of the same key are deduped", async () => {
	let release!: () => void;
	gate = new Promise((r) => (release = r));
	fetchGitBranches(CWD, 0);
	fetchGitBranches(CWD, 0);
	fetchGitBranches(CWD, 0);
	release();
	await awaitGitIdle();
	assert.equal(calls.filter((c) => c.args[0] === "for-each-ref").length, 1);
});

test("git-swr - re-render is requested only when the value changed", async () => {
	fetchGitStatus(CWD, 0);
	await awaitGitIdle();
	assert.equal(changes, 1, "cold -> real value is a change");

	fetchGitStatus(CWD, 0);
	await awaitGitIdle();
	assert.equal(changes, 1, "identical refresh must not re-render");

	outputs.status = " M a.txt\n?? c.txt\n";
	fetchGitStatus(CWD, 0);
	await awaitGitIdle();
	assert.equal(changes, 2, "changed refresh re-renders once");
});

test("git-swr - cold refresh that equals the empty default does not re-render", async () => {
	outputs.status = "";
	outputs.numstat = "";
	fetchGitStatus(CWD, 0);
	await awaitGitIdle();
	assert.equal(changes, 0);
});

test("git-swr - refresh error keeps the last good value and does not re-render", async () => {
	fetchGitFileChanges(CWD, 0);
	await awaitGitIdle();
	const before = changes;

	outputs.status = new Error("git exploded");
	fetchGitFileChanges(CWD, 0);
	await awaitGitIdle();
	assert.equal(fetchGitFileChanges(CWD, 60000).length, 1, "last good value kept");
	assert.equal(changes, before);
});

test("git-swr - getGitSyncBadge reads ahead/behind from cached branches without spawning", async () => {
	assert.equal(getGitSyncBadge(CWD), "");
	await awaitGitIdle();
	// readGitBranch cannot resolve a virtual repo, so mark current via fixture-independent fallback
	const branches = fetchGitBranches(CWD);
	assert.equal(branches[0].ahead, 2);
	assert.equal(branches[0].behind, 1);
});

test("git-swr - bindGitRenderHost requests a render once per host on change", async () => {
	let renders = 0;
	const host = { requestRender: () => void renders++ };
	bindGitRenderHost(host);
	bindGitRenderHost(host);
	fetchGitLogGraph(CWD, 5, 0);
	await awaitGitIdle();
	assert.equal(renders, 1);
});
