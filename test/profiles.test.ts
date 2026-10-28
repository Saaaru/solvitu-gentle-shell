import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	listAvailableProfiles,
	switchProfile,
	SDD_PROFILES_API_SYMBOL,
	extractAccountFromModel,
	extractUniqueAccounts,
	loadProfileDetails,
	WorkspaceProfilesExtendedCard,
	getActiveProfileDetails,
	collectSessionSubagentTasks,
	loadGentleAgentsDiskTasks,
	resetGentleAgentsTasksCache,
	formatTaskDuration,
} from "../src/solvi-profiles.ts";
import { resetActiveProfileCache } from "../src/solvi-paths.ts";
import { setCachedAccountsForTesting } from "../src/solvi-usage.ts";
import { resetAll, userConfigFile } from "./test-helpers.ts";

test("solvi-profiles - listAvailableProfiles and SDD_PROFILES_API_SYMBOL integration", () => {
	// 1. Filesystem discovery. Builds its own project profile dir instead of relying on
	// ~/.pi/agent/... or a builtin SDD profiles checkout existing on the host machine.
	const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "solvi-profiles-fs-"));
	try {
		const projectProfilesDir = path.join(tempCwd, ".pi", "profiles");
		fs.mkdirSync(projectProfilesDir, { recursive: true });
		fs.writeFileSync(
			path.join(projectProfilesDir, "fixture-profile.json"),
			JSON.stringify({ name: "fixture-profile", description: "Test fixture" }),
			"utf8",
		);

		const profiles = listAvailableProfiles(tempCwd);
		assert.ok(Array.isArray(profiles), "profiles should be an array");
		assert.ok(profiles.length > 0, "should find the project profile just written to .pi/profiles");
		assert.ok(
			profiles.some((p) => p.name === "fixture-profile"),
			"should include the fixture profile by name",
		);
	} finally {
		fs.rmSync(tempCwd, { recursive: true, force: true });
	}

	// 2. Global API override
	const mockApi = {
		listProfiles: () => [
			{ name: "mock-one", description: "Mock 1", active: true },
			{ name: "mock-two", description: "Mock 2", active: false },
		],
		getActiveProfile: () => "mock-one",
		activateProfile: async (name: string) => ({ success: true, message: `Activated ${name}` }),
	};

	(globalThis as any)[SDD_PROFILES_API_SYMBOL] = mockApi;
	try {
		const apiProfiles = listAvailableProfiles();
		assert.equal(apiProfiles.length, 2);
		assert.equal(apiProfiles[0].name, "mock-one");
		assert.equal(apiProfiles[0].active, true);
		assert.equal(apiProfiles[1].name, "mock-two");
		assert.equal(apiProfiles[1].active, false);
	} finally {
		delete (globalThis as any)[SDD_PROFILES_API_SYMBOL];
	}
});

test("solvi-profiles - switchProfile switches active profile via API and fallback", async () => {
	// 1. With API
	let activatedWith: string | null = null;
	(globalThis as any)[SDD_PROFILES_API_SYMBOL] = {
		listProfiles: () => [{ name: "mock-one", active: true }],
		getActiveProfile: () => "mock-one",
		activateProfile: async (name: string) => {
			activatedWith = name;
			return { success: true, message: `Perfil "${name}" activado correctamente.` };
		},
	};

	try {
		const res = await switchProfile("mock-one");
		assert.equal(res.success, true);
		assert.equal(activatedWith, "mock-one");
	} finally {
		delete (globalThis as any)[SDD_PROFILES_API_SYMBOL];
	}

	// 2. Fallback error when profile does not exist
	const notFound = await switchProfile("perfil-inexistente-xyz");
	assert.equal(notFound.success, false);
	assert.ok(notFound.message.includes("no encontrado"));
});

test("solvi-profiles - getActiveProfileDetails resolves active profile via readActiveProfile and API", () => {
	resetActiveProfileCache();
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solvi-active-details-test-"));
	try {
		// 1. Filesystem project-local resolution
		const projDir = path.join(tmpDir, ".pi", "profiles");
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(path.join(projDir, ".active"), "cinlo-custom", "utf8");
		fs.writeFileSync(
			path.join(projDir, "cinlo-custom.json"),
			JSON.stringify({ name: "cinlo-custom", description: "Custom Test Profile" }),
			"utf8",
		);

		const details = getActiveProfileDetails(tmpDir);
		assert.ok(details, "should return profile details");
		assert.equal(details?.name, "cinlo-custom");
		assert.equal(details?.description, "Custom Test Profile");

		// 2. Global SDD API override
		fs.writeFileSync(
			path.join(projDir, "api-active.json"),
			JSON.stringify({ name: "api-active", description: "API Profile" }),
			"utf8",
		);
		(globalThis as any)[SDD_PROFILES_API_SYMBOL] = {
			getActiveProfile: () => "api-active",
			listProfiles: () => [
				{ name: "api-active", description: "API Profile", active: true },
			],
		};
		resetActiveProfileCache();

		const apiDetails = getActiveProfileDetails(tmpDir);
		assert.ok(apiDetails, "should resolve via API");
		assert.equal(apiDetails?.name, "api-active");
		assert.equal(apiDetails?.description, "API Profile");
	} finally {
		delete (globalThis as any)[SDD_PROFILES_API_SYMBOL];
		fs.rmSync(tmpDir, { recursive: true, force: true });
		resetActiveProfileCache();
	}
});


test("solvi-profiles - extractAccountFromModel parses accounts from model strings", () => {
	assert.equal(extractAccountFromModel("cpamc/ranchesca/gemini-3.8-flash-high"), "ranchesca");
	assert.equal(extractAccountFromModel("cpamc/nekocin01/gemini-3.8-flash-high"), "nekocin01");
	assert.equal(extractAccountFromModel("cpamc/cinlo_dig/gemini-3.8-flash-high"), "cinlo_dig");
	assert.equal(extractAccountFromModel("cpam/cin82/claude-3-5-sonnet"), "cin82");
	assert.equal(extractAccountFromModel("proxy/neko02/gpt-4o"), "neko02");
	assert.equal(extractAccountFromModel("anthropic/claude-3-5-sonnet"), null);
	assert.equal(extractAccountFromModel(""), null);
	assert.equal(extractAccountFromModel(undefined), null);
});

test("solvi-profiles - extractUniqueAccounts collects unique accounts in order from profile", () => {
	const sampleProfile = {
		name: "cinlo1",
		default_model: "cpamc/ranchesca/gemini-3.8-flash-high",
		default_effort: "high",
		model_profiles: {
			"gentle-ai-worker": { model: "cpamc/nekocin01/gemini-3.8-flash-high", effort: "high" },
			"gentle-ai-explore": { model: "cpamc/cinlo_dig/gemini-3.8-flash-high", effort: "low" },
			"gentle-ai-verify": { model: "cpamc/cin82/gemini-3.8-flash-high", effort: "low" },
			"jd-judge-a": { model: "cpamc/cinlo_dig/gemini-3.8-flash-high", effort: "high" },
			"jd-judge-b": { model: "cpamc/neko02/gemini-3.8-flash-high", effort: "high" },
			"jd-fix-agent": { model: "cpamc/nekocin01/gemini-3.8-flash-high", effort: "high" },
			"review-risk": { model: "cpamc/cin82/gemini-3.8-flash-high", effort: "high" },
		},
	};

	const accounts = extractUniqueAccounts(sampleProfile as any);
	assert.deepEqual(accounts, ["ranchesca", "nekocin01", "cinlo_dig", "cin82", "neko02"]);
});

test("solvi-profiles - loadProfileDetails loads from temporary project directory", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solvi-profile-load-"));
	try {
		const projDir = path.join(tmpDir, ".pi", "profiles");
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(
			path.join(projDir, "test-cluster.json"),
			JSON.stringify({
				name: "test-cluster",
				description: "Test Cluster",
				default_model: "cpamc/ranchesca/gemini-3.8-flash-high",
				default_effort: "high",
				model_profiles: {
					"gentle-ai-worker": { model: "cpamc/nekocin01/gemini-3.8-flash-high", effort: "high" },
				},
			}),
			"utf8",
		);

		const loaded = loadProfileDetails("test-cluster", tmpDir);
		assert.ok(loaded);
		assert.equal(loaded?.name, "test-cluster");
		assert.equal(loaded?.default_model, "cpamc/ranchesca/gemini-3.8-flash-high");
		assert.ok(loaded?.model_profiles?.["gentle-ai-worker"]);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("solvi-profiles - WorkspaceProfilesExtendedCard renders switcher, accounts, subagent tree, and handles clicks", async () => {
	resetAll();
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solvi-profile-card-"));
	try {
		const projDir = path.join(tmpDir, ".pi", "profiles");
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(path.join(projDir, ".active"), "cinlo1", "utf8");
		fs.writeFileSync(
			path.join(projDir, "cinlo1.json"),
			JSON.stringify({
				name: "cinlo1",
				default_model: "cpamc/ranchesca/gemini-3.8-flash-high",
				default_effort: "high",
				model_profiles: {
					"gentle-ai-worker": { model: "cpamc/nekocin01/gemini-3.8-flash-high", effort: "high" },
					"gentle-ai-explore": { model: "cpamc/cinlo_dig/gemini-3.8-flash-high", effort: "low" },
				},
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(projDir, "cinlo2.json"),
			JSON.stringify({
				name: "cinlo2",
				default_model: "cpamc/nekocin01/gemini-3.8-flash-high",
				default_effort: "medium",
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(projDir, "cinlo3.json"),
			JSON.stringify({
				name: "cinlo3",
				default_model: "cpamc/ranchesca/gemini-3.8-flash-high",
				default_effort: "low",
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(projDir, "cinlo4.json"),
			JSON.stringify({
				name: "cinlo4",
				default_model: "cpamc/ranchesca/gemini-3.8-flash-high",
				default_effort: "high",
			}),
			"utf8",
		);

		// Also write task-manager.json
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "task-manager.json"),
			JSON.stringify({
				todos: [
					{ id: "1", title: "Implement feature", status: "completed" },
					{ id: "2", title: "Write tests", status: "in_progress" },
					{ id: "3", title: "Review PR", status: "pending" },
				],
			}),
			"utf8",
		);

		// Set cached quota accounts for testing
		setCachedAccountsForTesting([
			{
				provider: "antigravity",
				prefix: "ranchesca",
				pools: [
					{ label: "Gemini 5h", availablePercent: 85, used: 15, total: 100, unlimited: false, resetAt: "in 2 hours" },
					{ label: "Gemini Weekly", availablePercent: 90, used: 10, total: 100, unlimited: false, resetAt: "in 5 days" },
				],
			},
			{
				provider: "antigravity",
				prefix: "nekocin01",
				pools: [
					{ label: "Gemini 5h", availablePercent: 30, used: 70, total: 100, unlimited: false, resetAt: "in 1 hour" },
					{ label: "Gemini Weekly", availablePercent: 45, used: 55, total: 100, unlimited: false, resetAt: "in 3 days" },
				],
			},
		]);

		let renderRequested = false;
		const mockTui: any = {
			requestRender: () => {
				renderRequested = true;
			},
		};

		const card = new WorkspaceProfilesExtendedCard(mockTui, undefined, tmpDir);
		const lines = card.render(52);
		assert.ok(lines.length > 0, "Card should render lines");
		const fullText = lines.join("\n");

		// 1. Top profile switcher buttons - renders all discovered profiles with dynamic wrapping
		assert.ok(fullText.includes("cinlo1"), "Should render cinlo1 in switcher");
		assert.ok(fullText.includes("cinlo2"), "Should render cinlo2 in switcher");
		assert.ok(fullText.includes("cinlo3"), "Should render cinlo3 in switcher");
		assert.ok(fullText.includes("cinlo4"), "Should render cinlo4 in switcher");
		assert.ok(fullText.includes("●") && fullText.includes("○"), "Should render active/inactive dots");

		// Verify dynamic button lines for profiles exist:
		const linesWithButtons = lines.filter((l) => l.includes("[●") || l.includes("[○"));
		assert.ok(linesWithButtons.length >= 2, "Should wrap profile buttons across multiple lines dynamically");

		// 2. Compact format: no accounts, quota, gauges, or effort
		const plainText = fullText.replace(/\x1b\[[0-9;]*m/g, "");
		for (const banned of ["@", "sin cuota", "▰", "▱", "(high)", "(medium)", "(low)", "%", "Semanal"]) {
			assert.ok(!plainText.includes(banned), `Compact card must not render ${banned}`);
		}

		// 3. One line per role with short model name on the right
		assert.ok(/host \/ orquestador/i.test(fullText), "Should render Host orchestrator");
		assert.ok(!fullText.includes("ODD Core"), "Should not contain old collapsible category ODD Core");
		assert.ok(!fullText.includes("Judgment Day"), "Should not contain old collapsible category Judgment Day");
		const plainLines = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
		for (const needle of ["host / orquestador", "gentle-ai-explore", "gentle-ai-worker"]) {
			const matching = plainLines.filter((l) => l.includes(needle));
			assert.equal(matching.length, 1, `${needle} must render on exactly one line`);
			assert.ok(/gemini/i.test(matching[0]), `${needle} line must carry the short model name`);
		}
		const emptySpacerLines = plainLines.filter(
			(l) => l.startsWith("│") && l.endsWith("│") && l.slice(1, -1).trim() === "",
		);
		assert.equal(emptySpacerLines.length, 0, "Should not render blank spacer lines between agents");

		// 5. Task Manager status summary
		assert.ok(fullText.includes("Task Manager"), "Should render Task Manager status");
		assert.ok(fullText.includes("1/3"), "Should render 1/3 completed tasks");

		// 6. Click switcher hitbox to activate cinlo2
		const hitboxes = card.getSwitcherHitboxes();
		assert.ok(hitboxes.length >= 4, "Should have hitboxes for all discovered profiles");
		const targetHitbox = hitboxes.find((h) => h.profileName === "cinlo2");
		assert.ok(targetHitbox, "Hitbox for cinlo2 must exist");

		renderRequested = false;
		const clickHandled = card.handleRailClick(targetHitbox.lineIndex, "left", targetHitbox.startX + 1);
		assert.ok(clickHandled, "Click on cinlo2 button should be handled");

		// Wait briefly for switchProfile async file write
		await new Promise((r) => setTimeout(r, 50));
		assert.ok(renderRequested, "requestRender should be called on profile switch");
		const activeAfter = fs.readFileSync(path.join(projDir, ".active"), "utf8").trim();
		assert.equal(activeAfter, "cinlo2", "Active profile should be switched to cinlo2");

		// 7. Effort is no longer rendered, so no effort hitboxes exist
		assert.ok(!hitboxes.some((h) => h.type === "effort-agent" || h.type === "effort-host"), "No effort hitboxes");

		// 8. Test wheel on profiles card is disabled to preserve natural sidebar vertical scrolling
		renderRequested = false;
		const wheelHandled = card.handleRailWheel(1);
		assert.equal(wheelHandled, false, "handleRailWheel should return false to preserve vertical scroll");
		assert.equal(renderRequested, false, "requestRender should NOT be called on wheel when disabled");

		// 7. Click outside hitboxes returns false
		const missClick = card.handleRailClick(targetHitbox.lineIndex, "left", 999);
		assert.equal(missClick, false, "Click outside hitbox bounds should return false");

		// 8. Narrow width rendering safety (width = 30)
		const narrowLines = card.render(30);
		assert.ok(narrowLines.length > 0);
		for (const line of narrowLines) {
			assert.ok(visibleWidth(line) <= 30, `Line width ${visibleWidth(line)} should be <= 30`);
		}
	} finally {
		setCachedAccountsForTesting(null);
		fs.rmSync(tmpDir, { recursive: true, force: true });
		resetAll();
	}
});

test("solvi-profiles - WorkspaceProfilesExtendedCard internal scrolling and height constraint", () => {
	resetAll();
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solvi-scroll-test-"));
	try {
		const projDir = path.join(tmpDir, ".pi", "profiles");
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(path.join(projDir, ".active"), "prof1", "utf8");
		fs.writeFileSync(
			path.join(projDir, "prof1.json"),
			JSON.stringify({
				name: "prof1",
				default_model: "cpamc/acc1/gemini-3.8-flash-high",
				default_effort: "high",
				model_profiles: {
					"gentle-ai-worker": { model: "cpamc/acc2/gemini-3.8-flash-high", effort: "high" },
					"gentle-ai-explore": { model: "cpamc/acc3/gemini-3.8-flash-high", effort: "low" },
					"jd-judge-a": { model: "cpamc/acc1/gemini-3.8-flash-high", effort: "high" },
					"review-risk": { model: "cpamc/acc2/gemini-3.8-flash-high", effort: "medium" },
					"review-reliability": { model: "cpamc/acc3/gemini-3.8-flash-high", effort: "low" },
					"research-scout": { model: "cpamc/acc1/gemini-3.8-flash-high", effort: "high" },
					"research-writer": { model: "cpamc/acc2/gemini-3.8-flash-high", effort: "medium" },
				},
			}),
			"utf8",
		);

		let renderRequested = false;
		const mockTui: any = {
			requestRender: () => {
				renderRequested = true;
			},
		};

		const card = new WorkspaceProfilesExtendedCard(mockTui, undefined, tmpDir);

		// 1. Calling render(52, 9) constrains lines to exactly 9 (8 compact body lines overflow 5 available)
		const lines = card.render(52, 9);
		assert.equal(lines.length, 9, "Lines must be constrained to exactly 9");

		// Top header and divider should be intact
		assert.ok(lines[0].includes("Profiles & Clusters"), "Header must be at the top");
		const fullText = lines.join("\n");
		assert.ok(fullText.includes("wheel scroll"), "Scroll indicator must be visible when content overflows");
		assert.ok(fullText.includes("abajo"), "Should indicate remaining lines below");

		// 2. handleRailWheel(1) increments scrollOffset and requests render
		renderRequested = false;
		const wheelDownHandled = card.handleRailWheel(1);
		assert.equal(wheelDownHandled, true, "Wheel down should be handled internally");
		assert.equal(renderRequested, true, "requestRender should be called on scroll");

		const scrolledLines = card.render(52, 9);
		assert.equal(scrolledLines.length, 9, "Scrolled lines must still equal 25");
		const scrolledText = scrolledLines.join("\n");
		assert.ok(scrolledText.includes("arriba"), "Should indicate scrolled lines above");

		// 3. handleRailWheel(-1) decrements scrollOffset
		renderRequested = false;
		const wheelUpHandled = card.handleRailWheel(-1);
		assert.equal(wheelUpHandled, true, "Wheel up should be handled internally");
		assert.equal(renderRequested, true, "requestRender should be called on scroll up");

		// 4. Boundary behavior: scrolling past top returns true but doesn't request unnecessary render
		renderRequested = false;
		const topBoundaryHandled = card.handleRailWheel(-1);
		assert.equal(topBoundaryHandled, true, "Top boundary wheel should return true to block outer scroll");
		assert.equal(renderRequested, false, "Should not requestRender when already at boundary");

		// 5. wheelDelta === 0 returns false
		assert.equal(card.handleRailWheel(0), false, "handleRailWheel(0) should return false");

		// 6. When availableHeight is large (no overflow), pad with empty lines to match availableHeight
		const largeLines = card.render(52, 60);
		assert.equal(largeLines.length, 60, "Lines must be padded to exactly target availableHeight 60");
		const largeText = largeLines.join("\n");
		assert.ok(!largeText.includes("wheel scroll"), "No scroll indicator should be present when content fits");

		// 7. When availableHeight is undefined and no terminal rows, render natural unconstrained lines
		const unconstrainedLines = card.render(52);
		assert.ok(unconstrainedLines.length > 0);
		assert.ok(!unconstrainedLines.join("\n").includes("wheel scroll"));
		// And handleRailWheel returns false when unconstrained
		assert.equal(card.handleRailWheel(1), false, "handleRailWheel should return false when unconstrained");

		// 8. Terminal rows calculation fallback when availableHeight is undefined
		mockTui.terminal = { rows: 40 };
		const terminalRowsLines = card.render(52);
		assert.equal(terminalRowsLines.length, 29, "Lines should equal terminal.rows - 11 (40 - 11 = 29)");
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		resetAll();
	}
});

test("solvi-profiles - edge cases for account extraction and empty profiles", () => {
	// Malformed model strings
	assert.equal(extractAccountFromModel("cpamc//model"), null);
	assert.equal(extractAccountFromModel("cpamc/ranchesca"), null);
	assert.equal(extractAccountFromModel("   "), null);

	// Empty profile
	const emptyProfile: any = {};
	assert.deepEqual(extractUniqueAccounts(emptyProfile), []);

	// Profile with empty model_profiles
	const minimalProfile: any = { name: "min", model_profiles: {} };
	assert.deepEqual(extractUniqueAccounts(minimalProfile), []);

	// Non-existent profile details load
	assert.equal(loadProfileDetails("does-not-exist-xyz", "/tmp"), null);
});

test("solvi-profiles - compact host and subagent rows ignore provider quota pools", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solvi-profiles-provider-"));
	const profilesDir = path.join(tmpDir, ".pi", "profiles");
	fs.mkdirSync(profilesDir, { recursive: true });

	const profileData = {
		name: "test-multiprovider",
		description: "Multi-provider test",
		default_model: "cpamc/cilon-gpt/gpt-6.1-sol",
		default_effort: "high",
		model_profiles: {
			"gentle-ai-worker": {
				model: "cpamc/testacct/gemini-4-argon-high",
				effort: "high",
			},
		},
	};

	fs.writeFileSync(path.join(profilesDir, "test-multiprovider.json"), JSON.stringify(profileData));
	fs.writeFileSync(path.join(profilesDir, ".active"), "test-multiprovider");

	// Provide two colliding accounts: 'cilon' (antigravity) and 'cilon-gpt' (codex),
	// plus 'testacct' with ONLY weekly pool (like Gemini/Argon)
	setCachedAccountsForTesting([
		{
			provider: "antigravity",
			prefix: "cilon",
			pools: [
				{ label: "Claude and GPT models · Weekly Limit Remaining", availablePercent: 10, used: 90, total: 100, unlimited: false, resetAt: null },
			],
		},
		{
			provider: "codex",
			prefix: "cilon-gpt",
			pools: [
				{ label: "Codex / Plus 5h", availablePercent: 67, used: 33, total: 100, unlimited: false, resetAt: null },
				{ label: "Codex / Plus Semanal", availablePercent: 81, used: 19, total: 100, unlimited: false, resetAt: null },
			],
		},
		{
			provider: "antigravity",
			prefix: "testacct",
			pools: [
				// Only 1 pool: Weekly
				{ label: "Gemini Models · Weekly Limit Remaining", availablePercent: 100, used: 0, total: 100, unlimited: false, resetAt: null },
			],
		},
	]);

	try {
		const mockTui: any = { requestRender: () => {} };
		const card = new WorkspaceProfilesExtendedCard(mockTui, undefined, tmpDir);
		const lines = card.render(50);
		const fullText = lines.join("\n");

		// Compact: host + worker on one line each, short model names, no quota/account data
		const plain = fullText.replace(/\x1b\[[0-9;]*m/g, "");
		for (const banned of ["@", "cilon", "testacct", "%", "Semanal", "sin cuota"]) {
			assert.ok(!plain.includes(banned), `Compact card must not render ${banned}`);
		}
		const plainRows = plain.split(/\n/);
		const hostLine = plainRows.filter((l) => l.includes("host / orquestador"));
		assert.equal(hostLine.length, 1);
		const workerLine = plainRows.filter((l) => l.includes("gentle-ai-worker"));
		assert.equal(workerLine.length, 1);
		for (const l of lines) assert.equal(visibleWidth(l), 50);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		resetAll();
	}
});

const callEntry = (id: string, name: string, args: any, ts = 1000) => ({
	type: "message",
	message: { role: "assistant", timestamp: ts, content: [{ type: "toolCall", id, name, arguments: args }] },
});
const resultEntry = (toolCallId: string, text: string, extra: any = {}, ts = 5000) => ({
	type: "message",
	message: { role: "toolResult", toolCallId, timestamp: ts, content: [{ type: "text", text }], ...extra },
});
const sessionCtx = (entries: any[]) => ({ sessionManager: { getBranch: () => entries } });

test("solvi-profiles - formatTaskDuration formats seconds and minutes", () => {
	assert.equal(formatTaskDuration(0), "0s");
	assert.equal(formatTaskDuration(12_400), "12s");
	assert.equal(formatTaskDuration(125_000), "2m 5s");
});

test("solvi-profiles - collectSessionSubagentTasks handles task, background, failed and cancelled runs", () => {
	const entries = [
		callEntry("c1", "subagent_run", { agent: "gentle-ai-worker", label: "Fg job", task: "do it" }, 1000),
		resultEntry("c1", "all good", { details: { gentleAgents: { taskId: "t-fg" } } }, 4000),
		callEntry("c2", "subagent_run", { agent: "jd-judge-a", label: "Bg job", task: "bg", mode: "background" }, 1000),
		resultEntry("c2", "Started in the background", { details: { gentleAgents: { taskId: "t-bg", mode: "background" } } }),
		{ type: "custom_message", customType: "gentle-agents", content: "Subagent t-bg completed: finished ok", details: { taskId: "t-bg" }, timestamp: new Date(9000).toISOString() },
		callEntry("c3", "subagent_run", { agent: "review-risk", label: "Bad job", task: "x" }, 1000),
		resultEntry("c3", "boom exploded", { isError: true }),
		callEntry("c4", "subagent_run", { agent: "research-scout", label: "Cancel job", task: "y", mode: "background" }, 1000),
		resultEntry("c4", "running in the background", { details: { taskId: "t-cancel" } }),
		callEntry("c5", "subagent_cancel", { task_id: "t-cancel" }, 6000),
	];
	const tasks = collectSessionSubagentTasks(sessionCtx(entries));
	assert.equal(tasks.length, 4);
	const fg = tasks.find((t) => t.id === "t-fg")!;
	assert.equal(fg.status, "completed");
	assert.equal(fg.mode, "task");
	assert.equal(fg.finishedAt, 4000);
	assert.equal(fg.resultSummary, "all good");
	const bg = tasks.find((t) => t.id === "t-bg")!;
	assert.equal(bg.mode, "background");
	assert.equal(bg.status, "completed");
	assert.equal(bg.finishedAt, 9000);
	assert.match(bg.resultSummary!, /finished ok/);
	const bad = tasks.find((t) => t.agent === "review-risk")!;
	assert.equal(bad.status, "failed");
	assert.match(bad.error!, /boom/);
	assert.equal(tasks.find((t) => t.id === "t-cancel")!.status, "cancelled");

	// Background run with no completion stays running
	const running = collectSessionSubagentTasks(
		sessionCtx([
			callEntry("r1", "subagent_run", { agent: "x", task: "t", mode: "background" }),
			resultEntry("r1", "ok", { details: { taskId: "t-run" } }),
		]),
	);
	assert.equal(running[0].status, "running");
	assert.equal(running[0].resultSummary, "En background…");
	assert.deepEqual(collectSessionSubagentTasks(undefined), []);
});

test("solvi-profiles - loadGentleAgentsDiskTasks filters by targetCwd and parentSessionId", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solvi-disk-tasks-"));
	try {
		const write = (id: string, task: any) =>
			fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ task: { id, agent: "gentle-ai-worker", label: id, mode: "background", status: "completed", startedAt: 100, endedAt: 200, ...task } }));
		const proj = path.join(dir, "proj");
		write("in-root", { cwd: proj, parentSessionId: "s1" });
		write("in-sub", { cwd: path.join(proj, "sub"), parentSessionId: "s2" });
		write("other", { cwd: path.join(dir, "other") });
		write("no-cwd", {});
		fs.writeFileSync(path.join(dir, "bad.json"), "{nope");
		resetGentleAgentsTasksCache();
		const ids = (list: any[]) => list.map((t) => t.id).sort();
		assert.deepEqual(ids(loadGentleAgentsDiskTasks(undefined, 10, dir, proj)), ["in-root", "in-sub"]);
		resetGentleAgentsTasksCache();
		assert.deepEqual(ids(loadGentleAgentsDiskTasks("s1", 10, dir, proj)), ["in-root"]);
		resetGentleAgentsTasksCache();
		assert.equal(loadGentleAgentsDiskTasks(undefined, 10, dir).length, 4);
		resetGentleAgentsTasksCache();
		assert.equal(loadGentleAgentsDiskTasks(undefined, 2, dir).length, 2);
	} finally {
		resetGentleAgentsTasksCache();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("solvi-profiles - WorkspaceProfilesExtendedCard renders delegated subagents section within width and scroll", () => {
	resetAll();
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solvi-subagents-card-"));
	try {
		const projDir = path.join(tmpDir, ".pi", "profiles");
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(path.join(projDir, ".active"), "prof1", "utf8");
		fs.writeFileSync(
			path.join(projDir, "prof1.json"),
			JSON.stringify({ name: "prof1", default_model: "cpamc/acc1/gemini-3.8-flash-high", default_effort: "high", model_profiles: {} }),
		);
		const mockTui: any = { requestRender: () => {} };

		// No tasks: no section
		const plain = new WorkspaceProfilesExtendedCard(mockTui, undefined, tmpDir).render(60);
		assert.ok(!plain.join("\n").includes("Subagentes Delegados"));

		const now = Date.now();
		const entries = [
			callEntry("c1", "subagent_run", { agent: "gentle-ai-worker", label: "Fg job", task: "a" }, now - 125_000),
			resultEntry("c1", "all good", { details: { taskId: "t-fg" } }, now),
			callEntry("c2", "subagent_run", { agent: "jd-judge-a", label: "Bg job", task: "b", mode: "background" }, now - 5000),
			resultEntry("c2", "in the background", { details: { taskId: "t-bg" } }, now),
			callEntry("c3", "subagent_run", { agent: "review-risk", label: "Bad job", task: "c" }, now - 3000),
			resultEntry("c3", "kaboom", { isError: true }, now),
			callEntry("c4", "subagent_run", { agent: "research-scout", label: "Cancel job", task: "d", mode: "background" }, now - 2000),
			resultEntry("c4", "in the background", { details: { taskId: "t-cx" } }, now),
			callEntry("c5", "subagent_cancel", { task_id: "t-cx" }, now - 1000),
		];
		const ctx: any = sessionCtx(entries);
		const card = new WorkspaceProfilesExtendedCard(mockTui, undefined, tmpDir, ctx);
		for (const w of [40, 60]) {
			const lines = card.render(w);
			for (const l of lines) assert.equal(visibleWidth(l), Math.max(30, w));
		}
		const text = card.render(60).join("\n");
		assert.ok(text.includes("⚡ Subagentes Delegados"));
		for (const needle of ["[gentle-ai-worker]", "Fg job", "[jd-judge-a]", "Bg job", "[review-risk]", "[research-scout]", "RUNNING", "DONE", "FAIL", "CANCEL", "ID: t-fg", "ID: t-bg", "bg", "2m 5s", "↳ kaboom", "En background…"]) {
			assert.ok(text.includes(needle), `missing ${needle}`);
		}

		// Internal scrolling keeps exact height and width
		const constrained = card.render(60, 14);
		assert.equal(constrained.length, 14);
		for (const l of constrained) assert.equal(visibleWidth(l), 60);
		assert.ok(constrained.join("\n").includes("wheel scroll"));
		assert.equal(card.handleRailWheel(1), true);
		const scrolled = card.render(60, 14);
		assert.equal(scrolled.length, 14);
		for (const l of scrolled) assert.equal(visibleWidth(l), 60);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		resetAll();
	}
});
