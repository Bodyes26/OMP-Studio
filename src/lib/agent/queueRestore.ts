// Ripristino nell'editor dell'input in coda ritirato da omp.
//
// Da omp 18.4.4 la coda dei messaggi e' di omp: Studio non la tiene piu' in
// locale, la legge da `get_state` e dall'evento `queue_update`, e la modifica
// con `remove_queued_message`/`promote_queued_message`. Quando un contenuto
// esce dalla coda per volonta' dell'utente (Stop con `abort_and_restore_queue`,
// modifica di un chip) torna all'editor: qui vivono le decisioni pure su come
// ricomporlo, cosi' si provano senza DOM.

import type { ImageContent, RestoredQueuedMessage } from './wire';

/** Immagini dei messaggi ritirati, nell'ordine dei testi; vuoto senza immagini. */
export function restoredQueueImages(entries: readonly RestoredQueuedMessage[]): ImageContent[] {
	return entries.flatMap((entry) => entry.images ?? []);
}

/**
 * Testo da lasciare nella bozza. Come fa l'editor della TUI, il contenuto
 * ritirato si ripristina *accanto* a cio' che l'utente ha scritto nel
 * frattempo: prima la bozza, poi una riga vuota, poi il messaggio ritirato.
 * Con la bozza vuota resta solo il messaggio ritirato.
 */
export function restoreBesideDraft(draft: string, restored: string): string {
	if (!restored) return draft;
	if (!draft.trim()) return restored;
	return `${draft.replace(/\s+$/, '')}\n\n${restored}`;
}

/**
 * Testo con cui ricomporre i messaggi ritirati, dal piu' vecchio, separati da
 * una riga vuota: e' la forma che l'utente vede nell'editor della TUI.
 */
export function restoredQueueText(entries: readonly RestoredQueuedMessage[]): string {
	return entries
		.map((entry) => entry.text.trim())
		.filter((text) => text.length > 0)
		.join('\n\n');
}

/**
 * Coda come la mostra la tray: prima gli steer, poi i follow-up. Ogni voce e'
 * il testo opaco del chip, da rimandare a omp tale e quale.
 */
export function queueChips(queued: {
	steering: readonly string[];
	followUp: readonly string[];
}): { text: string; queue: 'steering' | 'followUp' }[] {
	return [
		...queued.steering.map((text) => ({ text, queue: 'steering' as const })),
		...queued.followUp.map((text) => ({ text, queue: 'followUp' as const }))
	];
}
