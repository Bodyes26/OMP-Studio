/**
 * Decisione sull'allineamento di un file aperto tra memoria/editor e disco (EXT-011).
 * Funzione pura per test deterministici sia nel frontend che in ambiente Node/CI.
 */

export type FileReloadAction =
	| { action: 'ignore' }
	| { action: 'reload'; content: string }
	| { action: 'conflict'; diskContent: string }
	| { action: 'deleted' };

export interface DecideFileReloadParams {
	/** Contenuto attuale su disco (null se il file e' stato cancellato o non e' leggibile) */
	diskContent: string | null;
	/** Baseline: contenuto dell'ultimo caricamento o salvataggio */
	baselineContent: string;
	/** Contenuto attuale nell'editor (eventualmente modificato dall'utente) */
	currentContent: string;
}

/**
 * Valuta l'evento di modifica su disco per un file aperto nell'editor:
 * - Se il file su disco non esiste piu' -> 'deleted'
 * - Se il contenuto su disco e' uguale alla baseline -> 'ignore' (es. salvataggio di Studio stesso o touch)
 * - Se il file e' pulito nell'editor (currentContent === baselineContent) -> 'reload' (ricarica automatica)
 * - Se il file ha modifiche non salvate (currentContent !== baselineContent):
 *     - se il disco coincide gia' con l'editor -> 'reload' (allineamento silenzioso)
 *     - altrimenti -> 'conflict' (avviso non modale per scegliere quale versione tenere)
 */
export function decideFileReload(params: DecideFileReloadParams): FileReloadAction {
	const { diskContent, baselineContent, currentContent } = params;

	// File cancellato o inaccessibile sul filesystem
	if (diskContent === null) {
		return { action: 'deleted' };
	}

	// Il contenuto su disco non e' cambiato rispetto all'ultimo caricamento/salvataggio:
	// ignora (copre i salvataggi di Studio stesso o eventi spuri del filesystem)
	if (diskContent === baselineContent) {
		return { action: 'ignore' };
	}

	// Il file nell'editor non ha modifiche non salvate (pulito)
	const isClean = currentContent === baselineContent;
	if (isClean) {
		return { action: 'reload', content: diskContent };
	}

	// Il file ha modifiche non salvate (sporco):
	// Se il disco coincide gia' con le modifiche locali correnti, allinea senza conflitto
	if (diskContent === currentContent) {
		return { action: 'reload', content: diskContent };
	}

	// Conflitto: file sporco con versione su disco diversa sia dalla baseline che dalle modifiche locali
	return { action: 'conflict', diskContent };
}
