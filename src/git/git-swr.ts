import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

/**
 * Stale-while-revalidate primitives for git data used by the sidebar.
 * The render path only ever reads memory; refreshes run through async `execFile`.
 */

export type GitRunner = (args: string[], cwd: string, timeoutMs: number) => Promise<string>;

/** Cheap fs walk: avoids spawning git outside any repository (fails like `git` would). */
function isInsideGitRepo(cwd: string): boolean {
	let dir = resolve(cwd);
	for (;;) {
		if (existsSync(join(dir, ".git"))) return true;
		const parent = dirname(dir);
		if (parent === dir) return false;
		dir = parent;
	}
}

const defaultRunner: GitRunner = (args, cwd, timeoutMs) =>
	new Promise((resolvePromise, reject) => {
		if (!isInsideGitRepo(cwd)) {
			reject(new Error("not a git repository"));
			return;
		}
		try {
			execFile(
				"git",
				args,
				{ cwd, encoding: "utf8", timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
				(error, stdout) => (error ? reject(error) : resolvePromise(stdout)),
			);
		} catch (error) {
			reject(error);
		}
	});

let runner: GitRunner = defaultRunner;

/** Runs git asynchronously. Rejects on non-zero exit, timeout or spawn failure. */
export function runGit(args: string[], cwd: string, timeoutMs: number): Promise<string> {
	return runner(args, cwd, timeoutMs);
}

/** Test seam: replace the git runner. Pass undefined to restore the real one. */
export function setGitRunner(next: GitRunner | undefined): void {
	runner = next ?? defaultRunner;
}

const renderListeners = new Set<() => void>();
const boundHosts = new WeakSet<object>();

/** Registers a callback invoked when background data changed. Returns an unsubscribe function. */
export function onGitDataChanged(listener: () => void): () => void {
	renderListeners.add(listener);
	return () => renderListeners.delete(listener);
}

/** Binds a TUI-like host once so background refreshes request a re-render. */
export function bindGitRenderHost(host: { requestRender: () => void } | undefined): void {
	if (!host || boundHosts.has(host)) return;
	boundHosts.add(host);
	onGitDataChanged(() => {
		try {
			host.requestRender();
		} catch {}
	});
}

function notifyChanged(): void {
	for (const listener of [...renderListeners]) {
		try {
			listener();
		} catch {}
	}
}

const stores = new Set<SwrStore<any>>();

/** Drops all cached git data across stores (cold start). Mainly for tests and cwd switches. */
export function clearAllGitCaches(): void {
	for (const store of stores) store.clear();
}

const inflight = new Set<Promise<unknown>>();

/** Resolves once every in-flight git refresh settled (used by tests). */
export async function awaitGitIdle(): Promise<void> {
	while (inflight.size > 0) {
		await Promise.allSettled([...inflight]);
	}
}

interface Entry<T> {
	value: T;
	readAt: number;
	pending?: Promise<void>;
}

export interface SwrStore<T> {
	/** Never spawns. Returns fresh/stale cached value or `empty(key)` on cold start. */
	get(key: string, ttlMs: number): T;
	/** Marks entries stale (values kept to avoid UI flicker) and discards in-flight results. */
	invalidate(): void;
	/** Drops every cached value (cold start again). */
	clear(): void;
}

const MAX_KEYS = 8;

export function createSwrStore<T>(options: {
	load: (key: string) => Promise<T>;
	empty: (key: string) => T;
	equals: (a: T, b: T) => boolean;
}): SwrStore<T> {
	const entries = new Map<string, Entry<T>>();
	let generation = 0;

	function refresh(key: string, entry: Entry<T> | undefined): void {
		if (entry?.pending) return;
		const gen = generation;
		const target: Entry<T> = entry ?? { value: options.empty(key), readAt: 0 };
		if (!entry) {
			entries.set(key, target);
			if (entries.size > MAX_KEYS) {
				const oldest = entries.keys().next().value;
				if (oldest !== undefined && oldest !== key) entries.delete(oldest);
			}
		}
		const task = options
			.load(key)
			.then((next) => {
				if (gen !== generation) return;
				const changed = !options.equals(target.value, next);
				target.value = next;
				target.readAt = Date.now();
				if (changed) notifyChanged();
			})
			.catch(() => {
				// Keep the last good value; back off until the next TTL expiry.
				if (gen === generation) target.readAt = Date.now();
			})
			.finally(() => {
				if (target.pending === task) target.pending = undefined;
				inflight.delete(task);
			});
		target.pending = task;
		inflight.add(task);
	}

	const store: SwrStore<T> = {
		get(key, ttlMs) {
			const entry = entries.get(key);
			if (!entry || Date.now() - entry.readAt >= ttlMs) refresh(key, entry);
			return (entries.get(key) ?? entry)?.value ?? options.empty(key);
		},
		invalidate() {
			generation++;
			for (const entry of entries.values()) {
				entry.readAt = 0;
				entry.pending = undefined;
			}
		},
		clear() {
			generation++;
			entries.clear();
		},
	};
	stores.add(store);
	return store;
}

export function deepEqual(a: unknown, b: unknown): boolean {
	return isDeepStrictEqual(a, b);
}
