import test from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { resetAll } from "./test-helpers.ts";
import { WorkspaceStatuses } from "../src/statuses.ts";
import { WorkspaceHeader } from "../src/header.ts";
import { footerRegistry } from "../src/footer/footer-registry.ts";

// Identity theme keeps visibleWidth honest: no fake brackets counted as columns.
function fakeTheme() {
	return { fg: (_role: string, text: string) => text } as any;
}

function fakeCtx(overrides: Record<string, unknown> = {}) {
	return {
		cwd: path.join(os.homedir(), "test"),
		model: { id: "anthropic/claude-opus-4-8", contextWindow: 200_000 },
		getContextUsage: () => ({ tokens: 12_000, contextWindow: 200_000, percent: 6 }),
		...overrides,
	} as any;
}

function setStatuses(entries: Array<[string, string]> | undefined) {
	footerRegistry.latestFooterData = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map(entries ?? []),
	} as any;
}

test("WorkspaceStatuses - renders model, tokens, window, threshold and limits on one row with statuses", () => {
	resetAll();
	setStatuses([
		["gentle:mode", "Permissions: NORMAL"],
		["engram", "🧠 test · ready"],
	]);
	const widget = new WorkspaceStatuses(fakeCtx(), fakeTheme(), undefined);

	const lines = widget.render(160);

	assert.equal(lines.length, 1, "must be a single row");
	const line = lines[0]!;
	assert.ok(line.includes("claude-opus-4-8"), "row includes the model");
	assert.ok(line.includes("12.0k"), "row includes used tokens");
	assert.ok(line.includes("200k"), "row includes the context window");
	assert.ok(line.includes("● Óptimo"), "row includes the threshold label");
	assert.ok(line.includes("6%"), "row includes the context percent");
	assert.ok(line.includes("Permissions: NORMAL"), "row keeps extension statuses on the same row");
	assert.ok(line.includes("🧠 test · ready"), "row keeps every extension status on the same row");
});

test("WorkspaceStatuses - still renders the model row when no extension status is set", () => {
	resetAll();
	setStatuses([]);
	const widget = new WorkspaceStatuses(fakeCtx(), fakeTheme(), undefined);

	const lines = widget.render(160);

	assert.equal(lines.length, 1, "single row even without statuses");
	assert.ok(lines[0]!.includes("claude-opus-4-8"));
	assert.ok(lines[0]!.includes("200k"));
});

test("WorkspaceStatuses - falls back to model context window when usage is unavailable", () => {
	resetAll();
	setStatuses(undefined);
	const ctx = fakeCtx({ getContextUsage: undefined });
	const widget = new WorkspaceStatuses(ctx, fakeTheme(), undefined);

	const lines = widget.render(160);

	assert.equal(lines.length, 1);
	assert.ok(lines[0]!.includes("claude-opus-4-8"));
	assert.ok(lines[0]!.includes("200k"), "context window comes from ctx.model");
	assert.ok(lines[0]!.includes("0%"), "percent falls back to 0");
});

test("WorkspaceStatuses - truncates the row to the terminal width", () => {
	resetAll();
	setStatuses([["gentle:mode", "Permissions: NORMAL"]]);
	const widget = new WorkspaceStatuses(fakeCtx(), fakeTheme(), undefined);

	for (const width of [80, 40, 12]) {
		const lines = widget.render(width);
		assert.equal(lines.length, 1, `one row at width ${width}`);
		assert.ok(lines[0]!.length > 0, `non-empty row at width ${width}`);
	}
});

test("WorkspaceHeader - renders a single line with only path and git branch", () => {
	resetAll();
	setStatuses([["gentle:mode", "Permissions: NORMAL"]]);
	const header = new WorkspaceHeader(fakeCtx(), fakeTheme(), undefined);

	const lines = header.render(160);

	assert.equal(lines.length, 1, "header must be a single line");
	const line = lines[0]!;
	assert.ok(line.includes("~"), "header keeps the cwd");
	assert.ok(line.includes("main"), "header keeps the git branch");
	assert.ok(!line.includes("claude-opus-4-8"), "header no longer shows the model");
	assert.ok(!line.includes("tokens"), "header no longer shows token counts");
	assert.ok(!line.includes("Óptimo"), "header no longer shows the context threshold");
});
