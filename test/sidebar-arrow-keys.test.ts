import test from "node:test";
import assert from "node:assert/strict";
import { registerSidebarArrowKeys } from "../src/sidebar-arrow-keys.ts";
import { footerRegistry } from "../src/footer/footer-registry.ts";
import { sidebarState } from "../src/sidebar-state.ts";
import { WorkspaceModelsCard } from "../src/models/models-card.ts";
import { resetAll } from "./test-helpers.ts";

function collectShortcuts() {
	const shortcuts = new Map<string, { description?: string; handler: () => void }>();
	registerSidebarArrowKeys({
		registerShortcut: (id: string, opts: any) => shortcuts.set(id, opts),
	} as any);
	return shortcuts;
}

test("sidebar arrow keys - registers Alt+Left and Alt+Right for previous and next tab", () => {
	const shortcuts = collectShortcuts();
	assert.deepEqual([...shortcuts.keys()].sort(), ["alt+down", "alt+enter", "alt+left", "alt+right", "alt+up"]);
	assert.match(shortcuts.get("alt+left")!.description ?? "", /previous sidebar tab/i);
	assert.match(shortcuts.get("alt+right")!.description ?? "", /next sidebar tab/i);
});

test("sidebar arrow keys - Alt+Right and Alt+Left cycle the sidebar tabs and wrap around", () => {
	resetAll();
	const shortcuts = collectShortcuts();
	let renders = 0;
	const tui: any = { terminal: { columns: 160, rows: 50 }, requestRender: () => renders++ };
	footerRegistry.latestTodoTui = tui;
	try {
		const state = sidebarState(tui);
		state.activeTabId = "mem";

		shortcuts.get("alt+right")!.handler();
		assert.equal(state.activeTabId, "git");
		shortcuts.get("alt+right")!.handler();
		assert.equal(state.activeTabId, "prof");
		shortcuts.get("alt+left")!.handler();
		assert.equal(state.activeTabId, "git");
		assert.equal(renders, 3, "each key press requests one render");

		state.activeTabId = "mem";
		shortcuts.get("alt+left")!.handler();
		assert.equal(state.activeTabId, "solvi", "Alt+Left on the first tab wraps to the last one");
		shortcuts.get("alt+right")!.handler();
		assert.equal(state.activeTabId, "mem", "Alt+Right on the last tab wraps to the first one");
	} finally {
		footerRegistry.latestTodoTui = undefined;
		resetAll();
	}
});

test("sidebar arrow keys - do nothing and do not throw before the sidebar exists", () => {
	const shortcuts = collectShortcuts();
	footerRegistry.latestTodoTui = undefined;
	assert.doesNotThrow(() => shortcuts.get("alt+right")!.handler());
	assert.doesNotThrow(() => shortcuts.get("alt+left")!.handler());
});

test("sidebar arrow keys - Alt+Up/Down/Enter move the model cursor and switch model on 1:STACK", async () => {
	resetAll();
	const shortcuts = collectShortcuts();
	const models = [
		{ provider: "anthropic", id: "a", name: "A" },
		{ provider: "openai", id: "b", name: "B" },
		{ provider: "google", id: "c", name: "C" },
	];
	const set: any[] = [];
	const ctx: any = {
		model: models[0],
		scopedModels: models.map((model) => ({ model })),
		modelRegistry: { getAvailable: () => models },
		sessionManager: { getEntries: () => [] },
	};
	const tui: any = { terminal: { columns: 160, rows: 50 }, requestRender: () => {} };
	const card = new WorkspaceModelsCard(ctx, tui, undefined, { setModel: async (m: any) => { set.push(m); return true; } } as any);
	footerRegistry.latestTodoTui = tui;
	footerRegistry.latestModelsCard = card;
	try {
		sidebarState(tui).activeTabId = "mem";
		shortcuts.get("alt+down")!.handler();
		assert.equal(card.getSelectedIndex(), 1);
		shortcuts.get("alt+down")!.handler();
		shortcuts.get("alt+up")!.handler();
		assert.equal(card.getSelectedIndex(), 1);
		shortcuts.get("alt+enter")!.handler();
		await new Promise((r) => setTimeout(r, 0));
		assert.deepEqual(set, [models[1]]);
	} finally {
		footerRegistry.latestTodoTui = undefined;
		footerRegistry.latestModelsCard = undefined;
		resetAll();
	}
});
