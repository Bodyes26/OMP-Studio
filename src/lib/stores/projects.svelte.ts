import { load } from '@tauri-apps/plugin-store';
import { homeDir, join } from '@tauri-apps/api/path';
import { debounce } from 'lodash-es';
import { settingsStore, type TaskDefaults } from './settings.svelte';

import { isWindows, normalizeProjectPath, joinProjectPath, pathKey } from '$lib/utils/paths';
export { normalizeProjectPath, joinProjectPath, pathKey, isWindows };

export type AgentState = 'idle' | 'working' | 'attention' | 'finished' | 'unknown';
export type ProjectColorMode = 'auto' | 'custom';

export interface ProjectLayout {
	left: number;
	center: number;
	leftSection: 'files' | 'sessions';
	editorOpen: boolean;
	/**
	 * Superficie della colonna destra. Un progetto esistente riparte in
	 * `terminal`: aggiornare Studio non deve spostare nessuno su una
	 * superficie che non ha scelto.
	 */
	rightSection: 'terminal' | 'gui';
}

export interface Project {
	id: string;
	name: string;
	label: string | null;
	path: string;
	hue: number;
	colorMode: ProjectColorMode;
	ptyId?: number;
	agentState: AgentState;
	/** File aperti nell'editor per questo progetto. Stato di sessione: non persistito. */
	openFiles: string[];
	activeFile: string | null;
	layout: ProjectLayout;
	lastOpened: number;
	/** Il primo task in coda parte da solo appena il terminale e' libero. */
	autoDispatch: boolean;
	/** Default dei task di questo progetto: sovrascrivono taskDefaults globali. */
	taskDefaults: Partial<TaskDefaults> | null;
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
	private store: any = null;
	private initialized = false;

	constructor() {
		this.initStore();
	}

	async initStore() {
		// L'ordinamento (`mru` o no) decide se qui sotto si riordina o no:
		// va letto da disco prima, altrimenti si legge sempre il default.
		await settingsStore.init();
		this.store = await load('settings.json', { autoSave: false });
		const storedProjects = await this.store.get('projects') as Project[] | null;
		const storedActiveId = await this.store.get('activeProjectId') as string | null;
		const storedRoot = await this.store.get('projectRoot') as string | null;
		let defaultRoot = await homeDir();
		if (isWindows) {
			defaultRoot = await join(defaultRoot, 'source', 'repos');
		} else {
			defaultRoot = await join(defaultRoot, 'dev');
		}
		this.projectRoot = normalizeProjectPath(storedRoot || defaultRoot);

		if (storedProjects) {
			const seen = new Set<string>();
			this.projects = [];
			for (const p of storedProjects) {
				const path = normalizeProjectPath(p.path);
				// I doppioni nati prima della normalizzazione (stessa cartella con
				// separatori o maiuscole diverse) vanno collassati sul primo.
				if (!path || seen.has(pathKey(path))) continue;
				seen.add(pathKey(path));
				this.projects.push({
					...p,
					path,
					label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : null,
					hue: typeof p.hue === 'number' ? p.hue : getProjectHue(path),
					// Le versioni precedenti non salvavano l'origine. Se la tinta
					// coincide con quella deterministica, puo' seguire il tema.
					colorMode: p.colorMode === 'custom' || (typeof p.hue === 'number' && p.hue !== getProjectHue(path)) ? 'custom' : 'auto',
					agentState: 'unknown',
					openFiles: [],
					activeFile: null,
					layout: {
						left: typeof p.layout?.left === 'number' ? p.layout.left : 260,
						center: typeof p.layout?.center === 'number' ? p.layout.center : 0.5,
						leftSection: p.layout?.leftSection === 'sessions' ? 'sessions' : 'files',
						editorOpen: p.layout?.editorOpen !== false,
						rightSection: p.layout?.rightSection === 'gui' ? 'gui' : 'terminal'
					},
					autoDispatch: p.autoDispatch === true,
					taskDefaults: p.taskDefaults && typeof p.taskDefaults === 'object' ? p.taskDefaults : null
				});
			}
			// L'ordine salvato e' l'unica verita' fuori da `mru`: solo li'
			// il piu' recente deve tornare in cima da solo.
			if (settingsStore.projectBar.order === 'mru') {
				this.projects.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
			}
		}

		if (storedActiveId && this.projects.some(p => p.id === storedActiveId)) {
			this.activeId = storedActiveId;
			if (settingsStore.projectBar.order === 'mru') {
				// Assicura che il progetto attivo all'avvio sia in prima posizione
				const idx = this.projects.findIndex(p => p.id === storedActiveId);
				if (idx > 0) {
					const [activeProj] = this.projects.splice(idx, 1);
					this.projects.unshift(activeProj);
				}
			}
		} else if (this.projects.length > 0) {
			this.activeId = this.projects[0].id;
		}

		this.initialized = true;
	}

	private save = debounce(async () => {
		if (!this.initialized || !this.store) return;
		const toSave = this.projects.filter(p => p.path !== '').map(p => ({
			id: p.id,
			name: p.name,
			label: p.label,
			path: p.path,
			hue: p.hue,
			colorMode: p.colorMode,
			layout: $state.snapshot(p.layout),
			lastOpened: p.lastOpened,
			autoDispatch: p.autoDispatch,
			taskDefaults: p.taskDefaults ? $state.snapshot(p.taskDefaults) : null
		}));
		await this.store.set('projects', toSave);
		await this.store.set('activeProjectId', this.activeId);
		await this.store.set('projectRoot', this.projectRoot);
		await this.store.save();
	}, 500);

	openProject(path: string) {
		const canonical = normalizeProjectPath(path);
		if (!canonical) return null;
		const key = pathKey(canonical);
		const existing = this.projects.find(p => p.path && pathKey(p.path) === key);
		if (existing) {
			existing.lastOpened = Date.now();
			this.activeId = existing.id;
			if (settingsStore.projectBar.order === 'mru') {
				const idx = this.projects.findIndex(p => p.id === existing.id);
				if (idx > 0) {
					const [proj] = this.projects.splice(idx, 1);
					this.projects.unshift(proj);
				}
			}
			this.save();
			return existing.id;
		}

		const name = canonical.split(/[\\/]/).pop() || 'Unknown';
		const id = crypto.randomUUID();

		const newProj: Project = {
			id,
			name,
			label: null,
			path: canonical,
			hue: getProjectHue(canonical),
			colorMode: 'auto',
			agentState: 'unknown',
			openFiles: [],
			activeFile: null,
			layout: {
				left: 260,
				center: 0.5,
				leftSection: 'files',
				editorOpen: true,
				rightSection: settingsStore.general.defaultSurface
			},
			lastOpened: Date.now(),
			autoDispatch: false,
			taskDefaults: null
		};
		// Nuovo progetto: in coda con l'ordine manuale, in testa solo se
		// l'utente ha scelto `mru` (il piu' recente resta il piu' visibile).
		if (settingsStore.projectBar.order === 'mru') {
			this.projects.unshift(newProj);
		} else {
			this.projects.push(newProj);
		}
		this.activeId = id;
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

	openScratchpad() {
		const id = crypto.randomUUID();
		const scratchpadProj: Project = {
			id,
			name: 'Scratchpad',
			label: null,
			path: '', // empty path signifies scratchpad
			hue: 0,
			colorMode: 'auto',
			agentState: 'unknown',
			openFiles: [],
			activeFile: null,
			layout: {
				left: 260,
				center: 0.5,
				leftSection: 'files',
				editorOpen: false,
				rightSection: settingsStore.general.defaultSurface
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

	/**
	 * Chiudere una scheda deve chiudere anche il processo omp che le sta
	 * dietro: lo store non conosce le sessioni, quindi lo annuncia e chi le
	 * possiede (`routes/+page.svelte`) le dispone.
	 */
	closeProject(id: string) {
		const idx = this.projects.findIndex(p => p.id === id);
		if (idx === -1) return;
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
		if (p.agentState === 'finished') {
			p.agentState = 'idle';
		}
		// L'ordine dell'array e' l'unica verita' fuori da `mru`: qui si tocca
		// solo lo stato del progetto, mai la sua posizione.
		if (settingsStore.projectBar.order === 'mru' && idx > 0) {
			this.projects.splice(idx, 1);
			this.projects.unshift(p);
		}
		this.activeId = id;
		this.save();
	}

	/** Riordino manuale (drag&drop): `id` prende il posto di `targetId`. */
	moveProject(id: string, targetId: string) {
		if (id === targetId) return;
		const from = this.projects.findIndex(p => p.id === id);
		const targetIdx = this.projects.findIndex(p => p.id === targetId);
		if (from === -1 || targetIdx === -1) return;
		const [moved] = this.projects.splice(from, 1);
		const to = this.projects.findIndex(p => p.id === targetId);
		this.projects.splice(to, 0, moved);
		this.save();
	}

	/** Sposta la tessera di una posizione a sinistra (-1) o a destra (+1). */
	shiftProject(id: string, delta: number) {
		const from = this.projects.findIndex(p => p.id === id);
		if (from === -1) return;
		const to = Math.max(0, Math.min(this.projects.length - 1, from + delta));
		if (to === from) return;
		const [moved] = this.projects.splice(from, 1);
		this.projects.splice(to, 0, moved);
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
		if (!p.openFiles.includes(file)) p.openFiles.push(file);
		p.activeFile = file;
	}

	closeFile(id: string, file: string) {
		const p = this.projects.find(p => p.id === id);
		if (!p) return;
		const index = p.openFiles.indexOf(file);
		if (index === -1) return;
		p.openFiles.splice(index, 1);
		if (p.activeFile === file) {
			p.activeFile = p.openFiles[index] ?? p.openFiles[index - 1] ?? null;
		}
	}

	private isPathUnder(filePath: string, targetPath: string, isDir: boolean): boolean {
		const normFile = filePath.replace(/\\/g, '/');
		const normTarget = targetPath.replace(/\\/g, '/').replace(/\/+$/, '');
		if (isDir) {
			if (normFile === normTarget || normFile.startsWith(normTarget + '/')) return true;
			if (isWindows) {
				const lowFile = normFile.toLowerCase();
				const lowTarget = normTarget.toLowerCase();
				return lowFile === lowTarget || lowFile.startsWith(lowTarget + '/');
			}
			return false;
		}
		if (normFile === normTarget) return true;
		if (isWindows) {
			return normFile.toLowerCase() === normTarget.toLowerCase();
		}
		return false;
	}

	private remapPath(filePath: string, from: string, to: string, isDir: boolean): string | null {
		const normFile = filePath.replace(/\\/g, '/');
		const normFrom = from.replace(/\\/g, '/').replace(/\/+$/, '');
		const normTo = to.replace(/\\/g, '/').replace(/\/+$/, '');

		if (isDir) {
			if (normFile === normFrom || (isWindows && normFile.toLowerCase() === normFrom.toLowerCase())) {
				return to;
			}
			if (normFile.startsWith(normFrom + '/')) {
				const suffix = normFile.slice(normFrom.length);
				const joined = normTo + suffix;
				return (to.includes('\\') || filePath.includes('\\')) ? joined.replace(/\//g, '\\') : joined;
			}
			if (isWindows && normFile.toLowerCase().startsWith(normFrom.toLowerCase() + '/')) {
				const suffix = normFile.slice(normFrom.length);
				const joined = normTo + suffix;
				return (to.includes('\\') || filePath.includes('\\')) ? joined.replace(/\//g, '\\') : joined;
			}
		} else {
			if (normFile === normFrom || (isWindows && normFile.toLowerCase() === normFrom.toLowerCase())) {
				return to;
			}
		}
		return null;
	}

	/**
	 * Rinomina un file o tutti i tab discendenti da una directory rinominata.
	 * Preserva l'ordine dei tab e l'eventuale tab attivo rimappato.
	 */
	renamePath(id: string, from: string, to: string, isDir: boolean) {
		const p = this.projects.find(p => p.id === id);
		if (!p || !from || !to) return;
		let activeChanged = false;
		let newActive = p.activeFile;
		p.openFiles = p.openFiles.map(file => {
			const remapped = this.remapPath(file, from, to, isDir);
			if (remapped) {
				if (p.activeFile === file) {
					newActive = remapped;
					activeChanged = true;
				}
				return remapped;
			}
			return file;
		});
		if (activeChanged) {
			p.activeFile = newActive;
		}
	}

	/**
	 * Rimuove i tab di un file o di tutti i file sotto una directory cestinata.
	 * Se il tab attivo viene rimosso, seleziona il tab adiacente piu' vicino
	 * (priorita' a destra, altrimenti a sinistra).
	 */
	trashPath(id: string, path: string, isDir: boolean) {
		const p = this.projects.find(p => p.id === id);
		if (!p || !path) return;
		const isUnderTrash = (file: string) => this.isPathUnder(file, path, isDir);

		const activeIsRemoved = p.activeFile !== null && isUnderTrash(p.activeFile);
		const activeIndex = p.activeFile !== null ? p.openFiles.indexOf(p.activeFile) : -1;

		const remaining: string[] = [];
		let nextActiveCandidate: string | null = null;
		let prevActiveCandidate: string | null = null;

		for (let i = 0; i < p.openFiles.length; i++) {
			const file = p.openFiles[i];
			if (!isUnderTrash(file)) {
				remaining.push(file);
				if (i > activeIndex && nextActiveCandidate === null) {
					nextActiveCandidate = file;
				}
				if (i < activeIndex) {
					prevActiveCandidate = file;
				}
			}
		}

		p.openFiles = remaining;
		if (activeIsRemoved) {
			p.activeFile = nextActiveCandidate ?? prevActiveCandidate ?? null;
		}
	}

	closeOtherFiles(id: string, keepFile: string) {
		const p = this.projects.find(p => p.id === id);
		if (!p || !keepFile) return;
		if (!p.openFiles.includes(keepFile)) return;
		p.openFiles = [keepFile];
		p.activeFile = keepFile;
	}

	closeAllFiles(id: string) {
		const p = this.projects.find(p => p.id === id);
		if (!p) return;
		p.openFiles = [];
		p.activeFile = null;
	}

	setPtyId(id: string, ptyId: number) {
		const p = this.projects.find(p => p.id === id);
		if (p) p.ptyId = ptyId;
	}

	setAgentState(id: string, state: AgentState) {
		const p = this.projects.find(p => p.id === id);
		if (!p) return;
		if (p.agentState === 'working' && state === 'idle' && this.activeId !== id) {
			p.agentState = 'finished';
		} else if (state === 'idle' && this.activeId === id) {
			p.agentState = 'idle';
		} else if (state !== 'idle' || p.agentState !== 'finished') {
			p.agentState = state;
		}
	}

	setProjectHue(id: string, hue: number) {
		const p = this.projects.find(p => p.id === id);
		if (p) {
			p.hue = hue;
			p.colorMode = 'custom';
			this.save();
		}
	}

	useAutomaticProjectColor(id: string) {
		const p = this.projects.find(p => p.id === id);
		if (p) {
			p.colorMode = 'auto';
			this.save();
		}
	}

	renameProject(id: string, name: string) {
		const p = this.projects.find(p => p.id === id);
		const normalized = name.trim();
		if (!p || !normalized) return;
		p.name = normalized;
		this.save();
	}

	setProjectLabel(id: string, label: string) {
		const p = this.projects.find(p => p.id === id);
		if (!p) return;
		p.label = label.trim() || null;
		this.save();
	}

	updateLayout(id: string, layoutFn: (l: ProjectLayout) => void) {
		const p = this.projects.find(p => p.id === id);
		if (p) {
			layoutFn(p.layout);
			this.save();
		}
	}

	get activeProject(): Project | undefined {
		return this.projects.find(p => p.id === this.activeId);
	}
}

export const projectStore = new ProjectStore();
