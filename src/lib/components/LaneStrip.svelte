<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { projectStore, type Project } from '$lib/stores/projects.svelte';
	import { laneStore, type LaneRecord } from '$lib/stores/lanes.svelte';
	import { laneOrchestrator } from '$lib/lanes/laneOrchestrator.svelte';
	import {
		MAIN_LANE_ID,
		type LaneId,
		type ProjectId,
		type AgentLane,
		createMainLane
	} from '$lib/types/lanes';
	import {
		IconStatusRunning,
		IconStatusPending,
		IconCheck,
		IconWarning,
		IconClose,
		IconPlus,
		IconRefresh,
		IconDiff,
		IconLab,
		IconChevronDown
	} from '$lib/icons';
	import { contextMenu } from '$lib/contextMenu.svelte';
	import { projectLaneActions, closeLabLane } from '$lib/lanes/laneActions';
	import {
		activeLanes,
		buildConcurrencyWarning,
		shouldWarnConcurrency,
		type ConcurrencyWarning
	} from '$lib/lanes/queueDispatch';
	import LaneDispatchDialog from './LaneDispatchDialog.svelte';
	import LaneProfileDialog from './LaneProfileDialog.svelte';
	import {
		recordAllowlistDecision,
		reviewProjectProfile,
		type ProjectProfileReview
	} from '$lib/lanes/laneProfile';
	import {
		indexLaneProcesses,
		laneProcessKey,
		listLaneProcesses,
		type LaneProcessInfo
	} from '$lib/lanes/processSupervisor';

	let {
		project,
		onReviewLane
	}: {
		project: Project;
		onReviewLane?: (lane: AgentLane | LaneRecord) => void;
	} = $props();

	let tablistEl = $state<HTMLElement | null>(null);
	let isCreating = $state(false);
	/** Riepilogo del soft-cap in attesa di conferma, se la corsia sarebbe la terza. */
	let concurrencyWarning = $state<ConcurrencyWarning | null>(null);
	/** Profilo tecnico in attesa del consenso una tantum sui file locali (W10). */
	let profileReview = $state<ProjectProfileReview | null>(null);
	/** Processi runtime vivi, per l'indicatore discreto sulle tab (W11). */
	let laneProcesses = $state<LaneProcessInfo[]>([]);
	/** Corsia il cui cleanup e' bloccato da processi ancora vivi. */
	let processBlock = $state<{ laneId: LaneId; title: string; processes: LaneProcessInfo[] } | null>(
		null
	);
	/** Ultimo cleanup fallito per lock o rifiuto di Git, per corsia. */
	let cleanupPending = $state<Record<string, string>>({});

	const projectLanes = $derived(laneStore.lanesFor(project.id as ProjectId));
	const secondaryLanes = $derived(
		projectLanes.filter((l) => l.laneId !== MAIN_LANE_ID && l.status !== 'archived')
	);
	const activeLaneId = $derived(project.lane.laneId);

	let rovingLaneId = $state<string>(MAIN_LANE_ID);

	$effect(() => {
		rovingLaneId = activeLaneId;
	});
	const processIndex = $derived(indexLaneProcesses(laneProcesses));

	function runtimeProcesses(targetLaneId: string): LaneProcessInfo[] {
		return processIndex.get(laneProcessKey(project.id, targetLaneId)) ?? [];
	}

	// Il registro vive nel backend: qui si campiona, senza mai duplicarne lo
	// stato. L'intervallo e' l'unico costo dell'indicatore.
	$effect(() => {
		let cancelled = false;
		const sample = async () => {
			try {
				const list = await listLaneProcesses();
				if (!cancelled) laneProcesses = list;
			} catch (error) {
				console.error('Lettura dei processi di corsia fallita:', error);
			}
		};
		void sample();
		const timer = setInterval(() => void sample(), 4000);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	});

	interface DisplayState {
		kind: 'working' | 'attention' | 'conflict' | 'review_ready' | 'integrating' | 'finished' | 'idle';
		label: string;
	}

	function resolveLaneDisplayState(lane: AgentLane | LaneRecord): DisplayState {
		// Stessa lettura della barra di stato e del routing della coda: un badge
		// che dice "In attesa" mentre la coda vede la corsia occupata e' un bug.
		const state = laneOrchestrator.laneAgentState(project, lane.laneId);

		if (lane.status === 'conflict') {
			return { kind: 'conflict', label: m.lanestrip_status_conflict() };
		}
		if (state === 'attention') {
			return { kind: 'attention', label: m.lanestrip_status_attention() };
		}
		if (lane.status === 'review_ready') {
			return { kind: 'review_ready', label: m.lanestrip_status_review_ready() };
		}
		if (lane.status === 'integrating') {
			return { kind: 'integrating', label: m.lanestrip_status_integrating() };
		}
		if (state === 'working') {
			return { kind: 'working', label: m.lanestrip_status_working() };
		}
		if (state === 'finished') {
			return { kind: 'finished', label: m.lanestrip_status_finished() };
		}
		return { kind: 'idle', label: m.lanestrip_status_idle() };
	}

	const mainRecord = $derived(
		projectLanes.find((l) => l.laneId === MAIN_LANE_ID) ?? project.lane
	);
	const mainDisplayState = $derived(resolveLaneDisplayState(mainRecord));

	function selectLane(targetLaneId: LaneId) {
		if (project.lane.laneId === targetLaneId) return;
		rovingLaneId = targetLaneId;
		void laneOrchestrator.switchLane(project.id as ProjectId, targetLaneId);
	}

	/**
	 * Archiviazione con cleanup del worktree. Con processi vivi non archivia
	 * nulla: apre la conferma "Arresta processi e rimuovi" (PLAN W11). Se il
	 * cleanup fallisce per un lock la corsia resta visibile e riprovabile.
	 */
	async function archiveLane(targetLaneId: LaneId, stopProcesses = false) {
		const lane = projectLanes.find((l) => l.laneId === targetLaneId);
		const outcome = await laneOrchestrator.archiveLane(
			project.id as ProjectId,
			targetLaneId,
			'integrated',
			{ stopProcesses }
		);
		if (outcome.kind === 'processes-active') {
			processBlock = {
				laneId: targetLaneId,
				title: lane?.title ?? targetLaneId,
				processes: outcome.processes
			};
			return;
		}
		processBlock = null;
		if (outcome.kind === 'cleanup-pending') {
			cleanupPending = { ...cleanupPending, [targetLaneId]: outcome.diagnosis.message };
			return;
		}
		const { [targetLaneId]: _removed, ...rest } = cleanupPending;
		cleanupPending = rest;
		laneProcesses = await listLaneProcesses().catch(() => laneProcesses);
	}

	async function confirmStopProcesses() {
		const pending = processBlock;
		processBlock = null;
		if (pending) await archiveLane(pending.laneId, true);
	}

	/**
	 * Creazione manuale. Dal terzo agente simultaneo (Gate R27 W09) la corsia
	 * nasce solo dopo una conferma esplicita che mostra modelli, provider e
	 * processi gia' impegnati.
	 */
	async function handleOpenNewMenu(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		const items = await projectLaneActions(project, {
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

	/**
	 * Prima di creare il worktree Studio analizza lo stack del progetto: se
	 * trova file locali non versionati mai esaminati, chiede il consenso una
	 * tantum. Senza candidati nuovi la corsia parte subito.
	 */
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
			class:attention={mainDisplayState.kind === 'attention'}
			class:working={mainDisplayState.kind === 'working'}
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
				<span class="lane-dot" aria-hidden="true"></span>
				<span class="lane-title">{m.lanestrip_tab_main()}</span>
				<span class="lane-status-badge status-{mainDisplayState.kind}">
					{#if mainDisplayState.kind === 'working'}
						<IconStatusRunning />
					{:else if mainDisplayState.kind === 'attention'}
						<IconWarning />
					{:else if mainDisplayState.kind === 'finished'}
						<IconCheck />
					{:else}
						<IconStatusPending />
					{/if}
					<span>{mainDisplayState.label}</span>
				</span>
				{#if runtimeProcesses(MAIN_LANE_ID).length > 0}
					<span
						class="lane-proc-dot"
						title={m.lanestrip_processes_title({ count: runtimeProcesses(MAIN_LANE_ID).length })}
					>
						<span class="visually-hidden">{m.lanestrip_processes_badge()}</span>
					</span>
				{/if}
			</button>
		</div>

		<!-- Corsie secondarie -->
		{#each secondaryLanes as lane (lane.laneId)}
			{@const display = resolveLaneDisplayState(lane)}
			{@const isSelected = activeLaneId === lane.laneId}
			{@const runtime = runtimeProcesses(lane.laneId)}
			{@const pendingCleanup =
				cleanupPending[lane.laneId] ??
				(lane.recoveryState === 'cleanup_pending' ? m.lanestrip_cleanup_pending() : null)}
			{@const isLab = lane.kind === 'lab'}
			<div
				class="lane-tab-item"
				class:selected={isSelected}
				class:attention={display.kind === 'attention' || display.kind === 'conflict'}
				class:working={display.kind === 'working'}
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
				>
					{#if isLab}
						<span class="lane-lab-icon" aria-hidden="true"><IconLab /></span>
						<span class="lane-title">{lane.title}</span>
					{:else}
						<span class="lane-title" title={pendingCleanup ?? lane.title}>{lane.title}</span>
						<span class="lane-status-badge status-{display.kind}">
							{#if display.kind === 'working'}
								<IconStatusRunning />
							{:else if display.kind === 'attention' || display.kind === 'conflict'}
								<IconWarning />
							{:else if display.kind === 'review_ready' || display.kind === 'finished'}
								<IconCheck />
							{:else if display.kind === 'integrating'}
								<IconRefresh />
							{:else}
								<IconStatusPending />
							{/if}
							<span>{display.label}</span>
						</span>
					{/if}
					{#if runtime.length > 0}
						<span class="lane-proc-dot" title={m.lanestrip_processes_title({ count: runtime.length })}>
							<span class="visually-hidden">{m.lanestrip_processes_badge()}</span>
						</span>
					{/if}
					{#if pendingCleanup}
						<span class="lane-cleanup-warn" title={m.lanestrip_cleanup_pending()}>
							<IconWarning />
						</span>
					{/if}
				</button>
				{#if !isLab}
					<button
						type="button"
						class="lane-review-btn"
						class:review-ready={display.kind === 'review_ready'}
						title={m.lanestrip_review_title()}
						aria-label={m.lanestrip_review_title()}
						onclick={(e) => {
							e.stopPropagation();
							onReviewLane?.(lane);
						}}
					>
						<IconDiff />
						{#if display.kind === 'review_ready'}
							<span class="review-label">{m.lanestrip_review_action()}</span>
						{/if}
					</button>
				{/if}
				<button
					type="button"
					class="lane-archive-btn"
					title={isLab ? m.lab_lane_close_action() : m.lanestrip_archive_aria({ title: lane.title })}
					aria-label={isLab ? m.lab_lane_close_action() : m.lanestrip_archive_aria({ title: lane.title })}
					onclick={() => void (isLab ? closeLabLane(project.id, lane.laneId) : archiveLane(lane.laneId))}
				>
					<IconClose />
				</button>
			</div>
		{/each}

		<!-- Pulsante + ▾ Nuova corsia -->
		<button
			type="button"
			class="lane-new-btn"
			title={m.lanestrip_tab_new_title()}
			aria-label={m.lanestrip_tab_new()}
			onclick={handleOpenNewMenu}
			disabled={isCreating}
		>
			<IconPlus />
			<IconChevronDown />
			<span>{m.lanestrip_tab_new()}</span>
		</button>
	</div>
</nav>

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
		padding: 0 var(--space-3);
		user-select: none;
		z-index: calc(var(--z-topbar) - 1);
		flex-shrink: 0;
	}

	.lane-tablist {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		overflow-x: auto;
		flex: 1;
		scrollbar-width: none;
	}

	.lane-tablist::-webkit-scrollbar {
		display: none;
	}

	.lane-tab-item {
		display: inline-flex;
		align-items: center;
		height: 26px;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		background-color: transparent;
		color: var(--ink-muted);
		transition: all 120ms ease;
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
		font-weight: 600;
	}

	.lane-tab-item.attention {
		border-color: var(--warn);
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
		font-size: 11px;
		cursor: pointer;
		white-space: nowrap;
		outline: none;
	}

	.lane-tab:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -1px;
	}

	.lane-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: var(--ink-faint);
		flex-shrink: 0;
	}

	.lane-tab.selected .lane-dot {
		background-color: var(--brand);
	}

	/* Indicatore discreto dei processi runtime: un punto, nessun testo che
	   allarghi la tab e nessuna animazione che rubi attenzione. */
	.lane-proc-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		flex-shrink: 0;
		background-color: var(--success);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--success) 22%, transparent);
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

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}

	.lane-title {
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lane-status-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 10px;
		font-weight: 600;
		padding: 1px 5px;
		border-radius: 3px;
		line-height: 1;
		flex-shrink: 0;
	}

	.lane-status-badge :global(svg) {
		width: 10px;
		height: 10px;
		flex-shrink: 0;
	}

	.status-working {
		color: var(--brand-ink);
		background-color: color-mix(in srgb, var(--brand) 12%, transparent);
	}

	.status-attention {
		color: var(--warn);
		background-color: color-mix(in srgb, var(--warn) 15%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
	}

	.status-conflict {
		color: var(--danger);
		background-color: color-mix(in srgb, var(--danger) 15%, transparent);
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
	}

	.status-review_ready {
		color: var(--success);
		background-color: color-mix(in srgb, var(--success) 15%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
	}

	.status-integrating {
		color: var(--brand-ink);
		background-color: color-mix(in srgb, var(--brand) 15%, transparent);
	}

	.status-finished {
		color: var(--success);
		background-color: color-mix(in srgb, var(--success) 12%, transparent);
	}

	.status-idle {
		color: var(--ink-faint);
		background-color: transparent;
	}

	.lane-archive-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		padding: 0;
		border: none;
		border-radius: 2px;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		opacity: 0.6;
		transition: all 120ms ease;
		margin-right: 4px;
	}
	.lane-review-btn {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: 20px;
		padding: 0 5px;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		font-size: 11px;
		font-family: var(--font-ui);
		transition: color var(--dur-fast), background var(--dur-fast), border-color var(--dur-fast);
	}

	.lane-review-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.lane-review-btn.review-ready {
		color: var(--success);
		background: color-mix(in srgb, var(--success) 12%, transparent);
		border-color: color-mix(in srgb, var(--success) 25%, transparent);
		font-weight: 500;
	}

	.lane-review-btn.review-ready:hover {
		background: color-mix(in srgb, var(--success) 20%, transparent);
	}

	.review-label {
		font-size: 10px;
		white-space: nowrap;
	}

	.lane-archive-btn:hover {
		opacity: 1;
		color: var(--danger);
		background-color: color-mix(in srgb, var(--danger) 15%, transparent);
	}

	.lane-archive-btn:focus-visible {
		outline: 1.5px solid var(--brand);
		opacity: 1;
	}

	.lane-archive-btn :global(svg) {
		width: 12px;
		height: 12px;
	}

	.lane-new-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 24px;
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
		border: 1px dashed var(--line);
		background: transparent;
		color: var(--ink-faint);
		font-family: inherit;
		font-size: 11px;
		cursor: pointer;
		transition: all 120ms ease;
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
		outline-offset: -1px;
	}

	.lane-new-btn :global(svg) {
		width: 12px;
		height: 12px;
	}

	.lane-lab-icon {
		display: inline-flex;
		align-items: center;
		color: var(--brand);
		flex-shrink: 0;
	}
	.lane-lab-icon :global(svg) {
		width: 12px;
		height: 12px;
	}


	@media (prefers-reduced-motion: reduce) {
		.lane-tab-item,
		.lane-tab,
		.lane-archive-btn,
		.lane-new-btn {
			transition: none !important;
			animation: none !important;
		}
	}
</style>
