import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { loadSolviStrings, detectSystemUser } from "../solvi-strings.ts";
import { loadSolviColors } from "../solvi-colors.ts";
import { safeFg, stripAnsi, transformTranscriptLines } from "../solvi-theme.ts";
import { frameCategoryBox } from "./transcript-ansi.ts";
import { unwrapNativeCard, isAsciiArtOrBanner } from "./transcript-unwrap.ts";
import { toolFilePath } from "./transcript-highlight.ts";
import {
	cleanBashLines,
	formatBashOutputLines,
	formatGrepLines,
	formatReadLines,
	formatWriteDiffLines,
} from "./transcript-tools-system.ts";
import {
	isFetchComponent,
	isSearchComponent,
	isReviewComponent,
	isMemoryComponent,
	isSubagentComponent,
	isAgentStatusComponent,
	isErrorTextComponent,
	extractReviewHeader,
	formatReviewOutputLines,
	formatMemoryOutputLines,
	formatSubagentLines,
	FramedCardMouseProxy,
} from "./transcript-tools-special.ts";
import { formatAssistantProse } from "./transcript-prose.ts";
import {
	assistantCardKey,
	assistantFingerprint,
	readAssistantCard,
	storeAssistantCard,
} from "./transcript-assistant-cache.ts";
import { PathLinkMouseProxy } from "./transcript-interactive.ts";
import { isSolviCardComponent, toolCategory } from "../tool-card.ts";
import { memoizeChildCard, type CachedMouseEntry } from "./transcript-child-cache.ts";

/**
 * Checks whether a transcript component is a bash execution.
 */
export function isBashComponent(child: Component): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	if (name === "BashExecutionComponent" || (typeof (child as any).command === "string" && Array.isArray((child as any).outputLines))) return true;
	if (name === "ToolExecutionComponent" && (child as any).toolName === "bash") return true;
	if ((child as any).toolName === "bash") return true;
	return false;
}

export function isSpacer(child: Component): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	return name === "Spacer";
}

/**
 * Checks whether a transcript component is a read tool execution.
 */
export function isReadComponent(child: Component): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	if (name === "ToolExecutionComponent" && (child as any).toolName === "read") return true;
	if ((child as any).toolName === "read") return true;
	return false;
}

/**
 * Checks whether a transcript component is a write/edit tool execution.
 */
export function isWriteComponent(child: Component): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	const toolName = (child as any).toolName;
	if (name === "ToolExecutionComponent" && (toolName === "write" || toolName === "edit")) return true;
	if (toolName === "write" || toolName === "edit") return true;
	return false;
}

/**
 * Checks whether a transcript component is a grep tool execution.
 */
export function isGrepComponent(child: Component): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	const toolName = (child as any).toolName;
	if (name === "ToolExecutionComponent" && toolName === "grep") return true;
	if (toolName === "grep") return true;
	return false;
}

/**
 * Format a transcript child component:
 * Frames user messages in the golden box with 🐝, bash executions
 * in the sunset orange box with >_ bash, while allowing
 * other components (assistant messages, non-bash tools) to render naturally.
 */
export function formatTranscriptChild(
	child: Component,
	width: number,
	theme?: Theme,
): string[] {
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	const strings = loadSolviStrings();
	const colors = loadSolviColors();
	const user = strings.welcomePersona.user || detectSystemUser();

	// User Message (configurable via colors.userMessage, default 'heading' / #E0C27A)
	if (name === "UserMessageComponent") {
		const rawLines = child.render(width - 4);
		return frameCategoryBox(rawLines, `🐝 ${user}`, colors.userMessage, width, theme);
	}

	// Solvitu tool cards are formatted by their own renderer; frame them in their category box.
	if (isSolviCardComponent(child)) {
		const { title, tone } = solviCardFrame(child, colors);
		const rawLines = child.render(Math.max(1, width - 4));
		const boxed = frameCategoryBox(rawLines, title, tone, width, theme);
		return boxed.length ? boxed : rawLines;
	}

	// Bash execution (single child fallback)
	if (isBashComponent(child)) {
		const rawLines = child.render(width - 4);
		const cleaned = cleanBashLines(rawLines);
		const unwrapped = unwrapNativeCard(rawLines);
		const styled = formatBashOutputLines(cleaned.length ? cleaned : unwrapped, theme, colors.bashOutput);
		return frameCategoryBox(styled, ">_ bash", colors.bashMessage, width, theme);
	}

	// Read tool execution in soft lilac card (#C5A3E0 / colors.readMessage)
	if (isReadComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		const styled = formatReadLines(unwrapped, toolFilePath(child, unwrapped), theme);
		return frameCategoryBox(styled, "\u270E read", colors.readMessage, width, theme);
	}

	// Write / edit tool execution in barely-blue card (#A5CBE8 / colors.writeMessage)
	if (isWriteComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		const styled = formatWriteDiffLines(unwrapped, toolFilePath(child, unwrapped), theme, (child as any).toolName);
		return frameCategoryBox(styled, "\u270E write", colors.writeMessage, width, theme);
	}

	// Fetch tool execution in pink card (#F095C8 / colors.fetchMessage)
	if (isFetchComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		return frameCategoryBox(unwrapped, "fetch", colors.fetchMessage, width, theme);
	}

	// Search tool execution in dusty-rose card (#D7A0B8 / colors.searchMessage)
	if (isSearchComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		return frameCategoryBox(unwrapped, "search", colors.searchMessage, width, theme);
	}

	// Review tool (RDD) execution in gentle tone (#a46db5 / colors.reviewMessage)
	if (isReviewComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		const title = extractReviewHeader(unwrapped, child);
		const styled = formatReviewOutputLines(unwrapped, theme);
		return frameCategoryBox(styled, title, colors.reviewMessage ?? "gentle", width, theme);
	}

	// Memory (Engram or Persistent Memory) tool execution in salmon card (#F0978A / colors.memoryMessage)
	if (isMemoryComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		const styled = formatMemoryOutputLines(unwrapped, theme);
		const toolName = (child as any).toolName;
		const memTitle = typeof toolName === "string" && toolName.startsWith("memory_") ? "🧠 memory" : "🧠 engram";
		return frameCategoryBox(styled, memTitle, colors.memoryMessage, width, theme);
	}

	// Subagent tool execution in solvi cyan/accent card (colors.agentMessage / #8BE9FD)
	if (isSubagentComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		const styled = formatSubagentLines(unwrapped, theme);
		return frameCategoryBox(styled, "🤖 subagent", colors.agentMessage ?? "accent", width, theme);
	}

	// Grep tool execution without bounding box, but with full Dracula-style highlighting
	if (isGrepComponent(child)) {
		const rawLines = child.render(width);
		const unwrapped = unwrapNativeCard(rawLines);
		return formatGrepLines(unwrapped, theme);
	}

	// Top-level Pi error Text in coral card
	if (isErrorTextComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		return frameCategoryBox(unwrapped, "\u26A0 error", colors.errorMessage, width, theme);
	}

	// Assistant prose renders free (no card) with bolder headings and celeste body text
	if (name === "AssistantMessageComponent") {
		const rawLines = child.render(width);
		return formatAssistantProse(rawLines, theme, width);
	}

	const rawLines = child.render(width);
	const unwrapped = unwrapNativeCard(rawLines);
	return transformTranscriptLines(unwrapped, theme);
}

/** Title and tone of the category box that frames a Solvitu tool card. */
function solviCardFrame(child: Component, colors: ReturnType<typeof loadSolviColors>): { title: string; tone: string } {
	const anyChild = child as any;
	const toolName = String(anyChild.toolName ?? "tool");
	const failed = Boolean(anyChild.isError ?? anyChild.result?.isError);
	const cat = toolCategory(toolName);
	return { title: `${failed ? "✗" : cat.glyph} ${toolName}`, tone: failed ? colors.errorMessage : cat.tone };
}

/** Makes sure Pi renders thinking blocks as a short label, never the model's reasoning dump. */
function hideAssistantThinking(child: Component): void {
	const c = child as any;
	if (c.hiddenThinkingLabel !== "thinking") {
		if (typeof c.setHiddenThinkingLabel === "function") c.setHiddenThinkingLabel("thinking");
		else c.hiddenThinkingLabel = "thinking";
	}
	if (c.hideThinkingBlock === false) {
		if (typeof c.setHideThinkingBlock === "function") c.setHideThinkingBlock(true);
		else c.hideThinkingBlock = true;
	}
}

/** Drops leading and trailing blank lines so line indexes match the framed card body. */
function trimBlankLines(lines: string[]): string[] {
	const out = [...lines];
	while (out.length && stripAnsi(out[0] ?? "").trim() === "") out.shift();
	while (out.length && stripAnsi(out[out.length - 1] ?? "").trim() === "") out.pop();
	return out;
}

/**
 * Formats a list of transcript children with intelligent grouping.
 */
export function formatTranscriptChildren(
	children: Component[],
	width: number,
	theme?: Theme,
): { lines: string[]; mouseChildren: Array<{ component: Component; height: number }> } {
	const lines: string[] = [];
	const mouseChildren: Array<{ component: Component; height: number }> = [];
	const strings = loadSolviStrings();
	const colors = loadSolviColors();
	const user = strings.welcomePersona.user || detectSystemUser();

	const ensureBreathingRoom = () => {
		if (lines.length > 0 && lines[lines.length - 1] !== "") {
			lines.push("");
			mouseChildren.push({ component: {} as any, height: 1 });
		}
	};

	let i = 0;
	while (i < children.length) {
		const child = children[i];
		const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";

		// 1. User Message
		if (name === "UserMessageComponent") {
			ensureBreathingRoom();
			const rawLines = child.render(width - 4);
			const card = memoizeChildCard("user", [child], [rawLines], width, theme, [colors, user], () => {
				const boxed = frameCategoryBox(rawLines, `🐝 ${user}`, colors.userMessage, width, theme);
				return { lines: boxed, mouse: [{ component: child, height: boxed.length }] };
			});
			mouseChildren.push(...card.mouse);
			lines.push(...card.lines);
			i++;
			continue;
		}

		// 1b. Tool cards drawn by the Solvitu renderer (collapsed preview or expanded output) get their own category box.
		// Pi's own component keeps the clicks, so a click and ctrl+o both go through Pi's expanded flag.
		if (isSolviCardComponent(child)) {
			ensureBreathingRoom();
			const { title, tone } = solviCardFrame(child, colors);
			const rawLines = child.render(Math.max(1, width - 4));
			const card = memoizeChildCard("solvi-tool", [child], [rawLines], width, theme, [colors, title, tone], () => {
				const boxed = frameCategoryBox(rawLines, title, tone, width, theme);
				const finalLines = boxed.length ? boxed : rawLines;
				return { lines: finalLines, mouse: [{ component: child, height: finalLines.length }] };
			});
			mouseChildren.push(...card.mouse);
			lines.push(...card.lines);
			i++;
			continue;
		}

		// 2. Group consecutive bash executions into ONE single unified card
		if (isBashComponent(child)) {
			ensureBreathingRoom();
			const bashGroup: Component[] = [];
			const consumed: Component[] = [];
			const spacerMouse: CachedMouseEntry[] = [];
			while (i < children.length) {
				const curr = children[i];
				if (isBashComponent(curr)) {
					bashGroup.push(curr);
					consumed.push(curr);
					i++;
				} else if (isSpacer(curr) && i + 1 < children.length && isBashComponent(children[i + 1])) {
					spacerMouse.push({ component: curr, height: 0 });
					consumed.push(curr);
					i++;
				} else {
					break;
				}
			}

			const bashRaws = bashGroup.map((comp) => comp.render(width - 4));
			const card = memoizeChildCard("bash", consumed, bashRaws, width, theme, [colors], () => {
				const combinedLines: string[] = [];
				for (const raw of bashRaws) {
					const cleaned = cleanBashLines(raw);
					if (cleaned.length > 0) {
						if (combinedLines.length > 0) {
							combinedLines.push("");
						}
						const styled = formatBashOutputLines(cleaned, theme, colors.bashOutput);
						combinedLines.push(...styled);
					}
				}

				const cardLines = frameCategoryBox(
					combinedLines.length ? combinedLines : ["$"],
					">_ bash",
					colors.bashMessage,
					width,
					theme,
				);

				const mouse: CachedMouseEntry[] = [...spacerMouse];
				const avgHeight = Math.max(1, Math.floor(cardLines.length / bashGroup.length));
				for (let j = 0; j < bashGroup.length; j++) {
					const compHeight =
						j === bashGroup.length - 1
							? cardLines.length - avgHeight * (bashGroup.length - 1)
							: avgHeight;
					mouse.push({ component: bashGroup[j], height: compHeight });
				}
				return { lines: cardLines, mouse };
			});

			mouseChildren.push(...card.mouse);
			lines.push(...card.lines);
			continue;
		}

		if (isReviewComponent(child)) {
			ensureBreathingRoom();
			const rawLines = child.render(width - 4);
			const card = memoizeChildCard("review", [child], [rawLines], width, theme, [colors], () => {
				const unwrapped = unwrapNativeCard(rawLines);
				const title = extractReviewHeader(unwrapped, child);
				const styled = formatReviewOutputLines(unwrapped, theme);
				const boxed = frameCategoryBox(styled, title, colors.reviewMessage ?? "gentle", width, theme);
				return {
					lines: boxed,
					mouse: [{ component: new FramedCardMouseProxy(child, boxed.length), height: boxed.length }],
				};
			});
			mouseChildren.push(...card.mouse);
			lines.push(...card.lines);
			i++;
			continue;
		}

		// 4e. Group consecutive subagent poll / status / run calls into ONE single cyan card
		if (isSubagentComponent(child)) {
			ensureBreathingRoom();
			const agentGroup: Component[] = [];
			const consumed: Component[] = [];
			const spacerMouse: CachedMouseEntry[] = [];
			while (i < children.length) {
				const curr = children[i];
				if (isSubagentComponent(curr)) {
					agentGroup.push(curr);
					consumed.push(curr);
					i++;
				} else if (isSpacer(curr) && i + 1 < children.length && isSubagentComponent(children[i + 1])) {
					spacerMouse.push({ component: curr, height: 0 });
					consumed.push(curr);
					i++;
				} else {
					break;
				}
			}

			const allStatusPolls = agentGroup.every((c) => isAgentStatusComponent(c));
			const coalesced = allStatusPolls && agentGroup.length > 1;
			const agentRaws = coalesced
				? [agentGroup[agentGroup.length - 1].render(width)]
				: agentGroup.map((comp) => comp.render(width - 4));
			const card = memoizeChildCard(coalesced ? "subagent-polls" : "subagent", consumed, agentRaws, width, theme, [colors], () => {
				let combinedLines: string[] = [];
				if (coalesced) {
					const unwrapped = unwrapNativeCard(agentRaws[0]);
					const styled = formatSubagentLines(unwrapped, theme);
					const countHint = safeFg(theme, "muted", ` (${agentGroup.length} status polls coalesced)`, "muted");
					if (styled.length > 0) {
						styled[0] = `${styled[0]}${countHint}`;
					}
					combinedLines = styled;
				} else {
					for (const raw of agentRaws) {
						const unwrapped = unwrapNativeCard(raw);
						if (combinedLines.length > 0) {
							combinedLines.push("");
						}
						const styled = formatSubagentLines(unwrapped, theme);
						combinedLines.push(...styled);
					}
				}

				const cardLines = frameCategoryBox(
					combinedLines.length ? combinedLines : ["agent"],
					"🤖 subagent",
					colors.agentMessage ?? "accent",
					width,
					theme,
				);

				const mouse: CachedMouseEntry[] = [...spacerMouse];
				const avgHeight = Math.max(1, Math.floor(cardLines.length / agentGroup.length));
				for (let j = 0; j < agentGroup.length; j++) {
					const compHeight =
						j === agentGroup.length - 1
							? cardLines.length - avgHeight * (agentGroup.length - 1)
							: avgHeight;
					mouse.push({ component: new FramedCardMouseProxy(agentGroup[j], compHeight), height: compHeight });
				}
				return { lines: cardLines, mouse };
			});

			mouseChildren.push(...card.mouse);
			lines.push(...card.lines);
			continue;
		}

		// 5. Group consecutive top-level error Texts into ONE single coral card
		if (isErrorTextComponent(child)) {
			ensureBreathingRoom();
			const errorGroup: Component[] = [];
			const consumed: Component[] = [];
			const spacerMouse: CachedMouseEntry[] = [];
			while (i < children.length) {
				const curr = children[i];
				if (isErrorTextComponent(curr)) {
					errorGroup.push(curr);
					consumed.push(curr);
					i++;
				} else if (isSpacer(curr) && i + 1 < children.length && isErrorTextComponent(children[i + 1])) {
					spacerMouse.push({ component: curr, height: 0 });
					consumed.push(curr);
					i++;
				} else {
					break;
				}
			}

			const errorRaws = errorGroup.map((comp) => comp.render(width - 4));
			const card = memoizeChildCard("error", consumed, errorRaws, width, theme, [colors], () => {
				const combinedLines: string[] = [];
				for (const raw of errorRaws) {
					const unwrapped = unwrapNativeCard(raw);
					if (combinedLines.length > 0) {
						combinedLines.push("");
					}
					combinedLines.push(...unwrapped);
				}

				const cardLines = frameCategoryBox(
					combinedLines.length ? combinedLines : ["Error"],
					"\u26A0 error",
					colors.errorMessage,
					width,
					theme,
				);

				const mouse: CachedMouseEntry[] = [...spacerMouse];
				const avgHeight = Math.max(1, Math.floor(cardLines.length / errorGroup.length));
				for (let j = 0; j < errorGroup.length; j++) {
					const compHeight =
						j === errorGroup.length - 1
							? cardLines.length - avgHeight * (errorGroup.length - 1)
							: avgHeight;
					mouse.push({ component: errorGroup[j], height: compHeight });
				}
				return { lines: cardLines, mouse };
			});

			mouseChildren.push(...card.mouse);
			lines.push(...card.lines);
			continue;
		}

		// 7. Assistant prose and other components
		ensureBreathingRoom();
		const assistantTitle = `\u{1F916} ${strings.welcomePersona.name || "assistant"}`;
		const assistantTone = colors.assistantMessage ?? "gentle";
		let assistantKey: string | undefined;
		let hasThinking = false;
		if (name === "AssistantMessageComponent") {
			const content = (child as any).lastMessage?.content;
			if (Array.isArray(content)) {
				hideAssistantThinking(child);
				hasThinking = content.some((c: any) => c?.type === "thinking" && typeof c.thinking === "string" && c.thinking.trim().length > 0);
				const hasText = content.some((c: any) => c?.type === "text" && typeof c.text === "string" && c.text.trim().length > 0);
				if (hasThinking && !hasText) {
					const boxed = frameCategoryBox([safeFg(theme, "dim", "thinking", "muted")], "thinking", "dim", width, theme);
					mouseChildren.push({ component: child, height: boxed.length });
					lines.push(...boxed);
					i++;
					continue;
				}
			}
			// A finished message does not change between frames: reuse its card instead of rendering it again.
			const fingerprint = assistantFingerprint(child);
			if (fingerprint) {
				assistantKey = assistantCardKey(fingerprint, width, theme, assistantTitle, assistantTone);
				const hit = readAssistantCard(child, assistantKey);
				if (hit) {
					mouseChildren.push({ component: hit.proxy, height: hit.boxed.length });
					lines.push(...hit.boxed);
					i++;
					continue;
				}
			}
		}
		let rawLines = child.render(width);
		if (hasThinking) {
			rawLines = rawLines.filter((line) => {
				const t = stripAnsi(line).trim().toLowerCase();
				return t !== "thinking" && t !== "thinking...";
			});
		}
		if (name !== "AssistantMessageComponent") {
			const card = memoizeChildCard("generic", [child], [rawLines], width, theme, [colors], () => {
				if (isAsciiArtOrBanner(rawLines)) {
					return { lines: rawLines, mouse: [{ component: child, height: rawLines.length }] };
				}
				const transformed = transformTranscriptLines(unwrapNativeCard(rawLines), theme);
				return { lines: transformed, mouse: [{ component: child, height: transformed.length }] };
			});
			mouseChildren.push(...card.mouse);
			lines.push(...card.lines);
			i++;
			continue;
		}

		if (name === "AssistantMessageComponent") {
			const prose = trimBlankLines(formatAssistantProse(rawLines, theme, width));
			const boxed = frameCategoryBox(prose, assistantTitle, assistantTone, width, theme);
			const proxy = new PathLinkMouseProxy(prose);
			if (assistantKey) storeAssistantCard(child, assistantKey, { boxed, prose, proxy });
			mouseChildren.push({ component: proxy, height: boxed.length });
			lines.push(...boxed);
			i++;
			continue;
		}

		const transformed = transformTranscriptLines(unwrapNativeCard(rawLines), theme);
		mouseChildren.push({ component: child, height: transformed.length });
		lines.push(...transformed);
		i++;
	}

	return { lines, mouseChildren };
}

/**
 * Renders any generic tool call output cleanly inside a SOLVI category box.
 */
export function formatToolCallCard(
	rawLines: string[],
	toolName: string,
	theme?: Theme,
	width = 80,
): string[] {
	const unwrapped = unwrapNativeCard(rawLines);
	const colors = loadSolviColors();
	return frameCategoryBox(unwrapped, toolName, colors.readMessage, width, theme);
}

/**
 * Renders a file preview cleanly unwrapped and highlighted.
 */
export function formatFilePreview(
	rawLines: string[],
	filePath?: string,
	theme?: Theme,
): string[] {
	const unwrapped = unwrapNativeCard(rawLines);
	return formatReadLines(unwrapped, filePath, theme);
}
