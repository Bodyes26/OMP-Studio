import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	evaluateQuotaGate,
	pickNextJob,
	BACKGROUND_JOB_ORDER,
	type BackgroundJobId,
	type JobStateForPicker,
	type QuotaReport,
	DEFAULT_BACKGROUND_JOBS_SETTINGS,
	parseBackgroundJobsSettings
} from '../src/lib/stores/backgroundJobsHelpers.ts';

describe('Background Jobs - Pure Decisions', () => {
	describe('evaluateQuotaGate', () => {
		it('non blocca i modelli locali o API senza provider', () => {
			const res = evaluateQuotaGate({
				modelOverride: 'local-model',
				reports: [],
				quotaFloorPct: 30
			});
			assert.equal(res.paused, false);
			assert.equal(res.quota, null);
		});

		it('non blocca provider senza report o con limiti vuoti (es. pay-as-you-go)', () => {
			const reports: QuotaReport[] = [
				{
					provider: 'openai',
					limits: []
				}
			];
			const res = evaluateQuotaGate({
				modelOverride: 'openai/gpt-4o',
				reports,
				quotaFloorPct: 30
			});
			assert.equal(res.paused, false);
			assert.equal(res.quota, null);
		});

		it('non blocca se tutte le finestre di quota sono sopra la soglia quotaFloorPct', () => {
			const reports: QuotaReport[] = [
				{
					provider: 'anthropic',
					limits: [
						{
							id: 'lim-1',
							label: 'Claude 5 Hour',
							amount: { remainingFraction: 0.65 }
						},
						{
							id: 'lim-2',
							label: 'Claude 7 Day',
							amount: { remainingFraction: 0.40 }
						}
					]
				}
			];
			const res = evaluateQuotaGate({
				modelOverride: 'anthropic/claude-3-5-sonnet',
				reports,
				quotaFloorPct: 30
			});
			assert.equal(res.paused, false);
			assert.deepEqual(res.quota, { provider: 'anthropic', remainingPct: 40 });
		});

		it('blocca con quotaFloor se QUALSIASI finestra e sotto la soglia minima', () => {
			const reports: QuotaReport[] = [
				{
					provider: 'anthropic',
					limits: [
						{
							id: 'lim-1',
							label: 'Claude 5 Hour',
							amount: { remainingFraction: 0.80 }
						},
						{
							id: 'lim-2',
							label: 'Claude 7 Day',
							amount: { remainingFraction: 0.22 }
						}
					]
				}
			];
			const res = evaluateQuotaGate({
				modelOverride: 'anthropic/claude-3-5-sonnet',
				reports,
				quotaFloorPct: 30
			});
			assert.equal(res.paused, true);
			assert.deepEqual(res.quota, { provider: 'anthropic', remainingPct: 22 });
		});

		it('risolve il provider dal ruolo smol quando modelOverride e vuoto', () => {
			const reports: QuotaReport[] = [
				{
					provider: 'google',
					limits: [
						{
							id: 'g-lim',
							label: 'Flash Window',
							amount: { remainingFraction: 0.15 }
						}
					]
				}
			];
			const res = evaluateQuotaGate({
				modelOverride: '',
				modelRoles: {
					smol: 'google/gemini-2.5-flash',
					default: 'anthropic/claude-3-5-sonnet'
				},
				reports,
				quotaFloorPct: 30
			});
			assert.equal(res.paused, true);
			assert.deepEqual(res.quota, { provider: 'google', remainingPct: 15 });
		});

		it('ripiega sul ruolo default se smol e assente', () => {
			const reports: QuotaReport[] = [
				{
					provider: 'anthropic',
					limits: [
						{
							id: 'lim-def',
							label: 'Default limit',
							amount: { remainingFraction: 0.10 }
						}
					]
				}
			];
			const res = evaluateQuotaGate({
				modelOverride: '',
				modelRoles: {
					default: 'anthropic/claude-3-5-haiku'
				},
				reports,
				quotaFloorPct: 30
			});
			assert.equal(res.paused, true);
			assert.deepEqual(res.quota, { provider: 'anthropic', remainingPct: 10 });
		});

		it('riconosce gli alias di provider come google-antigravity e copilot', () => {
			const reports: QuotaReport[] = [
				{
					provider: 'google-antigravity',
					limits: [
						{
							id: 'ag-lim',
							label: 'Shared window',
							amount: { remainingFraction: 0.25 }
						}
					]
				}
			];
			const res = evaluateQuotaGate({
				modelOverride: 'google/gemini-2.5-pro',
				reports,
				quotaFloorPct: 30
			});
			assert.equal(res.paused, true);
			assert.equal(res.quota?.provider, 'google-antigravity');
			assert.equal(res.quota?.remainingPct, 25);
		});
	});

	describe('pickNextJob', () => {
		const baseStates = (): Record<BackgroundJobId, JobStateForPicker> => ({
			taskTitles: { enabled: true, userPaused: false, quotaPaused: false, pendingCount: 0 },
			sessionTitles: { enabled: true, userPaused: false, quotaPaused: false, pendingCount: 0 },
			sessionIndex: { enabled: true, userPaused: false, quotaPaused: false, pendingCount: 0 },
			gitFetch: { enabled: true, userPaused: false, quotaPaused: false, pendingCount: 0 },
			updateCheck: { enabled: true, userPaused: false, quotaPaused: false, pendingCount: 0 }
		});

		it('ritorna null se globalEnabled e false', () => {
			const states = baseStates();
			states.taskTitles.pendingCount = 2;
			assert.equal(pickNextJob(false, false, states), null);
		});

		it('ritorna null se allPaused e true', () => {
			const states = baseStates();
			states.taskTitles.pendingCount = 2;
			assert.equal(pickNextJob(true, true, states), null);
		});

		it('seleziona taskTitles se ha elementi pendenti', () => {
			const states = baseStates();
			states.taskTitles.pendingCount = 1;
			states.sessionTitles.pendingCount = 3;
			assert.equal(pickNextJob(true, false, states), 'taskTitles');
		});

		it('salta taskTitles se in quotaPaused e passa a sessionTitles o sessionIndex', () => {
			const states = baseStates();
			states.taskTitles.pendingCount = 2;
			states.taskTitles.quotaPaused = true;
			states.sessionIndex.pendingCount = 1;
			states.gitFetch.pendingCount = 4;
			assert.equal(pickNextJob(true, false, states), 'sessionIndex');
		});

		it('rispetta la sequenza taskTitles > sessionTitles > sessionIndex > gitFetch > updateCheck', () => {
			const states = baseStates();
			states.gitFetch.pendingCount = 1;
			states.updateCheck.pendingCount = 1;
			assert.equal(pickNextJob(true, false, states), 'gitFetch');

			states.sessionIndex.pendingCount = 1;
			assert.equal(pickNextJob(true, false, states), 'sessionIndex');

			states.sessionTitles.pendingCount = 1;
			assert.equal(pickNextJob(true, false, states), 'sessionTitles');

			states.taskTitles.pendingCount = 1;
			assert.equal(pickNextJob(true, false, states), 'taskTitles');
		});

		it('salta job disabilitati dall utente o disattivati nelle impostazioni', () => {
			const states = baseStates();
			states.taskTitles.pendingCount = 1;
			states.taskTitles.enabled = false;
			states.sessionTitles.pendingCount = 1;
			states.sessionTitles.userPaused = true;
			states.sessionIndex.pendingCount = 1;
			assert.equal(pickNextJob(true, false, states), 'sessionIndex');
		});
	});

	describe('Settings migration', () => {
		it('inizializza i valori predefiniti di backgroundJobs', () => {
			const parsed = parseBackgroundJobsSettings({});
			assert.equal(parsed.enabled, true);
			assert.equal(parsed.quotaFloorPct, 30);
			assert.equal(parsed.jobs.taskTitles.enabled, true);
			assert.equal(parsed.jobs.taskTitles.model, '');
			assert.equal(parsed.jobs.sessionTitles.enabled, true);
			assert.equal(parsed.jobs.sessionIndex.enabled, true);
			assert.equal(parsed.jobs.gitFetch.enabled, true);
			assert.equal(parsed.jobs.updateCheck.enabled, true);
		});

		it('migra taskTitles.autoGenerate=false su jobs.taskTitles e jobs.sessionTitles', () => {
			const parsed = parseBackgroundJobsSettings({}, { autoGenerate: false });
			assert.equal(parsed.jobs.taskTitles.enabled, false);
			assert.equal(parsed.jobs.sessionTitles.enabled, false);
			assert.equal(parsed.jobs.gitFetch.enabled, true);
		});

		it('migra github.autoFetch=false su jobs.gitFetch', () => {
			const parsed = parseBackgroundJobsSettings({}, {}, { autoFetch: false });
			assert.equal(parsed.jobs.gitFetch.enabled, false);
			assert.equal(parsed.jobs.taskTitles.enabled, true);
		});

		it('da precedenza alle impostazioni backgroundJobs gia persistite', () => {
			const parsed = parseBackgroundJobsSettings(
				{
					enabled: true,
					quotaFloorPct: 45,
					jobs: {
						taskTitles: { enabled: true, model: 'google/gemini-2.5-flash' },
						sessionTitles: { enabled: true, model: '' },
						sessionIndex: { enabled: true, model: '' },
						gitFetch: { enabled: true, model: '' },
						updateCheck: { enabled: false, model: '' }
					}
				},
				{ autoGenerate: false },
				{ autoFetch: false }
			);
			assert.equal(parsed.quotaFloorPct, 45);
			assert.equal(parsed.jobs.taskTitles.enabled, true);
			assert.equal(parsed.jobs.taskTitles.model, 'google/gemini-2.5-flash');
			assert.equal(parsed.jobs.sessionTitles.enabled, true);
			assert.equal(parsed.jobs.gitFetch.enabled, true);
			assert.equal(parsed.jobs.updateCheck.enabled, false);
		});
	});
});
