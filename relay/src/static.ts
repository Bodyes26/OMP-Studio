import { existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';

const HOST_PATTERN = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;

const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8'
};

function buildPwaCsp(host: string | null): string {
	const sockets = host && HOST_PATTERN.test(host) ? ` wss://${host} ws://${host}` : '';
	return [
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		`connect-src 'self'${sockets}`,
		"manifest-src 'self'",
		"worker-src 'self'",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'"
	].join('; ');
}

/**
 * Serve i file statici della PWA compilata con gestione della navigazione SPA e
 * blocco rigoroso del path traversal.
 */
export function servePwa(req: Request, webDir: string): Response {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		return new Response('Method not allowed', {
			status: 405,
			headers: {
				'X-Content-Type-Options': 'nosniff',
				'Referrer-Policy': 'no-referrer',
				'Content-Type': 'text/plain; charset=utf-8'
			}
		});
	}

	if (!existsSync(webDir)) {
		return new Response('PWA not built', {
			status: 503,
			headers: {
				'X-Content-Type-Options': 'nosniff',
				'Referrer-Policy': 'no-referrer',
				'Content-Type': 'text/plain; charset=utf-8'
			}
		});
	}

	const indexPath = resolve(webDir, 'index.html');
	if (!existsSync(indexPath)) {
		return new Response('PWA not built', {
			status: 503,
			headers: {
				'X-Content-Type-Options': 'nosniff',
				'Referrer-Policy': 'no-referrer',
				'Content-Type': 'text/plain; charset=utf-8'
			}
		});
	}

	const url = new URL(req.url);
	let pathname: string;
	try {
		pathname = decodeURIComponent(url.pathname);
	} catch {
		return new Response('Bad request', { status: 400 });
	}

	// Verifica contenimento: qualsiasi tentativo di salire sopra webDir viene bloccato.
	const targetPath = resolve(webDir, '.' + pathname);
	const rel = relative(webDir, targetPath);
	if (rel.startsWith('..') || isAbsolute(rel)) {
		return new Response('Forbidden', {
			status: 403,
			headers: {
				'X-Content-Type-Options': 'nosniff',
				'Referrer-Policy': 'no-referrer',
				'Content-Type': 'text/plain; charset=utf-8'
			}
		});
	}

	let finalPath = targetPath;
	let isSpa = false;
	const fileStat = existsSync(targetPath) ? statSync(targetPath, { throwIfNoEntry: false }) : null;

	if (fileStat && fileStat.isFile()) {
		finalPath = targetPath;
	} else {
		// Non effettua fallback su percorsi di API o diagnostica se finiscono qui.
		if (pathname.startsWith('/v1/') || pathname === '/healthz' || pathname.startsWith('/diag')) {
			return new Response('Not found', {
				status: 404,
				headers: {
					'X-Content-Type-Options': 'nosniff',
					'Referrer-Policy': 'no-referrer',
					'Content-Type': 'text/plain; charset=utf-8'
				}
			});
		}
		finalPath = indexPath;
		isSpa = true;
	}

	const ext = extname(finalPath).toLowerCase();
	const contentType = MIME_TYPES[ext] || 'application/octet-stream';

	let cacheControl = 'no-cache';
	if (!isSpa && pathname.startsWith('/assets/')) {
		cacheControl = 'public, max-age=31536000, immutable';
	} else if (
		finalPath === indexPath ||
		pathname.endsWith('/sw.js') ||
		pathname.endsWith('/manifest.webmanifest')
	) {
		cacheControl = 'no-cache';
	}

	const headers: Record<string, string> = {
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'no-referrer',
		'Content-Security-Policy': buildPwaCsp(req.headers.get('host')),
		'Content-Type': contentType,
		'Cache-Control': cacheControl
	};

	if (req.method === 'HEAD') {
		return new Response(null, { status: 200, headers });
	}

	return new Response(Bun.file(finalPath), { status: 200, headers });
}
