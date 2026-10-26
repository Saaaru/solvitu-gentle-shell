import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveAgentDir } from "../models/models-client.ts";

/**
 * Locations for the Spotify files. The agent dir mirrors Pi's getAgentDir()
 * (resolveAgentDir reads the same PI_CODING_AGENT_DIR variable and default).
 */
export interface SpotifyPaths {
	dir: string;
	config: string;
	token: string;
}

export function spotifyPaths(agentDir: string = resolveAgentDir()): SpotifyPaths {
	const dir = join(agentDir, "solvi");
	return { dir, config: join(dir, "spotify.json"), token: join(dir, "spotify-token.json") };
}

export interface SpotifyConfig {
	clientId?: string;
	port?: number;
}

export const DEFAULT_SPOTIFY_PORT = 8888;

export function readSpotifyConfig(
	paths: SpotifyPaths = spotifyPaths(),
	env: Record<string, string | undefined> = process.env,
): SpotifyConfig {
	const out: SpotifyConfig = {};
	try {
		if (existsSync(paths.config)) {
			const raw = JSON.parse(readFileSync(paths.config, "utf8"));
			if (typeof raw?.clientId === "string" && raw.clientId.trim()) out.clientId = raw.clientId.trim();
			if (Number.isInteger(raw?.port) && raw.port > 0 && raw.port < 65536) out.port = raw.port;
		}
	} catch {
		// unreadable config behaves like no config
	}
	if (!out.clientId) {
		const fromEnv = (env.SPOTIFY_CLIENT_ID || "").trim();
		if (fromEnv) out.clientId = fromEnv;
	}
	return out;
}

export function writeSpotifyConfig(config: SpotifyConfig, paths: SpotifyPaths = spotifyPaths()): void {
	writeFileAtomic(paths.config, JSON.stringify(config, null, 2) + "\n");
}

export interface SpotifyToken {
	accessToken: string;
	refreshToken: string;
	/** Epoch ms when the access token stops being valid. */
	expiresAt: number;
	scope: string;
}

export interface TokenStore {
	load(): SpotifyToken | null;
	save(token: SpotifyToken): void;
	clear(): void;
}

function isToken(v: any): v is SpotifyToken {
	return (
		v &&
		typeof v.accessToken === "string" &&
		typeof v.refreshToken === "string" &&
		typeof v.expiresAt === "number" &&
		typeof v.scope === "string"
	);
}

/** Writes through a temp file in the same dir (mode 0600) and renames it over the target. */
function writeFileAtomic(file: string, data: string): void {
	const dir = dirname(file);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(tmp, data, { mode: 0o600 });
		try {
			chmodSync(tmp, 0o600);
		} catch {
			// not supported on every platform
		}
		renameSync(tmp, file);
	} catch (err) {
		rmSync(tmp, { force: true });
		throw err;
	}
}

export function fileTokenStore(file: string = spotifyPaths().token): TokenStore {
	return {
		load() {
			try {
				const parsed = JSON.parse(readFileSync(file, "utf8"));
				return isToken(parsed) ? parsed : null;
			} catch {
				return null;
			}
		},
		save(token) {
			writeFileAtomic(file, JSON.stringify(token));
		},
		clear() {
			rmSync(file, { force: true });
		},
	};
}

export function memoryTokenStore(initial?: SpotifyToken): TokenStore {
	let current: SpotifyToken | null = initial ? { ...initial } : null;
	return {
		load: () => (current ? { ...current } : null),
		save: (t) => {
			current = { ...t };
		},
		clear: () => {
			current = null;
		},
	};
}
