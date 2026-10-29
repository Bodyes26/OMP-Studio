import type { AutomationOccurrence, ExecutionState } from './types.ts';

export function occurrenceUrgentState(run: AutomationOccurrence): ExecutionState {
	if (run.state === 'superseded') return 'superseded';
	for (const state of ['needsInput', 'unknown', 'error', 'timeout', 'running', 'waiting'] as const) {
		if (run.executions.some((execution) => execution.state === state)) return state;
	}
	return run.state;
}

export function occurrenceNeedsAttention(run: AutomationOccurrence): boolean {
	if (run.state === 'superseded') return false;
	const state = occurrenceUrgentState(run);
	if (run.requiresReview || state === 'needsInput') return true;
	return !run.acknowledged && (state === 'unknown' || state === 'error' || state === 'timeout' || state === 'skipped');
}

export function occurrenceActivity(run: AutomationOccurrence): 'attention' | 'running' | 'waiting' | 'idle' {
	if (occurrenceNeedsAttention(run)) return 'attention';
	if (run.state === 'running' || run.executions.some((execution) => execution.state === 'running')) return 'running';
	if (run.state === 'waiting' || run.executions.some((execution) => execution.state === 'waiting')) return 'waiting';
	return 'idle';
}
