import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { projectStore, type Project } from '../src/lib/stores/projects.svelte.ts';
import { projectOrder } from '../src/lib/stores/projectOrder.svelte.ts';
import { normalizeProjectPath, pathKey } from '../src/lib/utils/paths.ts';
import { buildRootEntries, resolveOpenRouteDecision, type ExternalRoute } from '../src/lib/externalOpen.svelte.ts';
import { isMermaidFileName, computeMermaidPreviewState } from '../src/lib/mermaidSvg.ts';
import { MAIN_LANE_ID } from '../src/lib/types/lanes.ts';

describe('File esterni (EXT-002..010)', () => {
	beforeEach(() => {
		// Pulisci l'elenco dei progetti prima di ogni test
		projectStore.projects = [];
		projectStore.activeId = null;
	});

	it('openExternal crea un progetto con external: true', () => {
		const workdir = '/tmp/downloads/my-folder';
		const id = projectStore.openExternal(workdir);
		assert.ok(id);

		const proj = projectStore.projects.find((p) => p.id === id);
		assert.ok(proj);
		assert.equal(proj.external, true);
		assert.equal(proj.name, 'my-folder');
		assert.equal(proj.canonicalProjectPath, normalizeProjectPath(workdir));
		assert.deepEqual(proj.lane.openFiles, []);
	});

	it('openExternal riusa il progetto se già aperto per la stessa cartella', () => {
		const workdir = '/tmp/downloads/same-folder';
		const id1 = projectStore.openExternal(workdir);
		const id2 = projectStore.openExternal(workdir);

		assert.equal(id1, id2);
		const matching = projectStore.projects.filter(
			(p) => p.canonicalProjectPath && pathKey(p.canonicalProjectPath) === pathKey(workdir)
		);
		assert.equal(matching.length, 1);
	});

	it('openProject su percorso esterno promuove il progetto a external: false', () => {
		const workdir = '/tmp/repos/promoted-project';
		const extId = projectStore.openExternal(workdir);
		assert.ok(extId);

		const extProj = projectStore.projects.find((p) => p.id === extId);
		assert.equal(extProj?.external, true);

		// Apertura dello stesso percorso come progetto ordinario
		const normalId = projectStore.openProject(workdir);
		assert.equal(normalId, extId);

		const promoted = projectStore.projects.find((p) => p.id === extId);
		assert.ok(promoted);
		assert.equal(promoted.external, false);
		assert.equal(projectStore.activeId, extId);
	});

	it('promoteExternal promuove il progetto a ordinario', () => {
		const workdir = '/tmp/repos/manual-promote';
		const id = projectStore.openExternal(workdir);
		assert.ok(id);

		projectStore.promoteExternal(id);
		const promoted = projectStore.projects.find((p) => p.id === id);
		assert.ok(promoted);
		assert.equal(promoted.external, false);
	});

	it('chiudere l’ultimo file esterno elimina la cartella e torna al progetto rimasto', () => {
		const normalId = projectStore.openProject('/tmp/repos/normal-proj');
		const id = projectStore.openExternal('/tmp/external/files-folder');
		assert.ok(id);
		projectStore.activeId = id;
		projectStore.openFile(id, 'sub/note.txt');
		projectStore.openFile(id, 'config.json');

		projectStore.closeFile(id, 'config.json');
		const proj = projectStore.projects.find((p) => p.id === id);
		assert.ok(proj);
		assert.deepEqual(proj.lane.openFiles, ['sub/note.txt']);
		assert.equal(proj.lane.activeFile, 'sub/note.txt');
		assert.equal(projectStore.activeId, id);

		projectStore.closeFile(id, 'sub/note.txt');
		assert.equal(projectStore.projects.some((p) => p.external), false);
		assert.equal(projectStore.activeId, normalId);
	});

	it('chiudere una cartella esterna mantiene i file delle altre cartelle', () => {
		const first = projectStore.openExternal('/tmp/external/first');
		const second = projectStore.openExternal('/tmp/external/second');
		assert.ok(first);
		assert.ok(second);
		projectStore.activeId = second;
		projectStore.openFile(first, 'a.txt');
		projectStore.openFile(second, 'b.txt');

		projectStore.closeFile(first, 'a.txt');
		assert.deepEqual(projectStore.projects.map((p) => p.id), [second]);
		assert.deepEqual(projectStore.activeProject?.lane.openFiles, ['b.txt']);

		projectStore.closeFile(second, 'b.txt');
		assert.deepEqual(projectStore.projects, []);
		assert.equal(projectStore.activeId, null);
	});

	it('Chiudi tutti elimina la cartella esterna ma non i progetti ordinari', () => {
		const normalId = projectStore.openProject('/tmp/repos/normal-proj');
		assert.ok(normalId);
		projectStore.openFile(normalId, 'README.md');
		projectStore.closeAllFiles(normalId);
		assert.equal(projectStore.activeId, normalId);
		assert.deepEqual(projectStore.activeProject?.lane.openFiles, []);

		const externalId = projectStore.openExternal('/tmp/external/files-folder');
		assert.ok(externalId);
		projectStore.activeId = externalId;
		projectStore.openFile(externalId, 'a.txt');
		projectStore.openFile(externalId, 'b.txt');
		projectStore.closeAllFiles(externalId);
		assert.deepEqual(projectStore.projects.map((p) => p.id), [normalId]);
		assert.equal(projectStore.activeId, normalId);

		projectStore.openFile(normalId, 'README.md');
		projectStore.closeFile(normalId, 'README.md');
		assert.equal(projectStore.activeId, normalId);
		assert.deepEqual(projectStore.activeProject?.lane.openFiles, []);
	});

	it('projectOrder.list esclude i progetti esterni', () => {
		const normalPath = '/tmp/repos/normal-proj';
		const extPath = '/tmp/downloads/ext-proj';

		const normalId = projectStore.openProject(normalPath);
		const extId = projectStore.openExternal(extPath);

		assert.ok(normalId);
		assert.ok(extId);

		const list = projectOrder.list;
		assert.equal(list.some((p) => p.id === normalId), true);
		assert.equal(list.some((p) => p.id === extId), false);

		// Se promosso, compare subito nella lista ordinata
		projectStore.promoteExternal(extId);
		const updatedList = projectOrder.list;
		assert.equal(updatedList.some((p) => p.id === extId), true);
	});

	it('registeredProjectMetadata esclude i progetti esterni', () => {
		const extPath = '/tmp/downloads/unregistered-ext';
		projectStore.openExternal(extPath);

		const metas = projectStore.registeredProjectMetadata;
		assert.equal(
			metas.some((m) => pathKey(m.path) === pathKey(extPath)),
			false
		);
	});

	it('buildRootEntries distingue radice worktree e radice canonica del progetto', () => {
		const projects = [
			{
				id: 'proj-with-worktree',
				canonicalProjectPath: '/repos/my-app',
				lane: {
					laneId: 'wt-feature',
					workspacePath: '/repos/my-app-worktrees/wt-feature'
				}
			},
			{
				id: 'proj-main-only',
				canonicalProjectPath: '/repos/other-app',
				lane: {
					laneId: MAIN_LANE_ID,
					workspacePath: '/repos/other-app'
				}
			}
		];

		const roots = buildRootEntries(projects);
		assert.equal(roots.length, 3);

		const wtEntry = roots.find((r) => r.path === normalizeProjectPath('/repos/my-app-worktrees/wt-feature'));
		assert.ok(wtEntry);
		assert.equal(wtEntry.projectId, 'proj-with-worktree');
		assert.equal(wtEntry.isMain, false);

		const mainEntry = roots.find((r) => r.path === normalizeProjectPath('/repos/my-app'));
		assert.ok(mainEntry);
		assert.equal(mainEntry.projectId, 'proj-with-worktree');
		assert.equal(mainEntry.isMain, true);

		const otherEntry = roots.find((r) => r.path === normalizeProjectPath('/repos/other-app'));
		assert.ok(otherEntry);
		assert.equal(otherEntry.projectId, 'proj-main-only');
		assert.equal(otherEntry.isMain, true);
	});

	it('resolveOpenRouteDecision passa a Principale solo se il file sta nella radice principale con worktree attivo', () => {
		const rootEntries = [
			{
				path: normalizeProjectPath('/repos/my-app-worktrees/wt-feature'),
				projectId: 'proj-1',
				isMain: false
			},
			{
				path: normalizeProjectPath('/repos/my-app'),
				projectId: 'proj-1',
				isMain: true
			}
		];

		const activeLanes: Record<string, string> = { 'proj-1': 'wt-feature' };
		const getActiveLane = (id: string) => activeLanes[id];

		// Caso 1: file nella radice canonica mentre la corsia attiva e' un worktree -> passa a Principale
		const routeMainFile: ExternalRoute = {
			file: '/repos/my-app/src/index.ts',
			rootIndex: 1, // Punta alla radice isMain: true
			workdir: '/repos/my-app',
			rel: 'src/index.ts'
		};
		const decision1 = resolveOpenRouteDecision(routeMainFile, rootEntries, getActiveLane);
		assert.ok(decision1);
		assert.equal(decision1.kind, 'project');
		if (decision1.kind === 'project') {
			assert.equal(decision1.projectId, 'proj-1');
			assert.equal(decision1.rel, 'src/index.ts');
			assert.equal(decision1.switchToMain, true);
		}

		// Caso 2: file nella corsia worktree attiva -> resta com'e' (switchToMain: false)
		const routeWorktreeFile: ExternalRoute = {
			file: '/repos/my-app-worktrees/wt-feature/src/feature.ts',
			rootIndex: 0, // Punta alla radice isMain: false
			workdir: '/repos/my-app-worktrees/wt-feature',
			rel: 'src/feature.ts'
		};
		const decision2 = resolveOpenRouteDecision(routeWorktreeFile, rootEntries, getActiveLane);
		assert.ok(decision2);
		assert.equal(decision2.kind, 'project');
		if (decision2.kind === 'project') {
			assert.equal(decision2.projectId, 'proj-1');
			assert.equal(decision2.rel, 'src/feature.ts');
			assert.equal(decision2.switchToMain, false);
		}

		// Caso 3: il progetto ha gia' la corsia Principale attiva -> non serve commutare
		activeLanes['proj-1'] = MAIN_LANE_ID;
		const decision3 = resolveOpenRouteDecision(routeMainFile, rootEntries, getActiveLane);
		assert.ok(decision3);
		assert.equal(decision3.kind, 'project');
		if (decision3.kind === 'project') {
			assert.equal(decision3.switchToMain, false);
		}

		// Caso 4: file esterno (rootIndex: null) -> apre come progetto esterno
		const routeExtFile: ExternalRoute = {
			file: '/tmp/downloads/readme.txt',
			rootIndex: null,
			workdir: '/tmp/downloads',
			rel: 'readme.txt'
		};
		const decision4 = resolveOpenRouteDecision(routeExtFile, rootEntries, getActiveLane);
		assert.ok(decision4);
		assert.equal(decision4.kind, 'external');
		if (decision4.kind === 'external') {
			assert.equal(decision4.workdir, '/tmp/downloads');
			assert.equal(decision4.rel, 'readme.txt');
		}
	});

	it('isMermaidFileName e validazione sintassi Mermaid (EXT-006)', async () => {
		assert.equal(isMermaidFileName('schema.mmd'), true);
		assert.equal(isMermaidFileName('diagramma.mermaid'), true);
		assert.equal(isMermaidFileName('/percorso/a/PROGETTO.MMD'), true);
		assert.equal(isMermaidFileName('pagina.html'), false);
		assert.equal(isMermaidFileName('appunti.md'), false);
		assert.equal(isMermaidFileName(null), false);

		// Prova di rendering con funzione pura su .mmd valido e non valido (EXT-006)
		const validMmd = 'graph TD\n  A[Start] --> B[End]';
		const mockRenderer = async (src: string) => {
			if (!src.includes('-->')) throw new Error('Errore di sintassi Mermaid: freccia mancante');
			return `<svg class="mermaid"><text>${src}</text></svg>`;
		};

		const validState = await computeMermaidPreviewState(validMmd, mockRenderer);
		assert.equal(validState.error, null);
		assert.ok(validState.svg.startsWith('<svg'));
		assert.ok(validState.svg.includes('Start'));

		const invalidMmd = 'questo non e un diagramma valido';
		const invalidState = await computeMermaidPreviewState(invalidMmd, mockRenderer);
		assert.equal(invalidState.svg, '');
		assert.equal(invalidState.error, 'Errore di sintassi Mermaid: freccia mancante');

		// Sorgente vuota
		const emptyState = await computeMermaidPreviewState('   ', mockRenderer);
		assert.deepEqual(emptyState, { svg: '', error: null });
	});
});
