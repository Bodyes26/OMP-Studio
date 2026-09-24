import { load, type Store } from '@tauri-apps/plugin-store';
import { homeDir } from '@tauri-apps/api/path';
import { debounce } from 'lodash-es';
import { settingsStore, type TaskDefaults } from './settings.svelte';
import { extractOrigin, isLocalOrigin } from '$lib/agent/browser-live';
import {
	canonicalProjectPath,
	createMainLane,
	projectId,
	type AgentLane,
	type AgentState,
	type AgentSurface,
	type CanonicalProjectPath,
	type ProjectId,
	workspacePath
} from '$lib/types/lanes';
import { labApi } from '$lib/lab/api';
import type { LabIndexEntry } from '$lib/lab/types';

import { isWindows, normalizeProjectPath, joinProjectPath, pathKey } from '$lib/utils/paths';
import {
	applyTabRename,
	applyTabTrash,
	buildProjectMetadata,
	createProjectMetadataMap,
	isPathUnder,
	pruneProjectMetadata,
	remapPath,
	reorderItemsList,
	resolveProjectTabInfo,
	shiftItemList,
	type ProjectColorMode,
	type ProjectLayout,
	type StoredProjectMetadata
} from './projectTabHelpers';
export { normalizeProjectPath, joinProjectPath, pathKey, isWindows, isPathUnder, remapPath };
export type { ProjectColorMode, ProjectLayout, StoredProjectMetadata };

export type { AgentState } from '$lib/types/lanes';

export interface Project {
	id: ProjectId;
	name: string;
	label: string | null;
	canonicalProjectPath: CanonicalProjectPath | null;
	hue: number;
	colorMode: ProjectColorMode;
	lane: AgentLane;
	layout: ProjectLayout;
	lastOpened: number;
	/** Il primo task in coda parte da solo appena il terminale e' libero. */
	autoDispatch: boolean;
	/** Default dei task di questo progetto: sovrascrivono taskDefaults globali. */
	taskDefaults: Partial<TaskDefaults> | null;
	/** Origini remote autorizzate per Browser Studio (S43). Persistite per progetto. */
	browserAllowedOrigins?: string[];
	/** Configurazione bozza libera del Laboratorio (contratto §7). */
	labDraft?: { prototypeId: string } | null;
}

interface StoredProject {
	id: string;
	name: string;
	label?: string | null;
	path?: string;
	canonicalProjectPath?: string | null;
	hue?: number;
	colorMode?: ProjectColorMode;
	lane?: { surface?: AgentSurface };
	layout?: Partial<ProjectLayout> & { rightSection?: AgentSurface };
	lastOpened?: number;
	autoDispatch?: boolean;
	taskDefaults?: Partial<TaskDefaults> | null;
	browserAllowedOrigins?: string[];
	labDraft?: { prototypeId: string } | null;
}

export const PRESET_HUES = [355, 25, 60, 135, 175, 220, 265, 305];

function getProjectHue(path: string): number {
	const key = pathKey(path);
	let hash = 0;
	for (let i = 0; i < key.length; i++) {
		hash = key.charCodeAt(i) + ((hash << 5) - hash);
	}
	return PRESET_HUES[Math.abs(hash) % PRESET_HUES.length];
}

class ProjectStore {
	projects = $state<Project[]>([]);
	activeId = $state<string | null>(null);
	projectRoot = $state<string>('');
	/** Vero quando i progetti persistiti sono stati letti dal disco: prima di
	 *  allora `projects` e' vuoto perche' non si sa ancora niente, non perche'
	 *  l'utente non abbia progetti. */
	ready = $state(false);
	loadError = $state<string | null>(null);
	private metadata = new Map<string, StoredProjectMetadata>();
	private store: Store | null = null;
	private initialized = false;
	private initPromise: Promise<void> | null = null;

	constructor() {
		void this.init();
		if (typeof window !== 'undefined') {
			window.addEventListener('beforeunload', () => {
				void this.save.flush();
			});
		}
	}

	/**
	 * Idempotente e memoizzata come `settingsStore.init()`: la chiamano il
	 * costruttore e chiunque debba decidere qualcosa in base ai progetti
	 * salvati (per esempio il contratto di setup all'avvio).
	 */
	init(): Promise<void> {
		if (!this.initPromise) {
			this.initPromise = this.initStore().catch((err) => {
				const errorMsg = err instanceof Error ? err.message : String(err);
				console.error('Caricamento progetti fallito:', err);
				this.loadError = errorMsg;
				this.ready = true;
			});
		}
		return this.initPromise;
	}

	private async initStore() {
		// Erano otto IPC in fila, e fino all'ultima la finestra mostrava lo
		// stato «nessun progetto»: qui l'unico ordine obbligatorio e' avere lo
		// store aperto prima di leggerlo. L'ordinamento (`mru` o no) decide se
		// piu' sotto si riordina: va letto da disco, non dal default.
		const [, store] = await Promise.all([
			settingsStore.init(),
			load('settings.json', { autoSave: false })
		]);
		this.store = store;
		const [storedProjects, storedMetadata, storedActiveId, storedRoot, home] = await Promise.all([
			store.get<StoredProject[]>('projects'),
			store.get<StoredProjectMetadata[]>('projectMetadata'),
			store.get<string>('activeProjectId'),
			store.get<string>('projectRoot'),
			homeDir()
		]);
		this.metadata = createProjectMetadataMap(storedMetadata);
		// `join` del plugin path e' un altro giro di IPC per concatenare
		// segmenti gia' noti: `joinProjectPath` fa lo stesso in memoria.
		const defaultRoot = isWindows
			? joinProjectPath(normalizeProjectPath(home), 'source\\repos')
			: joinProjectPath(normalizeProjectPath(home), 'dev');
		this.projectRoot = normalizeProjectPath(storedRoot || defaultRoot);

		if (storedProjects) {
			const seen = new Set<string>();
			this.projects = [];
			for (const p of storedProjects) {
				if (p.labDraft?.prototypeId) {
					const prototypeId = p.labDraft.prototypeId;
					let validEntry: LabIndexEntry | null = null;
					try {
						const drafts = await labApi.listIndex(null);
						const found = drafts.find((d) => d.id === prototypeId);
						if (found && found.workspacePath) {
							const exists = await labApi.workspaceExists(found.workspacePath);
							if (exists) validEntry = found;
						}
					} catch {
						validEntry = null;
					}
					if (!validEntry) continue;
					const id = projectId(p.id || `draft-${prototypeId}`);
					const project: Project = {
						id,
						name: validEntry.title || p.name || 'Bozza Lab',
						label: null,
						canonicalProjectPath: null,
						hue: typeof p.hue === 'number' ? p.hue : 0,
						colorMode: 'auto',
						lane: createMainLane(id, null, 'gui', {
							kind: 'lab',
							labPrototypeId: prototypeId,
							workspacePath: workspacePath(validEntry.workspacePath),
							title: validEntry.title || p.name || 'Bozza Lab'
						}),
						layout: {
							left: typeof p.layout?.left === 'number' ? p.layout.left : 260,
							center: typeof p.layout?.center === 'number' ? p.layout.center : 0.5,
							leftSection: 'files',
							editorOpen: false
						},
						lastOpened: typeof p.lastOpened === 'number' ? p.lastOpened : 0,
						autoDispatch: false,
						taskDefaults: null,
						labDraft: { prototypeId }
					};
					this.projects.push(project);
					continue;
				}

				const rawPath =
					typeof p.canonicalProjectPath === 'string' ? p.canonicalProjectPath : p.path;
				const normalizedPath = normalizeProjectPath(rawPath ?? '');
				// I doppioni nati prima della normalizzazione (stessa cartella con
				// separatori o maiuscole diverse) vanno collassati sul primo.
				if (!normalizedPath || seen.has(pathKey(normalizedPath))) continue;
				seen.add(pathKey(normalizedPath));
				const id = projectId(p.id);
				const canonicalPath = canonicalProjectPath(normalizedPath);
				const surface =
					p.lane?.surface === 'gui' || p.layout?.rightSection === 'gui' ? 'gui' : 'terminal';
				const project: Project = {
					id,
					name: p.name,
					label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : null,
					canonicalProjectPath: canonicalPath,
					hue: typeof p.hue === 'number' ? p.hue : getProjectHue(normalizedPath),
					// Le versioni precedenti non salvavano l'origine. Se la tinta
					// coincide con quella deterministica, puo' seguire il tema.
					colorMode:
						p.colorMode === 'custom' ||
						(typeof p.hue === 'number' && p.hue !== getProjectHue(normalizedPath))
							? 'custom'
							: 'auto',
					lane: createMainLane(id, canonicalPath, surface),
					layout: {
						left: typeof p.layout?.left === 'number' ? p.layout.left : 260,
						center: typeof p.layout?.center === 'number' ? p.layout.center : 0.5,
						leftSection: p.layout?.leftSection === 'sessions' ? 'sessions' : 'files',
						editorOpen: p.layout?.editorOpen !== false
					},
					lastOpened: typeof p.lastOpened === 'number' ? p.lastOpened : 0,
					autoDispatch: p.autoDispatch === true,
					taskDefaults: p.taskDefaults && typeof p.taskDefaults === 'object' ? p.taskDefaults : null,
					browserAllowedOrigins: p.browserAllowedOrigins
				};
				this.projects.push(project);
				this.syncProjectMetadata(project);
			}
		}

		if (storedActiveId && this.projects.some(p => p.id === storedActiveId)) {
			this.activeId = storedActiveId;
		} else if (this.projects.length > 0) {
			this.activeId = this.projects[0].id;
		}

		this.initialized = true;
		this.ready = true;
	}
	private syncProjectMetadata(p: Project) {
		const meta = buildProjectMetadata({
			id: p.id,
			name: p.name,
			label: p.label,
			canonicalProjectPath: p.canonicalProjectPath,
			hue: p.hue,
			colorMode: p.colorMode,
			layout: $state.snapshot(p.layout),
			lastOpened: p.lastOpened,
			autoDispatch: p.autoDispatch,
			taskDefaults: p.taskDefaults ? $state.snapshot(p.taskDefaults) : null,
			browserAllowedOrigins: p.browserAllowedOrigins ? [...p.browserAllowedOrigins] : undefined
		});
		if (!meta || !p.canonicalProjectPath) return;
		this.metadata.set(pathKey(p.canonicalProjectPath), meta);
	}

	getProjectMetadata(path: string): StoredProjectMetadata | undefined {
		const normalized = normalizeProjectPath(path);
		if (!normalized) return undefined;
		return this.metadata.get(pathKey(normalized));
	}

	async flushSave(): Promise<void> {
		await this.save.flush();
	}

	private save = debounce(async () => {
		if (!this.initialized || !this.store) {
			if (this.loadError) {
				console.warn('Salvataggio progetti rifiutato: store in errore di caricamento preliminare.');
			}
			return;
		}
		for (const p of this.projects) {
			if (p.canonicalProjectPath) {
				this.syncProjectMetadata(p);
			}
		}
		const toSave = this.projects
			.filter((p) => p.canonicalProjectPath !== null || p.labDraft != null)
			.map((p) => ({
				id: p.id,
				name: p.name,
				label: p.label,
				canonicalProjectPath: p.canonicalProjectPath,
				hue: p.hue,
				colorMode: p.colorMode,
				lane: { surface: p.lane.surface },
				layout: $state.snapshot(p.layout),
				lastOpened: p.lastOpened,
				autoDispatch: p.autoDispatch,
				taskDefaults: p.taskDefaults ? $state.snapshot(p.taskDefaults) : null,
				browserAllowedOrigins: p.browserAllowedOrigins,
				labDraft: p.labDraft ?? undefined
			}));
		const metaToSave = pruneProjectMetadata(Array.from(this.metadata.values()));
		await this.store.set('projects', toSave);
		await this.store.set('projectMetadata', metaToSave);
		await this.store.set('activeProjectId', this.activeId);
		await this.store.set('projectRoot', this.projectRoot);
		await this.store.save();
	}, 500);

	openProject(path: string) {
		const normalizedPath = normalizeProjectPath(path);
		if (!normalizedPath) return null;
		const key = pathKey(normalizedPath);
		const existing = this.projects.find(
			(p) => p.canonicalProjectPath && pathKey(p.canonicalProjectPath) === key
		);
		if (existing) {
			existing.lastOpened = Date.now();
			this.syncProjectMetadata(existing);
			this.activeId = existing.id;
			this.save();
			return existing.id;
		}

		const meta = this.metadata.get(key);
		const defaultHue = getProjectHue(normalizedPath);
		const resolved = resolveProjectTabInfo(normalizedPath, meta, defaultHue);

		const id =
			resolved.id && !this.projects.some((p) => p.id === resolved.id)
				? projectId(resolved.id)
				: projectId(crypto.randomUUID());
		const canonicalPath = canonicalProjectPath(normalizedPath);

		const newProj: Project = {
			id,
			name: resolved.name,
			label: resolved.label,
			canonicalProjectPath: canonicalPath,
			hue: resolved.hue,
			colorMode: resolved.colorMode,
			lane: createMainLane(id, canonicalPath, settingsStore.general.defaultSurface),
			layout: resolved.layout,
			lastOpened: Date.now(),
			autoDispatch: resolved.autoDispatch,
			taskDefaults: resolved.taskDefaults,
			browserAllowedOrigins: resolved.browserAllowedOrigins
		};
		// Nuovo progetto: in coda con l'ordine manuale, in testa solo se
		// l'utente ha scelto `mru` (il piu' recente resta il piu' visibile).
		if (settingsStore.projectBar.order === 'mru') {
			this.projects.unshift(newProj);
		} else {
			this.projects.push(newProj);
		}
		this.activeId = id;
		this.syncProjectMetadata(newProj);
		this.save();
		return id;
	}

	/** Cambia la cartella in cui cercare i progetti e la persiste. Usata dal
	 *  primo avvio guidato e dalle impostazioni. */
	setProjectRoot(path: string) {
		const canonical = normalizeProjectPath(path);
		if (!canonical) return;
		this.projectRoot = canonical;
		this.save();
	}
	/** Concede l'autorizzazione persistente a un'origine remota per il progetto specificato (S43). */
	grantBrowserOrigin(projectId: string, originOrUrl: string) {
		const origin = extractOrigin(originOrUrl);
		if (!origin || isLocalOrigin(origin)) return;
		const project = this.projects.find((p) => p.id === projectId);
		if (!project) return;
		const current = project.browserAllowedOrigins ?? [];
		if (!current.includes(origin)) {
			project.browserAllowedOrigins = [...current, origin];
			this.save();
		}
	}

	/** Revoca immediatamente l'autorizzazione a un'origine remota per il progetto (S43). */
	revokeBrowserOrigin(projectId: string, originOrUrl: string) {
		const origin = extractOrigin(originOrUrl);
		if (!origin) return;
		const project = this.projects.find((p) => p.id === projectId);
		if (!project || !project.browserAllowedOrigins) return;
		project.browserAllowedOrigins = project.browserAllowedOrigins.filter((o) => o !== origin);
		this.save();
	}

	/** Restituisce l'elenco delle origini remote autorizzate per il progetto. */
	getBrowserAllowedOrigins(projectId: string): string[] {
		const project = this.projects.find((p) => p.id === projectId);
		return project?.browserAllowedOrigins ?? [];
	}

	openScratchpad() {
		const id = projectId(crypto.randomUUID());
		const scratchpadProj: Project = {
			id,
			name: 'Scratchpad',
			label: null,
			canonicalProjectPath: null,
			hue: 0,
			colorMode: 'auto',
			lane: createMainLane(id, null, settingsStore.general.defaultSurface),
			layout: {
				left: 260,
				center: 0.5,
				leftSection: 'files',
				editorOpen: false
			},
			lastOpened: Date.now(),
			autoDispatch: false,
			taskDefaults: null
		};
		if (settingsStore.projectBar.order === 'mru') {
			this.projects.unshift(scratchpadProj);
		} else {
			this.projects.push(scratchpadProj);
		}
		this.activeId = id;
		this.save();
		return id;
	}

	openDraft(entry: LabIndexEntry): ProjectId {
		const existing = this.projects.find((p) => p.labDraft?.prototypeId === entry.id);
		if (existing) {
			this.activeId = existing.id;
			return existing.id;
		}
		const id = projectId(`draft-${entry.id}`);
		const draftProj: Project = {
			id,
			name: entry.title,
			label: null,
			canonicalProjectPath: null,
			hue: 0,
			colorMode: 'auto',
			lane: createMainLane(id, null, 'gui', {
				kind: 'lab',
				labPrototypeId: entry.id,
				workspacePath: workspacePath(entry.workspacePath),
				title: entry.title
			}),
			layout: {
				left: 260,
				center: 0.5,
				leftSection: 'files',
				editorOpen: false
			},
			lastOpened: Date.now(),
			autoDispatch: false,
			taskDefaults: null,
			labDraft: { prototypeId: entry.id }
		};
		if (settingsStore.projectBar.order === 'mru') {
			this.projects.unshift(draftProj);
		} else {
			this.projects.push(draftProj);
		}
		this.activeId = id;
		this.save();
		return id;
	}
	/**
	 * Chiudere una scheda deve chiudere anche il processo omp che le sta
	 * dietro: lo store non conosce le sessioni, quindi lo annuncia e chi le
	 * possiede (`routes/+page.svelte`) le dispone.
	 */
	closeProject(id: string) {
		const idx = this.projects.findIndex(p => p.id === id);
		if (idx === -1) return;
		const p = this.projects[idx];
		if (p.labDraft?.prototypeId) {
			void labApi.updateIndex(null, p.labDraft.prototypeId, { status: 'closed' }).catch((err) => {
				console.warn('Aggiornamento stato bozza chiusa fallito:', err);
			});
		}
		if (p.canonicalProjectPath) {
			this.syncProjectMetadata(p);
		}
		this.projects.splice(idx, 1);
		if (this.activeId === id) {
			this.activeId = this.projects.length > 0 ? this.projects[this.projects.length - 1].id : null;
		}
		this.save();
		window.dispatchEvent(new CustomEvent('studio-project-closed', { detail: { projectId: id } }));
	}

	setActive(id: string) {
		const idx = this.projects.findIndex(p => p.id === id);
		if (idx === -1) return;
		const p = this.projects[idx];
		p.lastOpened = Date.now();
		if (p.lane.agentState === 'finished') {
			p.lane.agentState = 'idle';
		}
		this.activeId = id;
		this.save();
	}
	/**
	 * Con ordinamento 'mru' ("Attività recente"), sposta il progetto in prima
	 * posizione a sinistra quando un agente inizia a lavorare o viene aggiunto.
	 */
	bringProjectToFront(id: string) {
		if (settingsStore.projectBar.order !== 'mru') return;
		const idx = this.projects.findIndex(p => p.id === id);
		if (idx > 0) {
			const [proj] = this.projects.splice(idx, 1);
			this.projects.unshift(proj);
			this.save();
		}
	}


	/** Riordino manuale (drag&drop): `id` prende il posto di `targetId`. */
	moveProject(id: string, targetId: string) {
		this.projects = reorderItemsList(this.projects, id, targetId);
		this.save();
	}

	/** Sposta la tessera di una posizione a sinistra (-1) o a destra (+1). */
	shiftProject(id: string, delta: number) {
		this.projects = shiftItemList(this.projects, id, delta);
		this.save();
	}

	setAutoDispatch(id: string, value: boolean) {
		const p = this.projects.find(p => p.id === id);
		if (!p) return;
		p.autoDispatch = value;
		this.save();
	}

	/** `patch` null azzera l'override; altrimenti si fonde col precedente e,
	 *  se il risultato e' vuoto, si torna a `null` (nessun override e' lo
	 *  stato canonico, non un oggetto vuoto perpetuo). */
	setTaskDefaults(id: string, patch: Partial<TaskDefaults> | null) {
		const p = this.projects.find(p => p.id === id);
		if (!p) return;
		if (patch === null) {
			p.taskDefaults = null;
		} else {
			const merged = { ...(p.taskDefaults ?? {}), ...patch };
			p.taskDefaults = Object.keys(merged).length > 0 ? merged : null;
		}
		this.save();
	}

	openFile(id: string, file: string) {
		const p = this.projects.find(p => p.id === id);
		if (!p || !file) return;
		// Nessun save(): i tab sono stato di sessione, non configurazione.
		if (!p.lane.openFiles.includes(file)) p.lane.openFiles.push(file);
		p.lane.activeFile = file;
	}

	closeFile(id: string, file: string) {
		const p = this.projects.find(p => p.id === id);
		if (!p) return;
		const index = p.lane.openFiles.indexOf(file);
		if (index === -1) return;
		p.lane.openFiles.splice(index, 1);
		if (p.lane.activeFile === file) {
			p.lane.activeFile = p.lane.openFiles[index] ?? p.lane.openFiles[index - 1] ?? null;
		}
	}

	/** Sposta la scheda `file` nella posizione di `beforeFile`, come il
	 *  trascinamento della barra dei progetti. Nessun save(): l'ordine dei tab
	 *  e' stato di sessione. */
	moveFile(id: string, file: string, beforeFile: string) {
		const p = this.projects.find(p => p.id === id);
		if (!p || file === beforeFile) return;
		const from = p.lane.openFiles.indexOf(file);
		const to = p.lane.openFiles.indexOf(beforeFile);
		if (from === -1 || to === -1) return;
		p.lane.openFiles.splice(from, 1);
		p.lane.openFiles.splice(to, 0, file);
	}

	private isPathUnder(filePath: string, targetPath: string, isDir: boolean): boolean {
		return isPathUnder(filePath, targetPath, isDir);
	}

	private remapPath(filePath: string, from: string, to: string, isDir: boolean): string | null {
		return remapPath(filePath, from, to, isDir);
	}

	/**
	 * Rinomina un file o tutti i tab discendenti da una directory rinominata.
	 * Preserva l'ordine dei tab e l'eventuale tab attivo rimappato.
	 */
	renamePath(id: string, from: string, to: string, isDir: boolean) {
		const p = this.projects.find(p => p.id === id);
		if (!p || !from || !to) return;
		const res = applyTabRename(p.lane.openFiles, p.lane.activeFile, from, to, isDir);
		p.lane.openFiles = res.openFiles;
		p.lane.activeFile = res.activeFile;
	}

	/**
	 * Rimuove i tab di un file o di tutti i file sotto una directory cestinata.
	 * Se il tab attivo viene rimosso, seleziona il tab adiacente piu' vicino
	 * (priorita' a destra, altrimenti a sinistra).
	 */
	trashPath(id: string, path: string, isDir: boolean) {
		const p = this.projects.find(p => p.id === id);
		if (!p || !path) return;
		const res = applyTabTrash(p.lane.openFiles, p.lane.activeFile, path, isDir);
		p.lane.openFiles = res.openFiles;
		p.lane.activeFile = res.activeFile;
	}

	closeOtherFiles(id: string, keepFile: string) {
		const p = this.projects.find(p => p.id === id);
		if (!p || !keepFile) return;
		if (!p.lane.openFiles.includes(keepFile)) return;
		p.lane.openFiles = [keepFile];
		p.lane.activeFile = keepFile;
	}

	closeAllFiles(id: string) {
		const p = this.projects.find(p => p.id === id);
		if (!p) return;
		p.lane.openFiles = [];
		p.lane.activeFile = null;
	}

	setPtyId(id: string, ptyId: number) {
		const p = this.projects.find(p => p.id === id);
		if (p) p.lane.ptyId = ptyId;
	}

	setProjectLane(id: string, target: AgentLane) {
		const p = this.projects.find((candidate) => candidate.id === id);
		if (!p) return;
		if (p.lane.laneId === target.laneId && p.lane.workspacePath === target.workspacePath) {
			return;
		}
		p.lane = {
			projectId: target.projectId,
			laneId: target.laneId,
			title: target.title,
			workspacePath: target.workspacePath,
			branch: target.branch,
			baseCommit: target.baseCommit,
			targetBranch: target.targetBranch,
			createdAt: target.createdAt,
			status: target.status,
			origin: target.origin,
			agentState: target.agentState,
			openFiles: [...target.openFiles],
			activeFile: target.activeFile,
			surface: target.surface,
			ptyId: target.ptyId,
			kind: target.kind,
			labPrototypeId: target.labPrototypeId
		};
	}

	updateProjectTitle(id: string, title: string) {
		const p = this.projects.find((candidate) => candidate.id === id);
		if (!p) return;
		p.name = title;
		p.lane.title = title;
		this.save();
	}

	setAgentState(id: string, state: AgentState) {
		const p = this.projects.find(p => p.id === id);
		if (!p) return;
		const previousState = p.lane.agentState;
		if (p.lane.agentState === 'working' && state === 'idle') {
			// Ha finito. Resta `finished` a meno che tu lo stia davvero
			// guardando: la companion deve poter distinguere "ho finito, leggi
			// cosa ho fatto" da "sono fermo, dammi un compito", e senza il
			// controllo sul fuoco della finestra un lavoro concluso mentre eri
			// in un'altra applicazione risultava identico a un progetto inerte
			// da ore.
			const watching =
				this.activeId === id && typeof document !== 'undefined' && document.hasFocus();
			p.lane.agentState = watching ? 'idle' : 'finished';
			return;
		}
		// `finished` non retrocede a `idle` da solo: lo chiude l'utente
		// aprendo il progetto (`setActive`) o riportando il fuoco sulla
		// finestra (`acknowledgeFinished`).
		if (state === 'idle' && p.lane.agentState === 'finished') return;
		p.lane.agentState = state;
		if (state === 'working' && previousState !== 'working') {
			this.bringProjectToFront(id);
		}
	}

	/**
	 * Chiude lo stato "ha finito" del progetto indicato.
	 *
	 * Chiamata quando la finestra principale riprende il fuoco con quel
	 * progetto aperto: l'utente sta guardando il risultato, il segnale ha
	 * esaurito il suo scopo.
	 */
	acknowledgeFinished(id: string) {
		const p = this.projects.find(p => p.id === id);
		if (p && p.lane.agentState === 'finished') p.lane.agentState = 'idle';
	}

	setProjectHue(id: string, hue: number) {
		const p = this.projects.find(p => p.id === id);
		if (p) {
			p.hue = hue;
			p.colorMode = 'custom';
			this.syncProjectMetadata(p);
			this.save();
		}
	}

	useAutomaticProjectColor(id: string) {
		const p = this.projects.find(p => p.id === id);
		if (p) {
			p.colorMode = 'auto';
			this.syncProjectMetadata(p);
			this.save();
		}
	}

	renameProject(id: string, name: string) {
		const p = this.projects.find(p => p.id === id);
		const normalized = name.trim();
		if (!p || !normalized) return;
		p.name = normalized;
		this.syncProjectMetadata(p);
		this.save();
	}

	setProjectLabel(id: string, label: string) {
		const p = this.projects.find(p => p.id === id);
		if (!p) return;
		p.label = label.trim() || null;
		this.syncProjectMetadata(p);
		this.save();
	}

	updateLayout(id: string, layoutFn: (l: ProjectLayout) => void) {
		const p = this.projects.find(p => p.id === id);
		if (p) {
			layoutFn(p.layout);
			this.save();
		}
	}

	setSurface(id: string, surface: AgentSurface) {
		const p = this.projects.find(p => p.id === id);
		if (!p || p.lane.surface === surface) return;
		p.lane.surface = surface;
		this.save();
	}

	get activeProject(): Project | undefined {
		return this.projects.find(p => p.id === this.activeId);
	}
}

export const projectStore = new ProjectStore();
