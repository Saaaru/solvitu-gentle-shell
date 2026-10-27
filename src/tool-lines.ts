import { homedir } from "node:os";

const TARGET_KEYS = ["path", "file_path", "command", "pattern"] as const;

/** What the tool acts on: the path, command or pattern from its arguments, with the home folder shortened to ~. */
export function compactToolTarget(args: unknown): string {
	const record = (args ?? {}) as Record<string, unknown>;
	for (const key of TARGET_KEYS) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) {
			return value.replace(homedir(), "~").replace(/\s*\n\s*/g, " ");
		}
	}
	return "";
}
