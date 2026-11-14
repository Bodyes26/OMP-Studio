import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { projectStore } from './projects.svelte.ts';
import { themeStore } from './theme.svelte.ts';
import { THEMES, anchorsFor } from '#lib/theme.ts';
import type { RolePicks, RoleProposalResponse } from '#lib/components/setup/setupRoles.ts';

/**
 * Stato del setup grafico di primo avvio (docs/requisiti/setup.md).
 *
 * Vive fuori dai componenti per due motivi: la pagina decide da sola se e dove
 * aprire la finestra (SET-020/021), e i passi devono poter leggere i dati che
 * hanno prodotto gli altri (Aspetto, Progetti e Riepilogo mostrano quello che
 * Provider e Ruoli hanno scelto). Il passo confermato si salva su disco
 * (`setup_progress_set`), così un riavvio brutale riprende da lì (SET-041).
 */

export type SetupStepId =
	| 'engine'
	| 'providers'
	| 'roles'
	| 'appearance'
	| 'updates'
	| 'projects'
	| 'github'
	| 'summary';

export const SETUP_STEPS: SetupStepId[] = [
	'engine',
	'providers',
	'roles',
	'appearance',
	'updates',
	'projects',
	'github',
	'summary'
];

export interface DatabaseStatus {
	name: string;
	exists: boolean;
	readable: boolean;
}

export interface SetupStatus {
	ompInstalled: boolean;
	ompPath: string | null;
	installDir: string | null;
	ompVersion: string | null;
	setupVersion: number;
	wizardPending: boolean;
	hasCredentials: boolean;
	credentialProviders: string[];
	defaultModel: string | null;
	themeDark: string | null;
	colorBlindMode: boolean;
	nerdFontInstalled: boolean;
	shellPath: string | null;
	bashMissing: boolean;
	minOmpVersion: string;
	ompOutdated: boolean;
	databases: DatabaseStatus[];
	missing: string[];
	/** Collegamento rotto o binario che non risponde: non è «non installato». */
	ompBroken: boolean;
	ompBrokenPath: string | null;
}

export interface SetupProgress {
	step: string;
	done: string[];
	completed: boolean;
	updatedAt: number;
}

export interface InstallProgress {
	status: 'resolving' | 'downloading' | 'verifying' | 'installing' | 'done' | 'error';
	downloadedBytes: number;
	totalBytes: number;
	percentage: number;
	message: string | null;
	error: string | null;
	diagnostic?: string | null;
	retryable?: boolean;
}

export interface RootCandidate {
	path: string;
	repoCount: number;
	exists: boolean;
}

export type EngineJob = 'install' | 'repair' | 'update';
export type EnginePhase = 'checking' | 'downloading' | 'ready' | 'broken' | 'outdated' | 'error';

export interface EngineState {
	phase: EnginePhase;
	job: EngineJob;
	downloadedBytes: number;
	totalBytes: number;
	percentage: number;
	error: string | null;
	diagnostic: string | null;
}

/** Come si è arrivati alla finestra: decide ingresso lungo e riga di traccia. */
export type SetupMode = 'first' | 'return';
export type SetupPhase = 'setup' | 'leaving' | 'done' | 'tui' | 'exited';

const EMPTY_ENGINE: EngineState = {
	phase: 'checking',
	job: 'install',
	downloadedBytes: 0,
	totalBytes: 0,
	percentage: 0,
	error: null,
	diagnostic: null
};

class SetupFlow {
	open = $state(false);
	mode = $state<SetupMode>('first');
	phase = $state<SetupPhase>('setup');
	step = $state<SetupStepId>('engine');
	/** Passi già confermati: quelli non ancora fatti restano non raggiungibili. */
	done = $state<SetupStepId[]>([]);
	status = $state<SetupStatus | null>(null);
	progress = $state<SetupProgress | null>(null);
	engine = $state<EngineState>({ ...EMPTY_ENGINE });

	/** Provider collegati in questa sessione, riportati dal passo Provider. */
	connectedProviders = $state<string[]>([]);
	/** Scelte dei ruoli: `provider/model[:thinking]` per ruolo, dal passo Ruoli. */
	rolePicks = $state<RolePicks>({});
	/** Ultima proposta del resolver, riletta prima di salvare i ruoli. */
	roleProposal = $state<RoleProposalResponse>({ roles: [] });

	updateMode = $state<'auto' | 'notify'>('auto');
	projectFolder = $state('');
	projectRoots = $state<RootCandidate[]>([]);
	githubSkipped = $state(false);

	private unlistenInstall: UnlistenFn | null = null;
	private job: EngineJob | null = null;

	/** Versione scelta nell'Aspetto: è la stessa che Studio applica subito. */
	get themeName(): string {
		return themeStore.current;
	}

	get stepIndex(): number {
		return SETUP_STEPS.indexOf(this.step);
	}

	get canLeaveBack(): boolean {
		return this.stepIndex > 0;
	}

	/** Requisiti che impediscono a omp di lavorare: questi aprono il setup da soli. */
	get blockingMissing(): string[] {
		const s = this.status;
		if (!s) return [];
		const missing: string[] = [];
		if (!s.ompInstalled || s.ompBroken) missing.push('omp');
		if (!s.hasCredentials) missing.push('credentials');
		if (!s.defaultModel) missing.push('model');
		return missing;
	}

	/** Problemi veri ma non bloccanti (SET-021): chip sì, apertura automatica no. */
	get warnings(): { code: 'outdated' | 'bash' | 'database'; label: string }[] {
		const s = this.status;
		if (!s) return [];
		const list: { code: 'outdated' | 'bash' | 'database'; label: string }[] = [];
		if (s.ompOutdated) list.push({ code: 'outdated', label: 'ompOutdated' });
		if (s.bashMissing) list.push({ code: 'bash', label: 'bashMissing' });
		if (s.databases.some((db) => db.exists && !db.readable)) {
			list.push({ code: 'database', label: 'databases' });
		}
		return list;
	}

	get brokenDatabases(): DatabaseStatus[] {
		return this.status?.databases.filter((db) => db.exists && !db.readable) ?? [];
	}

	/** Il passo dove il setup deve aprire quando manca qualcosa. */
	get firstMissingStep(): SetupStepId {
		const missing = this.blockingMissing;
		if (missing.includes('omp')) return 'engine';
		if (missing.includes('credentials')) return 'providers';
		return 'roles';
	}

	/** Il primo passo non ancora fatto, per il ritorno «a metà». */
	get firstOpenStep(): SetupStepId {
		return SETUP_STEPS.find((id) => !this.done.includes(id)) ?? 'summary';
	}

	async readStatus(): Promise<SetupStatus | null> {
		try {
			const next = await invoke<SetupStatus>('setup_status');
			this.status = next;
			this.applyStatusToEngine(next);
			return next;
		} catch (e) {
			console.error('setup_status', e);
			return null;
		}
	}

	/** Fase del passo Motore dedotta dallo stato reale, senza inventare passaggi. */
	private phaseFor(status: SetupStatus): EnginePhase {
		if (!status.ompInstalled) return 'checking';
		if (status.ompBroken) return 'broken';
		if (status.ompOutdated) return 'outdated';
		return 'ready';
	}

	/**
	 * Lo stato decide il passo Motore, ma non mentre un lavoro è in corso: il
	 * download appena avviato non deve tornare a «controllo».
	 */
	private applyStatusToEngine(status: SetupStatus) {
		if (this.job) return;
		this.engine = { ...EMPTY_ENGINE, phase: this.phaseFor(status) };
	}

	async readProgress(): Promise<SetupProgress | null> {
		try {
			this.progress = await invoke<SetupProgress | null>('setup_progress_get');
		} catch {
			// Il file di progresso è un aiuto, non un requisito: se manca si riparte
			// dal primo passo che lo stato dichiara mancante.
			this.progress = null;
		}
		return this.progress;
	}

	/**
	 * Apre la finestra. `mode` non si deduce qui: la pagina ha già letto stato e
	 * progresso (SET-020), e passare la decisione evita due letture dello stesso
	 * file con due esiti diversi.
	 */
	openAt(mode: SetupMode, step: SetupStepId, done: SetupStepId[] = []) {
		this.mode = mode;
		this.step = step;
		this.done = [...done];
		this.phase = 'setup';
		this.githubSkipped = false;
		this.open = true;
	}

	/** Esc e «Esci dal setup»: chiude senza cancellare niente (SET-041). */
	close() {
		this.stopEngineEvents();
		this.open = false;
		this.phase = 'setup';
		this.job = null;
	}

	async markStepDone(step: SetupStepId, next: SetupStepId, completed = false) {
		if (!this.done.includes(step)) this.done = [...this.done, step];
		this.step = next;
		await this.saveProgress(next, completed);
	}

	async saveProgress(step: SetupStepId, completed: boolean) {
		const progress: SetupProgress = {
			step,
			done: [...this.done],
			completed,
			updatedAt: Date.now()
		};
		this.progress = progress;
		try {
			await invoke('setup_progress_set', { progress });
		} catch (e) {
			// Senza file di progresso si perde solo il punto di ripresa.
			console.warn('setup_progress_set', e);
		}
	}

	/** Scritture in `config.yml` fatte con il lock del backend, mai a mano. */
	async applyConfig(patch: {
		themeDark?: string;
		themeLight?: string;
		colorBlindMode?: boolean;
		updateAuto?: boolean;
		markComplete?: boolean;
	}): Promise<boolean> {
		try {
			await invoke('setup_apply_config', { patch });
			return true;
		} catch (e) {
			console.error('setup_apply_config', e);
			return false;
		}
	}

	/**
	 * Scarica, ripara o aggiorna `omp` (SET-010). Il font Nerd segue in silenzio
	 * (SET-031): serve alla TUI e a omp fuori da Studio, non a questa finestra.
	 */
	async runEngineJob(kind: EngineJob) {
		if (this.job) return;
		this.job = kind;
		this.engine = {
			...EMPTY_ENGINE,
			phase: 'downloading',
			job: kind,
			error: null,
			diagnostic: null
		};
		await this.ensureEngineEvents();

		try {
			if (kind === 'update') {
				await invoke('run_omp_update');
			} else {
				await invoke('install_omp');
				// Silenzioso e non fatale: se il font non si installa, omp funziona
				// comunque e i glifi restano quelli del sistema.
				try {
					await invoke('install_nerd_font');
				} catch (e) {
					console.warn('Font Nerd non installato', e);
				}
			}
			// `readStatus` non tocca il motore finché `job` è valorizzato: lo stato
			// finale lo applica questo ramo, una volta sola.
			const status = await this.readStatus();
			this.job = null;
			this.engine = {
				...(status ? { ...EMPTY_ENGINE, phase: this.phaseFor(status) } : this.engine),
				job: kind,
				percentage: 100,
				error: null,
				diagnostic: null
			};
		} catch (e) {
			this.job = null;
			this.engine = {
				...this.engine,
				phase: 'error',
				error: String(e),
				diagnostic: null
			};
		}
	}

	private async ensureEngineEvents() {
		if (this.unlistenInstall) return;
		// `listen` risolve in modo asincrono: se la finestra si chiude prima, la
		// pulizia trova il campo vuoto e il listener resterebbe attaccato alla
		// prossima apertura.
		let disposed = false;
		const unlisten = await listen<InstallProgress>('setup://install-progress', (event) => {
			const payload = event.payload;
			if (payload.status === 'error') {
				this.engine = {
					...this.engine,
					phase: 'error',
					error: payload.error ?? 'Errore durante l’installazione.',
					diagnostic: payload.diagnostic ?? null
				};
				return;
			}
			this.engine = {
				...this.engine,
				phase: 'downloading',
				downloadedBytes: payload.downloadedBytes,
				totalBytes: payload.totalBytes,
				percentage: payload.percentage
			};
		});
		if (disposed) unlisten();
		else this.unlistenInstall = unlisten;
	}

	private stopEngineEvents() {
		this.unlistenInstall?.();
		this.unlistenInstall = null;
	}

	/** Cartelle in cui l'utente tiene i repository (SET-015). */
	async loadProjectRoots() {
		try {
			this.projectRoots = await invoke<RootCandidate[]>('detect_project_roots');
		} catch (e) {
			console.error('detect_project_roots', e);
			this.projectRoots = [];
		}
		const best = this.projectRoots[0]?.path ?? projectStore.projectRoot;
		if (best) this.projectFolder = best;
		return this.projectRoots;
	}

	/**
	 * Aspetto (SET-013): una sola scelta per Studio e per omp.
	 *
	 * Studio applica subito il tema (`themeStore.select`, che scrive anche il
	 * tema custom di omp). In più si allineano `theme.dark`/`theme.light` della
	 * configurazione dell'utente, così la TUI di fuori da Studio mostra lo
	 * stesso tema invece di un altro. `colorBlindMode` torna falso perché il
	 * tema scelto porta già la sua palette: lasciarlo acceso ricolorerebbe
	 * quanto appena scelto (docs/DECISIONS.md, «Il tema non si forza»).
	 */
	async chooseTheme(name: string) {
		if (!THEMES[name]) return;
		await themeStore.select(name);
		const isLight = anchorsFor(THEMES[name]).isLight;
		await this.applyConfig({
			themeDark: isLight ? undefined : name,
			themeLight: isLight ? name : undefined,
			colorBlindMode: false
		});
	}

	/** Aggiornamenti (SET-014): `update.auto` in `config.yml`. */
	/**
	 * Proposta dei ruoli dal resolver deterministico del backend (nessuna
	 * chiamata LLM). Il passo Ruoli la mostra; il guscio la rilegge al momento
	 * di salvare, così salva esattamente ciò che l'utente ha davanti.
	 */
	async proposeRoles(): Promise<RoleProposalResponse> {
		try {
			this.roleProposal = await invoke<RoleProposalResponse>('setup_propose_roles');
		} catch (e) {
			console.error('setup_propose_roles', e);
		}
		return this.roleProposal;
	}

	async setUpdateMode(mode: 'auto' | 'notify') {
		this.updateMode = mode;
		await this.applyConfig({ updateAuto: mode === 'auto' });
	}

	async setProjectFolder(path: string) {
		this.projectFolder = path;
		projectStore.setProjectRoot(path);
	}

	/** «Entra in Studio»: segna il setup completo prima di uscire (SET-017). */
	async complete() {
		this.done = [...SETUP_STEPS];
		await this.applyConfig({ markComplete: true });
		await this.saveProgress('summary', true);
		if (this.projectFolder) projectStore.setProjectRoot(this.projectFolder);
	}
}

export const setupFlow = new SetupFlow();
