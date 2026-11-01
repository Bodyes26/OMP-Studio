import type { AgentProgress, AgentToolResult } from '../wire';
import type { SessionJob } from '../jobActivity';
import type { ToolSummary } from './categories';
import { asRecord, bool, num, recordList, str } from './types';
import { m } from '#lib/paraglide/messages.js';

export interface WaitContext {
	subagents?: AgentProgress[];
	jobs?: SessionJob[];
}

export interface WaitActivity {
	id: string;
	kind: 'agent' | 'job';
	label: string;
	status: string;
	/** Solo i dati nativi collegano un'attivita alla wait; lo snapshot e' contesto. */
	observed: boolean;
	progress?: AgentProgress;
	activity?: string;
	durationMs?: number;
	exitCode?: number;
	error?: string;
	output?: string;
}

const ACTIVE: Record<string, true> = { running: true, pending: true, in_progress: true, starting: true };
const TERMINAL: Record<string, true> = { completed: true, failed: true, cancelled: true, aborted: true };

/** Unisce solo identita strutturate. Un agente e il suo job contano una volta sola. */
export function waitActivities(raw: unknown, context?: WaitContext): WaitActivity[] {
	const details = asRecord(raw);
	const items = new Map<string, WaitActivity>();
	const aliases = new Map<string, string>();
	for (const sub of context?.subagents ?? []) {
		if (!sub.id) continue;
		aliases.set(sub.id, sub.id);
		if (sub.jobId) aliases.set(sub.jobId, sub.id);
		items.set(sub.id, {
			id: sub.id, kind: 'agent', label: sub.agent ?? sub.id,
			status: sub.status ?? 'unknown', observed: false, progress: sub,
			activity: sub.lastIntent, durationMs: sub.durationMs
		});
	}
	for (const job of context?.jobs ?? []) {
		const key = aliases.get(job.id) ?? job.id;
		if (!items.has(key)) items.set(key, {
			id: job.id, kind: 'job', label: job.label, status: job.status, observed: false
		});
	}
	for (const job of recordList(details?.jobs)) {
		const id = str(job.id);
		if (!id) continue;
		const key = aliases.get(id) ?? id;
		const previous = items.get(key);
		const status = str(job.status) ?? previous?.status ?? 'unknown';
		const progress = previous?.progress;
		const agentStatus = ['running', 'completed', 'failed'].includes(status)
			? status as AgentProgress['status'] : status === 'cancelled' ? 'aborted' : progress?.status;
		items.set(key, {
			id: key, kind: previous?.kind ?? 'job',
			label: str(job.label) ?? previous?.label ?? id, status, observed: true,
			progress: progress ? { ...progress, status: agentStatus } : undefined,
			activity: str(job.stage) ?? previous?.activity,
			durationMs: num(job.durationMs) ?? previous?.durationMs,
			exitCode: num(job.exitCode),
			error: str(job.errorText) ?? str(job.artifactError), output: str(job.resultText)
		});
	}
	for (const agent of recordList(details?.agents)) {
		const id = str(agent.id);
		if (!id) continue;
		const key = aliases.get(id) ?? id;
		const previous = items.get(key);
		// `live: false` non prova un successo: un peer puo anche essere fallito o disconnesso.
		const status = previous && Object.hasOwn(TERMINAL, previous.status) ? previous.status
			: bool(agent.live) === true ? 'running'
			: bool(agent.live) === false ? 'unknown' : previous?.status ?? 'unknown';
		const activity = str(agent.activity) ?? previous?.activity;
		items.set(key, {
			...previous, id: key, kind: 'agent', label: previous?.label ?? id,
			status, observed: true, activity,
			progress: previous?.progress ? {
				...previous.progress,
				status: status === 'unknown' ? undefined : status as AgentProgress['status'],
				lastIntent: activity
			} : undefined
		});
	}
	return [...items.values()];
}

export function waitMessage(raw: unknown) {
	const message = asRecord(asRecord(raw)?.waited);
	const from = str(message?.from);
	return from ? { from, body: str(message?.body) } : undefined;
}

export interface DescribeWaitInput {
	args?: Record<string, unknown> | null;
	result?: AgentToolResult | null;
	running?: boolean;
	context?: WaitContext;
}

export function describeWait(input: DescribeWaitInput): ToolSummary {
	const details = asRecord(input.result?.details);
	const message = waitMessage(details);
	const items = waitActivities(details, input.context);
	const observed = items.filter((item) => item.observed);
	const running = observed.filter((item) => Object.hasOwn(ACTIVE, item.status));
	const settled = observed.filter((item) => Object.hasOwn(TERMINAL, item.status));
	const failed = observed.filter((item) => item.status === 'failed');
	let label: string;
	let detail: string | undefined;
	if (input.result?.isError) {
		label = m.tool_wait_status_error();
	} else if (message) {
		label = m.tool_wait_status_peer_message({ from: message.from });
		detail = message.body?.split('\n', 1)[0];
	} else if (details?.interrupted === true) {
		label = m.tool_wait_status_interrupted();
	} else if (!input.running) {
		label = settled.length > 0
			? m.tool_wait_status_settled({ count: settled.length }) : m.tool_wait_status_ended();
	} else if (running.length > 0 && running.length <= 2) {
		label = m.tool_wait_status_named({ names: running.map((item) => item.label).join(', ') });
	} else if (running.length > 0) {
		label = m.tool_wait_status_waiting_all();
	} else {
		label = m.tool_wait_status_no_jobs();
	}
	return {
		category: 'wait', label, detail,
		meta: failed.length > 0 ? m.tool_wait_failed_count({ count: failed.length })
			: running.length > 0 ? m.tool_wait_running_count({ count: running.length }) : undefined
	};
}
