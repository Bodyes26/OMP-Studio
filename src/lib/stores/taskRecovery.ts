import type { StudioTask } from './taskSerialization';

/**
 * Task uscito dalla coda e non ancora comparso in sessione.
 *
 * Fra la spedizione (`completeDispatch`) e il primo segno di vita del
 * processo omp questo snapshot e' l'unica copia del prompt: la coda non lo
 * contiene piu' e nessun transcript lo contiene ancora.
 */
export interface InFlightTask {
	task: StudioTask;
	sessionId: string;
}

/**
 * Decide se un task in volo torna in coda dopo che omp ha perso il prompt.
 *
 * Il recupero vale solo in quella finestra: un prompt gia' arrivato in
 * sessione vive nel transcript ed e' ripristinabile dallo storico, quindi
 * rimetterlo in coda significherebbe far svolgere due volte lo stesso
 * lavoro. Era esattamente cio' che la Companion mostrava, un task concluso
 * che ricompariva in coda.
 */
export function resolveDroppedTask(
	inFlight: InFlightTask | undefined,
	sessionId: string | null | undefined,
	queuedTaskIds: ReadonlySet<string>,
	now = Date.now()
): StudioTask | null {
	if (!inFlight) return null;
	// Sessione diversa da quella che ha preso il task: il prompt perduto
	// appartiene a un altro turno e questo non c'entra.
	if (sessionId && inFlight.sessionId && sessionId !== inFlight.sessionId) return null;
	if (queuedTaskIds.has(inFlight.task.id)) return null;

	const prompt = inFlight.task.prompt ?? '';
	const hasImages = (inFlight.task.images?.length ?? 0) > 0;
	// Un task senza testo ne' immagini non e' lavoro: ricrearlo riempirebbe
	// la coda di righe vuote a ogni processo morto all'avvio.
	if (!prompt.trim() && !hasImages) return null;

	return {
		...inFlight.task,
		images: inFlight.task.images ? [...inFlight.task.images] : [],
		position: 0,
		updatedAt: now,
		status: 'queued'
	};
}
