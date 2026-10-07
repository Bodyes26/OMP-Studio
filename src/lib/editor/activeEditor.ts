// Modulo leggero per lo stato e le coordinate di selezione dell'editor attivo.
// Disaccoppia editorContext.ts da monaco.ts, evitando di trascinare i 4 MB di
// monaco-editor e i relativi web worker nel bundle iniziale dell'applicazione.
// Quando Monaco viene montato, registra qui il proprio provider live.

export interface EditorSelectionInfo {
	selectionText: string;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
	hasFocus: boolean;
	cursorLine: number;
	cursorColumn: number;
}

export interface ActiveEditorInfo {
	activePath: string | null;
	selection: EditorSelectionInfo | null;
}

let activeEditorProvider: (() => ActiveEditorInfo) | null = null;
let currentActiveEditorInfo: ActiveEditorInfo = {
	activePath: null,
	selection: null
};

/**
 * Registra la funzione fornitrice delle informazioni sull'editor attivo.
 * Chiamata da `monaco.ts` all'inizializzazione del modulo dell'editor.
 */
export function registerActiveEditorProvider(provider: () => ActiveEditorInfo): void {
	activeEditorProvider = provider;
}

/**
 * Aggiorna direttamente le informazioni memorizzate dell'editor attivo.
 */
export function setActiveEditorInfo(info: ActiveEditorInfo): void {
	currentActiveEditorInfo = info;
}

/**
 * Ritorna le informazioni correnti sull'editor attivo e la selezione.
 * Se un provider e' registrato (Monaco attivo), interroga direttamente il provider;
 * altrimenti restituisce lo snapshot memorizzato.
 */
export function getActiveEditorInfo(): ActiveEditorInfo {
	if (activeEditorProvider) {
		return activeEditorProvider();
	}
	return currentActiveEditorInfo;
}
