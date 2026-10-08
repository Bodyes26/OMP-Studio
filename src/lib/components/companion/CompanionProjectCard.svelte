<script lang="ts">
	// Una card per progetto: un solo posto dove guardare.
	//
	// L'intestazione risponde alle due domande di sempre ("c'e' un agente?",
	// "mi sta chiamando?") ed e' cliccabile: porta la finestra principale in
	// primo piano su quel progetto. Serviva perche' un agente che ha finito e
	// uno in attesa di un compito erano indistinguibili da qui, e nel primo
	// caso quello che vuoi e' leggere il risultato, non far partire altro.
	//
	// Il corpo dipende dallo stato e non si sovrappone: la domanda quando c'e',
	// altrimenti la riga di attivita' mentre lavora, altrimenti l'estratto di
	// cio' che ha detto e la coda pronta a partire. Il passaggio da un corpo
	// all'altro si piega in altezza (la finestra a scomparsa lo segue).
	//
	// Il colore d'identita' resta nel punto del progetto; lo stato operativo e'
	// neutro e condiviso (StatusMark, D1).
	import { m } from '$lib/paraglide/messages.js';
	import { computeQuotaInfo } from '$lib/quota/projectQuota';
	import QuotaChip from '$lib/components/quota/QuotaChip.svelte';
	import StatusMark, { type StatusMarkType } from '$lib/ui/StatusMark.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { trayFold } from '$lib/agent/motion';
	import { ACTIVITY_FRESH_MS, shortAge } from '$lib/stores/companionText';
	import type { Project } from '$lib/stores/projects.svelte';
	import type { AttentionRequest, CompanionProjectRuntime } from '$lib/stores/companion.svelte';
	import type { StudioTask } from '$lib/stores/tasks.svelte';
	import type { CompanionAskHandlers } from './companionAsk';
	import CompanionAskBody from './CompanionAskBody.svelte';
	import CompanionProjectQueue from './CompanionProjectQueue.svelte';
	import MissedScheduleBanner from '../schedule/MissedScheduleBanner.svelte';
	import { IconArrowLeft, IconChevronRight, IconPlus, IconWarning } from '$lib/icons';

	let {
		project,
		hue,
		runtime,
		attention = null,
		attentions = [],
		queued,
		ask,
		onFocusProject,
		onNewTask,
		onRunTask,
		onToggleUsage
	} = $props<{
		project: Project;
		hue: number;
		runtime?: CompanionProjectRuntime;
		attention?: AttentionRequest | null;
		attentions?: AttentionRequest[];
		queued: StudioTask[];
		ask: CompanionAskHandlers;
		onFocusProject: (projectId: string) => void;
		onNewTask: (project: Project) => void;
		onRunTask: (projectId: string, taskId: string) => void;
		onToggleUsage?: () => void;
	}>();

	const allAttentions = $derived.by<AttentionRequest[]>(() => {
		if (attentions && attentions.length > 0) return attentions;
		return attention ? [attention] : [];
	});

	let selectedLaneId = $state<string | null>(null);

	$effect(() => {
		if (selectedLaneId && !allAttentions.some((a) => (a.laneId ?? 'main') === selectedLaneId)) {
			selectedLaneId = null;
		}
	});

	const activeAttention = $derived.by<AttentionRequest | null>(() => {
		if (allAttentions.length === 1) return allAttentions[0];
		if (selectedLaneId) {
			return allAttentions.find((a) => (a.laneId ?? 'main') === selectedLaneId) ?? null;
		}
		return null;
	});

	const hasMultipleAttentions = $derived(allAttentions.length > 1 && !selectedLaneId);
	const asking = $derived(Boolean(activeAttention) || hasMultipleAttentions);

	const name = $derived(project.label?.trim() || project.name);
	const busy = $derived(project.lane.agentState === 'working' || project.lane.agentState === 'attention');

	/**
	 * Estratto di fine turno: solo quando l'agente e' fermo e solo se recente.
	 * Oltre le tre ore il lavoro e' da considerare chiuso, e la card
	 * porterebbe il riassunto di qualcosa che nessuno sta piu' aspettando.
	 */
	const settledExcerpt = $derived.by(() => {
		if (busy) return null;
		const activity = runtime?.activity;
		if (!activity || activity.kind !== 'assistant') return null;
		if (Date.now() - activity.at > ACTIVITY_FRESH_MS) return null;
		return { text: activity.text, age: shortAge(activity.at) };
	});

	const activityText = $derived(runtime?.activity?.text ?? null);

	/**
	 * Heads-up di fine turno (Gate R40): la stessa frase della chat,
	 * sopra l'estratto. Solo ad agente fermo: mentre lavora vale la riga di
	 * attivita', e una domanda aperta ha il suo corpo.
	 */
	const headsUpText = $derived(busy ? null : (runtime?.headsUp ?? null));

	const agentStatus = $derived.by<{ mark: StatusMarkType; label: string }>(() => {
		switch (project.lane.agentState) {
			case 'attention':
				if (attention?.pendingUi.kind === 'quota_blocked') {
					return attention.pendingUi.blockedQuota?.reasonKind === 'quota_exhausted'
						? { mark: 'failed', label: m.companion_state_quota_exhausted() }
						: { mark: 'attention', label: m.companion_state_provider_error() };
				}
				return { mark: 'attention', label: m.ui_companionview_chiede_risposta_de18() };
			case 'working':
				return { mark: 'running', label: m.companion_state_working() };
			case 'finished':
				return { mark: 'completed', label: m.page_agent_state_finished() };
			case 'idle':
				return { mark: 'pending', label: m.companion_state_idle() };
			default:
				return { mark: 'pending', label: m.companion_state_unknown() };
		}
	});

	function laneName(req: AttentionRequest): string {
		return req.laneTitle || (req.laneId === 'main' || !req.laneId ? m.companion_lane_main() : req.laneId);
	}
</script>

<article
	class="project-card"
	class:asking
	class:attention={project.lane.agentState === 'attention'}
	style="--proj-hue: {hue}"
>
	<header class="card-top">
		<!-- Riga superiore: punto identita' + nome progetto + pulsante nuovo task -->
		<div class="card-row-name">
			<Tooltip text={m.companion_card_open_title({ project: name })} placement="top">
				<button type="button" class="card-identity" onclick={() => onFocusProject(project.id)}>
					<span class="p-dot" class:lit={busy}></span>
					<span class="p-name">{name}</span>
				</button>
			</Tooltip>
			<Tooltip text={m.companion_card_new_task_title({ project: name })} placement="top">
				<button
					type="button"
					class="composer-icon-btn"
					aria-label={m.companion_card_new_task_title({ project: name })}
					onclick={() => onNewTask(project)}
				>
					<IconPlus />
				</button>
			</Tooltip>
		</div>

		<!-- Riga inferiore: quota, stato e contatore coda -->
		<div class="card-row-meta">
			{#if queued.length > 0}
				<span class="p-queue-count">
					<span aria-hidden="true">{queued.length}</span>
					<span class="sr-only">{m.companion_queue_count({ count: queued.length })}</span>
				</span>
			{/if}

			{#if busy && runtime?.provider}
				{@const info = computeQuotaInfo(runtime.provider, runtime.modelId, runtime.credentialPin)}
				<QuotaChip
					showProvider={true}
					alwaysShowPct={true}
					semanticColors={true}
					status={info.status}
					remainingPct={info.remainingPct}
					shortName={runtime.modelLabel ?? info.shortName}
					hasLimits={info.hasLimits}
					title={info.tooltip}
					ariaLabel={info.tooltip}
					longWindowAlert={info.longWindowAlert}
					onclick={(e) => {
						e.stopPropagation();
						onToggleUsage?.();
					}}
				/>
			{/if}

			<span class="p-state">
				<StatusMark status={agentStatus.mark} active={project.lane.agentState === 'working'} />
				{agentStatus.label}
			</span>
		</div>
	</header>

	{#if activeAttention}
		<div class="card-body" transition:trayFold>
			{#if allAttentions.length > 1}
				<div class="lane-selection-bar">
					<button type="button" class="ui-button ui-button-ghost back-to-lanes-btn" onclick={() => (selectedLaneId = null)}>
						<IconArrowLeft />
						{m.companion_lanes_back({ count: allAttentions.length })}
					</button>
					<span class="active-lane-chip">{laneName(activeAttention)}</span>
				</div>
			{/if}
			<CompanionAskBody
				req={activeAttention}
				historyExpanded={ask.expandedHistory[project.id] ?? false}
				customReplyOpen={ask.customReplyProjects[project.id] ?? false}
				draft={ask.draftFor(activeAttention)}
				onToggleHistory={ask.onToggleHistory}
				onCustomReplyToggle={ask.onCustomReplyToggle}
				onReplyDraftChange={ask.onReplyDraftChange}
				onQuickReplySelect={ask.onQuickReplySelect}
				onQuickReplyConfirm={ask.onQuickReplyConfirm}
				onQuickReplyCancel={ask.onQuickReplyCancel}
				onQuickReplyText={ask.onQuickReplyText}
				onResolveQuotaBlocked={ask.onResolveQuotaBlocked}
				onDismissQuotaBlocked={ask.onDismissQuotaBlocked}
				onWaitQuotaReset={ask.onWaitQuotaReset}
				wantsText={ask.wantsText}
			/>
		</div>
	{:else if hasMultipleAttentions}
		<div class="card-body multi-lane-panel" transition:trayFold>
			<div class="multi-lane-header">
				<span class="multi-lane-title">{m.companion_lanes_title({ count: allAttentions.length })}</span>
				<span class="multi-lane-hint">{m.companion_lanes_hint()}</span>
			</div>
			<ul class="multi-lane-list">
				{#each allAttentions as req (req.laneId ?? req.pendingUi.requestId)}
					<li class="multi-lane-item">
						<button type="button" class="ask-opt lane-pick-btn" onclick={() => (selectedLaneId = req.laneId ?? 'main')}>
							<span class="lane-name-badge">{laneName(req)}</span>
							<span class="lane-question-text">{req.pendingUi.title || m.companion_lane_request_fallback()}</span>
							<span class="lane-action-arrow" aria-hidden="true"><IconChevronRight /></span>
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{:else if project.lane.agentState === 'working'}
		{#if activityText}
			<!-- Una riga sola: "sta lavorando" non chiede niente a nessuno,
			     quindi la card al lavoro si ritira. Il title rivela la riga
			     troncata, non duplica un controllo. -->
			<p class="card-activity" title={activityText} transition:trayFold>{activityText}</p>
		{/if}
	{:else if headsUpText || settledExcerpt || queued.length > 0}
		<div class="card-body" transition:trayFold>
			{#if headsUpText}
				<button
					type="button"
					class="card-headsup"
					title={m.headsup_goto_title()}
					onclick={() => onFocusProject(project.id)}
				>
					<span class="hu-icon" aria-hidden="true"><IconWarning /></span>
					<span class="hu-text"><span class="hu-label">{m.headsup_label()}</span> {headsUpText}</span>
				</button>
			{/if}
			{#if settledExcerpt}
				<div class="card-excerpt">
					<span class="excerpt-age">{settledExcerpt.age}</span>
					<span class="excerpt-text">{settledExcerpt.text}</span>
				</div>
			{/if}
			{#if queued.length > 0}
				<MissedScheduleBanner tasks={queued} compact />
				<CompanionProjectQueue
					projectName={name}
					tasks={queued}
					disabled={runtime?.canRunTask !== true}
					disabledReason={runtime?.runBlockReason}
					onRunNext={(taskId) => onRunTask(project.id, taskId)}
				/>
			{/if}
		</div>
	{/if}
</article>
