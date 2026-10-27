import test from "node:test";
import assert from "node:assert/strict";
import { formatTranscriptChildren } from "../src/transcript/transcript-dispatcher.ts";

const mockTheme = {
	fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
} as any;

// Fakes that mirror the structure Pi's AssistantMessageComponent exposes (class names matter:
// the cache only trusts nodes it recognizes by constructor name).
class Spacer {
	lines = 1;
	render(_width: number): string[] {
		return [""];
	}
}

// Pi shares one markdown theme object between every Markdown node of a message.
const sharedMarkdownTheme = {};

class Markdown {
	paddingX = 1;
	paddingY = 0;
	theme = sharedMarkdownTheme;
	text: string;
	constructor(text: string) {
		this.text = text;
	}
	render(width: number): string[] {
		return this.text.split("\n").map((line) => `${line}`.slice(0, width));
	}
}

class MouseRegion {
	child: Markdown;
	constructor(child: Markdown) {
		this.child = child;
	}
	render(width: number): string[] {
		return this.child.render(width);
	}
}

class Container {
	children: any[] = [];
	render(width: number): string[] {
		return this.children.flatMap((child) => child.render(width));
	}
}

class AssistantMessageComponent {
	renders = 0;
	hideThinkingBlock = false;
	hiddenThinkingLabel = "Thinking...";
	outputPad = 1;
	markdownTheme = {};
	markdownTransformers = [() => 1];
	contentContainer = new Container();
	children: any[] = [this.contentContainer];
	constructor(text: string) {
		this.setText(text);
	}
	setText(text: string): void {
		this.contentContainer.children = [new Spacer(), new MouseRegion(new Markdown(text))];
	}
	get markdown(): Markdown {
		return (this.contentContainer.children[1] as MouseRegion).child;
	}
	render(width: number): string[] {
		this.renders++;
		return this.contentContainer.render(width);
	}
}

function plain(text: string): AssistantMessageComponent {
	return new AssistantMessageComponent(text);
}

test("assistant cache - an unchanged message is not rendered again on the next frame", () => {
	const message = plain("hello world");
	const first = formatTranscriptChildren([message as any], 60, mockTheme);
	const second = formatTranscriptChildren([message as any], 60, mockTheme);
	assert.equal(message.renders, 1);
	assert.deepEqual(second.lines, first.lines);
	assert.equal(second.mouseChildren.length, first.mouseChildren.length);
	assert.equal(second.mouseChildren[0].height, first.mouseChildren[0].height);
});

test("assistant cache - cached output is byte identical to a fresh render", () => {
	const message = plain("alpha\nbeta `code` and src/solvi-theme.ts");
	formatTranscriptChildren([message as any], 70, mockTheme);
	const cached = formatTranscriptChildren([message as any], 70, mockTheme);
	const fresh = formatTranscriptChildren([plain("alpha\nbeta `code` and src/solvi-theme.ts") as any], 70, mockTheme);
	assert.deepEqual(cached.lines, fresh.lines);
});

test("assistant cache - streaming text change renders again and shows the new text", () => {
	const message = plain("partial");
	const before = formatTranscriptChildren([message as any], 60, mockTheme);
	message.markdown.text = "partial answer that keeps growing";
	const after = formatTranscriptChildren([message as any], 60, mockTheme);
	assert.equal(message.renders, 2);
	assert.notDeepEqual(after.lines, before.lines);
	assert.ok(after.lines.join("\n").includes("keeps growing"));
});

test("assistant cache - a different width renders again", () => {
	const message = plain("same text");
	formatTranscriptChildren([message as any], 60, mockTheme);
	formatTranscriptChildren([message as any], 90, mockTheme);
	assert.equal(message.renders, 2);
});

test("assistant cache - a different theme renders again", () => {
	const message = plain("same text");
	formatTranscriptChildren([message as any], 60, mockTheme);
	formatTranscriptChildren([message as any], 60, { ...mockTheme });
	assert.equal(message.renders, 2);
});

test("assistant cache - toggling the hidden thinking block renders again", () => {
	const message = plain("same text");
	formatTranscriptChildren([message as any], 60, mockTheme);
	message.hideThinkingBlock = true;
	formatTranscriptChildren([message as any], 60, mockTheme);
	assert.equal(message.renders, 2);
});

test("assistant cache - replacing the content nodes (new Markdown with the same text) still serves from cache", () => {
	const message = plain("stable");
	formatTranscriptChildren([message as any], 60, mockTheme);
	message.setText("stable");
	formatTranscriptChildren([message as any], 60, mockTheme);
	assert.equal(message.renders, 1);
});

test("assistant cache - a message holding a node it does not recognize is never cached", () => {
	class Text {
		render(): string[] {
			return ["error: aborted"];
		}
	}
	const message = plain("with extra node");
	message.contentContainer.children.push(new Text());
	formatTranscriptChildren([message as any], 60, mockTheme);
	formatTranscriptChildren([message as any], 60, mockTheme);
	assert.equal(message.renders, 2);
});

test("assistant cache - messages without the known structure keep rendering every frame", () => {
	let renders = 0;
	class Bare {
		render(): string[] {
			renders++;
			return ["bare reply"];
		}
	}
	Object.defineProperty(Bare, "name", { value: "AssistantMessageComponent" });
	const bare = new Bare();
	formatTranscriptChildren([bare as any], 60, mockTheme);
	formatTranscriptChildren([bare as any], 60, mockTheme);
	assert.equal(renders, 2);
});

test("assistant cache - two different messages never share an entry", () => {
	const a = plain("first message");
	const b = plain("second message");
	const out = formatTranscriptChildren([a as any, b as any], 60, mockTheme);
	const again = formatTranscriptChildren([a as any, b as any], 60, mockTheme);
	assert.deepEqual(again.lines, out.lines);
	assert.ok(again.lines.join("\n").includes("first message"));
	assert.ok(again.lines.join("\n").includes("second message"));
	assert.equal(a.renders + b.renders, 2);
});

test("transcript detectors - a message is rendered once per pass and only at the real width", () => {
	const widths: number[] = [];
	class ProbeMessage {
		render(width: number): string[] {
			widths.push(width);
			return ["plain reply"];
		}
	}
	for (const name of ["AssistantMessageComponent", "UserMessageComponent"]) {
		widths.length = 0;
		const Probe = class extends ProbeMessage {};
		Object.defineProperty(Probe, "name", { value: name });
		formatTranscriptChildren([new Probe() as any], 89, mockTheme);
		assert.deepEqual(widths.length > 0 ? [...new Set(widths.map((w) => w <= 89 ? "ok" : "bad"))] : [], ["ok"], name);
		assert.equal(widths.length, 1, `${name} rendered ${widths.length} times: widths ${widths.join(",")}`);
	}
});

test("transcript detectors - a reply that starts like a tool header is not mistaken for a tool", () => {
	class AssistantMessageComponent {
		render(): string[] {
			return ["fetch the latest numbers and agent run summaries"];
		}
	}
	const { lines } = formatTranscriptChildren([new AssistantMessageComponent() as any], 80, mockTheme);
	assert.ok(lines.join("\n").includes("assistant") || lines.join("\n").includes("\u{1F916}"), "rendered inside the assistant card");
});
