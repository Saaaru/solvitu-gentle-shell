import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { footerRegistry } from "./footer/footer-registry.ts";

// Extension statuses (permissions, profile, ...) drawn on the line below the input instead of the sidebar.
class WorkspaceStatuses implements Component {
	private readonly theme: any;

	constructor(theme: any) {
		this.theme = theme;
	}

	render(width: number): string[] {
		const statuses = footerRegistry.latestFooterData?.getExtensionStatuses?.();
		if (!statuses) return [];
		const lines: string[] = [];
		for (const text of statuses.values()) {
			if (!text || text.trim().length === 0) continue;
			lines.push(truncateToWidth(this.theme.fg("muted", text.trim()), Math.max(0, width)));
		}
		return lines;
	}

	invalidate(): void {}
}

export function installWorkspaceStatuses(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setWidget("workspace-statuses", (_tui: any, theme: any) => new WorkspaceStatuses(theme) as any, { placement: "belowEditor" });
}
