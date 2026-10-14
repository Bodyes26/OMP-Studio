import type { webcrypto } from 'node:crypto';
type JsonWebKey = webcrypto.JsonWebKey;
/**
 * Gestione chiavi VAPID e autenticazione RFC 8292 per Web Push.
 * Genera chiavi P-256, firma token JWT ES256 e valida parametri di sottoscrizione.
 */

import type { RelayStore } from './store.ts';

export interface VapidKeyPair {
	publicKey: string; // Base64url chiave pubblica P-256 non compressa (65 byte)
	privateKeyJwk: JsonWebKey;
	signKey: CryptoKey;
}

export const DEFAULT_VAPID_SUBJECT = 'mailto:admin@omp.local';
export const DEFAULT_PUSH_TTL_SECONDS = 300;

/**
 * Recupera la coppia di chiavi VAPID da SQLite o ne genera una nuova salvandola.
 * Garantisce stabilita' dell'identita' del relay tra riavvii del server/container.
 */
export async function getOrCreateVapidKeys(store: RelayStore): Promise<VapidKeyPair> {
	const existing = store.getVapidKeys();
	if (existing) {
		try {
			const jwk = JSON.parse(existing.privateKey) as JsonWebKey;
			const signKey = await crypto.subtle.importKey(
				'jwk',
				jwk,
				{ name: 'ECDSA', namedCurve: 'P-256' },
				false,
				['sign']
			);
			return {
				publicKey: existing.publicKey,
				privateKeyJwk: jwk,
				signKey
			};
		} catch {
			// Se il record nel database e' corrotto, rigenera la coppia
		}
	}

	const keyPair = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign', 'verify']
	);

	const rawPub = await crypto.subtle.exportKey('raw', keyPair.publicKey);
	const publicKey = Buffer.from(rawPub).toString('base64url');
	const privateKeyJwk = (await crypto.subtle.exportKey('jwk', keyPair.privateKey)) as JsonWebKey;

	store.saveVapidKeys(publicKey, JSON.stringify(privateKeyJwk), Date.now());

	return {
		publicKey,
		privateKeyJwk,
		signKey: keyPair.privateKey
	};
}

/**
 * Crea le intestazioni HTTP per l'invio Web Push (Authorization con VAPID JWT secondo RFC 8292, TTL, Urgency).
 */
export async function createVapidHeaders(
	endpoint: string,
	vapidKeys: VapidKeyPair,
	options?: {
		subject?: string;
		ttlSeconds?: number;
		urgency?: 'very-low' | 'low' | 'normal' | 'high';
	}
): Promise<Record<string, string>> {
	const url = new URL(endpoint);
	const audience = `${url.protocol}//${url.host}`;
	const nowSeconds = Math.floor(Date.now() / 1000);
	const exp = nowSeconds + 12 * 3600; // 12 ore di validita' (max consentito: 24h)
	const subject = options?.subject || DEFAULT_VAPID_SUBJECT;

	const header = { typ: 'JWT', alg: 'ES256' };
	const payload = { aud: audience, exp, sub: subject };

	const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
	const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const dataToSign = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);

	const sig = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		vapidKeys.signKey,
		dataToSign
	);
	const encodedSig = Buffer.from(sig).toString('base64url');
	const token = `${encodedHeader}.${encodedPayload}.${encodedSig}`;

	return {
		'TTL': String(options?.ttlSeconds ?? DEFAULT_PUSH_TTL_SECONDS),
		'Urgency': options?.urgency ?? 'high',
		'Authorization': `vapid t=${token}, k=${vapidKeys.publicKey}`
	};
}

/**
 * Domini consentiti per i servizi Web Push dei principali browser (Chrome, Firefox, Safari, Edge).
 * Previene attacchi SSRF (Server-Side Request Forgery) verso host interni o arbitrari.
 */
export const ALLOWED_PUSH_HOST_PATTERNS = [
	'fcm.googleapis.com',
	'android.googleapis.com',
	'.push.services.mozilla.com',
	'push.services.mozilla.com',
	'.push.apple.com',
	'push.apple.com',
	'.notify.windows.com'
] as const;

/**
 * Verifica se un hostname appartiene all'allowlist dei servizi push dei browser.
 */
export function isAllowedPushHost(hostname: string, extraAllowedHosts?: readonly string[]): boolean {
	const host = hostname.toLowerCase();
	const patterns = extraAllowedHosts
		? [...ALLOWED_PUSH_HOST_PATTERNS, ...extraAllowedHosts]
		: ALLOWED_PUSH_HOST_PATTERNS;
	for (const pattern of patterns) {
		if (pattern.startsWith('.')) {
			if (host.endsWith(pattern) && host.length > pattern.length) {
				return true;
			}
		} else if (host === pattern) {
			return true;
		}
	}
	return false;
}

/**
 * Valida un URL di endpoint di sottoscrizione push: deve essere HTTPS e appartenere ai servizi push ammessi.
 */
export function isValidPushEndpoint(endpoint: unknown, options?: { extraAllowedHosts?: readonly string[] }): endpoint is string {
	if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
		return false;
	}
	try {
		const u = new URL(endpoint);
		if (u.protocol !== 'https:' || !u.hostname) return false;
		return isAllowedPushHost(u.hostname, options?.extraAllowedHosts);
	} catch {
		return false;
	}
}

/**
 * Valida la chiave pubblica P-256 (p256dh): deve essere base64url di 65 byte con prefisso 0x04.
 */
export function isValidP256dh(p256dh: unknown): p256dh is string {
	if (typeof p256dh !== 'string') return false;
	try {
		const buf = Buffer.from(p256dh.replace(/\s+/g, ''), 'base64url');
		return buf.length === 65 && buf[0] === 0x04;
	} catch {
		return false;
	}
}

/**
 * Valida il segreto di autenticazione client (auth): deve essere base64url di 16 byte.
 */
export function isValidAuth(auth: unknown): auth is string {
	if (typeof auth !== 'string') return false;
	try {
		const buf = Buffer.from(auth.replace(/\s+/g, ''), 'base64url');
		return buf.length === 16;
	} catch {
		return false;
	}
}
