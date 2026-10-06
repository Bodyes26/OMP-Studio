/**
 * Caricamento di un'anteprima di prototipo, separato dal componente per
 * poterne verificare l'ordine delle operazioni.
 *
 * Il caricamento attraversa due chiamate asincrone (lettura del file e
 * pubblicazione sul server di anteprima). Se nel frattempo l'utente apre un
 * altro file o preme di nuovo «Ricarica», il caricamento vecchio e' superato:
 * non deve sovrascrivere lo stato a video ne' ripubblicare una chiave che la
 * pulizia del componente ha appena ritirato, altrimenti il server terrebbe in
 * vita un documento che nessuna scheda mostra piu'.
 */

export type PreviewLoadResult =
	| { kind: 'missing' }
	| { kind: 'svg'; content: string }
	| { kind: 'html'; content: string; url: string };

export interface PreviewLoadDeps {
	/** Chiave di pubblicazione di questo caricamento. */
	key: string;
	/** Vero finche' questo caricamento e' l'ultimo richiesto. */
	isCurrent: () => boolean;
	/** Chiave che il componente mostra adesso (puo' essere cambiata). */
	currentKey: () => string;
	readFile: () => Promise<{ content: string; exists: boolean }>;
	isSvg: (content: string) => boolean;
	publish: (key: string, content: string) => Promise<string>;
	unpublish: (key: string) => void;
}

/** Restituisce `null` quando il caricamento e' stato superato da uno piu' recente. */
export async function loadPreview(deps: PreviewLoadDeps): Promise<PreviewLoadResult | null> {
	const res = await deps.readFile();
	if (!deps.isCurrent()) return null;
	if (!res.exists) return { kind: 'missing' };
	if (deps.isSvg(res.content)) return { kind: 'svg', content: res.content };
	const url = await deps.publish(deps.key, res.content);
	if (!deps.isCurrent()) {
		// Stessa chiave: il caricamento piu' recente la ripubblichera' comunque.
		// Chiave diversa: il file non e' piu' a video e la pulizia l'ha gia'
		// ritirata prima che questa pubblicazione arrivasse.
		if (deps.currentKey() !== deps.key) deps.unpublish(deps.key);
		return null;
	}
	return { kind: 'html', content: res.content, url };
}
