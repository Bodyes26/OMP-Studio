/**
 * Servizio di invio notifiche Web Push verso i dispositivi abbinati.
 * Gestisce cifratura del payload (RFC 8291), intestazioni VAPID (RFC 8292),
 * rimozione delle sottoscrizioni scadute (HTTP 404/410) e rate limiting per dispositivo.
 */

import type { PushNotificationPayload } from './protocol.ts';
import { encryptPushPayload } from './pushCrypto.ts';
import type { PushSubscriptionRecord, RelayStore } from './store.ts';
import { createVapidHeaders, isValidPushEndpoint, type VapidKeyPair } from './vapid.ts';

export interface PushSendResult {
	totalSubscriptions: number;
	sent: number;
	failed: number;
	dropped: number;
	skippedVisible: number;
	rateLimited: number;
}

export interface PushSenderOptions {
	skipDeviceIds?: Set<string>;
	targetDeviceId?: string;
	fetchFn?: typeof fetch;
	extraAllowedHosts?: readonly string[];
	urgency?: 'very-low' | 'low' | 'normal' | 'high';
	ttlSeconds?: number;
}

/** Tetto rate limit per dispositivo: minimo intervallo in millisecondi tra due notifiche (es. 4 secondi) */
export const MIN_DEVICE_PUSH_INTERVAL_MS = 4_000;

export class PushSender {
	private readonly lastPushPerDevice = new Map<string, number>();

	constructor(
		private readonly store: RelayStore,
		private readonly vapidKeys: VapidKeyPair,
		private readonly fetchFn: typeof fetch = globalThis.fetch
	) {}

	/**
	 * Verifica se l'invio verso un dispositivo e' consentito dal rate limiter.
	 */
	private checkDeviceRateLimit(deviceId: string, now: number): boolean {
		const lastSent = this.lastPushPerDevice.get(deviceId) ?? 0;
		if (now - lastSent < MIN_DEVICE_PUSH_INTERVAL_MS) {
			return false;
		}
		this.lastPushPerDevice.set(deviceId, now);
		return true;
	}

	/**
	 * Invia una notifica push a tutti i dispositivi abbinati idonei.
	 */
	async send(
		payload: PushNotificationPayload,
		options?: PushSenderOptions
	): Promise<PushSendResult> {
		const now = Date.now();
		const fetchImpl = options?.fetchFn ?? this.fetchFn;
		const skipDeviceIds = options?.skipDeviceIds ?? new Set<string>();

		const subscriptions = options?.targetDeviceId
			? this.store.getPushSubscriptionsForDevice(options.targetDeviceId)
			: this.store.getAllPushSubscriptions();

		const result: PushSendResult = {
			totalSubscriptions: subscriptions.length,
			sent: 0,
			failed: 0,
			dropped: 0,
			skippedVisible: 0,
			rateLimited: 0
		};

		const jsonPayload = JSON.stringify(payload);

		// Valuta idoneita' di ciascun dispositivo una sola volta per notifica
		const deviceEligibility = new Map<string, boolean>();
		for (const sub of subscriptions) {
			if (!deviceEligibility.has(sub.deviceId)) {
				if (skipDeviceIds.has(sub.deviceId)) {
					deviceEligibility.set(sub.deviceId, false);
				} else if (!this.checkDeviceRateLimit(sub.deviceId, now)) {
					deviceEligibility.set(sub.deviceId, false);
					result.rateLimited++;
				} else {
					deviceEligibility.set(sub.deviceId, true);
				}
			}
		}

		for (const sub of subscriptions) {
			// Salta i dispositivi che hanno una finestra o tab visibile ed attiva
			if (skipDeviceIds.has(sub.deviceId)) {
				result.skippedVisible++;
				continue;
			}

			// Salta se il dispositivo e' rate-limited
			if (!deviceEligibility.get(sub.deviceId)) {
				continue;
			}

			// Protezione SSRF al momento dell'invio: se l'endpoint non e' consentito, viene rimosso
			if (!isValidPushEndpoint(sub.endpoint, { extraAllowedHosts: options?.extraAllowedHosts })) {
				this.store.deletePushSubscription(sub.endpoint);
				result.dropped++;
				continue;
			}
			try {
				const encryptedBody = await encryptPushPayload(jsonPayload, {
					p256dh: sub.p256dh,
					auth: sub.auth
				});

				const vapidHeaders = await createVapidHeaders(sub.endpoint, this.vapidKeys, {
					ttlSeconds: options?.ttlSeconds,
					urgency: options?.urgency ?? 'high'
				});

				const res = await fetchImpl(sub.endpoint, {
					method: 'POST',
					headers: {
						...vapidHeaders,
						'Content-Type': 'application/octet-stream',
						'Content-Encoding': 'aes128gcm'
					},
					body: encryptedBody,
					redirect: 'error'
				});

				if (res.status === 200 || res.status === 201 || res.status === 202) {
					result.sent++;
				} else if (res.status === 404 || res.status === 410) {
					// 404 Not Found o 410 Gone: la sottoscrizione e' scaduta sul servizio push del browser
					this.store.deletePushSubscription(sub.endpoint);
					result.dropped++;
				} else {
					result.failed++;
				}
			} catch {
				result.failed++;
			}
		}

		return result;
	}
}
