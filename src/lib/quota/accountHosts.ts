/**
 * Attribuzione di chi sta consumando quota ai singoli account di un provider.
 * Modulo puro: niente store, cosi' e' testabile e condiviso fra le superfici.
 */
import type { QuotaReport } from '../stores/quota.svelte';
import { providersMatch } from './providers';

export interface HostAccountRef {
	provider: string;
	/** Hash `credential_pin` che omp scrive nel transcript della sessione. */
	credential_pin?: string;
}

/**
 * Indice del report (account) su cui lavora l'host, o `undefined` se non si sa.
 *
 * omp lega l'account alla sessione e lo registra come `credential_pin`: quando
 * c'e' decide lui. Senza pin (o con un pin che non corrisponde a nessun account
 * noto) l'host si attribuisce solo se il provider ha un unico account:
 * con due account dirlo "in uso" su entrambi sarebbe falso.
 *
 * `pinHashes[i]` e' l'hash calcolato sulle credenziali di `reports[i]`.
 */
export function reportIndexForHost(
	host: HostAccountRef,
	reports: readonly QuotaReport[],
	pinHashes: readonly (string | undefined)[]
): number | undefined {
	let single: number | undefined;
	let candidates = 0;
	for (let i = 0; i < reports.length; i++) {
		if (!providersMatch(reports[i].provider, host.provider)) continue;
		if (host.credential_pin && pinHashes[i] === host.credential_pin) return i;
		candidates++;
		single = i;
	}
	return candidates === 1 ? single : undefined;
}
