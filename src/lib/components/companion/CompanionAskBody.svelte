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
	import { m } from '$lib/paraglide/messages.js';
	import { tick } from 'svelte';
	import { askQuestionText, parseAskTitle, sanitizeAskDetail } from '$lib/agent/askTitle';
	import { cleanOptionLabel, isOtherOption } from '$lib/agent/askAnswers';
	import { lexMarkdown } from '$lib/agent/markdown';
	import { trayFold } from '$lib/agent/motion';
	import type { AttentionRequest } from '$lib/stores/companion.svelte';
	import { CONTEXT_VISIBLE_CHARS, tailOfText } from '$lib/stores/companionText';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import CompanionMarkdown from './CompanionMarkdown.svelte';
	import { IconArrowUp, IconCheck, IconClose, IconPencil, IconSparkles } from '$lib/icons';

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
	// «N/M» solo con piu' di una domanda, anche quando il titolo di omp porta
	// «1/1»; le altre forme (selezioni multiple) restano.
	const counter = $derived(parsed.counter && !/^\d+\/1$/.test(parsed.counter) ? parsed.counter : null);

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

	function handleReplyKeydown(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }, closeOnEscape: boolean) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
			e.preventDefault();
			e.stopPropagation();
			void onQuickReplyText(req.projectId, req.laneId, req.pendingUi.requestId);
		} else if (closeOnEscape && e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onCustomReplyToggle(req.projectId, false);
		}
	}
</script>

{#if contextMessages.length > 0}
	<div class="chat-context" bind:this={contextEl} onscroll={handleContextScroll}>
		{#each contextMessages as msg, i (i)}
			<div class="context-bubble">
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
		<p class="ask-text">{askQuestionText(req.pendingUi, m.ui_companionview_seleziona_un_opzione_d398())}</p>
		{#if counter}
			<span class="ask-counter">{counter}</span>
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
									<span class="ask-opt-label">{alt.modelName}</span>
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
						onclick={() => void onQuickReplyText(req.projectId, req.laneId, req.pendingUi.requestId)}
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
								void onQuickReplySelect(req.projectId, opt, req.laneId, req.pendingUi.requestId);
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
