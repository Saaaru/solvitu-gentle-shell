import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { compactToolTarget } from "../src/tool-lines.ts";

test("compact tool target uses path, command or pattern and shortens the home folder", () => {
	assert.equal(compactToolTarget({ path: `${homedir()}/.pi/agent/web-search.json` }), "~/.pi/agent/web-search.json");
	assert.equal(compactToolTarget({ file_path: "src/a.ts" }), "src/a.ts");
	assert.equal(compactToolTarget({ command: "npm test\n--silent" }), "npm test --silent");
	assert.equal(compactToolTarget({ pattern: "TODO" }), "TODO");
	assert.equal(compactToolTarget({}), "");
});
