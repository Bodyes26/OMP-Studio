// Tipi condivisi della corsia Laboratorio.
//
// Il prototipo vive in un workspace fuori dal repository del progetto
// (`<dati locali di Studio>/lab/prototypes/<id>`) con un git interno: ogni
// richiesta all'agente chiude un commit, che e' la revisione. Il progetto
// originale conserva solo l'indice `.omp/lab/prototypes.json`; le idee libere
// stanno nell'indice globale delle bozze. I percorsi li risolve sempre Rust.

export type LabPrototypeStatus = 'active' | 'closed';

export interface LabRevision {
	sha: string;
	message: string;
	/** ISO 8601. */
	date: string;
}

export interface LabIndexEntry {
	id: string;
	title: string;
	/** 2-3 righe su cosa fa il prototipo: e' cio' che permette al main di riconoscerlo. */
	summary: string;
	status: LabPrototypeStatus;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	/** Assoluto. Su un'altra macchina puo' non esistere: chi legge deve dirlo. */
	workspacePath: string;
	lastRevision: LabRevision | null;
	duplicatedFrom: string | null;
}

export interface LabIndexPatch {
	title?: string;
	summary?: string;
	status?: LabPrototypeStatus;
	lastRevision?: LabRevision | null;
}

export interface LabPaths {
	/** Radice dei dati del Laboratorio. */
	root: string;
	/** Indice globale delle bozze (idee libere senza progetto). */
	draftsIndex: string;
}

export interface LabFile {
	/** Relativo al workspace, sempre con `/`. */
	path: string;
	content: string;
}

export interface LabServedFile {
	/** Relativo alla radice pubblicata, sempre con `/` e senza `/` iniziale. */
	path: string;
	content: string;
	contentType: string;
}

/** Scritto dall'agente Lab con il tool `lab_set_summary` in `.lab/meta.json`. */
export interface LabMeta {
	title: string;
	summary: string;
	updatedAt: string;
}

export type LabPreviewErrorKind = 'compile' | 'runtime';

export interface LabPreviewError {
	kind: LabPreviewErrorKind;
	message: string;
	file?: string | null;
	line?: number | null;
	column?: number | null;
}

/**
 * Stato dell'anteprima scritto da Studio in `.lab/preview-status.json` a ogni
 * compilazione e a ogni errore di runtime. Lo legge il tool
 * `lab_preview_status` dell'estensione: `compiledAt` va confrontato con
 * l'ultima modifica dei sorgenti per sapere se lo stato e' gia' aggiornato.
 */
export interface LabPreviewStatus {
	/** URL dell'anteprima sul server loopback, `null` se non ancora pubblicata. */
	url: string | null;
	/** Epoch ms della compilazione a cui si riferisce lo stato. */
	compiledAt: number;
	/** Epoch ms dell'ultima modifica dei sorgenti compilati. */
	sourceStamp: number;
	ok: boolean;
	errors: LabPreviewError[];
}

/** Evento Tauri `lab://changed`, emesso dal watcher del workspace. */
export interface LabChangedEvent {
	key: string;
	paths: string[];
}

export const LAB_CHANGED_EVENT = 'lab://changed';
