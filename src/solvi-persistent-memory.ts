/**
 * pi-persistent-memory integration for SOLVI.
 * Facade module re-exporting client and card implementations from src/memory/.
 */

export {
	DEFAULT_PERSISTENT_MEMORY_URL,
	DEFAULT_PERSISTENT_MEMORY_DB_PATH,
	type PersistentMemoryStats,
	type RetainMemoryOptions,
	normalizeGitRemoteUrl,
	resolvePersistentMemoryScope,
	resolvePersistentMemoryDbCandidate,
	checkPersistentMemoryServerHealth,
	openPersistentMemoryExplorer,
	extractSessionTakeaways,
	queryPersistentMemoryStats,
	retainPersistentMemory,
	resetPersistentMemoryCache,
} from "./memory/memory-client.ts";

export {
	WorkspacePersistentMemoryCard,
} from "./memory/memory-card.ts";
