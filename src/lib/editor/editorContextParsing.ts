export const EDITOR_CONTEXT_MARKER = '[Editor Context]';

export interface ParsedEditorCursor {
	line: number;
	column?: number;
}

export interface ParsedEditorSelection {
	file: string;
	lineRange: string;
	startLine?: number;
	text: string;
}

export interface ParsedEditorContext {
	openFiles: string[];
	activeFile: string | null;
	cursor?: ParsedEditorCursor;
	selection?: ParsedEditorSelection;
}

export interface SplitMessageContextResult {
	userMessage: string;
	context: ParsedEditorContext | null;
	rawContext: string | null;
}

/**
 * Formatta la sezione del contesto editor in markdown.
 */
export function formatEditorContext(
	openFiles: string[],
	activeFile: string | null,
	cursor?: ParsedEditorCursor,
	selection?: { text: string; startLine?: number; endLine?: number }
): string | null {
	const hasOpenFiles = openFiles.length > 0;
	const hasActiveFile = Boolean(activeFile);
	const hasSelection = Boolean(selection && selection.text && selection.text.trim().length > 0);

	if (!hasOpenFiles && !hasActiveFile) {
		return null;
	}

	const sections: string[] = [];

	if (hasOpenFiles) {
		sections.push(`- Open files: ${openFiles.map((f) => `\`${f}\``).join(', ')}`);
	}

	if (hasActiveFile) {
		let activeDesc = `- Active file: \`${activeFile}\``;
		if (cursor && cursor.line) {
			activeDesc += ` (line ${cursor.line}${cursor.column ? `, col ${cursor.column}` : ''})`;
		}
		sections.push(activeDesc);
	}

	if (hasSelection && selection && activeFile) {
		const lineRange =
			selection.startLine != null && selection.endLine != null
				? selection.startLine === selection.endLine
					? `line ${selection.startLine}`
					: `lines ${selection.startLine}-${selection.endLine}`
				: 'selected';

		sections.push(`- Active selection in \`${activeFile}\` (${lineRange}):\n\`\`\`\n${selection.text}\n\`\`\``);
	}

	if (sections.length === 0) return null;
	return `${EDITOR_CONTEXT_MARKER}\n${sections.join('\n')}`;
}

/**
 * Estrae e analizza la sezione [Editor Context] da una stringa raw.
 */
export function parseEditorContext(rawContext: string): ParsedEditorContext | null {
	const openFilesMatch = rawContext.match(/^-\s*Open files:\s*(.+)$/m);
	let openFiles: string[] = [];
	if (openFilesMatch) {
		const fileMatches = Array.from(openFilesMatch[1].matchAll(/`([^`]+)`/g));
		if (fileMatches.length > 0) {
			openFiles = fileMatches.map((m) => m[1].trim());
		} else {
			openFiles = openFilesMatch[1]
				.split(',')
				.map((s) => s.trim().replace(/^`|`$/g, ''))
				.filter(Boolean);
		}
	}

	const activeFileMatch = rawContext.match(
		/^-\s*Active file:\s*`([^`]+)`(?:\s*\(line\s*(\d+)(?:,\s*col\s*(\d+))?\))?/m
	);
	let activeFile: string | null = null;
	let cursor: ParsedEditorCursor | undefined = undefined;
	if (activeFileMatch) {
		activeFile = activeFileMatch[1].trim();
		if (activeFileMatch[2]) {
			cursor = {
				line: parseInt(activeFileMatch[2], 10),
				column: activeFileMatch[3] ? parseInt(activeFileMatch[3], 10) : undefined
			};
		}
	}

	let selection: ParsedEditorSelection | undefined = undefined;
	let selectionMatch = rawContext.match(
		/^-\s*Active selection in\s*`([^`]+)`\s*\(([^)]+)\):\s*(`{3,})[^\n]*\r?\n([\s\S]*?)\r?\n\3/m
	);
	if (!selectionMatch) {
		selectionMatch = rawContext.match(
			/^-\s*Active selection in\s*`([^`]+)`\s*\(([^)]+)\):\s*(`{3,})[^\n]*\r?\n([\s\S]*)$/m
		);
	}

	if (selectionMatch) {
		const file = selectionMatch[1].trim();
		const lineRange = selectionMatch[2].trim();
		const text = (selectionMatch[4] ?? '').trimEnd();
		const startLineMatch = lineRange.match(/lines?\s*(\d+)/i);
		const startLine = startLineMatch ? parseInt(startLineMatch[1], 10) : undefined;
		selection = { file, lineRange, startLine, text };
	}

	if (openFiles.length === 0 && !activeFile && !selection) {
		return null;
	}

	return { openFiles, activeFile, cursor, selection };
}

/**
 * Separa il messaggio dell'utente dalla sezione [Editor Context], restituendo
 * il testo pulito per la visualizzazione nella GUI e il contesto analizzato a parte.
 */
export function splitMessageAndEditorContext(content: string): SplitMessageContextResult {
	const idx = content.indexOf(EDITOR_CONTEXT_MARKER);
	if (idx === -1) {
		return { userMessage: content, context: null, rawContext: null };
	}
	const userMessage = content.slice(0, idx).trim();
	const rawContext = content.slice(idx).trim();
	const context = parseEditorContext(rawContext);
	return { userMessage, context, rawContext };
}

/**
 * Rimuove il blocco [Editor Context] da un testo (es. per anteprime in coda).
 */
export function stripEditorContext(content: string): string {
	const idx = content.indexOf(EDITOR_CONTEXT_MARKER);
	if (idx === -1) return content;
	return content.slice(0, idx).trim();
}
