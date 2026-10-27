import { readGitBranch } from "../solvi-paths.ts";
import { createSwrStore, deepEqual, runGit } from "./git-swr.ts";

const KEY_SEP = "\u0000";

export interface GitStatusCounts {
	staged: number;
	modified: number;
	untracked: number;
	conflicts: number;
	linesAdded: number;
	linesDeleted: number;
	isClean: boolean;
}

export function parseGitNumstat(output: string): { linesAdded: number; linesDeleted: number } {
	let linesAdded = 0;
	let linesDeleted = 0;
	const lines = output
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter((l) => l.trim().length > 0);

	for (const line of lines) {
		const parts = line.split("\t");
		if (parts.length >= 2) {
			const a = parseInt(parts[0], 10);
			const d = parseInt(parts[1], 10);
			if (!isNaN(a)) linesAdded += a;
			if (!isNaN(d)) linesDeleted += d;
		}
	}
	return { linesAdded, linesDeleted };
}

export function parseGitStatusPorcelain(output: string): Omit<GitStatusCounts, "linesAdded" | "linesDeleted"> {
	let staged = 0;
	let modified = 0;
	let untracked = 0;
	let conflicts = 0;

	const lines = output
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter((l) => l.length >= 2);

	for (const line of lines) {
		const x = line[0];
		const y = line[1];

		if (x === "?" && y === "?") {
			untracked++;
			continue;
		}
		if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
			conflicts++;
			continue;
		}
		if (x !== " " && x !== "?") {
			staged++;
		}
		if (y !== " " && y !== "?") {
			modified++;
		}
	}

	const isClean = staged === 0 && modified === 0 && untracked === 0 && conflicts === 0;
	return { staged, modified, untracked, conflicts, isClean };
}

const EMPTY_STATUS: GitStatusCounts = {
	staged: 0,
	modified: 0,
	untracked: 0,
	conflicts: 0,
	linesAdded: 0,
	linesDeleted: 0,
	isClean: true,
};

const statusStore = createSwrStore<GitStatusCounts>({
	empty: () => EMPTY_STATUS,
	equals: deepEqual,
	load: async (cwd) => {
		const output = await runGit(["status", "--porcelain=v1"], cwd, 1500);
		let linesAdded = 0;
		let linesDeleted = 0;
		try {
			const numstat = parseGitNumstat(await runGit(["diff", "HEAD", "--numstat"], cwd, 1500));
			linesAdded = numstat.linesAdded;
			linesDeleted = numstat.linesDeleted;
		} catch {}
		return { ...parseGitStatusPorcelain(output), linesAdded, linesDeleted };
	},
});

/** Non-blocking: returns the cached (possibly stale) counts and refreshes in the background. */
export function fetchGitStatus(cwd: string, ttlMs = 4000): GitStatusCounts {
	return statusStore.get(cwd, ttlMs);
}

export function resetGitStatusCache(): void {
	statusStore.invalidate();
}

export interface GitFileChange {
	path: string;
	status: "modified" | "added" | "deleted" | "untracked" | "conflict";
	statusCode: string;
	linesAdded: number;
	linesDeleted: number;
}

const fileChangesStore = createSwrStore<GitFileChange[]>({
	empty: () => [],
	equals: deepEqual,
	load: async (cwd) => {
		const statusOut = await runGit(["status", "--porcelain=v1"], cwd, 1500);
		const numstatMap = new Map<string, { added: number; deleted: number }>();
		try {
			const numstatOut = await runGit(["diff", "HEAD", "--numstat"], cwd, 1500);
			for (const line of numstatOut.split("\n")) {
				const parts = line.trim().split("\t");
				if (parts.length >= 3) {
					const a = parseInt(parts[0], 10) || 0;
					const d = parseInt(parts[1], 10) || 0;
					const filePath = parts.slice(2).join("\t").trim();
					numstatMap.set(filePath, { added: a, deleted: d });
				}
			}
		} catch {}

		const files: GitFileChange[] = [];
		for (const line of statusOut.split("\n")) {
			if (line.length < 3) continue;
			const statusCode = line.slice(0, 2);
			const filePath = line.slice(3).trim();
			const x = statusCode[0];
			const y = statusCode[1];

			let status: GitFileChange["status"] = "modified";
			if (x === "?" && y === "?") status = "untracked";
			else if (x === "A" || y === "A") status = "added";
			else if (x === "D" || y === "D") status = "deleted";
			else if (x === "U" || y === "U") status = "conflict";

			const num = numstatMap.get(filePath) || { added: 0, deleted: 0 };
			files.push({
				path: filePath,
				statusCode: statusCode.trim(),
				status,
				linesAdded: num.added,
				linesDeleted: num.deleted,
			});
		}
		return files;
	},
});

export function resetGitFileChangesCache(): void {
	fileChangesStore.invalidate();
}

/** Non-blocking: returns the cached (possibly stale) list and refreshes in the background. */
export function fetchGitFileChanges(cwd: string, ttlMs = 2000): GitFileChange[] {
	return fileChangesStore.get(cwd, ttlMs);
}

const graphStore = createSwrStore<string[]>({
	empty: () => [],
	equals: deepEqual,
	load: async (key) => {
		const [cwd, max] = key.split(KEY_SEP);
		const output = await runGit(["log", "--graph", "--oneline", "--decorate", "-n", max], cwd, 2000);
		return output
			.replace(/\r\n/g, "\n")
			.split("\n")
			.filter((l) => l.trim().length > 0);
	},
});

/** Non-blocking: returns the cached (possibly stale) graph lines and refreshes in the background. */
export function fetchGitLogGraph(cwd: string, maxCommits = 20, ttlMs = 4000): string[] {
	return graphStore.get(`${cwd}${KEY_SEP}${maxCommits}`, ttlMs);
}

export function resetGitGraphCache(): void {
	graphStore.invalidate();
}

export function shortenRelativeTime(rel: string): string {
	return rel
		.replace(/ minutes? ago/, "m")
		.replace(/ hours? ago/, "h")
		.replace(/ days? ago/, "d")
		.replace(/ weeks? ago/, "w")
		.replace(/ months? ago/, "mo")
		.replace(/ seconds? ago/, "s");
}

export interface GitBranchItem {
	name: string;
	isCurrent: boolean;
	isRemote: boolean;
	tracking?: string;
	ahead?: number;
	behind?: number;
	gone?: boolean;
	relativeDate?: string;
}

const branchesStore = createSwrStore<GitBranchItem[]>({
	empty: (cwd) => [{ name: readGitBranch(cwd), isCurrent: true, isRemote: false }],
	equals: deepEqual,
	load: async (cwd) => {
		const out = await runGit(
			[
				"for-each-ref",
				"--sort=-committerdate",
				"--format=%(refname)%09%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:relative)",
				"refs/heads/",
				"refs/remotes/",
			],
			cwd,
			2000,
		);

		const currentBranch = readGitBranch(cwd);
		const localBranches: GitBranchItem[] = [];
		const remoteOnlyBranches: GitBranchItem[] = [];
		const localNames = new Set<string>();

		const lines = out.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
		for (const line of lines) {
			const parts = line.split("\t");
			if (parts.length < 2) continue;
			const fullRef = parts[0].trim();
			const shortRef = parts[1].trim();
			if (!shortRef || shortRef === "origin" || fullRef.endsWith("/HEAD") || shortRef.endsWith("/HEAD")) continue;

			const tracking = parts[2]?.trim() || undefined;
			const track = parts[3]?.trim() || "";
			const relDate = parts[4]?.trim() || "";

			let ahead: number | undefined;
			let behind: number | undefined;
			const aheadM = /ahead (\d+)/.exec(track);
			if (aheadM) ahead = parseInt(aheadM[1], 10);
			const behindM = /behind (\d+)/.exec(track);
			if (behindM) behind = parseInt(behindM[1], 10);
			const gone = track.includes("gone");

			const isRemote = fullRef.startsWith("refs/remotes/");
			if (!isRemote) {
				localNames.add(shortRef);
				localBranches.push({
					name: shortRef,
					isCurrent: shortRef === currentBranch,
					isRemote: false,
					tracking,
					ahead,
					behind,
					gone,
					relativeDate: shortenRelativeTime(relDate),
				});
			} else {
				const remoteShort = shortRef.replace(/^origin\//, "");
				if (!localNames.has(remoteShort) && !localNames.has(shortRef)) {
					remoteOnlyBranches.push({
						name: shortRef,
						isCurrent: false,
						isRemote: true,
						relativeDate: shortenRelativeTime(relDate),
					});
				}
			}
		}

		localBranches.sort((a, b) => {
			if (a.isCurrent) return -1;
			if (b.isCurrent) return 1;
			return 0;
		});

		return [...localBranches, ...remoteOnlyBranches];
	},
});

/** Non-blocking: returns the cached (possibly stale) branches and refreshes in the background. */
export function fetchGitBranches(cwd: string, ttlMs = 3000): GitBranchItem[] {
	return branchesStore.get(cwd, ttlMs);
}

export function resetGitBranchesCache(): void {
	branchesStore.invalidate();
}

/**
 * Returns a concise sync badge for the current Git branch (e.g. "▲1", "▼2", "▲1▼2" or "").
 * Reads cached branch information (async stale-while-revalidate); never spawns in the render path.
 */
export function getGitSyncBadge(cwd: string = process.cwd()): string {
	try {
		const branches = fetchGitBranches(cwd);
		const current = branches.find((b) => b.isCurrent);
		if (!current) return "";
		const parts: string[] = [];
		if (typeof current.ahead === "number" && current.ahead > 0) {
			parts.push(`▲${current.ahead}`);
		}
		if (typeof current.behind === "number" && current.behind > 0) {
			parts.push(`▼${current.behind}`);
		}
		return parts.join("");
	} catch {
		return "";
	}
}

export interface BranchDiffFile {
	path: string;
	status: "modified" | "added" | "deleted" | "renamed" | "unknown";
	statusCode: string;
	linesAdded: number;
	linesDeleted: number;
}

export interface BranchDiffSummary {
	branch: string;
	baseBranch: string;
	files: BranchDiffFile[];
	totalAdded: number;
	totalDeleted: number;
}

const branchDiffStore = createSwrStore<BranchDiffSummary>({
	empty: (key) => {
		const [, current, target] = key.split(KEY_SEP);
		return { branch: target, baseBranch: current, files: [], totalAdded: 0, totalDeleted: 0 };
	},
	equals: deepEqual,
	load: async (key) => {
		const [cwd, current, targetBranch] = key.split(KEY_SEP);
		let numstatOut = "";
		let isDirectDiff = false;
		try {
			numstatOut = await runGit(["diff", `HEAD...${targetBranch}`, "--numstat"], cwd, 2500);
		} catch {}

		if (!numstatOut.trim()) {
			try {
				numstatOut = await runGit(["diff", "HEAD", targetBranch, "--numstat"], cwd, 2500);
				isDirectDiff = true;
			} catch {}
		}

		let nameStatusOut = "";
		try {
			nameStatusOut = await runGit(
				isDirectDiff ? ["diff", "HEAD", targetBranch, "--name-status"] : ["diff", `HEAD...${targetBranch}`, "--name-status"],
				cwd,
				2500,
			);
		} catch {}

		const statusMap = new Map<string, string>();
		for (const line of nameStatusOut.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const parts = trimmed.split(/\s+/);
			if (parts.length >= 2) {
				statusMap.set(parts.slice(1).join(" "), parts[0]);
			}
		}

		let totalAdded = 0;
		let totalDeleted = 0;
		const files: BranchDiffFile[] = [];

		for (const line of numstatOut.split("\n")) {
			const parts = line.trim().split("\t");
			if (parts.length >= 3) {
				const a = parseInt(parts[0], 10) || 0;
				const d = parseInt(parts[1], 10) || 0;
				const filePath = parts.slice(2).join("\t").trim();
				totalAdded += a;
				totalDeleted += d;
				const code = statusMap.get(filePath) || "M";
				let status: BranchDiffFile["status"] = "modified";
				if (code.startsWith("A")) status = "added";
				else if (code.startsWith("D")) status = "deleted";
				else if (code.startsWith("R")) status = "renamed";

				files.push({
					path: filePath,
					status,
					statusCode: code,
					linesAdded: a,
					linesDeleted: d,
				});
			}
		}

		return { branch: targetBranch, baseBranch: current, files, totalAdded, totalDeleted };
	},
});

/** Non-blocking: returns the cached (possibly stale) diff and refreshes in the background. */
export function fetchBranchDiff(cwd: string, targetBranch: string, ttlMs = 3000): BranchDiffSummary {
	const current = readGitBranch(cwd);
	return branchDiffStore.get([cwd, current, targetBranch].join(KEY_SEP), ttlMs);
}

export function resetBranchDiffCache(): void {
	branchDiffStore.invalidate();
}
