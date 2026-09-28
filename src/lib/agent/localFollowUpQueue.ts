import type { ImageContent, QueueMode } from './wire';

/** Follow-up trattenuto in Studio; le immagini restano associate al testo finche' non parte. */
export interface LocalFollowUp {
	id: number;
	text: string;
	images: ImageContent[];
}

export interface FollowUpDispatch {
	toSend: LocalFollowUp[];
	remaining: LocalFollowUp[];
}

/** L'identita' e' stabile anche quando due follow-up hanno lo stesso testo. */
export function enqueueFollowUp(queue: readonly LocalFollowUp[], entry: LocalFollowUp): LocalFollowUp[] {
	return [...queue, entry];
}

export function removeFollowUp(queue: readonly LocalFollowUp[], id: number): LocalFollowUp[] {
	return queue.filter((entry) => entry.id !== id);
}

export function takeLastFollowUp(queue: readonly LocalFollowUp[]): FollowUpDispatch {
	if (queue.length === 0) return { toSend: [], remaining: [] };
	return { toSend: [queue[queue.length - 1]], remaining: queue.slice(0, -1) };
}

/**
 * `all` invia tutti i follow-up dopo questo turno, mantenendo i confini tra
 * messaggi e immagini. Non concatenarli: unire prompt distinti cambierebbe
 * l'ordine del dialogo e il significato delle immagini associate.
 */
export function takeFollowUpsForTurn(
	queue: readonly LocalFollowUp[],
	mode: QueueMode,
	paused: boolean
): FollowUpDispatch {
	if (paused || queue.length === 0) return { toSend: [], remaining: [...queue] };
	const count = mode === 'all' ? queue.length : 1;
	return { toSend: queue.slice(0, count), remaining: queue.slice(count) };
}
