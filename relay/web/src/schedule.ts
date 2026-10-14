import type { RemoteTaskSchedule } from '../../src/protocol.ts';
import { t } from './i18n.ts';

/** Formatta un timestamp epoch in stringa HH:MM locale. */
export function formatHHMM(epochMs: number): string {
	const d = new Date(epochMs);
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	return `${hh}:${mm}`;
}

/**
 * Genera l'etichetta testuale della programmazione per una riga di task.
 * Esempi: "saltato: decidi in Studio", "al reset ~14:30", "dopo 18:00".
 */
export function formatScheduleLabel(schedule: RemoteTaskSchedule | null): string | null {
	if (!schedule) {
		return null;
	}
	if (schedule.missed) {
		return t('scheduleMissed');
	}
	if (schedule.kind === 'reset') {
		if (schedule.notBefore != null) {
			return t('scheduleReset', { time: formatHHMM(schedule.notBefore) });
		}
		return 'al reset';
	}
	if (schedule.kind === 'at') {
		if (schedule.notBefore != null) {
			return t('scheduleAt', { time: formatHHMM(schedule.notBefore) });
		}
	}
	return null;
}

/** Calcola l'epoch ms per un orario HH:MM relativo a oggi o domani. */
export function calculateScheduleEpoch(
	timeStr: string,
	day: 'today' | 'tomorrow' = 'today',
	now: number = Date.now()
): number | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
	if (!match) return null;
	const hours = parseInt(match[1], 10);
	const minutes = parseInt(match[2], 10);
	if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
	const d = new Date(now);
	d.setHours(hours, minutes, 0, 0);
	if (day === 'tomorrow') {
		d.setDate(d.getDate() + 1);
	}
	return d.getTime();
}

/** Restituisce l'orario HH:MM predefinito (un'ora da adesso arrotondata). */
export function defaultScheduleTime(now: number = Date.now()): string {
	const d = new Date(now + 3600_000);
	return `${String(d.getHours()).padStart(2, '0')}:00`;
}
