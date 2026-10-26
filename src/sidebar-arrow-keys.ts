import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { footerRegistry } from "./footer/footer-registry.ts";
import { cycleSidebarTab } from "./sidebar-tabs.ts";

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
}
