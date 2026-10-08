/**
 * Orologio dei task programmati (Gate R3X-coda-reset).
 *
 * Niente `setTimeout` lunghi fino al reset: con il PC in standby scadono in
 * ritardo o tutti insieme. Si controlla invece a passo fisso (30 s), al
 * ritorno del fuoco o della visibilita' e al risveglio dallo standby, che si
 * riconosce da un salto fra due giri molto piu' lungo del passo.
 *
 * Le dipendenze dall'ambiente (tempo, timer, eventi) entrano come parametri:
 * i test le sostituiscono e verificano i giri senza aspettare.
 */

export const SCHEDULE_TICK_MS = 30_000;
/** Oltre questo ritardo rispetto al passo atteso il giro conta come risveglio. */
export const SCHEDULE_WAKE_GAP_MS = 60_000;

export type ScheduleTickReason = 'start' | 'interval' | 'focus' | 'visible' | 'wake' | 'manual';

export interface ScheduleClockEnv {
	now: () => number;
	setInterval: (fn: () => void, ms: number) => unknown;
	clearInterval: (handle: unknown) => void;
	/** Registra un ascoltatore e restituisce la funzione che lo rimuove. */
	listen?: (event: 'focus' | 'visible', fn: () => void) => () => void;
}

export interface ScheduleClock {
	/** Giro immediato, per esempio dopo una modifica della coda. */
	tick: (reason?: ScheduleTickReason) => void;
	dispose: () => void;
}

/** Il giro arriva troppo tardi rispetto al passo: il sistema era sospeso. */
export function isWakeGap(previous: number, now: number, intervalMs = SCHEDULE_TICK_MS): boolean {
	return now - previous > intervalMs + SCHEDULE_WAKE_GAP_MS;
}

export function createScheduleClock(
	env: ScheduleClockEnv,
	onTick: (now: number, reason: ScheduleTickReason) => void,
	intervalMs = SCHEDULE_TICK_MS
): ScheduleClock {
	let last = env.now();
	let disposed = false;

	const tick = (reason: ScheduleTickReason) => {
		if (disposed) return;
		const now = env.now();
		const effective = reason === 'interval' && isWakeGap(last, now, intervalMs) ? 'wake' : reason;
		last = now;
		onTick(now, effective);
	};

	const handle = env.setInterval(() => tick('interval'), intervalMs);
	const unlisten = [
		env.listen?.('focus', () => tick('focus')),
		env.listen?.('visible', () => tick('visible'))
	].filter((fn): fn is () => void => typeof fn === 'function');

	tick('start');

	return {
		tick: (reason = 'manual') => tick(reason),
		dispose: () => {
			if (disposed) return;
			disposed = true;
			env.clearInterval(handle);
			for (const fn of unlisten) fn();
		}
	};
}

/**
 * Prima di avviare un task «al reset» si chiede a omp uno snapshot forzato:
 * il verdetto puo' venire da un dato vecchio fino a 90 s. Al massimo una
 * conferma al minuto per task, perche' un reset non ancora visto dal
 * provider non diventi un `omp usage` a ogni giro.
 */
export const SCHEDULE_CONFIRM_COOLDOWN_MS = 60_000;

export function canConfirmNow(lastConfirmAt: number | undefined, now: number): boolean {
	return lastConfirmAt === undefined || now - lastConfirmAt >= SCHEDULE_CONFIRM_COOLDOWN_MS;
}
