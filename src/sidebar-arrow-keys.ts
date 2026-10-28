import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { footerRegistry } from "./footer/footer-registry.ts";
import { cycleSidebarTab, resolveSidebarTab } from "./sidebar-tabs.ts";
import { sidebarState } from "./sidebar-state.ts";
import { getFolderState } from "./tree/folder-state.ts";
import { moveSelection, openSelected } from "./main-view.ts";

function activeTabContext() {
	const tui = footerRegistry.latestTodoTui;
	if (!tui?.terminal) return undefined;
	return { tui, tabId: resolveSidebarTab(sidebarState(tui).activeTabId).id };
}

/** Moves the cursor / scroll of the active sidebar tab (shared by Alt+Up/Down and Alt+I/J). */
export function navigateActiveSidebarTab(delta: number): void {
	const active = activeTabContext();
	if (!active) return;
	const { tui, tabId } = active;
	if (tabId === "mem") {
		footerRegistry.latestModelsCard?.moveCursor(delta);
	} else if (tabId === "tree") {
		getFolderState(tui).tree?.moveCursor(delta);
		tui.requestRender();
	} else if (tabId === "skills") {
		if (footerRegistry.mainView) moveSelection(footerRegistry.mainView, delta);
	} else if (tabId === "git" || tabId === "prof") {
		const card: any =
			tabId === "git"
				? (footerRegistry.latestGitGraph ?? footerRegistry.latestWorkingTree)
				: footerRegistry.latestProfilesCard;
		if (typeof card?.handleRailWheel === "function") {
			card.handleRailWheel(delta);
			tui.requestRender();
		}
	}
}

/** Activates / confirms the selected item of the active sidebar tab. */
export function activateActiveSidebarTab(): Promise<boolean> | boolean {
	const active = activeTabContext();
	if (!active) return false;
	const { tui, tabId } = active;
	if (tabId === "mem") return footerRegistry.latestModelsCard?.activateSelected() ?? false;
	if (tabId === "tree") {
		getFolderState(tui).tree?.expandOrOpen();
		tui.requestRender();
		return true;
	}
	if (tabId === "skills" && footerRegistry.mainView) {
		openSelected(footerRegistry.mainView);
		return true;
	}
	return false;
}

/**
 * Alt+Left / Alt+Right move between sidebar tabs. Pi lists these keys as defaults for
 * `tui.editor.cursorWordLeft/Right` and `app.tree.foldOrUp/unfoldOrDown`, but they are not in its
 * reserved list, so an extension shortcut wins in the editor. Rebind those built-in actions in
 * `<agent-dir>/keybindings.json` to drop the startup conflict notice. Alt+H / Alt+L still work as
 * letter keys (registered in index.ts).
 */
export function registerSidebarArrowKeys(pi: Pick<ExtensionAPI, "registerShortcut">): void {
	const cycleTab = (delta: number) => () => {
		const tui = footerRegistry.latestTodoTui;
		if (tui?.terminal) cycleSidebarTab(tui, delta);
	};
	pi.registerShortcut("alt+left" as any, { description: "Previous sidebar tab", handler: cycleTab(-1) });
	pi.registerShortcut("alt+right" as any, { description: "Next sidebar tab", handler: cycleTab(1) });
	pi.registerShortcut("alt+up" as any, { description: "Sidebar: move up in active tab", handler: () => navigateActiveSidebarTab(-1) });
	pi.registerShortcut("alt+down" as any, { description: "Sidebar: move down in active tab", handler: () => navigateActiveSidebarTab(1) });
	pi.registerShortcut("alt+enter" as any, {
		description: "Sidebar: activate selected item in active tab",
		handler: () => {
			void Promise.resolve(activateActiveSidebarTab()).catch(() => {});
		},
	});
}
