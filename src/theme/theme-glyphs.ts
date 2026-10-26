import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";


export interface SolviGlyphs {
	frameStyle: SolviFrameStyle;
	tl: string;
	tr: string;
	bl: string;
	br: string;
	h: string;
	v: string;
	dividerL: string;
	dividerR: string;
	separator: string;
	dot: string;
	brand: string;
	profileIcon: string;
	spinnerFrames: string[];
	petalFrames: string[];
	branch: string;
	gaugeFilled: string;
	gaugeEmpty: string;
}

const DOUBLE_GLYPHS: SolviGlyphs = {
	frameStyle: "double",
	tl: "┌",
	tr: "┐",
	bl: "└",
	br: "┘",
	h: "─",
	v: "│",
	dividerL: "├",
	dividerR: "┤",
	separator: "│",
	dot: "·",
	brand: "◆",
	profileIcon: "👤",
	spinnerFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
	petalFrames: ["🐝"],
	branch: "\ue0a0",
	gaugeFilled: "▰",
	gaugeEmpty: "▱",
};

const FRAME_PRESETS: Record<SolviFrameStyle, Pick<SolviGlyphs, "tl" | "tr" | "bl" | "br" | "h" | "v" | "dividerL" | "dividerR">> = {
	double: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│", dividerL: "├", dividerR: "┤" },
	single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│", dividerL: "├", dividerR: "┤" },
	rounded: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", dividerL: "├", dividerR: "┤" },
	ascii: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", dividerL: "+", dividerR: "+" },
};

const ASCII_FALLBACK: SolviGlyphs = {
	frameStyle: "ascii",
	tl: "+",
	tr: "+",
	bl: "+",
	br: "+",
	h: "-",
	v: "|",
	dividerL: "+",
	dividerR: "+",
	separator: "|",
	dot: ".",
	brand: "*",
	profileIcon: "@",
	spinnerFrames: ["-", "\\", "|", "/"],
	petalFrames: ["*", "+", "o", "x"],
	branch: ">",
	gaugeFilled: "#",
	gaugeEmpty: "-",
};

export type SolviPetalPreset = "petals" | "cats" | "kittens" | "sparkles" | "stars" | "hearts" | "ascii";

export const PETAL_PRESETS: Record<string, string[]> = {
	petals: ["🐝"],
	flowers: ["🐝"],
	cats: ["/•᷅•᷄\\੭", "/◕᷅◕᷄\\੭", "/˘᷅˘᷄\\੭", "/•᷅◕᷄\\੭"],
	kittens: ["/×᷅×᷄\\੭", "/-᷅-᷄\\੭", "/^᷅^᷄\\੭", "/o᷅o᷄\\੭"],
	sparkles: ["✦", "✧", "★", "☆"],
	stars: ["✶", "✷", "✸", "✹"],
	hearts: ["♡", "♥", "ღ", "❦"],
	ascii: ["*", "+", "o", "x"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickGlyph(source: unknown, fallback: string): string {
	return typeof source === "string" && source.length > 0 ? source : fallback;
}

function normalizeFrameStyle(source: unknown): SolviFrameStyle {
	return source === "single" || source === "rounded" || source === "ascii" ? source : "double";
}

/** Merge a parsed `glyphs` JSON value over the base glyphs (defaults to DOUBLE_GLYPHS). */
function mergeGlyphs(raw: unknown, baseGlyphs: SolviGlyphs = DOUBLE_GLYPHS): SolviGlyphs {
	const base: SolviGlyphs = {
		...baseGlyphs,
		spinnerFrames: [...baseGlyphs.spinnerFrames],
		petalFrames: [...baseGlyphs.petalFrames],
	};
	if (!isRecord(raw)) return base;
	const rawRecord = raw as Record<string, unknown>;

	if (typeof rawRecord.frameStyle === "string") {
		const frameStyle = normalizeFrameStyle(rawRecord.frameStyle);
		base.frameStyle = frameStyle;
		const preset = FRAME_PRESETS[frameStyle];
		const frameKeys = ["tl", "tr", "bl", "br", "h", "v", "dividerL", "dividerR"] as const;
		for (const key of frameKeys) {
			base[key] = preset[key] ?? ASCII_FALLBACK[key];
		}
	}

	const frameKeys = ["tl", "tr", "bl", "br", "h", "v", "dividerL", "dividerR"] as const;
	for (const key of frameKeys) {
		const explicit = rawRecord[key];
		if (typeof explicit === "string" && explicit.length > 0) {
			base[key] = explicit;
		}
	}

	const accessoryKeys = [
		"separator",
		"dot",
		"brand",
		"profileIcon",
		"branch",
		"gaugeFilled",
		"gaugeEmpty",
	] as const;
	for (const key of accessoryKeys) {
		const explicit = rawRecord[key];
		if (typeof explicit === "string" && explicit.length > 0) {
			base[key] = explicit;
		}
	}

	// Preset lookup for animation frames (preset / petalPreset)
	const presetKey = typeof rawRecord.preset === "string" ? rawRecord.preset.toLowerCase() : (
		typeof rawRecord.petalPreset === "string" ? rawRecord.petalPreset.toLowerCase() : undefined
	);
	if (presetKey && presetKey in PETAL_PRESETS) {
		base.petalFrames = [...PETAL_PRESETS[presetKey]];
	}

	const rawFrames = rawRecord.spinnerFrames;
	if (Array.isArray(rawFrames)) {
		const cleaned = rawFrames.filter((f): f is string => typeof f === "string" && f.length > 0);
		if (cleaned.length > 0) base.spinnerFrames = cleaned;
	}

	const rawPetals = rawRecord.petalFrames;
	if (Array.isArray(rawPetals)) {
		const cleaned = rawPetals.filter((f): f is string => typeof f === "string" && f.length > 0);
		if (cleaned.length > 0) base.petalFrames = cleaned;
	}

	// ASCII fallback: any empty frame/box key left blank resolves to ASCII.
	for (const key of ["tl", "tr", "bl", "br", "h", "v", "dividerL", "dividerR", "separator"] as const) {
		if (!base[key]) base[key] = ASCII_FALLBACK[key];
	}
	if (!base.dot) base.dot = ASCII_FALLBACK.dot;
	if (!base.brand) base.brand = ASCII_FALLBACK.brand;
	if (!base.profileIcon) base.profileIcon = ASCII_FALLBACK.profileIcon;
	if (!base.branch) base.branch = ASCII_FALLBACK.branch;
	if (!base.gaugeFilled) base.gaugeFilled = ASCII_FALLBACK.gaugeFilled;
	if (!base.gaugeEmpty) base.gaugeEmpty = ASCII_FALLBACK.gaugeEmpty;
	if (base.spinnerFrames.length === 0) base.spinnerFrames = [...ASCII_FALLBACK.spinnerFrames];
	if (base.petalFrames.length === 0) base.petalFrames = [...ASCII_FALLBACK.petalFrames];
	return base;
}

let cachedGlyphs: SolviGlyphs | null = null;

function isPackageClone(dir: string): boolean {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
		return pkg?.name === "solvitu";
	} catch {
		return false;
	}
}

function candidateGlyphsFiles(): string[] {
	const candidates: string[] = [];
	const seen = new Set<string>();

	const add = (filePath: string) => {
		const resolved = path.resolve(filePath);
		if (!seen.has(resolved)) {
			seen.add(resolved);
			candidates.push(resolved);
		}
	};

	// 1. Package defaults (repo clone)
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const packageDir = path.resolve(here, "../..");
		add(path.join(packageDir, "themes", "Workspace.json"));
		add(path.join(packageDir, "config", "Workspace.glyphs.json"));
		add(path.join(packageDir, "themes", "Workspace.glyphs.json"));
	} catch {}

	// 2. User-level global overrides (~/.pi/agent, outside git, persistent across package
	// updates). Keeps every naming generation this package has used (cute.* from
	// pi-cinlodev-cute, workspace.json from the Workspace rename, solvi.* going forward).
	try {
		const agentDir = process.env.PI_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
		add(path.join(agentDir, "solvi.json"));
		add(path.join(agentDir, ".solvi.json"));
		add(path.join(agentDir, "solvi.local.json"));
		add(path.join(agentDir, "workspace.json"));
		add(path.join(agentDir, "cute.json"));
		add(path.join(agentDir, ".cute.json"));
		add(path.join(agentDir, "cute.local.json"));
		add(path.join(agentDir, "solvi", "Workspace.glyphs.json"));
		add(path.join(agentDir, "solvi", "glyphs.json"));
		add(path.join(agentDir, "solvi", "solvi.local.json"));
		add(path.join(agentDir, "cute", "Workspace.glyphs.json"));
		add(path.join(agentDir, "cute", "glyphs.json"));
		add(path.join(agentDir, "cinlodev-cute", "Workspace.glyphs.json"));
		add(path.join(agentDir, "cinlodev-cute", "glyphs.json"));
	} catch {}

	// 3. Workspace / Project-level overrides (cwd)
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const packageDir = path.resolve(here, "../..");
		const cwd = path.resolve(process.cwd());

		// Local untracked overrides (supported everywhere, even in package clone)
		add(path.join(cwd, "solvi.local.json"));
		add(path.join(cwd, ".solvi.json"));
		add(path.join(cwd, "cute.local.json"));
		add(path.join(cwd, ".cute.json"));
		add(path.join(cwd, "config", "solvi.local.json"));
		add(path.join(cwd, "config", ".solvi.json"));
		add(path.join(cwd, "config", "cute.local.json"));
		add(path.join(cwd, "config", ".cute.json"));

		if (cwd !== packageDir && !isPackageClone(cwd)) {
			add(path.join(cwd, "solvi.json"));
			add(path.join(cwd, ".pi", "solvi.json"));
			add(path.join(cwd, ".pi", "workspace.json"));
			add(path.join(cwd, "cute.json"));
			add(path.join(cwd, ".pi", "cute.json"));
		}
	} catch {}

	return candidates;
}

function resolveBaseGlyphs(): SolviGlyphs {
	let current: SolviGlyphs = mergeGlyphs(undefined, DOUBLE_GLYPHS);
	for (const file of candidateGlyphsFiles()) {
		try {
			if (!fs.existsSync(file)) continue;
			const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
			if (!isRecord(parsed)) continue;
			let glyphs = "glyphs" in parsed ? parsed.glyphs : parsed;
			if (isRecord(parsed) && "preset" in parsed && isRecord(glyphs) && !("preset" in glyphs)) {
				glyphs = { ...glyphs, preset: parsed.preset };
			}
			current = mergeGlyphs(glyphs, current);
		} catch {}
	}
	return current;
}

/**
 * Reusable glyph resolver. Defaults are byte-identical to the double-line
 * literals previously hardcoded in hud/footer frames, so the default visual
 * stays unchanged. Missing keys fall back to ASCII so widgets keep rendering
 * without a Nerd Font.
 *
 * User overrides in ~/.pi/agent/solvi.json or ~/.pi/agent/solvi/Workspace.glyphs.json
 * layer on top of package defaults and persist across package updates.
 */
export function solviGlyphs(theme?: unknown): SolviGlyphs {
	if (!cachedGlyphs) {
		cachedGlyphs = resolveBaseGlyphs();
	}
	if (isRecord(theme) && isRecord((theme as Record<string, unknown>).glyphs)) {
		return mergeGlyphs((theme as Record<string, unknown>).glyphs, cachedGlyphs);
	}
	return cachedGlyphs;
}

/** Clear the in-memory glyph cache (tests and follow-up slices). */
export function resetSolviGlyphsCache(): void {
	cachedGlyphs = null;
}
