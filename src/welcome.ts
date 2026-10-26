import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { safeFg, bolden, installWelcomeHeaderGuard } from "./solvi-theme.ts";
import { installWorkspaceHeader } from "./header.ts";

// Static (non-animated) bee, matching the one patched into gentle-pi's startup banner.
const BEE_ART = [
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣤⣤⣤⣀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⡾⠋⠁⠀⠀⠀⠉⠻⣦",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⡠⠤⢴⡯⣀⡀⠀⠀⠀⠀⠀⠀⠈⣷",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡠⠊⠀⠀⠀⣿⠀⠀⠈⠢⡀⠀⠀⠀⠀⠀⢸⡇",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡜⠀⠀⠀⠀⠀⢿⡀⠀⠀⠀⠘⡄⠀⠀⠀⠀⣸⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣤⠞⠂",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀⠀⠀⠘⢧⡀⠀⠀⠀⡇⠀⠀⠀⣠⠟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡼⠋",
	"⠀⠤⠤⠤⠤⠤⠄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠑⠀⠀⠀⠀⠀⠀⠈⠻⢦⠀⠐⢁⣀⣤⠾⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡼⠁",
	"⠀⠀⠀⣀⣀⣀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣤⠶⢾⣿⣿⠛⠛⢻⣶⣦⣤⡀⠈⠉⠀⢀⣠⣤⣤⣀⠀⠀⠀⣀⣤⣤⣄⡼⠁",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⠈⠙⢷⣄⣴⣿⣿⣿⣿⣿⣷⣤⣾⣿⣿⠟⣛⢿⣦",
	"⠀⠉⠉⠉⠉⠉⠁⠀⠀⠀⠀⠀⢠⣿⣿⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣇⠘⠿⢃⣿⡇",
	"⠀⠀⠀⠒⠒⠒⠒⠂⠀⣀⣠⣴⣿⣿⣿⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣶⣿⣿⠇",
	"⠀⠤⠤⠤⠤⠤⠄⠀⠉⠉⠙⠛⢿⣿⣿⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⠻⣿⣿⣿⣿⡿⠋",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢿⣿⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⣿⠀⠀⢸⣿⠟⣿⣿⣿⣿⣿⠿⣇⠀⠀⠉⠉⠁",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠿⣿⣀⠀⢸⣿⣿⠀⠀⢸⣿⣿⣠⡴⠟⠁⣼⠃⠈⠉⣿⠀⠀⠹⣆",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠛⠻⠿⠿⠶⠶⠾⠛⠋⠉⠀⠀⣰⠏⠀⠀⠀⣿⠀⠀⠀⠹⣆",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⡾⠋⠀⠀⠀⣠⡿⠀⠀⠀⢠⡟",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠀⠀⠀⠀⠺⠋⠀⠀⠀⠀⠾⠁",
];

// Mirrors gentle-pi's own PI_SUBCOMMANDS (lib/gentle-shell-launcher.ts): `pi update`,
// `pi install`, etc. dispatch purely on argv[2] and skip the animated intro entirely.
const PI_SUBCOMMANDS = ["install", "remove", "uninstall", "update", "list", "config", "auth", "mcp"];

function isPiCliSubcommandInvocation(): boolean {
	const first = process.argv[2];
	return first !== undefined && PI_SUBCOMMANDS.includes(first);
}

function shouldShowWelcome(): boolean {
	if (process.env.GENTLE_PI_AGENTS_CHILD === "1") return false;
	if (isPiCliSubcommandInvocation()) return false;
	const rows = process.stdout.rows ?? 0;
	const cols = process.stdout.columns ?? 0;
	return rows >= 20 && cols >= 40;
}

class WelcomeBanner implements Component {
	private readonly theme: Theme;

	constructor(theme: Theme) {
		this.theme = theme;
	}

	render(width: number): string[] {
		const pink = (s: string): string => safeFg(this.theme, "pinkBright", s, "accent");
		const muted = (s: string): string => safeFg(this.theme, "muted", s);
		const center = (s: string): string => {
			const pad = Math.max(0, Math.floor((width - visibleWidth(s)) / 2));
			return truncateToWidth(`${" ".repeat(pad)}${s}`, width);
		};

		const lines: string[] = [""];
		for (const row of BEE_ART) lines.push(center(pink(row)));
		lines.push("");
		lines.push(center(bolden(this.theme, pink("Solvitu")) + muted(" · Gentle-Shell")));
		lines.push(center(muted("escribe algo para empezar")));
		lines.push("");
		return lines;
	}

	invalidate(): void {}
}

/**
 * Shows a static bee in the header slot until the user sends their first message, then
 * hands that slot to the real WorkspaceHeader (src/header.ts). Reuses
 * installWelcomeHeaderGuard (src/theme/theme-header-guard.ts) to protect the welcome
 * header while it's active: gentle-pi's own startup banner also wants the header slot
 * and installs itself ~50ms into session_start, which used to win the race and flash
 * over whatever we'd set. The guard makes that call a no-op while our welcome is up.
 */
export function installWelcomeBanner(pi: ExtensionAPI): void {
	let active = false;

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (!ctx.hasUI || ctx.mode !== "tui" || !shouldShowWelcome()) {
			installWorkspaceHeader(ctx);
			return;
		}
		active = true;
		installWelcomeHeaderGuard(ctx, () => active);
		const factory = (_tui: any, theme: Theme) => new WelcomeBanner(theme);
		(factory as any).__isSolviWelcome = true;
		ctx.ui.setHeader(factory);
	});

	// First turn the user actually starts: hand the header slot over to the real one.
	pi.on("turn_start", async (_event, ctx: ExtensionContext) => {
		if (!active) return;
		active = false;
		if (ctx.hasUI) installWorkspaceHeader(ctx);
	});
}
