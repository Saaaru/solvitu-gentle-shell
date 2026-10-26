import type { TUI } from "@earendil-works/pi-tui";

/** Keyboard actions the FLDR tab exposes on the tree card. */
export interface FolderTreeControls {
	moveCursor(delta: number): void;
	expandOrOpen(): void;
	collapseOrUp(): void;
}

/** Keyboard actions the FLDR tab exposes on the viewer card. */
export interface FolderViewerControls {
	pageBy(direction: 1 | -1): void;
}

/**
 * State shared by the project tree card and the file viewer card of the FLDR tab:
 * the tree cursor, the file being previewed and the viewer scroll offset.
 * Paths are relative to `cwd`, in the platform separator, as produced by the tree scanner.
 */
export class FolderState {
	cwd?: string;
	cursorPath?: string;
	previewPath?: string;
	viewerScroll = 0;
	tree?: FolderTreeControls;
	viewer?: FolderViewerControls;

	constructor(cwd?: string) {
		this.cwd = cwd;
	}

	openFile(relPath: string): void {
		if (this.previewPath !== relPath) this.viewerScroll = 0;
		this.previewPath = relPath;
	}
}

const statesByTui = new WeakMap<object, FolderState>();

/** One FolderState per TUI, so lazily created cards and footer-created cards share it. */
export function getFolderState(tui: TUI | object): FolderState {
	let state = statesByTui.get(tui);
	if (!state) {
		state = new FolderState();
		statesByTui.set(tui, state);
	}
	return state;
}
