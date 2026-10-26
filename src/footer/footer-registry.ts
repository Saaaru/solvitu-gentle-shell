import type { TUI } from "@earendil-works/pi-tui";
import type { WorkspaceTodoMirror } from "../todos.ts";
import type { WorkspaceGitGraphCard, WorkspaceWorkingTreeCard } from "../solvi-git-graph.ts";
import type { WorkspaceToolsCard } from "../solvi-tools.ts";
import type { WorkspaceEngramCard, WorkspaceEngramHandoffCard } from "../solvi-engram.ts";
import type { WorkspacePersistentMemoryCard } from "../solvi-persistent-memory.ts";
import type { WorkspaceProjectTreeCard } from "../solvi-tree.ts";
import type { WorkspaceProfilesExtendedCard } from "../profiles/profiles-card.ts";
import { resetGitFileChangesCache } from "../solvi-git-graph.ts";
import { resetUsageCache } from "../solvi-usage.ts";

export interface FooterRegistryState {
	todoHooksInstalled: boolean;
	latestTodoTui?: TUI;
	mainView?: import("../main-view.ts").MainViewState;
	latestFooterData?: { getGitBranch(): string | null; getExtensionStatuses?(): Map<string, string> };
	latestTodoMirror?: WorkspaceTodoMirror;
	latestGitGraph?: WorkspaceGitGraphCard;
	latestWorkingTree?: WorkspaceWorkingTreeCard;
	latestToolsCard?: WorkspaceToolsCard;
	latestEngramCard?: WorkspaceEngramCard;
	latestEngramHandoff?: WorkspaceEngramHandoffCard;
	latestPersistentMemory?: WorkspacePersistentMemoryCard;
	latestMemoryGraph?: WorkspacePersistentMemoryCard;
	latestProjectTree?: WorkspaceProjectTreeCard;
	latestProfilesCard?: WorkspaceProfilesExtendedCard;
}

export const footerRegistry: FooterRegistryState = {
	todoHooksInstalled: false,
};

export function getLatestTodoMirror(): WorkspaceTodoMirror | undefined {
	return footerRegistry.latestTodoMirror;
}

export function invalidateSidebarGitAndTree(): void {
	resetGitFileChangesCache();
	resetUsageCache();
	footerRegistry.latestGitGraph?.invalidate();
	footerRegistry.latestWorkingTree?.invalidate();
	footerRegistry.latestPersistentMemory?.invalidate();
	footerRegistry.latestMemoryGraph?.invalidate();
	footerRegistry.latestProjectTree?.invalidate();
	footerRegistry.latestToolsCard?.invalidate();
	footerRegistry.latestTodoTui?.requestRender();
}
