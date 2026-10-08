// Note visive del Laboratorio («Indica e disegna», Gate R42).
//
// Tipi e funzioni pure: il pacchetto testuale che riceve l'agente e la
// geometria delle annotazioni sul fotogramma. Lo stato reattivo vive in
// `visualNotesStore.svelte.ts`, il disegno su canvas in `annotateFrame.ts`.
//
// Invarianti del pacchetto:
//  1. Un solo blocco `<lab-notes>` per messaggio, dopo il testo dell'utente;
//  2. Per ogni elemento: tag, componente, `file:riga:colonna`, selettore, classi,
//     testo breve; per ogni nota il numero (uguale al riquadro del fotogramma) e
//     la nota facoltativa;
//  3. I riquadri raggruppano gli elementi per componente e file:riga (×N);
//  4. Una nota «superata» (elemento sparito dopo la ricompilazione) resta nel
//     pacchetto con l'avviso, non si scarta in silenzio.

export interface LabRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** `jsx`: l'elemento host nasce in quella riga; `callsite`: riga dove si usa il componente (icone, librerie); `ancestor`: primo antenato con sorgente. */
export type LabLocKind = 'jsx' | 'callsite' | 'ancestor';

export interface LabTarget {
	tag: string;
	loc: string | null;
	locKind: LabLocKind | null;
	component: string | null;
	selector: string;
	classes: string;
	text: string;
	instance: { index: number; count: number };
	/** Coordinate pagina (px CSS) al momento della selezione o dell'ultimo riaggancio. */
	rect: LabRect;
	/** Solo nei gruppi del riquadro: quanti elementi condividono componente e riga. */
	count?: number;
	/** Elemento non piu' trovato dopo la ricompilazione. */
	missing?: boolean;
	/** Token dell'ispettore per agganciare la nota all'elemento appena indicato. */
	pickId?: string;
}

export type LabNoteKind = 'point' | 'area';

export interface LabNote {
	id: string;
	n: number;
	kind: LabNoteKind;
	targets: LabTarget[];
	/** Solo riquadro: area in coordinate pagina. */
	rect?: LabRect;
	/** Solo riquadro: elementi raccolti e gruppi oltre il limite. */
	total?: number;
	omitted?: number;
	pickId?: string;
	text: string;
	stale: boolean;
}

/** Fotogramma rasterizzato dall'ispettore (prima delle annotazioni). */
export interface LabFrame {
	dataUrl: string;
	width: number;
	height: number;
	/** Pixel del fotogramma per px CSS. */
	scale: number;
	/** Regione della pagina catturata. */
	region: LabRect;
	/** Rettangoli pagina di ogni nota al momento della cattura. */
	rects: Record<string, LabRect[]>;
	warnings: string[];
	/** Revisione della coda a cui si riferisce. */
	revision: number;
}

export interface LabNotesLabels {
	element: string;
	elements: (count: number) => string;
	area: (w: number, h: number, x: number, y: number) => string;
	areaCount: (count: number, groups: number) => string;
	note: string;
	noNote: string;
	stale: string;
	missing: string;
	callsite: string;
	ancestor: string;
	noSource: string;
	instance: (index: number, count: number) => string;
	moreGroups: (count: number) => string;
	selector: string;
	classes: string;
	text: string;
	frame: string;
}

export interface FormatOptions {
	labels: LabNotesLabels;
	/** Es. `desktop 1180×760`. */
	viewport?: string;
	imageAttached: boolean;
}

function quote(s: string): string {
	return '"' + s.replace(/"/g, '\\"') + '"';
}

function sourcePart(t: LabTarget, labels: LabNotesLabels): string {
	if (!t.loc) return labels.noSource;
	if (t.locKind === 'callsite') return `${t.loc} (${labels.callsite})`;
	if (t.locKind === 'ancestor') return `${t.loc} (${labels.ancestor})`;
	return t.loc;
}

function targetLines(t: LabTarget, labels: LabNotesLabels, indent: string): string[] {
	const head = [`<${t.tag}>`];
	if (t.component) head.push(t.component);
	head.push(sourcePart(t, labels));
	if (t.count && t.count > 1) head.push(`×${t.count}`);
	else if (t.instance && t.instance.count > 1) head.push(labels.instance(t.instance.index + 1, t.instance.count));
	if (t.missing) head.push(`(${labels.missing})`);
	const detail = [`${labels.selector}: ${t.selector}`];
	if (t.classes) detail.push(`${labels.classes}: ${t.classes}`);
	if (t.text) detail.push(`${labels.text}: ${quote(t.text)}`);
	return [`${indent}- ${head.join(' · ')}`, `${indent}  ${detail.join(' | ')}`];
}

/** Riga di intestazione di una nota: numero, tipo, eventuale «superata» e nota. */
function noteHeader(note: LabNote, labels: LabNotesLabels): string {
	let kind: string;
	if (note.kind === 'area' && note.rect) {
		const r = note.rect;
		kind = labels.area(Math.round(r.width), Math.round(r.height), Math.round(r.x), Math.round(r.y));
		const groups = note.targets.length + (note.omitted ?? 0);
		kind += ' · ' + labels.areaCount(note.total ?? note.targets.length, groups);
	} else {
		kind = note.targets.length > 1 ? labels.elements(note.targets.length) : labels.element;
	}
	const stale = note.stale ? ` (${labels.stale})` : '';
	const text = note.text.trim();
	const noteText = text ? `${labels.note}: ${quote(text.replace(/\s+/g, ' '))}` : labels.noNote;
	return `[${note.n}] ${kind}${stale} — ${noteText}`;
}

/** Il blocco di una sola nota (anteprima nel chip e pacchetto completo). */
export function formatLabNote(note: LabNote, labels: LabNotesLabels): string {
	const lines = [noteHeader(note, labels)];
	for (const t of note.targets) lines.push(...targetLines(t, labels, '  '));
	if (note.omitted && note.omitted > 0) lines.push(`  ${labels.moreGroups(note.omitted)}`);
	return lines.join('\n');
}

/** Pacchetto completo per l'agente; stringa vuota senza note. */
export function formatLabNotesBlock(notes: readonly LabNote[], options: FormatOptions): string {
	if (notes.length === 0) return '';
	const attrs: string[] = [];
	if (options.viewport) attrs.push(`viewport=${quote(options.viewport)}`);
	if (options.imageAttached) attrs.push('frame="1"');
	const open = `<lab-notes${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
	const body = [...notes].sort((a, b) => a.n - b.n).map((n) => formatLabNote(n, options.labels));
	const out = [open, ...body, '</lab-notes>'];
	if (options.imageAttached) out.push(options.labels.frame);
	return out.join('\n');
}

/** Testo da inviare: messaggio dell'utente, riga vuota, pacchetto. */
export function appendLabNotes(text: string, block: string): string {
	if (!block) return text;
	return text.trim() ? `${text}\n\n${block}` : block;
}

/** Etichetta breve per chip e popover: `<h3> ProductCard · ProductCard.tsx:15`. */
export function shortTargetLabel(t: LabTarget): string {
	const parts = [`<${t.tag}>`];
	if (t.component) parts.push(t.component);
	if (t.loc) {
		const [file, line] = t.loc.split(':');
		parts.push(`${file.split('/').pop()}:${line ?? ''}`);
	}
	return parts.join(' ');
}

export interface AnnotationShape {
	n: number;
	kind: LabNoteKind;
	boxes: LabRect[];
	badge: { x: number; y: number };
}

/**
 * Riquadri e numeri da disegnare sul fotogramma, in pixel del fotogramma.
 * Usa i rettangoli registrati alla cattura (stessa geometria dell'immagine);
 * le note superate o fuori dalla regione non si disegnano.
 */
export function annotationShapes(frame: Pick<LabFrame, 'region' | 'scale' | 'rects' | 'width' | 'height'>, notes: readonly LabNote[]): AnnotationShape[] {
	const shapes: AnnotationShape[] = [];
	for (const note of notes) {
		if (note.stale) continue;
		const rects = frame.rects[note.id];
		if (!rects || rects.length === 0) continue;
		const boxes: LabRect[] = [];
		for (const r of rects) {
			const box = {
				x: (r.x - frame.region.x) * frame.scale,
				y: (r.y - frame.region.y) * frame.scale,
				width: r.width * frame.scale,
				height: r.height * frame.scale
			};
			if (box.x + box.width <= 0 || box.y + box.height <= 0 || box.x >= frame.width || box.y >= frame.height) continue;
			boxes.push(box);
		}
		if (boxes.length === 0) continue;
		const first = boxes[0];
		shapes.push({
			n: note.n,
			kind: note.kind,
			boxes,
			badge: {
				x: Math.min(Math.max(12, first.x), frame.width - 12),
				y: Math.min(Math.max(12, first.y), frame.height - 12)
			}
		});
	}
	return shapes;
}

/** `desktop 1180×760`: viewport per l'intestazione del pacchetto. */
export function viewportLabel(mode: string, width: number, height: number): string {
	return `${mode} ${Math.round(width)}×${Math.round(height)}`;
}
