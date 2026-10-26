import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { resetSolviGlyphsCache } from "../src/solvi-theme.ts";
import { resetSolviStringsCache } from "../src/solvi-strings.ts";
import { resetSolviLayoutCache } from "../src/solvi-layout.ts";
import { resetSolviPathsCache, resetActiveProfileCache } from "../src/solvi-paths.ts";
import { resetSolviColorsCache } from "../src/solvi-colors.ts";
import {
	resetGitGraphCache,
	resetGitStatusCache,
	resetGitFileChangesCache,
	resetGitTabState,
} from "../src/solvi-git-graph.ts";
import { resetUsageCache } from "../src/solvi-usage.ts";
import { resetEngramCache } from "../src/solvi-engram.ts";
import { resetMemoryGraphCache } from "../src/solvi-memory-graph.ts";

// Isolated ephemeral test sandbox directory so tests NEVER mutate or unlink the real ~/.pi/agent/solvi.json
export const testAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-solvi-test-agent-"));
process.env.PI_AGENT_DIR = testAgentDir;
export const userConfigFile = path.join(testAgentDir, "solvi.json");

process.on("exit", () => {
	try {
		fs.rmSync(testAgentDir, { recursive: true, force: true });
	} catch {}
});

export function resetAll() {
	resetSolviGlyphsCache();
	resetSolviStringsCache();
	resetSolviLayoutCache();
	resetSolviPathsCache();
	resetSolviColorsCache();
	resetActiveProfileCache();
	resetGitGraphCache();
	resetGitStatusCache();
	resetGitFileChangesCache();
	resetGitTabState();
	resetUsageCache();
	resetEngramCache();
	resetMemoryGraphCache();
}
