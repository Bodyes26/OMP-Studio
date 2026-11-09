/**
 * Testi delle notifiche Web Push nelle due lingue della UI.
 *
 * Il rilevatore di trigger emette il contenuto strutturato (macchina, progetto,
 * richiesta, fornitore...) piu' una resa inglese predefinita: chi si e'
 * sottoscritto senza dichiarare la lingua (client vecchi, abbinamento fatto
 * prima di questo campo) riceve l'inglese. Chi ha dichiarato `it` riceve la
 * resa italiana, calcolata al momento dell'invio perche' la lingua vive sulla
 * sottoscrizione, non sul processo del relay.
 */

import type { PushNotificationPayload, PushNotificationText } from './protocol.ts';

export type PushLanguage = 'it' | 'en';

/** Lingua dichiarata da un dispositivo: qualunque cosa che non sia `it` vale inglese. */
export function normalizePushLanguage(value: unknown): PushLanguage {
	return typeof value === 'string' && value.toLowerCase().startsWith('it') ? 'it' : 'en';
}

const STRINGS = {
	it: {
		attention: 'Domanda',
		attentionSuffix: 'domanda',
		quotaExhausted: 'Quota esaurita',
		providerError: 'Errore fornitore',
		quotaBlockedSuffix: 'blocco di quota',
		quotaProviderPrefix: 'Quota esaurita per',
		laneFinishedSuffix: 'ha finito',
		laneFallback: 'Corsia'
	},
	en: {
		attention: 'Question',
		attentionSuffix: 'question',
		quotaExhausted: 'Quota exhausted',
		providerError: 'Provider error',
		quotaBlockedSuffix: 'quota block',
		quotaProviderPrefix: 'Quota exhausted for',
		laneFinishedSuffix: 'finished',
		laneFallback: 'Lane'
	}
} as const;

function composeTitle(parts: PushNotificationText): string {
	if (parts.kind === 'quota_provider_exhausted') return parts.hostName;
	return parts.projectName ? `${parts.hostName} · ${parts.projectName}` : parts.hostName;
}

function composeBody(parts: PushNotificationText, lang: PushLanguage): string {
	const s = STRINGS[lang];
	switch (parts.kind) {
		case 'attention': {
			const question = parts.question?.trim();
			return question ? `${question}: ${s.attentionSuffix}` : s.attention;
		}
		case 'quota_blocked': {
			const reason = parts.reason === 'quota_exhausted' ? s.quotaExhausted : s.providerError;
			const providerInfo = parts.provider ? ` (${parts.provider})` : '';
			return `${reason}${providerInfo}: ${s.quotaBlockedSuffix}`;
		}
		case 'quota_provider_exhausted': {
			const account = parts.account ? ` (${parts.account})` : '';
			return `${s.quotaProviderPrefix} ${parts.provider ?? ''}${account}`;
		}
		case 'lane_idle': {
			const laneTitle = parts.laneTitle?.trim() || s.laneFallback;
			return `${laneTitle}: ${s.laneFinishedSuffix}`;
		}
	}
}

/** Titolo e corpo della notifica nella lingua richiesta. */
export function renderPushText(parts: PushNotificationText, lang: PushLanguage): { title: string; body: string } {
	return { title: composeTitle(parts), body: composeBody(parts, lang) };
}

/**
 * Payload pronto per un dispositivo: se il contenuto strutturato c'e' viene
 * ricomposto nella sua lingua, altrimenti resta quello gia' presente
 * (notifiche emesse da altri punti del relay o testo inviato diretto).
 */
export function localizePushPayload(
	payload: PushNotificationPayload,
	lang: PushLanguage
): PushNotificationPayload {
	const parts = payload.data?.text;
	if (!parts) return payload;
	const { title, body } = renderPushText(parts, lang);
	return { ...payload, title, body };
}
