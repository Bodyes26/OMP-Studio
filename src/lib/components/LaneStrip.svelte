<script lang="ts">
	import { unintegratedWarning } from '$lib/lanes/laneCleanup';
	import { m } from '$lib/paraglide/messages.js';
	import { projectStore, type Project } from '$lib/stores/projects.svelte';
	import { laneStore, type LaneRecord } from '$lib/stores/lanes.svelte';
	import { laneOrchestrator } from '$lib/lanes/laneOrchestrator.svelte';
	import {
		MAIN_LANE_ID,
		type LaneId,
		type ProjectId,
		type AgentLane
	} from '$lib/types/lanes';
	import {
		IconGitBranch,
		IconLab,
		IconClose,
		IconDiff,
		IconPlus,
		IconChevronLeft,
		IconChevronRight,
		IconWarning,
		IconRename,
		IconTrash
	} from '$lib/icons';
	import { contextMenu, type ContextMenuEntry } from '$lib/contextMenu.svelte';
	import { projectLaneActions, reportLabDeleteFailure } from '$lib/lanes/laneActions';
	import {
		closeLane,
		deleteLabPrototype,
		deleteWorktreeLane,
		inspectUnintegratedWork,
		type LaneUnintegratedLoss
	} from '$lib/lanes/laneLifecycle';
	import { renameLane, LANE_TITLE_MAX } from '$lib/lanes/laneNaming';
	import {
		activeLanes,
		buildConcurrencyWarning,
		shouldWarnConcurrency,
		type ConcurrencyWarning
	} from '$lib/lanes/queueDispatch';
	import LaneDispatchDialog from './LaneDispatchDialog.svelte';
	import LaneProfileDialog from './LaneProfileDialog.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import {
		recordAllowlistDecision,
		reviewProjectProfile,
		type ProjectProfileReview
	} from '$lib/lanes/laneProfile';
	import type { LaneProcessInfo } from '$lib/lanes/processSupervisor';
	import { agentLanes } from '$lib/lanes/agentLanes.svelte';

	let {
		project,
		onReviewLane
	}: {
		project: Project;
		onReviewLane?: (lane: AgentLane | LaneRecord) => void;
	} = $props();

	let tablistTrackEl = $state<HTMLElement | null>(null);
	let tablistEl = $state<HTMLElement | null>(null);
	let isCreating = $state(false);
	let canScrollLeft = $state(false);
	let canScrollRight = $state(false);

	/** Riepilogo del soft-cap in attesa di conferma, se la corsia sarebbe la terza. */
	let concurrencyWarning = $state<ConcurrencyWarning | null>(null);
	/** Profilo tecnico in attesa del consenso una tantum sui file locali (W10). */
	let profileReview = $state<ProjectProfileReview | null>(null);
	/**
	 * Corsia il cui cleanup e' bloccato da processi ancora vivi. `discardUnintegrated`
	 * conserva il consenso gia' dato alla perdita dei commit per il nuovo tentativo.
	 */
	let processBlock = $state<{
		laneId: LaneId;
		title: string;
		processes: LaneProcessInfo[];
		discardUnintegrated: boolean;
	} | null>(null);
	/**
	 * Bersaglio del dialogo di conferma eliminazione definitiva: worktree, o
	 * prototipo Lab se c'e' prototypeId. `loss` e' il lavoro mai integrato che
	 * andrebbe perso: col dialogo che lo dice, la conferma vale come consenso.
	 */
	let deleteConfirmTarget = $state<{
		laneId: LaneId;
		title: string;
		branch?: string;
		prototypeId?: string;
		loss?: LaneUnintegratedLoss | null;
	} | null>(null);
	/** Ultimo cleanup fallito per lock o rifiuto di Git, per corsia. */
	let cleanupPending = $state<Record<string, string>>({});

	/** Stato di rinomina in linea col doppio click. */
	let renamingLaneId = $state<string | null>(null);
	let renameDraft = $state('');
	let renameInputEl = $state<HTMLInputElement | null>(null);

	const projectLanes = $derived(laneStore.lanesFor(project.id as ProjectId));
	// Le corsie secondarie escludono Principale, archiviate e chiuse (Decisione 5)
	const secondaryLanes = $derived(
		projectLanes.filter(
			(l) => l.laneId !== MAIN_LANE_ID && l.status !== 'archived' && l.status !== 'closed'
		)
	);
	const activeLaneId = $derived(project.lane.laneId);

	let rovingLaneId = $state<string>(MAIN_LANE_ID);

	$effect(() => {
		rovingLaneId = activeLaneId;
	});

	function updateScrollState() {
		if (!tablistTrackEl) return;
		const { scrollLeft, scrollWidth, clientWidth } = tablistTrackEl;
		canScrollLeft = scrollLeft > 2;
		canScrollRight = scrollLeft + clientWidth < scrollWidth - 2;
	}

	function scrollTabs(delta: number) {
		if (!tablistTrackEl) return;
		tablistTrackEl.scrollBy({ left: delta, behavior: 'smooth' });
	}

	$effect(() => {
		// Ricalcola lo scorrimento quando cambiano le schede visibili
		const _ = secondaryLanes.length;
		const timer = setTimeout(updateScrollState, 50);
		return () => clearTimeout(timer);
	});

	type LaneKindState =
		| 'attention'
		| 'conflict'
		| 'finished'
		| 'review_ready'
		| 'working'
		| 'idle';

	function classifyLaneState(lane: AgentLane | LaneRecord): LaneKindState {
		const state = laneOrchestrator.laneAgentState(project, lane.laneId);
		if (lane.status === 'conflict') return 'conflict';
		if (state === 'attention') return 'attention';
		if (lane.status === 'review_ready') return 'review_ready';
		if (state === 'working') return 'working';
		if (state === 'finished') return 'finished';
		return 'idle';
	}

	const mainRecord = $derived(
		projectLanes.find((l) => l.laneId === MAIN_LANE_ID) ?? project.lane
	);
	const mainDisplayState = $derived(classifyLaneState(mainRecord));

	function selectLane(targetLaneId: LaneId) {
		if (project.lane.laneId === targetLaneId) return;
		rovingLaneId = targetLaneId;
		void laneOrchestrator.switchLane(project.id as ProjectId, targetLaneId);
	}

	/**
	 * Chiusura reversibile della corsia (nasconde la tab, arresta processi/sessione,
	 * preserva branch e cartella su disco).
	 */
	async function handleCloseLane(targetLaneId: LaneId) {
		const outcome = await closeLane(project.id as ProjectId, targetLaneId);
		if (outcome.kind === 'failed') {
			cleanupPending = { ...cleanupPending, [targetLaneId]: outcome.message };
		}
	}

	async function requestDeleteWorktree(targetLaneId: LaneId, title: string, branch?: string) {
		const loss = await inspectUnintegratedWork(project.id as ProjectId, targetLaneId);
		deleteConfirmTarget = { laneId: targetLaneId, title, branch, loss };
	}

	function requestDeletePrototype(targetLaneId: LaneId, title: string, prototypeId: string) {
		deleteConfirmTarget = { laneId: targetLaneId, title, prototypeId };
	}

	/**
	 * `corsia_scarta` non cancella mai lavoro mai integrato (ne' un prototipo)
	 * senza l'utente: apre questo stesso dialogo, con la perdita calcolata qui.
	 */
	$effect(() => {
		const request = agentLanes.deleteRequest;
		if (!request || request.projectId !== project.id) return;
		agentLanes.deleteRequest = null;
		const lane = projectLanes.find((candidate) => candidate.laneId === request.laneId);
		if (!lane || lane.status === 'archived') return;
		if (lane.kind === 'lab' && lane.labPrototypeId) {
			requestDeletePrototype(lane.laneId, lane.title, lane.labPrototypeId);
		} else {
			void requestDeleteWorktree(lane.laneId, lane.title, lane.branch ?? undefined);
		}
	});

	async function executeDelete() {
		const target = deleteConfirmTarget;
		deleteConfirmTarget = null;
		if (!target) return;

		if (target.prototypeId) {
			const outcome = await deleteLabPrototype(project.id as ProjectId, target.prototypeId);
			if (outcome.kind === 'failed') await reportLabDeleteFailure(outcome.message);
			return;
		}

		const discardUnintegrated = Boolean(target.loss);
		const outcome = await deleteWorktreeLane(project.id as ProjectId, target.laneId, {
			discardUnintegrated
		});
		if (outcome.kind === 'unintegrated') {
			// Commit arrivati dopo l'apertura del dialogo: si richiede la conferma col conto giusto.
			deleteConfirmTarget = { ...target, loss: outcome.loss };
			return;
		}
		if (outcome.kind === 'processes-active') {
			processBlock = {
				laneId: target.laneId,
				title: target.title,
				processes: outcome.processes,
				discardUnintegrated
			};
			return;
		}
		if (outcome.kind === 'failed') {
			cleanupPending = { ...cleanupPending, [target.laneId]: outcome.message };
			return;
		}
		const { [target.laneId]: _removed, ...rest } = cleanupPending;
		cleanupPending = rest;
	}

	async function confirmStopProcesses() {
		const pending = processBlock;
		processBlock = null;
		if (!pending) return;

		const outcome = await deleteWorktreeLane(project.id as ProjectId, pending.laneId, {
			stopProcesses: true,
			discardUnintegrated: pending.discardUnintegrated
		});
		if (outcome.kind === 'unintegrated') {
			deleteConfirmTarget = { laneId: pending.laneId, title: pending.title, loss: outcome.loss };
			return;
		}
		if (outcome.kind === 'failed') {
			cleanupPending = { ...cleanupPending, [pending.laneId]: outcome.message };
			return;
		}
		const { [pending.laneId]: _removed, ...rest } = cleanupPending;
		cleanupPending = rest;
	}

	function startRename(targetLaneId: string, currentTitle: string) {
		renamingLaneId = targetLaneId;
		renameDraft = currentTitle;
		setTimeout(() => {
			if (renameInputEl) {
				renameInputEl.focus();
				renameInputEl.select();
			}
		}, 10);
	}

	function cancelRename() {
		renamingLaneId = null;
		renameDraft = '';
	}

	async function commitRename(targetLaneId: string) {
		if (renamingLaneId !== targetLaneId) return;
		const next = renameDraft.trim();
		renamingLaneId = null;
		renameDraft = '';
		if (!next) return;
		try {
			await renameLane(project.id as ProjectId, targetLaneId as LaneId, next);
		} catch (err) {
			console.error('Rinomina corsia fallita:', err);
		}
	}

	function handleTabContextMenu(event: MouseEvent, lane: AgentLane | LaneRecord) {
		event.preventDefault();
		event.stopPropagation();

		const items: ContextMenuEntry[] = [];

		items.push({
			kind: 'item',
			label: m.lanestrip_action_rename(),
			icon: IconRename,
			run: () => {
				startRename(lane.laneId, lane.title);
			}
		});

		if (lane.kind === 'lab') {
			items.push({
				kind: 'item',
				label: m.lanestrip_action_close(),
				icon: IconClose,
				run: () => {
					void handleCloseLane(lane.laneId);
				}
			});
			const prototypeId = lane.labPrototypeId;
			if (prototypeId) {
				items.push({ kind: 'separator' });
				items.push({
					kind: 'item',
					label: m.lanestrip_action_delete_prototype(),
					icon: IconTrash,
					danger: true,
					run: () => {
						requestDeletePrototype(lane.laneId, lane.title, prototypeId);
					}
				});
			}
		} else {
			items.push({
				kind: 'item',
				label: m.lanestrip_action_integrate_main(),
				icon: IconDiff,
				run: () => {
					onReviewLane?.(lane);
				}
			});
			items.push({ kind: 'separator' });
			items.push({
				kind: 'item',
				label: m.lanestrip_action_delete_worktree(),
				icon: IconTrash,
				danger: true,
				run: () => {
					void requestDeleteWorktree(lane.laneId, lane.title, lane.branch ?? undefined);
				}
			});
		}

		contextMenu.open(event, {
			label: lane.title,
			items,
			invoker: event.currentTarget as HTMLElement
		});
	}

	async function handleOpenNewMenu(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		const items = await projectLaneActions(project, {
			onCreateWorktree: () => void handleCreateNewLane(),
			onRequestDelete: (entry) => {
				if (entry.kind === 'lab') {
					requestDeletePrototype(entry.laneId, entry.title, entry.prototypeId);
				} else {
					void requestDeleteWorktree(entry.laneId, entry.title);
				}
			},
			onProfileReview: (review) => {
				profileReview = review as ProjectProfileReview;
			}
		});
		contextMenu.open(event, {
			label: m.lanestrip_tab_new(),
			items,
			invoker: event.currentTarget as HTMLElement
		});
	}

	async function handleCreateNewLane() {
		if (isCreating) return;
		const lanes = laneOrchestrator.laneDispatchSnapshots(project);
		if (shouldWarnConcurrency(activeLanes(lanes).length)) {
			concurrencyWarning = buildConcurrencyWarning(lanes);
			return;
		}
		await prepareAndCreateLane();
	}

	async function prepareAndCreateLane() {
		concurrencyWarning = null;
		try {
			const review = await reviewProjectProfile(project);
			if (review?.needsConsent) {
				profileReview = review;
				return;
			}
		} catch (error) {
			console.error('Analisi del profilo di progetto fallita:', error);
		}
		await createLane();
	}

	async function confirmProfile(accepted: string[]) {
		const review = profileReview;
		profileReview = null;
		if (review) {
			try {
				await recordAllowlistDecision(project, {
					accepted,
					reviewed: review.pendingCandidates.map((candidate) => candidate.relativePath)
				});
			} catch (error) {
				console.error('Registrazione del consenso sui file locali fallita:', error);
			}
		}
		await createLane();
	}

	async function createLane() {
		concurrencyWarning = null;
		isCreating = true;
		try {
			const record = await laneOrchestrator.createNewLane(project);
			rovingLaneId = record.laneId;
		} catch (error) {
			console.error('Creazione corsia fallita:', error);
		} finally {
			isCreating = false;
		}
	}

	function handleTablistKeydown(event: KeyboardEvent) {
		if (!tablistEl) return;
		const tabs = Array.from(tablistEl.querySelectorAll<HTMLButtonElement>('button[role="tab"]'));
		if (tabs.length === 0) return;

		const currentIndex = tabs.findIndex((el) => el.getAttribute('data-lane-id') === rovingLaneId);
		let nextIndex = currentIndex;

		if (event.key === 'ArrowRight') {
			event.preventDefault();
			nextIndex = (currentIndex + 1) % tabs.length;
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
		} else if (event.key === 'Home') {
			event.preventDefault();
			nextIndex = 0;
		} else if (event.key === 'End') {
			event.preventDefault();
			nextIndex = tabs.length - 1;
		} else {
			return;
		}

		const targetTab = tabs[nextIndex];
		if (targetTab) {
			const nextLaneId = targetTab.getAttribute('data-lane-id');
			if (nextLaneId) {
				rovingLaneId = nextLaneId;
				targetTab.focus();
			}
		}
	}
</script>

<nav class="lane-strip" aria-label={m.lanestrip_title()}>
	{#if canScrollLeft}
		<button
			type="button"
			class="lane-scroll-btn left"
			onclick={() => scrollTabs(-140)}
			aria-label={m.lanestrip_scroll_left()}
		>
			<IconChevronLeft />
		</button>
	{/if}

	<div
		bind:this={tablistTrackEl}
		class="lane-tablist-track"
		class:fade-left={canScrollLeft}
		class:fade-right={canScrollRight}
		onscroll={updateScrollState}
	>
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			bind:this={tablistEl}
			class="lane-tablist"
			role="tablist"
			aria-orientation="horizontal"
			aria-label={m.lanestrip_title()}
			onkeydown={handleTablistKeydown}
		>
			<!-- Tab Principale fissa -->
			<div
				class="lane-tab-item"
				class:selected={activeLaneId === MAIN_LANE_ID}
				class:attention={mainDisplayState === 'attention' || mainDisplayState === 'conflict'}
				class:finished={activeLaneId !== MAIN_LANE_ID && (mainDisplayState === 'finished' || mainDisplayState === 'review_ready')}
			>
				<button
					type="button"
					role="tab"
					class="lane-tab"
					class:selected={activeLaneId === MAIN_LANE_ID}
					aria-selected={activeLaneId === MAIN_LANE_ID}
					tabindex={rovingLaneId === MAIN_LANE_ID ? 0 : -1}
					data-lane-id={MAIN_LANE_ID}
					onclick={() => selectLane(MAIN_LANE_ID)}
				>
					<span class="lane-title">{m.lanestrip_tab_main()}</span>
				</button>
			</div>

			<!-- Corsie secondarie -->
			{#each secondaryLanes as lane (lane.laneId)}
				{@const laneState = classifyLaneState(lane)}
				{@const isSelected = activeLaneId === lane.laneId}
				{@const pendingCleanup =
					cleanupPending[lane.laneId] ??
					(lane.recoveryState === 'cleanup_pending' ? m.lanestrip_cleanup_pending() : null)}
				{@const isLab = lane.kind === 'lab'}
				<div
					class="lane-tab-item"
					class:selected={isSelected}
					class:attention={laneState === 'attention' || laneState === 'conflict'}
					class:finished={!isSelected && (laneState === 'finished' || laneState === 'review_ready')}
				>
					<button
						type="button"
						role="tab"
						class="lane-tab"
						class:selected={isSelected}
						aria-selected={isSelected}
						tabindex={rovingLaneId === lane.laneId ? 0 : -1}
						data-lane-id={lane.laneId}
						onclick={() => selectLane(lane.laneId)}
						ondblclick={() => startRename(lane.laneId, lane.title)}
						oncontextmenu={(e) => handleTabContextMenu(e, lane)}
					>
						<span class="lane-type-icon" aria-hidden="true">
							{#if isLab}
								<IconLab />
							{:else}
								<IconGitBranch />
							{/if}
						</span>

						{#if renamingLaneId === lane.laneId}
							<input
								bind:this={renameInputEl}
								type="text"
								class="lane-rename-input"
								bind:value={renameDraft}
								maxlength={LANE_TITLE_MAX}
								onkeydown={(e) => {
									// Le frecce e Home/End servono al cursore del testo, non alla
									// navigazione fra le tab gestita dal tablist; lo spazio non deve
									// attivare il pulsante della tab che contiene il campo.
									e.stopPropagation();
									if (e.key === 'Enter') {
										e.preventDefault();
										void commitRename(lane.laneId);
									} else if (e.key === 'Escape') {
										e.preventDefault();
										cancelRename();
									}
								}}
								onblur={() => void commitRename(lane.laneId)}
								onclick={(e) => e.stopPropagation()}
							/>
						{:else}
							<span class="lane-title">{lane.title}</span>
						{/if}

						{#if pendingCleanup}
							<span class="lane-cleanup-warn" title={pendingCleanup} role="img" aria-label={pendingCleanup}>
								<IconWarning />
							</span>
						{/if}
					</button>

					<!-- Pronta per la revisione: l'azione resta nel flusso con l'etichetta,
					     perche' e' la cosa da fare adesso e non deve dipendere dall'hover. -->
					{#if !isLab && laneState === 'review_ready'}
						<button
							type="button"
							class="lane-action-btn lane-integrate-btn ready"
							title={m.lanestrip_action_integrate()}
							aria-label={m.lanestrip_action_integrate()}
							onclick={(e) => {
								e.stopPropagation();
								onReviewLane?.(lane);
							}}
						>
							<IconDiff />
							<span class="action-label">{m.lanestrip_action_integrate()}</span>
						</button>
					{/if}
					<div class="lane-tab-actions">
						<div class="lane-tab-actions-inner">
							{#if !isLab && laneState !== 'review_ready'}
								<button
									type="button"
									class="lane-action-btn lane-integrate-btn"
									title={m.lanestrip_action_integrate()}
									aria-label={m.lanestrip_action_integrate()}
									onclick={(e) => {
										e.stopPropagation();
										onReviewLane?.(lane);
									}}
								>
									<IconDiff />
								</button>
							{/if}
							<button
								type="button"
								class="lane-action-btn lane-close-btn"
								title={m.lanestrip_action_close()}
								aria-label={m.lanestrip_action_close()}
								onclick={(e) => {
									e.stopPropagation();
									void handleCloseLane(lane.laneId);
								}}
							>
								<IconClose />
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>

	{#if canScrollRight}
		<button
			type="button"
			class="lane-scroll-btn right"
			onclick={() => scrollTabs(140)}
			aria-label={m.lanestrip_scroll_right()}
		>
			<IconChevronRight />
		</button>
	{/if}

	<!-- Pulsante + icon-only senza freccia ne' testo -->
	<button
		type="button"
		class="lane-new-btn"
		title={m.lanestrip_tab_new()}
		aria-label={m.lanestrip_tab_new()}
		onclick={handleOpenNewMenu}
		disabled={isCreating}
	>
		<IconPlus />
	</button>
</nav>

<!-- Dialogo conferma eliminazione definitiva worktree -->
<Dialog
	open={Boolean(deleteConfirmTarget)}
	onClose={() => (deleteConfirmTarget = null)}
	title={deleteConfirmTarget?.prototypeId
		? m.lab_delete_dialog_title()
		: m.lanestrip_delete_dialog_title()}
	ariaDescribedBy="lane-delete-desc"
>
	{#snippet body()}
		{#if deleteConfirmTarget}
			<p id="lane-delete-desc" class="lane-dialog-desc">
				{deleteConfirmTarget.prototypeId
					? m.lab_delete_dialog_message({ name: deleteConfirmTarget.title })
					: m.lanestrip_delete_dialog_message({ name: deleteConfirmTarget.title })}
			</p>
			{#if !deleteConfirmTarget.prototypeId && deleteConfirmTarget.loss}
				<p class="lane-dialog-desc lane-dialog-loss" role="alert">
					<IconWarning />
					<span>
						{unintegratedWarning(deleteConfirmTarget.loss)}
					</span>
				</p>
			{/if}
		{/if}
	{/snippet}
	{#snippet footer()}
		<button
			type="button"
			class="ui-button ui-button-secondary"
			onclick={() => (deleteConfirmTarget = null)}
		>
			{m.lanestrip_delete_dialog_cancel()}
		</button>
		<button
			type="button"
			class="ui-button ui-button-danger"
			onclick={() => void executeDelete()}
		>
			{m.lanestrip_delete_dialog_confirm()}
		</button>
	{/snippet}
</Dialog>

<LaneDispatchDialog
	open={concurrencyWarning !== null}
	mode="concurrency"
	warning={concurrencyWarning}
	onConfirm={() => void prepareAndCreateLane()}
	onCancel={() => (concurrencyWarning = null)}
/>

<LaneDispatchDialog
	open={processBlock !== null}
	mode="processes"
	laneTitle={processBlock?.title ?? ''}
	processes={processBlock?.processes ?? []}
	onConfirm={() => void confirmStopProcesses()}
	onCancel={() => (processBlock = null)}
/>

<LaneProfileDialog
	open={profileReview !== null}
	detection={profileReview?.detection ?? null}
	candidates={profileReview?.pendingCandidates ?? []}
	onConfirm={(accepted) => void confirmProfile(accepted)}
	onCancel={() => (profileReview = null)}
/>

<style>
	.lane-strip {
		display: flex;
		align-items: center;
		height: 34px;
		background-color: var(--bg-base);
		border-bottom: 1px solid var(--line);
		padding: 0 var(--space-2);
		user-select: none;
		z-index: calc(var(--z-topbar) - 1);
		flex-shrink: 0;
		position: relative;
		gap: 2px;
	}

	.lane-scroll-btn {
		height: 24px;
		width: 18px;
		border: 1px solid var(--line);
		background: var(--bg-raised);
		color: var(--ink-muted);
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		font-size: var(--text-xs);
		line-height: 1;
		flex-shrink: 0;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
		z-index: 3;
		padding: 0;
	}

	.lane-scroll-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.lane-scroll-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.lane-tablist-track {
		display: flex;
		align-items: center;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
		-ms-overflow-style: none;
		min-width: 0;
		flex: 1 1 auto;
		scroll-behavior: smooth;
	}

	.lane-tablist-track::-webkit-scrollbar {
		display: none;
	}

	.lane-tablist {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.lane-tab-item {
		display: inline-flex;
		align-items: center;
		height: 26px;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		background-color: transparent;
		color: var(--ink-muted);
		transition: background-color var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
		position: relative;
	}

	.lane-tab-item:hover:not(.selected) {
		background-color: var(--bg-hover);
		color: var(--ink);
	}

	.lane-tab-item.selected {
		background-color: var(--bg-raised);
		color: var(--ink);
		border-color: var(--line-strong);
		font-weight: 500;
	}

	/* Anelli di stato: mutuati da TopBar */
	.lane-tab-item.attention::after,
	.lane-tab-item.finished::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		pointer-events: none;
		z-index: 2;
	}

	.lane-tab-item.attention::after {
		box-shadow: inset 0 0 0 1.5px var(--warn);
		animation: breathing-amber-ring var(--dur-breathing, 1.9s) var(--ease-breathing, cubic-bezier(0.4, 0, 0.2, 1)) infinite;
		will-change: opacity;
	}

	.lane-tab-item.finished::after {
		box-shadow: inset 0 0 0 1.5px var(--line-strong);
	}

	@media (prefers-reduced-motion: reduce) {
		.lane-tab-item.attention::after {
			animation: none;
			opacity: 1;
			box-shadow: inset 0 0 0 1.5px var(--warn);
		}
	}

	:global(:root[data-animations="false"]) .lane-tab-item.attention::after {
		animation: none;
		opacity: 1;
		box-shadow: inset 0 0 0 1.5px var(--warn);
	}

	.lane-tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 100%;
		padding: 0 var(--space-2);
		border: none;
		border-radius: inherit;
		background: transparent;
		color: inherit;
		font-family: inherit;
		font-size: var(--text-caption);
		cursor: pointer;
		white-space: nowrap;
		outline: none;
	}

	.lane-tab:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.lane-type-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.lane-type-icon :global(svg) {
		width: 13px;
		height: 13px;
	}

	.lane-tab-item.selected .lane-type-icon {
		color: var(--brand-ink);
	}

	.lane-title {
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lane-rename-input {
		width: 120px;
		height: 18px;
		padding: 0 4px;
		font-size: 11px;
		font-family: inherit;
		background: var(--bg-overlay);
		color: var(--ink);
		border: 1px solid var(--brand);
		border-radius: var(--radius-sm);
		outline: none;
		box-sizing: border-box;
	}

	.lane-cleanup-warn {
		display: inline-flex;
		align-items: center;
		color: var(--warn);
		flex-shrink: 0;
	}

	.lane-cleanup-warn :global(svg) {
		width: 12px;
		height: 12px;
	}

	/* Azioni della tab: si aprono in colonna sull'hover o sulla tab
	   selezionata, con lo stesso `0fr -> 1fr` della rivelazione nella barra
	   progetti. Nascoste non occupano spazio (a riposo la tab e' larga quanto
	   il nome) e non si sovrappongono al titolo, che resta leggibile anche con
	   gli sfondi traslucidi di hover. */
	.lane-tab-actions {
		display: grid;
		grid-template-columns: 0fr;
		transition: grid-template-columns var(--dur-fast) var(--ease-out, ease);
	}

	.lane-tab-actions-inner {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
		overflow: hidden;
		opacity: 0;
		transition: opacity var(--dur-fast);
	}

	.lane-tab-item:hover .lane-tab-actions,
	.lane-tab-item:focus-within .lane-tab-actions,
	.lane-tab-item.selected .lane-tab-actions {
		grid-template-columns: 1fr;
	}

	.lane-tab-item:hover .lane-tab-actions-inner,
	.lane-tab-item:focus-within .lane-tab-actions-inner,
	.lane-tab-item.selected .lane-tab-actions-inner {
		opacity: 1;
		padding-right: 4px;
	}

	.lane-action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		padding: 0 3px;
		height: 18px;
		border-radius: var(--radius-sm);
		font-size: var(--text-caption);
		font-family: inherit;
		transition: background-color var(--dur-fast), color var(--dur-fast);
	}

	.lane-action-btn:hover {
		color: var(--ink);
		background-color: var(--bg-hover);
	}

	.lane-action-btn.lane-integrate-btn {
		gap: 3px;
	}

	.lane-action-btn.lane-integrate-btn.ready {
		margin-right: 4px;
		color: var(--brand-ink);
		background-color: color-mix(in srgb, var(--brand) 12%, transparent);
	}

	.lane-action-btn.lane-close-btn:hover {
		color: var(--danger);
		background-color: color-mix(in srgb, var(--danger) 15%, transparent);
	}

	.lane-action-btn :global(svg) {
		width: 11px;
		height: 11px;
	}

	.action-label {
		font-size: var(--text-caption);
		white-space: nowrap;
	}

	/* Pulsante + compatto (icon-only) */
	.lane-new-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border-radius: var(--radius-md);
		border: 1px dashed var(--line);
		background: transparent;
		color: var(--ink-muted);
		cursor: pointer;
		transition: border-color var(--dur-fast), color var(--dur-fast), background-color var(--dur-fast);
		flex-shrink: 0;
	}

	.lane-new-btn:hover:not(:disabled) {
		border-color: var(--line-strong);
		color: var(--ink);
		background-color: var(--bg-hover);
	}

	.lane-new-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.lane-new-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.lane-new-btn :global(svg) {
		width: 13px;
		height: 13px;
	}

	.lane-dialog-desc {
		margin: 0;
		font-size: var(--text-body);
		color: var(--ink-muted);
		line-height: 1.45;
	}
	.lane-dialog-loss {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin-top: var(--space-2);
		color: var(--danger);
		--icon-size: 14px;
	}
	.lane-dialog-loss :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.lane-tab-item,
		.lane-tab,
		.lane-action-btn,
		.lane-new-btn,
		.lane-scroll-btn {
			transition: none !important;
			animation: none !important;
		}
	}
</style>
