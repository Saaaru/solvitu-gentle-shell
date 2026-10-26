import fs from "node:fs";
import path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { solviGlyphs, safeFg } from "../solvi-theme.ts";
import { loadSolviColors } from "../solvi-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../solvi-transcript.ts";
import type { FolderState } from "./folder-state.ts";

export const MAX_PREVIEW_BYTES = 256 * 1024;
const DEFAULT_HEIGHT = 14;
const WHEEL_STEP = 3;

type PreviewKind = "text" | "binary" | "missing" | "directory" | "error";

interface Preview {
	key: string;
	kind: PreviewKind;
	lines: string[];
	truncated: boolean;
}

function readPreview(absPath: string): Omit<Preview, "key"> {
	let stat: fs.Stats;
	try {
		stat = fs.statSync(absPath);
	} catch {
		return { kind: "missing", lines: [], truncated: false };
	}
	if (stat.isDirectory()) return { kind: "directory", lines: [], truncated: false };
	if (!stat.isFile()) return { kind: "error", lines: [], truncated: false };
	let fd: number | undefined;
	try {
		fd = fs.openSync(absPath, "r");
		const size = Math.min(stat.size, MAX_PREVIEW_BYTES);
		const buf = Buffer.alloc(size);
		const read = size > 0 ? fs.readSync(fd, buf, 0, size, 0) : 0;
		const data = buf.subarray(0, read);
		if (data.includes(0)) return { kind: "binary", lines: [], truncated: false };
		const lines = data.toString("utf8").split(/\r\n|\n|\r/);
		if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
		return { kind: "text", lines, truncated: stat.size > MAX_PREVIEW_BYTES };
	} catch {
		return { kind: "error", lines: [], truncated: false };
	} finally {
		if (fd !== undefined) {
			try {
				fs.closeSync(fd);
			} catch {}
		}
	}
}

/**
 * Read-only preview of the file selected in the project tree (bottom half of the FLDR tab).
 * Scrolls by lines, from the keyboard (via FolderState.viewer) or the mouse wheel.
 */
export class WorkspaceFileViewerCard implements Component {
	private readonly folder: FolderState;
	private readonly theme?: Theme;
	private readonly cwd: string;
	private cache?: Preview;
	private lastCapacity = DEFAULT_HEIGHT - 2;

	constructor(folder: FolderState, theme?: Theme, cwd?: string) {
		this.folder = folder;
		this.theme = theme;
		this.cwd = cwd ?? folder.cwd ?? process.cwd();
		folder.viewer = { pageBy: (direction) => this.pageBy(direction) };
	}

	invalidate(): void {
		this.cache = undefined;
	}

	private load(): Preview | undefined {
		const rel = this.folder.previewPath;
		if (!rel) return undefined;
		const abs = path.resolve(this.folder.cwd ?? this.cwd, rel);
		let stamp = "";
		try {
			const st = fs.statSync(abs);
			stamp = `${st.mtimeMs}:${st.size}`;
		} catch {}
		const key = `${abs}|${stamp}`;
		if (this.cache?.key !== key) {
			const data = readPreview(abs);
			const lines = data.truncated ? [...data.lines, "…"] : data.lines;
			this.cache = { key, ...data, lines };
		}
		return this.cache;
	}

	private visibleRows(total: number): number {
		return total > this.lastCapacity ? Math.max(1, this.lastCapacity - 1) : this.lastCapacity;
	}

	private maxScroll(): number {
		const preview = this.load();
		if (!preview || preview.kind !== "text") return 0;
		return Math.max(0, preview.lines.length - this.visibleRows(preview.lines.length));
	}

	scrollTo(offset: number): boolean {
		const next = Math.min(this.maxScroll(), Math.max(0, Math.floor(offset)));
		if (next === this.folder.viewerScroll) return false;
		this.folder.viewerScroll = next;
		return true;
	}

	scrollBy(delta: number): boolean {
		return this.scrollTo(this.folder.viewerScroll + delta);
	}

	pageBy(direction: 1 | -1): void {
		const preview = this.load();
		const step = Math.max(1, this.visibleRows(preview?.lines.length ?? 0) - 1);
		this.scrollBy(direction * step);
	}

	handleRailWheel(delta: number): boolean {
		if (delta === 0) return false;
		return this.scrollBy(delta > 0 ? WHEEL_STEP : -WHEEL_STEP);
	}

	handleRailClick(): boolean {
		return false;
	}

	render(width: number, availableHeight?: number): string[] {
		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4;
		const height = Math.max(4, availableHeight ?? DEFAULT_HEIGHT);
		const theme = this.theme;
		const g = solviGlyphs(theme);
		const colors = loadSolviColors();
		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);
		const gold = (s: string): string => (theme ? safeFg(theme, "heading", s, "yellow") : s);
		const text = (s: string): string => (theme ? safeFg(theme, "text", s) : s);
		const dim = (s: string): string => (theme ? safeFg(theme, "dim", s) : s);

		const boxLine = (left: string): string => {
			const truncated = truncateAnsiAware(left, innerWidth);
			const pad = " ".repeat(Math.max(0, innerWidth - calcVisibleWidth(truncated)));
			return `${frame(g.v)} ${truncated}${pad} ${frame(g.v)}`;
		};

		const rel = this.folder.previewPath;
		let title = rel ?? "ARCHIVO";
		const maxTitle = safeWidth - 6;
		if (calcVisibleWidth(title) > maxTitle) {
			title = "…" + title.slice(Math.max(0, title.length - (maxTitle - 1)));
		}
		const fill = Math.max(0, safeWidth - 6 - calcVisibleWidth(title));
		const top = `${frame(`${g.tl}${g.h} `)}${gold(title)}${frame(` ${g.h.repeat(fill)}${g.h}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const capacity = Math.max(1, height - 2);
		this.lastCapacity = capacity;
		const body: string[] = [];
		const message = (msg: string): void => {
			body.push(boxLine(dim(msg)));
		};

		const preview = this.load();
		if (!preview) {
			message("Selecciona un archivo");
		} else if (preview.kind === "missing") {
			message("archivo no encontrado");
		} else if (preview.kind === "directory") {
			message("es un directorio");
		} else if (preview.kind === "binary") {
			message("archivo binario");
		} else if (preview.kind === "error") {
			message("no se pudo leer el archivo");
		} else {
			const total = preview.lines.length;
			const overflow = total > capacity;
			const rows = overflow ? Math.max(1, capacity - 1) : capacity;
			const maxScroll = Math.max(0, total - rows);
			if (this.folder.viewerScroll > maxScroll) this.folder.viewerScroll = maxScroll;
			const start = this.folder.viewerScroll;
			const gutter = Math.max(2, String(total).length);
			const sanitize = (s: string): string => s.replace(/\t/g, "  ").replace(/[\x00-\x1f\x7f]/g, "");
			for (let i = start; i < Math.min(total, start + rows); i++) {
				const isNote = preview.truncated && i === total - 1;
				const content = isNote
					? dim("… truncado (solo los primeros 256 KB)")
					: `${dim(String(i + 1).padStart(gutter) + " ")}${text(sanitize(preview.lines[i]))}`;
				body.push(boxLine(content));
			}
			if (overflow) {
				const below = total - (start + rows);
				const parts: string[] = [];
				if (start > 0) parts.push(`▲ ${start} arriba`);
				if (below > 0) parts.push(`▼ ${below} abajo`);
				body.push(boxLine(dim(`... ${parts.join(" · ")} (alt+pgup/pgdn)`)));
			}
		}

		while (body.length < capacity) body.push(boxLine(""));
		return [top, ...body.slice(0, capacity), bottom];
	}
}
