import { Text } from "@earendil-works/pi-tui";
import { homedir } from "node:os";

// Tools drawn as a single plain line ("read > path") instead of a bordered card.
export const COMPACT_TOOLS = new Set(["read", "write", "edit", "bash", "grep", "find", "ls"]);

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

interface CompactRenderer {
	renderShell: "self";
	renderCall(args: unknown, theme: any, context: any): Text;
	renderResult(result: any, options: any, theme: any, context: any): Text;
}

/** Renderer for one compact tool: `name > target` on the call, nothing on success, one red line on failure. */
export function compactToolRenderer(toolName: string): CompactRenderer {
	return {
		renderShell: "self",
		renderCall(args, theme) {
			const target = compactToolTarget(args);
			return new Text(`${theme.fg("accent", toolName)} ${theme.fg("dim", ">")} ${theme.fg("muted", target)}`, 0, 0);
		},
		renderResult(result, options, theme, context) {
			const isError = context?.isError === true || options?.isError === true;
			if (!isError) return new Text("", 0, 0);
			const text = Array.isArray(result?.content)
				? result.content.map((part: any) => (typeof part?.text === "string" ? part.text : "")).join(" ").trim()
				: "";
			return new Text(theme.fg("error", `${toolName} > failed${text ? `: ${text.split("\n")[0]}` : ""}`), 0, 0);
		},
	};
}
