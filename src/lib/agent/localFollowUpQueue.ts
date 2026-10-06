import type { ImageContent } from './wire';

/** Follow-up trattenuto in Studio; le immagini restano associate al testo finche' non parte. */
export interface LocalFollowUp {
	id: number;
	text: string;
	images: ImageContent[];
}

/** L'identita' e' stabile anche quando due follow-up hanno lo stesso testo. */
export function enqueueFollowUp(queue: readonly LocalFollowUp[], entry: LocalFollowUp): LocalFollowUp[] {
	return [...queue, entry];
}

export function removeFollowUp(queue: readonly LocalFollowUp[], id: number): LocalFollowUp[] {
	return queue.filter((entry) => entry.id !== id);
}
