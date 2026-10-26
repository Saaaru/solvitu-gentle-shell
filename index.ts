import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installWorkspaceFooter, invalidateSidebarGitAndTree, getLatestTodoMirror } from "./src/footer.js";
import { sidebarState } from "./src/sidebar.js";
import { cycleSidebarTab, resolveSidebarTab } from "./src/sidebar-tabs.ts";
import { footerRegistry } from "./src/footer/footer-registry.ts";
import { moveSelection, openSelected } from "./src/main-view.ts";
import { syncProjectCloud, detectProjectName } from "./src/solvi-engram.ts";
import { SolviContextMonitor } from "./src/solvi-context-monitor.ts";
import { installWelcomeBanner } from "./src/welcome.ts";
import { installWorkspaceStatuses } from "./src/statuses.ts";
import { COMPACT_TOOLS, compactToolRenderer } from "./src/tool-lines.ts";
import { setCapabilityOverrides } from "@earendil-works/pi-tui";

export default function workspaceSidebarExtension(pi: ExtensionAPI): void {
	// Forzar soporte de Kitty graphics en entornos Ghostty / Kitty
	try {
		setCapabilityOverrides({ images: "kitty" });
	} catch {}

	// 0. Disable float background leaks from foreign gentle-shell cards
	try {
		(globalThis as any)[Symbol.for("gentle-pi.card-style")] = "neon";
	} catch {}

	// 0. Context Threshold Notifications Monitor
	const contextMonitor = new SolviContextMonitor();

	// Compact tool lines: read, write, edit, bash, grep, find and ls draw as "name > target" without a card.
	// Resolvers run in load order; this package loads after gentle-pi, so its resolver sees the call first.
	const host = pi as typeof pi & { registerToolRenderer?: (resolver: (toolName: string, next: () => unknown) => unknown) => void };
	if (typeof host.registerToolRenderer === "function") {
		host.registerToolRenderer((toolName, next) => (COMPACT_TOOLS.has(toolName) ? compactToolRenderer(toolName) : next()));
	}

	// Alt+Left / Alt+Right move between sidebar tabs
	const cycleTab = (delta: number) => {
		const tui = footerRegistry.latestTodoTui;
		if (tui?.terminal) cycleSidebarTab(tui, delta);
	};
	pi.registerShortcut("alt+left", { description: "Previous sidebar tab", handler: () => cycleTab(-1) });
	pi.registerShortcut("alt+right", { description: "Next sidebar tab", handler: () => cycleTab(1) });
	// SKILLS tab: Alt+M / Alt+N select a skill or MCP server, Alt+O reads it in the viewer below
	pi.registerShortcut("alt+m", { description: "Previous skill or MCP item", handler: () => footerRegistry.mainView && moveSelection(footerRegistry.mainView, -1) });
	pi.registerShortcut("alt+n", { description: "Next skill or MCP item", handler: () => footerRegistry.mainView && moveSelection(footerRegistry.mainView, 1) });
	pi.registerShortcut("alt+o", { description: "Open the selected skill or MCP item", handler: () => footerRegistry.mainView && openSelected(footerRegistry.mainView) });

	// Alt+I / Alt+J scroll or move selection in whatever the active tab shows. Plain arrow
	// keys stay with the chat input/history. Neither Alt+Up/Alt+Down (reserved by pi for
	// app.models.reorderUp/Down) nor Alt+K (reserved by gentle-pi's command palette,
	// gentle:commands) are available: the loader flags either as a startup
	// "Extension shortcut conflict", and Alt+K silently loses to gentle-pi's own binding.
	const scrollActiveTab = (delta: number) => {
		const tui = footerRegistry.latestTodoTui;
		if (!tui?.terminal) return;
		const tab = resolveSidebarTab(sidebarState(tui).activeTabId);
		if (tab.id === "skills") {
			if (footerRegistry.mainView) moveSelection(footerRegistry.mainView, delta);
			return;
		}
		const card =
			tab.id === "tree"
				? footerRegistry.latestProjectTree
				: tab.id === "git"
					? (footerRegistry.latestGitGraph ?? footerRegistry.latestWorkingTree)
					: tab.id === "prof"
						? footerRegistry.latestProfilesCard
						: tab.id === "mem"
							? (footerRegistry.latestEngramCard ?? footerRegistry.latestToolsCard ?? footerRegistry.latestPersistentMemory)
							: undefined;
		if (card && typeof (card as any).handleRailWheel === "function") {
			(card as any).handleRailWheel(delta);
			tui.requestRender();
		}
	};
	pi.registerShortcut("alt+i", { description: "Scroll active tab up", handler: () => scrollActiveTab(-1) });
	pi.registerShortcut("alt+j", { description: "Scroll active tab down", handler: () => scrollActiveTab(1) });

	// Shows the bee until the first message, then hands the header slot to installWorkspaceHeader.
	installWelcomeBanner(pi);

	// 1. Hook into session_start to install the sidebar footer and todo mirror
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		// Intercept ctx.ui.setWidget so the todo widget always renders in the sidebar rail slot.
		if (ctx.ui && typeof ctx.ui.setWidget === "function" && !(ctx.ui as any).__solviSetWidgetWrapped) {
			(ctx.ui as any).__solviSetWidgetWrapped = true;
			const origSetWidget = ctx.ui.setWidget.bind(ctx.ui);
			ctx.ui.setWidget = (key: string, content: any, options?: any) => {
				if (key === "gentle-todo" && typeof content === "function") {
					const origFactory = content;
					content = (tui: any, theme: any) => {
						const comp = origFactory(tui, theme);
						const mirror = (tui as any)?.__solviTodoMirror ?? (ctx as any)?.__solviTodoMirror ?? getLatestTodoMirror();
						const sidebarRail = (tui as any)?.__solviTodoRail;

						if (sidebarRail && tui?.terminal) {
							sidebarState(tui).parts.set("todo", sidebarRail);
						}

						// Bottom widget fallback when the sidebar is not active
						if (mirror) {
							return {
								render(width: number) {
									if (tui?.terminal) {
										const state = sidebarState(tui);
										if (state.active && state.ownsHost?.()) return [];
									}
									const raw = comp?.render?.(width);
									if (!raw || raw.length === 0) return [];
									return mirror.renderBottom(width);
								},
								handleMouse(event: any) {
									return mirror.handleMouse(event);
								},
								invalidate() {
									mirror.invalidate();
								},
								dispose() {
									comp?.dispose?.();
								},
							};
						}
						return comp;
					};
				}
				return origSetWidget(key, content, options);
			};
		}

		// Extension statuses (permissions, profile) below the input
		installWorkspaceStatuses(ctx);

		// Install the sidebar footer (status, context, usage, todo parts)
		installWorkspaceFooter(ctx, pi);

		// Initialize context threshold monitoring for active session
		contextMonitor.reset();
		contextMonitor.check(ctx);
	});

	// 2. Memory tools: sync to Engram Cloud ONLY when memories are saved/mutated
	const MEMORY_MUTATION_TOOLS = new Set([
		"mem_save",
		"mem_update",
		"mem_delete",
		"mem_session_summary",
		"mem_session_end",
		"mem_capture_passive",
	]);
	const FILE_OR_GIT_TOOLS = new Set(["write", "edit", "bash"]);
	pi.on("tool_execution_end", (event, ctx) => {
		if (event && !event.isError) {
			if (MEMORY_MUTATION_TOOLS.has(event.toolName)) {
				const project = detectProjectName(ctx?.cwd);
				// Fire non-blocking cloud replication
				syncProjectCloud(project).catch(() => {});
			}
			if (FILE_OR_GIT_TOOLS.has(event.toolName)) {
				invalidateSidebarGitAndTree();
			}
		}
	});

	// 3. Monitor context threshold transitions on turn completion
	pi.on("turn_end", async (_event, ctx) => {
		invalidateSidebarGitAndTree();
		if (ctx?.hasUI) {
			contextMonitor.check(ctx);
		}
	});

	// 4. Reset / re-evaluate monitor on compaction
	pi.on("session_compact", async (_event, ctx) => {
		if (ctx?.hasUI) {
			contextMonitor.reset();
			contextMonitor.check(ctx);
		}
	});

	pi.on("session_shutdown", () => {
		contextMonitor.stop();
	});
}
import { registerTreeKeys } from "./src/tree/tree-keys.ts";
	// FLDR tab: Alt+W/X cursor, Alt+. / Alt+, expand/collapse, Alt+PageUp/PageDown scroll the viewer
	registerTreeKeys(pi);
