/**
 * Quale macchina notifica (R-MI-31). Con due Studio collegati lo stesso evento
 * (agente che finisce, domanda in attesa) arriva su tutte e due, e l'utente,
 * davanti a un solo computer, riceveva l'avviso due volte o lo perdeva su
 * quello che non guardava. Notifica solo la macchina usata per ultima.
 *
 * «Usata per ultima» si misura con i secondi di inattività che ogni macchina
 * legge da sé: è una durata, quindi resta confrontabile anche con gli
 * orologi delle macchine sfasati, a differenza di un orario.
 */

/** Oltre questa inattività su tutte le macchine l'utente non è davanti a nessuna: notificano tutte. */
export const EVERYONE_IDLE_SECONDS = 10 * 60;

export interface PresenceSample {
	/** Id stabile della macchina (lo stesso visto da tutte), per spareggiare. */
	machineId: string;
	/** Secondi senza input dell'utente; `null` se il sistema non lo dice o la macchina non ha risposto. */
	idleSeconds: number | null;
}

/**
 * Questa macchina deve notificare? Nel dubbio sì: un avviso doppio è meglio
 * di uno perso, quindi senza la misura di qui o senza risposte dalle altre si
 * notifica. A parità di inattività vince l'id minore, la stessa scelta vista
 * da tutte le macchine.
 */
export function notifiesHere(
	here: PresenceSample,
	others: readonly PresenceSample[],
	everyoneIdleSeconds = EVERYONE_IDLE_SECONDS
): boolean {
	if (here.idleSeconds === null) return true;
	const measured = others.filter((sample) => sample.idleSeconds !== null);
	if (measured.length === 0) return true;
	const all = [here, ...measured] as Array<PresenceSample & { idleSeconds: number }>;
	if (all.every((sample) => sample.idleSeconds > everyoneIdleSeconds)) return true;
	const latest = all.reduce((best, sample) =>
		sample.idleSeconds < best.idleSeconds ||
		(sample.idleSeconds === best.idleSeconds && sample.machineId < best.machineId)
			? sample
			: best
	);
	return latest.machineId === here.machineId;
}
