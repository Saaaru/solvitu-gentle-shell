import { spawn } from "node:child_process";

export interface OpenUrlResult {
	ok: boolean;
	/** Always returned so the caller can print it when opening fails. */
	url: string;
	error?: string;
}

export interface OpenUrlDeps {
	platform?: NodeJS.Platform;
	spawn?: typeof spawn;
}

/** Builds the launcher command without any shell string. */
export function openCommand(url: string, platform: NodeJS.Platform): { cmd: string; args: string[] } {
	// Windows: rundll32 receives the URL as one argv element and never goes through cmd.exe,
	// so "&" (and "%", "^") in the query string need no escaping. `cmd /c start` would need
	// "^&" escaping and still mangles "%VAR%" expansions.
	if (platform === "win32") return { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
	if (platform === "darwin") return { cmd: "open", args: [url] };
	return { cmd: "xdg-open", args: [url] };
}

export function openUrl(url: string, deps: OpenUrlDeps = {}): OpenUrlResult {
	if (!/^https?:\/\//i.test(url)) return { ok: false, url, error: "only http(s) URLs can be opened" };
	const { cmd, args } = openCommand(url, deps.platform ?? process.platform);
	try {
		const child = (deps.spawn ?? spawn)(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
		child.on?.("error", () => {});
		child.unref?.();
		return { ok: true, url };
	} catch (err) {
		return { ok: false, url, error: err instanceof Error ? err.message : String(err) };
	}
}
