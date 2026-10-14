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
