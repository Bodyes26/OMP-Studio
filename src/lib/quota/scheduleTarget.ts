/**
 * Da task programmato a finestra di quota (Gate R35).
 *
 * Modulo puro: riceve i report di `omp usage --json` e la configurazione dei
 * ruoli invece di leggerli dagli store, cosi' gli smoke test lo verificano con
 * il solo type-stripping di Node.
 *
 * Percorso: ruolo del task (o `modelSelector` esplicito) → selettore
 * `provider/model` → report di quel provider (tutti gli account) → limiti
 * della famiglia del modello (`familyLimits`, per gli aggregatori). L'orario
 * del reset si rilegge a ogni giro: il provider puo' spostarlo e omp puo'
 * ruotare le credenziali, quindi `TaskSchedule.notBefore` vale solo come
 * stima quando i dati mancano (Principio 7: nessun dato inventato).
 */

import type { QuotaLimit, QuotaReport } from '../stores/quota.svelte';
import type { StudioTask, TaskSchedule, TaskScheduleOrigin } from '../stores/taskSerialization.ts';
import { splitModelSelector } from '../stores/modelSettingsHelpers.ts';
import { familyLimits, modelFamilyFor, remainingFractionOf, shortestWindowLimit } from './resolve.ts';

/** Sotto questa frazione residua una finestra conta come «ferma». */
export const SCHEDULE_QUOTA_THRESHOLD = 0.1;

/**
 * Un reset riletto oltre questo margine dopo quello salvato vuol dire che la
 * finestra e' gia' ripartita: lo scarto copre gli arrotondamenti del provider.
 */
const ROLLOVER_SLACK_MS = 60_000;

export type ScheduleState = 'due' | 'waiting' | 'unknown';

export interface ScheduleTarget {
	state: ScheduleState;
	kind: TaskSchedule['kind'];
	provider?: string;
	limitId?: string;
	/** Etichetta della finestra (`Claude 5 Hour`), quando nota. */
	windowLabel?: string;
	/** Quando diventa (o e' diventato) dovuto, in epoch ms. */
	dueAt?: number;
	/** `dueAt` arriva dal valore salvato alla scelta, non da `omp usage`. */
	estimate: boolean;
}

export interface ScheduleModelInfo {
	provider?: string;
	modelId?: string;
}

/**
 * Provider e modello con cui girerebbe il task: prima il selettore esplicito,
 * poi il ruolo (`default` se assente). Un selettore senza provider resta
 * senza provider: indovinarlo dal nome del modello sbaglierebbe con gli
 * aggregatori.
 */
export function resolveScheduleModel(
	task: Pick<StudioTask, 'options'>,
	modelRoles: Record<string, string | undefined> | null | undefined,
	knownSelectors?: ReadonlySet<string>
): ScheduleModelInfo {
	const explicit = task.options?.modelSelector?.trim();
	const role = task.options?.role?.trim() || 'default';
	const full = explicit || modelRoles?.[role]?.trim() || '';
	if (!full) return {};
	const { base } = splitModelSelector(full, knownSelectors);
	const slash = base.indexOf('/');
	if (slash < 0) return { modelId: base || undefined };
	return {
		provider: base.slice(0, slash) || undefined,
		modelId: base.slice(slash + 1) || undefined
	};
}

function resetOf(limit: QuotaLimit): number | undefined {
	const value = limit.window?.resetsAt ?? limit.resetsAt;
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function labelOf(limit: QuotaLimit | undefined): string | undefined {
	return limit?.label || limit?.window?.label || undefined;
}

interface AccountVerdict {
	due: boolean;
	dueAt?: number;
	limit?: QuotaLimit;
	unknown: boolean;
}

/**
 * Verdetto per un account. Il task e' sbloccato quando tutte le finestre
 * ferme (≤ soglia) della famiglia hanno superato il loro reset. Senza
 * finestre ferme vale la finestra scelta: e' dovuto quando il suo reset e'
 * passato o quando e' gia' ripartita rispetto a quello salvato. Cosi' «al
 * reset» scelto con quota ancora buona aspetta davvero il reset, invece di
 * partire subito.
 */
function accountVerdict(
	limits: QuotaLimit[],
	schedule: TaskSchedule,
	now: number,
	threshold: number
): AccountVerdict {
	const blocking = limits.filter(
		(limit) => limit.status === 'exhausted' || remainingFractionOf(limit) <= threshold
	);
	if (blocking.length > 0) {
		let latest = 0;
		let latestLimit: QuotaLimit | undefined;
		for (const limit of blocking) {
			const reset = resetOf(limit);
			if (reset === undefined) {
				// Ferma senza orario di reset: senza dato non si promette un orario.
				return { due: false, unknown: true, limit };
			}
			if (reset > latest) {
				latest = reset;
				latestLimit = limit;
			}
		}
		return { due: latest <= now, dueAt: latest, limit: latestLimit, unknown: false };
	}

	const chosen =
		(schedule.limitId ? limits.find((limit) => limit.id === schedule.limitId) : undefined) ??
		shortestWindowLimit(limits);
	if (!chosen) return { due: true, dueAt: now, unknown: false };
	const current = resetOf(chosen);
	const saved = schedule.notBefore;
	if (saved === undefined) {
		// Scelto senza orario (dati assenti allora): la quota e' buona, si parte.
		return { due: true, dueAt: now, limit: chosen, unknown: false };
	}
	if (now >= saved) return { due: true, dueAt: saved, limit: chosen, unknown: false };
	if (current !== undefined && current > saved + ROLLOVER_SLACK_MS) {
		return { due: true, dueAt: saved, limit: chosen, unknown: false };
	}
	const dueAt = current !== undefined && current < saved ? current : saved;
	return { due: dueAt <= now, dueAt, limit: chosen, unknown: false };
}

export interface ScheduleTargetInput {
	task: Pick<StudioTask, 'options' | 'schedule'>;
	modelRoles?: Record<string, string | undefined> | null;
	knownSelectors?: ReadonlySet<string>;
	/** Tutti i report dell'ultimo snapshot: il filtro per provider e' qui. */
	reports: QuotaReport[];
	/** `providersMatch` dello store quota (famiglie `openai`/`openai-codex`...). */
	matchProvider: (left: string | undefined, right: string | undefined) => boolean;
	/** C'e' uno snapshot di usage valido (non offline, gia' letto almeno una volta). */
	quotaReady: boolean;
	now: number;
	threshold?: number;
}

/**
 * Dove sta un task programmato rispetto al suo momento di partenza.
 *
 * Con piu' account sullo stesso provider vale il reset piu' vicino: omp
 * ruota le credenziali e un account libero basta. Se e' esaurita la finestra
 * settimanale e non quella di 5 ore, `dueAt` e' il reset settimanale: e' un
 * dato vero e l'interfaccia lo mostra con la data.
 */
export function resolveScheduleTarget(input: ScheduleTargetInput): ScheduleTarget {
	const schedule = input.task.schedule;
	if (!schedule) return { state: 'due', kind: 'at', estimate: false };
	const now = input.now;

	if (schedule.kind === 'at') {
		const dueAt = schedule.notBefore ?? now;
		return {
			state: dueAt <= now ? 'due' : 'waiting',
			kind: 'at',
			dueAt,
			estimate: false
		};
	}

	const model = resolveScheduleModel(input.task, input.modelRoles, input.knownSelectors);
	const provider = schedule.provider || model.provider;
	const estimateTarget = (): ScheduleTarget => ({
		state: 'unknown',
		kind: 'reset',
		provider,
		limitId: schedule.limitId,
		dueAt: schedule.notBefore,
		estimate: schedule.notBefore !== undefined
	});

	if (!provider || !input.quotaReady) return estimateTarget();

	const reports = input.reports.filter((report) => input.matchProvider(report.provider, provider));
	const family = modelFamilyFor(model.modelId);
	const accounts = reports
		.map((report) => familyLimits(report.limits ?? [], family))
		.filter((limits) => limits.length > 0);

	if (accounts.length === 0) {
		// Provider senza limiti in `omp usage` (chiave API, locale): non c'e'
		// un reset da aspettare oltre a quello salvato alla scelta.
		const dueAt = schedule.notBefore ?? now;
		return {
			state: dueAt <= now ? 'due' : 'waiting',
			kind: 'reset',
			provider,
			limitId: schedule.limitId,
			dueAt,
			estimate: schedule.notBefore !== undefined
		};
	}

	const threshold = input.threshold ?? SCHEDULE_QUOTA_THRESHOLD;
	let best: AccountVerdict | null = null;
	for (const limits of accounts) {
		const verdict = accountVerdict(limits, schedule, now, threshold);
		// Un account fermo senza orario non decide: ne basta un altro con il dato.
		if (verdict.unknown) continue;
		if (verdict.due) {
			best = verdict;
			break;
		}
		if (!best || (verdict.dueAt ?? Infinity) < (best.dueAt ?? Infinity)) best = verdict;
	}

	if (!best) return estimateTarget();
	return {
		state: best.due ? 'due' : 'waiting',
		kind: 'reset',
		provider,
		limitId: best.limit?.id ?? schedule.limitId,
		windowLabel: labelOf(best.limit),
		dueAt: best.dueAt,
		estimate: false
	};
}

/**
 * La programmazione «al reset» scelta adesso: fissa provider, finestra e
 * reset letti in questo istante. La finestra e' quella ferma (o, con quota
 * ancora buona, la piu' breve della famiglia: quella della chip).
 */
export function buildResetSchedule(
	input: Omit<ScheduleTargetInput, 'task'> & {
		task: Pick<StudioTask, 'options'>;
		origin: TaskScheduleOrigin;
	}
): TaskSchedule | null {
	const model = resolveScheduleModel(input.task, input.modelRoles, input.knownSelectors);
	const provider = model.provider;
	if (!provider) return null;
	const schedule: TaskSchedule = { kind: 'reset', provider, origin: input.origin, setAt: input.now };
	if (!input.quotaReady) return schedule;

	const family = modelFamilyFor(model.modelId);
	const threshold = input.threshold ?? SCHEDULE_QUOTA_THRESHOLD;
	let best: { limit: QuotaLimit; reset: number } | null = null;
	for (const report of input.reports) {
		if (!input.matchProvider(report.provider, provider)) continue;
		const limits = familyLimits(report.limits ?? [], family);
		if (limits.length === 0) continue;
		const blocking = limits.filter(
			(limit) => limit.status === 'exhausted' || remainingFractionOf(limit) <= threshold
		);
		let candidate: { limit: QuotaLimit; reset: number } | null = null;
		if (blocking.length > 0) {
			for (const limit of blocking) {
				const reset = resetOf(limit);
				if (reset === undefined) continue;
				if (!candidate || reset > candidate.reset) candidate = { limit, reset };
			}
		} else {
			const shortest = shortestWindowLimit(limits);
			const reset = shortest ? resetOf(shortest) : undefined;
			if (shortest && reset !== undefined) candidate = { limit: shortest, reset };
		}
		// Piu' account: vale quello che si libera prima.
		if (candidate && (!best || candidate.reset < best.reset)) best = candidate;
	}
	if (best) {
		schedule.limitId = best.limit.id;
		schedule.notBefore = best.reset;
	}
	return schedule;
}

/** Programmazione «non prima delle» per un orario gia' risolto in epoch ms. */
export function buildAtSchedule(at: number, now: number): TaskSchedule {
	return { kind: 'at', notBefore: at, origin: 'user', setAt: now };
}

/** Prossima occorrenza locale di HH:MM: oggi se e' ancora avanti, altrimenti domani. */
export function nextOccurrence(hours: number, minutes: number, now: number): number {
	const date = new Date(now);
	date.setHours(hours, minutes, 0, 0);
	if (date.getTime() <= now) date.setDate(date.getDate() + 1);
	return date.getTime();
}

/** «HH:MM» digitato dall'utente; `null` se non e' un orario. */
export function parseClockTime(value: string): { hours: number; minutes: number } | null {
	const match = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(value);
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) return null;
	return { hours, minutes };
}

/**
 * Orari proposti per «Non prima delle»: la sera (19:00, 22:00) e la mattina
 * dopo (08:00), solo quelli ancora avanti e al massimo due, in ordine.
 */
export function schedulePresets(now: number, limit = 2): number[] {
	const candidates = [
		[19, 0],
		[22, 0],
		[8, 0]
	].map(([hours, minutes]) => nextOccurrence(hours, minutes, now));
	return [...new Set(candidates)].sort((a, b) => a - b).slice(0, limit);
}

export interface CountdownParts {
	days: number;
	hours: number;
	minutes: number;
}

/** Scomposizione del tempo mancante, arrotondata al minuto per eccesso. */
export function countdownParts(diffMs: number): CountdownParts | null {
	if (diffMs <= 0) return null;
	const totalMinutes = Math.ceil(diffMs / 60_000);
	return {
		days: Math.floor(totalMinutes / 1440),
		hours: Math.floor((totalMinutes % 1440) / 60),
		minutes: totalMinutes % 60
	};
}

/** Il momento cade in un altro giorno di calendario locale: l'etichetta porta la data. */
export function isOtherDay(at: number, now: number): boolean {
	const a = new Date(at);
	const b = new Date(now);
	return (
		a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth() || a.getDate() !== b.getDate()
	);
}
