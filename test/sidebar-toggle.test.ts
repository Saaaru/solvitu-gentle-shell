import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { installSidebar, sidebarState } from "../src/sidebar.ts";
import {
	isSidebarVisible,
	setSidebarVisible,
	toggleSidebar,
	resetSidebarVisibility,
	sidebarStatePath,
	readSidebarVisibility,
	registerSidebarToggle,
} from "../src/sidebar-visibility.ts";
import { footerRegistry } from "../src/footer/footer-registry.ts";
import { loadSolviLayout } from "../src/solvi-layout.ts";
import { memoizeChildCard } from "../src/transcript/transcript-child-cache.ts";
import { resetAll } from "./test-helpers.ts";

const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

function setup(columns = 160) {
	resetAll();
	resetSidebarVisibility();
	setSidebarVisible(true, { persist: false });
	const chat: any = { render: () => ["chat"], invalidate() {} };
	const editorDock: any = { render: () => ["editor"], invalidate() {} };
	const foreignRail: any = { render: () => ["foreign"], invalidate() {} };
	const left: any = { render: () => ["left"], invalidate() {}, editorDock };
	const root: any = { render: () => ["root"], invalidate() {} };
	root[NODE] = () => ({
		type: "hstack",
		entries: [
			{ component: left, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: foreignRail, basis: 40, grow: 0, shrink: 0, minSize: 40 },
		],
	});
	let renders = 0;
	const tui: any = { terminal: { columns, rows: 40 }, mode: "fullscreen", layoutRoot: root, requestRender: () => renders++ };
	const card = { renders: 0, render() { card.renders++; return ["card line"]; }, invalidate() {} };
	const state = sidebarState(tui);
	state.parts.set("ecosystem", card as any);
	const cleanup = installSidebar(tui);
	return { tui, root, left, foreignRail, card, cleanup, requests: () => renders };
}

const summarize = (node: any) => node.entries.map((e: any) => ({ basis: e.basis, grow: e.grow, c: e.component }));

test("sidebar toggle - visible by default and hidden skips rail, dividers and card renders", () => {
	const s = setup();
	try {
		assert.equal(isSidebarVisible(), true);
		const visible = s.root[NODE]();
		assert.ok(visible.entries.length >= 3, "rail + divider mounted when visible");
		const rendersWhenVisible = s.card.renders;
		assert.ok(rendersWhenVisible > 0);

		setSidebarVisible(false, { persist: false });
		const hidden = s.root[NODE]();
		assert.equal(hidden.type, "hstack");
		assert.equal(hidden.entries.length, 1, "only the chat/left component remains");
		assert.equal(hidden.entries[0].component, s.left);
		assert.equal(hidden.entries[0].grow, 1);
		assert.equal(s.card.renders, rendersWhenVisible, "no card rendered while hidden");
		assert.equal(sidebarState(s.tui).active, false);
		assert.ok(!hidden.entries.some((e: any) => e.component === s.foreignRail));
	} finally {
		s.cleanup();
	}
});

test("sidebar toggle - toggling back restores an identical sidebar", () => {
	const s = setup();
	try {
		const before = summarize(s.root[NODE]());
		const linesBefore = before[before.length - 1].c.render(52).slice();
		setSidebarVisible(false, { persist: false });
		s.root[NODE]();
		setSidebarVisible(true, { persist: false });
		const after = summarize(s.root[NODE]());
		assert.equal(after.length, before.length);
		assert.deepEqual(after.map((e: any) => [e.basis, e.grow]), before.map((e: any) => [e.basis, e.grow]));
		assert.deepEqual(after[after.length - 1].c.render(52), linesBefore);
	} finally {
		s.cleanup();
	}
});

test("sidebar toggle - editor dock stays reachable through the left component when hidden", () => {
	const s = setup();
	try {
		setSidebarVisible(false, { persist: false });
		const hidden = s.root[NODE]();
		assert.equal(hidden.entries[0].component.editorDock.render(10)[0], "editor");
	} finally {
		s.cleanup();
	}
});

test("sidebar toggle - hidden layout keeps edge insets and drops the left border", () => {
	const s = setup();
	try {
		setSidebarVisible(false, { persist: false });
		const hidden = s.root[NODE]();
		const layout = loadSolviLayout().sidebar;
		assert.ok(!hidden.entries.some((e: any) => e.basis === layout.leftBorderWidth && e.component !== s.left));
	} finally {
		s.cleanup();
	}
});

test("sidebar toggle - stale rail lines do not survive a toggle", () => {
	const s = setup();
	try {
		const first = s.root[NODE]();
		const rail = first.entries[first.entries.length - 1].component;
		assert.ok(rail.render(52).length >= 0);
		setSidebarVisible(false, { persist: false });
		s.root[NODE]();
		s.card.renders = 0;
		setSidebarVisible(true, { persist: false });
		const again = s.root[NODE]();
		assert.ok(s.card.renders > 0, "rail rebuilt after becoming visible again");
		assert.equal(again.entries.length, first.entries.length);
	} finally {
		s.cleanup();
	}
});

test("sidebar toggle - width-keyed child cache never serves lines from another width", () => {
	const member: any = { render: () => ["x"], invalidate() {} };
	const out = (w: number) => ({ lines: ["w" + w], mouseChildren: [] }) as any;
	const at = (w: number) => memoizeChildCard("card", [member], [["x"]], w, undefined, [], () => out(w));
	const wide = at(160);
	assert.deepEqual(at(160).lines, wide.lines, "same width is a hit");
	assert.deepEqual(at(212).lines, ["w212"], "full-width after hiding recomputes");
	assert.deepEqual(at(160).lines, ["w160"], "restored width recomputes, no stale 212 lines");
});

test("sidebar toggle - persistence round trip and corrupt file tolerance", () => {
	resetAll();
	resetSidebarVisibility();
	const file = sidebarStatePath();
	try { fs.rmSync(file, { force: true }); } catch {}
	assert.equal(isSidebarVisible(), true, "default visible when file missing");
	assert.equal(toggleSidebar(), false);
	resetSidebarVisibility();
	assert.equal(isSidebarVisible(), false, "hidden state persisted");
	assert.equal(toggleSidebar(), true);
	resetSidebarVisibility();
	assert.equal(isSidebarVisible(), true);

	fs.writeFileSync(file, "{ not json");
	resetSidebarVisibility();
	assert.equal(isSidebarVisible(), true, "corrupt file falls back to visible");
	fs.writeFileSync(file, JSON.stringify({ visible: "nope" }));
	assert.equal(readSidebarVisibility(), true);

	// unwritable location: a directory sits where the file should be
	fs.rmSync(file, { force: true });
	fs.mkdirSync(file);
	try {
		resetSidebarVisibility();
		assert.doesNotThrow(() => setSidebarVisible(false));
		assert.equal(isSidebarVisible(), false, "in-memory state still applies");
	} finally {
		fs.rmSync(file, { recursive: true, force: true });
		resetSidebarVisibility();
		setSidebarVisible(true, { persist: false });
	}
});

test("sidebar toggle - /sidebar toggles, switches on and off, and requests a render", async () => {
	resetAll();
	resetSidebarVisibility();
	setSidebarVisible(true, { persist: false });
	const commands = new Map<string, any>();
	let shortcutsRegistered = 0;
	registerSidebarToggle({
		registerShortcut: () => shortcutsRegistered++,
		registerCommand: (name: string, o: any) => commands.set(name, o),
	} as any);
	assert.equal(shortcutsRegistered, 0, "no shortcut: every free Alt key collided with pi-btw");
	let renders = 0;
	footerRegistry.latestTodoTui = { terminal: { columns: 160, rows: 40 }, requestRender: () => renders++ } as any;
	const notes: string[] = [];
	const ctx: any = { ui: { notify: (m: string) => notes.push(m) } };
	try {
		await commands.get("sidebar").handler("off", ctx);
		assert.equal(isSidebarVisible(), false);
		assert.equal(renders, 1);
		await commands.get("sidebar").handler("on", ctx);
		assert.equal(isSidebarVisible(), true);
		await commands.get("sidebar").handler("", ctx);
		assert.equal(isSidebarVisible(), false);
		await commands.get("sidebar").handler("toggle", ctx);
		assert.equal(isSidebarVisible(), true);
		assert.equal(notes.length, 4);
	} finally {
		footerRegistry.latestTodoTui = undefined as any;
		fs.rmSync(sidebarStatePath(), { force: true });
		resetSidebarVisibility();
	}
});
