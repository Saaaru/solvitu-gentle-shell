import test from "node:test";
import assert from "node:assert/strict";
import { findPathAt, PathLinkMouseProxy } from "../src/transcript/transcript-interactive.ts";
import { formatTranscriptChildren } from "../src/transcript/transcript-dispatcher.ts";

test("transcript interactive - findPathAt returns the path under the column", () => {
	const text = "Edité src/solvi-theme.ts:42 y luego C:\\Users\\mfuen\\notas.md";
	const first = text.indexOf("src/");
	assert.equal(findPathAt(text, first + 2), "src/solvi-theme.ts");
	assert.equal(findPathAt(text, first + 2), "src/solvi-theme.ts", "trailing :line is stripped");
	const win = text.indexOf("C:\\");
	assert.equal(findPathAt(text, win + 5), "C:\\Users\\mfuen\\notas.md");
});

test("transcript interactive - findPathAt ignores plain words and columns outside a path", () => {
	const text = "Hola, esto no es una ruta, e.g. ok";
	assert.equal(findPathAt(text, 3), undefined);
	assert.equal(findPathAt("a src/x.ts b", 0), undefined, "column before the path");
});

class AssistantMessageComponent {
	text: string;
	constructor(text: string) {
		this.text = text;
	}
	render(_width: number): string[] {
		return [this.text];
	}
}

test("transcript dispatcher - assistant answers render inside a card with the persona title", () => {
	const { lines } = formatTranscriptChildren([new AssistantMessageComponent("Mira src/solvi-theme.ts") as any], 60);
	assert.match(lines[0], /^┌─ \u{1F916} /u);
	assert.ok(lines.some((l) => l.includes("src/solvi-theme.ts")));
	assert.match(lines[lines.length - 1], /^└/);
});

test("path link proxy - building it does not scan the prose lines until a click needs them", () => {
	let reads = 0;
	const prose = new Proxy(["alpha line", "beta line"], {
		get(target, key, receiver) {
			if (typeof key === "string" && /^\d+$/.test(key)) reads++;
			return Reflect.get(target, key, receiver);
		},
	});
	const proxy = new PathLinkMouseProxy(prose as unknown as string[]);
	assert.equal(reads, 0, "constructor must not read the lines");
	assert.equal(proxy.handleMouse({ type: "move", x: 3, y: 1 }), undefined);
	assert.equal(reads, 0, "non-click events must not read the lines");
});

test("path link proxy - a click on a row without a path, or outside the card, is ignored", () => {
	const proxy = new PathLinkMouseProxy(["\x1b[31mplain words only\x1b[0m", "second row"]);
	assert.equal(proxy.handleMouse({ type: "click", x: 4, y: 1 }), undefined);
	assert.equal(proxy.handleMouse({ type: "click", x: 4, y: 0 }), undefined);
	assert.equal(proxy.handleMouse({ type: "click", x: 4, y: 99 }), undefined);
	assert.equal(proxy.handleMouse({ type: "click", x: 0, y: 1 }), undefined);
});
