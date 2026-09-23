<script lang="ts">
	// Corpo di una richiesta di attenzione dentro la card del progetto.
	//
	// Non porta intestazione ne' cornice: nome del progetto, modello e stato
	// stanno nell'intestazione della card, e ripeterli qui dentro avrebbe
	// prodotto una card annidata in un'altra card (DESIGN.md, checklist).
	//
	// Una sola richiesta per volta, quella del progetto: la paginazione
	// dell'inbox e' sparita perche' ogni domanda ha adesso la sua card.
	import { m } from '$lib/paraglide/messages.js';
	import { tick } from 'svelte';
	import { askQuestionText, parseAskTitle, sanitizeAskDetail } from '$lib/agent/askTitle';
	import { cleanOptionLabel, isOtherOption } from '$lib/agent/askAnswers';
	import { lexMarkdown } from '$lib/agent/markdown';
	import type { AttentionRequest } from '$lib/stores/companion.svelte';
	import { CONTEXT_VISIBLE_CHARS, tailOfText } from '$lib/stores/companionText';
	import CompanionMarkdown from './CompanionMarkdown.svelte';
	import { IconArrowUp, IconCheck, IconClose, IconSparkles } from '$lib/icons';

	let {
		req,
		historyExpanded = false,
		onToggleHistory,
		customReplyOpen = false,
		onCustomReplyToggle,
		onReplyDraftChange,
		onQuickReplySelect,
		onQuickReplyConfirm,
		onQuickReplyCancel,
		onQuickReplyText,
		onResolveQuotaBlocked,
		onDismissQuotaBlocked,
		draft,
		wantsText
	} = $props<{
		req: AttentionRequest;
		historyExpanded?: boolean;
		onToggleHistory: (projectId: string) => void;
		customReplyOpen?: boolean;
		onCustomReplyToggle: (projectId: string, open: boolean) => void;
		onReplyDraftChange: (projectId: string, value: string) => void;
		onQuickReplySelect: (projectId: string, value: string, laneId?: string | null, requestId?: string | null) => void | Promise<void>;
		onQuickReplyConfirm: (projectId: string, confirmed: boolean, laneId?: string | null, requestId?: string | null) => void | Promise<void>;
		onQuickReplyCancel: (projectId: string, laneId?: string | null, requestId?: string | null) => void | Promise<void>;
		onQuickReplyText: (projectId: string, laneId?: string | null, requestId?: string | null) => void | Promise<void>;
		onResolveQuotaBlocked: (projectId: string, selector: string, laneId?: string | null) => void | Promise<void>;
		onDismissQuotaBlocked: (projectId: string, laneId?: string | null) => void | Promise<void>;
		draft: string;
		wantsText: (pending: AttentionRequest['pendingUi']) => boolean;
	}>();

	const parsed = $derived(parseAskTitle(req.pendingUi.title));
	const detail = $derived(
		parsed.text && req.pendingUi.message ? sanitizeAskDetail(req.pendingUi.message) : null
	);

	/**
	 * I messaggi di contesto: gli ultimi due, o tutti se l'utente ha chiesto lo
	 * storico. Ogni testo e' tagliato dalla coda e reso come markdown: prima
	 * arrivava grezzo (`**grassetto**`, `- elenco`) e il riquadro nasceva
	 * scorrendo dall'inizio di un messaggio lungo, cioe' dalla parte che meno
	 * serve per rispondere.
	 */
	const contextMessages = $derived.by(() => {
		const all = req.recentMessages ?? [];
		const shown = historyExpanded ? all : all.slice(-2);
		return shown.map((msg: { role: string; text: string }) => ({
			role: msg.role,
			tokens: lexMarkdown(tailOfText(msg.text, CONTEXT_VISIBLE_CHARS))
		}));
	});

	let replyEl = $state<HTMLTextAreaElement | null>(null);
	let contextEl = $state<HTMLDivElement | null>(null);
	/** Vero finche' l'utente non risale il riquadro: solo allora si smette di inseguire la coda. */
	let followTail = true;

	// Il riquadro mostra la fine della conversazione. Si insegue la coda solo
	// se l'utente non e' risalito a leggere: strapparlo indietro mentre legge
	// sarebbe peggio del difetto che questo effetto risolve.
	$effect(() => {
		const el = contextEl;
		const _messages = contextMessages;
		if (!el) return;
		void tick().then(() => {
			if (!followTail) return;
			el.scrollTop = el.scrollHeight;
		});
	});

	function handleContextScroll() {
		const el = contextEl;
		if (!el) return;
		followTail = el.scrollHeight - el.clientHeight - el.scrollTop <= 8;
	}
</script>

{#if contextMessages.length > 0}
	<div
		class="chat-context"
		bind:this={contextEl}
		onscroll={handleContextScroll}
	>
		{#each contextMessages as msg, i (i)}
			<div class="context-bubble {msg.role}">
				<span class="role-tag">
					{msg.role === 'user' ? m.companion_role_user() : m.companion_role_agent()}
				</span>
				<div class="bubble-text">
					<CompanionMarkdown tokens={msg.tokens} />
				</div>
			</div>
		{/each}
	</div>

	{#if (req.recentMessages?.length ?? 0) > 2}
		<button type="button" class="history-toggle-btn" onclick={() => onToggleHistory(req.projectId)}>
			{historyExpanded
				? m.ui_companionview_mostra_meno_contesto_560a()
				: m.ui_companionview_mostra_altri_value1_messaggi_90ae({
						value1: (req.recentMessages?.length ?? 0) - 2
					})}
		</button>
	{/if}
{/if}

<div class="ask-box">
	<div class="ask-head">
		<p class="ask-question">
			{askQuestionText(req.pendingUi, m.ui_companionview_seleziona_un_opzione_d398())}
		</p>
		{#if parsed.counter}
			<span class="ask-counter">{parsed.counter}</span>
		{/if}
	</div>
	{#if detail}
		<p class="ask-detail">{detail}</p>
	{/if}

	{#if req.pendingUi.kind === 'quota_blocked'}
		{@const bq = req.pendingUi.blockedQuota}
		{@const suggested = bq?.suggestedModel}
		<div class="quota-blocked-box">
			<p class="qb-msg">
				{req.pendingUi.message || m.ui_companionview_l_agente_si_e_arrestato_per_limite_7e38()}
			</p>
			{#if suggested}
				<button
					type="button"
					class="action-btn qb-primary-cta"
					onclick={() => void onResolveQuotaBlocked(req.projectId, suggested.selector, req.laneId)}
				>
					<IconSparkles />
					<span>{m.companion_quota_switch_and_resume({ model: suggested.modelName })}</span>
				</button>
			{/if}
			{#if bq?.availableRecoveryModels && bq.availableRecoveryModels.length > 1}
				<div class="qb-alternatives">
					<span class="qb-alt-label">{m.ui_companionview_oppure_seleziona_un_altra_riserva_50ef()}</span>
					<div class="qb-alt-grid">
						{#each bq.availableRecoveryModels.filter((model: NonNullable<typeof bq.availableRecoveryModels>[number]) => model.selector !== suggested?.selector) as alt}
							<button
								type="button"
								class="option-btn qb-alt-btn"
								onclick={() => void onResolveQuotaBlocked(req.projectId, alt.selector, req.laneId)}
							>
								<span class="opt-body">
									<span class="opt-label">{alt.modelName}</span>
									{#if alt.roleLabel}
										<span class="opt-desc">{alt.roleLabel}</span>
									{/if}
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}
			<div class="qb-footer">
				<button
					type="button"
					class="action-btn cancel"
					onclick={() => void onDismissQuotaBlocked(req.projectId, req.laneId)}
				>
					{m.companion_quota_dismiss()}
				</button>
			</div>
		</div>
	{:else if req.pendingUi.options && req.pendingUi.options.length > 0}
		{#if customReplyOpen}
			<div class="text-reply custom-reply">
				<textarea
					class="reply-input"
					rows="2"
					bind:this={replyEl}
					placeholder={m.ui_companionview_scrivi_qui_la_tua_risposta_personalizzata_9d6c()}
					value={draft}
					oninput={(e) => onReplyDraftChange(req.projectId, e.currentTarget.value)}
					onkeydown={(e) => {
						if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
							e.preventDefault();
							e.stopPropagation();
							void onQuickReplyText(req.projectId, req.laneId, req.pendingUi.requestId);
						} else if (e.key === 'Escape') {
							e.preventDefault();
							e.stopPropagation();
							onCustomReplyToggle(req.projectId, false);
						}
					}}
				></textarea>
				<div class="reply-actions">
					<span class="reply-hint">{m.companion_reply_enter_hint()}</span>
					<button
						type="button"
						class="action-btn cancel"
						onclick={() => onCustomReplyToggle(req.projectId, false)}
					>{m.companion_options_back()}</button>
					<button
						type="button"
						class="action-btn confirm"
						disabled={!draft.trim()}
						onclick={() => void onQuickReplyText(req.projectId, req.laneId, req.pendingUi.requestId)}
					><IconArrowUp /> <span>{m.ui_askcard_invia_f401()}</span></button>
				</div>
			</div>
		{:else}
			<div class="options-grid">
				{#each req.pendingUi.options as opt, idx (opt)}
					{@const isOther = isOtherOption(opt)}
					{@const isRec = opt.endsWith(' (Recommended)')}
					{@const clean = isOther ? m.ui_askcard_altro_scrivi_la_tua_risposta_3c62() : cleanOptionLabel(opt)}
					{@const description = isOther && !req.pendingUi.optionDetails?.[idx]?.description
						? m.ui_askcard_inserisci_una_risposta_personalizzata_f9dc()
						: req.pendingUi.optionDetails?.[idx]?.description}
					<button
						type="button"
						class="option-btn"
						class:is-other={isOther}
						onclick={() => {
							if (isOther) {
								onCustomReplyToggle(req.projectId, true);
								void tick().then(() => replyEl?.focus());
							} else {
								void onQuickReplySelect(req.projectId, opt, req.laneId, req.pendingUi.requestId);
							}
						}}
					>
						<span class="opt-num">{isOther ? '✎' : idx + 1}</span>
						<span class="opt-body">
							<span class="opt-label">
								{clean}
								{#if isRec}
									<span class="opt-recommended-badge">{m.companion_option_recommended()}</span>
								{/if}
							</span>
							{#if description}
								<span class="opt-desc">{description}</span>
							{/if}
						</span>
					</button>
				{/each}
			</div>
		{/if}
	{:else if req.pendingUi.method === 'confirm'}
		<div class="confirm-actions">
			<button
				type="button"
				class="action-btn confirm"
				onclick={() => void onQuickReplyConfirm(req.projectId, true, req.laneId, req.pendingUi.requestId)}
			>
				<IconCheck /> <span>{m.project_popover_btn_confirm_yes()}</span>
			</button>
			<button
				type="button"
				class="action-btn cancel"
				onclick={() => void onQuickReplyConfirm(req.projectId, false, req.laneId, req.pendingUi.requestId)}
			>
				<IconClose /> <span>{m.ui_companionview_no_annulla_20e1()}</span>
			</button>
		</div>
	{:else if wantsText(req.pendingUi)}
		<div class="text-reply">
			<textarea
				class="reply-input"
				rows="2"
				placeholder={sanitizeAskDetail(req.pendingUi.placeholder) || m.ui_companionview_scrivi_la_risposta_f401()}
				value={draft}
				oninput={(e) => onReplyDraftChange(req.projectId, e.currentTarget.value)}
				onkeydown={(e) => {
					if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
						e.preventDefault();
						e.stopPropagation();
						void onQuickReplyText(req.projectId, req.laneId, req.pendingUi.requestId);
					}
				}}
			></textarea>
			<div class="reply-actions">
				<span class="reply-hint">{m.companion_reply_enter_hint()}</span>
				<button
					type="button"
					class="action-btn cancel"
					onclick={() => void onQuickReplyCancel(req.projectId, req.laneId, req.pendingUi.requestId)}
				>{m.rules_dismiss()}</button>
				<button
					type="button"
					class="action-btn confirm"
					disabled={!draft.trim()}
					onclick={() => void onQuickReplyText(req.projectId, req.laneId, req.pendingUi.requestId)}
				><IconArrowUp /> <span>{m.ui_askcard_invia_f401()}</span></button>
			</div>
		</div>
	{:else}
		<div class="generic-actions">
			<button
				type="button"
				class="action-btn cancel"
				onclick={() => void onQuickReplyCancel(req.projectId, req.laneId, req.pendingUi.requestId)}
			>
				{m.ui_companionview_ignora_chiudi_5d67()}
			</button>
		</div>
	{/if}
</div>
