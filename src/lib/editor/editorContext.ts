import { projectStore, normalizeProjectPath } from '$lib/stores/projects.svelte';
import { getActiveEditorInfo } from '$lib/editor/monaco';

export interface EditorContextOptions {
	projectPath?: string;
}

/**
 * Ritorna il testo formattato del contesto dell'editor corrente per il progetto dato.
 * Include:
 * - Elenco dei file aperti (tabs)
 * - File attualmente attivo/in focus
 * - Selezione corrente o posizione del cursore (se presente)
 */
export function buildEditorContext(projectPath?: string): string | null {
	const activeProj = projectPath
		? projectStore.projects.find((p) => normalizeProjectPath(p.path).toLowerCase() === normalizeProjectPath(projectPath).toLowerCase())
		: projectStore.activeProject;

	if (!activeProj) return null;

	const openFiles = activeProj.openFiles || [];
	const activeFile = activeProj.activeFile;
	const editorInfo = getActiveEditorInfo();

	const hasOpenFiles = openFiles.length > 0;
	const hasActiveFile = Boolean(activeFile);
	const selection = editorInfo?.selection;
	const hasSelection = Boolean(selection && selection.selectionText && selection.selectionText.trim().length > 0);

	// Se non c'è nessun file aperto e nessun file attivo, non c'è contesto da aggiungere
	if (!hasOpenFiles && !hasActiveFile) {
		return null;
	}

	const sections: string[] = [];

	if (hasOpenFiles) {
		sections.push(`- Open files: ${openFiles.map((f) => `\`${f}\``).join(', ')}`);
	}

	if (hasActiveFile) {
		let activeDesc = `- Active file: \`${activeFile}\``;
		if (selection && selection.cursorLine) {
			activeDesc += ` (line ${selection.cursorLine}, col ${selection.cursorColumn})`;
		}
		sections.push(activeDesc);
	}

	if (hasSelection && selection) {
		const lines = selection.selectionText.split('\n');
		const lineRange =
			selection.startLine === selection.endLine
				? `line ${selection.startLine}`
				: `lines ${selection.startLine}-${selection.endLine}`;

		sections.push(`- Active selection in \`${activeFile}\` (${lineRange}):\n\`\`\`\n${selection.selectionText}\n\`\`\``);
	}

	if (sections.length === 0) return null;

	return `[Editor Context]\n${sections.join('\n')}`;
}

/**
 * Aggiunge il contesto dell'editor al messaggio inviato a omp.
 */
export function attachEditorContext(message: string, projectPath?: string): string {
	const trimmed = message.trim();
	const ctx = buildEditorContext(projectPath);
	if (!ctx) return trimmed;

	// Se il prompt dell'utente include già un blocco di contesto editor o comandi speciali, evitiamo duplicati
	if (trimmed.includes('[Editor Context]')) {
		return trimmed;
	}

	return `${trimmed}\n\n${ctx}`;
}
