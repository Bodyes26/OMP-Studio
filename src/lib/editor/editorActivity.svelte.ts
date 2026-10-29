/**
 * Registra e traccia i percorsi dei progetti (CWD) che contengono buffer Monaco
 * con modifiche umane non ancora salvate su disco.
 *
 * Utilizzato da Studio e dal coordinatore nativo delle automazioni per la
 * mutua esclusione e la proiezione delle CWD occupate (AUT-042).
 */

const dirtyProjectsMap = new Map<string, Set<string>>();

/**
 * Registra o rimuove lo stato di un file non salvato per un determinato progetto.
 */
export function registerEditorDirty(projectPath: string, filePath: string, isDirty: boolean): void {
	if (!projectPath || !filePath) return;
	let files = dirtyProjectsMap.get(projectPath);
	if (isDirty) {
		if (!files) {
			files = new Set<string>();
			dirtyProjectsMap.set(projectPath, files);
		}
		files.add(filePath);
	} else if (files) {
		files.delete(filePath);
		if (files.size === 0) {
			dirtyProjectsMap.delete(projectPath);
		}
	}
}

/**
 * Notifica la chiusura o cancellazione di un intero progetto.
 */
export function unregisterProjectDirty(projectPath: string): void {
	dirtyProjectsMap.delete(projectPath);
}

/**
 * Restituisce l'elenco dei percorsi di progetto (CWD) che hanno buffer non ancora salvati.
 * Esportato per il contesto parent e l'arbitro delle automazioni (AUT-042).
 */
export function getDirtyEditorPaths(): string[] {
	return Array.from(dirtyProjectsMap.keys());
}

/**
 * Restituisce i file non salvati per un determinato progetto.
 */
export function getDirtyFilesForProject(projectPath: string): string[] {
	const files = dirtyProjectsMap.get(projectPath);
	return files ? Array.from(files) : [];
}

/**
 * Ritorna true se il progetto ha modifiche non ancora salvate nell'editor.
 */
export function isProjectEditorDirty(projectPath: string): boolean {
	const files = dirtyProjectsMap.get(projectPath);
	return Boolean(files && files.size > 0);
}
