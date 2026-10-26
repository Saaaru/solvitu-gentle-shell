import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectItems, openItem, MainListCard, createMainState, moveSelection, type MainItem } from "../src/main-view.ts";

const theme = { fg: (_role: string, text: string) => text };

function fakePi(): any {
	return {
		getCommands: () => [
			{ name: "skill:alpha", source: "skill", sourceInfo: { scope: "user", source: "skills", path: "/s/alpha" }, description: "a" },
			{ name: "deploy", source: "extension", sourceInfo: { scope: "user", source: "npm:pi-btw", path: "/e/btw.ts" } },
			{ name: "fix", source: "prompt", sourceInfo: { scope: "user", path: "/p/fix.md" }, description: "Fix it" },
			{ name: "mcp", source: "extension", sourceInfo: { scope: "user", path: "builtin:mcp" } },
			{ name: "review", source: "prompt", sourceInfo: { scope: "project", path: "/p/review.md" }, description: "Review" },
		],
		getAllTools: () => [
			{ sourceInfo: { scope: "user", source: "npm:pi-btw", path: "/e/btw.ts" } },
			{ sourceInfo: { scope: "project", path: "/e/other.ts" } },
		],
		getMcpServers: () => [{ name: "m", config: { token: "abc", url: "http://x" } }],
	};
}

test("main view - collectItems orders skills, prompts, extensions, then MCP and dedupes extensions", () => {
	const items = collectItems(fakePi());
	assert.deepEqual(
		items.map((item) => `${item.kind}:${item.name}`),
		["skill:alpha", "prompt:/fix", "prompt:/review", "extension:pi-btw", "extension:other.ts", "mcp:m"],
	);
	assert.equal(items.filter((item) => item.name === "pi-btw").length, 1, "same extension path is listed once");
	assert.ok(!items.some((item) => String(item.path).startsWith("builtin:")), "built-in extensions are skipped");
});

test("main view - selection order follows the order the list card draws", () => {
	const state = createMainState(fakePi());
	new MainListCard(state, theme).render(60);
	const drawn = state.rows.filter((index) => index >= 0);
	assert.deepEqual(drawn, state.items.map((_item, index) => index), "rows appear in the same order as the items");

	// Walking with moveSelection therefore moves the marker downwards one row at a time.
	const visited: string[] = [];
	for (let step = 0; step < state.items.length; step++) {
		visited.push(state.items[state.selected].name);
		moveSelection(state, 1);
	}
	assert.deepEqual(visited, ["alpha", "/fix", "/review", "pi-btw", "other.ts", "m"]);
});

test("main view - openItem reads prompt and extension files and falls back safely", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "main-view-"));
	try {
		const promptFile = path.join(dir, "fix.md");
		fs.writeFileSync(promptFile, "line one\nline two\n");
		const prompt: MainItem = { kind: "prompt", group: "user · prompts", name: "/fix", description: "Fix it", path: promptFile };
		const opened = openItem(prompt);
		assert.equal(opened.title, "prompt · /fix");
		assert.deepEqual(opened.lines.slice(0, 2), ["line one", "line two"]);

		const directory: MainItem = { kind: "extension", group: "user · extensions", name: "pkg", path: dir };
		assert.match(openItem(directory).lines[0], /sin archivo legible/, "a directory is not read as a file");

		const missing: MainItem = { kind: "prompt", group: "user · prompts", name: "/gone", description: "Gone prompt", path: path.join(dir, "nope.md") };
		assert.deepEqual(openItem(missing).lines, ["Gone prompt"], "a missing file falls back to the description");

		const noPath: MainItem = { kind: "extension", group: "user · extensions", name: "x" };
		assert.match(openItem(noPath).lines[0], /sin ruta/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("main view - MCP viewer still masks secrets", () => {
	const items = collectItems(fakePi());
	const mcp = items.find((item) => item.kind === "mcp")!;
	const text = openItem(mcp).lines.join("\n");
	assert.ok(!text.includes("abc"), "the token value is masked");
	assert.ok(text.includes("http://x"));
});
