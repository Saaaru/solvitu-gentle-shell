// Re-applies the personal gentle-pi patches after `pi update`: flower -> bee glyph, the animated bee
// window beside the prompt, and the bee startup banner.
// Idempotent: already-patched files are left alone. Fails loudly (and writes nothing to that file)
// if upstream text changed. Replacement tables live in ./bee-window-patch.mjs.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GENTLE_SHELL_REPLACEMENTS, PROMPT_REPLACEMENTS, patchSource } from "./bee-window-patch.mjs";

// Two separate installs exist on this machine and both need the patch:
// - AGENT_GENTLE_PI: what `pi`/gentle-shell actually run as an agent extension (session_start etc).
// - LAUNCHER_GENTLE_PI: what the `gentle-shell` launcher boots directly (npm i -g gentle-pi).
const AGENT_GENTLE_PI = join(homedir(), ".pi", "agent", "npm", "node_modules", "gentle-pi");
const LAUNCHER_GENTLE_PI = join(homedir(), "AppData", "Roaming", "npm", "node_modules", "gentle-pi");

export function applyPatch(label, target, replacements) {
	if (!existsSync(target)) throw new Error(`gentle-pi not found at ${target}`);
	const { source, changed } = patchSource(readFileSync(target, "utf8"), replacements, label);
	if (!changed) {
		console.log(`${label}: already patched`);
		return;
	}
	// Keep the first backup: it is the pristine upstream file, later runs must not overwrite it.
	if (!existsSync(`${target}.pre-bee.bak`)) copyFileSync(target, `${target}.pre-bee.bak`);
	writeFileSync(target, source, "utf8");
	console.log(`${label}: patched (backup: ${target}.pre-bee.bak)`);
}

// Same size ASCII accent as the original rose, same "rose" plumbing/config/commands.
const BEE_LARGE_RAW = `const ROSE_LARGE_RAW = [
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣤⣤⣤⣀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⡾⠋⠁⠀⠀⠀⠉⠻⣦",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⡠⠤⢴⡯⣀⡀⠀⠀⠀⠀⠀⠀⠈⣷",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡠⠊⠀⠀⠀⣿⠀⠀⠈⠢⡀⠀⠀⠀⠀⠀⢸⡇",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡜⠀⠀⠀⠀⠀⢿⡀⠀⠀⠀⠘⡄⠀⠀⠀⠀⣸⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣤⠞⠂",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀⠀⠀⠘⢧⡀⠀⠀⠀⡇⠀⠀⠀⣠⠟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡼⠋",
  "⠀⠤⠤⠤⠤⠤⠄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠑⠀⠀⠀⠀⠀⠀⠈⠻⢦⠀⠐⢁⣀⣤⠾⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡼⠁",
  "⠀⠀⠀⣀⣀⣀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣤⠶⢾⣿⣿⠛⠛⢻⣶⣦⣤⡀⠈⠉⠀⢀⣠⣤⣤⣀⠀⠀⠀⣀⣤⣤⣄⡼⠁",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⠈⠙⢷⣄⣴⣿⣿⣿⣿⣿⣷⣤⣾⣿⣿⠟⣛⢿⣦",
  "⠀⠉⠉⠉⠉⠉⠁⠀⠀⠀⠀⠀⢠⣿⣿⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣇⠘⠿⢃⣿⡇",
  "⠀⠀⠀⠒⠒⠒⠒⠂⠀⣀⣠⣴⣿⣿⣿⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣶⣿⣿⠇",
  "⠀⠤⠤⠤⠤⠤⠄⠀⠉⠉⠙⠛⢿⣿⣿⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⠻⣿⣿⣿⣿⡿⠋",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢿⣿⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⠟⣿⣿⣿⣿⣿⠿⣇⠀⠀⠉⠉⠁",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠿⣿⣀⠀⢸⣿⣿⠀⠀⢸⣿⣿⣠⡴⠟⠁⣼⠃⠈⠉⣿⠀⠀⠹⣆",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠛⠻⠿⠿⠶⠶⠾⠛⠋⠉⠀⠀⣰⠏⠀⠀⠀⣿⠀⠀⠀⠹⣆",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⡾⠋⠀⠀⠀⣠⡿⠀⠀⠀⢠⡟",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠀⠀⠀⠀⠺⠋⠀⠀⠀⠀⠾⠁",
];`;
const BANNER_REPLACEMENTS = [{ from: /const ROSE_LARGE_RAW = \[[\s\S]*?\n\];/, to: BEE_LARGE_RAW }];

function main() {
	for (const gentlePiRoot of [AGENT_GENTLE_PI, LAUNCHER_GENTLE_PI]) {
		applyPatch("shell-prompt.ts", join(gentlePiRoot, "lib", "shell-prompt.ts"), PROMPT_REPLACEMENTS);
		applyPatch("gentle-shell.ts", join(gentlePiRoot, "extensions", "gentle-shell.ts"), GENTLE_SHELL_REPLACEMENTS);
		applyPatch("startup-banner.ts", join(gentlePiRoot, "extensions", "startup-banner.ts"), BANNER_REPLACEMENTS);
	}
}

// Run only when invoked as a script, so tests can import this module without touching the installs.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
