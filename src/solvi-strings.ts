/**
 * Human-Readable Strings & Persona Configuration for solvitu.
 * Facade module re-exporting from domain modules in src/strings/ for backwards compatibility.
 */

export {
	type SolviStrings,
	type SolviPersonaMode,
	PERSONA_PRESETS,
	SOLVI_STRINGS_FILENAME,
} from "./strings/strings-types.ts";

export {
	detectSystemUser,
} from "./strings/strings-user.ts";

export {
	formatProfileDisplay,
	matchBracketProfile,
} from "./strings/strings-formatters.ts";

export {
	loadSolviStrings,
	resetSolviStringsCache,
} from "./strings/strings-loader.ts";
