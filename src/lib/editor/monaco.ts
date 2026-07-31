import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

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
	monaco.editor.defineTheme('omp-studio-dark', {
		base: 'vs-dark',
		inherit: true,
		rules: [
			{ background: '0C0C0C', token: '' },
		],
		colors: {
			'editor.background': '#0C0C0C',
			'editor.foreground': '#F5F5F5',
			'editor.lineHighlightBackground': '#131313',
			'editorLineNumber.foreground': '#909090',
			'editorLineNumber.activeForeground': '#B1B1B1',
			'editor.selectionBackground': '#2A2A2A',
			'editorIndentGuide.background': '#2C2C2C',
			'editorIndentGuide.activeBackground': '#484848',
		}
	});
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
			theme: 'omp-studio-dark',
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
			theme: 'omp-studio-dark',
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

export function getCurrentFileContent(absPath: string): string | null {
	const model = models.get(absPath);
	return model ? model.getValue() : null;
}
export function createDiffEditorInstance(container: HTMLElement, originalContent: string, modifiedContent: string, language: string) {
	const diffEditor = monaco.editor.createDiffEditor(container, {
		theme: 'omp-studio-dark',
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
