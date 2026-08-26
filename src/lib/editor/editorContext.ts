import { projectStore, normalizeProjectPath } from '$lib/stores/projects.svelte';
import { getActiveEditorInfo } from '$lib/editor/monaco';

export interface EditorContextOptions {
	projectPath?: string;
}

export {
	EDITOR_CONTEXT_MARKER,
	type ParsedEditorCursor,
	type ParsedEditorSelection,
	type ParsedEditorContext,
	type SplitMessageContextResult,
	formatEditorContext,
	parseEditorContext,
	splitMessageAndEditorContext,
	stripEditorContext
} from './editorContextParsing';

import {
	EDITOR_CONTEXT_MARKER,
	formatEditorContext
} from './editorContextParsing';

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

	const cursor = selection?.cursorLine
		? { line: selection.cursorLine, column: selection.cursorColumn }
		: undefined;

	const sel = hasSelection && selection && activeFile
		? { text: selection.selectionText, startLine: selection.startLine, endLine: selection.endLine }
		: undefined;

	return formatEditorContext(openFiles, activeFile, cursor, sel);
}

/**
 * Aggiunge il contesto dell'editor al messaggio inviato a omp.
 */
export function attachEditorContext(message: string, projectPath?: string): string {
	const trimmed = message.trim();
	const ctx = buildEditorContext(projectPath);
	if (!ctx) return trimmed;

	// Se il prompt dell'utente include già un blocco di contesto editor o comandi speciali, evitiamo duplicati
	if (trimmed.includes(EDITOR_CONTEXT_MARKER)) {
		return trimmed;
	}

	return `${trimmed}\n\n${ctx}`;
}
