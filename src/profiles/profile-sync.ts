import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Bundled profiles shipped with the extension (<repo>/profiles). */
export function bundledProfilesDir(): string {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "profiles");
}

/** Global Pi profiles dir (<agentDir>/profiles). */
export function globalProfilesDir(): string {
	const agentDir = process.env.PI_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
	return path.join(agentDir, "profiles");
}

/**
 * Copies bundled *.json profiles into the global profiles dir ONLY when no file
 * with that name exists there. Never overwrites, never throws.
 */
export function syncBundledProfiles(srcDir: string = bundledProfilesDir(), destDir: string = globalProfilesDir()): void {
	try {
		const entries = fs.readdirSync(srcDir).filter((f) => f.endsWith(".json"));
		for (const file of entries) {
			try {
				const target = path.join(destDir, file);
				if (fs.existsSync(target)) continue;
				const content = fs.readFileSync(path.join(srcDir, file), "utf8");
				JSON.parse(content);
				fs.mkdirSync(destDir, { recursive: true });
				fs.writeFileSync(target, content, { flag: "wx" });
			} catch {}
		}
	} catch {}
}
