import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { solviGlyphs, solviPalette, safeFg, bolden } from "../solvi-theme.ts";
import { loadSolviColors } from "../solvi-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../solvi-transcript.ts";
import {
	type SwitcherHitbox,
	type ProfileItem,
	listAvailableProfiles,
	getActiveProfileDetails,
	switchProfile,
	toggleProfileEffort,
	shortModelName,
} from "./profiles-service.ts";
import { getTaskManagerSummary } from "./profiles-task-sync.ts";
import {
	type SubagentTaskRecord,
	collectSessionSubagentTasks,
	loadGentleAgentsDiskTasks,
	formatSubagentStatusTag,
	formatTaskDuration,
	extractTaskIdFromText,
} from "./profiles-subagents.ts";

/**
 * Extended SDD Profiles & Quotas Card for Sidebar.
 * Displays:
 * 1. Switcher buttons for all local and builtin SDD profiles with click hitboxes.
 * 2. Active profile details, host model, and subagent roster.
 * 3. Live quota bars (5h rolling & Weekly limits) mapped to accounts.
 * 4. Interactive effort toggling (low -> medium -> high).
 * 5. Full-height alignment and mouse wheel internal scrolling.
 */
export class WorkspaceProfilesExtendedCard implements Component {
	private readonly tui?: TUI;
	private readonly theme?: Theme;
	private readonly cwd?: string;
	private readonly ctx?: ExtensionContext;
	private readonly pi?: ExtensionAPI;
	private switcherHitboxes: SwitcherHitbox[] = [];
	private isExpanded = false;
	private scrollOffset = 0;
	private lastMaxScrollOffset = 0;
	private liveTasks = new Map<string, SubagentTaskRecord>();

	constructor(tui?: TUI, theme?: Theme, cwd?: string, ctx?: ExtensionContext, pi?: ExtensionAPI) {
		this.tui = tui;
		this.theme = theme;
		this.cwd = cwd;
		this.ctx = ctx;
		this.pi = pi;
		this.subscribeLiveTasks();
	}

	private subscribeLiveTasks(): void {
		const pi: any = this.pi;
		if (!pi || typeof pi.on !== "function") return;
		const refresh = () => this.tui?.requestRender();
		const tracked = new Set(["subagent_run", "subagent_continue", "subagent_cancel"]);
		try {
			pi.on("tool_execution_start", (event: any) => {
				if (!tracked.has(event?.toolName)) return;
				const args = event.args ?? {};
				if (event.toolName === "subagent_cancel") {
					const target = this.liveTasks.get(String(args.task_id ?? ""));
					if (target) {
						target.status = "cancelled";
						target.finishedAt = Date.now();
					}
				} else {
					const taskText = String(args.task ?? args.prompt ?? "");
					const id = String(event.toolCallId ?? `live-${this.liveTasks.size + 1}`);
					this.liveTasks.set(id, {
						id,
						callId: event.toolCallId,
						agent: String(args.agent ?? "subagent"),
						label: String(args.label ?? (taskText.slice(0, 60) || args.agent || "subagent")),
						task: taskText,
						mode: args.mode === "background" ? "background" : "task",
						status: "running",
						startedAt: Date.now(),
					});
				}
				refresh();
			});
			pi.on("tool_execution_end", (event: any) => {
				if (!tracked.has(event?.toolName)) return;
				const rec = [...this.liveTasks.values()].find((r) => r.callId === event.toolCallId);
				if (rec) {
					const text = JSON.stringify(event.result?.content ?? event.result ?? "");
					const realId =
						event.result?.details?.gentleAgents?.taskId || event.result?.details?.taskId || extractTaskIdFromText(text);
					if (realId && realId !== rec.id) {
						this.liveTasks.delete(rec.id);
						rec.id = String(realId);
						this.liveTasks.set(rec.id, rec);
					}
					if (event.isError) {
						rec.status = "failed";
						rec.finishedAt = Date.now();
						rec.error = text.slice(0, 120);
					} else if (rec.mode === "background") {
						rec.resultSummary = "En background…";
					} else if (rec.status === "running") {
						rec.status = "completed";
						rec.finishedAt = Date.now();
					}
				}
				refresh();
			});
			pi.on("entry_appended", refresh);
			pi.on("turn_end", refresh);
		} catch {}
	}

	private collectDelegatedTasks(): SubagentTaskRecord[] {
		const merged = new Map<string, SubagentTaskRecord>();
		const cwd = this.cwd || (this.ctx as any)?.cwd;
		const disk = cwd ? loadGentleAgentsDiskTasks(undefined, 5, undefined, cwd) : [];
		for (const t of disk) merged.set(t.id, t);
		for (const t of this.liveTasks.values()) merged.set(t.id, t);
		for (const t of collectSessionSubagentTasks(this.ctx)) merged.set(t.id, t);
		return [...merged.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 5);
	}

	getSwitcherHitboxes(): SwitcherHitbox[] {
		return [...this.switcherHitboxes];
	}

	handleRailClick(localLineIndex: number, _button?: string, localX?: number): boolean {
		if (localX !== undefined) {
			const hit = this.switcherHitboxes.find(
				(h) => h.lineIndex === localLineIndex && localX >= h.startX && localX <= h.endX,
			);
			if (hit) {
				if (hit.type === "toggle-pagination") {
					this.isExpanded = !this.isExpanded;
					this.tui?.requestRender();
					return true;
				}

				if (hit.type === "effort-host") {
					const active = getActiveProfileDetails(this.cwd);
					if (active?.name) {
						const next = toggleProfileEffort(active.name, undefined, this.cwd);
						if (next && this.pi && typeof this.pi.setThinkingLevel === "function") {
							try {
								this.pi.setThinkingLevel(next);
							} catch {}
						}
						this.tui?.requestRender();
					}
					return true;
				}

				if (hit.type === "effort-agent" && hit.agentId) {
					const active = getActiveProfileDetails(this.cwd);
					if (active?.name) {
						toggleProfileEffort(active.name, hit.agentId, this.cwd);
						this.tui?.requestRender();
					}
					return true;
				}

				if (hit.profileName) {
					switchProfile(hit.profileName, this.ctx, this.pi, this.cwd).then(() => {
						this.tui?.requestRender();
					});
					return true;
				}
			}
		}

		return false;
	}

	handleRailWheel(wheelDelta: number): boolean {
		if (wheelDelta !== 0) {
			const step = wheelDelta > 0 ? 2 : -2;
			if (this.lastMaxScrollOffset > 0) {
				const next = Math.max(0, Math.min(this.lastMaxScrollOffset, this.scrollOffset + step));
				if (next !== this.scrollOffset) {
					this.scrollOffset = next;
					this.tui?.requestRender();
					return true;
				}
				return true;
			}
		}
		return false;
	}

	render(width: number, availableHeight?: number): string[] {
		const theme = this.theme;
		const g = solviGlyphs(theme);
		const colors = loadSolviColors();
		const palette = solviPalette(theme);
		const c = {
			...palette,
			accent: (s: string) => palette.pinkAccent(s),
			pink: (s: string) => palette.pinkAccent(s),
			pinkBright: (s: string) => (theme ? safeFg(theme, "pinkBright", s) : s),
			violet: (s: string) => (theme ? safeFg(theme, "border", s) : s),
			celeste: (s: string) => (theme ? safeFg(theme, "write", s) : s),
			salmon: (s: string) => (theme ? safeFg(theme, "salmon", s) : s),
			bold: (s: string) => bolden(theme, s),
		};

		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4; // │ + space + content + space + │
		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);

		const titleStr = `${c.pink(g.brand || "")} ${c.pinkBright("Profiles & Clusters")}`;
		const maxTitleLen = Math.max(0, safeWidth - 6);
		const displayTitle = calcVisibleWidth(titleStr) > maxTitleLen ? truncateAnsiAware(titleStr, maxTitleLen) : titleStr;
		const titleLen = calcVisibleWidth(displayTitle);
		const fillTop = Math.max(0, safeWidth - 5 - titleLen);
		const top = `${frame(`${g.tl}${g.h} `)}${displayTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);
		const divider = frame(`${g.dividerL || "├"}${g.h.repeat(safeWidth - 2)}${g.dividerR || "┤"}`);

		const boxLine = (left: string, right = "", extraWidth = 0): string => {
			let safeRight = right;
			if (calcVisibleWidth(safeRight) > innerWidth) {
				safeRight = truncateAnsiAware(safeRight, innerWidth);
			}
			const rightWidth = calcVisibleWidth(safeRight);
			const maxLeftWidth = Math.max(0, innerWidth - (rightWidth > 0 ? rightWidth + 1 : 0));
			const truncatedLeft = truncateAnsiAware(left, maxLeftWidth);
			const leftWidth = calcVisibleWidth(truncatedLeft);
			const padLen = Math.max(0, innerWidth - leftWidth - rightWidth - extraWidth);
			const pad = " ".repeat(padLen);
			return `${frame(g.v)} ${truncatedLeft}${pad}${safeRight} ${frame(g.v)}`;
		};

		this.switcherHitboxes = [];

		const availableProfiles = listAvailableProfiles(this.cwd);
		const profilesToRender: ProfileItem[] =
			availableProfiles.length > 0
				? availableProfiles
				: [{ name: "default", active: true, source: "builtin" }];

		const activeDetails = getActiveProfileDetails(this.cwd) || {
			name: profilesToRender.find((p) => p.active)?.name || profilesToRender[0]?.name || "default",
			default_model: "default",
			default_effort: "high",
		};
		const activeName = (activeDetails.name || "").toLowerCase();

		const clusterButtons = profilesToRender.map((item, idx) => {
			const num = idx + 1;
			const isActive = item.active || item.name.toLowerCase() === activeName;
			const dot = isActive ? "●" : "○";
			const raw = `[${dot} ${num}: ${item.name}]`;
			const styled = isActive
				? c.pinkBright(c.bold(raw))
				: `${c.dim(`[○ ${num}: `)}${c.muted(item.name)}${c.dim("]")}`;
			return {
				name: item.name,
				styled,
				len: calcVisibleWidth(raw),
			};
		});

		const lines: string[] = [top];

		// Dynamic line wrapping with max 3 lines pagination
		const MAX_PROFILE_LINES = 3;
		const toggleBtnRaw = this.isExpanded ? "[▲]" : "[▼]";
		const toggleBtnLen = calcVisibleWidth(toggleBtnRaw);
		const toggleBtnStyled = c.pinkBright(c.bold(toggleBtnRaw));

		// First pass: wrap all buttons into rows
		const wrappedRows: typeof clusterButtons[] = [];
		let rowButtons: typeof clusterButtons = [];
		let rowWidth = 0;

		for (const btn of clusterButtons) {
			const space = rowWidth > 0 ? 1 + btn.len : btn.len;
			if (rowWidth + space <= innerWidth) {
				rowButtons.push(btn);
				rowWidth += space;
			} else {
				if (rowButtons.length > 0) wrappedRows.push(rowButtons);
				rowButtons = [btn];
				rowWidth = btn.len;
			}
		}
		if (rowButtons.length > 0) wrappedRows.push(rowButtons);

		const needsPagination = wrappedRows.length > MAX_PROFILE_LINES;
		const rowsToRenderCount = !needsPagination || this.isExpanded ? wrappedRows.length : MAX_PROFILE_LINES;

		for (let r = 0; r < rowsToRenderCount; r++) {
			const isLastVisibleRow = r === rowsToRenderCount - 1 && needsPagination;
			const row = wrappedRows[r];
			const lineIndex = lines.length;
			let currentX = 2; // initial border + space

			if (isLastVisibleRow) {
				// Fit as many buttons as possible leaving room for [▼] or [▲]
				const availableWidth = innerWidth - toggleBtnLen - 1;
				const visibleRowButtons: typeof clusterButtons = [];
				let accumWidth = 0;

				for (const btn of row) {
					const space = accumWidth > 0 ? 1 + btn.len : btn.len;
					if (accumWidth + space <= availableWidth) {
						visibleRowButtons.push(btn);
						accumWidth += space;
					} else {
						break;
					}
				}

				for (const btn of visibleRowButtons) {
					this.switcherHitboxes.push({
						type: "profile",
						profileName: btn.name,
						lineIndex,
						startX: currentX,
						endX: currentX + btn.len,
					});
					currentX += btn.len + 1;
				}

				// Add toggle button at the end
				const lineContent = visibleRowButtons.map((b) => b.styled).join(" ");
				this.switcherHitboxes.push({
					type: "toggle-pagination",
					lineIndex,
					startX: currentX,
					endX: currentX + toggleBtnLen,
				});

				const leftPart = lineContent.length > 0 ? `${lineContent} ${toggleBtnStyled}` : toggleBtnStyled;
				lines.push(boxLine(leftPart));
			} else {
				for (const btn of row) {
					this.switcherHitboxes.push({
						type: "profile",
						profileName: btn.name,
						lineIndex,
						startX: currentX,
						endX: currentX + btn.len,
					});
					currentX += btn.len + 1;
				}
				const lineContent = row.map((b) => b.styled).join(" ");
				lines.push(boxLine(lineContent));
			}
		}

		// Divider between switchers and agents
		lines.push(divider);
		const fixedHeaderLength = lines.length;

		const bodyLines: string[] = [];
		const bodyEffortHitboxes: {
			type: "effort-host" | "effort-agent";
			agentId?: string;
			bodyLineIndex: number;
			startX: number;
			endX: number;
		}[] = [];

		// 2. Host row
		const hostModel = activeDetails.default_model || "default";
		const shortHost = shortModelName(hostModel).replace(/-high$/, "");

		const hostLeft = `${c.violet("🎯")} ${c.bold(c.violet("host / orquestador"))}`;
		const hostRight = c.gold(shortHost);
		bodyLines.push(boxLine(hostLeft, hostRight));

		// 3. Dynamic agent rows discovered from active profile
		const allAgentIds = Object.keys(activeDetails.model_profiles || {});

		const getAgentStyle = (agentId: string) => {
			if (agentId.startsWith("gentle-ai-")) {
				// ODD Core: Celeste
				return { bullet: c.celeste("•"), name: (s: string) => c.celeste(s) };
			}
			if (agentId.startsWith("jd-")) {
				// Judgment Day: Dorado
				return { bullet: c.gold("•"), name: (s: string) => c.gold(s) };
			}
			if (agentId.startsWith("review-")) {
				// Review Lenses: Menta
				return { bullet: c.mint("•"), name: (s: string) => c.mint(s) };
			}
			if (agentId.startsWith("research-")) {
				// Deep Research: Salmón
				return { bullet: c.salmon("•"), name: (s: string) => c.salmon(s) };
			}
			// Fallback / Custom user subagents: Pink accent bullet + text color
			return { bullet: c.pink("•"), name: (s: string) => c.text(s) };
		};

		if (allAgentIds.length === 0) {
			bodyLines.push(boxLine(c.dim("sin subagentes configurados")));
		} else {
			for (const agentId of allAgentIds) {
				const agentCfg = activeDetails.model_profiles?.[agentId];
				const model = agentCfg?.model || hostModel;
				const shortAgent = shortModelName(model).replace(/-high$/, "");
				const style = getAgentStyle(agentId);

				const leftText = `${style.bullet} ${style.name(agentId)}`;
				const rightText = c.gold(shortAgent);
				bodyLines.push(boxLine(leftText, rightText));
			}
		}

		// 3b. Delegated subagent tasks
		const delegated = this.collectDelegatedTasks();
		if (delegated.length > 0) {
			bodyLines.push(divider);
			const running = delegated.filter((t) => t.status === "running").length;
			const completed = delegated.filter((t) => t.status === "completed").length;
			const summaryRight =
				running > 0
					? `${c.mint(`${running} act`)} · ${c.dim(`${completed} ok`)}`
					: c.dim(`${delegated.length} total`);
			// ⚡ renders 2 cells wide in terminals but calcVisibleWidth counts 1
			bodyLines.push(boxLine(`${c.accent("⚡ Subagentes Delegados")}`, summaryRight, 1));
			for (const t of delegated) {
				const style = getAgentStyle(t.agent);
				const durationMs = (t.finishedAt ?? Date.now()) - t.startedAt;
				bodyLines.push(
					boxLine(
						`${style.bullet} ${style.name(`[${t.agent}]`)} ${c.text(t.label)}`,
						formatSubagentStatusTag(t.status, c),
					),
				);
				bodyLines.push(
					boxLine(
						`   ${c.dim("ID:")} ${c.muted(t.id)} ${c.dim("·")} ${c.dim(t.mode === "background" ? "bg" : "task")} ${c.dim("·")} ${c.muted(formatTaskDuration(durationMs))}`,
					),
				);
				if (t.error) bodyLines.push(boxLine(`   ${c.coral(`↳ ${t.error}`)}`));
				else if (t.resultSummary) bodyLines.push(boxLine(`   ${c.dim(`↳ ${t.resultSummary}`)}`));
			}
		}

		// 4. Task Manager status summary if available
		const tm = getTaskManagerSummary(this.cwd);
		if (tm && tm.total > 0) {
			bodyLines.push(divider);
			const ratioStr = `${tm.completed}/${tm.total}`;
			const inProgStr = tm.inProgress > 0 ? ` · ${c.gold(`${tm.inProgress} en curso`)}` : "";
			bodyLines.push(boxLine(`${c.accent("📋 Task Manager")}`, `${c.mint(ratioStr)}${inProgStr}`));
			if (tm.currentTaskTitle) {
				bodyLines.push(boxLine(`   ▶ ${c.text(tm.currentTaskTitle)}`));
			}
		}

		const targetCardLines =
			availableHeight ||
			(this.tui?.terminal?.rows && this.tui.terminal.rows >= 15
				? Math.max(10, this.tui.terminal.rows - 11)
				: undefined);

		if (targetCardLines !== undefined && targetCardLines > fixedHeaderLength + 2) {
			const availableBodyLines = targetCardLines - fixedHeaderLength - 1; // -1 for bottom border
			if (bodyLines.length > availableBodyLines) {
				const maxVisibleBody = availableBodyLines - 1; // reserve 1 line for scroll indicator
				this.lastMaxScrollOffset = Math.max(0, bodyLines.length - maxVisibleBody);
				this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, this.lastMaxScrollOffset));
				const visibleBody = bodyLines.slice(this.scrollOffset, this.scrollOffset + maxVisibleBody);

				for (const l of visibleBody) {
					lines.push(l);
				}

				for (const hb of bodyEffortHitboxes) {
					if (hb.bodyLineIndex >= this.scrollOffset && hb.bodyLineIndex < this.scrollOffset + visibleBody.length) {
						this.switcherHitboxes.push({
							type: hb.type,
							agentId: hb.agentId,
							lineIndex: fixedHeaderLength + (hb.bodyLineIndex - this.scrollOffset),
							startX: hb.startX,
							endX: hb.endX,
						});
					}
				}

				const remainingBelow = bodyLines.length - (this.scrollOffset + visibleBody.length);
				const parts: string[] = [];
				if (this.scrollOffset > 0) parts.push("▲ " + this.scrollOffset + " arriba");
				if (remainingBelow > 0) parts.push("▼ " + remainingBelow + " abajo");
				lines.push(boxLine(c.dim("... " + parts.join(" · ") + " (wheel scroll)")));
			} else {
				this.lastMaxScrollOffset = 0;
				this.scrollOffset = 0;
				for (const l of bodyLines) {
					lines.push(l);
				}
				for (const hb of bodyEffortHitboxes) {
					this.switcherHitboxes.push({
						type: hb.type,
						agentId: hb.agentId,
						lineIndex: fixedHeaderLength + hb.bodyLineIndex,
						startX: hb.startX,
						endX: hb.endX,
					});
				}
				while (lines.length < targetCardLines - 1) {
					lines.push(boxLine(""));
				}
			}
			lines.push(bottom);
		} else {
			this.lastMaxScrollOffset = 0;
			for (const l of bodyLines) {
				lines.push(l);
			}
			for (const hb of bodyEffortHitboxes) {
				this.switcherHitboxes.push({
					type: hb.type,
					agentId: hb.agentId,
					lineIndex: fixedHeaderLength + hb.bodyLineIndex,
					startX: hb.startX,
					endX: hb.endX,
				});
			}
			lines.push(bottom);
		}

		return lines;
	}
}
