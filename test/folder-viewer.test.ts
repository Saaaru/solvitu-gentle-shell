import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { WorkspaceProjectTreeCard } from "../src/solvi-tree.ts";
import { FolderState, getFolderState } from "../src/tree/folder-state.ts";
import { WorkspaceFileViewerCard } from "../src/tree/file-viewer-card.ts";
import { registerTreeKeys } from "../src/tree/tree-keys.ts";
import { buildSidebarRailLines } from "../src/sidebar-rail-builder.ts";
import { sidebarState, SIDEBAR_TAB_CARD_MAP, resolveSidebarTab } from "../src/sidebar.ts";
import { footerRegistry } from "../src/footer/footer-registry.ts";
import { resetAll } from "./test-helpers.ts";

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const mockTui = (): any => ({ terminal: { columns: 160, rows: 50 }, requestRender: () => {} });

function makeProject(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solvi-folder-viewer-"));
	fs.mkdirSync(path.join(dir, "a"));
	fs.writeFileSync(path.join(dir, "a", "b.txt"), "bee\n");
	fs.writeFileSync(path.join(dir, "a", "c.txt"), "sea\n");
	fs.mkdirSync(path.join(dir, "d"));
	fs.writeFileSync(path.join(dir, "d", "e.txt"), "eee\n");
	fs.writeFileSync(path.join(dir, "f.txt"), "line1\nline2\nline3\n");
	return dir;
}

test("folder tree - cursor starts on the first row and moveCursor respects bounds", () => {
	const dir = makeProject();
	try {
		const state = new FolderState();
		const card = new WorkspaceProjectTreeCard(undefined, mockTui(), undefined, dir, state);
		assert.equal(card.getCursorPath(), "a");
		card.moveCursor(1);
		assert.equal(card.getCursorPath(), "d");
		card.moveCursor(1);
		assert.equal(card.getCursorPath(), "f.txt");
		card.moveCursor(1);
		assert.equal(card.getCursorPath(), "f.txt", "cursor must stop at the last row");
		card.moveCursor(-10);
		assert.equal(card.getCursorPath(), "a", "cursor must stop at the first row");
		assert.equal(state.cursorPath, "a", "cursor is shared through the folder state");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("folder tree - expand, open, collapse and parent navigation", () => {
	const dir = makeProject();
	try {
		const state = new FolderState();
		const card = new WorkspaceProjectTreeCard(undefined, mockTui(), undefined, dir, state);
		card.expandOrOpen();
		assert.ok(card.getExpandedDirs().has("a"), "expandOrOpen expands a directory");
		card.expandOrOpen();
		assert.equal(card.getCursorPath(), path.join("a", "b.txt"), "second expandOrOpen enters the directory");
		card.expandOrOpen();
		assert.equal(state.previewPath, path.join("a", "b.txt"), "opening a file sets the previewed file");
		card.moveCursor(1);
		card.collapseOrUp();
		assert.equal(card.getCursorPath(), "a", "collapseOrUp on a file moves to the parent");
		card.collapseOrUp();
		assert.ok(!card.getExpandedDirs().has("a"), "collapseOrUp on an expanded dir collapses it");
		card.collapseOrUp();
		assert.equal(card.getCursorPath(), "a", "top-level collapsed dir has no parent to go to");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("folder tree - renders a cursor marker, keeps it visible and mouse click previews a file", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solvi-folder-many-"));
	try {
		for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(dir, `file${String(i).padStart(2, "0")}.txt`), "x");
		const state = new FolderState();
		const card = new WorkspaceProjectTreeCard(undefined, mockTui(), undefined, dir, state);
		const first = card.render(44, 12).map(strip);
		assert.ok(first.some((l) => l.includes("›") && l.includes("file00.txt")), "cursor row carries the marker");
		for (let i = 0; i < 30; i++) card.moveCursor(1);
		const moved = card.render(44, 12).map(strip);
		assert.ok(moved.some((l) => l.includes("›") && l.includes("file30.txt")), "window follows the cursor");
		assert.equal(moved.length, 12);
		const wide = card.render(90, 12).map(strip).join("\n");
		assert.ok(wide.includes("wheel scroll") && wide.includes("alt+c/x"), "footer hint mentions wheel and keys");

		const hit = card.getHitboxes().find((h) => h.type === "open-file" && h.node?.name === "file30.txt");
		assert.ok(hit, "hitbox for the cursor file");
		card.handleRailClick(hit!.lineIndex, "left", hit!.startX);
		assert.equal(state.previewPath, "file30.txt", "click on a file sets the previewed file");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("file viewer - empty state, text file, line numbers and exact widths", () => {
	const dir = makeProject();
	try {
		const state = new FolderState(dir);
		const viewer = new WorkspaceFileViewerCard(state, undefined, dir);
		for (const width of [30, 44, 50]) {
			const empty = viewer.render(width, 10);
			assert.equal(empty.length, 10);
			for (const line of empty) assert.equal(visibleWidth(line), width);
			assert.ok(empty.map(strip).join("\n").includes("Selecciona un archivo"));
		}
		state.openFile("f.txt");
		for (const width of [30, 44, 50]) {
			const lines = viewer.render(width, 10);
			assert.equal(lines.length, 10);
			for (const line of lines) assert.equal(visibleWidth(line), width, `width ${width}`);
			const text = lines.map(strip).join("\n");
			assert.ok(text.includes("f.txt"), "title shows the relative path");
			assert.ok(text.includes("1") && text.includes("line1"), "line number and content");
			assert.ok(text.includes("line3"));
		}
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("file viewer - missing file, directory and binary file are handled safely", () => {
	const dir = makeProject();
	try {
		fs.writeFileSync(path.join(dir, "bin.dat"), Buffer.from([1, 2, 0, 3, 4]));
		const state = new FolderState(dir);
		const viewer = new WorkspaceFileViewerCard(state, undefined, dir);
		state.openFile("nope.txt");
		assert.ok(viewer.render(44, 10).map(strip).join("\n").includes("no encontrado"));
		state.openFile("a");
		assert.ok(viewer.render(44, 10).map(strip).join("\n").includes("directorio"));
		state.openFile("bin.dat");
		const bin = viewer.render(44, 10);
		assert.ok(bin.map(strip).join("\n").includes("archivo binario"));
		for (const line of bin) assert.equal(visibleWidth(line), 44);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("file viewer - large files are truncated at 256 KB with a note", () => {
	const dir = makeProject();
	try {
		const big = "0123456789abcdef\n".repeat(30000); // ~510 KB
		fs.writeFileSync(path.join(dir, "big.txt"), big);
		const state = new FolderState(dir);
		const viewer = new WorkspaceFileViewerCard(state, undefined, dir);
		state.openFile("big.txt");
		const lines = viewer.render(50, 10);
		for (const line of lines) assert.equal(visibleWidth(line), 50);
		viewer.scrollTo(1_000_000);
		const end = viewer.render(50, 10).map(strip).join("\n");
		assert.ok(end.includes("truncado"), "truncation note appears at the end of the preview");
		assert.ok(state.viewerScroll < 20000, "scroll is clamped to the 256 KB slice");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("file viewer - scroll is clamped and indicators show remaining lines", () => {
	const dir = makeProject();
	try {
		fs.writeFileSync(path.join(dir, "long.txt"), Array.from({ length: 50 }, (_, i) => `row${i}`).join("\n"));
		const state = new FolderState(dir);
		const viewer = new WorkspaceFileViewerCard(state, undefined, dir);
		state.openFile("long.txt");
		let text = viewer.render(44, 10).map(strip).join("\n");
		assert.ok(text.includes("abajo") && !text.includes("arriba"));
		viewer.scrollBy(-5);
		assert.equal(state.viewerScroll, 0, "cannot scroll above the first line");
		viewer.scrollBy(5);
		assert.equal(state.viewerScroll, 5);
		text = viewer.render(44, 10).map(strip).join("\n");
		assert.ok(text.includes("arriba") && text.includes("row5"));
		viewer.scrollBy(10_000);
		const max = state.viewerScroll;
		assert.ok(max > 0 && max < 50);
		const last = viewer.render(44, 10).map(strip).join("\n");
		assert.ok(last.includes("row49"), "last line reachable");
		assert.ok(!last.includes("abajo"));
		viewer.scrollBy(1);
		assert.equal(state.viewerScroll, max, "cannot scroll below the end");
		state.openFile("f.txt");
		assert.equal(state.viewerScroll, 0, "opening another file resets scroll");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("folder tab - cards map and 50/50 height split", () => {
	resetAll();
	assert.deepEqual(SIDEBAR_TAB_CARD_MAP.tree, ["projectTree", "fileViewer"]);
	assert.deepEqual(resolveSidebarTab("tree").cards, ["projectTree", "fileViewer"]);

	const heights: Record<string, number | undefined> = {};
	const stub = (key: string) => ({
		render: (_w: number, h?: number) => {
			heights[key] = h;
			return Array.from({ length: h ?? 1 }, () => "x");
		},
		invalidate: () => {},
	});
	const tui: any = { terminal: { columns: 160, rows: 54 }, requestRender: () => {} };
	const state = sidebarState(tui);
	state.activeTabId = "tree";
	state.parts.set("projectTree", stub("projectTree") as any);
	state.parts.set("fileViewer", stub("fileViewer") as any);
	const result = buildSidebarRailLines({
		state,
		tui,
		theme: undefined,
		activeDock: null,
		activeTranscript: { viewportHeight: 48 },
		contentWidth: 60,
	});
	assert.equal(result.success, true);
	assert.ok(heights.projectTree && heights.fileViewer, "both cards receive a height");
	assert.ok(Math.abs(heights.projectTree! - heights.fileViewer!) <= 1, `${heights.projectTree} vs ${heights.fileViewer}`);
	assert.ok(heights.projectTree! >= 10);
	assert.equal(result.sectionMappings.length, 2);
	resetAll();
});

test("folder keys - act only on the FLDR tab and re-render", () => {
	const dir = makeProject();
	try {
		const shortcuts = new Map<string, () => void>();
		registerTreeKeys({ registerShortcut: (id: string, opts: any) => shortcuts.set(id, opts.handler) } as any);
		assert.deepEqual([...shortcuts.keys()].sort(), ["alt+,", "alt+.", "alt+pagedown", "alt+pageup", "alt+c", "alt+x"].sort());

		let renders = 0;
		const tui: any = { terminal: { columns: 160, rows: 50 }, requestRender: () => renders++ };
		const folder = getFolderState(tui);
		const card = new WorkspaceProjectTreeCard(undefined, tui, undefined, dir, folder);
		void card;
		footerRegistry.latestTodoTui = tui;

		sidebarState(tui).activeTabId = "git";
		shortcuts.get("alt+x")!();
		assert.equal(folder.cursorPath, undefined, "inert on other tabs");
		assert.equal(renders, 0);

		sidebarState(tui).activeTabId = "tree";
		shortcuts.get("alt+x")!();
		assert.equal(folder.cursorPath, "d");
		shortcuts.get("alt+c")!();
		assert.equal(folder.cursorPath, "a");
		shortcuts.get("alt+.")!();
		assert.ok(card.getExpandedDirs().has("a"));
		assert.ok(renders >= 3, "each action requests a render");
	} finally {
		footerRegistry.latestTodoTui = undefined;
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
