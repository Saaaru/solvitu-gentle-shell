import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { syncBundledProfiles } from "../src/profiles/profile-sync.ts";
import { testAgentDir } from "./test-helpers.ts";

function tmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "profile-sync-"));
}

test("profile-sync - copies missing profile and creates the dir", () => {
	const src = tmp();
	const dest = path.join(tmp(), "nested", "profiles");
	fs.writeFileSync(path.join(src, "A.json"), '{"name":"A"}');
	syncBundledProfiles(src, dest);
	assert.equal(fs.readFileSync(path.join(dest, "A.json"), "utf8"), '{"name":"A"}');
});

test("profile-sync - never overwrites an existing profile", () => {
	const src = tmp();
	const dest = tmp();
	fs.writeFileSync(path.join(src, "A.json"), '{"name":"A"}');
	fs.writeFileSync(path.join(dest, "A.json"), '{"name":"local"}');
	syncBundledProfiles(src, dest);
	assert.equal(fs.readFileSync(path.join(dest, "A.json"), "utf8"), '{"name":"local"}');
});

test("profile-sync - skips invalid JSON and non-json files", () => {
	const src = tmp();
	const dest = tmp();
	fs.writeFileSync(path.join(src, "bad.json"), "{nope");
	fs.writeFileSync(path.join(src, "note.txt"), "x");
	syncBundledProfiles(src, dest);
	assert.deepEqual(fs.readdirSync(dest), []);
});

test("profile-sync - never throws when source dir is missing", () => {
	assert.doesNotThrow(() => syncBundledProfiles(path.join(tmp(), "nope"), tmp()));
});

test("profile-sync - idempotent second call", () => {
	const src = tmp();
	const dest = tmp();
	fs.writeFileSync(path.join(src, "A.json"), '{"name":"A"}');
	syncBundledProfiles(src, dest);
	fs.writeFileSync(path.join(dest, "A.json"), '{"name":"edited"}');
	syncBundledProfiles(src, dest);
	assert.equal(fs.readFileSync(path.join(dest, "A.json"), "utf8"), '{"name":"edited"}');
});

test("profile-sync - defaults sync repo profiles/ into PI_AGENT_DIR/profiles", () => {
	syncBundledProfiles();
	assert.ok(fs.existsSync(path.join(testAgentDir, "profiles", "Saaaru.json")));
});
