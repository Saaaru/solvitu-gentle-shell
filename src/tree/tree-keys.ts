import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { footerRegistry } from "../footer/footer-registry.ts";
import { sidebarState } from "../sidebar-state.ts";
import { resolveSidebarTab } from "../sidebar-tabs.ts";
import { getFolderState, type FolderState } from "./folder-state.ts";

/**
 * FLDR tab keyboard shortcuts. Pi reserves Alt+Up/Down (app.models.reorderUp/Down,
 * app.message.dequeue) and Alt+Left/Right (app.tree.foldOrUp/unfoldOrDown, editor word
 * movement), and gentle-pi owns Alt+A/G/K/T/U/S/E, so the tree uses free Alt keys:
 *   Alt+W / Alt+X        cursor up / down
 *   Alt+. / Alt+,        expand directory or open file / collapse or go to parent
 *   Alt+PageUp/PageDown  scroll the file viewer
 * Every shortcut is inert unless the FLDR tab is the active sidebar tab.
 */
export function registerTreeKeys(pi: Pick<ExtensionAPI, "registerShortcut">): void {
	const onTreeTab = (run: (state: FolderState) => void) => () => {
		const tui = footerRegistry.latestTodoTui;
		if (!tui?.terminal) return;
		if (resolveSidebarTab(sidebarState(tui).activeTabId).id !== "tree") return;
		run(getFolderState(tui));
		tui.requestRender();
	};
	const add = (key: string, description: string, run: (state: FolderState) => void) =>
		pi.registerShortcut(key as any, { description, handler: onTreeTab(run) });

	add("alt+w", "Folder tree: cursor up", (s) => s.tree?.moveCursor(-1));
	add("alt+x", "Folder tree: cursor down", (s) => s.tree?.moveCursor(1));
	add("alt+.", "Folder tree: expand directory or open file", (s) => s.tree?.expandOrOpen());
	add("alt+,", "Folder tree: collapse directory or go to parent", (s) => s.tree?.collapseOrUp());
	add("alt+pageup", "Folder viewer: scroll up", (s) => s.viewer?.pageBy(-1));
	add("alt+pagedown", "Folder viewer: scroll down", (s) => s.viewer?.pageBy(1));
}
