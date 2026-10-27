import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Socket } from "node:net";
import { resolveBaseUrl } from "./usage/usage-client.ts";

export const CLIPROXYAPI_DIR = process.env.CLIPROXYAPI_DIR ?? join(homedir(), "CLIProxyAPI");
const CLIPROXYAPI_BIN = process.env.CLIPROXYAPI_BIN_PATH ?? join(CLIPROXYAPI_DIR, "cli-proxy-api.exe");
const CLIPROXYAPI_CONFIG = process.env.CLIPROXYAPI_CONFIG_PATH ?? join(CLIPROXYAPI_DIR, "config.yaml");
const PORT_PROBE_TIMEOUT_MS = 500;

export interface AutostartDeps {
	spawn?: typeof spawn;
	existsSync?: typeof existsSync;
	isPortOpen?: (host: string, port: number) => Promise<boolean>;
}

/** Parses "host:port" out of a base URL, defaulting to 127.0.0.1:8317 on any parse failure. */
export function parseHostPort(baseUrl: string): { host: string; port: number } {
	try {
		const url = new URL(baseUrl);
		return { host: url.hostname || "127.0.0.1", port: Number(url.port) || 8317 };
	} catch {
		return { host: "127.0.0.1", port: 8317 };
	}
}

/** Resolves once the TCP connect either succeeds (true) or fails/times out (false). Never rejects. */
export function isPortOpen(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = new Socket();
		let settled = false;
		const finish = (result: boolean) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(PORT_PROBE_TIMEOUT_MS);
		socket.once("connect", () => finish(true));
		socket.once("timeout", () => finish(false));
		socket.once("error", () => finish(false));
		socket.connect(port, host);
	});
}

let launchAttempted = false;

/** Test-only: lets each test probe or retrigger autostart without import-order tricks. */
export function resetCliProxyAutostartForTesting(): void {
	launchAttempted = false;
}

/**
 * Starts the local CLIProxyAPI server detached, once per process, if it isn't already
 * listening on the configured port. No-ops silently when disabled, already running, or
 * the binary/config files aren't where CLIPROXYAPI_DIR (default ~/CLIProxyAPI) expects them,
 * so a workstation that never installed CLIProxyAPI sees no behavior change.
 */
export async function ensureCliProxyApiRunning(deps: AutostartDeps = {}): Promise<boolean> {
	if (launchAttempted) return false;
	launchAttempted = true;

	if (process.env.CLIPROXYAPI_AUTOSTART === "0") return false;

	const fileExists = deps.existsSync ?? existsSync;
	if (!fileExists(CLIPROXYAPI_BIN) || !fileExists(CLIPROXYAPI_CONFIG)) return false;

	const { host, port } = parseHostPort(resolveBaseUrl());
	const portOpen = deps.isPortOpen ?? isPortOpen;
	if (await portOpen(host, port)) return false;

	try {
		const spawnFn = deps.spawn ?? spawn;
		const child = spawnFn(CLIPROXYAPI_BIN, ["--config", CLIPROXYAPI_CONFIG], {
			cwd: CLIPROXYAPI_DIR,
			stdio: "ignore",
			detached: true,
			windowsHide: true,
		});
		child.on?.("error", () => {});
		child.unref?.();
		return true;
	} catch {
		return false;
	}
}
