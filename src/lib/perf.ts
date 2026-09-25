/**
 * Traccia dei tempi lato interfaccia.
 *
 * Le righe finiscono nello stesso `perf-trace.log` del backend (vedi
 * `src-tauri/src/perf_trace.rs`) con istante assoluto in millisecondi: cosi'
 * una misura dell'interfaccia si legge accanto agli spawn git e omp che l'hanno
 * causata. Si accumulano in memoria e partono a lotti, per non aggiungere un
 * invoke a ogni misura.
 *
 * Formato riga: `<epoch_ms> <+secondi dall'avvio> web <ambito> <durata_ms> <etichetta>`.
 */

import { invoke } from '@tauri-apps/api/core';

const FLUSH_DELAY_MS = 2000;
const FLUSH_THRESHOLD = 128;

let pending: string[] = [];
let flushTimer: number | null = null;

function flush(): void {
	if (flushTimer !== null) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	if (pending.length === 0) return;
	const lines = pending;
	pending = [];
	// Una misura persa non deve mai rompere il percorso misurato.
	invoke('perf_trace_append', { lines }).catch(() => {});
}

function schedule(): void {
	if (pending.length >= FLUSH_THRESHOLD) {
		flush();
		return;
	}
	if (flushTimer !== null) return;
	flushTimer = window.setTimeout(flush, FLUSH_DELAY_MS);
}

function write(scope: string, durationMs: number, label: string): void {
	const sinceStart = (performance.now() / 1000).toFixed(3).padStart(8);
	const clean = label.replace(/[\r\n]+/g, ' ');
	pending.push(`${Date.now()} ${sinceStart} web ${scope} ${durationMs.toFixed(1)} ${clean}`);
	schedule();
}

/** Istante notevole senza durata (es. "composer pronto"). */
export function perfMark(scope: string, label: string): void {
	write(scope, 0, label);
}

/**
 * Apre un intervallo: la funzione restituita lo chiude e lo registra.
 * Chiamarla piu' volte registra solo la prima chiusura.
 */
export function perfSpan(scope: string, label: string): (outcome?: string) => void {
	const started = performance.now();
	let closed = false;
	return (outcome?: string) => {
		if (closed) return;
		closed = true;
		write(scope, performance.now() - started, outcome ? `${label} ${outcome}` : label);
	};
}

/** Misura una promessa senza cambiarne il risultato. */
export async function perfAsync<T>(scope: string, label: string, run: () => Promise<T>): Promise<T> {
	const end = perfSpan(scope, label);
	try {
		const value = await run();
		end('ok');
		return value;
	} catch (err) {
		end('errore');
		throw err;
	}
}

if (typeof window !== 'undefined') {
	window.addEventListener('beforeunload', flush);
}
