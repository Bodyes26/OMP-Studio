<script lang="ts">
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { lexMarkdown } from '$lib/agent/markdown';
	import StatusMark, { type StatusMarkType } from '$lib/ui/StatusMark.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import {
		IconArrowDown,
		IconArrowLeft,
		IconArrowRight,
		IconCheck,
		IconChevronDown,
		IconCircleAlert,
		IconPlus
	} from '$lib/icons';
	import type { Project } from '$lib/stores/projects.svelte';
	import type { AttentionRequest } from '$lib/stores/companion.svelte';
	import type { ConversationViewState } from '$lib/companion/companionPresentation';
	import type { CompanionAskHandlers } from './companionAsk';
	import CompanionAskBody from './CompanionAskBody.svelte';
	import CompanionMarkdown from './CompanionMarkdown.svelte';

	let {
		project,
		hue,
		viewMode,
		convState,
		attention = null,
		queuedCount = 0,
		laneLabel,
		previousProjectName = null,
		ask,
		onFocusProject,
		onNewTask,
		onToggleExpanded,
		onDraftChange,
		onSendReply,
		onReload,
		onReturnToPrevious
	}: {
		project: Project;
		hue: number;
		viewMode: 'answer' | 'question';
		convState: ConversationViewState;
		attention?: AttentionRequest | null;
		queuedCount?: number;
		laneLabel: string;
		previousProjectName?: string | null;
		ask: CompanionAskHandlers;
		onFocusProject: (projectId: string) => void;
		onNewTask: (project: Project) => void;
		onToggleExpanded: () => void;
		onDraftChange: (text: string) => void;
		onSendReply: () => void;
		onReload: () => void;
		onReturnToPrevious: () => void;
	} = $props();

	let replyInputEl = $state<HTMLTextAreaElement | null>(null);

	const name = $derived(project.label?.trim() || project.name);

	const isWorking = $derived(project.lane.agentState === 'working');
	const isAsking = $derived(viewMode === 'question' && Boolean(attention));

	const agentStatus = $derived.by<{ mark: StatusMarkType; label: string }>(() => {
		switch (project.lane.agentState) {
			case 'attention':
				return { mark: 'attention', label: m.ui_companionview_chiede_risposta_de18() };
			case 'working':
				return { mark: 'running', label: m.companion_state_working() };
			case 'finished':
				return { mark: 'completed', label: m.companion_state_done() };
			case 'idle':
				return { mark: 'pending', label: m.companion_state_idle() };
			default:
				return { mark: 'pending', label: m.companion_state_unknown() };
		}
	});

	const answerTokens = $derived.by(() => {
		const text = convState.snapshot?.message?.text;
		return text ? lexMarkdown(text) : [];
	});

	const canSendReply = $derived.by(() => {
		if (convState.isSending || convState.isLoading || convState.loadError) return false;
		return Boolean(convState.draft.trim() && convState.snapshot?.sessionId && convState.snapshot.canSend);
	});

	export function focusReply() {
		if (!convState.expanded) {
			onToggleExpanded();
		}
		void tick().then(() => {
			if (replyInputEl) {
				replyInputEl.focus();
				replyInputEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			}
		});
	}

	function handleReplyKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			e.stopPropagation();
			if (canSendReply) {
				onSendReply();
			}
		}
	}
</script>

<div class="priority-main">
	<p class="focus-section-label">
		{#if viewMode === 'question'}
			{attention ? m.companion_label_question_for({ project: name }) : m.companion_question_resolved()}
		{:else if isWorking}
			{m.companion_label_open_conversation()}
		{:else if convState.expanded}
			{m.companion_label_ready_answer()}
		{:else}
			{m.companion_label_reduced_answer()}
		{/if}
	</p>

	{#if isAsking && attention}
		<article
			class="project-card asking attention question-card focus-card"
			style="--proj-hue: {hue}"
			data-project-id={project.id}
		>
			<header class="card-top">
				<div class="card-row-name">
					<div class="identity-wrap">
						<button
							type="button"
							class="card-identity"
							onclick={() => onFocusProject(project.id)}
							title={m.companion_card_open_title({ project: name })}
						>
							<span class="p-dot" style="background: var(--warn)"></span>
							<span class="p-name">{name}</span>
						</button>
					</div>
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
				<div class="card-row-meta">
					{#if queuedCount > 0}
						<span class="p-queue-count">{queuedCount}</span>
					{/if}
					<span class="p-state">
						<span class="p-dot" style="background: var(--warn)"></span>
						{m.ui_companionview_chiede_risposta_de18()}
					</span>
				</div>
			</header>

			<CompanionAskBody
				req={attention}
				historyExpanded={ask.expandedHistory[project.id]}
				customReplyOpen={ask.customReplyProjects[project.id]}
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
				draft={ask.draftFor(attention)}
				wantsText={ask.wantsText}
			/>

			{#if previousProjectName}
				<div class="question-return">
					<button
						type="button"
						class="ui-button ui-button-ghost"
						onclick={onReturnToPrevious}
					>
						<IconArrowLeft />
						<span>{m.companion_rail_return_to({ project: previousProjectName })}</span>
					</button>
				</div>
			{/if}
		</article>
	{:else if viewMode === 'question'}
		<article class="project-card focus-card" data-project-id={project.id}>
			<div class="card-body">
				<p>{m.companion_question_resolved()}</p>
				<button type="button" class="ui-button ui-button-ghost" onclick={previousProjectName ? onReturnToPrevious : onReload}>
					<IconArrowLeft />
					<span>{previousProjectName
						? m.companion_rail_return_to({ project: previousProjectName })
						: m.companion_rail_open_conversation({ project: name })}</span>
				</button>
			</div>
		</article>
	{:else}
		<article
			class="project-card focus-card"
			style="--proj-hue: {hue}"
			data-project-id={project.id}
		>
			<header class="card-top">
				<div class="card-row-name">
					<div class="identity-wrap">
						<button
							type="button"
							class="card-identity"
							onclick={() => onFocusProject(project.id)}
							title={m.companion_card_open_title({ project: name })}
						>
							<span class="p-dot lit" class:is-working={isWorking}></span>
							<span class="p-name">{name}</span>
						</button>
					</div>
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
				<div class="card-row-meta">
					{#if queuedCount > 0}
						<span class="p-queue-count">{queuedCount}</span>
					{/if}
					<span class="p-state">
						<StatusMark status={agentStatus.mark} />
						{agentStatus.label}
					</span>
				</div>
			</header>

			<div class="card-body">
				<div class="reading-trigger">
					<button
						type="button"
						class="ui-button ui-button-ghost"
						onclick={onToggleExpanded}
						aria-expanded={convState.expanded}
					>
						<span>
							{convState.expanded ? m.companion_reduce_answer() : m.companion_read_full_answer()}
						</span>
						<span class="expand-icon" class:rotated={!convState.expanded}>
							<IconChevronDown />
						</span>
					</button>
					<button
						type="button"
						class="ui-button ui-button-ghost"
						onclick={focusReply}
					>
						<span>{m.companion_reply_action()}</span>
						<IconArrowDown />
					</button>
				</div>

				{#if convState.expanded}
					<div class="inline-answer">
						<div class="full-answer bubble-text" data-answer>
							{#if convState.isLoading}
								<p role="status">{m.companion_conversation_loading()}</p>
							{/if}
							{#if convState.loadError}
								<div class="reply-error" role="alert">
									<span>{convState.loadError}</span>
									<button type="button" class="ui-button ui-button-ghost" onclick={onReload}>{m.companion_conversation_reload()}</button>
								</div>
							{/if}
							{#if convState.snapshot?.message?.text}
								<CompanionMarkdown tokens={answerTokens} />
							{:else if !convState.isLoading && !convState.loadError}
								<p class="companion-empty-session">{convState.snapshot?.sessionId
									? m.companion_no_messages()
									: m.companion_no_active_session()}</p>
							{/if}
						</div>

						<section class="followup" aria-label={m.companion_reply_agent()}>
							<div class="followup-label">
								<label id="reply-label" for="reply-input">{m.companion_reply_agent()}</label>
								<span class="target">{name} · {laneLabel}</span>
							</div>

							{#if convState.lastSent}
								<div class="reply-sent">
									<IconCheck />
									<span>{m.companion_sent_notice({ text: convState.lastSent })}</span>
								</div>
							{/if}

							{#if convState.sendError}
								<div class="reply-error">
									<IconCircleAlert />
									<span>{convState.sendError}</span>
									<button type="button" class="ui-button ui-button-ghost" onclick={onReload}>{m.companion_conversation_reload()}</button>
								</div>
							{/if}

							{#if convState.snapshot?.canSend === false}
								<p class="companion-empty-session">
									{convState.snapshot.sendBlockReason || m.companion_reason_blocked_default()}
									<button type="button" class="ui-button ui-button-ghost" onclick={onReload}>{m.companion_conversation_reload()}</button>
								</p>
							{/if}
							<div class="composer-shell">
								<div class="composer-editor-wrapper">
									<textarea
										id="reply-input"
										class="reply-textarea"
										bind:this={replyInputEl}
										value={convState.draft}
										oninput={(e) => onDraftChange(e.currentTarget.value)}
										onkeydown={handleReplyKeydown}
										disabled={!convState.snapshot?.sessionId}
										placeholder={m.companion_reply_placeholder()}
										rows="2"
										aria-labelledby="reply-label"
									></textarea>
								</div>
								<div class="composer-toolbar">
									<span class="send-explanation">{m.companion_reply_scope_note()}</span>
									<Tooltip
										text={convState.snapshot?.canSend === false
											? convState.snapshot.sendBlockReason || m.companion_reason_blocked_default()
											: m.companion_send_message()}
										placement="top"
									>
										<button
											type="button"
											class="ui-button ui-button-secondary send-message-btn"
											disabled={!canSendReply}
											onclick={onSendReply}
										>
											<IconArrowRight />
											<span>{m.companion_send_message()}</span>
										</button>
									</Tooltip>
								</div>
							</div>
						</section>
					</div>
				{:else}
					<p class="card-reduced-notice">{m.companion_reduced_notice()}</p>
				{/if}
			</div>
		</article>
	{/if}
</div>

<style>
	.expand-icon {
		display: inline-flex;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.expand-icon.rotated {
		transform: rotate(-90deg);
	}

	.reply-textarea {
		width: 100%;
		min-height: 52px;
		max-height: 160px;
		padding: 8px 12px;
		box-sizing: border-box;
		background: transparent;
		color: var(--ink);
		border: none;
		outline: none;
		resize: vertical;
		font-family: var(--font-ui);
		font-size: var(--text-label);
		line-height: 1.45;
	}

	.reply-textarea::placeholder {
		color: var(--ink-faint);
	}

	.reply-sent,
	.reply-error {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 8px;
		font-size: var(--text-caption);
		padding: 4px 8px;
		border-radius: var(--radius-md);
	}

	.reply-sent {
		background: color-mix(in oklch, var(--success) 12%, transparent);
		color: var(--success);
	}

	.reply-error {
		background: color-mix(in oklch, var(--danger) 12%, transparent);
		color: var(--danger);
	}

	.send-message-btn {
		min-height: 28px;
		padding: 4px 10px;
		gap: 6px;
		font-size: var(--text-label);
		white-space: nowrap;
		flex: none;
	}

	.companion-empty-session {
		margin: var(--space-4) 0;
		font-size: var(--text-label);
		color: var(--ink-muted);
		font-style: italic;
	}
</style>
