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
	// cio' che ha detto e la coda pronta a partire.
	import { m } from '$lib/paraglide/messages.js';
	import { computeQuotaInfo } from '$lib/quota/projectQuota';
	import QuotaChip from '$lib/components/quota/QuotaChip.svelte';
	import { ACTIVITY_FRESH_MS, shortAge } from '$lib/stores/companionText';
	import type { Project } from '$lib/stores/projects.svelte';
	import type { AttentionRequest, CompanionProjectRuntime } from '$lib/stores/companion.svelte';
	import type { StudioTask } from '$lib/stores/tasks.svelte';
	import type { CompanionAskHandlers } from './companionAsk';
	import CompanionAskBody from './CompanionAskBody.svelte';
	import CompanionProjectQueue from './CompanionProjectQueue.svelte';
	import {
		IconCheck,
		IconPlus,
		IconStatusPending,
		IconStatusRunning,
		IconWarning
	} from '$lib/icons';

	let {
		project,
		hue,
		runtime,
		attention = null,
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
		queued: StudioTask[];
		ask: CompanionAskHandlers;
		onFocusProject: (projectId: string) => void;
		onNewTask: (project: Project) => void;
		onRunTask: (projectId: string, taskId: string) => void;
		onToggleUsage?: () => void;
	}>();

	const name = $derived(project.label?.trim() || project.name);
	const busy = $derived(project.agentState === 'working' || project.agentState === 'attention');

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

	function stateLabel(): string {
		if (project.agentState === 'attention') {
			if (attention?.pendingUi.kind === 'quota_blocked') {
				return attention.pendingUi.blockedQuota?.reasonKind === 'quota_exhausted'
					? m.companion_state_quota_exhausted()
					: m.companion_state_provider_error();
			}
			return m.ui_companionview_chiede_risposta_de18();
		}
		if (project.agentState === 'working') return m.companion_state_working();
		if (project.agentState === 'finished') return m.page_agent_state_finished();
		if (project.agentState === 'idle') return m.companion_state_idle();
		return m.companion_state_unknown();
	}
</script>

<article
	class="project-card"
	class:busy
	class:attention={project.agentState === 'attention'}
	class:finished={project.agentState === 'finished'}
	class:wide={Boolean(attention)}
	style="--proj-hue: {hue}"
>
	<header class="card-top">
		<!-- Riga superiore: punto identita' + nome progetto + pulsante nuovo task -->
		<div class="card-row-name">
			<button
				type="button"
				class="card-identity"
				title={m.companion_card_open_title({ project: name })}
				onclick={() => onFocusProject(project.id)}
			>
				<span class="p-dot" class:lit={busy}></span>
				<span class="p-name">{name}</span>
			</button>
			<button
				type="button"
				class="card-new-task"
				title={m.companion_card_new_task_title({ project: name })}
				aria-label={m.companion_card_new_task_title({ project: name })}
				onclick={() => onNewTask(project)}
			>
				<IconPlus />
			</button>
		</div>

		<!-- Riga inferiore: quota, stato e contatore coda -->
		<div class="card-row-meta">
			{#if queued.length > 0}
				<span class="p-queue-count" title={m.companion_queue_count({ count: queued.length })}>
					{queued.length}
				</span>
			{/if}

			{#if busy && runtime?.provider}
				{@const info = computeQuotaInfo(runtime.provider, runtime.modelId, runtime.credentialPin)}
				<QuotaChip
					variant="ringHalo"
					showProvider={true}
					alwaysShowPct={true}
					semanticColors={true}
					status={info.status}
					remainingPct={info.remainingPct}
					usedPct={info.usedPct}
					shortName={runtime.modelLabel ?? info.shortName}
					hasLimits={info.hasLimits}
					title={info.tooltip}
					ariaLabel={info.tooltip}
					longWindowAlert={info.longWindowAlert}
					accountEmail={info.accountEmail}
					onclick={(e) => {
						e.stopPropagation();
						onToggleUsage?.();
					}}
				/>
			{/if}

			<span class="p-state state-{project.agentState}">
				{#if project.agentState === 'working'}
					<IconStatusRunning /> {stateLabel()}
				{:else if project.agentState === 'attention'}
					<IconWarning /> {stateLabel()}
				{:else if project.agentState === 'finished'}
					<IconCheck /> {stateLabel()}
				{:else}
					<IconStatusPending /> {stateLabel()}
				{/if}
			</span>
		</div>
	</header>

	{#if attention}
		<CompanionAskBody
			req={attention}
			historyExpanded={ask.expandedHistory[project.id] ?? false}
			customReplyOpen={ask.customReplyProjects[project.id] ?? false}
			draft={ask.draftFor(attention)}
			onToggleHistory={ask.onToggleHistory}
			onCustomReplyToggle={ask.onCustomReplyToggle}
			onReplyDraftChange={ask.onReplyDraftChange}
			onQuickReplySelect={ask.onQuickReplySelect}
			onQuickReplyConfirm={ask.onQuickReplyConfirm}
			onQuickReplyCancel={ask.onQuickReplyCancel}
			onQuickReplyText={ask.onQuickReplyText}
			onResolveQuotaBlocked={ask.onResolveQuotaBlocked}
			onDismissQuotaBlocked={ask.onDismissQuotaBlocked}
			wantsText={ask.wantsText}
		/>
	{:else if project.agentState === 'working'}
		{#if activityText}
			<!-- Una riga sola: "sta lavorando" non chiede niente a nessuno
			     (DESIGN.md §6), quindi la card al lavoro si ritira. -->
			<p class="card-activity" title={activityText}>{activityText}</p>
		{/if}
	{:else}
		{#if settledExcerpt}
			<div class="card-excerpt">
				<span class="excerpt-age">{settledExcerpt.age}</span>
				<span class="excerpt-text">{settledExcerpt.text}</span>
			</div>
		{/if}
		{#if queued.length > 0}
			<CompanionProjectQueue
				projectName={name}
				tasks={queued}
				disabled={runtime?.canRunTask !== true}
				disabledReason={runtime?.runBlockReason}
				onRunNext={(taskId) => onRunTask(project.id, taskId)}
			/>
		{/if}
	{/if}
</article>
