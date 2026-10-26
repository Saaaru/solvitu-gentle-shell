export interface ClickableHitbox {
	line: number;
	startX: number;
	endX: number;
	action: () => void;
	/** Optional: receives the click column (e.g. a seek bar); takes precedence over `action`. */
	actionAt?: (localX: number) => void;
}

export interface YouTubeTrack {
	title?: string;
	artist?: string;
	duration?: string;
	index?: number;
	isCurrent?: boolean;
	thumbnailUrl?: string;
}

export interface YouTubePlayerState {
	status?: "playing" | "paused" | "disconnected" | string;
	platform?: "youtube" | "music" | string;
	title?: string;
	artist?: string;
	currentTime?: number;
	duration?: number;
	volume?: number;
	repeatMode?: "NONE" | "ALL" | "ONE" | string;
	shuffle?: boolean;
	isPip?: boolean;
	connectedClients?: number;
	queue?: YouTubeTrack[];
	thumbnailPath?: string;
	thumbnailBase64?: string;
}
