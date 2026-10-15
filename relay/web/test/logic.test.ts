import { describe, expect, it } from 'bun:test';
import { calculateBackoffDelay, BACKOFF_DELAYS } from '../src/backoff.ts';
import { formatScheduleLabel } from '../src/schedule.ts';
import {
	initializeAskState,
	toggleOptionSelection,
	buildAskAnswer,
	isQuestionAnswered
} from '../src/askAnswers.ts';
import { sortProjects, getProjectPriority } from '../src/projectSort.ts';
import { formatCommandError } from '../src/errors.ts';
import { detectDefaultDeviceName } from '../src/deviceDetect.ts';
import type { RemoteAskQuestion, RemoteProject, RemoteTaskSchedule } from '../../src/protocol.ts';

describe('backoff & jitter bounds', () => {
	it('returns 0 ms for 0 attempts', () => {
		expect(calculateBackoffDelay(0, () => 0.5)).toBe(0);
		expect(calculateBackoffDelay(0, () => 0.99)).toBe(0);
	});

	it('stays within [0.8 * base, 1.2 * base] bounds for all positive attempts', () => {
		// Attempt 1: base = 500ms -> [400, 600]
		expect(calculateBackoffDelay(1, () => 0)).toBe(400);
		expect(calculateBackoffDelay(1, () => 0.5)).toBe(500);
		expect(calculateBackoffDelay(1, () => 1)).toBe(600);

		// Attempt 2: base = 1000ms -> [800, 1200]
		expect(calculateBackoffDelay(2, () => 0)).toBe(800);
		expect(calculateBackoffDelay(2, () => 1)).toBe(1200);

		// Attempt 3: base = 2000ms -> [1600, 2400]
		expect(calculateBackoffDelay(3, () => 0)).toBe(1600);
		expect(calculateBackoffDelay(3, () => 1)).toBe(2400);

		// Attempt 4: base = 5000ms -> [4000, 6000]
		expect(calculateBackoffDelay(4, () => 0)).toBe(4000);
		expect(calculateBackoffDelay(4, () => 1)).toBe(6000);

		// Attempt >= 5: capped at 10000ms -> [8000, 12000]
		expect(calculateBackoffDelay(5, () => 0)).toBe(8000);
		expect(calculateBackoffDelay(10, () => 1)).toBe(12000);
	});
});

describe('schedule labels', () => {
	it('returns null when no schedule exists', () => {
		expect(formatScheduleLabel(null)).toBeNull();
	});

	it('returns missed label when schedule was missed', () => {
		const s: RemoteTaskSchedule = {
			kind: 'reset',
			notBefore: Date.now(),
			provider: 'anthropic',
			missed: true
		};
		expect(formatScheduleLabel(s)).toBe('saltato: decidi in Studio');
	});

	it('formats reset label with estimated reset time', () => {
		// 14:30 local time
		const date = new Date(2026, 9, 13, 14, 30, 0);
		const s: RemoteTaskSchedule = {
			kind: 'reset',
			notBefore: date.getTime(),
			provider: 'anthropic',
			missed: false
		};
		expect(formatScheduleLabel(s)).toBe('al reset ~14:30');
	});

	it('formats at label with scheduled time', () => {
		const date = new Date(2026, 9, 13, 18, 45, 0);
		const s: RemoteTaskSchedule = {
			kind: 'at',
			notBefore: date.getTime(),
			provider: null,
			missed: false
		};
		expect(formatScheduleLabel(s)).toBe('dopo 18:45');
	});
});

describe('ask answer building', () => {
	const sampleQuestions: RemoteAskQuestion[] = [
		{
			id: 'q1',
			question: 'Quale approccio preferisci?',
			header: 'Strategia',
			options: [
				{ label: 'Approccio A', description: 'Descrizione A' },
				{ label: 'Approccio B', description: 'Descrizione B' }
			],
			multi: false,
			recommended: 1 // Approccio B e' raccomandato
		},
		{
			id: 'q2',
			question: 'Quali flag attivare?',
			header: 'Opzioni',
			options: [
				{ label: 'Flag 1', description: null },
				{ label: 'Flag 2', description: null },
				{ label: 'Flag 3', description: null }
			],
			multi: true,
			recommended: null
		}
	];

	it('initializes state with recommended option untouched', () => {
		const state = initializeAskState(sampleQuestions);
		expect(state['q1'].selectedOptions).toEqual(['Approccio B']);
		expect(state['q2'].selectedOptions).toEqual([]);

		const answer = buildAskAnswer(sampleQuestions, state);
		expect(answer).toEqual({
			action: 'ask',
			answers: [
				{ id: 'q1', selectedOptions: ['Approccio B'] },
				{ id: 'q2', selectedOptions: [] }
			]
		});
	});

	it('handles multi-select option toggling', () => {
		let sel: string[] = [];
		sel = toggleOptionSelection(sel, 'Flag 1', true);
		expect(sel).toEqual(['Flag 1']);
		sel = toggleOptionSelection(sel, 'Flag 2', true);
		expect(sel).toEqual(['Flag 1', 'Flag 2']);
		sel = toggleOptionSelection(sel, 'Flag 1', true);
		expect(sel).toEqual(['Flag 2']);
	});

	it('includes custom input when provided', () => {
		const state = initializeAskState(sampleQuestions);
		state['q1'].customInput = '  mia risposta personalizzata  ';
		state['q2'].selectedOptions = ['Flag 1', 'Flag 3'];

		const answer = buildAskAnswer(sampleQuestions, state);
		expect(answer).toEqual({
			action: 'ask',
			answers: [
				{ id: 'q1', selectedOptions: ['Approccio B'], customInput: 'mia risposta personalizzata' },
				{ id: 'q2', selectedOptions: ['Flag 1', 'Flag 3'] }
			]
		});
	});

	it('treats a question as answered only with a choice or non-blank custom text', () => {
		expect(isQuestionAnswered(undefined)).toBe(false);
		expect(isQuestionAnswered({ selectedOptions: [], customInput: '   ' })).toBe(false);
		expect(isQuestionAnswered({ selectedOptions: ['Approccio A'] })).toBe(true);
		expect(isQuestionAnswered({ selectedOptions: [], customInput: 'altro' })).toBe(true);
	});
});

describe('project sorting', () => {
	const pAttention: RemoteProject = {
		id: 'p1',
		name: 'Progetto Alpha',
		hue: 120,
		active: false,
		lanes: [{ id: 'main', title: 'Main', kind: 'main', agent: { state: 'idle', surface: null, provider: null, modelId: null, modelLabel: null, activity: null, headsUp: null } }],
		attention: [
			{
				requestId: 'r1',
				laneId: null,
				laneTitle: null,
				method: 'confirm',
				title: 'Conferma eliminazione',
				message: null,
				options: [],
				placeholder: null,
				prefill: null,
				questions: [],
				deadline: null,
				quotaBlocked: null,
				recentMessages: []
			}
		],
		tasks: [],
		autoDispatch: true,
		canRunTask: true,
		runBlockReason: null
	};

	const pWorking: RemoteProject = {
		id: 'p2',
		name: 'Progetto Beta',
		hue: 200,
		active: false,
		lanes: [{ id: 'main', title: 'Main', kind: 'main', agent: { state: 'working', surface: null, provider: null, modelId: null, modelLabel: null, activity: null, headsUp: null } }],
		attention: [],
		tasks: [],
		autoDispatch: true,
		canRunTask: false,
		runBlockReason: 'busy'
	};

	const pIdle: RemoteProject = {
		id: 'p3',
		name: 'Progetto Gamma',
		hue: 45,
		active: false,
		lanes: [{ id: 'main', title: 'Main', kind: 'main', agent: { state: 'idle', surface: null, provider: null, modelId: null, modelLabel: null, activity: null, headsUp: null } }],
		attention: [],
		tasks: [],
		autoDispatch: true,
		canRunTask: true,
		runBlockReason: null
	};

	const pIdleActive: RemoteProject = {
		id: 'p4',
		name: 'Progetto Delta',
		hue: 10,
		active: true,
		lanes: [{ id: 'main', title: 'Main', kind: 'main', agent: { state: 'idle', surface: null, provider: null, modelId: null, modelLabel: null, activity: null, headsUp: null } }],
		attention: [],
		tasks: [],
		autoDispatch: true,
		canRunTask: true,
		runBlockReason: null
	};

	it('computes correct priority: attention(0) < working(1) < rest(2)', () => {
		expect(getProjectPriority(pAttention)).toBe(0);
		expect(getProjectPriority(pWorking)).toBe(1);
		expect(getProjectPriority(pIdle)).toBe(2);
		expect(getProjectPriority(pIdleActive)).toBe(2);
	});

	it('sorts projects attention > working > rest, with active project first in same priority', () => {
		const sorted = sortProjects([pIdle, pWorking, pAttention, pIdleActive]);
		expect(sorted.map((p) => p.id)).toEqual(['p1', 'p2', 'p4', 'p3']);
	});
});

describe('command error messages mapping', () => {
	it('maps each known code to a clear message', () => {
		expect(formatCommandError({ code: 'host_offline', message: '' })).toContain('offline');
		expect(formatCommandError({ code: 'timeout', message: '' })).toContain('tempo limite');
		expect(formatCommandError({ code: 'unsupported', message: '' })).toContain('non supportata');
		expect(formatCommandError({ code: 'not_found', message: '' })).toContain('non trovato');
		expect(formatCommandError({ code: 'rejected', message: '' })).toContain('rifiutato');
		expect(formatCommandError({ code: 'disabled', message: '' })).toContain('disabilitato');
		expect(formatCommandError({ code: 'failed', message: '' })).toContain('fallita');
	});

	it('includes specific message when present', () => {
		expect(formatCommandError({ code: 'failed', message: 'Quota exhausted on model' })).toBe(
			'Esecuzione del comando fallita: Quota exhausted on model'
		);
	});
});

describe('device detection from UA', () => {
	it('identifies iPhone Safari', () => {
		const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
		expect(detectDefaultDeviceName(ua)).toBe('iPhone Safari');
	});

	it('identifies Mac Chrome', () => {
		const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
		expect(detectDefaultDeviceName(ua)).toBe('Mac Chrome');
	});

	it('identifies Windows Edge', () => {
		const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
		expect(detectDefaultDeviceName(ua)).toBe('Windows Edge');
	});
});
