import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { DEFAULT_SPOTIFY_PORT, type SpotifyToken, type TokenStore } from "./spotify-config.ts";
import type { OpenUrlResult } from "./spotify-browser.ts";

export const SPOTIFY_SCOPES = "user-read-playback-state user-read-currently-playing user-modify-playback-state";
export const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
export const TOKEN_URL = "https://accounts.spotify.com/api/token";
export const CALLBACK_HOST = "127.0.0.1";
export const DEFAULT_CALLBACK_TIMEOUT_MS = 180_000;

export type FetchLike = (url: string, init?: any) => Promise<Response>;

export function redirectUriFor(port: number = DEFAULT_SPOTIFY_PORT): string {
	return `http://${CALLBACK_HOST}:${port}/callback`;
}

export function createPkcePair(): { verifier: string; challenge: string } {
	const verifier = randomBytes(48).toString("base64url"); // 64 chars
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

export function buildAuthorizeUrl(opts: {
	clientId: string;
	redirectUri: string;
	state: string;
	challenge: string;
	scope?: string;
}): string {
	const url = new URL(AUTHORIZE_URL);
	url.searchParams.set("client_id", opts.clientId);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("redirect_uri", opts.redirectUri);
	url.searchParams.set("scope", opts.scope ?? SPOTIFY_SCOPES);
	url.searchParams.set("state", opts.state);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("code_challenge", opts.challenge);
	return url.toString();
}

const PAGE = (title: string, text: string) =>
	`<!doctype html><meta charset="utf-8"><title>${title}</title>` +
	`<body style="font-family:sans-serif;background:#121212;color:#fff;text-align:center;padding-top:20vh">` +
	`<h1>${title}</h1><p>${text}</p></body>`;

export interface CallbackOptions {
	port: number;
	state: string;
	timeoutMs?: number;
	/** Test hook: receives the actual bound port (useful with port 0). */
	onListening?: (port: number) => void;
	/** Test hook: custom server factory. */
	createServer?: typeof createServer;
}

/** Waits for the browser redirect on 127.0.0.1 and resolves with the authorization code. */
export function waitForAuthCallback(opts: CallbackOptions): Promise<string> {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS;
	return new Promise<string>((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const server: Server = (opts.createServer ?? createServer)((req, res) => {
			const url = new URL(req.url ?? "/", `http://${CALLBACK_HOST}`);
			if (url.pathname !== "/callback") {
				res.writeHead(404).end();
				return;
			}
			const send = (status: number, html: string) => {
				res.writeHead(status, { "content-type": "text/html; charset=utf-8", connection: "close" });
				res.end(html);
			};
			const error = url.searchParams.get("error");
			if (url.searchParams.get("state") !== opts.state) {
				send(400, PAGE("State mismatch", "This sign-in attempt does not match. Close this tab and retry."));
				finish(new Error("Spotify callback state mismatch"));
			} else if (error) {
				send(400, PAGE("Spotify not connected", `Spotify returned: ${escapeHtml(error)}. You can close this tab.`));
				finish(new Error(`Spotify authorization failed: ${error}`));
			} else {
				const code = url.searchParams.get("code");
				if (!code) {
					send(400, PAGE("Missing code", "No authorization code received."));
					finish(new Error("Spotify callback without code"));
				} else {
					send(200, PAGE("Spotify connected", "Spotify connected, you can close this tab."));
					finish(undefined, code);
				}
			}
		});

		function finish(err?: Error, code?: string) {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			server.close();
			(server as any).closeAllConnections?.();
			if (err) reject(err);
			else resolve(code as string);
		}

		server.on("error", (e: NodeJS.ErrnoException) => {
			finish(
				new Error(
					e.code === "EADDRINUSE"
						? `Port ${opts.port} is already in use; free it or change "port" in spotify.json`
						: `Callback server failed: ${e.message}`,
				),
			);
		});
		server.listen(opts.port, CALLBACK_HOST, () => {
			const addr = server.address();
			opts.onListening?.(typeof addr === "object" && addr ? addr.port : opts.port);
			timer = setTimeout(() => finish(new Error("Timed out waiting for the Spotify sign-in")), timeoutMs);
		});
	});
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export class SpotifyAuthError extends Error {
	readonly code: string;
	readonly status?: number;
	constructor(message: string, code: string, status?: number) {
		super(message);
		this.name = "SpotifyAuthError";
		this.code = code;
		this.status = status;
	}
}

async function postToken(body: URLSearchParams, fetchFn: FetchLike): Promise<any> {
	const res = await fetchFn(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});
	let parsed: any = {};
	try {
		parsed = JSON.parse(await res.text());
	} catch {
		// non-JSON body
	}
	if (!res.ok) {
		const code = typeof parsed?.error === "string" ? parsed.error : "http_error";
		throw new SpotifyAuthError(parsed?.error_description || `Spotify token endpoint returned ${res.status}`, code, res.status);
	}
	if (typeof parsed?.access_token !== "string") throw new SpotifyAuthError("Malformed token response", "bad_response", res.status);
	return parsed;
}

export async function exchangeCode(opts: {
	clientId: string;
	code: string;
	redirectUri: string;
	verifier: string;
	fetch?: FetchLike;
	now?: () => number;
}): Promise<SpotifyToken> {
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		client_id: opts.clientId,
		code: opts.code,
		redirect_uri: opts.redirectUri,
		code_verifier: opts.verifier,
	});
	const r = await postToken(body, opts.fetch ?? (fetch as FetchLike));
	const now = (opts.now ?? Date.now)();
	return {
		accessToken: r.access_token,
		refreshToken: String(r.refresh_token ?? ""),
		expiresAt: now + Number(r.expires_in ?? 3600) * 1000,
		scope: String(r.scope ?? ""),
	};
}

export async function refreshAccessToken(opts: {
	clientId: string;
	refreshToken: string;
	previousScope?: string;
	fetch?: FetchLike;
	now?: () => number;
}): Promise<SpotifyToken> {
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: opts.refreshToken,
		client_id: opts.clientId,
	});
	const r = await postToken(body, opts.fetch ?? (fetch as FetchLike));
	const now = (opts.now ?? Date.now)();
	return {
		accessToken: r.access_token,
		refreshToken: typeof r.refresh_token === "string" && r.refresh_token ? r.refresh_token : opts.refreshToken,
		expiresAt: now + Number(r.expires_in ?? 3600) * 1000,
		scope: String(r.scope ?? opts.previousScope ?? ""),
	};
}

export interface LoginDeps {
	clientId: string;
	port?: number;
	store: TokenStore;
	fetch?: FetchLike;
	now?: () => number;
	timeoutMs?: number;
	openUrl: (url: string) => OpenUrlResult;
	/** Called with the authorize URL before opening, so the caller can print it as a fallback. */
	onUrl?: (url: string) => void;
	waitForCallback?: (opts: { port: number; state: string; timeoutMs?: number }) => Promise<string>;
}

export async function loginFlow(deps: LoginDeps): Promise<SpotifyToken> {
	const port = deps.port ?? DEFAULT_SPOTIFY_PORT;
	const redirectUri = redirectUriFor(port);
	const { verifier, challenge } = createPkcePair();
	const state = randomBytes(16).toString("base64url");
	const url = buildAuthorizeUrl({ clientId: deps.clientId, redirectUri, state, challenge });
	const wait = deps.waitForCallback ?? waitForAuthCallback;
	// Start listening first so the redirect can never beat the server.
	const codeP = wait({ port, state, timeoutMs: deps.timeoutMs });
	codeP.catch(() => {});
	deps.onUrl?.(url);
	deps.openUrl(url);
	const code = await codeP;
	const token = await exchangeCode({ clientId: deps.clientId, code, redirectUri, verifier, fetch: deps.fetch, now: deps.now });
	deps.store.save(token);
	return token;
}
