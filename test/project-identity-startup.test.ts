/**
 * R-MI-45: la tessera di un progetto presente su più macchine è unita dal
 * primo disegno della barra, senza aspettare lo stato git e senza un clic.
 *
 * L'identità arriva dallo snapshot dell'host (e dalla sua cache) o dal record
 * salvato della copia locale; lo stato git la conferma soltanto. Le chiavi
 * della cache distinguono la macchina, così due copie con lo stesso percorso
 * su macchine diverse non si scambiano il repository.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { projectStore, type Project } from '../src/lib/stores/projects.svelte.ts';
import { projectOrder } from '../src/lib/stores/projectOrder.svelte.ts';
import { githubStore } from '../src/lib/stores/github.svelte.ts';
import { identityCacheKey, groupByRepository } from '../src/lib/stores/projectIdentity.ts';
import type { DesktopHostSnapshot } from '../src/lib/backend/host.ts';
import { MAIN_LANE_ID, createMainLane, projectId, canonicalProjectPath, workspacePath } from '../src/lib/types/lanes.ts';

function localProject(path: string, identity: { repoSlug?: string | null; rootCommit?: string | null } | null): Project {
	const canonical = canonicalProjectPath(path);
	const id = projectId(`local-${path}`);
	return {
		id,
		name: path.split('/').pop() ?? path,
		label: null,
		canonicalProjectPath: canonical,
		hue: 0,
		colorMode: 'auto',
		lane: createMainLane(id, canonical, 'gui'),
		layout: { left: 260, center: 0.5, leftSection: 'files', editorOpen: true },
		lastOpened: 0,
		autoDispatch: false,
		taskDefaults: null,
		worktreeResumeChat: true,
		external: false,
		identity
	};
}

function hostSnapshot(
	projectPath: string,
	platform: string,
	identity: { repoSlug?: string | null; rootCommit?: string | null } | null
): DesktopHostSnapshot {
	const hostId = projectId('host-project');
	const canonical = canonicalProjectPath(projectPath, platform === 'windows');
	const lane = {
		projectId: hostId,
		laneId: MAIN_LANE_ID,
		title: 'Principale',
		workspacePath: workspacePath(projectPath, platform === 'windows'),
		branch: 'main',
		baseCommit: null,
		targetBranch: null,
		createdAt: null,
		status: 'active' as const,
		origin: 'main' as const,
		agentState: 'idle' as const,
		openFiles: [],
		activeFile: null,
		surface: 'gui' as const,
		kind: 'git' as const,
		labPrototypeId: null,
		adopted: false
	};
	return {
		version: 1,
		platform,
		projectRoot: projectPath,
		projects: [{
			id: hostId,
			name: 'omp-studio',
			label: null,
			canonicalProjectPath: canonical,
			hue: 200,
			colorMode: 'auto',
			lane,
			layout: { left: 260, center: 0.5, leftSection: 'files', editorOpen: true },
			lastOpened: 10,
			autoDispatch: false,
			taskDefaults: null,
			worktreeResumeChat: true,
			external: false,
			identity
		}],
		lanes: [],
		tasks: [],
		sessions: [],
		state: {} as DesktopHostSnapshot['state']
	} as DesktopHostSnapshot;
}

describe('Tessera unita fin dall avvio (R-MI-45)', () => {
	beforeEach(() => {
		projectStore.projects = [];
		projectStore.activeId = null;
		githubStore.upstreamByPath = {};
	});

	it('copia locale salvata + copia remota con la sola identita dello snapshot: una tessera', () => {
		projectStore.projects = [localProject('/dev/omp-studio', { repoSlug: 'bodyes26/omp-studio' })];
		// Nessuno stato git letto: la barra non deve dipendere da `upstreamByPath`.
		projectStore.syncRemoteProjects('mac-1', 'Mac Studio', hostSnapshot('/Users/other/dev/omp-studio', 'macos', {
			repoSlug: 'Bodyes26/OMP-Studio'
		}));
		assert.deepEqual(githubStore.upstreamByPath, {}, 'lo stato git non e stato toccato');

		assert.equal(projectStore.projects.length, 2);
		assert.equal(projectOrder.unified.length, 1, 'un solo repository, una sola tessera');
		assert.equal(projectOrder.groups[0].length, 2);

		const copies = projectStore.projects.map((p) => projectStore.knownIdentityOf(p));
		assert.deepEqual(groupByRepository(copies), [[0, 1]], 'la regola pura conferma la fusione');
	});

	it('stesso percorso su due macchine con repo diversi: due tessere', () => {
		// Tre copie con la stessa cartella `C:\dev\omp`, due repository distinti.
		projectStore.projects = [localProject('C:/dev/omp', { repoSlug: 'bodyes26/omp' })];
		projectStore.syncRemoteProjects('mac-1', 'Mac Studio', hostSnapshot('C:/dev/omp', 'windows', {
			repoSlug: 'bodyes26/omp'
		}));
		projectStore.syncRemoteProjects('pc-1', 'PC', hostSnapshot('C:/dev/omp', 'windows', {
			repoSlug: 'bodyes26/altro'
		}));

		assert.equal(projectStore.projects.length, 3);
		const groups = projectOrder.groups.map((group) => group.map((p) => p.machineId ?? 'local').sort());
		assert.deepEqual(groups, [['local', 'mac-1'], ['pc-1']], 'la copia del PC non eredita l identita del Mac');
	});

	it('le chiavi di identita distinguono macchina e sistema del percorso', () => {
		const pc = identityCacheKey('pc-1', 'C:/dev/omp', 'windows');
		const mac = identityCacheKey('mac-1', '/dev/omp', 'macos');
		assert.ok(pc && mac);
		assert.notEqual(pc, mac, 'stesso nome, macchine diverse: chiavi diverse');
		assert.equal(identityCacheKey('pc-1', 'C:\\dev\\omp\\', 'windows'), identityCacheKey('pc-1', 'c:/dev/omp', 'windows'));
		// Il percorso remoto si normalizza col sistema della macchina che lo possiede.
		assert.equal(identityCacheKey('mac-1', '/Users/x/dev/omp', 'macos'), 'mac-1::/users/x/dev/omp');
		assert.equal(identityCacheKey(null, '/dev/omp', 'macos'), 'local::/dev/omp');
	});

	it('identita salvata nel record all avvio: una tessera prima di git', () => {
		// `initStore` rimette `identity` sul progetto letto da settings.json.
		projectStore.projects = [localProject('/dev/omp-studio', { repoSlug: 'bodyes26/omp-studio', rootCommit: null })];
		projectStore.syncRemoteProjects('mac-1', 'Mac Studio', hostSnapshot('/Users/other/dev/omp-studio', 'macos', {
			repoSlug: 'bodyes26/omp-studio'
		}));
		assert.equal(projectOrder.unified.length, 1);
	});

	it('senza identita da nessuna parte le copie restano separate', () => {
		projectStore.projects = [localProject('/dev/omp-studio', null)];
		projectStore.syncRemoteProjects('mac-1', 'Mac Studio', hostSnapshot('/Users/other/dev/omp-studio', 'macos', null));
		assert.equal(projectOrder.unified.length, 2, 'meglio due tessere che unire per errore');
	});

	it('lo stato git della copia che possiede il percorso conferma l identita nota', () => {
		projectStore.projects = [
			localProject('/dev/omp', { repoSlug: 'bodyes26/omp' }),
			localProject('/dev/altro', { repoSlug: 'bodyes26/altro' })
		];
		projectStore.rememberGitIdentity('local', '/dev/omp', { repoSlug: 'bodyes26/omp', rootCommit: 'abc123' });
		assert.equal(projectStore.knownIdentityOf(projectStore.projects[0])?.repoSlug, 'bodyes26/omp');
		assert.equal(projectStore.knownIdentityOf(projectStore.projects[0])?.rootCommit, 'abc123');
		// La seconda copia non eredita l'identita della prima.
		assert.equal(projectStore.knownIdentityOf(projectStore.projects[1])?.repoSlug, 'bodyes26/altro');
	});
});
