//! Modulo puro per la gestione del documento dell'editor chat v2 (C19).
//! Gestisce i segmenti di testo e badge (@file, /comando e, nel companion,
//! #progetto e !ruolo), la serializzazione verso il protocollo wire, il parsing
//! da testo semplice (set_editor_text e bozze) e la creazione dei badge DOM.

import { formatFileMention, findFileMentions } from './fileMentionSyntax.ts';

export type ComposerSegment =
	| { t: 'text'; s: string }
	| { t: 'file'; path: string }
	| { t: 'cmd'; name: string }
	| { t: 'project'; name: string; label?: string; hue?: number }
	| { t: 'role'; value: string; label?: string; hue?: number };

export const NBSP = '\u00A0';

/** Caratteri che aprono una palette: `@` file e `/` comandi ovunque; `#`
 *  progetto e `!` ruolo/modello solo dove l'editor li abilita (companion). */
export type ComposerTriggerKind = '@' | '/' | '#' | '!';

export interface ComposerTrigger {
	kind: ComposerTriggerKind;
	query: string;
	node: Text;
	start: number;
	caretRect: { left: number; top: number };
}

/**
 * Serializza l'albero DOM di contenteditable in un array compatto di segmenti.
 */
export function serializeEditorDom(ed: HTMLElement): ComposerSegment[] {
	const out: ComposerSegment[] = [];

	const appendText = (str: string) => {
		if (!str) return;
		const last = out[out.length - 1];
		if (last && last.t === 'text') {
			last.s += str;
		} else {
			out.push({ t: 'text', s: str });
		}
	};

	const walk = (node: Node) => {
		for (const child of Array.from(node.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE) {
				const raw = child.textContent ?? '';
				appendText(raw.replaceAll(NBSP, ' '));
			} else if (child instanceof HTMLElement) {
				const kind = child.dataset.kind;
				if (kind === 'file') {
					const path = child.dataset.value ?? '';
					out.push({ t: 'file', path });
				} else if (kind === 'cmd') {
					const name = child.dataset.value ?? '';
					out.push({ t: 'cmd', name });
				} else if (kind === 'project' || kind === 'role') {
					const value = child.dataset.value ?? '';
					const label = child.dataset.label;
					const hue = child.dataset.hue ? Number(child.dataset.hue) : undefined;
					out.push(
						kind === 'project'
							? { t: 'project', name: value, ...(label ? { label } : {}), ...(hue !== undefined ? { hue } : {}) }
							: { t: 'role', value, ...(label ? { label } : {}), ...(hue !== undefined ? { hue } : {}) }
					);
				} else if (child.tagName === 'BR') {
					appendText('\n');
				} else if (child.tagName === 'DIV' || child.tagName === 'P') {
					if (out.length > 0) {
						appendText('\n');
					}
					walk(child);
				} else {
					walk(child);
				}
			}
		}
	};

	walk(ed);

	// Pulizia spazi esterni
	const first = out[0];
	const last = out[out.length - 1];
	if (first && first.t === 'text') {
		first.s = first.s.trimStart();
	}
	if (last && last.t === 'text') {
		last.s = last.s.trimEnd();
	}

	return out.filter((seg) => seg.t !== 'text' || seg.s.length > 0);
}

/**
 * Converte i segmenti dell'editor in testo wire per omp:
 * - `@file` formattato con formatFileMention (virgolette con spazi: @"path con spazi")
 * - `/comando` normale -> `/name`
 * - `/skill` -> `/skill:name`
 */
export function segmentsToWireText(
	segs: ComposerSegment[],
	isSkill?: (name: string) => boolean
): string {
	let result = '';

	for (let i = 0; i < segs.length; i++) {
		const seg = segs[i];
		const prev = segs[i - 1];

		if (seg.t === 'text') {
			result += seg.s;
		} else if (seg.t === 'file') {
			const formatted = formatFileMention(seg.path);
			// Se il segmento precedente era un file o un comando, o se il testo precedente
			// non termina con spazio, assicuriamo la spaziatura per il parser wire.
			if (prev && (prev.t === 'file' || prev.t === 'cmd')) {
				if (!result.endsWith(' ') && !result.endsWith('\n')) {
					result += ' ';
				}
			} else if (result.length > 0 && !/\s$/.test(result)) {
				result += ' ';
			}
			result += formatted;
		} else if (seg.t === 'cmd') {
			const clean = seg.name.replace(/^skill:/, '');
			const isSkillCmd = seg.name.startsWith('skill:') || (isSkill ? isSkill(clean) : false);
			const cmdWire = isSkillCmd ? `/skill:${clean}` : `/${clean}`;
			if (result.length > 0 && !/\s$/.test(result)) {
				result += ' ';
			}
			result += cmdWire;
		} else {
			// #progetto e !ruolo: la sintassi che il parser del companion
			// (quickTaskLocal) riconosce nel testo semplice.
			if (result.length > 0 && !/\s$/.test(result)) {
				result += ' ';
			}
			result += seg.t === 'project' ? `#${seg.name}` : `!${seg.value}`;
		}
	}

	return result;
}

/**
 * Analizza testo semplice (es. da `set_editor_text` o bozza salvata) ricostruendo i segmenti:
 * - Comando slash iniziale (/cmd o /skill:name)
 * - Menzioni file (@percorso o @"percorso con spazi")
 * - Testo circostante
 */
export function parsePlainTextToSegments(
	text: string,
	isSkillName?: (name: string) => boolean
): ComposerSegment[] {
	if (!text) return [];

	const segs: ComposerSegment[] = [];

	// 1. Controlla se il testo inizia con un comando slash
	const slashMatch = text.match(/^[\s\u00A0]*\/([a-zA-Z0-9_:-]+)/);
	let remainingText = text;

	if (slashMatch) {
		const rawCmd = slashMatch[1];
		const isSkill = rawCmd.startsWith('skill:') || (isSkillName ? isSkillName(rawCmd) : false);
		const cleanName = rawCmd.replace(/^skill:/, '');
		const nameToStore = isSkill ? cleanName : rawCmd;

		segs.push({ t: 'cmd', name: nameToStore });
		remainingText = text.slice(slashMatch[0].length);
	}

	if (!remainingText) return segs;

	// 2. Trova tutte le menzioni file nel testo rimanente
	const mentions = findFileMentions(remainingText);
	let lastIndex = 0;

	for (const mention of mentions) {
		if (mention.start > lastIndex) {
			const slice = remainingText.slice(lastIndex, mention.start).replaceAll(NBSP, ' ');
			if (slice) {
				segs.push({ t: 'text', s: slice });
			}
		}
		segs.push({ t: 'file', path: mention.path });
		lastIndex = mention.end;
	}

	if (lastIndex < remainingText.length) {
		const tail = remainingText.slice(lastIndex).replaceAll(NBSP, ' ');
		if (tail) {
			segs.push({ t: 'text', s: tail });
		}
	}

	// Unione segmenti testo adiacenti e pulizia
	const merged: ComposerSegment[] = [];
	for (const s of segs) {
		const prev = merged[merged.length - 1];
		if (prev && prev.t === 'text' && s.t === 'text') {
			prev.s += s.s;
		} else {
			merged.push(s);
		}
	}

	return merged;
}

/**
 * Crea l'elemento DOM badge per una menzione file.
 */
export function createFileBadgeElement(path: string): HTMLElement {
	const el = document.createElement('span');
	el.contentEditable = 'false';
	el.dataset.kind = 'file';
	el.dataset.value = path;
	el.className = 'chat-badge chat-badge--file';
	el.title = path;

	// Icona SVG file identica ai componenti transcript
	el.innerHTML =
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chat-badge-glyph" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

	const nameSpan = document.createElement('span');
	nameSpan.className = 'chat-badge-name';
	const base = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
	nameSpan.textContent = base;
	el.appendChild(nameSpan);

	return el;
}

/**
 * Crea l'elemento DOM badge per un comando slash.
 */
export function createCommandBadgeElement(name: string): HTMLElement {
	const el = document.createElement('span');
	el.contentEditable = 'false';
	el.dataset.kind = 'cmd';
	el.dataset.value = name;
	el.className = 'chat-badge chat-badge--cmd';

	const nameSpan = document.createElement('span');
	nameSpan.className = 'chat-badge-name';
	nameSpan.textContent = `/${name}`;
	el.appendChild(nameSpan);

	return el;
}

/**
 * Badge `#progetto` del companion: pallino nella tinta del progetto (punto
 * d'identita', D1) e nome leggibile; il valore resta il nome del progetto.
 */
export function createProjectBadgeElement(name: string, label: string, hue: number): HTMLElement {
	const el = document.createElement('span');
	el.contentEditable = 'false';
	el.dataset.kind = 'project';
	el.dataset.value = name;
	el.dataset.label = label;
	el.dataset.hue = String(hue);
	el.className = 'chat-badge chat-badge--project';
	el.style.setProperty('--badge-h', String(hue));

	const dot = document.createElement('span');
	dot.className = 'chat-badge-dot';
	el.appendChild(dot);

	const nameSpan = document.createElement('span');
	nameSpan.className = 'chat-badge-name';
	nameSpan.textContent = label;
	el.appendChild(nameSpan);

	return el;
}

/**
 * Badge `!ruolo` o `!modello` del companion. Un ruolo con tinta ha il pallino
 * della rampa dei ruoli, `default` il pallino `--brand-ink`; un modello non e'
 * un'identita' e resta senza pallino.
 */
export function createRoleBadgeElement(value: string, label: string, hue?: number): HTMLElement {
	const el = document.createElement('span');
	el.contentEditable = 'false';
	el.dataset.kind = 'role';
	el.dataset.value = value;
	el.dataset.label = label;
	el.className = 'chat-badge chat-badge--role';

	if (hue !== undefined || value === 'default') {
		const dot = document.createElement('span');
		dot.className = 'chat-badge-dot';
		if (hue !== undefined) {
			el.dataset.hue = String(hue);
			el.style.setProperty('--badge-h', String(hue));
		} else {
			dot.className += ' is-default';
		}
		el.appendChild(dot);
	}

	const nameSpan = document.createElement('span');
	nameSpan.className = 'chat-badge-name';
	nameSpan.textContent = label;
	el.appendChild(nameSpan);

	return el;
}

function createBadgeElement(seg: Exclude<ComposerSegment, { t: 'text' }>): HTMLElement {
	switch (seg.t) {
		case 'file':
			return createFileBadgeElement(seg.path);
		case 'cmd':
			return createCommandBadgeElement(seg.name);
		case 'project':
			return createProjectBadgeElement(seg.name, seg.label ?? seg.name, seg.hue ?? 260);
		case 'role':
			return createRoleBadgeElement(seg.value, seg.label ?? seg.value, seg.hue);
	}
}

/**
 * Inserisce i segmenti nel container DOM dell'editor.
 */
export function renderSegmentsToDom(segs: ComposerSegment[], ed: HTMLElement): void {
	ed.innerHTML = '';
	for (let i = 0; i < segs.length; i++) {
		const seg = segs[i];
		if (seg.t === 'text') {
			ed.appendChild(document.createTextNode(seg.s));
			continue;
		}
		ed.appendChild(createBadgeElement(seg));
		// Se il badge e' l'ultimo nodo o e' seguito da un altro badge, serve uno
		// spazio NBSP perche' il caret abbia dove posarsi.
		const next = segs[i + 1];
		if (!next || next.t !== 'text') {
			ed.appendChild(document.createTextNode(NBSP));
		}
	}
}
