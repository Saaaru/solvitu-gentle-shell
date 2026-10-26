// Pure replacement tables and patching function for the personal gentle-pi patches (bee glyph and
// the bee window beside the prompt). No file system access here, so tests can import it freely.

// Replacement text is written with 2-space indentation and converted to the tabs gentle-pi uses.
const t = (text) => text.replace(/^( {2})+/gm, (indent) => "\t".repeat(indent.length / 2));

/**
 * Apply `replacements` ([{ from, to }]) to `source`. A replacement whose `to` text is already
 * present is skipped, so running twice is a no-op. Throws "upstream <label> changed" when an
 * anchor is missing; the caller then writes nothing. EOL is detected (CRLF wins) and restored.
 */
export function patchSource(source, replacements, label) {
	const eol = source.includes("\r\n") ? "\r\n" : "\n";
	let text = source.replace(/\r\n/g, "\n");
	let changed = false;
	for (const { from, to } of replacements) {
		if (text.includes(to)) continue;
		const found = from instanceof RegExp ? from.test(text) : text.includes(from);
		if (!found) throw new Error(`upstream ${label} changed; review the patch before applying`);
		text = text.replace(from, () => to);
		changed = true;
	}
	return { source: changed ? text.replace(/\n/g, eol) : source, changed };
}

// ---- lib/shell-prompt.ts ----

// One-line braille bee (4 cells wide) from abejitas-mini.txt. The prompt measures the glyph with
// visibleWidth, so any width works. Frame B drops the top wing dots of the second cell (U+28DF -> U+28D6)
// to give a wing flap while the state tone keeps pulsing.
const BEE_IDLE = "⢔⣟⡦⠆";
const BEE_FLAP = "⢔⣖⡦⠆";

// The patterns also match the original flower and the previous emoji bee, so re-running upgrades either.
export const PETAL_REPLACEMENTS = [
	{ from: /export const PROMPT_PETAL = "[^"]*";/, to: `export const PROMPT_PETAL = "${BEE_IDLE}";` },
	{ from: /const PETAL_FRAMES = \[[^\]]*\] as const;/, to: `const PETAL_FRAMES = ["${BEE_IDLE}", "${BEE_FLAP}"] as const;` },
];

// Inserted right before `export interface PromptLayout`.
const BEE_BLOCK = t(String.raw`// Bee window (personal patch): a bordered 11x5 window to the left of the float prompt that shows an
// animated 3-line braille bee. Frames derive statelessly from the clock, so no state is needed.
export const BEE_WINDOW_WIDTH = 11;
export const BEE_WINDOW_ROWS = 5;
const BEE_MIN_WIDTH = 60;
const BEE_ART_WIDTH = BEE_WINDOW_WIDTH - 2;
const BEE_FRAME_MS = 200;

function beeArt(lines: string[], left: number): readonly string[] {
  return lines.map((line) => (" ".repeat(left) + line.replace(/⠀/g, " ")).padEnd(BEE_ART_WIDTH, " "));
}

const BEE_WINGS_UP = beeArt([" ⠰⡉⡱   ⡠", "⢰⡏⣿⢹⣶⢹⣯⣷⠄", " ⠙⠉⠋⠐⠉⠋"], 0);
const BEE_WINGS_DOWN = beeArt(["       ⡠", "⢰⡏⣿⢹⣶⢹⣯⣷⠄", " ⠙⠉⠋⠐⠉⠋"], 0);
const BEE_LOOK = beeArt(["⢎⡱⡵⢮⢎⡱", " ⢐⣛⣛⡂", "  ⠲⠖"], 1);
export const BEE_FRAMES: readonly (readonly string[])[] = [
  BEE_WINGS_UP, BEE_WINGS_DOWN, BEE_WINGS_UP, BEE_WINGS_DOWN, BEE_WINGS_UP, BEE_WINGS_DOWN, BEE_LOOK, BEE_LOOK,
];

export function beeFrameAt(now: number = Date.now()): readonly string[] {
  return BEE_FRAMES[Math.floor(now / BEE_FRAME_MS) % BEE_FRAMES.length];
}

/** Paint the window rows for this render onto the layout; row i of the output block uses beeCell(i). */
export function attachPromptBee(layout: PromptLayout, options: Pick<PromptFrameOptions, "state" | "tick" | "fg" | "borderColor">, now: number = Date.now()): void {
  if (!layout.beeWidth) return;
  const art = beeFrameAt(now).map((line) => options.fg(petalTone(options.state, options.tick), line));
  const inner = "─".repeat(BEE_ART_WIDTH);
  layout.beeCell = (row) => {
    if (row === 0) return options.borderColor("╭" + inner + "╮");
    if (row === BEE_WINDOW_ROWS - 1) return options.borderColor("╰" + inner + "╯");
    if (row > 0 && row < BEE_WINDOW_ROWS - 1) return options.borderColor("│") + art[row - 1] + options.borderColor("│");
    return " ".repeat(BEE_WINDOW_WIDTH);
  };
}

/** Pad a finished float block to the window height with blank rows that carry the window cell. */
export function padPromptBlock(rows: string[], layout: PromptLayout, borderColor: PromptFrameOptions["borderColor"]): string[] {
  if (!layout.beeWidth) return rows;
  const padded = rows.slice();
  while (padded.length < BEE_WINDOW_ROWS) padded.push(floatPromptRow("", layout, borderColor, padded.length));
  return padded;
}

`);

const PROMPT_LAYOUT_INTERFACE = t(`export interface PromptLayout {
  width: number;
  nativeWidth: number;
  prefixWidth: number;
  background: string;
}`);

const PROMPT_LAYOUT_INTERFACE_BEE = t(`export interface PromptLayout {
  width: number;
  nativeWidth: number;
  prefixWidth: number;
  background: string;
  /** Columns of the bee window (0 = not drawn). prefixWidth and nativeWidth already account for it plus a one column gap. */
  beeWidth: number;
  beeCell?: (row: number) => string;
}`);

const FLOAT_ROW_BEE = t(`export function floatPromptRow(line: string, layout: PromptLayout, borderColor: PromptFrameOptions["borderColor"], row = 0): string {
  const clipped = truncateToWidth(line, layout.nativeWidth, "");
  const content = borderColor("▎") + " " + clipped + " ".repeat(Math.max(0, layout.nativeWidth - visibleWidth(clipped))) + " ";
  const window = layout.beeWidth ? (layout.beeCell?.(row) ?? " ".repeat(layout.beeWidth)) + " " : "";
  return " " + window + layout.background + rearmPromptBackground(content, layout.background) + "\\x1b[49m ";
}
`);

const FLOAT_BRANCH_BEE = t(`  if (layout.background && lines.length >= 2) {
    attachPromptBee(layout, options);
    return [
      floatPromptRow(floatPromptHint(lines[0], lines[lines.length - 1], options, layout.nativeWidth).slice(2), layout, options.borderColor, 0),
      ...lines.slice(1, -1).map((line, index) => floatPromptRow(line, layout, options.borderColor, index + 1)),
      floatPromptRow("", layout, options.borderColor, lines.length - 1),
    ];
  }
`);

export const PROMPT_REPLACEMENTS = [
	...PETAL_REPLACEMENTS,
	{ from: PROMPT_LAYOUT_INTERFACE, to: BEE_BLOCK + PROMPT_LAYOUT_INTERFACE_BEE },
	{
		from: "return { width, nativeWidth: Math.max(1, width - (background ? 5 : 2)), prefixWidth: background ? 3 : 1, background };",
		to: t(`const bee = background && width >= BEE_MIN_WIDTH ? BEE_WINDOW_WIDTH : 0;
  const shift = bee ? bee + 1 : 0;
  return { width, nativeWidth: Math.max(1, width - (background ? 5 : 2) - shift), prefixWidth: (background ? 3 : 1) + shift, background, beeWidth: bee };`),
	},
	{
		from: /export function floatPromptRow\(line: string, layout: PromptLayout, borderColor: PromptFrameOptions\["borderColor"\]\): string \{\n[\s\S]*?\n\}\n/,
		to: FLOAT_ROW_BEE,
	},
	{ from: /\tif \(layout\.background && lines\.length >= 2\) \{\n\t\treturn \[\n[\s\S]*?\n\t\t\];\n\t\}\n/, to: FLOAT_BRANCH_BEE },
];

// ---- extensions/gentle-shell.ts ----

const IDLE_PULSE_METHODS = t(`

  // Idle animation (personal patch): the bee window derives its frame from the clock, so the editor
  // only needs periodic renders while idle. The 80 ms working pulse takes over while working.
  private syncIdlePulse(): void {
    this.stopIdlePulse();
    if (this.promptState === PROMPT_STATE.WORKING || this.animationPolicy === "potato") return;
    this.idlePulse = setInterval(() => this.deps.requestRender(), this.animationPolicy === "performance" ? 1000 : 200);
    this.idlePulse.unref();
  }

  private stopIdlePulse(): void {
    if (this.idlePulse) clearInterval(this.idlePulse);
    this.idlePulse = undefined;
  }`);

const STOP_PULSE = t(`private stopPulse(): void {
    if (this.pulse) clearInterval(this.pulse);
    this.pulse = undefined;
    this.tick = 0;
  }`);

export const GENTLE_SHELL_REPLACEMENTS = [
	{
		from: "framePromptLines, resolvePromptLayout,",
		to: "framePromptLines, padPromptBlock, resolvePromptLayout,",
	},
	{
		from: "private pulse: NodeJS.Timeout | undefined;",
		to: "private pulse: NodeJS.Timeout | undefined;\n\tprivate idlePulse: NodeJS.Timeout | undefined;",
	},
	{
		from: "this.keybindingsManager = keybindings;\n\t}",
		to: "this.keybindingsManager = keybindings;\n\t\tthis.syncIdlePulse();\n\t}",
	},
	{
		from: "if (this.promptState === PROMPT_STATE.WORKING) this.startPulse();\n\t\tthis.deps.requestRender();",
		to: "if (this.promptState === PROMPT_STATE.WORKING) this.startPulse();\n\t\tthis.syncIdlePulse();\n\t\tthis.deps.requestRender();",
	},
	{
		from: "this.promptState = working ? PROMPT_STATE.WORKING : PROMPT_STATE.IDLE;\n\t\tthis.stopPulse();",
		to: "this.promptState = working ? PROMPT_STATE.WORKING : PROMPT_STATE.IDLE;\n\t\tthis.stopPulse();\n\t\tthis.syncIdlePulse();",
	},
	{
		from: 'floatPromptRow(this.selectionEngine.decorateBottomRule("", layout.nativeWidth, ""), layout, (text) => this.borderColor(text))',
		to: 'floatPromptRow(this.selectionEngine.decorateBottomRule("", layout.nativeWidth, ""), layout, (text) => this.borderColor(text), framed.length - 1)',
	},
	{
		from: "framed.push(floatPromptRow(line, layout, (text) => this.borderColor(text)));",
		to: "framed.push(floatPromptRow(line, layout, (text) => this.borderColor(text), framed.length));",
	},
	{
		from: "\t\treturn framed;\n\t}\n\n\tdispose(): void {\n\t\tthis.stopPulse();\n",
		to: "\t\treturn padPromptBlock(framed, layout, (text) => this.borderColor(text));\n\t}\n\n\tdispose(): void {\n\t\tthis.stopPulse();\n\t\tthis.stopIdlePulse();\n",
	},
	{ from: STOP_PULSE, to: STOP_PULSE + IDLE_PULSE_METHODS },
];
