/**
 * Raccolta automatica per il registro di Studio, una volta per finestra:
 * errori JavaScript e promesse rifiutate, `console.error`/`console.warn`,
 * fuoco e visibilita' della finestra, compiti lunghi del thread JS e due
 * guardie per i blocchi che non lasciano errori:
 *
 * - reattivita': se Svelte smette di applicare gli aggiornamenti (un effetto
 *   in ciclo fa abbandonare il giro di aggiornamento) l'interfaccia resta
 *   disegnata e animata ma non risponde piu'. Un effetto sentinella deve
 *   seguire un contatore che cresce ogni 2 s: se resta indietro, lo si dice;
 * - input: clic ripetuti nello stesso punto o tasti che non arrivano a nessun
 *   elemento sono il gesto di chi non riceve risposta. Si fotografa cosa c'e'
 *   sotto il puntatore, chi ha il fuoco e quali dialoghi sono aperti.
 */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { BurstCounter, ClickBurstDetector, MessageThrottle, describeElement, describeError, formatConsoleArgs } from './logCore';
import { collectSnapshot, setStudioLogOrigin, studioLog } from './studioLog';

const HEARTBEAT_MS = 2000;
/** Battiti consecutivi non seguiti dalla sentinella prima di dichiarare il blocco. */
const STALL_BEATS = 3;
const LONG_TASK_WARN_MS = 1000;
const INPUT_REPORT_COOLDOWN_MS = 15_000;

let installed = false;

/** Cosa vede l'utente in un punto: dal piu' alto al piu' basso dei livelli. */
function domSnapshot(point?: { x: number; y: number }): string {
	const x = point?.x ?? Math.round(window.innerWidth / 2);
	const y = point?.y ?? Math.round(window.innerHeight / 2);
	const layers = document.elementsFromPoint(x, y).slice(0, 5).map(describeElement).join(' > ');
	const dialogs = [...document.querySelectorAll('dialog[open]')]
		.map((d) => `${describeElement(d)}${d.matches(':modal') ? ' (modale)' : ''}`)
		.join(', ');
	return [
		`fuoco documento=${document.hasFocus()}`,
		`visibilita'=${document.visibilityState}`,
		`elemento attivo=${describeElement(document.activeElement)}`,
		`dialoghi aperti=${dialogs || 'nessuno'}`,
		`livelli in (${x},${y})=${layers || '-'}`
	].join(' ; ');
}

function fullSnapshot(point?: { x: number; y: number }): string {
	const app = collectSnapshot();
	return app ? `${domSnapshot(point)} ; ${app}` : domSnapshot(point);
}

function installErrorCapture(throttle: MessageThrottle): void {
	const report = (key: string, message: string) => {
		const { admit, suppressed } = throttle.admit(key, Date.now());
		if (!admit) return;
		const repeated = suppressed > 0 ? ` (+${suppressed} ripetizioni)` : '';
		studioLog.error('js', `${message}${repeated} ; ${fullSnapshot()}`);
	};
	window.addEventListener('error', (event) => {
		// Errori di caricamento di risorse (img, script): niente `message`.
		if (!event.message && !event.error) return;
		const where = event.filename ? ` @ ${event.filename}:${event.lineno}:${event.colno}` : '';
		const detail = event.error ? describeError(event.error) : event.message;
		report(`error:${event.message}`, `non gestito: ${detail}${where}`);
	});
	window.addEventListener('unhandledrejection', (event) => {
		const detail = describeError(event.reason);
		report(`rejection:${detail.slice(0, 200)}`, `promessa rifiutata non gestita: ${detail}`);
	});
}

function installConsoleCapture(throttle: MessageThrottle): void {
	for (const level of ['error', 'warn'] as const) {
		const original = console[level].bind(console);
		console[level] = (...args: unknown[]) => {
			original(...args);
			try {
				const text = formatConsoleArgs(args);
				const { admit, suppressed } = throttle.admit(`console:${text.slice(0, 200)}`, Date.now());
				if (!admit) return;
				const repeated = suppressed > 0 ? ` (+${suppressed} ripetizioni)` : '';
				const line = `${text}${repeated}`;
				if (level === 'error') studioLog.error('console', line);
				else studioLog.warn('console', line);
			} catch {
				// Il registro non deve mai rompere chi scrive sulla console.
			}
		};
	}
}

function installWindowLifecycle(): void {
	document.addEventListener('visibilitychange', () => {
		studioLog.info('window', `visibilita'=${document.visibilityState}`);
		if (document.visibilityState === 'hidden') studioLog.flush();
	});
	window.addEventListener('focus', () => studioLog.info('window', 'fuoco documento=true'));
	window.addEventListener('blur', () => studioLog.info('window', 'fuoco documento=false'));
	window.addEventListener('pagehide', () => studioLog.flush());
	window.addEventListener('beforeunload', () => {
		studioLog.info('window', 'pagina in chiusura');
		studioLog.flush();
	});
}

function installLongTaskObserver(): void {
	if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			if (entry.duration < LONG_TASK_WARN_MS) continue;
			studioLog.warn('stall', `thread JS occupato ${Math.round(entry.duration)} ms ; ${collectSnapshot()}`);
		}
	}).observe({ type: 'longtask', buffered: true });
}

function installInputWatch(): void {
	const clicks = new ClickBurstDetector();
	// Tasti stampabili che finiscono sul body: nessun campo li riceve.
	const strayKeys = new BurstCounter(8, 3000);
	let lastReportAt = 0;
	const reportOnce = (message: string, point?: { x: number; y: number }) => {
		const now = Date.now();
		if (now - lastReportAt < INPUT_REPORT_COOLDOWN_MS) return;
		lastReportAt = now;
		studioLog.warn('input', `${message} ; ${fullSnapshot(point)}`);
	};
	window.addEventListener(
		'pointerdown',
		(event) => {
			if (!clicks.add(event.clientX, event.clientY, event.timeStamp)) return;
			const point = { x: Math.round(event.clientX), y: Math.round(event.clientY) };
			reportOnce(`clic ripetuti nello stesso punto bersaglio=${describeElement(event.target as Element | null)}`, point);
		},
		{ capture: true, passive: true }
	);
	window.addEventListener(
		'keydown',
		(event) => {
			const active = document.activeElement;
			if (active && active !== document.body) return;
			if (event.key.length !== 1 && event.key !== 'Enter' && event.key !== 'Backspace') return;
			if (!strayKeys.add(event.timeStamp)) return;
			reportOnce('tasti senza destinatario: il fuoco e\u2019 sul body');
		},
		{ capture: true, passive: true }
	);
}

function startReactivityWatchdog(): void {
	let beat = $state(0);
	let seen = 0;
	$effect.root(() => {
		$effect(() => {
			seen = beat;
		});
	});
	let missed = 0;
	let stalledAt: number | null = null;
	window.setInterval(() => {
		// Si confrontano conteggi, non tempi: con la finestra nascosta il timer
		// rallenta fino a un battito al minuto, ma la sentinella lo segue sempre
		// nel microtask successivo finche' Svelte funziona.
		if (seen === beat) {
			if (stalledAt !== null) {
				studioLog.info('ui', `aggiornamenti dell'interfaccia ripresi dopo ${Math.round((Date.now() - stalledAt) / 1000)} s`);
				stalledAt = null;
			}
			missed = 0;
		} else if (++missed === STALL_BEATS) {
			stalledAt = Date.now() - STALL_BEATS * HEARTBEAT_MS;
			studioLog.error(
				'ui',
				`Svelte non applica piu' gli aggiornamenti da ${STALL_BEATS * HEARTBEAT_MS / 1000} s: l'interfaccia resta disegnata ma non risponde ; ${fullSnapshot()}`
			);
		}
		beat++;
	}, HEARTBEAT_MS);
}

function windowLabel(): string {
	if (!('__TAURI_INTERNALS__' in window)) return 'browser';
	try {
		return getCurrentWindow().label;
	} catch {
		return 'sconosciuta';
	}
}

/** Da chiamare una volta per finestra, il prima possibile. Idempotente. */
export function installStudioLogCapture(): void {
	if (installed || typeof window === 'undefined') return;
	installed = true;
	const label = windowLabel();
	setStudioLogOrigin(label);
	studioLog.info('app', `finestra ${label} avviata ua=${navigator.userAgent}`);
	const throttle = new MessageThrottle();
	installErrorCapture(throttle);
	installConsoleCapture(throttle);
	installWindowLifecycle();
	installLongTaskObserver();
	installInputWatch();
	startReactivityWatchdog();
}
