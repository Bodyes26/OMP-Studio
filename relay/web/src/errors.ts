import type { CommandErrorCode, CommandError } from '../../src/protocol.ts';
import { t, type MessageKey } from './i18n.ts';

const ERROR_MESSAGE_KEYS: Record<CommandErrorCode, MessageKey> = {
	host_offline: 'errHostOffline',
	timeout: 'errTimeout',
	unsupported: 'errUnsupported',
	not_found: 'errNotFound',
	rejected: 'errRejected',
	disabled: 'errDisabled',
	failed: 'errFailed'
};

/**
 * Mappa il codice di errore di un comando remoto nella corrispondente etichetta localizzata.
 * Se l'errore contiene un messaggio specifico (`error.message`), lo affianca al testo canonico.
 */
export function formatCommandError(error?: CommandError | null): string {
	if (!error) {
		return t('errUnknown');
	}
	const key = ERROR_MESSAGE_KEYS[error.code];
	const base = key ? t(key) : t('errUnknown');
	if (error.message && error.message.trim() && error.message !== error.code) {
		return `${base}: ${error.message}`;
	}
	return base;
}
