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

export interface ProjectLayout {
	left: number;
	center: number;
	leftSection: 'files' | 'sessions';
	editorOpen: boolean;
}

export interface Project {
	id: string;
	name: string;
	path: string;
	hue: number;
	ptyId?: number;
	agentState: AgentState;
	/** File aperto nell'editor per questo progetto. Stato di sessione: non persistito. */
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
					hue: typeof p.hue === 'number' ? p.hue : getProjectHue(path),
					agentState: 'unknown',
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
			path: p.path,
			hue: p.hue,
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
			path: canonical,
			hue: getProjectHue(canonical),
			agentState: 'unknown',
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
			path: '', // empty path signifies scratchpad
			hue: 0,
			agentState: 'unknown',
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

	setActiveFile(id: string, file: string | null) {
		const p = this.projects.find(p => p.id === id);
		// Nessun save(): il file aperto e' stato di sessione, non configurazione.
		if (p) p.activeFile = file;
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
			this.save();
		}
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
