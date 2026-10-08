/**
 * Stato e widget delle estensioni di omp (`extension_ui_request` senza risposta).
 *
 * Le estensioni (quelle dell'utente e quelle incluse in omp) scrivono righe di
 * stato (`setStatus`) e piccoli pannelli di testo (`setWidget`) che nella TUI
 * stanno nel piede e sopra o sotto l'editor. In RPC arrivano come frame
 * fire-and-forget (omp 18.8, `RpcExtensionUIRequest`):
 *
 * - `setStatus { statusKey, statusText }`: `statusText` assente o vuoto toglie
 *   la voce;
 * - `setWidget { widgetKey, widgetLines, widgetPlacement? }`: `widgetLines`
 *   assente toglie il widget. omp in RPC inoltra solo array di stringhe: i
 *   widget disegnati da una factory di componenti TUI (per esempio la
 *   dashboard di `autoresearch`) arrivano solo come rimozione.
 *
 * Il modulo e' puro (niente rune, niente DOM): la sessione tiene le mappe,
 * qui si decide come cambiano, cosi' gli smoke test di Node lo coprono con le
 * fixture reali.
 */

import type { AgentSessionEvent } from './wire';

export type ExtensionWidgetPlacement = 'aboveEditor' | 'belowEditor';

export interface ExtensionWidget {
	/** Righe gia' private dei caratteri di controllo non SGR; gli SGR restano per i colori. */
	lines: string[];
	placement: ExtensionWidgetPlacement;
}

/** Testo di stato per `statusKey`, gia' ripulito da ANSI e a capo. */
export type ExtensionStatusMap = Record<string, string>;
export type ExtensionWidgetMap = Record<string, ExtensionWidget>;

export interface ExtensionUiState {
	status: ExtensionStatusMap;
	widgets: ExtensionWidgetMap;
}

/** Limiti difensivi: un'estensione che sbaglia non deve riempire il composer. */
export const MAX_STATUS_LENGTH = 160;
export const MAX_WIDGET_LINES = 40;
export const MAX_WIDGET_LINE_LENGTH = 400;

// CSI completo (colori, cursore, cancellazioni), OSC (titoli, link OSC 8)
// chiuso da BEL o ST, e i singoli ESC rimasti.
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const LONE_ESC = /\u001b[@-_]?/g;
// Controlli C0 e DEL tranne il tab (gestito a parte).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** Toglie ogni sequenza ANSI e i caratteri di controllo. */
export function stripAnsi(text: string): string {
	return text.replace(OSC, '').replace(CSI, '').replace(LONE_ESC, '').replace(CONTROL, '');
}

/**
 * Tiene solo le sequenze SGR (`ESC[...m`), che diventano colori; toglie OSC,
 * movimenti del cursore e controlli, che in una GUI non hanno senso.
 */
function keepSgrOnly(text: string): string {
	return text
		.replace(OSC, '')
		.replace(CSI, (seq) => (seq.endsWith('m') ? seq : ''))
		.replace(/\u001b(?!\[[0-9;:]*m)/g, '')
		.replace(/\t/g, '    ')
		.replace(CONTROL, (ch) => (ch === '\u001b' ? ch : ''));
}

function clip(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}\u2026`;
}

/** Testo di una voce di stato: una riga, senza ANSI, spazi compressi. */
export function normalizeStatusText(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const text = stripAnsi(raw).replace(/\s+/g, ' ').trim();
	if (!text) return null;
	return clip(text, MAX_STATUS_LENGTH);
}

/**
 * Righe di un widget. `null` se il widget va tolto: righe assenti, non array o
 * tutte vuote dopo la pulizia (un widget vuoto lascerebbe un riquadro bianco).
 */
export function normalizeWidgetLines(raw: unknown): string[] | null {
	if (!Array.isArray(raw)) return null;
	const lines = raw
		.filter((line): line is string => typeof line === 'string')
		// Una "riga" con dentro degli a capo la si spezza: il blocco e' monospazio.
		.flatMap((line) => line.replace(/\r\n?/g, '\n').split('\n'))
		.map((line) => clip(keepSgrOnly(line).replace(/\s+$/, ''), MAX_WIDGET_LINE_LENGTH));
	// Righe vuote in testa e in coda non dicono nulla; quelle in mezzo si.
	while (lines.length > 0 && stripAnsi(lines[0]).trim() === '') lines.shift();
	while (lines.length > 0 && stripAnsi(lines[lines.length - 1]).trim() === '') lines.pop();
	if (lines.length === 0) return null;
	return lines.slice(0, MAX_WIDGET_LINES);
}

export function emptyExtensionUi(): ExtensionUiState {
	return { status: {}, widgets: {} };
}

/**
 * Applica una `extension_ui_request` di presentazione. Restituisce lo stato
 * nuovo, oppure `null` se il frame non riguarda stato o widget (il chiamante
 * prosegue con gli altri metodi). Lo stato in ingresso non viene mutato.
 */
export function reduceExtensionUi(
	state: ExtensionUiState,
	event: AgentSessionEvent | Record<string, unknown>
): ExtensionUiState | null {
	if (event.method === 'setStatus') {
		const key = typeof event.statusKey === 'string' ? event.statusKey : null;
		if (!key) return state;
		// Ripiego per i frame pre-18 che portavano il testo in `message`.
		const text = normalizeStatusText(
			'statusText' in event ? event.statusText : (event.message ?? undefined)
		);
		const status = { ...state.status };
		if (text === null) delete status[key];
		else status[key] = text;
		return { ...state, status };
	}
	if (event.method === 'setWidget') {
		const key = typeof event.widgetKey === 'string' ? event.widgetKey : null;
		if (!key) return state;
		const lines = normalizeWidgetLines(event.widgetLines);
		const widgets = { ...state.widgets };
		if (lines === null) {
			delete widgets[key];
		} else {
			const placement: ExtensionWidgetPlacement =
				event.widgetPlacement === 'belowEditor' ? 'belowEditor' : 'aboveEditor';
			widgets[key] = { lines, placement };
		}
		return { ...state, widgets };
	}
	return null;
}

/** Voci di stato in ordine stabile (per chiave), come le mostra la riga di stato. */
export function statusEntries(status: ExtensionStatusMap): Array<{ key: string; text: string }> {
	return Object.keys(status)
		.sort((a, b) => a.localeCompare(b))
		.map((key) => ({ key, text: status[key] }));
}

/** Widget di un lato, in ordine stabile per chiave. */
export function widgetsAt(
	widgets: ExtensionWidgetMap,
	placement: ExtensionWidgetPlacement
): Array<{ key: string; lines: string[] }> {
	return Object.keys(widgets)
		.filter((key) => widgets[key].placement === placement)
		.sort((a, b) => a.localeCompare(b))
		.map((key) => ({ key, lines: widgets[key].lines }));
}

/* ------------------------------------------------------------ colori ANSI */

/**
 * Colori ridotti ai token semantici di Studio. I sedici colori ANSI veri
 * appartengono al tema di omp e vivono nel terminale (Sacred Terminal Rule):
 * qui un'estensione che colora "ok" in verde o "errore" in rosso deve
 * restare leggibile su ogni tema, non riprodurre una palette.
 */
export type AnsiTone = 'danger' | 'success' | 'warn' | 'accent' | 'muted' | 'strong';

export interface AnsiSegment {
	text: string;
	tone?: AnsiTone;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
}

interface SgrState {
	tone?: AnsiTone;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
}

// Indice ANSI 0-7 (normale o brillante) → tono.
const BASIC_TONES: Array<AnsiTone | undefined> = [
	'muted', // nero: su fondo scuro sarebbe invisibile, lo si attenua
	'danger', // rosso
	'success', // verde
	'warn', // giallo
	'accent', // blu
	'accent', // magenta
	'accent', // ciano
	'strong' // bianco
];

function toneFromRgb(r: number, g: number, b: number): AnsiTone | undefined {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	if (max - min < 24) {
		// Grigi: chiari = testo pieno, scuri = attenuato.
		return max >= 170 ? 'strong' : 'muted';
	}
	const d = max - min;
	let hue: number;
	if (max === r) hue = ((g - b) / d) % 6;
	else if (max === g) hue = (b - r) / d + 2;
	else hue = (r - g) / d + 4;
	hue = (hue * 60 + 360) % 360;
	if (hue < 20 || hue >= 330) return 'danger';
	if (hue < 70) return 'warn';
	if (hue < 165) return 'success';
	return 'accent';
}

function toneFrom256(n: number): AnsiTone | undefined {
	if (n < 8) return BASIC_TONES[n];
	if (n < 16) return BASIC_TONES[n - 8];
	if (n >= 232) return n >= 244 ? 'strong' : 'muted';
	const i = n - 16;
	const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
	return toneFromRgb(level(Math.floor(i / 36)), level(Math.floor(i / 6) % 6), level(i % 6));
}

function applySgr(state: SgrState, params: string): SgrState {
	const next = { ...state };
	const codes = params === '' ? [0] : params.split(/[;:]/).map((p) => (p === '' ? 0 : Number(p)));
	for (let i = 0; i < codes.length; i++) {
		const c = codes[i];
		if (!Number.isFinite(c)) continue;
		if (c === 0) {
			next.tone = undefined;
			next.bold = next.dim = next.italic = next.underline = false;
		} else if (c === 1) next.bold = true;
		else if (c === 2) next.dim = true;
		else if (c === 3) next.italic = true;
		else if (c === 4) next.underline = true;
		else if (c === 22) next.bold = next.dim = false;
		else if (c === 23) next.italic = false;
		else if (c === 24) next.underline = false;
		else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) next.tone = BASIC_TONES[c % 10];
		else if (c === 39) next.tone = undefined;
		else if (c === 38) {
			if (codes[i + 1] === 5 && i + 2 < codes.length) {
				next.tone = toneFrom256(codes[i + 2]);
				i += 2;
			} else if (codes[i + 1] === 2 && i + 4 < codes.length) {
				next.tone = toneFromRgb(codes[i + 2], codes[i + 3], codes[i + 4]);
				i += 4;
			}
		} else if (c === 48) {
			// Lo sfondo non si riproduce: si saltano i suoi parametri.
			if (codes[i + 1] === 5) i += 2;
			else if (codes[i + 1] === 2) i += 4;
		}
		// 40-47, 49, 100-107 (sfondi) e il resto: ignorati.
	}
	return next;
}

/**
 * Spezza una riga con sequenze SGR in segmenti con tono e stile. Ogni altra
 * sequenza viene tolta. Un testo senza ANSI torna come un solo segmento.
 */
export function parseAnsiLine(line: string): AnsiSegment[] {
	const clean = keepSgrOnly(line);
	const segments: AnsiSegment[] = [];
	let state: SgrState = { bold: false, dim: false, italic: false, underline: false };
	const SGR = /\u001b\[([0-9;:]*)m/g;
	let last = 0;
	const push = (text: string) => {
		if (!text) return;
		const seg: AnsiSegment = { text };
		if (state.tone) seg.tone = state.tone;
		if (state.bold) seg.bold = true;
		if (state.dim) seg.dim = true;
		if (state.italic) seg.italic = true;
		if (state.underline) seg.underline = true;
		const prev = segments[segments.length - 1];
		if (
			prev &&
			prev.tone === seg.tone &&
			prev.bold === seg.bold &&
			prev.dim === seg.dim &&
			prev.italic === seg.italic &&
			prev.underline === seg.underline
		) {
			prev.text += text;
		} else {
			segments.push(seg);
		}
	};
	for (let match = SGR.exec(clean); match; match = SGR.exec(clean)) {
		push(clean.slice(last, match.index));
		state = applySgr(state, match[1]);
		last = match.index + match[0].length;
	}
	push(clean.slice(last));
	return segments;
}
