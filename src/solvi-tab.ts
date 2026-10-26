/**
 * Interactive YouTube Music Player Card for SOLVI Sidebar.
 * Facade module re-exporting from domain modules in src/youtube/ for backwards compatibility.
 */

export {
	YOUTUBE_PLAYER_SYMBOL,
	type ClickableHitbox,
	type YouTubeTrack,
	type YouTubePlayerState,
	cleanTitle,
	cleanArtist,
} from "./solvi-tab/solvi-tab-types.ts";

export {
	getCoverData,
	computeCoverColumns,
	type CoverData,
} from "./solvi-tab/solvi-tab-cover.ts";

export {
	WorkspaceSolviTabCard,
} from "./solvi-tab/solvi-tab-card.ts";
