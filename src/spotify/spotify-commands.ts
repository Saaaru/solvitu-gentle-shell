import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loginFlow, redirectUriFor, type FetchLike } from "./spotify-auth.ts";
import { openUrl as defaultOpenUrl, type OpenUrlResult } from "./spotify-browser.ts";
import { SpotifyClient, type PlaybackState, type SpotifyError, type SpotifyResult } from "./spotify-client.ts";
import {
	DEFAULT_SPOTIFY_PORT,
	fileTokenStore,
	readSpotifyConfig,
	spotifyPaths,
	writeSpotifyConfig,
	type SpotifyPaths,
} from "./spotify-config.ts";

export interface SpotifyCommandDeps {
	paths?: SpotifyPaths;
	fetch?: FetchLike;
	now?: () => number;
	env?: Record<string, string | undefined>;
	openUrl?: (url: string) => OpenUrlResult;
	loginTimeoutMs?: number;
}

const SUBCOMMANDS: { value: string; description: string }[] = [
	{ value: "client", description: "Guardar el Client ID de Spotify" },
	{ value: "login", description: "Conectar tu cuenta de Spotify" },
	{ value: "logout", description: "Desconectar y borrar el token" },
	{ value: "status", description: "Ver conexion y reproduccion actual" },
	{ value: "play", description: "Reanudar la reproduccion" },
	{ value: "pause", description: "Pausar" },
	{ value: "next", description: "Siguiente pista" },
	{ value: "prev", description: "Pista anterior" },
];

const USAGE = "Uso: /spotify client <id> | login | logout | status | play | pause | next | prev";

export function setupSteps(port: number = DEFAULT_SPOTIFY_PORT): string {
	return [
		"Falta el Client ID de Spotify. Pasos:",
		"1. Crea una app en https://developer.spotify.com/dashboard",
		`2. Agrega el Redirect URI ${redirectUriFor(port)}`,
		'3. Activa "Web API" en la app',
		"4. Ejecuta /spotify client <id> con el Client ID de la app",
	].join("\n");
}

export function describeSpotifyError(error: SpotifyError): { message: string; type: "warning" | "error" } {
	switch (error.kind) {
		case "no-client-id":
			return { message: "Falta el Client ID. Ejecuta /spotify client <id>", type: "warning" };
		case "not-connected":
			return { message: "Spotify no conectado. Ejecuta /spotify login", type: "warning" };
		case "premium-required":
			return { message: "Spotify Premium requerido para controlar la reproducción", type: "warning" };
		case "no-device":
			return { message: "No hay un dispositivo de Spotify activo. Abre Spotify y reproduce algo", type: "warning" };
		case "rate-limited":
			return { message: `Spotify limitó las peticiones. Reintenta en ${Math.ceil(error.retryAfterMs / 1000)} s`, type: "warning" };
		case "unauthorized":
			return { message: "Spotify rechazó la sesión. Ejecuta /spotify login", type: "warning" };
		case "network":
			return { message: "No se pudo contactar a Spotify (red)", type: "error" };
		case "http":
			return { message: `Spotify respondió con error ${error.status}`, type: "error" };
	}
}

// ---- shared client ----

let shared: { client: SpotifyClient; key: string } | null = null;

function buildClient(deps: SpotifyCommandDeps): SpotifyClient {
	const paths = deps.paths ?? spotifyPaths();
	const { clientId } = readSpotifyConfig(paths, deps.env);
	return new SpotifyClient({ store: fileTokenStore(paths.token), clientId, fetch: deps.fetch, now: deps.now });
}

/** Lazily created client shared by the commands and the Solvi tab. Recreated when the client id changes. */
export function getSpotifyClient(): SpotifyClient {
	const paths = spotifyPaths();
	const key = `${paths.dir}|${readSpotifyConfig(paths).clientId ?? ""}`;
	if (!shared || shared.key !== key) shared = { client: buildClient({ paths }), key };
	return shared.client;
}

/** Drops the shared client so the next getSpotifyClient() picks up new config. */
export function resetSpotifyClient(): void {
	shared = null;
}

// ---- command ----

function say(ctx: ExtensionCommandContext, message: string, type: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
}

function formatStatus(state: PlaybackState | null): string {
	if (!state) return "Sin reproducción activa";
	const lines: string[] = [];
	if (state.device) lines.push(`Dispositivo: ${state.device.name} (${state.device.type})`);
	if (state.itemType === "ad") lines.push("Anuncio en curso");
	else if (state.track) {
		const by = state.track.artists.length ? ` - ${state.track.artists.join(", ")}` : "";
		lines.push(`${state.isPlaying ? "Reproduciendo" : "En pausa"}: ${state.track.name}${by}`);
	}
	return lines.join("\n") || "Sin reproducción activa";
}

export function registerSpotifyCommands(pi: ExtensionAPI, deps: SpotifyCommandDeps = {}): void {
	const injected = Object.keys(deps).length > 0;
	let local: SpotifyClient | null = null;
	const paths = () => deps.paths ?? spotifyPaths();
	const client = (): SpotifyClient => {
		if (!injected) return getSpotifyClient();
		return (local ??= buildClient(deps));
	};
	const reset = () => {
		local = null;
		resetSpotifyClient();
	};

	const control = async (ctx: ExtensionCommandContext, run: (c: SpotifyClient) => Promise<SpotifyResult<void>>, done: string) => {
		const r = await run(client());
		if (r.ok) say(ctx, done);
		else {
			const d = describeSpotifyError(r.error);
			say(ctx, d.message, d.type);
		}
	};

	pi.registerCommand("spotify", {
		description: "Spotify: client <id> | login | logout | status | play | pause | next | prev",
		getArgumentCompletions: (prefix: string) => {
			const first = prefix.trimStart();
			if (/\s/.test(first)) return null;
			const items = SUBCOMMANDS.filter((s) => s.value.startsWith(first)).map((s) => ({
				value: s.value,
				label: s.value,
				description: s.description,
			}));
			return items.length ? items : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const [sub = "", ...rest] = args.trim().split(/\s+/);
			switch (sub) {
				case "client": {
					const id = rest.join(" ").trim();
					if (!id) return say(ctx, "Uso: /spotify client <id>", "warning");
					const current = readSpotifyConfig(paths(), {});
					writeSpotifyConfig({ ...current, clientId: id }, paths());
					reset();
					return say(ctx, "Client ID guardado. Ahora ejecuta /spotify login");
				}
				case "login": {
					const cfg = readSpotifyConfig(paths(), deps.env);
					if (!cfg.clientId) return say(ctx, setupSteps(cfg.port), "warning");
					const open = deps.openUrl ?? defaultOpenUrl;
					say(ctx, "Abriendo el navegador para conectar Spotify...");
					try {
						await loginFlow({
							clientId: cfg.clientId,
							port: cfg.port,
							store: fileTokenStore(paths().token),
							fetch: deps.fetch,
							now: deps.now,
							timeoutMs: deps.loginTimeoutMs,
							openUrl: (url) => {
								const res = open(url);
								if (!res.ok) say(ctx, `No se pudo abrir el navegador. Abre este enlace:\n${url}`, "warning");
								return res;
							},
						});
						reset();
						return say(ctx, "Spotify conectado");
					} catch (err) {
						return say(ctx, `No se pudo conectar Spotify: ${err instanceof Error ? err.message : String(err)}`, "error");
					}
				}
				case "logout":
					fileTokenStore(paths().token).clear();
					reset();
					return say(ctx, "Spotify desconectado");
				case "status": {
					const c = client();
					if (!c.clientId) return say(ctx, describeSpotifyError({ kind: "no-client-id" }).message, "warning");
					if (!c.isConnected()) return say(ctx, "Spotify no conectado. Ejecuta /spotify login", "warning");
					const r = await c.getPlayback();
					if (!r.ok) {
						const d = describeSpotifyError(r.error);
						return say(ctx, d.message, d.type);
					}
					return say(ctx, `Conectado\n${formatStatus(r.value)}`);
				}
				case "play":
					return control(ctx, (c) => c.play(), "Reproduciendo");
				case "pause":
					return control(ctx, (c) => c.pause(), "En pausa");
				case "next":
					return control(ctx, (c) => c.next(), "Siguiente pista");
				case "prev":
					return control(ctx, (c) => c.previous(), "Pista anterior");
				default:
					return say(ctx, USAGE, "warning");
			}
		},
	});
}
