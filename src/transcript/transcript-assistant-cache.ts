import type { Component } from "@earendil-works/pi-tui";

/**
 * Per-message cache for assistant cards. Pi re-renders the whole transcript on every frame, so a long
 * conversation repeats the same markdown render, prose styling and framing for messages that are already
 * finished. A message is reused only when a fingerprint of everything its output depends on is unchanged:
 * the text of every Markdown node, spacers, theme identity and the thinking-block flags. A message holding
 * any node this module does not recognize is never cached, so an unexpected shape costs speed, not correctness.
 */

export interface CachedAssistantCard {
	boxed: string[];
	prose: string[];
	proxy: Component;
}

interface Entry {
	key: string;
	card: CachedAssistantCard;
}

const KNOWN_NODES = new Set(["Container", "Spacer", "MouseRegion", "Markdown"]);

const entries = new WeakMap<object, Entry>();
const identities = new WeakMap<object, number>();
let nextIdentity = 1;

function identityOf(value: unknown): number {
	if (!value || (typeof value !== "object" && typeof value !== "function")) return 0;
	let id = identities.get(value as object);
	if (id === undefined) {
		id = nextIdentity++;
		identities.set(value as object, id);
	}
	return id;
}

function nodeName(node: unknown): string {
	return (node as { constructor?: { name?: string } } | undefined)?.constructor?.name ?? "";
}

/** Appends the render-relevant state of a node; returns false when the node is not recognized. */
function describeNode(node: any, parts: string[]): boolean {
	const name = nodeName(node);
	if (!KNOWN_NODES.has(name)) return false;
	switch (name) {
		case "Spacer":
			parts.push(`S${node.lines}`);
			return true;
		case "Markdown":
			if (typeof node.text !== "string") return false;
			parts.push(`M${node.paddingX},${node.paddingY},${identityOf(node.theme)}:${node.text.length}:${node.text}`);
			return true;
		case "MouseRegion":
			parts.push("R(");
			if (!describeNode(node.child, parts)) return false;
			parts.push(")");
			return true;
		default:
			if (!Array.isArray(node.children)) return false;
			parts.push("C(");
			for (const child of node.children) if (!describeNode(child, parts)) return false;
			parts.push(")");
			return true;
	}
}

/** Fingerprint of an assistant message, or undefined when its structure is not fully understood. */
export function assistantFingerprint(message: Component): string | undefined {
	const msg = message as any;
	if (!Array.isArray(msg?.children) || msg.children.length === 0) return undefined;
	const parts: string[] = [
		`h${msg.hideThinkingBlock}`,
		`l${msg.hiddenThinkingLabel}`,
		`p${msg.outputPad}`,
		`m${identityOf(msg.markdownTheme)}`,
		`t${Array.isArray(msg.markdownTransformers) ? msg.markdownTransformers.length : -1}`,
	];
	for (const child of msg.children) if (!describeNode(child, parts)) return undefined;
	return parts.join("\u0001");
}

/** Everything besides the message itself that shapes the card. */
export function assistantCardKey(fingerprint: string, width: number, theme: unknown, title: string, tone: string): string {
	return `${width}\u0002${identityOf(theme)}\u0002${title}\u0002${tone}\u0002${fingerprint}`;
}

export function readAssistantCard(message: Component, key: string): CachedAssistantCard | undefined {
	const entry = entries.get(message as object);
	return entry && entry.key === key ? entry.card : undefined;
}

export function storeAssistantCard(message: Component, key: string, card: CachedAssistantCard): void {
	entries.set(message as object, { key, card });
}
