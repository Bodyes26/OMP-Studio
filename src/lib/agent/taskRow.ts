/**
 * taskRow.ts
 *
 * Modello dati neutro e adattatori puri per il nuovo linguaggio UI TaskRows
 * (fasi Todo, subagenti, job asincroni di background).
 * Nessuna dipendenza dal DOM o da RPC di backend.
 */

import type { TodoPhase, TodoItem, AgentProgress, TodoStatus } from './wire';

export type TaskRowStatus =
	| 'pending'
	| 'running'
	| 'completed'
	| 'failed'
	| 'blocked'
	| 'abandoned'
	| 'aborted';

export interface TaskRowDetailItem {
	id?: string;
	label: string;
	status?: TaskRowStatus;
	blocker?: string;
}

export interface TaskRowToolCall {
	tool?: string;
	args?: string;
	endMs?: number;
}

export interface TaskRowDetails {
	description?: string;
	items?: TaskRowDetailItem[];
	model?: string;
	tokens?: number;
	cost?: number;
	durationMs?: number;
	lastIntent?: string;
	recentTools?: TaskRowToolCall[];
	sessionFile?: string;
	terminalHint?: string;
	custom?: Record<string, unknown>;
}

export interface TaskRowModel {
	key: string;
	label: string;
	status: TaskRowStatus;
	ringNumber?: number | string;
	metric?: string;
	details?: TaskRowDetails;
	expandable: boolean;
	subtitle?: string;
}

export interface AsyncJobData {
	id: string;
	name?: string;
	status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'abandoned' | 'aborted' | string;
	summary?: string;
	error?: string;
	durationMs?: number;
	outputSnippet?: string;
}

/**
 * Mappa uno stato TodoItem a TaskRowStatus.
 */
export function mapTodoStatus(status?: TodoStatus | string): TaskRowStatus {
	switch (status) {
		case 'in_progress':
			return 'running';
		case 'completed':
			return 'completed';
		case 'blocked':
			return 'blocked';
		case 'abandoned':
			return 'abandoned';
		case 'pending':
		default:
			return 'pending';
	}
}

/**
 * Mappa uno stato AgentProgress a TaskRowStatus.
 */
export function mapAgentStatus(
	status?: 'pending' | 'running' | 'completed' | 'failed' | 'aborted' | string
): TaskRowStatus {
	switch (status) {
		case 'running':
			return 'running';
		case 'completed':
			return 'completed';
		case 'failed':
			return 'failed';
		case 'aborted':
			return 'aborted';
		case 'blocked':
			return 'blocked';
		case 'abandoned':
			return 'abandoned';
		case 'pending':
		default:
			return 'pending';
	}
}

/**
 * Risolve lo stato aggregato di una fase Todo secondo la precedenza contrattuale:
 * in_progress > blocked > pending > abandoned > completed.
 */
export function resolvePhaseStatus(
	tasks?: Array<{ status?: TodoStatus | string }> | null
): TaskRowStatus {
	if (!tasks || tasks.length === 0) return 'pending';

	if (tasks.some((t) => t.status === 'in_progress')) return 'running';
	if (tasks.some((t) => t.status === 'blocked')) return 'blocked';
	if (tasks.some((t) => t.status === 'pending')) return 'pending';
	if (tasks.some((t) => t.status === 'abandoned')) return 'abandoned';
	if (tasks.every((t) => t.status === 'completed')) return 'completed';

	return 'pending';
}

/**
 * Conteggia i task completati e il totale per una fase.
 * Importante: conta ESCLUSIVAMENTE i task 'completed' al numeratore.
 */
export function countPhaseCompleted(
	tasks?: Array<{ status?: TodoStatus | string }> | null
): { completed: number; total: number } {
	if (!tasks || tasks.length === 0) return { completed: 0, total: 0 };
	const completed = tasks.filter((t) => t.status === 'completed').length;
	return { completed, total: tasks.length };
}

/**
 * Formatta la metrica completed/total.
 */
export function formatPhaseMetric(completed: number, total: number): string {
	return `${completed}/${total}`;
}

/**
 * Formatta una quantita' di token in stringa compatta (es. 1.2k, 3.4M).
 */
export function formatTokensMetric(tokens?: number): string {
	if (tokens === undefined || tokens === null || isNaN(tokens) || tokens <= 0) return '0';
	if (tokens >= 1_000_000) {
		const val = tokens / 1_000_000;
		return `${val >= 10 ? Math.round(val) : val.toFixed(1)}M`;
	}
	if (tokens >= 1_000) {
		const val = tokens / 1_000;
		if (val >= 10) {
			const rounded = Math.round(val);
			if (rounded >= 1000) {
				return '1.0M';
			}
			return `${rounded}k`;
		}
		const formatted = val.toFixed(1);
		if (formatted === '10.0') return '10k';
		return `${formatted}k`;
	}
	const rounded = Math.round(tokens);
	if (rounded >= 1000) return '1.0k';
	return String(rounded);
}

/**
 * Verifica se lo stato appartiene a uno stato che richiede la visualizzazione del pill.
 * Pill solo per stati terminali (completed, failed, abandoned, aborted) e blocked.
 */
export function isPillStatus(status: TaskRowStatus): boolean {
	return (
		status === 'completed' ||
		status === 'failed' ||
		status === 'blocked' ||
		status === 'abandoned' ||
		status === 'aborted'
	);
}

/**
 * Adattatore puro per TodoPhase -> TaskRowModel.
 */
export function todoPhaseToTaskRow(phase: TodoPhase, index?: number): TaskRowModel {
	const tasks = phase.tasks ?? [];
	const status = resolvePhaseStatus(tasks);
	const { completed, total } = countPhaseCompleted(tasks);
	const hasTasks = tasks.length > 0;

	const phaseKey = phase.id ?? (index !== undefined ? `phase-${index}` : `phase-${phase.name || 'default'}`);

	const detailItems: TaskRowDetailItem[] = tasks.map((t: TodoItem, taskIdx: number) => ({
		id: t.id ?? `${phaseKey}-task-${taskIdx}`,
		label: t.content,
		status: mapTodoStatus(t.status),
		blocker: t.blocker
	}));

	return {
		key: phaseKey,
		label: phase.name || 'Todo',
		status,
		ringNumber: index !== undefined ? index + 1 : undefined,
		metric: hasTasks ? formatPhaseMetric(completed, total) : undefined,
		details: hasTasks ? { items: detailItems } : undefined,
		expandable: hasTasks
	};
}

/**
 * Adattatore puro per AgentProgress -> TaskRowModel.
 */
export function agentProgressToTaskRow(progress: AgentProgress, index?: number): TaskRowModel {
	const status = mapAgentStatus(progress.status);
	const key =
		progress.id ??
		(progress.index !== undefined ? `agent-${progress.index}` : `agent-${index ?? 'unknown'}`);
	const label = progress.id ?? progress.agent ?? 'subagent';
	const subtitle = progress.agent && progress.agent !== label ? progress.agent : undefined;

	let metric: string | undefined;
	if (progress.tokens !== undefined && progress.tokens > 0) {
		metric = formatTokensMetric(progress.tokens);
	} else if (progress.toolCount !== undefined && progress.toolCount > 0) {
		metric = `${progress.toolCount} tool`;
	}

	const hasDetails = Boolean(
		progress.description ||
			progress.task ||
			progress.assignment ||
			progress.lastIntent ||
			progress.resolvedModel ||
			progress.modelRole ||
			(progress.tokens !== undefined && progress.tokens > 0) ||
			(progress.cost !== undefined && progress.cost > 0) ||
			(progress.recentTools && progress.recentTools.length > 0) ||
			progress.sessionFile
	);

	const details: TaskRowDetails | undefined = hasDetails
		? {
				description: progress.description ?? progress.task ?? progress.assignment,
				lastIntent: progress.lastIntent,
				model: progress.resolvedModel ?? progress.modelRole,
				tokens: progress.tokens,
				cost: progress.cost,
				durationMs: progress.durationMs,
				recentTools: progress.recentTools,
				sessionFile: progress.sessionFile
			}
		: undefined;

	return {
		key,
		label,
		subtitle,
		status,
		ringNumber:
			progress.index !== undefined ? progress.index + 1 : index !== undefined ? index + 1 : undefined,
		metric,
		details,
		expandable: hasDetails
	};
}

/**
 * Adattatore per job asincroni di background.
 */
export function asyncJobToTaskRow(job: AsyncJobData, index?: number): TaskRowModel {
	let status: TaskRowStatus = 'pending';
	if (job.status === 'running') status = 'running';
	else if (job.status === 'completed') status = 'completed';
	else if (job.status === 'failed') status = 'failed';
	else if (job.status === 'cancelled' || job.status === 'abandoned') status = 'abandoned';
	else if (job.status === 'aborted') status = 'aborted';
	else if (job.status === 'blocked') status = 'blocked';

	const hasDetails = Boolean(job.summary || job.error || job.outputSnippet);

	return {
		key: job.id,
		label: job.name ?? job.id,
		status,
		ringNumber: index !== undefined ? index + 1 : undefined,
		details: hasDetails
			? {
					description: job.summary ?? job.error ?? job.outputSnippet,
					durationMs: job.durationMs
				}
			: undefined,
		expandable: hasDetails
	};
}

/**
 * Statistiche aggregate da una lista di TaskRowModel.
 */
export function aggregateTaskRowStats(rows: TaskRowModel[]) {
	let completed = 0;
	let running = 0;
	let failed = 0;
	let blocked = 0;
	let abandoned = 0;
	let aborted = 0;
	let pending = 0;

	for (const row of rows) {
		switch (row.status) {
			case 'completed':
				completed++;
				break;
			case 'running':
				running++;
				break;
			case 'failed':
				failed++;
				break;
			case 'blocked':
				blocked++;
				break;
			case 'abandoned':
				abandoned++;
				break;
			case 'aborted':
				aborted++;
				break;
			case 'pending':
			default:
				pending++;
				break;
		}
	}

	return {
		total: rows.length,
		completed,
		running,
		failed,
		blocked,
		abandoned,
		aborted,
		pending
	};
}
