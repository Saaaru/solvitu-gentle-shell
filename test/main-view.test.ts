import { extensionDisplayName } from "../src/main-view.ts";
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
			{ name: "deploy", source: "extension", sourceInfo: { scope: "user", source: "npm:pi-btw", path: "/e/btw.ts" } },
			{ name: "mcp", source: "extension", sourceInfo: { scope: "user", path: "builtin:mcp" } },
		],
		getAllTools: () => [
			{ sourceInfo: { scope: "user", source: "npm:pi-btw", path: "/e/btw.ts" } },
			{ sourceInfo: { scope: "project", path: "/e/other.ts" } },
		],
		getMcpServers: () => [{ name: "m", config: { token: "abc", url: "http://x" } }],
	};
}

test("main view - collectItems orders extensions then MCP and dedupes extensions", () => {
	const items = collectItems(fakePi());
	assert.deepEqual(
		items.map((item) => `${item.kind}:${item.name}`),
		["extension:pi-btw", "extension:other.ts", "mcp:m"],
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
	assert.deepEqual(visited, ["pi-btw", "other.ts", "m"]);
});

test("main view - openItem reads extension files and falls back safely", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "main-view-"));
	try {
		const file = path.join(dir, "fix.md");
		fs.writeFileSync(file, "line one\nline two\n");
		const extension: MainItem = { kind: "extension", group: "user · extensions", name: "fix", path: file };
		const opened = openItem(extension);
		assert.equal(opened.title, "extension · fix");
		assert.deepEqual(opened.lines.slice(0, 2), ["line one", "line two"]);

		const directory: MainItem = { kind: "extension", group: "user · extensions", name: "pkg", path: dir };
		assert.match(openItem(directory).lines[0], /sin archivo legible/, "a directory is not read as a file");

		const missing: MainItem = { kind: "extension", group: "user · extensions", name: "gone", description: "Gone extension", path: path.join(dir, "nope.md") };
		assert.deepEqual(openItem(missing).lines, ["Gone extension"], "a missing file falls back to the description");

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

test("main view - extensionDisplayName names generic cli sources by package and file", () => {
	const B = String.fromCharCode(92);
	const win = (...parts: string[]) => parts.join(B);
	const gentlePi = win("C:", "Users", "mfuen", "AppData", "Roaming", "npm", "node_modules", "gentle-pi", "extensions", "orchestrator.ts");
	assert.equal(extensionDisplayName({ source: "cli", path: gentlePi }), "gentle-pi/orchestrator");
	assert.equal(
		extensionDisplayName({ source: "cli", path: win("C:", "x", "node_modules", "@scope", "pkg", "index.ts") }),
		"@scope/pkg",
		"an index file is named by its package",
	);
	assert.equal(extensionDisplayName({ source: "npm:pi-btw", path: win("C:", "x", "y.ts") }), "pi-btw", "a real source wins");
	assert.equal(extensionDisplayName({ source: "cli", path: win("C:", "proj", "ext", "foo.ts") }), "foo.ts");
	assert.equal(extensionDisplayName({ path: win("C:", "proj", "ext", "bar.ts") }), "bar.ts", "no source falls back to the file name");
});
