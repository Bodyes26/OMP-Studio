import { describe, expect, it } from 'bun:test';
import type { Server } from 'bun';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRequest } from '../src/api.ts';
import { hashSecret } from '../src/auth.ts';
import type { RelayConfig } from '../src/config.ts';
import {
	PREVIEW_MAX_ENTRIES_PER_DEVICE,
	PREVIEW_TTL_MS,
	PreviewStore
} from '../src/previews.ts';
import { API, PREVIEW_MAX_HTML_BYTES, SESSION_COOKIE } from '../src/protocol.ts';
import { RateLimiter } from '../src/ratelimit.ts';
import { SocketHub, type RelayWsData } from '../src/sockets.ts';
import { RelayStore } from '../src/store.ts';

const ORIGIN = 'http://127.0.0.1:8787';
const dummyServer = { requestIP: () => ({ address: '127.0.0.1' }) } as unknown as Server<RelayWsData>;

function harness() {
	const dir = mkdtempSync(join(tmpdir(), 'preview-'));
	const config: RelayConfig = {
		port: 8787,
		hostname: '127.0.0.1',
		adminToken: 'test-admin-secret-0123456789abcdef0123456789',
		authTimeoutMs: 5000,
		heartbeatMs: 25000,
		maxDiagSessions: 4,
		dataDir: dir,
		webDir: '/tmp',
		version: '1.0.0'
	};
	const store = new RelayStore(dir);
	const hub = new SocketHub(config, store);
	const previews = new PreviewStore();
	const token = 'preview-session-token-0123456789abcdef';
	const device = store.createDevice('iPhone', hashSecret(token), Date.now());
	const call = (path: string, init: RequestInit = {}) =>
		handleRequest(new Request(`${ORIGIN}${path}`, init), dummyServer, config, store, new RateLimiter(), hub, previews);
	// Sul filo `Content-Length` lo aggiunge il browser; una Request costruita a mano no.
	const publish = (html: string, headers: Record<string, string> = {}) => {
		const body = JSON.stringify({ html });
		return call(API.preview, {
			method: 'POST',
			headers: {
				origin: ORIGIN,
				cookie: `${SESSION_COOKIE}=${token}`,
				'content-type': 'application/json',
				'content-length': String(Buffer.byteLength(body)),
				...headers
			},
			body
		});
	};
	const cleanup = () => {
		hub.stop();
		rmSync(dir, { recursive: true, force: true });
	};
	return { call, publish, previews, device, cleanup };
}

describe('PreviewStore', () => {
	it('conserva solo gli ultimi documenti di ogni dispositivo senza toccare quelli degli altri', () => {
		const store = new PreviewStore();
		const now = 1_000;
		const other = store.put('b', '<p>altro</p>', now)!;
		const ids: string[] = [];
		for (let i = 0; i < PREVIEW_MAX_ENTRIES_PER_DEVICE + 1; i++) ids.push(store.put('a', `<p>${i}</p>`, now)!);

		expect(store.get(ids[0]!, now)).toBeNull();
		expect(store.get(ids[1]!, now)).toBe('<p>1</p>');
		expect(store.get(other, now)).toBe('<p>altro</p>');
	});

	it('fa scadere il documento e rifiuta id che non sono quelli generati', () => {
		const store = new PreviewStore();
		const id = store.put('a', '<p>x</p>', 0)!;
		expect(store.get(id, PREVIEW_TTL_MS - 1)).toBe('<p>x</p>');
		expect(store.get(id, PREVIEW_TTL_MS)).toBeNull();
		expect(store.get('../etc/passwd', 0)).toBeNull();
		expect(store.get('0'.repeat(32), 0)).toBeNull();
	});

	it('rifiuta documenti vuoti o oltre il tetto', () => {
		const store = new PreviewStore();
		expect(store.put('a', '', 0)).toBeNull();
		expect(store.put('a', 'x'.repeat(PREVIEW_MAX_HTML_BYTES + 1), 0)).toBeNull();
		expect(store.put('a', 'x'.repeat(PREVIEW_MAX_HTML_BYTES), 0)).not.toBeNull();
	});

	it('toglie i documenti di un dispositivo revocato', () => {
		const store = new PreviewStore();
		const mine = store.put('a', '<p>a</p>', 0)!;
		const theirs = store.put('b', '<p>b</p>', 0)!;
		store.removeForDevice('a');
		expect(store.get(mine, 0)).toBeNull();
		expect(store.get(theirs, 0)).toBe('<p>b</p>');
	});
});

describe('API anteprime dei prototipi', () => {
	it('pubblica, poi serve il documento con CSP e sandbox senza chiedere il cookie', async () => {
		const h = harness();
		try {
			const res = await h.publish('<script>document.title=1</script>');
			expect(res.status).toBe(200);
			const { url } = (await res.json()) as { url: string };
			expect(url).toMatch(/^\/p\/[0-9a-f]{32}\/$/);

			const page = await h.call(url);
			expect(page.status).toBe(200);
			expect(await page.text()).toBe('<script>document.title=1</script>');
			const csp = page.headers.get('content-security-policy') ?? '';
			expect(csp).toContain('sandbox allow-scripts');
			expect(csp).toContain("frame-ancestors 'self'");
			expect(csp).not.toContain('connect-src');
			expect(page.headers.get('cache-control')).toBe('no-store');
		} finally {
			h.cleanup();
		}
	});

	it('rifiuta chi non ha sessione, chi manca di Origin e i corpi troppo grandi', async () => {
		const h = harness();
		try {
			const anonymous = await h.call(API.preview, {
				method: 'POST',
				headers: { origin: ORIGIN, 'content-type': 'application/json', 'content-length': '20' },
				body: JSON.stringify({ html: '<p>x</p>' })
			});
			expect(anonymous.status).toBe(401);

			const crossOrigin = await h.publish('<p>x</p>', { origin: 'https://evil.example' });
			expect(crossOrigin.status).toBe(403);

			const tooLarge = await h.publish('x'.repeat(PREVIEW_MAX_HTML_BYTES + 1));
			expect(tooLarge.status).toBe(413);
		} finally {
			h.cleanup();
		}
	});

	it('risponde 404 per id sconosciuti e non espone le anteprime con metodi diversi da GET', async () => {
		const h = harness();
		try {
			expect((await h.call(`/p/${'a'.repeat(32)}/`)).status).toBe(404);
			expect((await h.call(`/p/${'a'.repeat(32)}/`, { method: 'POST' })).status).toBe(405);
		} finally {
			h.cleanup();
		}
	});
});
