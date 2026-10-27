import test from "node:test";
import assert from "node:assert/strict";
import {
	ensureCliProxyApiRunning,
	parseHostPort,
	resetCliProxyAutostartForTesting,
} from "../src/cliproxy-autostart.ts";

test("cliproxy-autostart - parseHostPort reads host/port and falls back on bad input", () => {
	assert.deepEqual(parseHostPort("http://127.0.0.1:8317"), { host: "127.0.0.1", port: 8317 });
	assert.deepEqual(parseHostPort("http://localhost:9000"), { host: "localhost", port: 9000 });
	assert.deepEqual(parseHostPort("not a url"), { host: "127.0.0.1", port: 8317 });
});

test("cliproxy-autostart - never spawns when the binary or config file is missing", async () => {
	resetCliProxyAutostartForTesting();
	let spawnCalled = false;
	const launched = await ensureCliProxyApiRunning({
		existsSync: () => false,
		spawn: (() => {
			spawnCalled = true;
			return { on: () => {}, unref: () => {} } as any;
		}) as any,
	});
	assert.equal(launched, false);
	assert.equal(spawnCalled, false);
});

test("cliproxy-autostart - never spawns when the port is already listening", async () => {
	resetCliProxyAutostartForTesting();
	let spawnCalled = false;
	const launched = await ensureCliProxyApiRunning({
		existsSync: () => true,
		isPortOpen: async () => true,
		spawn: (() => {
			spawnCalled = true;
			return { on: () => {}, unref: () => {} } as any;
		}) as any,
	});
	assert.equal(launched, false);
	assert.equal(spawnCalled, false);
});

test("cliproxy-autostart - spawns detached once when files exist and the port is closed", async () => {
	resetCliProxyAutostartForTesting();
	const spawnCalls: { cmd: string; args: string[]; opts: any }[] = [];
	const deps = {
		existsSync: () => true,
		isPortOpen: async () => false,
		spawn: ((cmd: string, args: string[], opts: any) => {
			spawnCalls.push({ cmd, args, opts });
			return { on: () => {}, unref: () => {} } as any;
		}) as any,
	};

	const first = await ensureCliProxyApiRunning(deps);
	assert.equal(first, true);
	assert.equal(spawnCalls.length, 1);
	assert.equal(spawnCalls[0].opts.detached, true);
	assert.equal(spawnCalls[0].opts.stdio, "ignore");

	// Second call in the same process is a no-op: autostart only ever attempts once.
	const second = await ensureCliProxyApiRunning(deps);
	assert.equal(second, false);
	assert.equal(spawnCalls.length, 1);
});

test("cliproxy-autostart - CLIPROXYAPI_AUTOSTART=0 disables the feature", async () => {
	resetCliProxyAutostartForTesting();
	process.env.CLIPROXYAPI_AUTOSTART = "0";
	try {
		let spawnCalled = false;
		const launched = await ensureCliProxyApiRunning({
			existsSync: () => true,
			isPortOpen: async () => false,
			spawn: (() => {
				spawnCalled = true;
				return { on: () => {}, unref: () => {} } as any;
			}) as any,
		});
		assert.equal(launched, false);
		assert.equal(spawnCalled, false);
	} finally {
		delete process.env.CLIPROXYAPI_AUTOSTART;
		resetCliProxyAutostartForTesting();
	}
});
