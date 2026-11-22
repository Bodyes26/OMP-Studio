/**
 * Stato del pannello Nuovo lavoro / Lavoro in coda (Gate R48, R-REM-09…12).
 *
 * Un solo foglio per creare un lavoro e per modificarne uno in coda: stesse
 * regole, stessi controlli, cambia solo cio' che si salva. Ruolo, modello e
 * ragionamento restano `null` finche' l'utente non li sceglie: `null` vuol dire
 * «quelli del ruolo», come nel task di Studio, cosi' salvare un lavoro senza
 * toccarli non lo lega al modello di oggi.
 */

import type {
	CommandError,
	Feature,
	RemoteCommand,
	RemoteComposerCatalog,
	RemoteDispatchAnswer,
	RemoteDispatchConfirmation,
	RemoteDispatchOutcome,
	RemoteProject,
	RemotePromptImage,
	RemoteScheduleChoice,
	RemoteTask,
	RemoteTaskDetail,
	RemoteTaskImage,
	RemoteTaskOptions
} from '../../src/protocol.ts';
import { connection } from './connection.svelte.ts';
import { navigation } from './navigation.svelte.ts';
import { formatCommandError } from './errors.ts';
import { calculateScheduleEpoch, defaultScheduleTime, formatHHMM } from './schedule.ts';
import { findRole, splitSelector } from './work.ts';
import { stageFileToHost } from './chat/remoteAttachments.svelte.ts';
import { isImageFile, prepareImage } from '#lib/agent/images.ts';
import { base64ToBlob } from '#lib/agent/chatDrop.ts';
import type { MachineOption, ProjectCopy, ProjectGroup } from './multiMachine.ts';
import {
	copyForMachine,
	createTaskCopy,
	editTaskCopy,
	groupForProject,
	machineOptions,
	proposedMachine,
	runTaskCopy
} from './multiMachine.ts';
import { t } from './i18n.ts';

export type WorkView =
	| 'main'
	| 'project'
	| 'machine'
	| 'directives'
	| 'when'
	| 'menu'
	| 'schedule'
	| 'delete'
	| 'confirm';
export type WhenChoice = 'manual' | 'reset' | 'at';

export interface WorkImage {
	id: string;
	name: string;
	url: string;
	mimeType: string;
	status: 'staging' | 'ready' | 'error';
	stagedPath?: string;
	error?: string;
}

interface Baseline {
	prompt: string;
	role: string | null;
	modelSelector: string | null;
	thinking: string | null;
	directiveIds: string[];
	/** Macchina del lavoro: cambiarla e' una modifica da salvare (R-REM-19). */
	machineId: string | null;
}

/** L'istantanea porta solo l'inizio del testo: oltre, senza `get_task`, non si puo' salvarlo. */
const PROMPT_PREVIEW_LIMIT = 4000;
/** Tetto della singola immagine dopo la compressione, come nel composer della chat. */
const MAX_IMAGE_BASE64 = 320_000;

function errorText(err: unknown): string {
	if (err && typeof err === 'object' && 'code' in err) return formatCommandError(err as CommandError);
	if (err instanceof Error && err.message) return err.message;
	return t('errUnknown');
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

class WorkSheetStore {
	isOpen = $state(false);
	mode = $state<'new' | 'edit'>('new');
	hostId = $state('');
	projectId = $state('');
	taskId = $state<string | null>(null);
	view = $state<WorkView>('main');

	prompt = $state('');
	role = $state<string | null>(null);
	modelSelector = $state<string | null>(null);
	thinking = $state<string | null>(null);
	directiveIds = $state<string[]>([]);
	newWorktree = $state(false);
	/** Macchina scelta per il lavoro (R-REM-20): id del collegamento o hostId per gli host vecchi. */
	machineId = $state<string | null>(null);

	existingImages = $state<RemoteTaskImage[]>([]);
	keptImages = $state<number[]>([]);
	newImages = $state<WorkImage[]>([]);

	when = $state<WhenChoice>('manual');
	atTime = $state(defaultScheduleTime());

	catalog = $state<RemoteComposerCatalog | null>(null);
	loading = $state(false);
	busy = $state(false);
	error = $state<string | null>(null);
	/** Testo arrivato troncato da una macchina senza `task_options`: si vede ma non si salva. */
	promptLocked = $state(false);

	confirmationId = $state<string | null>(null);
	/** Macchina e progetto che hanno pubblicato la conferma: la risposta torna li'. */
	confirmationHostId = $state<string | null>(null);
	confirmationProjectId = $state<string | null>(null);
	selectedFiles = $state<string[]>([]);

	toast = $state<string | null>(null);

	private toastTimer: ReturnType<typeof setTimeout> | undefined;
	private baseline: Baseline | null = null;
	// Ogni apertura invalida le risposte ancora in viaggio di quella precedente.
	private openSeq = 0;
	private confirmationSeen = false;

	// --- Lettura dello stato -------------------------------------------------

	get features(): Feature[] {
		return connection.hosts.find((host) => host.id === this.hostId)?.features ?? [];
	}

	has(feature: Feature): boolean {
		return this.features.includes(feature);
	}

	get hostName(): string {
		return connection.hosts.find((host) => host.id === this.hostId)?.name ?? '';
	}

	/** Macchina che il foglio mostra: quella scelta, altrimenti quella della copia. */
	get displayMachineName(): string {
		return this.selectedMachine?.name ?? this.hostName;
	}

	get projects(): RemoteProject[] {
		return connection.hostStates[this.hostId]?.state.projects ?? [];
	}

	get project(): RemoteProject | undefined {
		return this.projects.find((project) => project.id === this.projectId);
	}

	get task(): RemoteTask | undefined {
		return this.project?.tasks.find((task) => task.id === this.taskId);
	}

	get queuedTasks(): RemoteTask[] {
		return (this.project?.tasks ?? []).filter((task) => task.status === 'queued');
	}

	/** Il gruppo di copie di questo progetto su tutte le macchine (R-REM-17). */
	get group(): ProjectGroup | null {
		if (!this.hostId || !this.projectId) return null;
		return groupForProject(connection.hosts, connection.hostStates, this.hostId, this.projectId);
	}

	/** Macchine proponibili per il lavoro, una per macchina (R-REM-20). */
	get machines(): MachineOption[] {
		const group = this.group;
		return group ? machineOptions(group) : [];
	}

	/** La scelta ha senso solo se il progetto vive su piu' macchine. */
	get canChooseMachine(): boolean {
		return this.machines.length > 1;
	}

	get selectedMachine(): MachineOption | null {
		const id = this.machineId;
		if (!id) return null;
		return this.machines.find((machine) => machine.id === id) ?? null;
	}

	/** Ruolo, modello, direttive e immagini: solo con le macchine che li gestiscono. */
	get withOptions(): boolean {
		return this.has('task_options');
	}

	get canQueue(): boolean {
		return this.has('task_edit');
	}

	get canStart(): boolean {
		return this.has('run_task');
	}

	get roleDef() {
		return findRole(this.catalog?.roles, this.role);
	}

	/** Valori da mostrare: la scelta esplicita o, in mancanza, quella del ruolo. */
	get display(): { role: string; provider: string | null; modelId: string | null; modelLabel: string | null; thinking: string | null } {
		const roleDef = this.roleDef;
		const selector = this.modelSelector ?? roleDef?.model ?? null;
		const { provider, modelId } = splitSelector(selector);
		const option = this.catalog?.models.find((model) => model.provider === provider && model.id === modelId);
		const modelLabel = option?.name ?? (this.modelSelector ? modelId : (roleDef?.modelLabel ?? modelId));
		return {
			role: this.role ?? 'default',
			provider,
			modelId,
			modelLabel,
			thinking: this.thinking ?? roleDef?.thinking ?? null
		};
	}

	get imagesStaging(): boolean {
		return this.newImages.some((image) => image.status === 'staging');
	}

	get confirmation(): RemoteDispatchConfirmation | null {
		if (!this.confirmationId || !this.confirmationHostId) return null;
		const hostState = connection.hostStates[this.confirmationHostId]?.state;
		const project =
			hostState?.projects.find((candidate) => candidate.id === this.confirmationProjectId) ?? this.project;
		return project?.dispatchConfirmations?.find((entry) => entry.id === this.confirmationId) ?? null;
	}

	get dirty(): boolean {
		const base = this.baseline;
		if (this.mode !== 'edit' || !base) return false;
		if (this.prompt.trim() !== base.prompt.trim()) return true;
		if (this.optionsChanged(base)) return true;
		return this.imagesChanged();
	}

	// --- Apertura e chiusura -------------------------------------------------

	openNew({ hostId, projectId }: { hostId: string; projectId?: string }): void {
		this.reset();
		this.mode = 'new';
		this.hostId = hostId;
		const projects = this.projects;
		this.projectId = projectId && projects.some((p) => p.id === projectId) ? projectId : (projects[0]?.id ?? '');
		// La macchina proposta e' l'ultima usata (R-REM-20): su un progetto
		// presente su una macchina sola non c'e' nulla da scegliere.
		const group = this.group;
		const proposed = group ? proposedMachine(group) : null;
		if (proposed && this.canChooseMachine) this.applyMachine(proposed.id);
		this.isOpen = true;
		void this.loadCatalog();
	}

	async openTask({ hostId, projectId, taskId }: { hostId: string; projectId: string; taskId: string }): Promise<void> {
		this.reset();
		this.mode = 'edit';
		this.hostId = hostId;
		this.projectId = projectId;
		this.taskId = taskId;
		this.machineId = this.task?.machineId ?? null;
		this.isOpen = true;
		const seq = this.openSeq;
		void this.loadCatalog();

		const snapshot = this.task;
		if (!this.withOptions) {
			this.prompt = snapshot?.prompt ?? '';
			this.promptLocked = this.prompt.length >= PROMPT_PREVIEW_LIMIT;
			this.captureBaseline();
			return;
		}

		this.loading = true;
		try {
			const detail = (await connection.sendCommand(hostId, { kind: 'get_task', projectId, taskId })) as RemoteTaskDetail;
			if (seq !== this.openSeq) return;
			this.prompt = detail.prompt;
			this.role = detail.role;
			this.modelSelector = detail.modelSelector;
			this.thinking = detail.thinkingLevel;
			this.directiveIds = detail.directives.map((directive) => directive.id);
			this.existingImages = detail.images;
			this.keptImages = detail.images.map((_, index) => index);
			this.captureBaseline();
		} catch (err) {
			if (seq !== this.openSeq) return;
			// Senza il testo completo il salvataggio lo troncherebbe: si resta in lettura.
			this.prompt = snapshot?.prompt ?? '';
			this.promptLocked = true;
			this.error = errorText(err);
		} finally {
			if (seq === this.openSeq) this.loading = false;
		}
	}

	close(): void {
		this.isOpen = false;
		this.view = 'main';
		this.confirmationId = null;
		this.openSeq++;
	}

	/** Esc e tocco sullo sfondo: chiudono prima il sotto-foglio, poi il pannello. */
	back(): void {
		if (this.busy) return;
		if (this.view === 'confirm') return;
		if (this.view === 'schedule' || this.view === 'delete') {
			this.view = 'menu';
			return;
		}
		if (this.view !== 'main') {
			this.view = 'main';
			return;
		}
		this.close();
	}

	private reset(): void {
		this.openSeq++;
		this.view = 'main';
		this.taskId = null;
		this.prompt = '';
		this.role = null;
		this.modelSelector = null;
		this.thinking = null;
		this.directiveIds = [];
		this.newWorktree = false;
		this.machineId = null;
		this.existingImages = [];
		this.keptImages = [];
		this.newImages = [];
		this.when = 'manual';
		this.atTime = defaultScheduleTime();
		this.catalog = null;
		this.loading = false;
		this.busy = false;
		this.error = null;
		this.promptLocked = false;
		this.confirmationId = null;
		this.confirmationHostId = null;
		this.confirmationProjectId = null;
		this.confirmationSeen = false;
		this.selectedFiles = [];
		this.baseline = null;
	}

	private captureBaseline(): void {
		this.baseline = {
			prompt: this.prompt,
			role: this.role,
			modelSelector: this.modelSelector,
			thinking: this.thinking,
			directiveIds: [...this.directiveIds],
			machineId: this.machineId
		};
	}

	private async loadCatalog(): Promise<void> {
		if (!this.has('lane_config') || !this.projectId) return;
		const seq = this.openSeq;
		const projectId = this.projectId;
		try {
			const catalog = (await connection.sendCommand(this.hostId, {
				kind: 'composer_catalog',
				projectId,
				laneId: null
			})) as RemoteComposerCatalog;
			if (seq === this.openSeq && projectId === this.projectId) this.catalog = catalog;
		} catch (err) {
			// Senza catalogo restano scrittura, coda e avvio: ruolo e modello seguono il progetto.
			console.warn('[WorkSheet] Catalogo non disponibile:', err);
		}
	}

	// --- Modifiche del modulo ------------------------------------------------

	setProject(projectId: string): void {
		if (this.mode !== 'new') return;
		this.projectId = projectId;
		this.catalog = null;
		// Le direttive appartengono al catalogo del progetto precedente.
		this.directiveIds = [];
		this.view = 'main';
		void this.loadCatalog();
	}

	/**
	 * Cambia la macchina del lavoro (R-REM-19, R-REM-20). Le opzioni del
	 * catalogo (ruolo, modello, direttive) valgono per progetto, non per
	 * macchina: si ricaricano solo se la copia scelta non le conosce.
	 */
	applyMachine(machineId: string): void {
		this.machineId = machineId;
		const copy = this.copyFor(machineId);
		// Una macchina spenta resta la destinazione del lavoro, ma il foglio
		// continua a lavorare sulla copia raggiungibile (R-REM-22).
		if (copy?.online && (copy.hostId !== this.hostId || copy.project.id !== this.projectId)) {
			this.hostId = copy.hostId;
			this.projectId = copy.project.id;
			this.catalog = null;
			void this.loadCatalog();
		}
	}

	/** La copia di una macchina scelta, dentro il gruppo del progetto. */
	private copyFor(machineId: string): ProjectCopy | undefined {
		const group = this.group;
		return group ? copyForMachine(group, machineId) : undefined;
	}

	/** Dove creare il lavoro (R-REM-20): la copia della macchina scelta. */
	private createTarget(): ProjectCopy {
		const group = this.group;
		if (!group) throw { code: 'not_found', message: t('errUnknown') } as CommandError;
		return createTaskCopy(group, this.machineId);
	}

	/** Dove aggiornare o eliminare il lavoro: la macchina del lavoro se raggiungibile. */
	private editTarget(): ProjectCopy {
		const group = this.group;
		const task = this.task;
		if (!group) throw { code: 'not_found', message: t('errUnknown') } as CommandError;
		const fallback = group.copies.find((copy) => copy.hostId === this.hostId);
		return task ? editTaskCopy(group, task, fallback) : createTaskCopy(group, this.machineId);
	}

	/** Un ruolo nuovo porta con se' modello e ragionamento, come in Studio. */
	setRole(roleId: string): void {
		this.role = roleId;
		this.modelSelector = null;
		this.thinking = null;
	}

	setModel(provider: string, modelId: string): void {
		this.modelSelector = `${provider}/${modelId}`;
	}

	setThinking(level: string): void {
		this.thinking = level;
	}

	toggleDirective(id: string): void {
		this.directiveIds = this.directiveIds.includes(id)
			? this.directiveIds.filter((value) => value !== id)
			: [...this.directiveIds, id];
	}

	removeExistingImage(index: number): void {
		this.keptImages = this.keptImages.filter((value) => value !== index);
	}

	removeNewImage(id: string): void {
		this.newImages = this.newImages.filter((image) => image.id !== id);
	}

	async addFiles(files: FileList | File[]): Promise<void> {
		const hostId = this.hostId;
		const projectId = this.projectId;
		if (!hostId || !projectId) return;
		for (const file of Array.from(files)) {
			if (!isImageFile(file)) {
				this.showToast(t('workImagesOnly'));
				continue;
			}
			const prepared = await prepareImage(file, MAX_IMAGE_BASE64);
			if ('error' in prepared) {
				this.showToast(prepared.error);
				continue;
			}
			const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			this.newImages = [
				...this.newImages,
				{
					id,
					name: file.name,
					url: `data:${prepared.mimeType};base64,${prepared.data}`,
					mimeType: prepared.mimeType,
					status: 'staging'
				}
			];
			// L'immagine passa dal disco della macchina: dentro `create_task`
			// viaggia solo il percorso, cosi' il comando resta sotto il tetto del frame.
			const extension = prepared.mimeType === 'image/png' ? 'png' : 'jpg';
			const staged = new File(
				[base64ToBlob(prepared.data, prepared.mimeType)],
				`${file.name.replace(/\.[^.]+$/, '')}.${extension}`,
				{ type: prepared.mimeType }
			);
			try {
				const result = await stageFileToHost(staged, hostId, projectId, null, connection);
				this.updateImage(id, { status: 'ready', stagedPath: result.path });
			} catch (err) {
				this.updateImage(id, { status: 'error', error: errorText(err) });
			}
		}
	}

	private updateImage(id: string, patch: Partial<WorkImage>): void {
		this.newImages = this.newImages.map((image) => (image.id === id ? { ...image, ...patch } : image));
	}

	showToast(message: string): void {
		clearTimeout(this.toastTimer);
		this.toast = message;
		this.toastTimer = setTimeout(() => {
			this.toast = null;
		}, 3200);
	}

	// --- Costruzione dei comandi ---------------------------------------------

	private optionsPayload(): RemoteTaskOptions {
		return {
			role: this.role,
			modelSelector: this.modelSelector,
			thinkingLevel: this.thinking,
			directiveIds: [...this.directiveIds],
			// La macchina viaggia nel lavoro (R-REM-19): la replica della coda
			// la porta alle altre copie, e «Avvia» sa dove andare.
			machineId: this.machineId
		};
	}

	private stagedImages(): RemotePromptImage[] {
		return this.newImages
			.filter((image) => image.status === 'ready' && image.stagedPath)
			.map((image): RemotePromptImage => ({ type: 'image', path: image.stagedPath, mimeType: image.mimeType }));
	}

	private optionsChanged(base: Baseline): boolean {
		return (
			this.role !== base.role ||
			this.modelSelector !== base.modelSelector ||
			this.thinking !== base.thinking ||
			!sameList(this.directiveIds, base.directiveIds) ||
			this.machineId !== base.machineId
		);
	}

	private imagesChanged(): boolean {
		return (
			this.keptImages.length !== this.existingImages.length ||
			this.newImages.some((image) => image.status === 'ready')
		);
	}

	/** Programmazione della coda, oggi o domani se l'orario e' gia' passato. */
	scheduleChoice(when: WhenChoice): RemoteScheduleChoice | null {
		if (when === 'reset') return { kind: 'reset' };
		if (when !== 'at') return null;
		const today = calculateScheduleEpoch(this.atTime, 'today');
		const notBefore = today !== null && today > Date.now() ? today : calculateScheduleEpoch(this.atTime, 'tomorrow');
		return notBefore === null ? null : { kind: 'at', notBefore };
	}

	/** Orario che il lavoro programmato ha adesso, per precompilare la scelta. */
	currentAtTime(): string {
		const schedule = this.task?.schedule;
		return schedule?.kind === 'at' && schedule.notBefore ? formatHHMM(schedule.notBefore) : defaultScheduleTime();
	}

	private validate(): boolean {
		if (!this.prompt.trim()) {
			this.error = t('workValidationPromptEmpty');
			return false;
		}
		if (this.imagesStaging) {
			this.error = t('chatAttachStaging');
			return false;
		}
		this.error = null;
		return true;
	}

	/** Solo i campi cambiati: il resto del lavoro, prewalk compreso, resta com'e' in Studio. */
	private updateCommand(): Extract<RemoteCommand, { kind: 'update_task' }> | null {
		const base = this.baseline;
		if (!this.taskId || !base) return null;
		const command: Extract<RemoteCommand, { kind: 'update_task' }> = {
			kind: 'update_task',
			projectId: this.projectId,
			taskId: this.taskId
		};
		let changed = false;
		const prompt = this.prompt.trim();
		if (!this.promptLocked && prompt !== base.prompt.trim()) {
			command.prompt = prompt;
			changed = true;
		}
		if (this.withOptions && this.optionsChanged(base)) {
			command.options = this.optionsPayload();
			changed = true;
		}
		if (this.withOptions && this.imagesChanged()) {
			command.images = { keep: [...this.keptImages], add: this.stagedImages() };
			changed = true;
		}
		return changed ? command : null;
	}

	// --- Azioni ---------------------------------------------------------------

	/** «Metti in coda» di un lavoro nuovo, con la programmazione scelta. */
	async queue(): Promise<void> {
		if (this.busy || !this.validate()) return;
		this.busy = true;
		try {
			const target = this.createTarget();
			const command: Extract<RemoteCommand, { kind: 'create_task' }> = {
				kind: 'create_task',
				projectId: target.project.id,
				prompt: this.prompt.trim(),
				schedule: this.scheduleChoice(this.when),
				...(this.withOptions ? { options: this.optionsPayload(), images: this.stagedImages() } : {})
			};
			// Progetto solo su una macchina spenta: il relay conserva il lavoro
			// e lo consegna al ritorno (R-REM-22), invece di un host_offline.
			const defer = !target.online && this.deferable;
			await connection.sendCommand(target.hostId, command, { deferIfOffline: defer });
			this.showToast(
				defer
					? t('workDeferredToast', { machine: target.hostName })
					: t('workSavedToast', { project: target.project.name })
			);
			this.close();
		} catch (err) {
			this.error = errorText(err);
			this.view = 'main';
		} finally {
			this.busy = false;
		}
	}

	/** Il lavoro puo' aspettare una macchina spenta solo se il progetto vive li' soltanto (R-REM-22). */
	private get deferable(): boolean {
		const group = this.group;
		return Boolean(group && group.copies.length === 1 && !group.copies[0]!.online);
	}

	async save(): Promise<void> {
		if (this.busy || !this.validate()) return;
		const command = this.updateCommand();
		if (!command) {
			this.close();
			return;
		}
		this.busy = true;
		try {
			const target = this.editTarget();
			await connection.sendCommand(target.hostId, { ...command, projectId: target.project.id });
			this.showToast(t('workUpdatedToast'));
			this.close();
		} catch (err) {
			this.error = errorText(err);
		} finally {
			this.busy = false;
		}
	}

	/**
	 * «Avvia ora»: le regole della coda di Studio decidono dove (R-REM-09);
	 * «Nuovo worktree» lo chiede esplicitamente. Un lavoro in coda modificato si
	 * salva prima di partire.
	 */
	async start(): Promise<void> {
		if (this.busy || !this.validate()) return;
		const destination = this.newWorktree ? 'new_lane' : 'auto';
		this.busy = true;
		try {
			if (this.mode === 'new') {
				// La macchina scelta decide dove parte (R-REM-20).
				const target = this.createTarget();
				if (this.withOptions) {
					const result = (await connection.sendCommand(
						target.hostId,
						{
							kind: 'create_task',
							projectId: target.project.id,
							prompt: this.prompt.trim(),
							schedule: null,
							options: this.optionsPayload(),
							images: this.stagedImages(),
							start: { destination }
						},
						{ deferIfOffline: !target.online && this.deferable }
					)) as { taskId: string; dispatch?: RemoteDispatchOutcome; deferred?: boolean };
					this.taskId = result.taskId ?? null;
					this.handleOutcome(result.dispatch, target);
				} else {
					// Macchina precedente: crea e avvia con le regole che conosce.
					const created = (await connection.sendCommand(
						target.hostId,
						{
							kind: 'create_task',
							projectId: target.project.id,
							prompt: this.prompt.trim(),
							schedule: null
						},
						{ deferIfOffline: !target.online && this.deferable }
					)) as { taskId: string; deferred?: boolean };
					if (created.deferred) {
						this.showToast(t('workDeferredToast', { machine: target.hostName }));
						this.close();
						return;
					}
					this.taskId = created.taskId;
					const outcome = (await connection.sendCommand(target.hostId, {
						kind: 'run_task',
						projectId: target.project.id,
						taskId: created.taskId
					})) as RemoteDispatchOutcome | undefined;
					this.handleOutcome(outcome, target);
				}
			} else if (this.taskId) {
				// «Avvia» va alla macchina del lavoro, poi all'auto-avvio, poi
				// all'ultima usata (R-REM-19).
				const group = this.group;
				const task = this.task;
				const target = group && task ? runTaskCopy(group, task) : this.editTarget();
				const update = this.updateCommand();
				if (update) {
					await connection.sendCommand(target.hostId, { ...update, projectId: target.project.id });
					this.captureBaseline();
				}
				const outcome = (await connection.sendCommand(target.hostId, {
					kind: 'run_task',
					projectId: target.project.id,
					taskId: this.taskId,
					...(this.withOptions ? { destination } : {})
				})) as RemoteDispatchOutcome | undefined;
				this.handleOutcome(outcome, target);
			}
		} catch (err) {
			this.error = errorText(err);
		} finally {
			this.busy = false;
		}
	}

	/** Programmazione di un lavoro in coda: si applica subito, come in Studio. */
	async applySchedule(when: WhenChoice): Promise<void> {
		if (this.busy || !this.taskId) return;
		this.busy = true;
		try {
			const target = this.editTarget();
			await connection.sendCommand(target.hostId, {
				kind: 'update_task',
				projectId: target.project.id,
				taskId: this.taskId,
				schedule: this.scheduleChoice(when)
			});
			this.showToast(t('workScheduleUpdated'));
			this.view = 'main';
		} catch (err) {
			this.error = errorText(err);
			this.view = 'main';
		} finally {
			this.busy = false;
		}
	}

	async move(delta: -1 | 1): Promise<void> {
		if (this.busy || !this.taskId) return;
		const queued = this.queuedTasks;
		const from = queued.findIndex((task) => task.id === this.taskId);
		const to = from + delta;
		if (from < 0 || to < 0 || to >= queued.length) return;
		this.busy = true;
		try {
			const target = this.editTarget();
			await connection.sendCommand(target.hostId, {
				kind: 'move_task',
				projectId: target.project.id,
				taskId: this.taskId,
				toIndex: to
			});
			this.showToast(to === 0 ? t('workNextToast') : t('workMovedToast', { pos: to + 1 }));
			this.view = 'main';
		} catch (err) {
			this.error = errorText(err);
			this.view = 'main';
		} finally {
			this.busy = false;
		}
	}

	async remove(): Promise<void> {
		if (this.busy || !this.taskId) return;
		this.busy = true;
		try {
			const target = this.editTarget();
			await connection.sendCommand(target.hostId, {
				kind: 'delete_task',
				projectId: target.project.id,
				taskId: this.taskId
			});
			this.showToast(t('workDeletedToast', { project: this.project?.name ?? '' }));
			this.close();
		} catch (err) {
			this.error = errorText(err);
			this.view = 'main';
		} finally {
			this.busy = false;
		}
	}

	// --- Esito dell'avvio e conferme (R-REM-10) ------------------------------

	private handleOutcome(outcome: RemoteDispatchOutcome | undefined, target: ProjectCopy): void {
		if (!outcome) {
			// Macchina senza esito strutturato: il lavoro e' partito dove ha deciso Studio.
			this.showToast(t('workStartedToast'));
			this.close();
			return;
		}
		if (outcome.status === 'started') {
			this.close();
			navigation.openChat({ hostId: target.hostId, projectId: target.project.id, laneId: outcome.laneId });
			return;
		}
		// La conferma vive sull'istantanea della macchina che ha risposto (R-REM-10).
		this.confirmationId = outcome.confirmationId;
		this.confirmationHostId = target.hostId;
		this.confirmationProjectId = target.project.id;
		this.confirmationSeen = false;
		this.selectedFiles = [];
		this.view = 'confirm';
	}

	/**
	 * Allinea la conferma all'istantanea: alla prima comparsa preseleziona i file
	 * suggeriti; se sparisce senza una nostra risposta, e' stata decisa su Studio.
	 */
	syncConfirmation(): void {
		if (!this.confirmationId || this.busy) return;
		const confirmation = this.confirmation;
		if (confirmation) {
			if (!this.confirmationSeen) {
				this.confirmationSeen = true;
				if (confirmation.kind === 'local_files') {
					this.selectedFiles = confirmation.files.filter((file) => file.suggested).map((file) => file.path);
				}
			}
			return;
		}
		if (this.confirmationSeen) {
			this.close();
			this.showToast(t('workConfirmationResolvedDesktop'));
		}
	}

	toggleFile(path: string): void {
		this.selectedFiles = this.selectedFiles.includes(path)
			? this.selectedFiles.filter((value) => value !== path)
			: [...this.selectedFiles, path];
	}

	async respond(answer: RemoteDispatchAnswer): Promise<void> {
		const confirmationId = this.confirmationId;
		if (!confirmationId || this.busy) return;
		this.busy = true;
		try {
			const target =
				this.group?.copies.find(
					(copy) =>
						copy.hostId === this.confirmationHostId && copy.project.id === this.confirmationProjectId
				) ?? this.editTarget();
			const outcome = (await connection.sendCommand(target.hostId, {
				kind: 'respond_dispatch',
				projectId: target.project.id,
				confirmationId,
				answer
			})) as RemoteDispatchOutcome | undefined;
			if (answer.action === 'cancel') {
				// Nessun worktree: il lavoro resta in coda, dove Studio l'ha salvato.
				this.close();
				this.showToast(t('workLeftInQueue'));
				return;
			}
			this.handleOutcome(outcome, target);
		} catch (err) {
			this.error = errorText(err);
		} finally {
			this.busy = false;
		}
	}
}

export const workSheet = new WorkSheetStore();
