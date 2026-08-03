import { load } from '@tauri-apps/plugin-store';
import { homeDir, join } from '@tauri-apps/api/path';
import { debounce } from 'lodash-es';

// Il path canonico e' quello nativo Windows con i backslash: `history.db` di omp
// registra `cwd` in quella forma, quindi con gli slash la lista sessioni non
// combacia mai. Il dialog nativo restituisce gia' i backslash.
export function normalizeProjectPath(p: string): string {
	if (!p) return '';
	let out = p.replace(/\//g, '\\').replace(/\\+$/, '');
	// La radice di un disco resta `C:\`: senza separatore `C:` significa
	// "directory corrente del disco C", non la sua radice.
	if (/^[A-Za-z]:$/.test(out)) out += '\\';
	return out;
}

// Chiave di confronto: NTFS e' case-insensitive, `c:\repos\x` e `C:\Repos\X`
// sono lo stesso progetto e non devono generare due tab.
function pathKey(p: string): string {
	return normalizeProjectPath(p).toLowerCase();
}

export function joinProjectPath(projectPath: string, rel: string): string {
	return `${projectPath}\\${rel.replace(/\//g, '\\')}`;
}

export type AgentState = 'idle' | 'working' | 'attention' | 'finished' | 'unknown';
export type ProjectColorMode = 'auto' | 'custom';

export interface ProjectLayout {
	left: number;
	center: number;
	leftSection: 'files' | 'sessions';
	editorOpen: boolean;
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
		this.store = await load('settings.json', { autoSave: false });
		const storedProjects = await this.store.get('projects') as Project[] | null;
		const storedActiveId = await this.store.get('activeProjectId') as string | null;
		const storedRoot = await this.store.get('projectRoot') as string | null;
		this.projectRoot = normalizeProjectPath(
			storedRoot || await join(await homeDir(), 'source', 'repos')
		);

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
					activeFile: null
				});
			}
			this.projects.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
		}

		if (storedActiveId && this.projects.some(p => p.id === storedActiveId)) {
			this.activeId = storedActiveId;
			// Assicura che il progetto attivo all'avvio sia in prima posizione
			const idx = this.projects.findIndex(p => p.id === storedActiveId);
			if (idx > 0) {
				const [activeProj] = this.projects.splice(idx, 1);
				this.projects.unshift(activeProj);
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
			lastOpened: p.lastOpened
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
			const idx = this.projects.findIndex(p => p.id === existing.id);
			if (idx > 0) {
				const [proj] = this.projects.splice(idx, 1);
				this.projects.unshift(proj);
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
				editorOpen: true
			},
			lastOpened: Date.now()
		};
		this.projects.unshift(newProj);
		this.activeId = id;
		this.save();
		return id;
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
				editorOpen: false
			},
			lastOpened: Date.now()
		};
		this.projects.unshift(scratchpadProj);
		this.activeId = id;
		this.save();
		return id;
	}

	closeProject(id: string) {
		const idx = this.projects.findIndex(p => p.id === id);
		if (idx === -1) return;
		this.projects.splice(idx, 1);
		if (this.activeId === id) {
			this.activeId = this.projects.length > 0 ? this.projects[this.projects.length - 1].id : null;
		}
		this.save();
	}

	setActive(id: string) {
		const idx = this.projects.findIndex(p => p.id === id);
		if (idx === -1) return;
		const [p] = this.projects.splice(idx, 1);
		p.lastOpened = Date.now();
		if (p.agentState === 'finished') {
			p.agentState = 'idle';
		}
		this.projects.unshift(p);
		this.activeId = id;
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
