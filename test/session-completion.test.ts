import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SessionCompletionStore } from '../src/lib/agent/completion.svelte.ts';
import { observeSessionJobs, finishSessionJobs } from '../src/lib/agent/jobActivity.ts';
import { projectStore, type Project } from '../src/lib/stores/projects.svelte.ts';
import { notificationManager } from '../src/lib/stores/notifications.svelte.ts';
import { createMainLane, projectId } from '../src/lib/types/lanes.ts';

describe('shared session completion reading', () => {
	it('a stale acknowledgement cannot consume a newer result', () => {
		const store = new SessionCompletionStore();
		store.complete('reading-session', 'turn-1', 10);
		assert.equal(store.markSeen('reading-session', 'turn-1'), true);
		store.complete('reading-session', 'turn-2', 20);
		assert.equal(store.markSeen('reading-session', 'turn-1'), false);
		assert.deepEqual(store.get('reading-session'), { id: 'turn-2', at: 20, seen: false });
		assert.equal(store.markSeen('reading-session', 'turn-2'), true);
		assert.equal(store.get('reading-session')?.seen, true);
	});

	it('duplicate and older completion deliveries preserve a read result', () => {
		const store = new SessionCompletionStore();
		store.complete('duplicate-session', 'latest', 30);
		store.markSeen('duplicate-session', 'latest');
		store.complete('duplicate-session', 'latest', 30);
		store.complete('duplicate-session', 'late-old-result', 20);
		assert.deepEqual(store.get('duplicate-session'), { id: 'latest', at: 30, seen: true });
	});

	it('reading one session never marks another conversation read', () => {
		const store = new SessionCompletionStore();
		store.complete('first-conversation', 'same-turn-id', 40);
		store.complete('other-conversation', 'same-turn-id', 40);
		store.markSeen('first-conversation', 'same-turn-id');
		assert.equal(store.get('other-conversation')?.seen, false);
		assert.equal(store.get('first-conversation')?.seen, true);
	});

	it('focus and tab selection preserve unread GUI results but acknowledge terminal results', (t) => {
		const previousProjects = projectStore.projects;
		const previousActiveId = projectStore.activeId;
		const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
		t.after(() => {
			projectStore.projects = previousProjects;
			projectStore.activeId = previousActiveId;
			if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
			else Reflect.deleteProperty(globalThis, 'document');
		});
		Object.defineProperty(globalThis, 'document', {
			configurable: true, value: { hasFocus: () => true }
		});
		const id = projectId('completion-focus');
		const project: Project = {
			id, name: 'Completion', label: null, canonicalProjectPath: null,
			hue: 220, colorMode: 'auto', lane: createMainLane(id, null, 'gui'),
			layout: { left: 300, center: 0.6, leftSection: 'files', editorOpen: false },
			lastOpened: 0, autoDispatch: false, taskDefaults: null, worktreeResumeChat: true
		};
		projectStore.projects = [project];
		projectStore.activeId = id;
		project.lane.agentState = 'finished';
		notificationManager.checkFocusAcknowledgement();
		assert.equal(project.lane.agentState, 'finished', 'focus is not proof of reading the chat');
		projectStore.setActive(id);
		assert.equal(project.lane.agentState, 'finished', 'selecting a tab must not erase an unread result');
		project.lane.surface = 'terminal';
		notificationManager.checkFocusAcknowledgement();
		assert.equal(project.lane.agentState, 'idle', 'terminal focus still acknowledges completion');
		project.lane.agentState = 'finished';
		projectStore.setActive(id);
		assert.equal(project.lane.agentState, 'idle', 'terminal tab selection still acknowledges completion');
	});
});

describe('observed background jobs', () => {
	it('uses native job snapshots, keeps task subagents separate, and reconciles delivered outcomes', () => {
		const launched = observeSessionJobs([], 'job', {}, { jobs: [
			{ jobId: 'build', type: 'bash', label: 'npm run build', status: 'running' },
			{ jobId: 'reviewer', type: 'task', status: 'running' }
		] });
		assert.deepEqual(launched, [{ id: 'build', label: 'npm run build', status: 'running' }]);
		const finished = finishSessionJobs(launched, [{
			jobId: 'build', jobType: 'bash', status: 'failed', statusKind: 'failed', raw: 'build failed'
		}]);
		assert.deepEqual(finished, [{ id: 'build', label: 'npm run build', status: 'failed' }]);
		const replayed = observeSessionJobs(finished, 'bash', { command: 'npm run build' }, {
			async: { jobId: 'build', state: 'running' }
		});
		assert.deepEqual(replayed, [{ id: 'build', label: 'npm run build', status: 'failed' }]);
	});

	it('does not mistake an async request or an untyped result for a launched job', () => {
		assert.deepEqual(observeSessionJobs([], 'bash', { async: true, command: 'build' }, { exitCode: 0 }), []);
		assert.deepEqual(observeSessionJobs([], 'job', {}, { jobs: [{ id: 'mystery', status: 'running' }] }), []);
	});
});
