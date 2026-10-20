/**
 * Parti pure del registro di Studio (`studio.log`): formato delle righe,
 * descrizione compatta degli elementi, rilevamento delle raffiche di input e
 * limitazione dei messaggi ripetuti. Niente DOM globale ne' Tauri: si provano
 * in Node.
 */

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/** Stesso formato delle righe del backend (`src-tauri/src/studio_log.rs`). */
export function formatLogLine(atMs: number, origin: string, level: LogLevel, category: string, message: string): string {
	return `${new Date(atMs).toISOString()} ${origin} ${level} ${category} ${message.replace(/\r?\n/g, ' | ')}`;
}

export interface ElementLike {
	tagName: string;
	id?: string;
	className?: unknown;
	getAttribute?(name: string): string | null;
}

/**
 * `tag#id.classe.classe[role=…]`: quanto basta per riconoscere nel codice
 * l'elemento che ha preso un clic. Le classi di scope di Svelte (`svelte-xyz`)
 * cambiano a ogni build e non dicono nulla: si scartano.
 */
export function describeElement(el: ElementLike | null | undefined): string {
	if (!el || typeof el.tagName !== 'string') return '-';
	let out = el.tagName.toLowerCase();
	if (el.id) out += `#${el.id}`;
	const classes = typeof el.className === 'string' ? el.className.split(/\s+/) : [];
	for (const name of classes.filter((c) => c && !c.startsWith('svelte-')).slice(0, 3)) out += `.${name}`;
	const role = el.getAttribute?.('role');
	if (role) out += `[role=${role}]`;
	return out;
}

/**
 * Clic ripetuti nello stesso punto in poco tempo: e' il gesto di chi clicca
 * su qualcosa che non risponde. Restituisce `true` alla soglia e riparte.
 */
export class ClickBurstDetector {
	private clicks: { x: number; y: number; at: number }[] = [];

	private readonly threshold: number;
	private readonly windowMs: number;
	private readonly radiusPx: number;

	// Niente parameter properties: i test girano con lo strip dei tipi di Node.
	constructor(threshold = 4, windowMs = 2500, radiusPx = 40) {
		this.threshold = threshold;
		this.windowMs = windowMs;
		this.radiusPx = radiusPx;
	}

	add(x: number, y: number, at: number): boolean {
		this.clicks = this.clicks.filter((c) => at - c.at <= this.windowMs);
		this.clicks.push({ x, y, at });
		const near = this.clicks.filter((c) => Math.hypot(c.x - x, c.y - y) <= this.radiusPx);
		if (near.length < this.threshold) return false;
		this.clicks = [];
		return true;
	}
}

/** Eventi ravvicinati senza posizione (tasti): soglia entro una finestra. */
export class BurstCounter {
	private times: number[] = [];

	private readonly threshold: number;
	private readonly windowMs: number;

	constructor(threshold: number, windowMs: number) {
		this.threshold = threshold;
		this.windowMs = windowMs;
	}

	add(at: number): boolean {
		this.times = this.times.filter((t) => at - t <= this.windowMs);
		this.times.push(at);
		if (this.times.length < this.threshold) return false;
		this.times = [];
		return true;
	}
}

/**
 * Un errore che si ripete in un ciclo non deve riempire il registro: la
 * stessa chiave passa una volta per finestra, le ripetizioni si contano e si
 * dichiarano al passaggio successivo. Oltre il tetto al minuto passa solo il
 * conteggio.
 */
export class MessageThrottle {
	private lastByKey = new Map<string, { at: number; suppressed: number }>();
	private minuteStart = 0;
	private minuteCount = 0;

	private readonly windowMs: number;
	private readonly maxPerMinute: number;

	constructor(windowMs = 10_000, maxPerMinute = 60) {
		this.windowMs = windowMs;
		this.maxPerMinute = maxPerMinute;
	}

	admit(key: string, now: number): { admit: boolean; suppressed: number } {
		const last = this.lastByKey.get(key);
		if (last && now - last.at < this.windowMs) {
			last.suppressed++;
			return { admit: false, suppressed: 0 };
		}
		if (now - this.minuteStart >= 60_000) {
			this.minuteStart = now;
			this.minuteCount = 0;
		}
		if (this.minuteCount >= this.maxPerMinute) {
			if (last) last.suppressed++;
			else this.lastByKey.set(key, { at: now, suppressed: 1 });
			return { admit: false, suppressed: 0 };
		}
		this.minuteCount++;
		const suppressed = last?.suppressed ?? 0;
		this.lastByKey.set(key, { at: now, suppressed: 0 });
		if (this.lastByKey.size > 500) this.lastByKey.clear();
		return { admit: true, suppressed };
	}
}

const MAX_ARG_CHARS = 500;
const MAX_STACK_FRAMES = 8;

/** Messaggio e prime righe dello stack: la riga di registro resta leggibile. */
export function describeError(error: unknown): string {
	if (error instanceof Error) {
		const head = `${error.name}: ${error.message}`;
		const frames = (error.stack ?? '')
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.startsWith('at '))
			.slice(0, MAX_STACK_FRAMES);
		const base = frames.length > 0 ? `${head} | ${frames.join(' | ')}` : head;
		// Allegato da scripts/svelte-loop-probe.js agli errori di ciclo tra
		// effetti: e' l'unico indizio su quale effetto girava in tondo.
		const loop = (error as Error & { studioLoop?: unknown }).studioLoop;
		if (loop === undefined) return base;
		try {
			return `${base} | effetti nel ciclo: ${JSON.stringify(loop)}`;
		} catch {
			return base;
		}
	}
	if (typeof error === 'string') return error;
	try {
		return JSON.stringify(error)?.slice(0, MAX_ARG_CHARS) ?? String(error);
	} catch {
		return String(error);
	}
}

/** Argomenti di `console.error`/`console.warn` in una riga sola. */
export function formatConsoleArgs(args: unknown[]): string {
	return args
		.map((arg) => {
			if (typeof arg === 'string') return arg.length > MAX_ARG_CHARS ? `${arg.slice(0, MAX_ARG_CHARS)}…` : arg;
			if (arg instanceof Error) return describeError(arg);
			try {
				const json = JSON.stringify(arg);
				if (json === undefined) return String(arg);
				return json.length > MAX_ARG_CHARS ? `${json.slice(0, MAX_ARG_CHARS)}…` : json;
			} catch {
				return String(arg);
			}
		})
		.join(' ');
}
