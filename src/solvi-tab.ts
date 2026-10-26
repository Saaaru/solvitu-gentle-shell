/**
 * Solvi sidebar tab (Spotify player). Facade re-exporting from src/solvi-tab/ modules.
 */

export {
	type ClickableHitbox,
	type YouTubeTrack,
	type YouTubePlayerState,
} from "./solvi-tab/solvi-tab-types.ts";

export {
	getCoverData,
	computeCoverColumns,
	type CoverData,
} from "./solvi-tab/solvi-tab-cover.ts";

export {
	WorkspaceSolviTabCard,
} from "./solvi-tab/solvi-tab-card.ts";
