/**
 * Tracciatore diagnostico del fuoco (strumentazione temporanea).
 *
 * Serve a rispondere a una domanda sola: chi porta Studio in primo piano, o
 * sposta il fuoco sul composer, mentre un agente lavora e l'utente sta
 * scrivendo altrove. L'analisi statica non basta perche' il salto puo' venire
 * dal sistema operativo (una finestra esterna che compare e sparisce) e non
 * dal codice della GUI.
 *
 * Ogni riga registra: istante, causa, se la finestra era in primo piano, quale
 * elemento aveva il fuoco e qual era l'ultima attivita' dell'agente. Le righe
 * si accumulano in memoria e vengono scaricate a lotti su file: gli eventi di
 * fuoco sono rari, quindi il costo e' nullo rispetto a una scrittura per
 * evento.
 */

import { invoke } from '@tauri-apps/api/core';

/** Ritardo di raggruppamento: un cambio di fuoco ne scatena tre o quattro in
 *  pochi millisecondi, e vanno in un solo messaggio. */
const FLUSH_DELAY_MS = 1500;
/** Oltre questa coda si scrive subito, senza attendere il timer. */
const FLUSH_THRESHOLD = 64;

let started = false;
let pending: string[] = [];
let flushTimer: number | null = null;
let lastAgent = '-';

function describe(node: EventTarget | null): string {
	if (!node) return 'null';
	if (!(node instanceof Element)) return 'non-element';
	if (node === document.body) return 'body';
	const tag = node.tagName.toLowerCase();
	const id = node.id ? `#${node.id}` : '';
	const className = typeof node.className === 'string' ? node.className.trim() : '';
	const classes = className ? `.${className.split(/\s+/).slice(0, 2).join('.')}` : '';
	return `${tag}${id}${classes}`;
}

async function flush(): Promise<void> {
	if (flushTimer !== null) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	if (pending.length === 0) return;
	const lines = pending;
	pending = [];
	try {
		await invoke('focus_trace_append', { lines });
	} catch (err) {
		console.warn('[focus-trace] scrittura non riuscita:', err);
	}
}

function schedule() {
	if (pending.length >= FLUSH_THRESHOLD) {
		void flush();
		return;
	}
	if (flushTimer !== null) return;
	flushTimer = window.setTimeout(() => void flush(), FLUSH_DELAY_MS);
}

/**
 * Registra un evento di fuoco. Prima dell'avvio del tracciatore (per esempio
 * nella finestra Companion, dove non viene avviato) e' una funzione vuota.
 */
export function traceFocus(kind: string, detail = ''): void {
	if (!started) return;
	const stamp = new Date().toISOString().slice(11, 23);
	const window_ = document.hasFocus() ? 'fg' : 'bg';
	const line =
		`${stamp} ${kind.padEnd(24)} win=${window_} active=${describe(document.activeElement)}`
		+ ` agent=${lastAgent}${detail ? ` ${detail}` : ''}`;
	pending.push(line);
	schedule();
}

/** Ultima attivita' dell'agente, usata per correlare i salti di fuoco. */
export function traceAgent(detail: string): void {
	lastAgent = detail;
	traceFocus('agent', '');
}

/** Avvia il tracciatore nella finestra principale. Idempotente. */
export async function startFocusTracer(): Promise<void> {
	if (started) return;
	started = true;

	window.addEventListener('focus', () => traceFocus('window-focus'));
	window.addEventListener('blur', () => traceFocus('window-blur'));
	document.addEventListener('visibilitychange', () =>
		traceFocus('visibility', `state=${document.visibilityState}`)
	);
	// In cattura: alcuni pannelli fermano la propagazione del focusin.
	document.addEventListener(
		'focusin',
		(event) => traceFocus('focusin', `target=${describe(event.target)}`),
		true
	);
	window.addEventListener('beforeunload', () => void flush());

	try {
		const path = await invoke<string>('focus_trace_path');
		console.info('[focus-trace] traccia attiva:', path);
	} catch (err) {
		console.warn('[focus-trace] percorso non risolvibile:', err);
	}
	traceFocus('tracer-start', `ua=${navigator.userAgent.slice(0, 60)}`);
}
