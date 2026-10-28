import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	matchModelPatterns,
	readEnabledModelPatterns,
	resolveAgentDir,
	aggregateSessionUsage,
	buildModelRows,
	formatModelRow,
	usageBar,
	type ModelLike,
} from "../src/models/models-client.ts";
import { WorkspaceModelsCard } from "../src/models/models-card.ts";
import { calcVisibleWidth } from "../src/solvi-transcript.ts";

const MODELS: ModelLike[] = [
	{ provider: "anthropic", id: "claude-opus-4", name: "Claude Opus 4", contextWindow: 200000 },
	{ provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4", contextWindow: 200000 },
	{ provider: "openai", id: "gpt-5", name: "GPT-5", contextWindow: 400000 },
	{ provider: "google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 1000000 },
];

function assistant(provider: string, model: string, input: number, output: number, cost: number) {
	return {
		type: "message",
		message: {
			role: "assistant",
			provider,
			model,
			usage: { input, output, cacheRead: 5, cost: { total: cost } },
		},
	};
}

test("models - matchModelPatterns handles ids, provider/id, globs and thinking suffix", () => {
	assert.deepEqual(
		matchModelPatterns(["gpt-5"], MODELS).map((m) => m.id),
		["gpt-5"],
	);
	assert.deepEqual(
		matchModelPatterns(["anthropic/claude-opus-4:high"], MODELS).map((m) => m.id),
		["claude-opus-4"],
	);
	assert.deepEqual(
		matchModelPatterns(["anthropic/*"], MODELS).map((m) => m.id),
		["claude-opus-4", "claude-sonnet-4"],
	);
	assert.deepEqual(
		matchModelPatterns(["*sonnet*", "gpt-5", "gpt-5"], MODELS).map((m) => m.id),
		["claude-sonnet-4", "gpt-5"],
	);
	assert.deepEqual(matchModelPatterns(["nope-model"], MODELS), []);
});

test("models - resolveAgentDir and readEnabledModelPatterns merge global and project settings", () => {
	const root = mkdtempSync(join(tmpdir(), "models-test-"));
	const agentDir = join(root, "agent");
	const project = join(root, "proj");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(project, ".pi"), { recursive: true });

	assert.equal(resolveAgentDir({ PI_CODING_AGENT_DIR: agentDir }, "/home/x"), agentDir);
	assert.ok(resolveAgentDir({}, "/home/x").replace(/\\/g, "/").endsWith("/home/x/.pi/agent"));

	assert.equal(readEnabledModelPatterns({ cwd: project, agentDir }), undefined);

	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ enabledModels: ["gpt-5"] }));
	assert.deepEqual(readEnabledModelPatterns({ cwd: project, agentDir }), ["gpt-5"]);

	writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ enabledModels: ["anthropic/*"] }));
	assert.deepEqual(readEnabledModelPatterns({ cwd: project, agentDir }), ["anthropic/*"]);

	writeFileSync(join(project, ".pi", "settings.json"), "{ not json");
	assert.deepEqual(readEnabledModelPatterns({ cwd: project, agentDir }), ["gpt-5"]);
});

test("models - aggregateSessionUsage groups assistant messages per provider and model", () => {
	const entries = [
		{ type: "message", message: { role: "user" } },
		assistant("anthropic", "claude-opus-4", 100, 50, 0.5),
		assistant("openai", "gpt-5", 10, 5, 0.1),
		assistant("anthropic", "claude-opus-4", 200, 20, 0.25),
		{ type: "custom", message: {} },
	];
	const agg = aggregateSessionUsage(entries);
	assert.equal(Object.keys(agg).length, 2);
	const opus = agg["anthropic/claude-opus-4"];
	assert.equal(opus.messages, 2);
	assert.equal(opus.input, 300);
	assert.equal(opus.output, 70);
	assert.equal(opus.cacheRead, 10);
	assert.ok(Math.abs(opus.cost - 0.75) < 1e-9);
	assert.equal(agg["openai/gpt-5"].messages, 1);
});

function mockCtx(opts: { enabled?: string[]; scoped?: ModelLike[]; entries?: any[]; active?: ModelLike }): any {
	return {
		cwd: tmpdir(),
		model: opts.active,
		scopedModels: (opts.scoped ?? []).map((model) => ({ model })),
		modelRegistry: { getAvailable: () => MODELS },
		sessionManager: { getEntries: () => opts.entries ?? [] },
		getContextUsage: () => ({ tokens: 50000, contextWindow: 200000, percent: 25 }),
		__enabledModelPatterns: opts.enabled,
	};
}

test("models - buildModelRows uses scoped models and falls back to available when unset", () => {
	const entries = [
		assistant("anthropic", "claude-opus-4", 1000, 500, 0.42),
		assistant("openai", "gpt-5", 10, 5, 0.01),
	];
	const scoped = buildModelRows(mockCtx({ scoped: [MODELS[0], MODELS[2]], entries, active: MODELS[0] }), {
		enabledPatterns: undefined,
	});
	assert.equal(scoped.scoped, true);
	assert.deepEqual(scoped.rows.map((r) => r.id), ["claude-opus-4", "gpt-5"]);
	assert.equal(scoped.rows[0].active, true);
	assert.equal(scoped.rows[0].input, 1000);
	assert.equal(scoped.rows[0].contextTokens, 50000);
	assert.equal(scoped.rows[1].active, false);
	assert.equal(scoped.rows[1].contextTokens, undefined);

	const viaPatterns = buildModelRows(mockCtx({ entries }), { enabledPatterns: ["gpt-5", "*sonnet*"] });
	assert.equal(viaPatterns.scoped, true);
	assert.deepEqual(viaPatterns.rows.map((r) => r.id), ["gpt-5", "claude-sonnet-4"]);

	const fallback = buildModelRows(mockCtx({ entries }), { enabledPatterns: undefined, maxFallback: 2 });
	assert.equal(fallback.scoped, false);
	assert.equal(fallback.rows.length, 2);
	assert.equal(fallback.hidden, 2);
});

test("models - quota is only attached to the active model when resolver provides it", () => {
	const res = buildModelRows(mockCtx({ scoped: [MODELS[0], MODELS[2]], active: MODELS[0] }), {
		enabledPatterns: undefined,
		quotaForActive: () => 72,
	});
	assert.equal(res.rows[0].quotaPercent, 72);
	assert.equal(res.rows[1].quotaPercent, undefined);
});

test("models - formatModelRow shows real values and dashes for unknowns", () => {
	const row = formatModelRow({
		key: "x/y",
		id: "y",
		provider: "x",
		name: "Why",
		active: true,
		contextWindow: 200000,
		messages: 2,
		input: 12000,
		output: 3400,
		cacheRead: 0,
		cost: 0.1234,
		contextTokens: 50000,
		contextPercent: 25,
		quotaPercent: 72,
	});
	assert.ok(row.title.includes("Why"));
	assert.ok(row.right.includes("200K") || row.right.includes("200k"));
	assert.ok(row.detail.includes("12"));
	assert.ok(row.detail.includes("$0.12"));
	assert.ok(row.extra?.includes("25%"));
	assert.ok(row.extra?.includes("72%"));

	const idle = formatModelRow({
		key: "x/z",
		id: "z",
		provider: "x",
		name: "Zed",
		active: false,
		messages: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cost: 0,
	});
	assert.ok(idle.right.includes("-"));
	assert.equal(idle.extra, undefined);
});

test("models - WorkspaceModelsCard renders exact-width lines", () => {
	const entries = [assistant("anthropic", "claude-opus-4", 1000, 500, 0.42), assistant("openai", "gpt-5", 10, 5, 0.01)];
	const ctx = mockCtx({ scoped: [MODELS[0], MODELS[2], MODELS[3]], entries, active: MODELS[0] });
	const tui: any = { requestRender() {} };
	const card = new WorkspaceModelsCard(ctx, tui);
	for (const width of [30, 44, 50]) {
		const lines = card.render(width);
		assert.ok(lines.length >= 4);
		for (const line of lines) {
			assert.equal(calcVisibleWidth(line), width, `width ${width}: "${line}"`);
		}
		const text = lines.join("\n");
		assert.ok(text.includes("Models"));
		assert.ok(text.includes("claude-opus-4") || text.includes("Claude Opus"));
	}
});

test("models - WorkspaceModelsCard renders one name + provider line per model", () => {
	const entries = [assistant("anthropic", "claude-opus-4", 1000, 500, 0.42)];
	const ctx = mockCtx({ scoped: [MODELS[0], MODELS[2]], entries, active: MODELS[0] });
	const card = new WorkspaceModelsCard(ctx, { requestRender() {} } as any);
	const lines = card.render(50);
	assert.equal(lines.length, 4, "top + 2 models + bottom");
	const text = lines.join("\n");
	assert.ok(/● .*Claude Opus 4 · anthropic/.test(text) || /● .*claude-opus-4 · anthropic/.test(text), text);
	assert.ok(/○ .*GPT-5 · openai/.test(text) || /○ .*gpt-5 · openai/.test(text), text);
	for (const banned of ["ctx", "in /", "out", "$", "█", "░", "cuota"]) {
		assert.ok(!text.includes(banned), `must not include ${banned}`);
	}
	for (const line of lines) assert.equal(calcVisibleWidth(line), 50);
});

test("models - WorkspaceModelsCard empty state", () => {
	const ctx: any = {
		cwd: tmpdir(),
		scopedModels: [],
		modelRegistry: { getAvailable: () => [] },
		sessionManager: { getEntries: () => [] },
	};
	const card = new WorkspaceModelsCard(ctx, { requestRender() {} } as any);
	const lines = card.render(44);
	assert.ok(lines.join("\n").includes("Sin modelos habilitados"));
	for (const line of lines) assert.equal(calcVisibleWidth(line), 44);
});

test("models - usageBar fills by session tokens over the context window and colors by level", () => {
	const low = usageBar(50_000, 200_000);
	assert.equal(low.percent, 25);
	assert.equal(low.level, "ok");
	assert.equal(low.text.length, 12);
	assert.equal(low.text, "███░░░░░░░░░");

	assert.equal(usageBar(150_000, 200_000).level, "warn");
	assert.equal(usageBar(190_000, 200_000).level, "high");
	assert.equal(usageBar(900_000, 200_000).percent, 100, "usage above the window is capped at 100%");
	assert.equal(usageBar(900_000, 200_000).text, "████████████");
	assert.equal(usageBar(0, undefined).percent, 0, "unknown context window shows an empty bar");
	assert.equal(usageBar(0, undefined).level, "ok");
});

test("models - formatModelRow adds a usage bar for used models only", () => {
	const used = formatModelRow({
		key: "x/y",
		id: "y",
		provider: "x",
		name: "Why",
		active: false,
		contextWindow: 200000,
		messages: 2,
		input: 150000,
		output: 10000,
		cacheRead: 0,
		cost: 1.5,
	});
	assert.equal(used.bar?.level, "warn");
	assert.equal(used.bar?.percent, 80);
	assert.match(used.bar?.label ?? "", /160K\/200K \(80%\)/);

	const idle = formatModelRow({
		key: "x/z",
		id: "z",
		provider: "x",
		name: "Zed",
		active: false,
		messages: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cost: 0,
	});
	assert.equal(idle.bar, undefined);
});

function interactiveCard() {
	const set: any[] = [];
	const pi: any = { setModel: async (m: any) => { set.push(m); return true; } };
	const ctx = mockCtx({ scoped: [MODELS[0], MODELS[2], MODELS[3]], active: MODELS[0] });
	let renders = 0;
	const card = new WorkspaceModelsCard(ctx, { requestRender() { renders++; } } as any, undefined, pi);
	return { card, set, renders: () => renders };
}

test("models - moveCursor starts at the active model, wraps and requests a render", () => {
	const { card, renders } = interactiveCard();
	assert.equal(card.getSelectedIndex(), undefined);
	assert.ok(!card.render(50).join("\n").includes("›"));
	assert.equal(card.moveCursor(1), true);
	assert.equal(card.getSelectedIndex(), 1);
	card.moveCursor(1);
	card.moveCursor(1);
	assert.equal(card.getSelectedIndex(), 0, "wraps forward");
	card.moveCursor(-1);
	assert.equal(card.getSelectedIndex(), 2, "wraps backward");
	assert.equal(renders(), 4);
	const lines = card.render(50);
	assert.equal(lines.length, 5);
	assert.ok(lines[3].includes("›"), lines[3]);
	assert.equal(lines.filter((l) => l.includes("›")).length, 1);
	for (const line of lines) assert.equal(calcVisibleWidth(line), 50);
});

test("models - activateSelected switches via pi.setModel with the real model object", async () => {
	const { card, set } = interactiveCard();
	card.moveCursor(1);
	assert.equal(await card.activateSelected(), true);
	assert.equal(set.length, 1);
	assert.equal(set[0], MODELS[2]);
	assert.equal(card.getSelectedIndex(), 1);
});

test("models - handleClick on a model row (line index + 1) switches the model", async () => {
	const { card, set } = interactiveCard();
	assert.equal(card.handleClick(3), true);
	await new Promise((r) => setTimeout(r, 0));
	assert.equal(set[0], MODELS[3]);
	assert.equal(card.handleClick(0), false, "top border does nothing");
	assert.equal(card.handleClick(9), false, "outside rows does nothing");
	assert.equal(set.length, 1);
});
