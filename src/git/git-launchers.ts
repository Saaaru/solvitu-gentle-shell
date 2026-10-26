import * as cp from "node:child_process";
import * as path from "node:path";
import { detectTerminal } from "../solvi-tree.ts";
import { herdrAvailable, launchInHerdrTab, isTestEnvironment } from "../solvi-notify.ts";

/**
 * Launches an interactive diff for a specific file (against HEAD or targetBranch).
 */
export function launchFileDiff(filePath: string, targetBranch?: string | null, cwd?: string): boolean {
	if (isTestEnvironment()) return true;
	const workingDir = cwd || process.cwd();
	const baseName = path.basename(filePath);
	const targetDesc = targetBranch ? targetBranch : "HEAD";
	const title = `diff: ${baseName} (${targetDesc})`;
	const gitDiffTarget = targetBranch ? `HEAD...${targetBranch}` : "HEAD";
	const cmd = `git -c color.ui=always diff --color=always ${gitDiffTarget} -- "${filePath}" | less -R`;

	// 1. If running inside Herdr, open as a focused full-screen tab
	if (herdrAvailable()) {
		if (launchInHerdrTab(cmd, title, workingDir)) {
			return true;
		}
	}

	// 2. Fallback to external terminal
	try {
		const terminal = detectTerminal();
		const termBin = path.basename(terminal).toLowerCase();
		const termTitle = `Workspace Diff: ${baseName}`;

		let args: string[];
		switch (termBin) {
			case "foot":
				args = ["--app-id=solvi-diff", "-T", termTitle, "sh", "-c", cmd];
				break;
			case "alacritty":
				args = ["--class", "solvi-diff,solvi-diff", "-t", termTitle, "-e", "sh", "-c", cmd];
				break;
			case "kitty":
				args = ["--class=solvi-editor", "-T", termTitle, "sh", "-c", cmd];
				break;
			case "ghostty":
				args = ["--class=solvi-diff", "-e", "sh", "-c", cmd];
				break;
			default:
				args = ["-e", "sh", "-c", cmd];
				break;
		}

		const child = cp.spawn(terminal, args, {
			detached: true,
			stdio: "ignore",
			cwd: workingDir,
		});
		child.on("error", () => {});
		child.unref();
		return true;
	} catch {
		return false;
	}
}

export function launchGitDiff(branch: string, cwd?: string): boolean {
	if (isTestEnvironment()) return true;
	const workingDir = cwd || process.cwd();
	const title = `diff: ${branch}`;
	const cmd = `git -c color.ui=always diff --color=always HEAD...${branch} | less -R`;

	// 1. If running inside Herdr, open as a focused full-screen tab
	if (herdrAvailable()) {
		if (launchInHerdrTab(cmd, title, workingDir)) {
			return true;
		}
	}

	// 2. Fallback to external terminal
	try {
		const terminal = detectTerminal();
		const termBin = path.basename(terminal).toLowerCase();
		const termTitle = `Workspace Diff: HEAD...${branch}`;

		let args: string[];
		switch (termBin) {
			case "foot":
				args = ["--app-id=solvi-diff", "-T", termTitle, "sh", "-c", cmd];
				break;
			case "alacritty":
				args = ["--class", "solvi-diff,solvi-diff", "-t", termTitle, "-e", "sh", "-c", cmd];
				break;
			case "kitty":
				args = ["--class=solvi-editor", "-T", termTitle, "sh", "-c", cmd];
				break;
			case "ghostty":
				args = ["--class=solvi-diff", "-e", "sh", "-c", cmd];
				break;
			default:
				args = ["-e", "sh", "-c", cmd];
				break;
		}

		const child = cp.spawn(terminal, args, {
			detached: true,
			stdio: "ignore",
			cwd: workingDir,
		});
		child.on("error", () => {});
		child.unref();
		return true;
	} catch {
		return false;
	}
}
