/**
 * Registro di vita di Studio lato interfaccia.
 *
 * Le righe finiscono in `studio.log` accanto a quelle del backend (vedi
 * `src-tauri/src/studio_log.rs`). Partono a lotti; gli errori partono subito,
 * perche' l'errore che precede un blocco e' proprio quello che serve leggere.
 * Il registro non scrive mai sulla console: la console e' intercettata e
 * finirebbe qui, in un giro senza fine.
 */

import { invoke } from '@tauri-apps/api/core';
import { formatLogLine, type LogLevel } from './logCore';

const FLUSH_DELAY_MS = 1000;
const MAX_PENDING = 500;

let origin = 'web';
let pending: string[] = [];
let dropped = 0;
let flushTimer: number | null = null;

const snapshotProviders = new Map<string, () => string>();
let lastSwitch: { at: number; from: string; to: string } | null = null;

function flush(): void {
	if (flushTimer !== null) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	if (pending.length === 0) return;
	const lines = pending;
	pending = [];
	if (dropped > 0) {
		lines.push(formatLogLine(Date.now(), origin, 'WARN', 'log', `${dropped} righe scartate: registro sovraccarico`));
		dropped = 0;
	}
	// Una riga persa non deve mai rompere il percorso che la registra.
	invoke('studio_log_append', { lines }).catch(() => {});
}

function write(level: LogLevel, category: string, message: string): void {
	if (pending.length >= MAX_PENDING) {
		pending.shift();
		dropped++;
	}
	pending.push(formatLogLine(Date.now(), origin, level, category, message));
	if (level === 'ERROR') {
		flush();
		return;
	}
	if (flushTimer === null) flushTimer = window.setTimeout(flush, FLUSH_DELAY_MS);
}

export const studioLog = {
	info: (category: string, message: string) => write('INFO', category, message),
	warn: (category: string, message: string) => write('WARN', category, message),
	error: (category: string, message: string) => write('ERROR', category, message),
	flush
};

/** `web:main`, `web:companion`…: chi legge deve sapere quale finestra parla. */
export function setStudioLogOrigin(label: string): void {
	origin = `web:${label}`;
}

/**
 * Un pezzo dell'interfaccia dichiara come raccontare il proprio stato quando
 * il registro fotografa un'anomalia (blocco, errore, clic a vuoto).
 */
export function registerSnapshotProvider(name: string, provider: () => string): () => void {
	snapshotProviders.set(name, provider);
	return () => {
		if (snapshotProviders.get(name) === provider) snapshotProviders.delete(name);
	};
}

export function noteProjectSwitch(from: string, to: string): void {
	lastSwitch = { at: Date.now(), from, to };
}

/** Stato dichiarato dai pannelli piu' l'ultimo cambio di progetto. */
export function collectSnapshot(): string {
	const parts: string[] = [];
	if (lastSwitch) {
		const ago = ((Date.now() - lastSwitch.at) / 1000).toFixed(1);
		parts.push(`ultimo cambio progetto ${ago}s fa (${lastSwitch.from} -> ${lastSwitch.to})`);
	}
	for (const [name, provider] of snapshotProviders) {
		try {
			parts.push(`${name}: ${provider()}`);
		} catch (error) {
			parts.push(`${name}: non leggibile (${error instanceof Error ? error.message : String(error)})`);
		}
	}
	return parts.join(' ; ');
}
