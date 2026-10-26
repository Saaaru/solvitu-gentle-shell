import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { footerRegistry } from "./footer/footer-registry.ts";

// Top of the transcript: path on the left, git branch on the right. The model, token
// counts, context window and plan limits live on the row below the input instead
// (src/statuses.ts), on the same line as the extension statuses such as Permissions.
export class WorkspaceHeader implements Component {
	private readonly ctx: ExtensionContext;
	private readonly theme: any;
	private readonly tui?: TUI;

	constructor(ctx: ExtensionContext, theme: any, tui?: TUI) {
		this.ctx = ctx;
		this.theme = theme;
		this.tui = tui;
	}

	render(width: number): string[] {
		const cwd = (this.ctx.cwd ?? process.cwd()).replace(homedir(), "~");
		const branch = footerRegistry.latestFooterData?.getGitBranch() || "no-git";
		const left = this.theme.fg("text", cwd);
		const right = this.theme.fg("muted", `⎇ ${branch}`);
		const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
		return [truncateToWidth(`${left}${" ".repeat(gap)}${right}`, Math.max(0, width))];
	}

	invalidate(): void {}
}

export function installWorkspaceHeader(ctx: ExtensionContext): void {
	if (!ctx.hasUI || ctx.mode !== "tui") return;
	ctx.ui.setHeader((tui: any, theme: any) => new WorkspaceHeader(ctx, theme, tui));
}
