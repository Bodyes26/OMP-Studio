/**
 * Unico punto da cui Studio apre un indirizzo nel browser di sistema.
 *
 * Passare sempre da qui evita che un nuovo chiamante dimentichi il controllo
 * del protocollo: `openUrl` di per se' aprirebbe qualunque schema noto al
 * sistema operativo.
 */

import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isAllowedExternalUrl } from './externalUrl';

/**
 * Apre l'indirizzo se il protocollo e' ammesso. Restituisce `false` quando
 * l'apertura e' stata rifiutata o non e' riuscita, cosi' il chiamante puo'
 * ripiegare su un'altra azione (per esempio aprire un file del progetto).
 */
export async function openExternalUrl(raw: unknown): Promise<boolean> {
	if (!isAllowedExternalUrl(raw)) {
		console.warn('Apertura esterna bloccata: protocollo non ammesso', raw);
		return false;
	}
	if (!isTauri()) {
		const opened = window.open('', '_blank');
		if (!opened) return false;
		opened.opener = null;
		opened.location.href = raw;
		return true;
	}
	try {
		await openUrl(raw);
		return true;
	} catch (error) {
		console.error('Apertura esterna non riuscita', error);
		return false;
	}
}
