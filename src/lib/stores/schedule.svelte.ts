/**
 * Stato reattivo dei task programmati (Gate R3X-coda-reset).
 *
 * Collega i moduli puri (`scheduleTarget`, `scheduleQueue`, `scheduleClock`)
 * agli store di Studio: quota letta da `omp usage`, ruoli dei modelli, ora
 * corrente. Le decisioni stanno nei moduli puri; qui c'e' solo il cablaggio
 * e il testo che l'interfaccia mostra.
 *
 * Vive in entrambe le finestre (principale e Companion): solo la principale
 * fa partire i task, la Companion legge etichette e conteggi.
 */

import { m } from '$lib/paraglide/messages.js';
import { i18n } from '$lib/i18n/i18n.svelte';
import { quotaStore, providersMatch } from './quota.svelte';
import { modelSettingsStore } from './modelSettings.svelte';
import type { StudioTask, TaskSchedule, TaskScheduleOrigin } from './taskSerialization';
import { formatProviderShortName } from '$lib/quota/projectQuota';
import {
	buildResetSchedule,
	countdownParts,
	isOtherDay,
	resolveScheduleTarget,
	type ScheduleTarget
} from '$lib/quota/scheduleTarget';
import { waitingScheduled } from '$lib/quota/scheduleQueue';
import { createScheduleClock, type ScheduleClock, type ScheduleTickReason } from '$lib/quota/scheduleClock';

export interface ScheduleLabel {
	/** Testo della chip: «Al reset · Anthropic · 14:05». */
	text: string;
	/** Conto alla rovescia tabulare, vuoto quando il momento e' passato. */
	countdown: string;
	/** Spiegazione completa per tooltip e lettori di schermo. */
	tooltip: string;
	/** Il momento e' arrivato: il task parte al prossimo giro. */
	ready: boolean;
	/** Orario breve per righe strette (Companion): «14:05» o «11 ott 08:00». */
	when: string;
}

class ScheduleStore {
	/** Ora dell'ultimo giro: legarla qui rende ogni etichetta reattiva al passo dell'orologio. */
	now = $state(Date.now());
	/** Avvio di questa finestra: separa i reset passati a Studio chiuso. */
	readonly appStartedAt = Date.now();

	private clock: ScheduleClock | null = null;
	private readonly listeners = new Set<(reason: ScheduleTickReason) => void>();

	/** Avvia l'orologio (idempotente). Senza `window` resta fermo. */
	init(): void {
		if (this.clock || typeof window === 'undefined') return;
		this.clock = createScheduleClock(
			{
				now: () => Date.now(),
				setInterval: (fn, ms) => window.setInterval(fn, ms),
				clearInterval: (handle) => window.clearInterval(handle as number),
				listen: (event, fn) => {
					if (event === 'focus') {
						window.addEventListener('focus', fn);
						return () => window.removeEventListener('focus', fn);
					}
					const onVisibility = () => {
						if (document.visibilityState === 'visible') fn();
					};
					document.addEventListener('visibilitychange', onVisibility);
					return () => document.removeEventListener('visibilitychange', onVisibility);
				}
			},
			(now, reason) => {
				this.now = now;
				// Dopo lo standby lo snapshot di usage e' vecchio: si rilegge
				// (dalla cache del backend, non forzato) prima di decidere.
				if (reason === 'wake') void quotaStore.refresh(false);
				for (const listener of this.listeners) listener(reason);
			}
		);
	}

	onTick(listener: (reason: ScheduleTickReason) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	tickNow(): void {
		this.clock?.tick('manual');
	}

	private get quotaReady(): boolean {
		return quotaStore.lastFetchedAt !== null && quotaStore.status !== 'offline';
	}

	targetFor(task: Pick<StudioTask, 'options' | 'schedule'>, now = this.now): ScheduleTarget {
		return resolveScheduleTarget({
			task,
			modelRoles: modelSettingsStore.config?.modelRoles ?? null,
			knownSelectors: modelSettingsStore.knownSelectors,
			reports: quotaStore.reports,
			matchProvider: providersMatch,
			quotaReady: this.quotaReady,
			now
		});
	}

	/** Programmazione «al reset» per il task, letta adesso; `null` se il provider non e' noto. */
	buildReset(task: Pick<StudioTask, 'options'>, origin: TaskScheduleOrigin): TaskSchedule | null {
		return buildResetSchedule({
			task,
			origin,
			modelRoles: modelSettingsStore.config?.modelRoles ?? null,
			knownSelectors: modelSettingsStore.knownSelectors,
			reports: quotaStore.reports,
			matchProvider: providersMatch,
			quotaReady: this.quotaReady,
			now: Date.now()
		});
	}

	/** Orario leggibile: solo l'ora oggi, data e ora per un altro giorno (finestra 7d). */
	formatWhen(at: number, now = this.now): string {
		if (isOtherDay(at, now)) {
			return i18n.formatDate(at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
		}
		return i18n.formatDate(at, { hour: '2-digit', minute: '2-digit' });
	}

	formatCountdown(at: number, now = this.now): string {
		const parts = countdownParts(at - now);
		if (!parts) return '';
		if (parts.days > 0) return m.schedule_countdown_days({ days: parts.days, hours: parts.hours });
		if (parts.hours > 0) return m.schedule_countdown_hours({ hours: parts.hours, minutes: parts.minutes });
		return m.schedule_countdown_minutes({ minutes: parts.minutes });
	}

	labelFor(task: Pick<StudioTask, 'options' | 'schedule' | 'resume'>): ScheduleLabel | null {
		const schedule = task.schedule;
		if (!schedule) return null;
		const target = this.targetFor(task);
		const provider = formatProviderShortName(target.provider) || m.schedule_provider_unknown();
		const window = target.windowLabel ?? '';
		const when = target.dueAt !== undefined ? this.formatWhen(target.dueAt) : '';
		const ready = target.state === 'due';
		const countdown = !ready && target.dueAt !== undefined ? this.formatCountdown(target.dueAt) : '';

		if (schedule.missed) {
			return {
				text: m.schedule_chip_missed({ when: when || provider }),
				countdown: '',
				tooltip: m.schedule_tip_missed(),
				ready: false,
				when
			};
		}
		if (ready) {
			return {
				text: schedule.kind === 'reset' ? m.schedule_chip_ready_reset() : m.schedule_chip_ready_at(),
				countdown: '',
				tooltip: m.schedule_tip_ready(),
				ready: true,
				when
			};
		}
		if (schedule.kind === 'at') {
			return {
				text: m.schedule_chip_at({ when }),
				countdown,
				tooltip: m.schedule_tip_at({ when }),
				ready: false,
				when
			};
		}
		if (!when) {
			return {
				text: task.resume ? m.schedule_chip_resume_unknown({ provider }) : m.schedule_chip_reset_unknown({ provider }),
				countdown: '',
				tooltip: m.schedule_tip_reset_unknown({ provider }),
				ready: false,
				when
			};
		}
		const text = task.resume
			? m.schedule_chip_resume({ provider, when })
			: m.schedule_chip_reset({ provider, when });
		const tooltip = target.estimate
			? m.schedule_tip_reset_estimate({ provider, when })
			: m.schedule_tip_reset({ provider, window: window || provider, when });
		return {
			text: target.estimate ? `${text} ${m.schedule_estimate_suffix()}` : text,
			countdown,
			tooltip,
			ready: false,
			when
		};
	}

	/**
	 * Orario del prossimo reset per un modello fermato dal limite, per il
	 * pulsante «Aspetta il prossimo reset · 14:05». Vuoto se non si sa; in
	 * quel caso vale l'orario che omp ha dato alla sessione (`resetsAtSec`).
	 */
	previewResetWhen(selector: string | undefined, fallbackMs?: number): string {
		const options = selector ? { modelSelector: selector } : undefined;
		const schedule = this.buildReset({ options }, 'recovery');
		const target = schedule ? this.targetFor({ options, schedule }) : null;
		const at = target?.dueAt ?? schedule?.notBefore ?? fallbackMs;
		return at !== undefined && at > this.now ? this.formatWhen(at) : '';
	}

	/**
	 * Task che aspettano il loro momento, per chip e popover della quota.
	 * `provider` restringe ai task «al reset» di quel provider.
	 */
	waitingSummary(
		tasks: readonly StudioTask[],
		matchProvider?: (provider: string | undefined) => boolean
	): { count: number; next?: number } {
		let count = 0;
		let next: number | undefined;
		for (const task of waitingScheduled(tasks, (candidate) => this.targetFor(candidate).state)) {
			const target = this.targetFor(task);
			if (matchProvider && (task.schedule?.kind !== 'reset' || !matchProvider(target.provider))) continue;
			count++;
			if (target.dueAt !== undefined && (next === undefined || target.dueAt < next)) next = target.dueAt;
		}
		return { count, next };
	}

	/** Etichetta breve per la voce di menu «Al reset della quota»: «Anthropic 14:05». */
	resetMenuDetail(task: Pick<StudioTask, 'options'>): { detail: string; available: boolean } {
		const schedule = this.buildReset(task, 'user');
		if (!schedule) return { detail: m.schedule_menu_reset_no_provider(), available: false };
		const provider = formatProviderShortName(schedule.provider);
		const target = this.targetFor({ options: task.options, schedule });
		const at = target.dueAt ?? schedule.notBefore;
		return { detail: at !== undefined ? `${provider} ${this.formatWhen(at)}` : provider, available: true };
	}
}

export const scheduleStore = new ScheduleStore();
