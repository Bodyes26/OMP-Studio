import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { canvasColors, onThemeChange } from '$lib/theme';

export function initMonaco() {
	self.MonacoEnvironment = {
		getWorker: function (moduleId, label) {
			if (label === 'json') {
				return new JsonWorker();
			}
			if (label === 'css' || label === 'scss' || label === 'less') {
				return new CssWorker();
			}
			if (label === 'html' || label === 'handlebars' || label === 'razor') {
				return new HtmlWorker();
			}
			if (label === 'typescript' || label === 'javascript') {
				return new TsWorker();
			}
			return new EditorWorker();
		}
	};
	applyMonacoTheme();
	// Il tema cambia raramente: ridefinirlo e riapplicarlo e' piu' semplice
	// che tenere in vita due copie dei colori.
	onThemeChange(applyMonacoTheme);
}

function applyMonacoTheme() {
	const c = canvasColors();
	monaco.editor.defineTheme('omp-studio', {
		base: c.isLight ? 'vs' : 'vs-dark',
		inherit: true,
		rules: [
			{ background: c.bgSunken.slice(1), token: '' },
		],
		colors: {
			'editor.background': c.bgSunken,
			'editor.foreground': c.ink,
			'editor.lineHighlightBackground': c.bgBase,
			'editorLineNumber.foreground': c.inkFaint,
			'editorLineNumber.activeForeground': c.inkMuted,
			'editor.selectionBackground': c.bgHover,
			'editorIndentGuide.background': c.line,
			'editorIndentGuide.activeBackground': c.lineStrong,
		}
	});
	monaco.editor.setTheme('omp-studio');
}

let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;
// Stack letterale: Monaco misura i caratteri anche via canvas, dove
// `var(--font-mono)` non viene risolto.
const MONO_FONT = '"JetBrainsMono Nerd Font", "JetBrains Mono NF", "JetBrainsMonoNerdFont", "CaskaydiaCove Nerd Font", "CaskaydiaMono Nerd Font", "CaskaydiaCove NF", "Cascadia Code NF", "CascadiaMono NF", "Symbols Nerd Font Mono", "Symbols Nerd Font", "FiraCode Nerd Font", "MesloLGS NF", "Hack Nerd Font", "JetBrains Mono Variable", "JetBrains Mono", "Cascadia Code", "Cascadia Mono", Consolas, monospace';
const models = new Map<string, monaco.editor.ITextModel>();
/** Ultimo file richiesto: serve ad agganciare il modello se l'editor viene
 *  creato dopo `openFileModel` (host DOM non ancora montato). */
let activePath: string | null = null;

export function getEditorInstance(container: HTMLElement) {
	if (!editorInstance) {
		initMonaco();
		editorInstance = monaco.editor.create(container, {
			theme: 'omp-studio',
			fontFamily: MONO_FONT,
			fontSize: 14,
			lineHeight: 1.2,
			automaticLayout: true,
			minimap: { enabled: false },
			scrollbar: {
				verticalScrollbarSize: 10,
				horizontalScrollbarSize: 10
			},
			padding: { top: 12, bottom: 12 },
			wordWrap: 'on',
			cursorSmoothCaretAnimation: 'on',
			cursorBlinking: 'smooth',
			smoothScrolling: true,
			glyphMargin: true,
			lineNumbersMinChars: 3,
			folding: true
		});
		const pending = activePath ? models.get(activePath) : undefined;
		if (pending) editorInstance.setModel(pending);
	} else if (editorInstance.getContainerDomNode() !== container) {
		const currentModel = editorInstance.getModel();
		editorInstance.dispose();
		editorInstance = monaco.editor.create(container, {
			model: currentModel,
			theme: 'omp-studio',
			fontFamily: MONO_FONT,
			fontSize: 14,
			lineHeight: 1.2,
			automaticLayout: true,
			minimap: { enabled: false },
			scrollbar: {
				verticalScrollbarSize: 10,
				horizontalScrollbarSize: 10
			},
			padding: { top: 12, bottom: 12 },
			wordWrap: 'on',
			cursorSmoothCaretAnimation: 'on',
			cursorBlinking: 'smooth',
			smoothScrolling: true,
			glyphMargin: true,
			lineNumbersMinChars: 3,
			folding: true
		});
	}
	return editorInstance;
}

/** `absPath` e' il path assoluto del file: due progetti con lo stesso file
 *  relativo devono avere modelli e URI distinti. */
export function openFileModel(absPath: string, content: string, language?: string) {
	activePath = absPath;
	let model = models.get(absPath);
	if (!model) {
		model = monaco.editor.createModel(content, language, monaco.Uri.file(absPath));
		models.set(absPath, model);
	} else {
		model.setValue(content);
	}
	if (editorInstance) {
		editorInstance.setModel(model);
	}
}

export function revealLineInEditor(line: number) {
	if (!editorInstance || !editorInstance.getModel()) return false;
	editorInstance.revealLineInCenter(line);
	editorInstance.setPosition({ lineNumber: line, column: 1 });
	editorInstance.focus();
	return true;
}

export function getCurrentFileContent(absPath: string): string | null {
	const model = models.get(absPath);
	return model ? model.getValue() : null;
}
export function createDiffEditorInstance(container: HTMLElement, originalContent: string, modifiedContent: string, language: string) {
	const diffEditor = monaco.editor.createDiffEditor(container, {
		theme: 'omp-studio',
		fontFamily: MONO_FONT,
		fontSize: 14,
		lineHeight: 1.2,
		automaticLayout: true,
		readOnly: false,
		originalEditable: false,
		renderSideBySide: true,
		wordWrap: 'on',
		smoothScrolling: true
	});

	const originalModel = monaco.editor.createModel(originalContent, language);
	const modifiedModel = monaco.editor.createModel(modifiedContent, language);

	diffEditor.setModel({
		original: originalModel,
		modified: modifiedModel
	});

	return diffEditor;
}

export function updateGutterDecorations(
	editor: monaco.editor.IStandaloneCodeEditor,
	originalText: string | null,
	currentText: string,
	oldDecorationIds: string[] = []
): string[] {
	if (originalText === null) {
		return editor.deltaDecorations(oldDecorationIds, []);
	}

	const origLines = originalText.split(/\r?\n/);
	const currLines = currentText.split(/\r?\n/);
	const origSet = new Set(origLines);

	const newDecorations: monaco.editor.IModelDeltaDecoration[] = [];

	let i = 0, j = 0;
	while (i < origLines.length || j < currLines.length) {
		if (i < origLines.length && j < currLines.length && origLines[i] === currLines[j]) {
			i++;
			j++;
		} else if (j < currLines.length && (!origSet.has(currLines[j]) || i >= origLines.length)) {
			newDecorations.push({
				range: new monaco.Range(j + 1, 1, j + 1, 1),
				options: {
					isWholeLine: true,
					linesDecorationsClassName: 'git-gutter-added'
				}
			});
			j++;
		} else if (i < origLines.length && j < currLines.length && origLines[i] !== currLines[j]) {
			newDecorations.push({
				range: new monaco.Range(j + 1, 1, j + 1, 1),
				options: {
					isWholeLine: true,
					linesDecorationsClassName: 'git-gutter-modified'
				}
			});
			i++;
			j++;
		} else {
			if (j < currLines.length) {
				newDecorations.push({
					range: new monaco.Range(j + 1, 1, j + 1, 1),
					options: {
						isWholeLine: true,
						linesDecorationsClassName: 'git-gutter-deleted'
					}
				});
			}
			i++;
		}
	}

	return editor.deltaDecorations(oldDecorationIds, newDecorations);
}
