import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
	solviGlyphs,
	PETAL_PRESETS,
	installWelcomeHeaderGuard,
} from "../src/solvi-theme.ts";
import { loadSolviColors } from "../src/solvi-colors.ts";
import { userConfigFile, resetAll } from "./test-helpers.ts";

test("Theme Glyphs - default Double line and Petal frames", () => {
	const originalContent = fs.existsSync(userConfigFile) ? fs.readFileSync(userConfigFile, "utf8") : null;
	try {
		if (fs.existsSync(userConfigFile)) fs.unlinkSync(userConfigFile);
		resetAll();

		const glyphs = solviGlyphs();
		assert.equal(glyphs.tl, "┌");
		assert.equal(glyphs.tr, "┐");
		assert.equal(glyphs.h, "─");
		assert.equal(glyphs.v, "│");
		assert.deepEqual(glyphs.petalFrames, ["🐝"]);
	} finally {
		if (originalContent !== null) {
			fs.writeFileSync(userConfigFile, originalContent, "utf8");
		}
		resetAll();
	}
});

test("Animation Presets - cats, sparkles, hearts, ascii", () => {
	assert.deepEqual(PETAL_PRESETS.cats, ["/•᷅•᷄\\੭", "/◕᷅◕᷄\\੭", "/˘᷅˘᷄\\੭", "/•᷅◕᷄\\੭"]);
	assert.deepEqual(PETAL_PRESETS.kittens, ["/×᷅×᷄\\੭", "/-᷅-᷄\\੭", "/^᷅^᷄\\੭", "/o᷅o᷄\\੭"]);
	assert.notDeepEqual(PETAL_PRESETS.kittens, PETAL_PRESETS.cats);
	assert.deepEqual(PETAL_PRESETS.sparkles, ["✦", "✧", "★", "☆"]);
	assert.deepEqual(PETAL_PRESETS.stars, ["✶", "✷", "✸", "✹"]);
	assert.notDeepEqual(PETAL_PRESETS.stars, PETAL_PRESETS.sparkles);
	assert.deepEqual(PETAL_PRESETS.hearts, ["♡", "♥", "ღ", "❦"]);
	assert.deepEqual(PETAL_PRESETS.ascii, ["*", "+", "o", "x"]);
});

test("Solvi Colors - defaults and user overrides", () => {
	const originalContent = fs.existsSync(userConfigFile) ? fs.readFileSync(userConfigFile, "utf8") : null;
	try {
		if (fs.existsSync(userConfigFile)) fs.unlinkSync(userConfigFile);
		resetAll();

		const colors = loadSolviColors();
		assert.equal(colors.userMessage, "userMessageText");
		assert.equal(colors.bashMessage, "bash");
		assert.equal(colors.fetchMessage, "pink");
		assert.equal(colors.searchMessage, "secondary");
		assert.equal(colors.memoryMessage, "salmon");
		assert.equal(colors.gentleCardSuccess, "success");
		assert.equal(colors.gentleCardWarning, "warning");
		assert.equal(colors.gentleCardError, "error");
		assert.equal(colors.readMessage, "read");
		assert.equal(colors.writeMessage, "write");
		assert.equal(colors.errorMessage, "error");
		assert.equal(colors.sidebarBorder, "border");
		assert.equal(colors.reviewMessage, "gentle");

		// Test user override
		fs.writeFileSync(
			userConfigFile,
			JSON.stringify({
				colors: {
					userMessage: "accent",
					gentleCardWarning: "gold",
					reviewMessage: "#a46db5",
				},
			}),
			"utf8",
		);
		resetAll();

		const overridden = loadSolviColors();
		assert.equal(overridden.userMessage, "accent");
		assert.equal(overridden.gentleCardWarning, "gold");
		assert.equal(overridden.gentleCardSuccess, "success");
		assert.equal(overridden.reviewMessage, "#a46db5");
	} finally {
		if (originalContent !== null) {
			fs.writeFileSync(userConfigFile, originalContent, "utf8");
		} else if (fs.existsSync(userConfigFile)) {
			fs.unlinkSync(userConfigFile);
		}
		resetAll();
	}
});

test("installWelcomeHeaderGuard - protects Welcome Dashboard against late foreign overwrites", () => {
	const mockTheme = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
	};
	let activeHeader: any = null;
	const mockCtx: any = {
		hasUI: true,
		mode: "tui",
		ui: {
			setHeader(factory: any) {
				activeHeader = factory;
			},
		},
	};

	let welcomeActive = true;
	installWelcomeHeaderGuard(mockCtx, () => welcomeActive);

	// 1. Own welcome header installs correctly
	const solviFactory: any = () => ({ render: () => ["┌─ la Gentlewoman ─┐"] });
	solviFactory.__isSolviWelcome = true;
	mockCtx.ui.setHeader(solviFactory);
	assert.equal(activeHeader, solviFactory);

	// 2. Foreign extension (e.g. gentle-pi startup-banner deferred setTimeout) tries to overwrite
	const foreignBannerFactory: any = () => ({ render: () => ["GIT: main", "MCP: 3"] });
	mockCtx.ui.setHeader(foreignBannerFactory);

	// Active header MUST remain the solvi factory, foreign overwrite is blocked!
	assert.equal(activeHeader, solviFactory, "Foreign overwrite must be blocked while Welcome Dashboard is active");

	// 3. User disables welcome (/welcome off) -> header is cleared
	welcomeActive = false;
	mockCtx.ui.setHeader(undefined);
	assert.equal(activeHeader, undefined, "Header should be cleared when welcome is toggled off");

	// 4. Foreign extension sets header while welcome is disabled -> passes and is adapted
	mockCtx.ui.setHeader(foreignBannerFactory);
	assert.ok(activeHeader !== null && activeHeader !== undefined);
	assert.ok(typeof activeHeader === "function");
	const rendered = activeHeader({}, mockTheme).render(40);
	assert.ok(Array.isArray(rendered));
});

test("Workspace.json theme - userMessageBg and toolSuccessBg current values", () => {
	// Pins today's palette so unrelated changes get caught; colors are actively being
	// tuned, so update these literals here when they change on purpose.
	const themePath = fileURLToPath(new URL("../themes/Workspace.json", import.meta.url));
	assert.ok(fs.existsSync(themePath), "themes/Workspace.json must exist");
	const themeJson = JSON.parse(fs.readFileSync(themePath, "utf8"));
	assert.equal(themeJson.vars.userMessageBg, "#1A0B2E");
	assert.equal(themeJson.vars.toolSuccessBg, "#0D0221");
	assert.equal(themeJson.vars.userMessageText, "#E0D4FF");
	assert.equal(themeJson.colors.userMessageBg, "userMessageBg");
});

test("Workspace.json theme - strictly conforms to Pi 1.2.0 ThemeJsonSchema", async () => {
	const themePath = fileURLToPath(new URL("../themes/Workspace.json", import.meta.url));
	const themeJson = JSON.parse(fs.readFileSync(themePath, "utf8"));
	assert.equal(themeJson.$schema, "https://pi.dev/schemas/theme.schema.json");
	assert.equal(themeJson.glyphs, undefined, "glyphs must not exist on root");

	// Official Pi 1.2.0 validator check
	try {
		const base = "/home/testuser/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent";
		const { validateThemeJson } = await import(base + "/dist/modes/interactive/theme/theme-schema.js");
		assert.doesNotThrow(() => validateThemeJson("Workspace.json", themeJson));
	} catch (e: any) {
		if (e?.code === "ERR_MODULE_NOT_FOUND") {
			return;
		}
		throw e;
	}
});
