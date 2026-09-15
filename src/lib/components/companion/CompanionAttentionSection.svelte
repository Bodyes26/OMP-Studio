<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { tick } from 'svelte';
	import { askQuestionText, parseAskTitle, sanitizeAskDetail } from '$lib/agent/askTitle';
	import { cleanOptionLabel, isOtherOption } from '$lib/agent/askAnswers';
	import type { AttentionRequest } from '$lib/stores/companion.svelte';
	import {
		IconArrowUp,
		IconCheck,
		IconClose,
		IconSparkles,
		IconWarning
	} from '$lib/icons';

	let {
		attentionList,
		variant = 'open',
		pageIndex = 0,
		expandedHistory,
		replyDrafts,
		customReplyProjects,
		onToggleHistory,
		onPrevPage,
		onNextPage,
		onReplyDraftChange,
		onCustomReplyToggle,
		onQuickReplySelect,
		onQuickReplyConfirm,
		onQuickReplyCancel,
		onQuickReplyText,
		onResolveQuotaBlocked,
		onDismissQuotaBlocked,
		draftFor,
		wantsText
	} = $props<{
		attentionList: AttentionRequest[];
		/**
		 * `open`: la richiesta corrente, aperta e rispondibile senza un click di
		 * scoperta. `list`: le altre richieste in forma compatta.
		 */
		variant?: 'open' | 'list';
		pageIndex?: number;
		expandedHistory: Record<string, boolean>;
		replyDrafts: Record<string, string>;
		customReplyProjects: Record<string, boolean>;
		onToggleHistory: (projectId: string) => void;
		onPrevPage?: () => void;
		onNextPage?: () => void;
		onReplyDraftChange: (projectId: string, value: string) => void;
		onCustomReplyToggle: (projectId: string, open: boolean) => void;
		onQuickReplySelect: (projectId: string, value: string) => void | Promise<void>;
		onQuickReplyConfirm: (projectId: string, confirmed: boolean) => void | Promise<void>;
		onQuickReplyCancel: (projectId: string) => void | Promise<void>;
		onQuickReplyText: (projectId: string) => void | Promise<void>;
		onResolveQuotaBlocked: (projectId: string, selector: string) => void | Promise<void>;
		onDismissQuotaBlocked: (projectId: string) => void | Promise<void>;
		draftFor: (req: AttentionRequest) => string;
		wantsText: (pending: AttentionRequest['pendingUi']) => boolean;
	}>();

	const visibleRequests = $derived.by(() => {
		if (variant === 'open') {
			const req = attentionList[pageIndex];
			return req ? [req] : [];
		}
		// Nell'elenco la richiesta gia' aperta sopra non si ripete.
		return attentionList.filter((_: AttentionRequest, i: number) => i !== pageIndex);
	});

	const totalPages = $derived(Math.max(1, attentionList.length));
	const replyEls: Record<string, HTMLTextAreaElement | null> = {};

	function registerInput(node: HTMLTextAreaElement, projectId: string) {
		replyEls[projectId] = node;
		return {
			destroy() {
				replyEls[projectId] = null;
			}
		};
	}
</script>

{#if visibleRequests.length > 0}
	<section class="attention-section variant-{variant}">
		{#if variant === 'list'}
			<div class="section-title">
				<IconWarning />
				<span>{m.companion_attention_others({ count: visibleRequests.length })}</span>
			</div>
		{/if}

			{#each visibleRequests as req (req.projectId)}
				{@const parsed = parseAskTitle(req.pendingUi.title)}
				{@const detail = parsed.text && req.pendingUi.message ? sanitizeAskDetail(req.pendingUi.message) : null}
				<div class="attention-card selectable" style="--proj-hue: {req.projectHue}">
					<div class="card-header">
						<span class="project-pill">{req.projectName}</span>
						{#if req.modelName}
							<span class="model-badge">{req.modelName}</span>
						{/if}
					</div>

					{#if req.recentMessages && req.recentMessages.length > 0}
						{@const messagesToShow = expandedHistory[req.projectId]
							? req.recentMessages
							: req.recentMessages.slice(-2)}
						<div class="chat-context">
							{#each messagesToShow as msg, i (i)}
								<div class="context-bubble {msg.role}">
									<span class="role-tag">{msg.role === 'user' ? 'Tu' : 'Agente'}:</span>
									<span class="bubble-text">{msg.text}</span>
								</div>
							{/each}

							{#if req.recentMessages.length > 2}
								<button
									type="button"
									class="history-toggle-btn"
									onclick={() => onToggleHistory(req.projectId)}
								>
									{expandedHistory[req.projectId]
										? m.ui_companionview_mostra_meno_contesto_560a()
										: m.ui_companionview_mostra_altri_value1_messaggi_90ae({ value1: req.recentMessages.length - 2 })}
								</button>
							{/if}
						</div>
					{/if}

					<div class="ask-box">
						<div class="ask-head">
							<p class="ask-question">{askQuestionText(req.pendingUi, m.ui_companionview_seleziona_un_opzione_d398())}</p>
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
										onclick={() => void onResolveQuotaBlocked(req.projectId, suggested.selector)}
									>
										<IconSparkles />
										<span>Passa a {suggested.modelName} e riprendi</span>
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
													onclick={() => void onResolveQuotaBlocked(req.projectId, alt.selector)}
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
										onclick={() => void onDismissQuotaBlocked(req.projectId)}
									>
										Archivia avviso
									</button>
								</div>
							</div>
						{:else if req.pendingUi.options && req.pendingUi.options.length > 0}
							{#if customReplyProjects[req.projectId]}
								<div class="text-reply custom-reply">
									<textarea
										class="reply-input"
										rows="2"
										placeholder={m.ui_companionview_scrivi_qui_la_tua_risposta_personalizzata_9d6c()}
										value={draftFor(req)}
										use:registerInput={req.projectId}
										oninput={(e) => onReplyDraftChange(req.projectId, e.currentTarget.value)}
										onkeydown={(e) => {
											if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
												e.preventDefault();
												e.stopPropagation();
												void onQuickReplyText(req.projectId);
											} else if (e.key === 'Escape') {
												e.preventDefault();
												e.stopPropagation();
												onCustomReplyToggle(req.projectId, false);
											}
										}}
									></textarea>
									<div class="reply-actions">
										<span class="reply-hint">Invio per inviare</span>
										<button
											type="button"
											class="action-btn cancel"
											onclick={() => onCustomReplyToggle(req.projectId, false)}
										>Torna alle opzioni</button>
										<button
											type="button"
											class="action-btn confirm"
											disabled={!draftFor(req).trim()}
											onclick={() => void onQuickReplyText(req.projectId)}
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
													void tick().then(() => {
														replyEls[req.projectId]?.focus();
													});
												} else {
													void onQuickReplySelect(req.projectId, opt);
												}
											}}
										>
											<span class="opt-num">{isOther ? '✎' : idx + 1}</span>
											<span class="opt-body">
												<span class="opt-label">
													{clean}
													{#if isRec}
														<span class="opt-recommended-badge">Consigliata</span>
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
									onclick={() => void onQuickReplyConfirm(req.projectId, true)}
								>
									<IconCheck /> <span>{m.project_popover_btn_confirm_yes()}</span>
								</button>
								<button
									type="button"
									class="action-btn cancel"
									onclick={() => void onQuickReplyConfirm(req.projectId, false)}
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
									value={draftFor(req)}
									oninput={(e) => onReplyDraftChange(req.projectId, e.currentTarget.value)}
									onkeydown={(e) => {
										if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
											e.preventDefault();
											e.stopPropagation();
											void onQuickReplyText(req.projectId);
										}
									}}
								></textarea>
								<div class="reply-actions">
									<span class="reply-hint">Invio per inviare</span>
									<button
										type="button"
										class="action-btn cancel"
										onclick={() => void onQuickReplyCancel(req.projectId)}
									>{m.rules_dismiss()}</button>
									<button
										type="button"
										class="action-btn confirm"
										disabled={!draftFor(req).trim()}
										onclick={() => void onQuickReplyText(req.projectId)}
									><IconArrowUp /> <span>{m.ui_askcard_invia_f401()}</span></button>
								</div>
							</div>
						{:else}
							<div class="generic-actions">
								<button
									type="button"
									class="action-btn cancel"
									onclick={() => void onQuickReplyCancel(req.projectId)}
								>
									{m.ui_companionview_ignora_chiudi_5d67()}
								</button>
							</div>
						{/if}
					</div>
				</div>
			{/each}

		{#if variant === 'open' && attentionList.length > 1}
			<div class="inbox-pagination">
				<button
					type="button"
					class="inbox-page-btn"
					disabled={pageIndex <= 0}
					aria-label={m.companion_inbox_prev()}
					onclick={() => onPrevPage?.()}
				>‹</button>
				<span class="inbox-page-label">{pageIndex + 1}/{totalPages}</span>
				<button
					type="button"
					class="inbox-page-btn"
					disabled={pageIndex >= attentionList.length - 1}
					aria-label={m.companion_inbox_next()}
					onclick={() => onNextPage?.()}
				>›</button>
			</div>
		{/if}
	</section>
{/if}
