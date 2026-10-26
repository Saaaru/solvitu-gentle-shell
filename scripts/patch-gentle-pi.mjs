// Re-applies the personal gentle-pi prompt + banner patches (flower -> bee) after `pi update`.
// Idempotent: already-patched files are left alone. Fails loudly if upstream text changed.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Two separate installs exist on this machine and both need the patch:
// - AGENT_GENTLE_PI: what `pi`/gentle-shell actually run as an agent extension (session_start etc).
// - LAUNCHER_GENTLE_PI: what the `gentle-shell` launcher boots directly (npm i -g gentle-pi).
const AGENT_GENTLE_PI = join(homedir(), ".pi", "agent", "npm", "node_modules", "gentle-pi");
const LAUNCHER_GENTLE_PI = join(homedir(), "AppData", "Roaming", "npm", "node_modules", "gentle-pi");

function hasMatch(source, from) {
	return from instanceof RegExp ? from.test(source) : source.includes(from);
}

function applyPatch(label, target, replacements) {
	if (!existsSync(target)) throw new Error(`gentle-pi not found at ${target}`);
	let source = readFileSync(target, "utf8");
	const patched = replacements.every(([, to]) => source.includes(to));
	if (patched) {
		console.log(`${label}: already patched`);
		return;
	}
	if (!replacements.every(([from]) => hasMatch(source, from))) {
		throw new Error(`upstream ${label} changed; review the patch before applying`);
	}
	copyFileSync(target, `${target}.pre-bee.bak`);
	for (const [from, to] of replacements) source = source.replace(from, to);
	writeFileSync(target, source, "utf8");
	console.log(`${label}: patched (backup: ${target}.pre-bee.bak)`);
}

const PETAL_REPLACEMENTS = [
	['export const PROMPT_PETAL = "✿";', 'export const PROMPT_PETAL = "🐝";'],
	['const PETAL_FRAMES = ["✿", "❀", "❁", "✾"] as const;', 'const PETAL_FRAMES = ["🐝", "🐝", "🐝", "🐝"] as const;'],
];

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
const BANNER_REPLACEMENTS = [[/const ROSE_LARGE_RAW = \[[\s\S]*?\n\];/, BEE_LARGE_RAW]];

for (const gentlePiRoot of [AGENT_GENTLE_PI, LAUNCHER_GENTLE_PI]) {
	applyPatch("shell-prompt.ts", join(gentlePiRoot, "lib", "shell-prompt.ts"), PETAL_REPLACEMENTS);
	applyPatch("startup-banner.ts", join(gentlePiRoot, "extensions", "startup-banner.ts"), BANNER_REPLACEMENTS);
}
