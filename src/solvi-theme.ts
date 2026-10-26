/**
 * Theme & Styling Engine for solvitu.
 * Facade module re-exporting from domain modules in src/theme/ for backwards compatibility.
 */

export {
	safeFg,
	frameFg,
	bolden,
	installSolviMarkdownThemeHook,
	cursorStyle,
	solviPalette,
	stripAnsi,
	type SolviPalette,
} from "./theme/theme-color.ts";

export {
	type SolviFrameStyle,
	type SolviGlyphs,
	type SolviPetalPreset,
	PETAL_PRESETS,
	solviGlyphs,
	resetSolviGlyphsCache,
} from "./theme/theme-glyphs.ts";

export {
	type SolviCardTone,
	unifySidebarCardFrame,
	formatGentleAiCardLine,
	transformTranscriptLines,
	unifyCardFrame,
} from "./theme/theme-adapter.ts";

export {
	installWelcomeHeaderGuard,
} from "./theme/theme-header-guard.ts";
