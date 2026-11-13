<script lang="ts">
	// Corsie e prototipi del progetto dentro il popover dei progetti (TPR-023..030).
	//
	// Questa vista non ha testata propria: la card, il titolo, la X e il ritorno
	// indietro li rende ProjectPopover. Qui vivo solo i contenuti, e la larghezza
	// utile e' quella della card (306 px meno i 16 px di padding per lato).
	//
	// Invarianti:
	// 1. Creazione: si riusano i flussi esistenti (worktree con il consenso una
	//    tantum sul profilo tecnico, prototipo con l'indice del Laboratorio).
	//    Nessun secondo form di creazione dentro la card.
	// 2. Aperte: si escludono Principale, chiuse e archiviate. La X su un worktree
	//    apre la revisione esistente senza chiudere ne' integrare nulla; la X su
	//    un prototipo lo chiude in modo reversibile, con errore visibile.
	// 3. Chiuse: elenco reale da `listClosedLanes`. La riga riapre la corsia; il
	//    cestino chiede conferma SULLA STESSA RIGA per 5 s, poi annulla da solo.
	// 4. Ogni operazione asincrona cattura progetto e destinatario prima di
	//    attendere, e non scrive stato se nel frattempo il progetto e' cambiato.
	import { m } from '#lib/paraglide/messages.js';
	import { tick, untrack } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { laneStore } from '#lib/stores/lanes.svelte.ts';
	import { projectStore, type Project } from '#lib/stores/projects.svelte.ts';
	import { laneOrchestrator } from '#lib/lanes/laneOrchestrator.svelte.ts';
	import { gitDiffStore } from '#lib/stores/gitDiff.svelte.ts';
	import { labApi } from '#lib/lab/api.ts';
	import {
		formatRelativeDate,
		openLabEntry,
		startCreateWorktreeFlow
	} from '#lib/lanes/laneActions.ts';
	import {
		closeLane,
		deleteLabPrototype,
		deleteWorktreeLane,
		listClosedLanes,
		reopenLane,
		type ClosedLaneEntry,
		type LaneUnintegratedLoss
	} from '#lib/lanes/laneLifecycle.ts';
	import {
		recordAllowlistDecision,
		type ProjectProfileReview
	} from '#lib/lanes/laneProfile.ts';
	import { unintegratedLoss, type LaneUnintegratedSummary } from '#lib/lanes/laneCleanup.ts';
	import { describeLaneProcess } from '#lib/lanes/processSupervisor.ts';
	import {
		MAIN_LANE_ID,
		type AgentLane,
		type LaneId,
		type ProjectId
	} from '#lib/types/lanes.ts';
	import type { LaneRecord } from '#lib/stores/lanePersistence.ts';
	import { IconClose, IconGitBranch, IconLab, IconTrash } from '#lib/icons.ts';
	import Switch from '#lib/ui/Switch.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import LaneProfileDialog from './LaneProfileDialog.svelte';

	interface Props {
		project: Project;
		/** Chiude l'intero popover (non solo questa vista). */
		onClose: () => void;
		/** Il genitore apre la finestra esistente «Revisiona e integra». */
		onReviewLane?: (lane: AgentLane | LaneRecord) => void;
	}

	let { project, onClose, onReviewLane }: Props = $props();

	/** Finestra di validita' della conferma in linea: scaduta, non elimina. */
	const CONFIRM_WINDOW_MS = 5000;

	/**
	 * Esito della lettura del lavoro non integrato. `unknown` esiste perche'
	 * un'ispezione fallita NON e' un'assenza di lavoro: la conferma lo dice e
	 * il backend resta comunque l'ultima protezione del branch.
	 */
	type LossRead =
		| { kind: 'none' }
		| { kind: 'known'; loss: LaneUnintegratedLoss }
		| { kind: 'unknown' };

	interface ConfirmState {
		entry: ClosedLaneEntry;
		loss: LossRead;
		/**
		 * Vero quando l'utente ha visto che si perde lavoro non integrato (conteggio
		 * o perdita ignota): solo allora la conferma autorizza a cancellare il
		 * branch. Con la sola domanda «Sei sicuro?» il consenso non copre la perdita.
		 */
		discard: boolean;
		/** Oltre questo istante la conferma non elimina piu' nulla. */
		deadline: number;
		/** Identifica l'armamento: la barra riparte a ogni nuova conferma. */
		token: number;
	}

	const instanceId = $props.id();
	const openHeadingId = `${instanceId}-open`;
	const closedHeadingId = `${instanceId}-closed`;
	const resumeSwitchId = `${instanceId}-resume`;

	let listEl = $state<HTMLElement | null>(null);

	let closedLanes = $state<ClosedLaneEntry[]>([]);
	let closedLoading = $state(false);
	let closedRequest = 0;

	let confirmState = $state<ConfirmState | null>(null);
	let confirmToken = 0;
	let confirmTimer: ReturnType<typeof setTimeout> | null = null;

	/** Operazione in corso su una riga: `git:<lane>` oppure `lab:<lane>`. */
	let busyKey = $state<string | null>(null);
	/** Esito leggibile di un'azione fallita; resta finche' non cambia progetto. */
	let notice = $state<string | null>(null);

	let creatingWorktree = $state(false);
	let creatingPrototype = $state(false);
	/** Consenso una tantum sul profilo tecnico, in attesa dell'utente. */
	let profileReview = $state<ProjectProfileReview | null>(null);

	const ownerProjectId = $derived(project.id as ProjectId);

	const isGitRepo = $derived(
		Boolean(project.canonicalProjectPath && !project.labDraft) &&
			gitDiffStore.forPath(project.canonicalProjectPath ?? '').isRepo !== false
	);

	// Etichette brevi: la colonna di stato sta in 72 px accanto al nome. Le
	// frasi del tooltip della barra progetti sono troppo lunghe per una riga.
	const agentStateLabel = $derived.by((): Record<AgentLane['agentState'], string> => ({
		working: m.project_tabs_lanes_state_working(),
		attention: m.project_tabs_lanes_state_attention(),
		finished: m.project_tabs_lanes_state_finished(),
		idle: m.project_tabs_lanes_state_idle(),
		unknown: m.project_tabs_lanes_state_unknown()
	}));

	/** Corsie secondarie vive: Principale, chiuse e archiviate non appartengono qui. */
	const openLanes = $derived(
		laneStore
			.lanesFor(ownerProjectId)
			.filter(
				(lane) =>
					lane.laneId !== MAIN_LANE_ID && lane.status !== 'archived' && lane.status !== 'closed'
			)
	);

	// Firma delle sole proprieta' che cambiano l'elenco delle chiuse: senza,
	// l'effetto rileggerebbe l'indice Lab dal disco a ogni cambio di stato agente.
	const closedSignature = $derived(
		laneStore
			.lanesFor(ownerProjectId)
			.map((lane) => `${lane.laneId}|${lane.status}|${lane.closedAt ?? ''}|${lane.title}`)
			.join('\n')
	);

	function laneKey(kind: 'git' | 'lab', targetLaneId: string): string {
		return `${kind}:${targetLaneId}`;
	}

	function entryKey(entry: ClosedLaneEntry): string {
		return laneKey(entry.kind, entry.laneId);
	}

	function errorText(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	function agentStateOf(lane: AgentLane | LaneRecord): AgentLane['agentState'] {
		return laneOrchestrator.laneAgentState(project, lane.laneId);
	}

	/**
	 * Sottotitolo di una riga chiusa: il branch reale per un worktree (il
	 * record resta nel registro anche dopo la chiusura) o il Laboratorio.
	 */
	function closedSub(entry: ClosedLaneEntry): string {
		if (entry.kind === 'lab') return m.project_tabs_lanes_lab();
		const branch = laneStore
			.lanesFor(ownerProjectId)
			.find((lane) => lane.laneId === entry.laneId)?.branch;
		return branch ?? m.project_tabs_lanes_no_branch();
	}

	async function reloadClosed(): Promise<void> {
		const owner = untrack(() => project);
		const startedAt = project.id;
		if (!owner.canonicalProjectPath || owner.labDraft) {
			closedLanes = [];
			closedLoading = false;
			return;
		}
		const request = ++closedRequest;
		closedLoading = true;
		const list = await listClosedLanes(owner).catch((error) => {
			if (request === closedRequest && !stale(startedAt)) notice = m.project_tabs_lanes_read_failed({ error: errorText(error) });
			return null;
		});
		// Un'altra richiesta ha gia' risposto, o il progetto e' cambiato: il
		// risultato non appartiene piu' a questa vista.
		if (request !== closedRequest || stale(startedAt)) return;
		closedLoading = false;
		// Lettura fallita: non si azzera l'elenco (sembrerebbe «nessuna chiusa»).
		if (list) closedLanes = list;
	}

	/** Il cambio di progetto azzera gli stati locali, non le operazioni in volo. */
	let lastProjectId = $state<string | null>(null);
	$effect(() => {
		const id = project.id;
		if (lastProjectId === id) return;
		lastProjectId = id;
		clearConfirmTimer();
		confirmState = null;
		notice = null;
		busyKey = null;
		profileReview = null;
		creatingWorktree = false;
		creatingPrototype = false;
		closedLanes = [];
		closedLoading = false;
		// Invalida le risposte del progetto precedente ancora in volo.
		closedRequest += 1;
	});

	$effect(() => {
		// Dipende solo da cio' che cambia davvero l'elenco delle chiuse.
		void project.id;
		void closedSignature;
		const path = project.canonicalProjectPath;
		void project.labDraft;
		untrack(() => {
			void reloadClosed();
			if (path) void gitDiffStore.load(path);
		});
	});

	/**
	 * La card puo' chiudersi mentre un'operazione e' in volo: dopo lo smontaggio
	 * il lavoro gia' avviato continua, ma questa vista non chiama piu' nulla.
	 */
	let disposed = false;
	$effect(() => () => {
		disposed = true;
		clearConfirmTimer();
	});

	function clearConfirmTimer() {
		if (confirmTimer) clearTimeout(confirmTimer);
		confirmTimer = null;
	}

	function isConfirming(entry: ClosedLaneEntry): boolean {
		const state = confirmState;
		return state !== null && entryKey(state.entry) === entryKey(entry);
	}

	/**
	 * Armata la conferma sulla riga: barra di 5 s, poi si annulla da sola e
	 * ripristina la riga. L'eliminazione non e' mai implicita.
	 */
	function armConfirm(entry: ClosedLaneEntry, loss: LossRead) {
		clearConfirmTimer();
		confirmToken += 1;
		const token = confirmToken;
		confirmState = {
			entry,
			loss,
			// Una lettura fallita non e' un'assenza di lavoro: la conferma dice la
			// perdita e solo allora copre la cancellazione dei commit.
			discard: loss.kind !== 'none',
			deadline: Date.now() + CONFIRM_WINDOW_MS,
			token
		};
		notice = null;
		confirmTimer = setTimeout(() => {
			// Il fuoco resta nella riga solo se l'utente non si e' gia' spostato.
			if (confirmState?.token !== token) return;
			const row = listEl?.querySelector<HTMLElement>(`[data-row="${entryKey(entry)}"]`);
			cancelConfirm(Boolean(row?.contains(document.activeElement)));
		}, CONFIRM_WINDOW_MS);
		void focusCancelButton(entry);
	}

	async function focusCancelButton(entry: ClosedLaneEntry) {
		await tick();
		listEl
			?.querySelector<HTMLElement>(`[data-row="${entryKey(entry)}"] [data-confirm-cancel]`)
			?.focus({ preventScroll: true });
	}

	function cancelConfirm(restoreFocus = true) {
		const target = confirmState?.entry;
		clearConfirmTimer();
		confirmState = null;
		if (!restoreFocus || !target) return;
		void tick().then(() =>
			listEl
				?.querySelector<HTMLElement>(`[data-row="${entryKey(target)}"] [data-confirm-delete]`)
				?.focus({ preventScroll: true })
		);
	}

	// Esc chiude prima questa conferma, poi (e solo poi) il popover: in capture
	// il gestore del genitore non vede l'evento finche' la riga e' armata.
	$effect(() => {
		if (!confirmState) return;
		const handler = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			// Una finestra modale aperta sopra (consenso sul profilo tecnico)
			// gestisce il proprio Esc: qui non le si ruba il tasto.
			if (document.querySelector('dialog[open]')) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			cancelConfirm();
		};
		document.addEventListener('keydown', handler, true);
		return () => document.removeEventListener('keydown', handler, true);
	});

	/**
	 * Legge il lavoro che l'eliminazione cancellerebbe. Distingue «niente da
	 * perdere» da «non leggibile»: `fetchUnintegratedLoss` appiattisce i due
	 * casi su `null`, e qui la differenza decide cosa dice la conferma.
	 */
	async function readLoss(owner: Project, targetLaneId: LaneId): Promise<LossRead> {
		const inTauri =
			typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
		if (!inTauri || !owner.canonicalProjectPath || targetLaneId === MAIN_LANE_ID) {
			return { kind: 'none' };
		}
		try {
			const summary = await invoke<LaneUnintegratedSummary>(
				'worktree_lane_unintegrated_summary',
				{ args: { projectPath: owner.canonicalProjectPath, laneId: targetLaneId } }
			);
			const loss = unintegratedLoss(summary);
			return loss ? { kind: 'known', loss } : { kind: 'none' };
		} catch {
			return { kind: 'unknown' };
		}
	}

	/**
	 * Il consenso copre i dati che l'utente ha davanti. Serve un nuovo consenso
	 * quando compare lavoro che nessuno ha visto (da «niente» a «qualcosa») o
	 * quando i commit da perdere sono piu' di quelli mostrati.
	 *
	 * Anche una rilettura fallita amplia una perdita prima quantificata: il
	 * consenso deve mostrare che ora non si riesce a verificarne l'entita'.
	 */
	function needsNewConsent(state: ConfirmState, fresh: LossRead): boolean {
		if (!state.discard) return fresh.kind !== 'none';
		if (state.loss.kind === 'known' && fresh.kind === 'unknown') return true;
		if (state.loss.kind !== 'known' || fresh.kind !== 'known') return false;
		return fresh.loss.commits > state.loss.loss.commits || fresh.loss.files > state.loss.loss.files;
	}

	/**
	 * Il testo dice cosa si perde quando si sa, e lo dice quando non si sa:
	 * una lettura fallita non diventa mai «niente da perdere».
	 */
	function confirmPrompt(state: ConfirmState): string {
		if (state.loss.kind === 'known') {
			return state.loss.loss.commits > 0
				? m.project_tabs_lanes_confirm_loss({ commits: state.loss.loss.commits })
				: m.project_tabs_lanes_confirm_loss_unknown();
		}
		if (state.loss.kind === 'unknown') return m.project_tabs_lanes_confirm_loss_unknown();
		return m.project_tabs_lanes_confirm_prompt();
	}

	function confirmGroupLabel(entry: ClosedLaneEntry): string {
		const state = confirmState;
		if (!state || entryKey(state.entry) !== entryKey(entry)) {
			return entry.title;
		}
		return `${m.project_tabs_lanes_confirm_group({ name: entry.title })} · ${confirmPrompt(state)} · ${m.project_tabs_lanes_confirm_auto()}`;
	}

	function cancelPendingConfirm() {
		if (confirmState) cancelConfirm(false);
	}

	/**
	 * Vero quando la vista mostra ormai un altro progetto. Ogni operazione
	 * asincrona cattura l'id del destinatario prima di attendere: quando atterra
	 * su un altro progetto non scrive stato, ma porta comunque a termine il
	 * lavoro che ha gia' avviato sullo store.
	 */
	function stale(startedAt: string): boolean {
		return disposed || startedAt !== untrack(() => project.id);
	}

	// ------------------------------------------------------------------
	// Creazione
	// ------------------------------------------------------------------

	async function createWorktree() {
		if (creatingWorktree) return;
		const owner = untrack(() => project);
		const startedAt = project.id;
		creatingWorktree = true;
		notice = null;
		try {
			// Flusso condiviso: se c'e' un consenso da chiedere lo restituisce qui
			// e la creazione aspetta la risposta dell'utente, non un secondo form.
			await startCreateWorktreeFlow(owner, {
				onProfileReview: (review) => {
					if (stale(startedAt)) return;
					profileReview = review as ProjectProfileReview;
				}
			});
			if (stale(startedAt)) return;
			if (!profileReview) onClose();
		} catch (error) {
			if (!stale(startedAt)) {
				notice = m.project_tabs_lanes_create_failed({ error: errorText(error) });
			}
		} finally {
			if (!stale(startedAt)) creatingWorktree = false;
		}
	}

	async function confirmProfile(accepted: string[]) {
		const review = profileReview;
		profileReview = null;
		if (!review) return;
		const owner = untrack(() => project);
		const startedAt = project.id;
		try {
			await recordAllowlistDecision(owner, {
				accepted,
				reviewed: review.pendingCandidates.map((candidate) => candidate.relativePath)
			});
		} catch (error) {
			if (!stale(startedAt)) {
				notice = m.project_tabs_lanes_create_failed({ error: errorText(error) });
			}
			return;
		}
		if (stale(startedAt)) return;
		// Consenso registrato: si crea e basta. Rilanciare il flusso rifarebbe
		// la scansione del profilo appena decisa (LaneStrip fa lo stesso).
		try {
			await laneOrchestrator.createNewLane(owner);
			if (!stale(startedAt)) onClose();
		} catch (error) {
			if (!stale(startedAt)) {
				notice = m.project_tabs_lanes_create_failed({ error: errorText(error) });
			}
		}
	}

	async function createPrototype() {
		if (creatingPrototype) return;
		const owner = untrack(() => project);
		const startedAt = project.id;
		const path = owner.canonicalProjectPath;
		if (!path) return;
		creatingPrototype = true;
		notice = null;
		try {
			const entry = await labApi.createPrototype(path);
			// Il prototipo e' nato nel progetto catturato: aprire la corsia e'
			// il seguito di quel lavoro, anche se la card mostra altro.
			await openLabEntry(owner.id, entry);
			if (!stale(startedAt)) onClose();
		} catch (error) {
			if (!stale(startedAt)) {
				notice = m.project_tabs_lanes_create_failed({ error: errorText(error) });
			}
		} finally {
			if (!stale(startedAt)) creatingPrototype = false;
		}
	}

	// ------------------------------------------------------------------
	// Aperte: apri, revisiona, chiudi
	// ------------------------------------------------------------------

	function openLane(lane: AgentLane | LaneRecord) {
		const ownerId: ProjectId = project.id;
		const targetLaneId: LaneId = lane.laneId;
		projectStore.setActive(ownerId);
		onClose();
		// Lo switch continua dopo la chiusura della card: il destinatario e'
		// gia' catturato, quindi non puo' finire su un altro progetto.
		void laneOrchestrator.switchLane(ownerId, targetLaneId);
	}

	function reviewLane(lane: AgentLane | LaneRecord) {
		// La finestra di revisione e' del genitore: qui si apre e si chiude la
		// card, senza chiudere ne' integrare la corsia.
		onReviewLane?.(lane);
		onClose();
	}

	async function closeLabLane(lane: AgentLane | LaneRecord) {
		if (busyKey) return;
		const ownerId: ProjectId = project.id;
		const targetLaneId: LaneId = lane.laneId;
		const startedAt = project.id;
		busyKey = laneKey('lab', targetLaneId);
		notice = null;
		try {
			const outcome = await closeLane(ownerId, targetLaneId);
			if (stale(startedAt)) return;
			if (outcome.kind === 'failed') {
				notice = m.project_tabs_lanes_close_failed({ error: outcome.message });
				return;
			}
			await reloadClosed();
		} catch (error) {
			if (!stale(startedAt)) {
				notice = m.project_tabs_lanes_close_failed({ error: errorText(error) });
			}
		} finally {
			if (!stale(startedAt)) busyKey = null;
		}
	}

	// ------------------------------------------------------------------
	// Chiuse: riapri, elimina con conferma in linea
	// ------------------------------------------------------------------

	async function reopenClosedLane(entry: ClosedLaneEntry) {
		if (busyKey) return;
		const owner = untrack(() => project);
		if (entry.projectId !== owner.id) return;
		const startedAt = project.id;
		busyKey = entryKey(entry);
		notice = null;
		// La riapertura e' un'apertura: seleziona il progetto giusto, poi la corsia.
		projectStore.setActive(owner.id);
		try {
			await reopenLane(owner, entry);
			if (stale(startedAt)) return;
			onClose();
		} catch (error) {
			if (!stale(startedAt)) {
				notice = m.project_tabs_lanes_reopen_failed({ error: errorText(error) });
			}
		} finally {
			if (!stale(startedAt)) busyKey = null;
		}
	}

	async function requestDelete(entry: ClosedLaneEntry) {
		if (busyKey) return;
		const owner = untrack(() => project);
		if (entry.projectId !== owner.id) return;
		const startedAt = project.id;
		// Cambiare bersaglio annulla la conferma precedente: nessuna cattura
		// distruttiva migra su un'altra voce.
		cancelPendingConfirm();
		// L'ispezione e' un'attesa come le altre: il cestino resta occupato
		// finche' non si sa cosa si perde, e un doppio clic non la moltiplica.
		busyKey = entryKey(entry);
		try {
			const loss: LossRead =
				entry.kind === 'git' ? await readLoss(owner, entry.laneId) : { kind: 'none' };
			if (stale(startedAt)) return;
			armConfirm(entry, loss);
		} finally {
			if (!stale(startedAt)) busyKey = null;
		}
	}

	async function confirmDelete() {
		const state = confirmState;
		if (!state) return;
		const entry = state.entry;
		const owner = untrack(() => project);
		const ownerId: ProjectId = owner.id;
		// Scadenza o bersaglio di un altro progetto: nessuna eliminazione.
		if (Date.now() >= state.deadline || entry.projectId !== ownerId) {
			cancelConfirm();
			return;
		}
		const startedAt = project.id;
		clearConfirmTimer();
		confirmState = null;
		busyKey = entryKey(entry);
		notice = null;
		try {
			if (entry.kind === 'lab') {
				const outcome = await deleteLabPrototype(ownerId, entry.prototypeId);
				if (stale(startedAt)) return;
				if (outcome.kind === 'failed') {
					notice = m.project_tabs_lanes_delete_failed({ error: outcome.message });
				}
			} else {
				// Rilettura immediatamente prima del gesto distruttivo: il consenso
				// dato su «Sei sicuro?» non copre la perdita di commit, e un consenso
				// alla perdita non copre dati peggiori di quelli mostrati. In quei
				// casi si torna alla conferma aggiornata, senza un secondo colpo
				// implicito e senza trattare una lettura fallita come «niente».
				const fresh = await readLoss(owner, entry.laneId);
				if (stale(startedAt)) return;
				if (needsNewConsent(state, fresh)) {
					busyKey = null;
					armConfirm(entry, fresh);
					notice = m.project_tabs_lanes_confirm_refreshed();
					return;
				}
				const outcome = await deleteWorktreeLane(ownerId, entry.laneId, {
					discardUnintegrated: state.discard
				});
				if (stale(startedAt)) return;
				if (outcome.kind === 'unintegrated') {
					// Il lavoro da perdere e' cambiato (o il backend se n'e' accorto
					// ora): serve un nuovo consenso con i dati aggiornati, mai un
					// secondo tentativo distruttivo implicito.
					busyKey = null;
					armConfirm(entry, { kind: 'known', loss: outcome.loss });
					notice = m.project_tabs_lanes_confirm_refreshed();
					return;
				}
				if (outcome.kind === 'processes-active') {
					const processes =
						outcome.processes.map(describeLaneProcess).join(', ') || m.lanestrip_cleanup_pending();
					notice = m.project_tabs_lanes_delete_blocked({ processes });
				} else if (outcome.kind === 'failed') {
					notice = m.project_tabs_lanes_delete_failed({ error: outcome.message });
				}
			}
		} catch (error) {
			if (!stale(startedAt)) {
				notice = m.project_tabs_lanes_delete_failed({ error: errorText(error) });
			}
		} finally {
			if (!stale(startedAt)) {
				busyKey = null;
				await reloadClosed();
			}
		}
	}

	function confirmProgressStyle(): string {
		return `--remaining: ${CONFIRM_WINDOW_MS}ms`;
	}
</script>

<div class="lanes-view">
	<div class="create-row">
		<button
			type="button"
			class="create-btn"
			disabled={!isGitRepo || creatingWorktree || creatingPrototype}
			aria-busy={creatingWorktree}
			title={!isGitRepo ? m.lab_lane_new_worktree_disabled_no_git() : undefined}
			onclick={() => void createWorktree()}
		>
			<IconGitBranch />
			<span>{m.lanestrip_new_worktree()}</span>
		</button>
		<button
			type="button"
			class="create-btn"
			disabled={!project.canonicalProjectPath || creatingWorktree || creatingPrototype}
			aria-busy={creatingPrototype}
			onclick={() => void createPrototype()}
		>
			<IconLab />
			<span>{m.lanestrip_new_prototype()}</span>
		</button>
	</div>

	<div class="lanes-scroll" bind:this={listEl}>
		<section class="lane-group" aria-labelledby={openHeadingId}>
			<h3 id={openHeadingId} class="lanes-heading">
				{m.project_tabs_lanes_open_heading({ count: openLanes.length })}
			</h3>
			{#if openLanes.length === 0}
				<p class="lane-empty">{m.project_tabs_lanes_open_empty()}</p>
			{:else}
				<ul class="lanes-list">
					{#each openLanes as lane (laneKey(lane.kind, lane.laneId))}
						{@const isLab = lane.kind === 'lab'}
						{@const state = agentStateOf(lane)}
						{@const busy = busyKey === laneKey(lane.kind, lane.laneId)}
						<li class="lane-row">
							<button
								type="button"
								class="lane-open"
								disabled={busy}
								title={m.project_tabs_lanes_open_tooltip({ name: lane.title })}
								onclick={() => openLane(lane)}
							>
								<span class="lane-icon" aria-hidden="true">
									{#if isLab}
										<IconLab />
									{:else}
										<IconGitBranch />
									{/if}
								</span>
								<span class="lane-text">
									<span class="lane-name">{lane.title}</span>
									<span class="lane-sub" class:branch={!isLab}>
										{isLab ? m.project_tabs_lanes_lab() : (lane.branch ?? m.project_tabs_lanes_no_branch())}
									</span>
								</span>
								<span class="lane-state" class:attention={state === 'attention'}>
									{agentStateLabel[state]}
								</span>
							</button>
							<Tooltip
								placement="right-start"
								text={isLab
									? m.project_tabs_lanes_close_lab_tooltip()
									: m.project_tabs_lanes_review_tooltip()}
							>
								<button
									type="button"
									class="lane-action"
									disabled={busy}
									aria-label={isLab
										? m.project_tabs_lanes_close_lab_tooltip()
										: m.project_tabs_lanes_review_tooltip()}
									onclick={(event) => {
										event.stopPropagation();
										if (isLab) void closeLabLane(lane);
										else reviewLane(lane);
									}}
								>
									<IconClose />
								</button>
							</Tooltip>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="lane-group" aria-labelledby={closedHeadingId}>
			<h3 id={closedHeadingId} class="lanes-heading">
				{m.project_tabs_lanes_closed_heading({ count: closedLanes.length })}
			</h3>
			{#if closedLanes.length === 0 && closedLoading}
				<p class="lane-empty" aria-live="polite">{m.project_tabs_lanes_closed_loading()}</p>
			{:else if closedLanes.length === 0}
				<p class="lane-empty">{m.project_tabs_lanes_closed_empty()}</p>
			{:else}
				<ul class="lanes-list" aria-busy={closedLoading}>
					{#each closedLanes as entry (entryKey(entry))}
						{@const isLab = entry.kind === 'lab'}
						{@const confirming = isConfirming(entry)}
						{@const lostWork = confirming && confirmState !== null && confirmState.loss.kind !== 'none'}
						{@const confirmText =
							confirming && confirmState !== null ? confirmPrompt(confirmState) : ''}
						{@const busy = busyKey === entryKey(entry)}
						<li class="lane-row" class:confirming data-row={entryKey(entry)}>
							<div class="lane-normal" inert={confirming} aria-hidden={confirming}>
								<button
									type="button"
									class="lane-open"
									disabled={busy}
									title={m.project_tabs_lanes_reopen_tooltip({ name: entry.title })}
									onclick={() => void reopenClosedLane(entry)}
								>
									<span class="lane-icon" aria-hidden="true">
										{#if isLab}
											<IconLab />
										{:else}
											<IconGitBranch />
										{/if}
									</span>
									<span class="lane-text">
										<span class="lane-name">{entry.title}</span>
										<span class="lane-sub" class:branch={!isLab}>
											{closedSub(entry)}
										</span>
									</span>
									<span class="lane-state date">
										{entry.closedAt > 0 ? formatRelativeDate(entry.closedAt) : '—'}
									</span>
								</button>
								<Tooltip text={m.project_tabs_lanes_delete_tooltip()} placement="right-start">
									<button
										type="button"
										class="lane-action danger"
										disabled={busy}
										aria-label={m.project_tabs_lanes_delete_tooltip()}
										data-confirm-delete
										onclick={(event) => {
											event.stopPropagation();
											void requestDelete(entry);
										}}
									>
										<IconTrash />
									</button>
								</Tooltip>
							</div>

							<div
								class="lane-confirm"
								class:armed={confirming}
								inert={!confirming}
								role="group"
								aria-label={confirmGroupLabel(entry)}
							>
								<span class="confirm-icon" aria-hidden="true">
									{#if isLab}
										<IconLab />
									{:else}
										<IconGitBranch />
									{/if}
								</span>
								<span class="confirm-prompt" class:loss={lostWork} title={confirmText}>
									{confirmText}
								</span>
								<button
									type="button"
									class="confirm-btn danger"
									disabled={busy}
									data-confirm-apply
									onclick={() => void confirmDelete()}
								>
									{m.project_tabs_lanes_confirm_delete()}
								</button>
								<button
									type="button"
									class="confirm-btn ghost"
									data-confirm-cancel
									onclick={() => cancelConfirm()}
								>
									{m.project_tabs_lanes_confirm_cancel()}
								</button>
								{#if confirming}
									{#key confirmState?.token}
										<span
											class="confirm-progress"
											style={confirmProgressStyle()}
											aria-hidden="true"
										></span>
									{/key}
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	{#if notice}
		<p class="lanes-notice" role="alert">{notice}</p>
	{/if}

	{#if isGitRepo}
		<div class="lane-pref">
			<label class="pref-label" for={resumeSwitchId}>{m.project_tabs_lanes_resume()}</label>
			<Tooltip text={m.lanestrip_worktree_resume_chat_desc()}>
				<Switch
					id={resumeSwitchId}
					checked={project.worktreeResumeChat}
					ariaLabel={m.project_tabs_lanes_resume()}
					onChange={(value) => projectStore.setWorktreeResumeChat(project.id, value)}
				/>
			</Tooltip>
		</div>
	{/if}
</div>

<LaneProfileDialog
	open={profileReview !== null}
	detection={profileReview?.detection ?? null}
	candidates={profileReview?.pendingCandidates ?? []}
	onConfirm={(accepted) => void confirmProfile(accepted)}
	onCancel={() => (profileReview = null)}
/>

<style>
	.lanes-view {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		--icon-size: 14px;
	}

	/* Creazione: due pulsanti affiancati, hover reale e graduale. */
	.create-row {
		display: flex;
		gap: 6px;
	}

	.create-btn {
		flex: 1 1 0;
		min-width: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 30px;
		padding: 6px 8px;
		background: var(--bg-hover);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.create-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--ink) 15%, transparent);
		border-color: var(--line);
	}

	.create-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.create-btn :global(svg) {
		--icon-size: 13px;
		flex: none;
	}

	/* Elenco lungo: scorre dentro la card, senza trascinare via testata e X. */
	.lanes-scroll {
		max-height: 300px;
		overflow-y: auto;
		overflow-x: hidden;
		overscroll-behavior: contain;
		padding-right: 2px;
	}

	.lane-group + .lane-group {
		margin-top: var(--space-3);
	}

	.lanes-heading {
		margin: 0 0 var(--space-1);
		padding: 0 4px;
		font-family: var(--font-ui);
		font-size: var(--text-group-label);
		font-weight: 600;
		line-height: 1.4;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.lanes-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.lane-row {
		position: relative;
		display: flex;
		align-items: center;
		border-radius: var(--radius-md);
		overflow: hidden;
		isolation: isolate;
		transition: background-color 140ms var(--ease-out);
	}

	.lane-row:hover {
		background: var(--bg-hover);
	}

	.lane-row.confirming:hover {
		background: transparent;
	}

	.lane-normal {
		display: flex;
		align-items: center;
		flex: 1 1 auto;
		min-width: 0;
		transition:
			opacity 150ms var(--ease-out),
			clip-path 200ms var(--ease-reveal);
	}

	.lane-row.confirming .lane-normal {
		opacity: 0;
		clip-path: inset(0 0 0 25% round var(--radius-md));
		pointer-events: none;
	}

	.lane-open {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		/* Altezza fissa della riga: la conferma in linea la occupa senza
		   spostare le righe vicine (TPR-027). */
		min-height: 40px;
		padding: 5px 4px 5px 6px;
		background: transparent;
		border: 0;
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		text-align: left;
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease-out);
	}

	.lane-open:disabled {
		opacity: 0.55;
		cursor: progress;
	}

	.lane-icon {
		display: grid;
		place-items: center;
		flex: none;
		width: 16px;
		color: var(--ink-muted);
	}

	.lane-icon :global(svg) {
		--icon-size: 14px;
	}

	.lane-text {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.lane-name {
		font-size: var(--text-label);
		font-weight: 450;
		line-height: 1.35;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lane-sub {
		font-size: var(--text-caption);
		line-height: 1.3;
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lane-sub.branch {
		font-family: var(--font-mono);
		font-size: 10.5px;
	}

	.lane-state {
		flex: none;
		max-width: 72px;
		font-size: var(--text-meta);
		line-height: 1.3;
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lane-state.attention {
		color: var(--warn);
	}

	.lane-state.date {
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	/* Il Tooltip avvolge il pulsante: nella riga non deve allargarsi. */
	.lane-row :global(.tooltip-wrapper) {
		flex: none;
	}

	.lane-pref :global(.tooltip-wrapper) {
		flex: none;
	}

	.lane-action {
		flex: none;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		margin: 0 2px 0 0;
		padding: 0;
		background: transparent;
		border: 0;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.lane-action :global(svg) {
		--icon-size: 14px;
	}

	.lane-action:hover:not(:disabled) {
		background: var(--bg-active);
		color: var(--ink);
	}

	.lane-action.danger:hover:not(:disabled) {
		background: color-mix(in srgb, var(--danger) 12%, transparent);
		color: var(--danger);
	}

	.lane-action:disabled {
		opacity: 0.45;
		cursor: progress;
	}

	/* Conferma in linea: stessa riga, stessa altezza, nessun riquadro sotto. */
	.lane-confirm {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 4px 0 6px;
		background: var(--bg-overlay);
		border-radius: var(--radius-md);
		opacity: 0;
		clip-path: inset(0 100% 0 0 round var(--radius-md));
		pointer-events: none;
		transition:
			clip-path 200ms var(--ease-reveal),
			opacity 150ms var(--ease-out);
	}

	.lane-confirm.armed {
		opacity: 1;
		clip-path: inset(0 0 0 0 round var(--radius-md));
		pointer-events: auto;
	}

	.confirm-icon {
		display: grid;
		place-items: center;
		flex: none;
		width: 16px;
		color: var(--ink-muted);
	}

	.confirm-icon :global(svg) {
		--icon-size: 14px;
	}

	.confirm-prompt {
		flex: 1 1 auto;
		min-width: 0;
		font-size: var(--text-caption);
		font-weight: 500;
		line-height: 1.3;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: normal;
	}

	.confirm-prompt.loss {
		color: var(--warn);
	}

	.confirm-btn {
		flex: none;
		height: 28px;
		padding: 0 8px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.confirm-btn.danger {
		color: var(--danger);
	}

	.confirm-btn.danger:hover {
		background: color-mix(in srgb, var(--danger) 12%, transparent);
	}

	.confirm-btn:disabled {
		opacity: 0.5;
		cursor: progress;
	}

	.confirm-btn.ghost {
		color: var(--ink-muted);
	}

	.confirm-btn.ghost:hover {
		background: var(--bg-active);
		color: var(--ink);
	}

	/* Barra da 2 px: lo stato naturale e' vuota, l'animazione parte piena. */
	.confirm-progress {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 2px;
		background: var(--ink-muted);
		transform: scaleX(0);
		transform-origin: left;
		animation: lane-confirm-countdown var(--remaining, 5000ms) linear forwards;
	}

	@keyframes lane-confirm-countdown {
		from {
			transform: scaleX(1);
		}
	}

	/* Movimento ridotto: la finestra resta visibile come barra ferma, cosi'
	   l'armamento non diventa invisibile. */
	@media (prefers-reduced-motion: reduce) {
		.confirm-progress {
			transform: scaleX(1);
		}
	}

	:global(:root[data-animations='false']) .confirm-progress {
		transform: scaleX(1);
	}

	.lane-empty {
		margin: 0;
		padding: 6px;
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--ink-faint);
	}

	.lanes-notice {
		margin: 0;
		padding: 6px 8px;
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border-radius: var(--radius-md);
		font-size: var(--text-caption);
		line-height: 1.45;
		color: var(--ink);
	}

	/* Un solo separatore, prima della preferenza finale. */
	.lane-pref {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin-top: var(--space-1);
		padding-top: var(--space-2);
		border-top: 1px solid var(--line);
	}

	.pref-label {
		flex: 1 1 auto;
		min-width: 0;
		font-size: var(--text-label);
		line-height: 1.4;
		color: var(--ink-muted);
		cursor: pointer;
		user-select: none;
	}

	.pref-label:hover {
		color: var(--ink);
	}
</style>
