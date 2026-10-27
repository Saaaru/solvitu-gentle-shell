# Boxed tool cards — every tool inside a SOLVI frame

Branch: feat/boxed-tool-cards (from feat/spotify-solvi-player @ 66ab098 == main)

## Objective
Every tool call (built-in, MCP, unknown) renders inside a double-line bordered box
(`┌─ ✎ read target ─┐ … └─ 41 lines · ctrl+o to expand ─┘`) in the tool's category tone,
so tools are visually delimited from normal chat text. Collapsed boxes show only the
header line; the bottom border carries the line count and the expand hint. No background
fill. The full output is still formatted only when expanded.

## Specs
- S1: Every tool call renders inside a bordered box with visible delimiters.
  Verbatim: "casi toda la terminal es texto \"plano\" no separa lo que es una tools como mem_save o grep, comandos de ese tipo. Pero todo debería tener delimitantes." / "Todas las tools deben ir en cajitas"
- S2: The box header is `glyph + toolName + target` in the category tone, e.g. `✎ read package.json`.
  Verbatim: "debería ser una tool dentro de una caja que diga lapiz . read"
- S3: Collapsed box = header + bottom border with `{K} lines · {hint}` only; full output appears only on expand (ctrl+o).
  Verbatim: "y empaquete todo, expandible solo si lo quiero"
- S4: Failures keep `✗` + error tone; `subagent_*`/`gentle_review*` stay excluded; dispatcher pass-through (no double frame), expand mechanism and perf bounds (collapsed never formats, partial stays bounded) unchanged.

## Tasks
- [ ] T1 · S1-S3 · inline · Redesign `solviToolRenderer` in src/tool-card.ts: renderCall → top border; renderResult → framed rows + bottom border (collapsed = hint only, expanded = full formatted output, partial = bounded tail + streaming bottom). Commit: —
- [ ] T2 · S1-S4 · inline · Rewrite test/tool-card.test.ts to the boxed contract (2-line collapsed card, framed rows, exact widths, formatter only on expand, perf bounds, pass-through unchanged). Commit: —
- [ ] T3 · S1-S4 · inline · Full `npm test` suite green, commit work unit on feat/boxed-tool-cards, user visual check in the live TUI. Commit: —

## Design
- Top border (renderCall): `┌─ {glyph} {toolName} {target} ────┐`, border chars in the category tone
  (failed → error tone, `✗` glyph), target clipped ANSI-free before coloring (muted tone).
- Bottom border (renderResult): `└─ {label} ───┘` with label = `{K} lines · {hint}` when collapsed
  (muted), `streaming` while partial, plain when expanded or empty result.
- Body rows (expanded / partial): `│ {wrapped+padded row} │`, wrapTextWithAnsi at width-4,
  padded to exact width; formatters unchanged (bash/read/write/grep/generic).
- No second frame: dispatcher already passes SOLVI_CARD components through untouched
  (kept from uniform-tool-cards); boxes live only inside the renderer.
- Partial stays cheap: tail (3 collapsed / 40 expanded), never formatted.

## Deviations / notes
- Replaces the previous "indented, not boxed" decision from uniform-tool-cards.md: the
  double-frame risk that motivated it is gone (dispatcher pass-through is tested).
- Collapsed cards no longer preview 5 content lines (user decision: header only).
- The model in this session has no vision; the reference screenshots were described by
  the user in text and the box style follows the existing frameCategoryBox family.

## Evidence
- (pending)

## Log
- L1 (user, verbatim): "Quiero que veas estas imagenes y notes que casi toda la terminal es texto \"plano\" no separa lo que es una tools como mem_save o grep, comandos de ese tipo. Pero todo debería tener delimitantes. Por ejemplo ✎ read C:/Users/Dante/solvitu-gentle-shell/package.json [...] deberia ser una tool dentro de una caja que diga lapiz . read y empaquete todo, expandible solo si lo quiero [...] acá si se nota que la cajita tiene un constraste que diferencia una herramienta de bash (ls) del texto normal. Todas las tools deben ir en cajitas [...] como esa"
- L2 (user decision, 2026-10-26): box style = "Solo borde doble" (double-line border, no background fill); collapsed = "Solo cabecera (1 línea)" → `┌─ ✎ read package.json ─────┐` / `└─ 41 lines · ctrl+o to expand ─┘`.
- L3: Session model cannot view images; design based on the user's textual description and the repo's existing frameCategoryBox style.
