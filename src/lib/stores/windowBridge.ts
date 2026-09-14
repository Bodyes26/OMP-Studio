import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Ponte fra le webview di Studio (finestra principale e Companion).
 *
 * Ogni finestra ha il proprio runtime JavaScript e quindi la propria copia
 * degli store: una preferenza salvata su disco dalla finestra principale non
 * raggiunge la Companion, che resterebbe ferma allo snapshot letto all'avvio
 * fino al riavvio dell'applicazione.
 *
 * Il messaggio porta l'etichetta della finestra che lo ha emesso perche'
 * `emit` di Tauri consegna anche al mittente: senza il filtro, chi salva si
 * riapplicherebbe il proprio stato appena scritto.
 */

type Envelope<T> = { source: string; payload: T };

/** Etichetta della finestra corrente; `null` fuori da Tauri (test, SSR). */
const selfLabel: string | null = (() => {
	if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null;
	try {
		return getCurrentWindow().label;
	} catch {
		return null;
	}
})();

/** Vero quando il ponte e' utilizzabile: fuori da Tauri le chiamate sono no-op. */
export const windowBridgeAvailable = selfLabel !== null;

/**
 * Etichetta della finestra corrente per i canali che non possono usare la
 * busta di questo modulo, perche' li alimenta anche Rust con un payload
 * proprio (`project-tasks-changed`). Chi emette ci mette la propria
 * etichetta, chi ascolta scarta i messaggi che portano la sua.
 */
export const windowLabel = selfLabel;

/** Annuncia un cambiamento alle altre finestre. Fuori da Tauri non fa nulla. */
export async function broadcastToWindows<T>(event: string, payload: T): Promise<void> {
	if (selfLabel === null) return;
	try {
		await emit(event, { source: selfLabel, payload } satisfies Envelope<T>);
	} catch (err) {
		console.warn(`Broadcast '${event}' fallito`, err);
	}
}

/**
 * Ascolta i cambiamenti annunciati dalle altre finestre, ignorando i propri.
 * Restituisce `null` fuori da Tauri o se la registrazione fallisce.
 */
export async function listenFromWindows<T>(
	event: string,
	handler: (payload: T) => void
): Promise<UnlistenFn | null> {
	if (selfLabel === null) return null;
	try {
		return await listen<Envelope<T>>(event, (received) => {
			const envelope = received.payload;
			if (!envelope || envelope.source === selfLabel) return;
			handler(envelope.payload);
		});
	} catch (err) {
		console.warn(`Registrazione listener '${event}' fallita`, err);
		return null;
	}
}
