<script lang="ts">
	// Corpo di una richiesta di attenzione dentro la card del progetto.
	//
	// Non porta intestazione ne' cornice: nome del progetto, modello e stato
	// stanno nell'intestazione della card, che con una domanda aperta prende la
	// sagoma della scheda domanda. Le parti (domanda, dettaglio, opzioni,
	// «Consigliata») sono le stesse classi globali di AskCard in app.css.
	//
	// Le opzioni inviano al click: non c'e' una scelta da confermare, quindi
	// niente radio; l'indice e' un dato, non una scorciatoia.
	import { m } from '#lib/paraglide/messages.js';
	import { tick } from 'svelte';
	import { askQuestionText, parseAskTitle, sanitizeAskDetail } from '#lib/agent/askTitle.ts';
	import { cleanOptionLabel, isOtherOption } from '#lib/agent/askAnswers.ts';
	import { lexMarkdown } from '#lib/agent/markdown.ts';
	import { trayFold } from '#lib/agent/motion.ts';
	import { companionStore, type AttentionRequest } from '#lib/stores/companion.svelte.ts';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import CompanionMarkdown from './CompanionMarkdown.svelte';
	import UserMessage from '#lib/agent/components/UserMessage.svelte';
	import AssistantText from '#lib/agent/components/AssistantText.svelte';
	import AskTrace from '#lib/agent/components/AskTrace.svelte';
	import type { TranscriptEntry } from '#lib/agent/session.svelte.ts';
	import { splitAskContext, type AskContextItem } from '#lib/companion/askContext.ts';
	import {
		IconArrowUp,
		IconCheck,
		IconChevronDown,
		IconClose,
		IconPencil,
		IconSchedule,
		IconSparkles
	} from '#lib/icons.ts';
	import { scheduleStore } from '#lib/stores/schedule.svelte.ts';
	import ProviderLogo from '#lib/components/models/ProviderLogo.svelte';

	let {
		req,
		customReplyOpen = false,
		onCustomReplyToggle,
		onReplyDraftChange,
		onQuickReplySelect,
		onQuickReplyConfirm,
		onQuickReplyCancel,
		onQuickReplyText,
		onResolveQuotaBlocked,
		onDismissQuotaBlocked,
		onWaitQuotaReset,
		draft,
		wantsText
	} = $props<{
		req: AttentionRequest;
		customReplyOpen?: boolean;
		onCustomReplyToggle: (projectId: string, open: boolean) => void;
		onReplyDraftChange: (projectId: string, value: string) => void;
		onQuickReplySelect: (projectId: string, value: string, laneId?: string | null, requestId?: string | null, note?: string) => void | Promise<void>;
		onQuickReplyConfirm: (projectId: string, confirmed: boolean, laneId?: string | null, requestId?: string | null) => void | Promise<void>;
		onQuickReplyCancel: (projectId: string, laneId?: string | null, requestId?: string | null) => void | Promise<void>;
		onQuickReplyText: (projectId: string, laneId?: string | null, requestId?: string | null, note?: string) => void | Promise<void>;
		onResolveQuotaBlocked: (projectId: string, selector: string, laneId?: string | null) => void | Promise<void>;
		onDismissQuotaBlocked: (projectId: string, laneId?: string | null) => void | Promise<void>;
		onWaitQuotaReset: (projectId: string, laneId?: string | null) => void | Promise<void>;
		draft: string;
		wantsText: (pending: AttentionRequest['pendingUi']) => boolean;
	}>();

	const parsed = $derived(parseAskTitle(req.pendingUi.title));
	const detail = $derived(
		parsed.text && req.pendingUi.message ? sanitizeAskDetail(req.pendingUi.message) : null
	);
	// «N/M» solo con piu' di una domanda, anche quando il titolo di omp porta
	// «1/1»; le altre forme (selezioni multiple) restano.
	const counter = $derived(parsed.counter && !/^\d+\/1$/.test(parsed.counter) ? parsed.counter : null);

	let noteText = $state('');
	let showNoteInput = $state(false);
	let noteInputEl = $state<HTMLInputElement | null>(null);
	const contextKey = $derived(`${req.projectId}:${req.laneId ?? 'main'}:${req.pendingUi.requestId}`);
	let currentContextKey = $state('');
	let fullEntries = $state<TranscriptEntry[] | null>(null);
	let isLoadingEntries = $state(false);
	let loadError = $state<string | null>(null);
	// Per domanda, non per progetto: la conversazione aperta su una domanda
	// gia' risposta non deve restare aperta sulla successiva.
	let historyExpanded = $state(false);
	let activeFetchId = 0;

	async function fetchEntriesForContext() {
		const fetchId = ++activeFetchId;
		isLoadingEntries = true;
		loadError = null;
		fullEntries = null;

		try {
			const snapshot = await companionStore.loadConversation(req.projectId, req.laneId ?? 'main');
			if (fetchId !== activeFetchId) return;

			if (snapshot && Array.isArray(snapshot.entries)) {
				fullEntries = snapshot.entries;
			} else {
				loadError = m.companion_conversation_loading();
			}
		} catch (err: unknown) {
			if (fetchId !== activeFetchId) return;
			loadError = err instanceof Error ? err.message : String(err);
		} finally {
			if (fetchId === activeFetchId) {
				isLoadingEntries = false;
			}
		}
	}

	$effect(() => {
		const key = contextKey;
		if (key !== currentContextKey) {
			currentContextKey = key;
			historyExpanded = false;
			void fetchEntriesForContext();
		}
	});

	const askContext = $derived(fullEntries ? splitAskContext(fullEntries) : { prior: [], leadIn: [] });
	const priorItems = $derived<AskContextItem[]>(askContext.prior);
	const leadInItems = $derived<AskContextItem[]>(askContext.leadIn);

	const hasOtherOptionInList = $derived(
		Boolean(req.pendingUi.options?.some((opt: string) => isOtherOption(opt)))
	);
	let replyEl = $state<HTMLTextAreaElement | null>(null);
	function handleReplyKeydown(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }, closeOnEscape: boolean) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
			e.preventDefault();
			e.stopPropagation();
			void onQuickReplyText(req.projectId, req.laneId, req.pendingUi.requestId, noteText.trim() || undefined);
		} else if (closeOnEscape && e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onCustomReplyToggle(req.projectId, false);
		}
	}
</script>

{#if isLoadingEntries}
	<div class="ask-loading-wrap" role="status">
		<p>{m.companion_conversation_loading()}</p>
	</div>
{:else if loadError}
	<div class="reply-error ask-error-wrap" role="alert">
		<span>{loadError}</span>
		<button type="button" class="ui-button ui-button-ghost" onclick={fetchEntriesForContext}>
			{m.companion_conversation_reload()}
		</button>
	</div>
{:else if priorItems.length > 0 || leadInItems.length > 0}
	<div class="ask-chat-thread">
		{#if priorItems.length > 0}
			<div class="history-load-wrap">
				<button
					type="button"
					class="history-load-btn"
					onclick={() => (historyExpanded = !historyExpanded)}
				>
					<span class="chevron-icon" class:rotated={historyExpanded}>
						<IconChevronDown />
					</span>
					<span>
						{historyExpanded
							? m.ui_companionview_mostra_meno_contesto_560a()
							: m.companion_load_previous_message()}
					</span>
				</button>
			</div>

			{#if historyExpanded}
				<div class="prior-messages" transition:trayFold>
					{#each priorItems as item (item.entry.id)}
						{@render contextItem(item)}
					{/each}
				</div>
			{/if}
		{/if}

		{#each leadInItems as item (item.entry.id)}
			{@render contextItem(item)}
		{/each}
	</div>
{/if}

{#snippet contextItem(item: AskContextItem)}
	{#if item.kind === 'user'}
		<div class="msg-row user-row">
			<UserMessage entry={item.entry} />
		</div>
	{:else if item.kind === 'ask'}
		<div class="msg-row">
			<AskTrace entry={item.entry} />
		</div>
	{:else}
		<div class="msg-row assistant-row">
			<AssistantText entry={item.entry} streaming={false} />
		</div>
	{/if}
{/snippet}

<div class="ask-box">
	<div class="ask-head">
		<div class="ask-text-markdown">
			<CompanionMarkdown tokens={lexMarkdown(askQuestionText(req.pendingUi, m.ui_companionview_seleziona_un_opzione_d398()))} />
		</div>
		{#if counter}
			<span class="ask-counter">{counter}</span>
		{/if}
	</div>
	{#if detail}
		<div class="ask-detail-markdown">
			<CompanionMarkdown tokens={lexMarkdown(detail)} />
		</div>
	{/if}
	{#if req.pendingUi.kind === 'quota_blocked'}
		{@const bq = req.pendingUi.blockedQuota}
		{@const suggested = bq?.suggestedModel}
		<div class="quota-blocked-box">
			<p class="qb-msg">
				<StatusMark status={bq?.reasonKind === 'quota_exhausted' ? 'failed' : 'attention'} active={false} />
				<span>{req.pendingUi.message || m.ui_companionview_l_agente_si_e_arrestato_per_limite_7e38()}</span>
			</p>
			{#if bq?.availableRecoveryModels && bq.availableRecoveryModels.length > 1}
				<div class="qb-alternatives">
					<span class="qb-alt-label">{m.ui_companionview_oppure_seleziona_un_altra_riserva_50ef()}</span>
					<div class="ask-options">
						{#each bq.availableRecoveryModels.filter((model: NonNullable<typeof bq.availableRecoveryModels>[number]) => model.selector !== suggested?.selector) as alt (alt.selector)}
							<button
								type="button"
								class="ask-opt"
								onclick={() => void onResolveQuotaBlocked(req.projectId, alt.selector, req.laneId)}
							>
								<span class="ask-opt-body">
									<span class="ask-opt-label">
										{#if alt.provider}
											<ProviderLogo provider={alt.provider} size={13} />
										{/if}
										<span>{alt.modelName}</span>
									</span>
									{#if alt.roleLabel}
										<span class="ask-opt-desc">{alt.roleLabel}</span>
									{/if}
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}
			<div class="ask-actions-row">
				<button
					type="button"
					class="ui-button ui-button-ghost"
					onclick={() => void onDismissQuotaBlocked(req.projectId, req.laneId)}
				>
					{m.companion_quota_dismiss()}
				</button>
				{#if bq?.reasonKind === 'quota_exhausted'}
					{@const when = scheduleStore.previewResetWhen(bq.failedSelector)}
					<button
						type="button"
						class="ui-button ui-button-secondary"
						onclick={() => void onWaitQuotaReset(req.projectId, req.laneId)}
					>
						<IconSchedule />
						{when ? m.schedule_companion_wait_reset({ when }) : m.schedule_quota_wait_reset_plain()}
					</button>
				{/if}
				{#if suggested}
					<button
						type="button"
						class="ui-button ui-button-primary"
						onclick={() => void onResolveQuotaBlocked(req.projectId, suggested.selector, req.laneId)}
					>
						<IconSparkles />
						{m.companion_quota_switch_and_resume({ model: suggested.modelName })}
					</button>
				{/if}
			</div>
		</div>
	{:else if req.pendingUi.options && req.pendingUi.options.length > 0}
		{#if customReplyOpen}
			<div class="text-reply" transition:trayFold>
				<textarea
					class="reply-input"
					rows="2"
					bind:this={replyEl}
					aria-label={m.ui_companionview_scrivi_qui_la_tua_risposta_personalizzata_9d6c()}
					placeholder={m.ui_companionview_scrivi_qui_la_tua_risposta_personalizzata_9d6c()}
					value={draft}
					oninput={(e) => onReplyDraftChange(req.projectId, e.currentTarget.value)}
					onkeydown={(e) => handleReplyKeydown(e, true)}
				></textarea>
				<div class="ask-actions-row">
					<span class="reply-hint">{m.companion_reply_enter_hint()}</span>
					<button type="button" class="ui-button ui-button-ghost" onclick={() => onCustomReplyToggle(req.projectId, false)}>
						{m.companion_options_back()}
					</button>
					<button
						type="button"
						class="ui-button ui-button-primary"
						disabled={!draft.trim()}
						onclick={() => void onQuickReplyText(req.projectId, req.laneId, req.pendingUi.requestId, noteText.trim() || undefined)}
					>
						<IconArrowUp />
						{m.ui_askcard_invia_f401()}
					</button>
				</div>
			</div>
		{:else}
			<div class="ask-options" transition:trayFold>
				{#each req.pendingUi.options as opt, idx (opt)}
					{@const isOther = isOtherOption(opt)}
					{@const isRec = opt.endsWith(' (Recommended)') || (req.pendingUi.questions?.[0] as { recommended?: number } | undefined)?.recommended === idx}
					{@const clean = isOther ? m.ui_askcard_altro_scrivi_la_tua_risposta_3c62() : cleanOptionLabel(opt)}
					{@const description = isOther && !req.pendingUi.optionDetails?.[idx]?.description
						? m.ui_askcard_inserisci_una_risposta_personalizzata_f9dc()
						: req.pendingUi.optionDetails?.[idx]?.description}
					<button
						type="button"
						class="ask-opt"
						onclick={() => {
							if (isOther) {
								onCustomReplyToggle(req.projectId, true);
								void tick().then(() => replyEl?.focus());
							} else {
								void onQuickReplySelect(req.projectId, opt, req.laneId, req.pendingUi.requestId, noteText.trim() || undefined);
							}
						}}
					>
						<span class="ask-opt-index" aria-hidden="true">
							{#if isOther}<IconPencil />{:else}{idx + 1}{/if}
						</span>
						<span class="ask-opt-body">
							<span class="ask-opt-label">
								{clean}
								{#if isRec}
									<span class="ask-rec">{m.companion_option_recommended()}</span>
								{/if}
							</span>
							{#if description}
								<span class="ask-opt-desc">{description}</span>
							{/if}
						</span>
					</button>
				{/each}
				{#if !hasOtherOptionInList}
					<button
						type="button"
						class="ask-opt ask-opt-other"
						onclick={() => {
							onCustomReplyToggle(req.projectId, true);
							void tick().then(() => replyEl?.focus());
						}}
					>
						<span class="ask-opt-index" aria-hidden="true">
							<IconPencil />
						</span>
						<span class="ask-opt-body">
							<span class="ask-opt-label">{m.ui_askcard_altro_scrivi_la_tua_risposta_3c62()}</span>
							<span class="ask-opt-desc">{m.ui_askcard_inserisci_una_risposta_personalizzata_f9dc()}</span>
						</span>
					</button>
				{/if}
			</div>
			<div class="ask-note-section">
				{#if showNoteInput || noteText.trim()}
					<div class="ask-note-wrap">
						<input
							type="text"
							class="ui-input ask-note-input"
							placeholder={m.companion_ask_note_placeholder()}
							bind:value={noteText}
							bind:this={noteInputEl}
						/>
					</div>
				{:else}
					<button
						type="button"
						class="ui-button ui-button-ghost ask-note-btn"
						onclick={() => {
							showNoteInput = true;
							void tick().then(() => noteInputEl?.focus());
						}}
					>
						<IconPencil />
						<span>{m.companion_ask_note()}</span>
					</button>
				{/if}
			</div>
		{/if}
	{:else if req.pendingUi.method === 'confirm'}
		<div class="ask-actions-row">
			<button
				type="button"
				class="ui-button ui-button-ghost"
				onclick={() => void onQuickReplyConfirm(req.projectId, false, req.laneId, req.pendingUi.requestId)}
			>
				<IconClose />
				{m.ui_companionview_no_annulla_20e1()}
			</button>
			<button
				type="button"
				class="ui-button ui-button-primary"
				onclick={() => void onQuickReplyConfirm(req.projectId, true, req.laneId, req.pendingUi.requestId)}
			>
				<IconCheck />
				{m.project_popover_btn_confirm_yes()}
			</button>
		</div>
	{:else if wantsText(req.pendingUi)}
		<div class="text-reply">
			<textarea
				class="reply-input"
				rows="2"
				aria-label={sanitizeAskDetail(req.pendingUi.placeholder) || m.ui_companionview_scrivi_la_risposta_f401()}
				placeholder={sanitizeAskDetail(req.pendingUi.placeholder) || m.ui_companionview_scrivi_la_risposta_f401()}
				value={draft}
				oninput={(e) => onReplyDraftChange(req.projectId, e.currentTarget.value)}
				onkeydown={(e) => handleReplyKeydown(e, false)}
			></textarea>
			<div class="ask-actions-row">
				<span class="reply-hint">{m.companion_reply_enter_hint()}</span>
				<button
					type="button"
					class="ui-button ui-button-ghost"
					onclick={() => void onQuickReplyCancel(req.projectId, req.laneId, req.pendingUi.requestId)}
				>
					{m.rules_dismiss()}
				</button>
				<button
					type="button"
					class="ui-button ui-button-primary"
					disabled={!draft.trim()}
					onclick={() => void onQuickReplyText(req.projectId, req.laneId, req.pendingUi.requestId)}
				>
					<IconArrowUp />
					{m.ui_askcard_invia_f401()}
				</button>
			</div>
		</div>
	{:else}
		<div class="ask-actions-row">
			<button
				type="button"
				class="ui-button ui-button-ghost"
				onclick={() => void onQuickReplyCancel(req.projectId, req.laneId, req.pendingUi.requestId)}
			>
				{m.ui_companionview_ignora_chiudi_5d67()}
			</button>
		</div>
	{/if}
</div>
<style>
	.ask-chat-thread {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
		margin-bottom: var(--space-3);
	}

	.history-load-wrap {
		display: flex;
		justify-content: center;
		padding: var(--space-1) 0;
	}

	.history-load-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: none;
		border: none;
		color: var(--brand-ink, var(--ink-muted));
		font-size: var(--text-label);
		cursor: pointer;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		transition:
			color var(--dur-fast) var(--ease-out),
			background-color var(--dur-fast) var(--ease-out);
	}

	.history-load-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.chevron-icon {
		display: inline-flex;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.chevron-icon.rotated {
		transform: rotate(180deg);
	}

	.prior-messages {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}

	.msg-row {
		min-width: 0;
	}
	.assistant-row {
		min-width: 0;
	}
	.ask-loading-wrap {
		padding: var(--space-2) var(--space-1);
		color: var(--ink-muted);
		font-size: var(--text-label);
		font-style: italic;
	}

	.ask-error-wrap {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2);
		margin-bottom: var(--space-3);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		color: var(--danger);
		font-size: var(--text-label);
	}
</style>
