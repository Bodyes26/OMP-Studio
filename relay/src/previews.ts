import { randomBytes } from 'node:crypto';
import { PREVIEW_MAX_HTML_BYTES } from './protocol.ts';

/** Quanto resta pubblicata un anteprima: abbastanza per una sessione di lavoro, non di piu'. */
export const PREVIEW_TTL_MS = 2 * 60 * 60_000;
/** Documenti conservati in totale e per dispositivo (il piu' vecchio esce per primo). */
export const PREVIEW_MAX_ENTRIES = 64;
export const PREVIEW_MAX_ENTRIES_PER_DEVICE = 16;
/** Tetto di memoria complessivo dei documenti conservati. */
export const PREVIEW_MAX_TOTAL_BYTES = 32 * 1024 * 1024;

const ID_PATTERN = /^[0-9a-f]{32}$/;

interface PreviewEntry {
	html: string;
	bytes: number;
	deviceId: string;
	expiresAt: number;
}

/**
 * Documenti HTML dei prototipi `studio_preview` pubblicati dalla PWA.
 *
 * Solo in memoria: sono derivati dalla chat della macchina, che resta la
 * fonte. La lettura richiede un id segreto di 128 bit e non usa la sessione
 * della PWA: il documento vive in una sandbox a origine opaca, priva di
 * accesso allo storage e al DOM del relay.
 */
export class PreviewStore {
	// La Map conserva l'ordine d'inserimento: la prima voce e' la piu' vecchia.
	private readonly entries = new Map<string, PreviewEntry>();
	private totalBytes = 0;

	/** Pubblica `html` per il dispositivo e restituisce l'id, oppure `null` se oltre il tetto. */
	put(deviceId: string, html: string, now: number): string | null {
		const bytes = Buffer.byteLength(html, 'utf8');
		if (bytes === 0 || bytes > PREVIEW_MAX_HTML_BYTES) return null;
		this.prune(now);

		const id = randomBytes(16).toString('hex');
		this.entries.set(id, { html, bytes, deviceId, expiresAt: now + PREVIEW_TTL_MS });
		this.totalBytes += bytes;

		this.evictWhile(() => this.countForDevice(deviceId) > PREVIEW_MAX_ENTRIES_PER_DEVICE, deviceId);
		this.evictWhile(
			() => this.entries.size > PREVIEW_MAX_ENTRIES || this.totalBytes > PREVIEW_MAX_TOTAL_BYTES
		);
		return id;
	}

	/** Documento pubblicato, o `null` se l'id non e' valido, e' scaduto o e' stato espulso. */
	get(id: string, now: number): string | null {
		if (!ID_PATTERN.test(id)) return null;
		const entry = this.entries.get(id);
		if (!entry) return null;
		if (entry.expiresAt <= now) {
			this.remove(id);
			return null;
		}
		return entry.html;
	}

	/** Toglie le anteprime di un dispositivo (revoca o logout). */
	removeForDevice(deviceId: string): void {
		for (const [id, entry] of this.entries) {
			if (entry.deviceId === deviceId) this.remove(id);
		}
	}

	private countForDevice(deviceId: string): number {
		let count = 0;
		for (const entry of this.entries.values()) if (entry.deviceId === deviceId) count++;
		return count;
	}

	/** Espelle dalla piu' vecchia (del solo dispositivo, se indicato) finche' la condizione vale. */
	private evictWhile(condition: () => boolean, deviceId?: string): void {
		while (condition()) {
			let victim: string | null = null;
			for (const [id, entry] of this.entries) {
				if (deviceId === undefined || entry.deviceId === deviceId) {
					victim = id;
					break;
				}
			}
			if (victim === null) return;
			this.remove(victim);
		}
	}

	private prune(now: number): void {
		for (const [id, entry] of this.entries) {
			if (entry.expiresAt <= now) this.remove(id);
		}
	}

	private remove(id: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.totalBytes -= entry.bytes;
		this.entries.delete(id);
	}
}

/**
 * CSP dei prototipi: la stessa che Studio applica a `studio_preview` sul server
 * loopback (script inline piu' i CDN di React, Babel e Tailwind; niente
 * `connect-src`, quindi fetch e WebSocket bloccati). `sandbox allow-scripts` toglie
 * l'origine anche a chi apre l'indirizzo fuori dall'iframe, e `frame-ancestors`
 * lo lascia incorniciare solo dalla PWA del relay stesso.
 */
const PREVIEW_CSP = [
	"default-src 'none'",
	"script-src 'unsafe-inline' https://unpkg.com https://cdn.tailwindcss.com",
	"style-src 'unsafe-inline' https:",
	'img-src https: data: blob:',
	'font-src https: data:',
	'media-src https: data: blob:',
	"base-uri 'none'",
	"form-action 'none'",
	'sandbox allow-scripts',
	"frame-ancestors 'self'"
].join('; ');

const PREVIEW_HEADERS: Record<string, string> = {
	'Content-Type': 'text/html; charset=utf-8',
	'Content-Security-Policy': PREVIEW_CSP,
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer',
	'Cache-Control': 'no-store'
};

/** Serve `GET /p/<id>/`; `rest` e' il percorso dopo il prefisso (`<id>` o `<id>/`). */
export function servePreview(req: Request, rest: string, previews: PreviewStore): Response {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		return new Response('Method not allowed', { status: 405, headers: PREVIEW_HEADERS });
	}
	const id = rest.endsWith('/') ? rest.slice(0, -1) : rest;
	const html = previews.get(id, Date.now());
	if (html === null) {
		return new Response('Not found', {
			status: 404,
			headers: { ...PREVIEW_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }
		});
	}
	return new Response(req.method === 'HEAD' ? null : html, { headers: PREVIEW_HEADERS });
}
