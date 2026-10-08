/**
 * Quale task programmato parte, e quale no (Gate R35).
 *
 * Modulo puro accanto a `scheduleTarget.ts`: lo usano gli effetti di avvio in
 * `+page.svelte` e i badge, senza runa ne' store, cosi' le regole restano
 * verificabili dagli smoke test.
 */

import type { StudioTask } from '../stores/taskSerialization.ts';
import type { ScheduleState } from './scheduleTarget.ts';

type QueueTask = Pick<StudioTask, 'id' | 'status' | 'position' | 'createdAt' | 'schedule' | 'resume'>;

function byQueueOrder(left: QueueTask, right: QueueTask): number {
	return left.position - right.position || left.createdAt - right.createdAt;
}

/**
 * Task per l'auto-avvio classico (Gate R12): il primo in coda senza
 * programmazione. Una voce di ripresa che aspetta il reset ferma l'auto-avvio
 * del progetto: deve tornare per prima nella sua sessione, e un task nuovo su
 * `Principale` partirebbe sulla stessa quota appena esaurita.
 */
export function nextAutoDispatchTask<T extends QueueTask>(
	tasks: readonly T[],
	excluded: ReadonlySet<string>
): T | null {
	if (tasks.some((task) => task.status === 'queued' && task.resume && task.schedule)) return null;
	return (
		[...tasks]
			.sort(byQueueOrder)
			.find((task) => task.status === 'queued' && !task.schedule && !excluded.has(task.id)) ?? null
	);
}

/**
 * Prossimo task programmato da avviare: dovuto, non in attesa di una
 * decisione nel banner, non escluso. Le voci di ripresa passano davanti,
 * poi vale l'ordine della coda.
 */
export function nextDueScheduledTask<T extends QueueTask>(
	tasks: readonly T[],
	stateOf: (task: T) => ScheduleState,
	excluded: ReadonlySet<string>
): T | null {
	const due = tasks.filter(
		(task) =>
			task.status === 'queued' &&
			task.schedule &&
			!task.schedule.missed &&
			!excluded.has(task.id) &&
			stateOf(task) === 'due'
	);
	due.sort((left, right) => {
		const resumeFirst = Number(Boolean(right.resume)) - Number(Boolean(left.resume));
		return resumeFirst || byQueueOrder(left, right);
	});
	return due[0] ?? null;
}

/**
 * Reset passati a Studio chiuso. Un task si giudica una volta sola per
 * avvio di Studio, la prima volta che il verdetto e' certo (`due` o
 * `waiting`): se a quel punto e' gia' dovuto e la programmazione e' piu'
 * vecchia di questo avvio, il momento e' passato mentre Studio era chiuso.
 * Va nel banner e non parte da solo (decisione di Maurizio). Un verdetto
 * `unknown` (usage non ancora letto) non conta: rimanda il giudizio.
 *
 * Restituisce gli id da marcare; aggiorna `seen` in place.
 */
export function detectMissedSchedules<T extends QueueTask>(
	tasks: readonly T[],
	stateOf: (task: T) => ScheduleState,
	seen: Set<string>,
	appStartedAt: number
): string[] {
	const missed: string[] = [];
	for (const task of tasks) {
		if (task.status !== 'queued' || !task.schedule || seen.has(task.id)) continue;
		const state = stateOf(task);
		if (state === 'unknown') continue;
		seen.add(task.id);
		if (state === 'due' && !task.schedule.missed && task.schedule.setAt < appStartedAt) {
			missed.push(task.id);
		}
	}
	return missed;
}

/** Task in coda fermi nel banner del reset perso. */
export function missedTasks<T extends QueueTask>(tasks: readonly T[]): T[] {
	return tasks.filter((task) => task.status === 'queued' && task.schedule?.missed === true);
}

/** Task che aspettano il loro momento (per i conteggi su chip e popover). */
export function waitingScheduled<T extends QueueTask>(
	tasks: readonly T[],
	stateOf: (task: T) => ScheduleState
): T[] {
	return tasks.filter(
		(task) => task.status === 'queued' && task.schedule && !task.schedule.missed && stateOf(task) !== 'due'
	);
}
