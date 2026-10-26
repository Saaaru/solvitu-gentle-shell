import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { installSidebar, sidebarPart } from "./sidebar.ts";
import { createMainState, MainListCard, MainViewerCard } from "./main-view.ts";
import { WorkspaceTodoMirror } from "./todos.ts";
import { WorkspaceGitGraphCard, WorkspaceWorkingTreeCard } from "./solvi-git-graph.ts";
import { WorkspaceToolsCard } from "./solvi-tools.ts";
import { WorkspaceEcosystemCard } from "./ecosystem/ecosystem-card.ts";
import { WorkspaceEngramCard, WorkspaceEngramHandoffCard } from "./solvi-engram.ts";
import { WorkspacePersistentMemoryCard } from "./solvi-persistent-memory.ts";
import { tuneTuiScroll } from "./solvi-layout.ts";
import { formatTokenCount, getContextThreshold } from "./solvi-metrics.ts";
import { WorkspaceProfilesExtendedCard } from "./solvi-profiles.ts";
import { WorkspaceProjectTreeCard } from "./solvi-tree.ts";
import { WorkspaceSolviTabCard } from "./solvi-tab.ts";
import { sidebarState } from "./sidebar-state.ts";

import {
	separator,
	gaugeGlyphs,
	prettifyExtraStatus,
	shortModelName,
	sessionCost,
	formatCost,
	renderGauge,
} from "./footer/footer-formatters.ts";

import {
	footerRegistry,
	getLatestTodoMirror,
	invalidateSidebarGitAndTree,
} from "./footer/footer-registry.ts";

import { WorkspaceFooter } from "./footer/footer-component.ts";
import { WorkspaceContextCard } from "./footer/footer-context-card.ts";

export {
	formatTokenCount,
	getContextThreshold,
	separator,
	gaugeGlyphs,
	prettifyExtraStatus,
	shortModelName,
	sessionCost,
	formatCost,
	renderGauge,
	getLatestTodoMirror,
	invalidateSidebarGitAndTree,
	WorkspaceFooter,
	WorkspaceContextCard,
};

export function installWorkspaceFooter(ctx: ExtensionContext, pi: ExtensionAPI): void {
	if (!ctx.hasUI) return;
	if (!footerRegistry.todoHooksInstalled) {
		footerRegistry.todoHooksInstalled = true;
		const refreshTodos = () => {
			try {
				footerRegistry.latestGitGraph?.invalidate();
				footerRegistry.latestWorkingTree?.invalidate();
				footerRegistry.latestToolsCard?.invalidate();
				footerRegistry.latestEngramCard?.invalidate();
				footerRegistry.latestEngramHandoff?.invalidate();
				footerRegistry.latestMemoryGraph?.invalidate();
				footerRegistry.latestTodoMirror?.invalidate();
				if (footerRegistry.latestTodoTui && (footerRegistry.latestTodoTui as any).__solviTodoRail) {
					const state = sidebarState(footerRegistry.latestTodoTui);
					state.parts.set("todo", (footerRegistry.latestTodoTui as any).__solviTodoRail);
				}
				footerRegistry.latestTodoTui?.requestRender();
			} catch {}
		};
		pi.on("session_start", refreshTodos);
		pi.on("turn_end", refreshTodos);
		pi.on("tool_execution_end", refreshTodos);
		pi.on("entry_appended", refreshTodos);
		pi.on("message_end", refreshTodos);
	}

	ctx.ui.setFooter((tui, theme, footerData) => {
		tuneTuiScroll(tui);
		(tui as any).__solviPi = pi;
		const bottom = new WorkspaceFooter(pi, ctx, tui, theme, footerData);
		const contextCard = new WorkspaceContextCard(ctx, theme);
		const engramCard = new WorkspaceEngramCard(ctx, tui, theme);
		const engramHandoff = new WorkspaceEngramHandoffCard(ctx, tui, theme);
		const persistentMemory = new WorkspacePersistentMemoryCard(ctx, tui, theme, undefined, pi);
		const memoryGraph = persistentMemory;
		const gitGraph = new WorkspaceGitGraphCard(ctx, tui, theme);
		const workingTree = new WorkspaceWorkingTreeCard(ctx, tui, theme);
		const toolsCard = new WorkspaceToolsCard(ctx, tui, theme);
		const ecosystemCard = new WorkspaceEcosystemCard(ctx, tui, theme);
		const todos = new WorkspaceTodoMirror(ctx, tui, theme);

		footerRegistry.latestTodoTui = tui;
		footerRegistry.latestFooterData = footerData as any;
		const mainView = createMainState(pi);
		mainView.requestRender = () => tui.requestRender();
		footerRegistry.mainView = mainView;
		sidebarState(tui).parts.set("main-list", new MainListCard(mainView, theme));
		sidebarState(tui).parts.set("main-viewer", new MainViewerCard(mainView, theme));
		footerRegistry.latestTodoMirror = todos;
		(tui as any).__solviTodoMirror = todos;
		(ctx as any).__solviTodoMirror = todos;
		(tui as any).__solviCtx = ctx;
		footerRegistry.latestGitGraph = gitGraph;
		footerRegistry.latestWorkingTree = workingTree;
		footerRegistry.latestToolsCard = toolsCard;
		footerRegistry.latestEngramCard = engramCard;
		footerRegistry.latestEngramHandoff = engramHandoff;
		footerRegistry.latestPersistentMemory = persistentMemory;
		footerRegistry.latestMemoryGraph = memoryGraph;

		const rail = {
			render: (width: number) => bottom.renderSidebarCard(width),
			invalidate: () => bottom.invalidate(),
			handleRailClick: (lineIndex: number) => bottom.handleCardClick(lineIndex),
			isProfileDropdownOpen: () => bottom.isProfileDropdownOpen(),
			closeProfileDropdown: () => bottom.closeProfileDropdown(),
		};
		const contextRail = {
			render: (width: number) => contextCard.render(width),
			invalidate: () => contextCard.invalidate(),
		};
		const engramRail = {
			render: (width: number) => engramCard.render(width),
			invalidate: () => engramCard.invalidate(),
			handleRailClick: (lineIndex: number) => engramCard.handleClick(lineIndex),
		};
		const gitGraphRail = {
			render: (width: number, availableHeight?: number) => gitGraph.render(width, availableHeight),
			invalidate: () => gitGraph.invalidate(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				typeof gitGraph.handleRailClick === "function"
					? gitGraph.handleRailClick(lineIndex, button, localX)
					: gitGraph.handleClick(lineIndex),
			handleRailWheel: (delta: number) =>
				typeof gitGraph.handleRailWheel === "function" ? gitGraph.handleRailWheel(delta) : false,
		};
		const workingTreeRail = {
			render: (width: number, availableHeight?: number) => workingTree.render(width, availableHeight),
			invalidate: () => workingTree.invalidate(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				typeof workingTree.handleRailClick === "function"
					? workingTree.handleRailClick(lineIndex, button, localX)
					: workingTree.handleClick(lineIndex),
			handleRailWheel: (delta: number) =>
				typeof workingTree.handleRailWheel === "function" ? workingTree.handleRailWheel(delta) : false,
		};
		const engramHandoffRail = {
			render: (width: number) => engramHandoff.render(width),
			invalidate: () => engramHandoff.invalidate(),
			handleRailClick: () => engramHandoff.handleClick(),
		};
		const memoryGraphRail = {
			render: (width: number) => memoryGraph.render(width),
			invalidate: () => memoryGraph.invalidate(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				memoryGraph.handleRailClick(lineIndex, button, localX),
		};
		const toolsRail = {
			render: (width: number) => toolsCard.render(width),
			invalidate: () => toolsCard.invalidate(),
		};
		const ecosystemRail = {
			render: (width: number) => ecosystemCard.render(width),
			invalidate: () => ecosystemCard.invalidate(),
			handleRailClick: (lineIndex: number, button?: string) => ecosystemCard.handleClick(lineIndex, button),
		};
		const profilesCard = new WorkspaceProfilesExtendedCard(tui, theme, undefined, ctx, pi);
		footerRegistry.latestProfilesCard = profilesCard;
		const profilesRail = {
			render: (width: number, availableHeight?: number) => profilesCard.render(width, availableHeight),
			invalidate: () => profilesCard.invalidate?.(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				profilesCard.handleRailClick(lineIndex, button, localX),
			handleRailWheel: (delta: number) => profilesCard.handleRailWheel(delta),
		};
		const projectTreeCard = new WorkspaceProjectTreeCard(ctx, tui, theme);
		footerRegistry.latestProjectTree = projectTreeCard;
		const projectTreeRail = {
			render: (width: number, availableHeight?: number) => projectTreeCard.render(width, availableHeight),
			invalidate: () => projectTreeCard.invalidate(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				projectTreeCard.handleRailClick(lineIndex, button, localX),
			handleRailWheel: (delta: number) => projectTreeCard.handleWheel(delta),
		};

		const part = sidebarPart(tui, "footer", bottom, rail);
		const contextPart = sidebarPart(tui, "context", { render: () => [] }, contextRail);
		const engramPart = sidebarPart(tui, "engram", { render: () => [] }, engramRail);
		const engramHandoffPart = sidebarPart(tui, "engramHandoff", { render: () => [] }, engramHandoffRail);
		const persistentMemoryPart = sidebarPart(tui, "persistentMemory", { render: () => [] }, memoryGraphRail);
		const memoryGraphPart = sidebarPart(tui, "memoryGraph", { render: () => [] }, memoryGraphRail);
		const gitGraphPart = sidebarPart(tui, "gitGraph", { render: () => [] }, gitGraphRail);
		const workingTreePart = sidebarPart(tui, "workingTree", { render: () => [] }, workingTreeRail);
		const toolsPart = sidebarPart(tui, "tools", { render: () => [] }, toolsRail);
		const ecosystemPart = sidebarPart(tui, "ecosystem", { render: () => [] }, ecosystemRail);
		const profilesPart = sidebarPart(tui, "solvi-profiles", { render: () => [] }, profilesRail);
		const projectTreePart = sidebarPart(tui, "projectTree", { render: () => [] }, projectTreeRail);
		const solviTabCard = new WorkspaceSolviTabCard(tui, theme, ctx);
		const solviTabRail = {
			render: (width: number, availableHeight?: number) => solviTabCard.render(width, availableHeight),
			invalidate: () => solviTabCard.invalidate(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				solviTabCard.handleRailClick(lineIndex, button, localX),
			handleRailWheel: (delta: number) => solviTabCard.handleRailWheel(delta),
		};
		const solviTabPart = sidebarPart(tui, "solviTab", { render: () => [] }, solviTabRail);

		const todoBottom: Component & { dispose?(): void } = {
			render: (width: number) => todos.renderBottom(width),
			invalidate: () => todos.invalidate(),
		};
		const todoRail: Component & { dispose?(): void; handleRailWheel?(delta: number): boolean } = {
			render: (width: number, availableHeight?: number) => todos.renderRail(width, availableHeight),
			invalidate: () => todos.invalidate(),
			handleRailWheel: (delta: number) => todos.handleRailWheel(delta),
		};
		(tui as any).__solviTodoRail = todoRail;
		const todoPart = sidebarPart(tui, "todo", todoBottom, todoRail);
		const uninstall = installSidebar(tui, theme);

		return {
			...part,
			...ecosystemPart,
			dispose() {
				uninstall();
				part.dispose?.();
				contextPart.dispose?.();
				ecosystemPart.dispose?.();
				engramPart.dispose?.();
				engramHandoffPart.dispose?.();
				persistentMemoryPart.dispose?.();
				memoryGraphPart.dispose?.();
				gitGraphPart.dispose?.();
				workingTreePart.dispose?.();
				toolsPart.dispose?.();
				profilesPart.dispose?.();
				projectTreePart.dispose?.();
				solviTabPart.dispose?.();
				solviTabCard.dispose?.();
				todoPart.dispose?.();
			},
		};
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		installWorkspaceFooter(ctx, pi);
	});
}
