import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// MAIN tab: active skills and MCP servers on top, a read-only viewer on the bottom half.

export interface MainItem {
	kind: "skill" | "mcp";
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

/** Groups items by their origin (user, project or package) keeping the first-seen order. */
export function groupItems(items: MainItem[]): Map<string, MainItem[]> {
	const groups = new Map<string, MainItem[]>();
	for (const item of items) {
		const list = groups.get(item.group) ?? [];
		list.push(item);
		groups.set(item.group, list);
	}
	return groups;
}

export function homeRelative(path: string): string {
	return path.replace(homedir(), "~");
}

export function collectItems(pi: ExtensionAPI): MainItem[] {
	const items: MainItem[] = [];
	const commands = (pi as any).getCommands?.() ?? [];
	for (const command of commands) {
		if (command.source !== "skill") continue;
		const info = command.sourceInfo ?? {};
		items.push({
			kind: "skill",
			group: `${info.scope ?? "user"} · ${info.source ?? "skills"}`,
			name: String(command.name).replace(/^skill:/, ""),
			description: command.description,
			path: info.path,
		});
	}
	const servers = (pi as any).getMcpServers?.() ?? [];
	for (const server of servers) {
		items.push({
			kind: "mcp",
			group: "mcp",
			name: server.name,
			config: maskSecrets(server.config),
		});
	}
	return items;
}

function readSkillLines(path: string | undefined): string[] {
	if (!path) return ["(sin ruta de archivo)"];
	const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "SKILL.md") : path;
	if (!existsSync(file)) return [`(no se encontró ${homeRelative(file)})`];
	return readFileSync(file, "utf8").split("\n").slice(0, MAX_VIEW_LINES);
}

/** Builds the read-only viewer content for one item. */
export function openItem(item: MainItem): { title: string; lines: string[] } {
	if (item.kind === "skill") {
		return { title: `skill · ${item.name}`, lines: readSkillLines(item.path) };
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
		const skills = this.state.items.filter((item) => item.kind === "skill");
		const mcp = this.state.items.filter((item) => item.kind === "mcp");

		push(this.theme.fg("accent", `Skills · ${skills.length}`));
		for (const [group, items] of groupItems(skills)) {
			push(this.theme.fg("dim", group));
			for (const item of items) {
				const index = this.state.items.indexOf(item);
				const marker = index === this.state.selected ? this.theme.fg("accent", "› ") : "  ";
				push(`${marker}${this.theme.fg("text", item.name)}`, index);
			}
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
			return [truncateToWidth(this.theme.fg("dim", "Clic en un skill o MCP para leerlo aquí (solo lectura)."), Math.max(0, width))];
		}
		const body = opened.lines.slice(0, rows - 1).map((line) => truncateToWidth(this.theme.fg("muted", line), Math.max(0, width)));
		return [truncateToWidth(this.theme.fg("accent", `${opened.title}  (solo lectura)`), Math.max(0, width)), ...body];
	}

	invalidate(): void {}
}

