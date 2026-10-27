import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// MAIN tab: active extensions and MCP servers on top, a read-only viewer on the bottom half.

export interface MainItem {
	kind: "extension" | "mcp";
	group: string;
	name: string;
	description?: string;
	path?: string;
	config?: unknown;
}

export interface MainViewState {
	items: MainItem[];
	selected: number;
	opened?: { title: string; lines: string[] };
	rows: number[];
	requestRender?: () => void;
}

const SECRET_KEY = /token|key|secret|pass|auth|cookie|header|env/i;
const MAX_VIEW_LINES = 400;

/** Masks values under keys that usually hold credentials, so the viewer never shows secrets. */
export function maskSecrets(value: unknown, keyName = ""): unknown {
	if (Array.isArray(value)) return value.map((item) => maskSecrets(item, keyName));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, maskSecrets(item, key)]),
		);
	}
	if (SECRET_KEY.test(keyName) && typeof value === "string") return "***";
	return value;
}

export function homeRelative(path: string): string {
	return path.replace(homedir(), "~");
}

// Sources Pi reports for any extension loaded from a file or flag; they say how it was loaded, not what it is.
const GENERIC_SOURCES = new Set(["", "cli", "local", "user", "project", "extension", "temporary"]);

/** A readable name for an extension: its real source, or the package and file it was loaded from. */
export function extensionDisplayName(info: { source?: unknown; path?: unknown }): string {
	const source = String(info.source ?? "").replace(/^npm:/, "").trim();
	if (source && !GENERIC_SOURCES.has(source)) return source;
	const parts = String(info.path ?? "").split(String.fromCharCode(92)).join("/").split("/").filter(Boolean);
	if (parts.length === 0) return source || "extension";
	const file = parts[parts.length - 1].replace(/\.[^.]+$/, "");
	const modules = parts.lastIndexOf("node_modules");
	if (modules >= 0 && modules + 1 < parts.length) {
		const scoped = parts[modules + 1].startsWith("@");
		const pkg = scoped ? `${parts[modules + 1]}/${parts[modules + 2] ?? ""}` : parts[modules + 1];
		return file === "index" || pkg === file || pkg.endsWith(`/${file}`) ? pkg : `${pkg}/${file}`;
	}
	return file === "index" && parts.length > 1 ? parts[parts.length - 2] : parts[parts.length - 1];
}

export function collectItems(pi: ExtensionAPI): MainItem[] {
	const items: MainItem[] = [];
	const commands = (pi as any).getCommands?.() ?? [];
	const seenExtensions = new Set<string>();
	const addExtension = (info: any) => {
		const path = String(info?.path ?? "");
		if (!path || path.startsWith("builtin:") || seenExtensions.has(path)) return;
		seenExtensions.add(path);
		items.push({
			kind: "extension",
			group: `${info.scope ?? "user"} · extensions`,
			name: extensionDisplayName(info),
			path,
		});
	};
	for (const command of commands) {
		if (command.source === "extension") addExtension(command.sourceInfo);
	}
	for (const tool of (pi as any).getAllTools?.() ?? []) addExtension(tool.sourceInfo);
	const servers = (pi as any).getMcpServers?.() ?? [];
	for (const server of servers) {
		items.push({
			kind: "mcp",
			group: "mcp",
			name: server.name,
			config: maskSecrets(server.config),
		});
	}
	// Keep the array in the order the list card draws (extensions, MCP) so Alt+M/N walk the rows top to bottom.
	const rank: Record<MainItem["kind"], number> = { extension: 0, mcp: 1 };
	return items.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/** Builds the read-only viewer content for one item. */
export function openItem(item: MainItem): { title: string; lines: string[] } {
	if (item.kind === "extension") {
		const fallback = [item.description ?? `(sin archivo legible: ${item.path ? homeRelative(item.path) : "sin ruta"})`];
		let lines = fallback;
		try {
			if (item.path && existsSync(item.path) && statSync(item.path).isFile()) {
				lines = readFileSync(item.path, "utf8").split("\n").slice(0, MAX_VIEW_LINES);
			}
		} catch {
			lines = fallback;
		}
		return { title: `${item.kind} · ${item.name}`, lines };
	}
	return {
		title: `mcp · ${item.name}`,
		lines: JSON.stringify(item.config, null, 2).split("\n").slice(0, MAX_VIEW_LINES),
	};
}

export function createMainState(pi: ExtensionAPI): MainViewState {
	return { items: collectItems(pi), selected: 0, rows: [] };
}

export function moveSelection(state: MainViewState, delta: number): void {
	if (state.items.length === 0) return;
	state.selected = (state.selected + delta + state.items.length) % state.items.length;
	state.requestRender?.();
}

export function openSelected(state: MainViewState): void {
	const item = state.items[state.selected];
	if (!item) return;
	state.opened = openItem(item);
	state.requestRender?.();
}

/** Top half: skills grouped by origin, then MCP servers. Click a row to open it in the viewer. */
export class MainListCard implements Component {
	private readonly state: MainViewState;
	private readonly theme: any;

	constructor(state: MainViewState, theme: any) {
		this.state = state;
		this.theme = theme;
	}

	render(width: number, height?: number): string[] {
		const lines: string[] = [];
		const rows: number[] = [];
		const push = (text: string, itemIndex?: number) => {
			lines.push(truncateToWidth(text, Math.max(0, width)));
			rows.push(itemIndex ?? -1);
		};
		const extensions = this.state.items.filter((item) => item.kind === "extension");
		const mcp = this.state.items.filter((item) => item.kind === "mcp");

		push(this.theme.fg("accent", `Extensions · ${extensions.length}`));
		for (const item of extensions) {
			const index = this.state.items.indexOf(item);
			const marker = index === this.state.selected ? this.theme.fg("accent", "› ") : "  ";
			push(`${marker}${this.theme.fg("text", item.name)}`, index);
		}
		push("");
		push(this.theme.fg("accent", `MCP · ${mcp.length}`));
		for (const item of mcp) {
			const index = this.state.items.indexOf(item);
			const marker = index === this.state.selected ? this.theme.fg("accent", "› ") : "  ";
			push(`${marker}${this.theme.fg("text", item.name)}`, index);
		}

		this.state.rows = rows;
		return height === undefined ? lines : lines.slice(0, Math.max(1, height));
	}

	handleMouse(event: TuiMouseEvent): { handled: boolean; render: boolean } | undefined {
		if (event.type !== "click") return undefined;
		const index = this.state.rows[event.y];
		if (index === undefined || index < 0) return undefined;
		this.state.selected = index;
		openSelected(this.state);
		return { handled: true, render: true };
	}

	invalidate(): void {}
}

/** Bottom half: read-only text of the opened skill or MCP server. */
export class MainViewerCard implements Component {
	private readonly state: MainViewState;
	private readonly theme: any;

	constructor(state: MainViewState, theme: any) {
		this.state = state;
		this.theme = theme;
	}

	render(width: number, height?: number): string[] {
		const rows = Math.max(2, height ?? 12);
		const opened = this.state.opened;
		if (!opened) {
			return [truncateToWidth(this.theme.fg("dim", "Clic en una extensión o MCP para leerlo aquí (solo lectura)."), Math.max(0, width))];
		}
		const body = opened.lines.slice(0, rows - 1).map((line) => truncateToWidth(this.theme.fg("muted", line), Math.max(0, width)));
		return [truncateToWidth(this.theme.fg("accent", `${opened.title}  (solo lectura)`), Math.max(0, width)), ...body];
	}

	invalidate(): void {}
}

