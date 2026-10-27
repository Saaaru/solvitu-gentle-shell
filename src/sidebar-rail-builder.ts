import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { safeFg, unifySidebarCardFrame } from "./solvi-theme.ts";
import { themeStamp } from "./theme/theme-adapter.ts";
import { loadSolviLayout } from "./solvi-layout.ts";
import { WorkspaceProfilesExtendedCard } from "./solvi-profiles.ts";
import { WorkspaceGitGraphCard, WorkspaceWorkingTreeCard, getGitSyncBadge } from "./solvi-git-graph.ts";
import { bindGitRenderHost } from "./git/git-swr.ts";
import { WorkspaceEngramHandoffCard } from "./solvi-engram.ts";
import { WorkspaceProjectTreeCard, WorkspaceFileViewerCard, getFolderState } from "./solvi-tree.ts";
import { WorkspacePersistentMemoryCard } from "./solvi-persistent-memory.ts";
import { WorkspaceSolviTabCard } from "./solvi-tab.ts";
import { WorkspaceModelsCard } from "./models/models-card.ts";
import { measureDockMetrics } from "./sidebar-dock.ts";
import { renderSolviSidebarBanner } from "./sidebar-state.ts";
import {
	resolveSidebarTab,
	renderSolviSidebarTabBar,
	type TabHitbox,
} from "./sidebar-tabs.ts";
import type { SectionMapping } from "./sidebar-mouse.ts";

export interface RailBuildResult {
	success: boolean;
	railLines: string[];
	sectionMappings: SectionMapping[];
	tabHitboxes: TabHitbox[];
	tabBarLineIndex: number;
	tabBarDividerLineIndex: number;
}

export interface RailBuilderContext {
	state: any;
	tui: TUI;
	theme?: Theme;
	activeDock: any;
	activeTranscript: any;
	contentWidth: number;
}

/**
 * Optional version signal a rail card can expose. `getRenderKey(width, height)` returns a cheap string that
 * changes whenever anything the card's `render` output depends on changes (it may still trigger background
 * refreshes, such as stale-while-revalidate reads, since it runs every frame). While the key, width, height and
 * theme are unchanged the builder reuses the card's previous lines and does not call `render` again. Cards that
 * do not expose it (animated cards, for one) render every frame; their output is then compared line by line to
 * the previous frame so the post-processing is still skipped when nothing changed.
 */
export interface RailCardVersioned {
	getRenderKey?(width: number, availableHeight?: number): string | undefined;
}

interface CardMemo {
	key: string | undefined;
	width: number;
	height: number | undefined;
	theme: unknown;
	stamp: string;
	unify: boolean;
	raw: string[];
	lines: string[];
}

const cardMemos = new WeakMap<object, CardMemo>();

interface RailMemo {
	signature: string;
	sections: Array<{ key: string; component: unknown; lines: string[] }>;
	result: RailBuildResult;
}

const railMemos = new WeakMap<object, RailMemo>();

function sameLines(a: readonly string[], b: readonly string[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function trimTrailingBlank(lines: string[]): string[] {
	const raw = [...lines];
	while (raw.length && raw[raw.length - 1]?.trim() === "") raw.pop();
	return raw;
}

/**
 * Renders (or reuses) one card. `preRaw` carries lines the caller already rendered in this frame.
 */
function resolveCard(
	component: any,
	width: number,
	height: number | undefined,
	theme: unknown,
	stamp: string,
	unify: boolean,
	preRaw?: string[],
): CardMemo {
	const memo = component && typeof component === "object" ? cardMemos.get(component) : undefined;
	const sameContext =
		!!memo && memo.width === width && memo.height === height && memo.theme === theme && memo.stamp === stamp;

	let key: string | undefined;
	if (!preRaw && typeof component?.getRenderKey === "function") {
		try {
			key = component.getRenderKey(width, height);
		} catch {
			key = undefined;
		}
	}

	let raw: string[] | undefined = preRaw;
	if (sameContext && key !== undefined && memo!.key === key) {
		if (memo!.unify === unify) return memo!;
		raw = memo!.raw;
	}
	if (!raw) raw = trimTrailingBlank(component?.render(width, height as any) ?? []);

	if (sameContext && memo!.unify === unify && sameLines(memo!.raw, raw)) {
		if (!preRaw) memo!.key = key;
		return memo!;
	}

	const lines = unify ? raw.map((line) => unifySidebarCardFrame(line, theme as any)) : raw;
	const next: CardMemo = { key, width, height, theme, stamp, unify, raw, lines };
	if (component && typeof component === "object") cardMemos.set(component, next);
	return next;
}

const NO_UNIFY_KEYS = new Set([
	"footer",
	"context",
	"todo",
	"engram",
	"engramHandoff",
	"engram-handoff",
	"gitGraph",
	"workingTree",
	"working-tree",
	"tools",
	"solvi-profiles",
	"solvi-profiles-extended",
	"profiles",
	"memoryGraph",
	"memory-graph",
	"persistentMemory",
	"persistent-memory",
	"projectTree",
	"project-tree",
	"fileViewer",
	"solviTab",
	"solvi-tab",
	"yt",
	"models",
]);

/**
 * Builds the complete formatted lines of the SOLVI sidebar rail:
 * - Calculates heights dynamically down to prompt line (split 50/50 for 2 cards, full height for single/todo)
 * - Lazily instantiates any unmounted cards
 * - Renders SOLVI banner, TabBar, cards and hitboxes
 */
export function buildSidebarRailLines(ctx: RailBuilderContext): RailBuildResult {
	const { state, tui, theme, activeDock, activeTranscript, contentWidth } = ctx;
	bindGitRenderHost(tui);
	const layout = loadSolviLayout().sidebar;
	const netWidth = contentWidth - layout.railPadding * 2;
	const tabsEnabled = layout.tabsEnabled !== false;
	const activeTab = resolveSidebarTab(state.activeTabId ?? layout.defaultTab);
	state.activeTabId = activeTab.id;

	const targetCardKeys = !tabsEnabled
		? ["footer", "context", "engram", "gitGraph", "tools", "solvi-profiles", "todo"]
		: activeTab.cards;

	const hasSolviTab = targetCardKeys.some(
		(key) => key === "solviTab" || key === "solvi-tab" || key === "solvi" || key === "yt",
	);
	if (!hasSolviTab) {
		const solviTabCard = state.parts.get("solviTab") as any;
		if (solviTabCard && typeof solviTabCard.clearCover === "function") {
			solviTabCard.clearCover();
		}
	}

	const branding = renderSolviSidebarBanner(netWidth, theme);
	const stamp = themeStamp(theme);
	const bannerLinesCount = (branding && branding.length) ? branding.length + 1 : 0;
	const tabsLinesCount = tabsEnabled ? 2 : 0;
	const headerLines = 1 + bannerLinesCount + tabsLinesCount + 1;

	const priorPass = new Map<string, { component: unknown; raw: string[] }>();
	let availableCardHeight: number | undefined;
	let cardHeights: (number | undefined)[] = [];
	const termRows = tui.terminal?.rows ?? loadSolviLayout().sidebar.fallbackRows ?? 45;
	const dockWidth = Math.max(10, (tui.terminal?.columns ?? 100) - layout.railWidth);
	const { totalHeight: dockHeight, visibleInputBottomOffset } = measureDockMetrics(activeDock, dockWidth);
	const transcriptHeight = activeTranscript?.viewportHeight;

	const inputBottomRow = (typeof transcriptHeight === "number" && transcriptHeight > 10)
		? transcriptHeight + visibleInputBottomOffset
		: Math.max(15, termRows - dockHeight + visibleInputBottomOffset);

	const maxAllowedHeight = Math.max(10, termRows - headerLines);
	const targetHeight = inputBottomRow - headerLines;
	const totalTargetHeight = Math.min(maxAllowedHeight, Math.max(10, targetHeight));

	if (targetCardKeys.length === 1) {
		availableCardHeight = totalTargetHeight;
		cardHeights = [totalTargetHeight];
	} else if (targetCardKeys.length === 2) {
		const interCardGap = 1;
		const availableForCards = Math.max(14, totalTargetHeight - interCardGap);
		const half = Math.floor(availableForCards / 2);
		const secondHalf = availableForCards - half;
		cardHeights = [half, secondHalf];
	} else if (targetCardKeys.includes("todo")) {
		let priorLines = 0;
		for (const key of targetCardKeys) {
			if (key === "todo") break;
			const comp = state.parts.get(key);
			// The section pass below reuses these lines instead of rendering the same card a second time.
			const raw = comp ? resolveCard(comp, netWidth, undefined, theme, stamp, false).raw : [];
			priorPass.set(key, { component: comp, raw });
			if (raw.length > 0) {
				priorLines += raw.length + 1;
			}
		}
		const remainingForTodo = Math.max(loadSolviLayout().todos.railMaxRows, totalTargetHeight - priorLines);
		availableCardHeight = remainingForTodo;
		const todoIndex = targetCardKeys.indexOf("todo");
		cardHeights[todoIndex] = remainingForTodo;
	}

	const sectionData = targetCardKeys
		.map((key, index) => {
			let component = state.parts.get(key);
			if (
				!component &&
				(key === "solvi-profiles" || key === "solvi-profiles-extended" || key === "profiles")
			) {
				component =
					state.parts.get("solvi-profiles") ||
					state.parts.get("solvi-profiles-extended") ||
					state.parts.get("profiles");
				if (!component) {
					component = new WorkspaceProfilesExtendedCard(tui, theme);
					state.parts.set("solvi-profiles", component);
				}
			}
			if (!component && (key === "gitGraph" || key === "git-graph")) {
				component = state.parts.get("gitGraph") || state.parts.get("git-graph");
				if (!component) {
					component = new WorkspaceGitGraphCard(undefined as any, tui, theme);
					state.parts.set("gitGraph", component);
				}
			}
			if (!component && (key === "workingTree" || key === "working-tree")) {
				component = state.parts.get("workingTree") || state.parts.get("working-tree");
				if (!component) {
					component = new WorkspaceWorkingTreeCard(undefined as any, tui, theme);
					state.parts.set("workingTree", component);
				}
			}
			if (!component && (key === "engramHandoff" || key === "engram-handoff")) {
				component = state.parts.get("engramHandoff") || state.parts.get("engram-handoff");
				if (!component) {
					component = new WorkspaceEngramHandoffCard(undefined as any, tui, theme);
					state.parts.set("engramHandoff", component);
				}
			}
			if (!component && (key === "projectTree" || key === "project-tree")) {
				component = state.parts.get("projectTree") || state.parts.get("project-tree");
				if (!component) {
					component = new WorkspaceProjectTreeCard(undefined as any, tui, theme, undefined, getFolderState(tui));
					state.parts.set("projectTree", component);
				}
			}
			if (!component && key === "fileViewer") {
				component = new WorkspaceFileViewerCard(getFolderState(tui), theme);
				state.parts.set("fileViewer", component);
			}
			if (
				!component &&
				(key === "persistentMemory" ||
					key === "persistent-memory" ||
					key === "memoryGraph" ||
					key === "memory-graph")
			) {
				component =
					state.parts.get("persistentMemory") ||
					state.parts.get("persistent-memory") ||
					state.parts.get("memoryGraph") ||
					state.parts.get("memory-graph");
				if (!component) {
					component = new WorkspacePersistentMemoryCard(undefined, tui, theme);
					state.parts.set("persistentMemory", component);
					state.parts.set("memoryGraph", component);
				}
			}
			if (!component && key === "models") {
				component = new WorkspaceModelsCard(
					((tui as any)?.__solviCtx ?? { scopedModels: [], sessionManager: { getEntries: () => [] } }) as any,
					tui,
					theme,
				);
				state.parts.set("models", component);
			}
			if (!component && (key === "solviTab" || key === "solvi-tab" || key === "yt")) {
				component = state.parts.get("solviTab") || state.parts.get("solvi-tab") || state.parts.get("yt");
				if (!component) {
					component = new WorkspaceSolviTabCard(tui, theme);
					state.parts.set("solviTab", component);
				}
			}
			const renderHeight = (targetCardKeys.length === 1 || targetCardKeys.length === 2 || key === "projectTree" || key === "project-tree" || key === "todo")
				? (cardHeights[index] ?? availableCardHeight)
				: undefined;
			const prior = priorPass.get(key);
			const preRaw = prior && prior.component === component && renderHeight === undefined ? prior.raw : undefined;
			const lines = component
				? resolveCard(component, netWidth, renderHeight as number | undefined, theme, stamp, !NO_UNIFY_KEYS.has(key), preRaw).lines
				: [];
			return { key, component, lines };
		})
		.filter((s) => s.lines.length > 0);

	const gitSyncBadgeForSig = tabsEnabled ? getGitSyncBadge((tui as any)?.cwd ?? process.cwd()) : "";
	const signature = [
		contentWidth,
		layout.railPadding,
		tabsEnabled ? 1 : 0,
		activeTab.id,
		stamp,
		gitSyncBadgeForSig,
		branding.join("\n"),
	].join("\u0001");
	const memoOwner = state as object;
	const previous = railMemos.get(memoOwner);
	if (
		previous &&
		previous.signature === signature &&
		previous.sections.length === sectionData.length &&
		previous.sections.every(
			(sec, i) =>
				sec.key === sectionData[i].key &&
				sec.component === sectionData[i].component &&
				sameLines(sec.lines, sectionData[i].lines),
		) &&
		(previous.result as RailBuildResult & { theme?: unknown }).theme === theme
	) {
		return previous.result;
	}
	const remember = (result: RailBuildResult): RailBuildResult => {
		if (result.success) {
			(result as RailBuildResult & { theme?: unknown }).theme = theme;
			railMemos.set(memoOwner, {
				signature,
				sections: sectionData.map((sec) => ({ key: sec.key, component: sec.component, lines: sec.lines })),
				result,
			});
		} else {
			railMemos.delete(memoOwner);
		}
		return result;
	};

	let railLines: string[] = [""];
	const sectionMappings: SectionMapping[] = [];
	let tabHitboxes: TabHitbox[] = [];
	let tabBarLineIndex = -1;
	let tabBarDividerLineIndex = -1;

	if (!tabsEnabled) {
		if (sectionData.length && branding.length) {
			railLines.push(...branding.map((line) => " ".repeat(layout.railPadding) + line + " ".repeat(layout.railPadding)));
			railLines.push("");
		}

		for (let i = 0; i < sectionData.length; i++) {
			if (i > 0) {
				railLines.push("");
			}
			const s = sectionData[i];
			const startLine = railLines.length;
			for (const line of s.lines) {
				railLines.push(" ".repeat(layout.railPadding) + line + " ".repeat(layout.railPadding));
			}
			sectionMappings.push({
				key: s.key,
				component: s.component,
				startLine,
				lineCount: s.lines.length,
			});
		}

		if (!railLines.length || !sectionData.length || railLines.some((line) => visibleWidth(line) > contentWidth)) {
			return { success: false, railLines: [], sectionMappings: [], tabHitboxes: [], tabBarLineIndex: -1, tabBarDividerLineIndex: -1 };
		}
		return remember({ success: true, railLines, sectionMappings, tabHitboxes: [], tabBarLineIndex: -1, tabBarDividerLineIndex: -1 });
	}

	// Tabs enabled flow
	if (branding.length) {
		railLines.push(...branding.map((line) => " ".repeat(layout.railPadding) + line + " ".repeat(layout.railPadding)));
		railLines.push("");
	}

	const cwd = (tui as any)?.cwd ?? process.cwd();
	const gitSyncBadge = getGitSyncBadge(cwd);
	const { line: tabLine, divider: dividerLine, hitboxes } = renderSolviSidebarTabBar(netWidth, activeTab.id, theme, gitSyncBadge);
	tabBarLineIndex = railLines.length;
	railLines.push(" ".repeat(layout.railPadding) + tabLine + " ".repeat(layout.railPadding));
	tabBarDividerLineIndex = railLines.length;
	railLines.push(" ".repeat(layout.railPadding) + dividerLine + " ".repeat(layout.railPadding));
	tabHitboxes = hitboxes;

	if (sectionData.length === 0) {
		railLines.push("");
		const dim = (s: string): string => (theme ? safeFg(theme, "dim", s) : s);
		const emptyMsg = dim("Sin información disponible en esta pestaña.");
		const pad = Math.max(0, Math.floor((netWidth - visibleWidth(emptyMsg)) / 2));
		railLines.push(" ".repeat(layout.railPadding + pad) + emptyMsg);
	} else {
		railLines.push("");
		for (let i = 0; i < sectionData.length; i++) {
			if (i > 0) {
				railLines.push("");
			}
			const s = sectionData[i];
			const startLine = railLines.length;
			for (const line of s.lines) {
				railLines.push(" ".repeat(layout.railPadding) + line + " ".repeat(layout.railPadding));
			}
			sectionMappings.push({
				key: s.key,
				component: s.component,
				startLine,
				lineCount: s.lines.length,
			});
		}
	}

	if (!railLines.length || railLines.some((line) => visibleWidth(line) > contentWidth)) {
		return { success: false, railLines: [], sectionMappings: [], tabHitboxes: [], tabBarLineIndex: -1, tabBarDividerLineIndex: -1 };
	}

	return remember({
		success: true,
		railLines,
		sectionMappings,
		tabHitboxes,
		tabBarLineIndex,
		tabBarDividerLineIndex,
	});
}
