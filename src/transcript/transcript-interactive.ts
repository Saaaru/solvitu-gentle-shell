import type { Component } from "@earendil-works/pi-tui";
import { isAbsolute, relative } from "node:path";
import { footerRegistry } from "../footer/footer-registry.ts";
import { sidebarState } from "../sidebar-state.ts";
import { getFolderState } from "../tree/folder-state.ts";
import { stripAnsi } from "../solvi-theme.ts";

// A Windows absolute path, or a relative path with a separator and an extension, with an optional :line suffix.
const PATH_PATTERN = /(?:[A-Za-z]:\\[^\s"'<>|*?]+|(?:\.{1,2}[\\/])?(?:[\w@.-]+[\\/])+[\w@.-]*\.[A-Za-z0-9]{1,8})(?::\d+(?:-\d+)?)?/g;

/** Returns the file path under `column` in `text` (without a :line suffix), or undefined. */
export function findPathAt(text: string, column: number): string | undefined {
	for (const match of text.matchAll(PATH_PATTERN)) {
		const start = match.index ?? 0;
		const end = start + match[0].length;
		if (column >= start && column < end) return match[0].replace(/:\d+(?:-\d+)?$/, "");
	}
	return undefined;
}

/**
 * Opens a path in the FLDR tab of the sidebar. Only paths inside the project folder can be shown there,
 * because the viewer reads relative to it. Returns false when the path cannot be opened that way.
 */
export function openPathInFolder(path: string): boolean {
	const tui = footerRegistry.latestTodoTui;
	if (!tui) return false;
	const folder = getFolderState(tui);
	const cwd = folder.cwd ?? process.cwd();
	const absolute = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || isAbsolute(path);
	const rel = absolute ? relative(cwd, path) : path;
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return false;
	folder.openFile(rel.replace(/\\/g, "/"));
	(sidebarState(tui as any) as { activeTabId?: string }).activeTabId = "tree";
	tui.requestRender();
	return true;
}

/** Mouse target for an assistant card: a click on a path opens it in FLDR. */
export class PathLinkMouseProxy implements Component {
	private plainLines?: string[];

	// The proxy is rebuilt on every render but only read on a click, so the ANSI stripping waits until then.
	private readonly proseLines: string[];

	constructor(proseLines: string[]) {
		this.proseLines = proseLines;
	}

	private plain(): string[] {
		this.plainLines ??= this.proseLines.map((line) => stripAnsi(line));
		return this.plainLines;
	}

	render(_width: number): string[] {
		return [];
	}

	handleMouse(event: any): any {
		if (event?.type !== "click") return undefined;
		// Row 0 is the card's top border and content starts after "│ ".
		const row = event.y - 1;
		const column = event.x - 2;
		const plain = this.plain();
		if (row < 0 || row >= plain.length || column < 0) return undefined;
		const path = findPathAt(plain[row], column);
		return path && openPathInFolder(path) ? { handled: true } : undefined;
	}
}
