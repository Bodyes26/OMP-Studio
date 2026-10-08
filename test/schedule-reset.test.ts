/**
 * Coda che parte al reset della quota (Gate R35).
 *
 * Copre le parti pure: da ruolo a finestra di quota (con piu' account e
 * finestra settimanale), la conservazione di `schedule`/`resume` fra GUI ed
 * estensione, l'ordine di partenza, i reset passati a Studio chiuso e
 * l'orologio (passo fisso, fuoco, risveglio dallo standby).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
	buildAtSchedule,
	buildResetSchedule,
	countdownParts,
	nextOccurrence,
	parseClockTime,
	resolveScheduleModel,
	resolveScheduleTarget,
	schedulePresets,
	type ScheduleTargetInput
} from '../src/lib/quota/scheduleTarget.ts';
import {
	detectMissedSchedules,
	missedTasks,
	nextAutoDispatchTask,
	nextDueScheduledTask,
	waitingScheduled
} from '../src/lib/quota/scheduleQueue.ts';
import {
	SCHEDULE_TICK_MS,
	canConfirmNow,
	createScheduleClock,
	isWakeGap,
	type ScheduleTickReason
} from '../src/lib/quota/scheduleClock.ts';
import {
	normalizeTaskSchedule,
	normalizeTaskResume,
	parseProjectTasksFile,
	serializeProjectTasksFile,
	type StudioTask,
	type TaskSchedule
} from '../src/lib/stores/taskSerialization.ts';
import {
	loadProjectTasks,
	saveProjectTasks,
	parseScheduleAt,
	scheduleTag
} from '../extensions/studio-tasks.ts';
import type { QuotaLimit, QuotaReport } from '../src/lib/stores/quota.svelte.ts';

const NOW = Date.UTC(2026, 9, 8, 12, 53);
const MIN = 60_000;
const HOUR = 60 * MIN;

const ROLES = {
	default: 'anthropic/claude-opus-5:high',
	smol: 'openai-codex/gpt-5.6-mini',
	plan: 'claude-sonnet-5'
};

function limit(id: string, remaining: number, resetsAt: number | undefined, durationMs: number, label = id): QuotaLimit {
	return {
		id,
		label,
		window: { id, label, durationMs, resetsAt },
		amount: { remainingFraction: remaining }
	};
}

function report(provider: string, limits: QuotaLimit[], email?: string): QuotaReport {
	return { provider, limits, metadata: email ? { email } : undefined };
}

const matchProvider = (left: string | undefined, right: string | undefined) =>
	Boolean(left && right && left.toLowerCase() === right.toLowerCase());

function input(task: Pick<StudioTask, 'options' | 'schedule'>, reports: QuotaReport[], now = NOW): ScheduleTargetInput {
	return { task, modelRoles: ROLES, reports, matchProvider, quotaReady: true, now };
}

function resetSchedule(extra: Partial<TaskSchedule> = {}): TaskSchedule {
	return { kind: 'reset', provider: 'anthropic', origin: 'user', setAt: NOW - HOUR, ...extra };
}

function task(id: string, extra: Partial<StudioTask> = {}): StudioTask {
	return {
		id,
		projectPath: 'c:/progetto',
		prompt: `task ${id}`,
		position: 0,
		createdAt: NOW,
		updatedAt: NOW,
		status: 'queued',
		...extra
	};
}

describe('scheduleTarget: da ruolo a finestra', () => {
	it('ricava provider e modello dal ruolo, togliendo il livello di thinking', () => {
		assert.deepEqual(resolveScheduleModel({ options: { role: 'default' } }, ROLES), {
			provider: 'anthropic',
			modelId: 'claude-opus-5'
		});
		assert.deepEqual(resolveScheduleModel({}, ROLES), { provider: 'anthropic', modelId: 'claude-opus-5' });
		// Il selettore esplicito del task vince sul ruolo.
		assert.deepEqual(
			resolveScheduleModel({ options: { role: 'default', modelSelector: 'openai-codex/gpt-5.6' } }, ROLES),
			{ provider: 'openai-codex', modelId: 'gpt-5.6' }
		);
		// Senza provider nel selettore non si indovina.
		assert.deepEqual(resolveScheduleModel({ options: { role: 'plan' } }, ROLES), { modelId: 'claude-sonnet-5' });
	});

	it('aspetta il reset della finestra ferma e lo rilegge a ogni giro', () => {
		const reset = NOW + 72 * MIN;
		const reports = [report('anthropic', [limit('anthropic:5h', 0.03, reset, 5 * HOUR)])];
		const waiting = resolveScheduleTarget(input({ schedule: resetSchedule() }, reports));
		assert.equal(waiting.state, 'waiting');
		assert.equal(waiting.dueAt, reset);
		assert.equal(waiting.limitId, 'anthropic:5h');
		assert.equal(waiting.estimate, false);

		// Il provider sposta il reset: vale il nuovo orario, non quello salvato.
		const moved = [report('anthropic', [limit('anthropic:5h', 0.03, reset + 10 * MIN, 5 * HOUR)])];
		assert.equal(resolveScheduleTarget(input({ schedule: resetSchedule({ notBefore: reset }) }, moved)).dueAt, reset + 10 * MIN);

		// Reset passato: dovuto anche se lo snapshot non e' ancora stato rinfrescato.
		assert.equal(resolveScheduleTarget(input({ schedule: resetSchedule() }, reports, reset + MIN)).state, 'due');
	});

	it('con piu account vale il reset piu vicino, e uno libero basta', () => {
		const early = NOW + 30 * MIN;
		const late = NOW + 3 * HOUR;
		const both = [
			report('anthropic', [limit('anthropic:5h', 0, late, 5 * HOUR)], 'a@x'),
			report('anthropic', [limit('anthropic:5h', 0.02, early, 5 * HOUR)], 'b@x')
		];
		assert.equal(resolveScheduleTarget(input({ schedule: resetSchedule() }, both)).dueAt, early);

		const oneFree = [
			report('anthropic', [limit('anthropic:5h', 0, late, 5 * HOUR)], 'a@x'),
			report('anthropic', [limit('anthropic:5h', 0.6, early, 5 * HOUR)], 'b@x')
		];
		// Senza orario salvato l'account libero rende il task dovuto subito.
		assert.equal(resolveScheduleTarget(input({ schedule: resetSchedule() }, oneFree)).state, 'due');
	});

	it('con la finestra settimanale esaurita aspetta quella, non la 5 ore', () => {
		const fiveHour = NOW + HOUR;
		const weekly = NOW + 3 * 24 * HOUR;
		const reports = [
			report('anthropic', [
				limit('anthropic:5h', 0.8, fiveHour, 5 * HOUR, 'Claude 5 Hour'),
				limit('anthropic:7d', 0, weekly, 7 * 24 * HOUR, 'Claude 7 Day')
			])
		];
		const target = resolveScheduleTarget(input({ schedule: resetSchedule() }, reports));
		assert.equal(target.state, 'waiting');
		assert.equal(target.dueAt, weekly);
		assert.equal(target.windowLabel, 'Claude 7 Day');
	});

	it('scelto con quota ancora buona aspetta davvero il reset, poi riconosce il cambio di finestra', () => {
		const reset = NOW + 2 * HOUR;
		const reports = [report('anthropic', [limit('anthropic:5h', 0.5, reset, 5 * HOUR)])];
		const schedule = buildResetSchedule({
			task: { options: { role: 'default' } },
			origin: 'user',
			modelRoles: ROLES,
			reports,
			matchProvider,
			quotaReady: true,
			now: NOW
		});
		assert.ok(schedule);
		assert.equal(schedule.provider, 'anthropic');
		assert.equal(schedule.limitId, 'anthropic:5h');
		assert.equal(schedule.notBefore, reset);
		assert.equal(resolveScheduleTarget(input({ options: { role: 'default' }, schedule }, reports)).state, 'waiting');

		// La finestra e' gia' ripartita (reset riletto molto dopo quello salvato).
		const rolled = [report('anthropic', [limit('anthropic:5h', 0.99, reset + 5 * HOUR, 5 * HOUR)])];
		assert.equal(resolveScheduleTarget(input({ options: { role: 'default' }, schedule }, rolled)).state, 'due');
	});

	it('senza dati di usage non decide e mostra la stima salvata', () => {
		const target = resolveScheduleTarget({
			...input({ schedule: resetSchedule({ notBefore: NOW + HOUR }) }, []),
			quotaReady: false
		});
		assert.equal(target.state, 'unknown');
		assert.equal(target.estimate, true);
		assert.equal(target.dueAt, NOW + HOUR);
	});

	it('un provider senza limiti in omp usage non aspetta un reset inesistente', () => {
		const target = resolveScheduleTarget(input({ schedule: resetSchedule({ provider: 'ollama' }) }, []));
		assert.equal(target.state, 'due');
	});

	it('«non prima delle» dipende solo dall orario', () => {
		const at = buildAtSchedule(NOW + 30 * MIN, NOW);
		assert.equal(resolveScheduleTarget(input({ schedule: at }, [])).state, 'waiting');
		assert.equal(resolveScheduleTarget(input({ schedule: at }, [], NOW + 31 * MIN)).state, 'due');
	});

	it('orari: parsing, prossima occorrenza, proposte e conto alla rovescia', () => {
		assert.deepEqual(parseClockTime('19:05'), { hours: 19, minutes: 5 });
		assert.deepEqual(parseClockTime('7.30'), { hours: 7, minutes: 30 });
		assert.equal(parseClockTime('25:00'), null);
		assert.equal(parseClockTime('domani'), null);

		const local = new Date(2026, 9, 8, 20, 0).getTime();
		const next = new Date(nextOccurrence(19, 0, local));
		assert.equal(next.getDate(), 9);
		assert.equal(next.getHours(), 19);

		const presets = schedulePresets(local).map((at) => new Date(at).getHours());
		assert.deepEqual(presets, [22, 8]);

		assert.deepEqual(countdownParts(72 * MIN), { days: 0, hours: 1, minutes: 12 });
		assert.deepEqual(countdownParts(26 * HOUR + 30_000), { days: 1, hours: 2, minutes: 1 });
		assert.equal(countdownParts(0), null);
	});
});

describe('schedule/resume: serializzazione GUI ↔ estensione', () => {
	let dir: string;
	before(() => {
		dir = mkdtempSync(join(tmpdir(), 'omp-studio-schedule-'));
		mkdirSync(join(dir, '.omp'), { recursive: true });
	});
	after(() => rmSync(dir, { recursive: true, force: true }));

	it('normalizza e scarta le programmazioni malformate senza perdere il task', () => {
		assert.equal(normalizeTaskSchedule({ kind: 'later' }), undefined);
		assert.equal(normalizeTaskSchedule({ kind: 'at' }), undefined);
		assert.deepEqual(normalizeTaskSchedule({ kind: 'reset', provider: ' anthropic ', origin: 'x', setAt: 5 }), {
			kind: 'reset',
			provider: 'anthropic',
			origin: 'user',
			setAt: 5
		});
		assert.equal(normalizeTaskResume({ laneId: 'x' }), undefined);

		const raw = JSON.stringify({
			version: 1,
			tasks: [
				{ ...task('a'), schedule: { kind: 'at' } },
				{ ...task('b'), schedule: { kind: 'at', notBefore: NOW, origin: 'user', setAt: NOW } }
			]
		});
		const [a, b] = parseProjectTasksFile(raw, 'c:/progetto');
		assert.equal(a.id, 'a');
		assert.equal('schedule' in a, false);
		assert.equal(b.schedule?.notBefore, NOW);
	});

	it('la GUI conserva schedule e resume alla radice e l estensione li rilegge', () => {
		const schedule: TaskSchedule = {
			kind: 'reset',
			provider: 'anthropic',
			limitId: 'anthropic:5h',
			notBefore: NOW + HOUR,
			origin: 'recovery',
			setAt: NOW
		};
		const gui = [
			task('resume', { prompt: '/retry', schedule, resume: { sessionId: 'ses-1', laneId: 'lane-2' } }),
			task('plain')
		];
		writeFileSync(join(dir, '.omp', 'tasks.json'), serializeProjectTasksFile(gui));

		const loaded = loadProjectTasks(dir);
		assert.deepEqual(loaded[0].schedule, schedule);
		assert.deepEqual(loaded[0].resume, { sessionId: 'ses-1', laneId: 'lane-2' });
		assert.equal('schedule' in loaded[1], false);

		// L'estensione riscrive la coda (riordino da TUI): la GUI ritrova tutto.
		saveProjectTasks(dir, loaded.reverse());
		const back = parseProjectTasksFile(readFileSync(join(dir, '.omp', 'tasks.json'), 'utf8'), dir);
		const resumed = back.find((entry) => entry.id === 'resume');
		assert.deepEqual(resumed?.schedule, schedule);
		assert.deepEqual(resumed?.resume, { sessionId: 'ses-1', laneId: 'lane-2' });
	});

	it('/tasks e il tool mostrano la programmazione; scheduleAt accetta HH:MM e ISO', () => {
		const local = new Date(2026, 9, 8, 13, 0).getTime();
		const at = new Date(2026, 9, 8, 19, 0).getTime();
		assert.equal(scheduleTag({ schedule: { kind: 'at', notBefore: at, origin: 'user', setAt: 0 } }, local), '[dopo 19:00]');
		assert.equal(scheduleTag({ schedule: { kind: 'reset', origin: 'user', setAt: 0 } }, local), '[al reset]');
		assert.equal(
			scheduleTag({ resume: { sessionId: 's' }, schedule: { kind: 'reset', notBefore: at, origin: 'recovery', setAt: 0 } }, local),
			'[riprendi] [al reset ~19:00]'
		);
		assert.equal(parseScheduleAt('19:00', local), at);
		assert.equal(new Date(parseScheduleAt('08:00', local)!).getDate(), 9);
		assert.equal(parseScheduleAt('2026-10-09T08:00:00Z', local), Date.UTC(2026, 9, 9, 8));
		assert.equal(parseScheduleAt('presto', local), null);
	});
});

describe('scheduleQueue: chi parte e quando', () => {
	const due = () => 'due' as const;

	it('l auto-avvio salta i task programmati e si ferma davanti a una ripresa in attesa', () => {
		const tasks = [
			task('s', { position: 0, schedule: resetSchedule() }),
			task('n', { position: 1 })
		];
		assert.equal(nextAutoDispatchTask(tasks, new Set())?.id, 'n');
		assert.equal(nextAutoDispatchTask(tasks, new Set(['n'])), null);

		const withResume = [task('r', { position: 0, resume: { sessionId: 'x' }, schedule: resetSchedule() }), ...tasks];
		assert.equal(nextAutoDispatchTask(withResume, new Set()), null);
	});

	it('fra i dovuti passa prima la ripresa, poi l ordine della coda; il banner li ferma', () => {
		const tasks = [
			task('a', { position: 0, schedule: resetSchedule() }),
			task('r', { position: 2, resume: { sessionId: 'x' }, schedule: resetSchedule() }),
			task('m', { position: 1, schedule: resetSchedule({ missed: true }) }),
			task('w', { position: 3, schedule: buildAtSchedule(NOW + HOUR, NOW) })
		];
		const stateOf = (t: StudioTask) => (t.id === 'w' ? 'waiting' : 'due') as 'due' | 'waiting';
		assert.equal(nextDueScheduledTask(tasks, stateOf, new Set())?.id, 'r');
		assert.equal(nextDueScheduledTask(tasks, stateOf, new Set(['r']))?.id, 'a');
		assert.equal(nextDueScheduledTask(tasks, stateOf, new Set(['r', 'a'])), null);
		assert.deepEqual(missedTasks(tasks).map((t) => t.id), ['m']);
		assert.deepEqual(waitingScheduled(tasks, stateOf).map((t) => t.id), ['w']);
		// Un task non in coda non parte mai.
		assert.equal(nextDueScheduledTask([task('x', { status: 'in_progress', schedule: resetSchedule() })], due, new Set()), null);
	});

	it('reset passato a Studio chiuso: banner, mai partenza; il dato mancante rimanda il giudizio', () => {
		const appStartedAt = NOW;
		const seen = new Set<string>();
		const old = task('old', { schedule: resetSchedule({ setAt: NOW - 5 * HOUR }) });
		const fresh = task('fresh', { schedule: resetSchedule({ setAt: NOW + MIN }) });
		const later = task('later', { schedule: resetSchedule({ setAt: NOW - HOUR }) });

		// Usage non ancora letto: nessun giudizio.
		assert.deepEqual(detectMissedSchedules([old], () => 'unknown', seen, appStartedAt), []);
		assert.equal(seen.size, 0);

		const states: Record<string, 'due' | 'waiting'> = { old: 'due', fresh: 'due', later: 'waiting' };
		const marked = detectMissedSchedules([old, fresh, later], (t) => states[t.id], seen, appStartedAt);
		assert.deepEqual(marked, ['old']);

		// Diventa dovuto con Studio aperto: parte, niente banner.
		states.later = 'due';
		assert.deepEqual(detectMissedSchedules([old, fresh, later], (t) => states[t.id], seen, appStartedAt), []);
	});
});

describe('scheduleClock: passo fisso, fuoco, standby', () => {
	function fakeEnv(start: number) {
		let now = start;
		let intervalFn: (() => void) | null = null;
		const listeners: Record<string, () => void> = {};
		return {
			env: {
				now: () => now,
				setInterval: (fn: () => void) => {
					intervalFn = fn;
					return 1;
				},
				clearInterval: () => {
					intervalFn = null;
				},
				listen: (event: 'focus' | 'visible', fn: () => void) => {
					listeners[event] = fn;
					return () => delete listeners[event];
				}
			},
			advance(ms: number) {
				now += ms;
				intervalFn?.();
			},
			fire(event: 'focus' | 'visible') {
				listeners[event]?.();
			},
			get active() {
				return intervalFn !== null && Object.keys(listeners).length === 2;
			}
		};
	}

	it('gira subito, poi ogni 30 s, al fuoco e riconosce il risveglio', () => {
		const fake = fakeEnv(NOW);
		const ticks: ScheduleTickReason[] = [];
		const clock = createScheduleClock(fake.env, (_now, reason) => ticks.push(reason));
		fake.advance(SCHEDULE_TICK_MS);
		fake.fire('focus');
		fake.fire('visible');
		fake.advance(2 * HOUR); // il PC era in standby
		fake.advance(SCHEDULE_TICK_MS);
		assert.deepEqual(ticks, ['start', 'interval', 'focus', 'visible', 'wake', 'interval']);
		assert.equal(fake.active, true);
		clock.dispose();
		assert.equal(fake.active, false);
		fake.advance(SCHEDULE_TICK_MS);
		assert.equal(ticks.length, 6);
	});

	it('soglie di risveglio e di conferma forzata', () => {
		assert.equal(isWakeGap(NOW, NOW + SCHEDULE_TICK_MS + 5_000), false);
		assert.equal(isWakeGap(NOW, NOW + 3 * MIN), true);
		assert.equal(canConfirmNow(undefined, NOW), true);
		assert.equal(canConfirmNow(NOW, NOW + 30_000), false);
		assert.equal(canConfirmNow(NOW, NOW + MIN), true);
	});
});
