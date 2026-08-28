/**
 * Allowlist dei protocolli per l'apertura di indirizzi esterni.
 *
 * Gli URL che Studio apre non arrivano solo dall'utente: arrivano da eventi
 * RPC dell'agente, da risultati di tool (ricerca web, GitHub), da link nel
 * markdown e dal testo del terminale, cioe' da contenuto che un modello puo'
 * avere letto in rete. Senza allowlist un `file:`, un `javascript:` o uno
 * schema registrato da un'altra applicazione aprirebbe qualcosa di locale su
 * richiesta di un contenuto remoto.
 *
 * Il modulo resta privo di dipendenze da Tauri per poter essere verificato
 * dagli smoke test: l'apertura vera vive in `openExternal.ts`.
 */

/** Gli unici protocolli che Studio apre senza chiedere niente all'utente. */
export const ALLOWED_EXTERNAL_PROTOCOLS = ['http:', 'https:', 'mailto:'] as const;

/**
 * Vero solo per URL assoluti con un protocollo ammesso. Gli indirizzi
 * relativi (che nel markdown sono percorsi di file del progetto) e gli URL
 * malformati sono esclusi: `new URL` fallisce e il chiamante decide.
 */
export function isAllowedExternalUrl(raw: unknown): raw is string {
	if (typeof raw !== 'string' || raw.trim() === '') return false;
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return false;
	}
	return (ALLOWED_EXTERNAL_PROTOCOLS as readonly string[]).includes(parsed.protocol);
}
