import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface SolviColors {
	userMessage: string;
	bashMessage: string;
	bashOutput: string;
	readMessage: string;
	writeMessage: string;
	fetchMessage: string;
	searchMessage: string;
	memoryMessage: string;
	errorMessage: string;
	gentleCardSuccess: string;
	gentleCardWarning: string;
	gentleCardError: string;
	sidebarBorder: string;
	reviewMessage: string;
	agentMessage: string;
}

export const SOLVI_COLORS_FILENAME = "Workspace.colors.json";

export const DEFAULT_SOLVI_COLORS: SolviColors = {
	userMessage: "userMessageText",
	bashMessage: "bash",
	bashOutput: "bashOutput",
	readMessage: "read",
	writeMessage: "write",
	fetchMessage: "pink",
	searchMessage: "secondary",
	memoryMessage: "salmon",
	errorMessage: "error",
	gentleCardSuccess: "success",
	gentleCardWarning: "warning",
	gentleCardError: "error",
	sidebarBorder: "border",
	reviewMessage: "gentle",
	agentMessage: "accent",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPackageClone(dir: string): boolean {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
		return pkg?.name === "solvitu";
	} catch {
		return false;
	}
}

function candidateColorsFiles(): string[] {
	const candidates: string[] = [];

	const add = (candidate: string) => {
		if (candidates.indexOf(candidate) === -1) candidates.push(candidate);
	};

	// 1. Package defaults (repo clone)
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const packageDir = path.resolve(here, "..");
		add(path.join(packageDir, "config", SOLVI_COLORS_FILENAME));
		add(path.join(packageDir, "themes", SOLVI_COLORS_FILENAME));
	} catch {}

	// 2. User-level global overrides (~/.pi/agent, outside git, persistent across updates).
	// Keeps every naming generation this package has used (cute.* from pi-cinlodev-cute,
	// workspace.json from the Workspace rename, solvi.* going forward) so overrides written
	// under any of them keep working after this rename.
	try {
		const agentDir = process.env.PI_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
		add(path.join(agentDir, "solvi.json"));
		add(path.join(agentDir, ".solvi.json"));
		add(path.join(agentDir, "solvi.local.json"));
		add(path.join(agentDir, "workspace.json"));
		add(path.join(agentDir, "cute.json"));
		add(path.join(agentDir, ".cute.json"));
		add(path.join(agentDir, "cute.local.json"));
		add(path.join(agentDir, "solvi", SOLVI_COLORS_FILENAME));
		add(path.join(agentDir, "solvi", "solvi.local.json"));
		add(path.join(agentDir, "cute", SOLVI_COLORS_FILENAME));
		add(path.join(agentDir, "cute", "cute.local.json"));
		add(path.join(agentDir, "cinlodev-cute", SOLVI_COLORS_FILENAME));
	} catch {}

	// 3. Workspace / Project-level overrides (cwd)
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const packageDir = path.resolve(here, "..");
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

function mergeColors(raw: unknown, current: SolviColors): SolviColors {
	if (!isRecord(raw)) return current;
	const source = isRecord(raw.colors) ? raw.colors : raw;
	return {
		userMessage: typeof source.userMessage === "string" ? source.userMessage : current.userMessage,
		bashMessage: typeof source.bashMessage === "string" ? source.bashMessage : current.bashMessage,
		bashOutput: typeof source.bashOutput === "string" ? source.bashOutput : current.bashOutput,
		readMessage: typeof source.readMessage === "string" ? source.readMessage : current.readMessage,
		writeMessage: typeof source.writeMessage === "string" ? source.writeMessage : current.writeMessage,
		fetchMessage: typeof source.fetchMessage === "string" ? source.fetchMessage : current.fetchMessage,
		searchMessage: typeof source.searchMessage === "string" ? source.searchMessage : current.searchMessage,
		memoryMessage: typeof source.memoryMessage === "string" ? source.memoryMessage : current.memoryMessage,
		errorMessage: typeof source.errorMessage === "string" ? source.errorMessage : current.errorMessage,
		gentleCardSuccess: typeof source.gentleCardSuccess === "string" ? source.gentleCardSuccess : current.gentleCardSuccess,
		gentleCardWarning: typeof source.gentleCardWarning === "string" ? source.gentleCardWarning : current.gentleCardWarning,
		gentleCardError: typeof source.gentleCardError === "string" ? source.gentleCardError : current.gentleCardError,
		sidebarBorder: typeof source.sidebarBorder === "string" ? source.sidebarBorder : current.sidebarBorder,
		reviewMessage: typeof source.reviewMessage === "string" ? source.reviewMessage : current.reviewMessage,
		agentMessage: typeof source.agentMessage === "string" ? source.agentMessage : current.agentMessage,
	};
}

let cachedColors: SolviColors | null = null;

export function loadSolviColors(): SolviColors {
	if (cachedColors) return cachedColors;
	let current: SolviColors = { ...DEFAULT_SOLVI_COLORS };
	for (const file of candidateColorsFiles()) {
		try {
			if (!fs.existsSync(file)) continue;
			const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
			current = mergeColors(parsed, current);
		} catch {}
	}
	cachedColors = current;
	return cachedColors;
}

export function resetSolviColorsCache(): void {
	cachedColors = null;
}
