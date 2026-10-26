import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { solviGlyphs, safeFg, bolden } from "./solvi-theme.ts";
import { sidebarState } from "./sidebar-state.ts";

export interface SolviSidebarTab {
	id: string;
	key: string;
	label: string;
	title?: string;
	cards: string[];
}

export const SIDEBAR_TAB_CARD_MAP: Record<string, string[]> = {
	skills: ["main-list", "main-viewer"],
	git: ["gitGraph", "workingTree", "todo"],
	prof: ["solvi-profiles"],
	mem: ["ecosystem", "models"],
	tree: ["projectTree"],
	solvi: ["solviTab"],
};

export const SOLVI_SIDEBAR_TABS: readonly SolviSidebarTab[] = [
	{ id: "mem", key: "1", label: "STACK", title: "Stack & Models", cards: SIDEBAR_TAB_CARD_MAP.mem },
	{ id: "git", key: "2", label: "GIT", title: "Git Graph & Working Tree", cards: SIDEBAR_TAB_CARD_MAP.git },
	{ id: "prof", key: "3", label: "PROF", title: "Profiles & Clusters", cards: SIDEBAR_TAB_CARD_MAP.prof },
	{ id: "tree", key: "4", label: "FLDR", title: "Folder Explorer", cards: SIDEBAR_TAB_CARD_MAP.tree },
	{ id: "skills", key: "5", label: "SKILLS", title: "Skills & MCP", cards: SIDEBAR_TAB_CARD_MAP.skills },
	{ id: "solvi", key: "6", label: "Solvi", title: "Solvi", cards: SIDEBAR_TAB_CARD_MAP.solvi },
];

export function resolveSidebarTab(tabIdOrKey?: string): SolviSidebarTab {
	if (tabIdOrKey) {
		let normalized = tabIdOrKey.toLowerCase();
		if (normalized === "forge" || normalized === "agents" || normalized === "usage") normalized = "prof";
		if (normalized === "projecttree" || normalized === "project-tree" || normalized === "main" || normalized === "folder") normalized = "tree";
		const match = SOLVI_SIDEBAR_TABS.find(
			(t) => t.id === normalized || t.key === normalized || t.label.toLowerCase() === normalized
		);
		if (match) return match;
	}
	return SOLVI_SIDEBAR_TABS[0];
}

export interface TabHitbox {
	id: string;
	key: string;
	label: string;
	startX: number;
	endX: number;
}

export function renderSolviSidebarTabBar(
	width: number,
	activeTabId: string,
	theme?: Theme,
	gitSyncBadge?: string,
): { line: string; divider: string; hitboxes: TabHitbox[] } {
	const activeTab = resolveSidebarTab(activeTabId);
	const hitboxes: TabHitbox[] = [];

	const dim = (s: string): string => (theme ? safeFg(theme, "dim", s) : s);
	const muted = (s: string): string => (theme ? safeFg(theme, "muted", s) : s);
	const pinkBright = (s: string): string => (theme ? safeFg(theme, "pinkBright", s) : s);
	const subtle = (s: string): string => (theme ? safeFg(theme, "borderMuted", s) : s);
	const warning = (s: string): string => (theme ? safeFg(theme, "warning", s) : s);

	const compactActive = width < 44;

	const tabVisuals = SOLVI_SIDEBAR_TABS.map((tab) => {
		const isActive = tab.id === activeTab.id;
		const extraSuffix = tab.id === "git" && gitSyncBadge ? ` ${gitSyncBadge}` : "";

		if (isActive) {
			const label = compactActive
				? `[${tab.key}:${tab.label}${extraSuffix}]`
				: `[ ${tab.key}:${tab.label}${extraSuffix} ]`;
			const styled = pinkBright(bolden(theme, label));
			return { tab, isActive, styled, len: visibleWidth(label) };
		} else {
			const label = `${tab.key}:${tab.label}${extraSuffix}`;
			const badgeStyled = extraSuffix ? warning(extraSuffix) : "";
			const styled = `${dim(tab.key)}${dim(":")}${muted(tab.label)}${badgeStyled}`;
			return { tab, isActive, styled, len: visibleWidth(label) };
		}
	});

	const totalTabLen = tabVisuals.reduce((acc, t) => acc + t.len, 0);
	const gapsCount = SOLVI_SIDEBAR_TABS.length - 1;
	const remaining = Math.max(0, width - totalTabLen);
	const baseGap = gapsCount > 0 ? Math.floor(remaining / gapsCount) : 0;
	let extraSpaces = gapsCount > 0 ? remaining % gapsCount : 0;

	let currentX = 0;
	const parts: string[] = [];

	for (let i = 0; i < tabVisuals.length; i++) {
		const item = tabVisuals[i];
		const startX = currentX;
		const endX = currentX + item.len;
		hitboxes.push({
			id: item.tab.id,
			key: item.tab.key,
			label: item.tab.label,
			startX,
			endX,
		});
		parts.push(item.styled);
		currentX = endX;

		if (i < gapsCount) {
			const gap = baseGap + (extraSpaces > 0 ? 1 : 0);
			if (extraSpaces > 0) extraSpaces--;
			if (gap > 0) {
				parts.push(" ".repeat(gap));
				currentX += gap;
			}
		}
	}

	if (currentX < width) {
		parts.push(" ".repeat(width - currentX));
	}

	const glyphs = solviGlyphs(theme);
	const sepChar = glyphs.frameStyle === "ascii" || glyphs.h === "-" ? "-" : "─";
	const divider = subtle(sepChar.repeat(Math.max(0, width)));

	let line = parts.join("");
	if (width < totalTabLen || visibleWidth(line) > width) {
		line = truncateToWidth(line, Math.max(0, width));
	}

	const validHitboxes = hitboxes
		.filter((h) => h.startX < width)
		.map((h) => ({
			...h,
			endX: Math.min(h.endX, width),
		}));

	return {
		line,
		divider,
		hitboxes: validHitboxes,
	};
}

/** Moves the active sidebar tab by `delta` (wraps around). Used by the Alt+arrow shortcuts. */
export function cycleSidebarTab(tui: { requestRender(): void }, delta: number): void {
	const state = sidebarState(tui as any);
	const current = resolveSidebarTab(state.activeTabId).id;
	const index = SOLVI_SIDEBAR_TABS.findIndex((t) => t.id === current);
	const next = (index + delta + SOLVI_SIDEBAR_TABS.length) % SOLVI_SIDEBAR_TABS.length;
	state.activeTabId = SOLVI_SIDEBAR_TABS[next].id;
	tui.requestRender();
}
