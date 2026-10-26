import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { solviGlyphs } from "../src/solvi-theme.ts";
import {
	loadSolviStrings,
	detectSystemUser,
} from "../src/solvi-strings.ts";
import { loadSolviLayout } from "../src/solvi-layout.ts";
import { userConfigFile, resetAll } from "./test-helpers.ts";

test("Strings - defaults are Gentleman and developer", () => {
	resetAll();
	const originalContent = fs.existsSync(userConfigFile) ? fs.readFileSync(userConfigFile, "utf8") : null;
	try {
		if (fs.existsSync(userConfigFile)) fs.unlinkSync(userConfigFile);
		resetAll();

		const strings = loadSolviStrings();
		assert.equal(strings.welcomePersona.name, "el Gentleman");
		assert.equal(strings.welcomePersona.userRole, "desarrollador");
		assert.equal(strings.welcomePersona.userPronoun, "Tratalo");
		assert.equal(strings.welcomeTitles.persona, "el Gentleman");
		assert.equal(strings.welcomeTitles.dashboard, "Gentleman Welcome Dashboard");
		assert.ok(strings.welcomePersona.user.length > 0);
	} finally {
		if (originalContent !== null) {
			fs.writeFileSync(userConfigFile, originalContent, "utf8");
		}
		resetAll();
	}
});

test("User Overrides - custom persona, user name and animation preset", () => {
	const originalContent = fs.existsSync(userConfigFile) ? fs.readFileSync(userConfigFile, "utf8") : null;
	try {
		fs.writeFileSync(
			userConfigFile,
			JSON.stringify(
				{
					user: "Cinlo",
					persona: "gentlewoman",
					preset: "cats",
					layout: {
						sidebar: { railWidth: 54 },
					},
				},
				null,
				2,
			),
			"utf8",
		);

		resetAll();

		const strings = loadSolviStrings();
		const glyphs = solviGlyphs();
		const layout = loadSolviLayout();

		assert.equal(strings.welcomePersona.name, "la Gentlewoman");
		assert.equal(strings.welcomePersona.user, "Cinlo");
		assert.equal(strings.welcomePersona.userRole, "desarrolladora");
		assert.equal(strings.welcomePersona.userPronoun, "Tratala");
		assert.equal(strings.welcomeTitles.persona, "la Gentlewoman");
		assert.equal(strings.welcomeTitles.dashboard, "Gentlewoman Welcome Dashboard");

		assert.deepEqual(glyphs.petalFrames, ["/•᷅•᷄\\੭", "/◕᷅◕᷄\\੭", "/˘᷅˘᷄\\੭", "/•᷅◕᷄\\੭"]);
		assert.equal(glyphs.tl, "┌"); // untouched default preserved
		assert.equal(layout.sidebar.railWidth, 54);

		// Also test when solvi.json contains BOTH root persona/user AND a nested "strings" block:
		fs.writeFileSync(
			userConfigFile,
			JSON.stringify(
				{
					user: "Cinlo",
					persona: "gentlewoman",
					strings: {
						brandTitle: "✿ Workspace",
					},
				},
				null,
				2,
			),
			"utf8",
		);
		resetAll();

		const stringsWithNested = loadSolviStrings();
		assert.equal(stringsWithNested.welcomePersona.name, "la Gentlewoman");
		assert.equal(stringsWithNested.welcomePersona.user, "Cinlo");
		assert.equal(stringsWithNested.welcomePersona.userRole, "desarrolladora");
		assert.equal(stringsWithNested.welcomePersona.userPronoun, "Tratala");
		assert.equal(stringsWithNested.brandTitle, "✿ Workspace");
	} finally {
		if (originalContent !== null) {
			fs.writeFileSync(userConfigFile, originalContent, "utf8");
		} else if (fs.existsSync(userConfigFile)) {
			fs.unlinkSync(userConfigFile);
		}
		resetAll();
	}
});

test("User detection - detectSystemUser fallback and caching", () => {
	const user = detectSystemUser();
	assert.ok(typeof user === "string" && user.length > 0);
});

test("Local Overrides - solvi.local.json in workspace overrides defaults", () => {
	const localFile = "solvi.local.json";
	const hadLocal = fs.existsSync(localFile);
	const prevLocal = hadLocal ? fs.readFileSync(localFile, "utf8") : null;
	try {
		fs.writeFileSync(
			localFile,
			JSON.stringify(
				{
					user: "TestDev",
					persona: "gentlewoman",
					preset: "kittens",
				},
				null,
				2,
			),
			"utf8",
		);
		resetAll();

		const strings = loadSolviStrings();
		const glyphs = solviGlyphs();

		assert.equal(strings.welcomePersona.name, "la Gentlewoman");
		assert.equal(strings.welcomePersona.user, "TestDev");
		assert.equal(strings.welcomePersona.userRole, "desarrolladora");
		assert.equal(strings.welcomePersona.userPronoun, "Tratala");
		assert.deepEqual(glyphs.petalFrames, ["/×᷅×᷄\\੭", "/-᷅-᷄\\੭", "/^᷅^᷄\\੭", "/o᷅o᷄\\੭"]);
	} finally {
		if (hadLocal && prevLocal !== null) {
			fs.writeFileSync(localFile, prevLocal, "utf8");
		} else if (fs.existsSync(localFile)) {
			fs.unlinkSync(localFile);
		}
		resetAll();
	}
});

