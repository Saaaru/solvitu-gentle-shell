import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface SubagentTaskRecord {
	id: string;
	callId?: string;
	agent: string;
	label: string;
	task: string;
	mode: "task" | "background";
	status: "running" | "completed" | "failed" | "cancelled";
	startedAt: number;
	finishedAt?: number;
	resultSummary?: string;
	error?: string;
}

const SUMMARY_MAX = 120;

export function formatTaskDuration(ms: number): string {
	const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
	if (total < 60) return `${total}s`;
	const m = Math.floor(total / 60);
	const s = total % 60;
	if (m < 60) return `${m}m ${s}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatSubagentStatusTag(status: SubagentTaskRecord["status"], palette: any): string {
	switch (status) {
		case "running":
			return palette.mint("● RUNNING");
		case "completed":
			return `${palette.mint("✔")} ${palette.dim("DONE")}`;
		case "failed":
			return palette.coral("✖ FAIL");
		default:
			return palette.muted("⊘ CANCEL");
	}
}

export function extractTaskIdFromText(text: string): string | undefined {
	if (!text) return undefined;
	const m =
		/task[_\s-]?id["'`:=\s]+["'`]?([A-Za-z0-9][A-Za-z0-9_-]{3,})/i.exec(text) ||
		/Subagent\s+["'`]?([a-z0-9]{4,}-\d+-[a-z0-9]+)/i.exec(text) ||
		/\b([a-z0-9]{6,}-\d+-[a-z0-9]{3,})\b/.exec(text);
	return m?.[1];
}

function contentToString(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((p: any) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : ""))
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

function summarize(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1)}…` : flat;
}

function entryTime(entry: any, msg: any): number {
	for (const raw of [msg?.timestamp, entry?.timestamp]) {
		const t = typeof raw === "string" ? Date.parse(raw) : raw;
		if (typeof t === "number" && Number.isFinite(t)) return t;
	}
	return Date.now();
}

export function collectSessionSubagentTasks(ctx?: ExtensionContext | any): SubagentTaskRecord[] {
	let entries: any[] = [];
	try {
		entries = ctx?.sessionManager?.getBranch?.() ?? ctx?.sessionManager?.getEntries?.() ?? [];
	} catch {
		entries = [];
	}
	const records: SubagentTaskRecord[] = [];
	const byCall = new Map<string, SubagentTaskRecord>();
	const byId = new Map<string, SubagentTaskRecord>();

	const finish = (rec: SubagentTaskRecord, status: SubagentTaskRecord["status"], at: number, text: string) => {
		rec.status = status;
		rec.finishedAt = at;
		if (status === "failed") rec.error = summarize(text) || "error";
		else if (text) rec.resultSummary = summarize(text);
	};

	for (const entry of entries) {
		if (!entry) continue;
		const msg = entry.message ?? entry;
		const role = msg?.role;

		if (role === "assistant" && Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part?.type !== "toolCall") continue;
				const args = part.arguments ?? part.args ?? {};
				if (part.name === "subagent_run" || part.name === "subagent_continue") {
					const taskText = String(args.task ?? args.prompt ?? "");
					const rec: SubagentTaskRecord = {
						id: String(args.task_id ?? part.id ?? `call-${records.length + 1}`),
						callId: part.id,
						agent: String(args.agent ?? "subagent"),
						label: String(args.label ?? (taskText ? summarize(taskText).slice(0, 60) : args.agent ?? "subagent")),
						task: taskText,
						mode: args.mode === "background" ? "background" : "task",
						status: "running",
						startedAt: entryTime(entry, msg),
					};
					records.push(rec);
					if (part.id) byCall.set(part.id, rec);
					byId.set(rec.id, rec);
				} else if (part.name === "subagent_cancel") {
					const target = byId.get(String(args.task_id ?? ""));
					if (target) {
						target.status = "cancelled";
						target.finishedAt = entryTime(entry, msg);
					}
				}
			}
			continue;
		}

		if (role === "toolResult") {
			const text = contentToString(msg.content);
			const rec = byCall.get(msg.toolCallId);
			if (rec) {
				if (msg.isError) {
					finish(rec, "failed", entryTime(entry, msg), text);
					continue;
				}
				const taskId = msg.details?.gentleAgents?.taskId || msg.details?.taskId || extractTaskIdFromText(text);
				if (taskId && taskId !== rec.id) {
					byId.delete(rec.id);
					rec.id = String(taskId);
					byId.set(rec.id, rec);
				}
				if (
					rec.mode === "background" ||
					msg.details?.gentleAgents?.mode === "background" ||
					text.toLowerCase().includes("in the background")
				) {
					rec.mode = "background";
					rec.status = "running";
					rec.resultSummary = "En background…";
				} else {
					finish(rec, /cancel+ed/i.test(text) ? "cancelled" : "completed", entryTime(entry, msg), text);
				}
			} else if (msg.toolName === "subagent_status" || msg.toolName === "subagent_result") {
				const id = msg.details?.gentleAgents?.taskId || msg.details?.taskId || extractTaskIdFromText(text);
				const known = id ? byId.get(String(id)) : undefined;
				if (known) applyStatusText(known, text, entryTime(entry, msg), msg.details?.gentleAgents?.status || msg.details?.status, msg.isError, finish);
			}
			continue;
		}

		const customType = entry.customType ?? msg?.customType;
		const customText = contentToString(entry.content ?? msg?.content);
		if (
			entry.type === "custom_message" ||
			(typeof customType === "string" && customType.startsWith("gentle-agents")) ||
			customText.includes("Subagent ")
		) {
			const id = entry.details?.taskId || entry.details?.gentleAgents?.taskId || extractTaskIdFromText(customText);
			const known = id ? byId.get(String(id)) : undefined;
			if (known) applyStatusText(known, customText, entryTime(entry, msg), entry.details?.status, false, finish);
		}
	}
	return records;
}

function applyStatusText(
	rec: SubagentTaskRecord,
	text: string,
	at: number,
	explicit: string | undefined,
	isError: boolean | undefined,
	finish: (r: SubagentTaskRecord, s: SubagentTaskRecord["status"], at: number, text: string) => void,
): void {
	const lower = text.toLowerCase();
	const st = String(explicit ?? "").toLowerCase();
	if (st === "completed" || st === "failed" || st === "cancelled") return finish(rec, st, at, text);
	if (isError || /\bfailed\b|\berror\b/.test(lower)) return finish(rec, "failed", at, text);
	if (/cancel+ed/.test(lower)) return finish(rec, "cancelled", at, text);
	if (/\b(completed|finished|done)\b/.test(lower)) return finish(rec, "completed", at, text);
}

let diskCache: { key: string; at: number; tasks: SubagentTaskRecord[] } | undefined;
const DISK_CACHE_TTL_MS = 2000;

export function resetGentleAgentsTasksCache(): void {
	diskCache = undefined;
}

function candidateTaskDirs(): string[] {
	return [
		process.env.PI_CODING_AGENT_DIR ? path.join(process.env.PI_CODING_AGENT_DIR, "gentle-agents", "tasks") : "",
		path.join(os.homedir(), ".gentle-shell", "agent", "gentle-agents", "tasks"),
		path.join(os.homedir(), ".pi", "agent", "gentle-agents", "tasks"),
	].filter(Boolean);
}

function isInside(root: string, candidate: string): boolean {
	const rel = path.relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function loadGentleAgentsDiskTasks(
	parentSessionId?: string,
	limit = 10,
	customDir?: string,
	targetCwd?: string,
): SubagentTaskRecord[] {
	const key = JSON.stringify([parentSessionId, limit, customDir, targetCwd, process.env.PI_CODING_AGENT_DIR]);
	const now = Date.now();
	if (diskCache && diskCache.key === key && now - diskCache.at < DISK_CACHE_TTL_MS) return diskCache.tasks;

	const dirs = customDir ? [customDir] : candidateTaskDirs();
	const resolvedTarget = targetCwd ? path.resolve(targetCwd) : undefined;
	const seen = new Set<string>();
	const out: SubagentTaskRecord[] = [];

	for (const dir of dirs) {
		let files: string[] = [];
		try {
			files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
		} catch {
			continue;
		}
		for (const file of files) {
			try {
				const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
				const t = raw?.task ?? raw;
				if (!t || typeof t !== "object" || !t.id || seen.has(String(t.id))) continue;
				if (parentSessionId && t.parentSessionId !== parentSessionId) continue;
				if (resolvedTarget) {
					if (!t.cwd || !isInside(resolvedTarget, path.resolve(String(t.cwd)))) continue;
				}
				seen.add(String(t.id));
				const status: SubagentTaskRecord["status"] =
					t.status === "completed" || t.status === "failed" || t.status === "cancelled" ? t.status : "running";
				const startedAt = Number(t.startedAt ?? t.createdAt) || 0;
				const endedAt = Number(t.endedAt) || undefined;
				out.push({
					id: String(t.id),
					agent: String(t.agent ?? "subagent"),
					label: String(t.label ?? t.agent ?? "subagent"),
					task: String(t.prompt ?? t.task ?? ""),
					mode: t.mode === "background" ? "background" : "task",
					status,
					startedAt,
					finishedAt: status === "running" ? undefined : endedAt,
					resultSummary: status === "completed" && t.result ? summarize(String(t.result)) : undefined,
					error: t.error ? summarize(String(t.error)) : undefined,
				});
			} catch {}
		}
	}

	out.sort((a, b) => b.startedAt - a.startedAt);
	const tasks = out.slice(0, Math.max(0, limit));
	diskCache = { key, at: now, tasks };
	return tasks;
}
