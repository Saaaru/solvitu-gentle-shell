import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { footerRegistry } from "./footer/footer-registry.ts";

/**
 * Sidebar on/off switch (Alt+W, /sidebar). Module-level state so the layout node in sidebar.ts can read it on
 * every frame. The choice is persisted in a small JSON file next to the other solvi user files
 * (`<agent-dir>/solvi/sidebar-state.json`); the layered Workspace.layout.json stays read-only config.
 * Every read and write is best effort and never throws. Default: visible.
 */
export const SIDEBAR_STATE_FILENAME = "sidebar-state.json";
export const SIDEBAR_TOGGLE_SHORTCUT = "alt+w";

export function sidebarStatePath(): string {
	const agentDir = process.env.PI_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
	return path.join(agentDir, "solvi", SIDEBAR_STATE_FILENAME);
}

export function readSidebarVisibility(file: string = sidebarStatePath()): boolean {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
		if (parsed && typeof parsed === "object" && (parsed as { visible?: unknown }).visible === false) return false;
	} catch {}
	return true;
}

export function writeSidebarVisibility(visible: boolean, file: string = sidebarStatePath()): boolean {
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify({ visible }) + "\n", "utf8");
		return true;
	} catch {
		return false;
	}
}

let current: boolean | undefined;
const listeners = new Set<(visible: boolean) => void>();

export function isSidebarVisible(): boolean {
	if (current === undefined) current = readSidebarVisibility();
	return current;
}

/** Sets the visibility, persists it and notifies listeners when it changed. Returns the new value. */
export function setSidebarVisible(visible: boolean, options: { persist?: boolean } = {}): boolean {
	const changed = isSidebarVisible() !== visible;
	current = visible;
	if (options.persist !== false) writeSidebarVisibility(visible);
	if (changed) {
		for (const listener of [...listeners]) {
			try {
				listener(visible);
			} catch {}
		}
	}
	return visible;
}

export function toggleSidebar(): boolean {
	return setSidebarVisible(!isSidebarVisible());
}

export function onSidebarVisibilityChange(listener: (visible: boolean) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Forgets the in-memory value so the next read hits the file again (tests). */
export function resetSidebarVisibility(): void {
	current = undefined;
}

const SUBCOMMANDS = [
	{ value: "toggle", description: "Show or hide the sidebar" },
	{ value: "on", description: "Show the sidebar" },
	{ value: "off", description: "Hide the sidebar (full-width chat)" },
];

/** Registers the Alt+W shortcut and the /sidebar [toggle|on|off] command. */
export function registerSidebarToggle(pi: Pick<ExtensionAPI, "registerShortcut" | "registerCommand">): void {
	const apply = (next: () => boolean): boolean => {
		const visible = next();
		try {
			footerRegistry.latestTodoTui?.requestRender();
		} catch {}
		return visible;
	};
	pi.registerShortcut(SIDEBAR_TOGGLE_SHORTCUT as any, {
		description: "Show or hide the sidebar",
		handler: () => void apply(toggleSidebar),
	});
	pi.registerCommand("sidebar", {
		description: "Sidebar: toggle | on | off",
		getArgumentCompletions: (prefix: string) => {
			const items = SUBCOMMANDS.filter((s) => s.value.startsWith(prefix.trimStart())).map((s) => ({
				value: s.value,
				label: s.value,
				description: s.description,
			}));
			return items.length ? items : null;
		},
		handler: async (args: string, ctx: any) => {
			const sub = args.trim().toLowerCase();
			const visible =
				sub === "on" ? apply(() => setSidebarVisible(true)) : sub === "off" ? apply(() => setSidebarVisible(false)) : apply(toggleSidebar);
			try {
				ctx?.ui?.notify?.(`Sidebar ${visible ? "shown" : "hidden"} (${SIDEBAR_TOGGLE_SHORTCUT})`, "info");
			} catch {}
		},
	} as any);
}
