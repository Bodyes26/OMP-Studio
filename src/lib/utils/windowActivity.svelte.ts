/**
 * Poller adattivo sensibile a visibilita' e fuoco della finestra.
 *
 * Mantiene il ritmo normale quando la finestra e' a fuoco.
 * Quando la finestra e' visibile ma NON a fuoco (es. utente su secondo monitor),
 * rallenta l'intervallo (default 60 s) per risparmiare CPU e cicli di spawn CLI/processi.
 * Quando la finestra e' nascosta o minimizzata (`visibilityState === 'hidden'`),
 * sospende completamente i tick periodici.
 * Al ritorno del fuoco o della visibilita', se e' trascorso piu' del tempo di cooldown
 * (default 5 s), esegue un refresh immediato.
 */

export type PollerReason = 'interval' | 'focus' | 'visible';

export interface AdaptivePollerOptions {
	/** Intervallo di polling con finestra a fuoco (in ms), es. 15_000 */
	focusedIntervalMs: number;
	/** Intervallo a finestra visibile ma non a fuoco (in ms), default 60_000 */
	unfocusedIntervalMs?: number;
	/** Soglia minima di freschezza per non eseguire refresh ridondanti al rientro del fuoco (in ms), default 5_000 */
	cooldownMs?: number;
	/** Callback eseguita ad ogni tick o risveglio */
	action: (reason: PollerReason) => void | Promise<void>;
}

export interface AdaptivePoller {
	destroy: () => void;
	markRefreshed: (timestamp?: number) => void;
	getLastRunAt: () => number;
}

export function isWindowVisible(): boolean {
	if (typeof document === 'undefined') return false;
	return document.visibilityState === 'visible';
}

export function isWindowFocused(): boolean {
	if (typeof document === 'undefined') return false;
	return document.visibilityState === 'visible' && (typeof document.hasFocus === 'function' ? document.hasFocus() : true);
}

export function createAdaptivePoller(options: AdaptivePollerOptions): AdaptivePoller {
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		return {
			destroy: () => {},
			markRefreshed: () => {},
			getLastRunAt: () => 0
		};
	}

	const focusedInterval = Math.max(1000, options.focusedIntervalMs);
	const unfocusedInterval = Math.max(focusedInterval, options.unfocusedIntervalMs ?? 60_000);
	const cooldown = options.cooldownMs ?? 5000;

	let lastRunAt = Date.now();
	let timerId: number | null = null;
	let destroyed = false;

	const clearTimer = () => {
		if (timerId !== null) {
			window.clearTimeout(timerId);
			timerId = null;
		}
	};

	const scheduleNext = (delayMs?: number) => {
		if (destroyed) return;
		clearTimer();

		// Se la finestra e' nascosta, nessun tick viene pianificato.
		// Verra' risvegliato dall'evento visibilitychange.
		if (document.visibilityState === 'hidden') {
			return;
		}

		const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
		const delay = delayMs ?? (hasFocus ? focusedInterval : unfocusedInterval);

		timerId = window.setTimeout(() => {
			timerId = null;
			if (destroyed) return;
			if (document.visibilityState === 'hidden') return;

			trigger('interval');
		}, delay);
	};

	const trigger = (reason: PollerReason) => {
		lastRunAt = Date.now();
		try {
			void options.action(reason);
		} catch (err) {
			console.error('[adaptive-poller] errore durante esecuzione:', err);
		} finally {
			scheduleNext();
		}
	};

	const handleFocus = () => {
		if (destroyed) return;
		const now = Date.now();
		// Al rientro del fuoco, aggiorna subito se sono passati piu' di cooldownMs dall'ultimo refresh
		if (now - lastRunAt >= cooldown) {
			clearTimer();
			trigger('focus');
		} else {
			// Cambia il timer al ritmo focused senza eseguire chiamate duplicate
			scheduleNext(focusedInterval);
		}
	};

	const handleBlur = () => {
		if (destroyed) return;
		// Quando la finestra perde il fuoco ma resta visibile, allunga il prossimo intervallo a unfocused
		if (document.visibilityState === 'visible') {
			const elapsed = Date.now() - lastRunAt;
			const remaining = Math.max(0, unfocusedInterval - elapsed);
			scheduleNext(remaining);
		}
	};

	const handleVisibilityChange = () => {
		if (destroyed) return;
		if (document.visibilityState === 'hidden') {
			clearTimer();
		} else if (document.visibilityState === 'visible') {
			const now = Date.now();
			if (now - lastRunAt >= cooldown) {
				clearTimer();
				trigger('visible');
			} else {
				scheduleNext();
			}
		}
	};

	window.addEventListener('focus', handleFocus);
	window.addEventListener('blur', handleBlur);
	document.addEventListener('visibilitychange', handleVisibilityChange);

	// Pianifica il primo tick senza eseguire subito l'azione (le superfici hanno la loro inizializzazione di boot)
	scheduleNext();

	return {
		destroy: () => {
			destroyed = true;
			clearTimer();
			window.removeEventListener('focus', handleFocus);
			window.removeEventListener('blur', handleBlur);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		},
		markRefreshed: (timestamp = Date.now()) => {
			lastRunAt = timestamp;
		},
		getLastRunAt: () => lastRunAt
	};
}
