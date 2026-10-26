<script lang="ts">
	import { tick } from 'svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { lexMarkdown } from '#lib/agent/markdown.ts';
	import StatusMark, { type StatusMarkType } from '#lib/ui/StatusMark.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import {
		IconArrowDown,
		IconArrowLeft,
		IconArrowRight,
		IconCheck,
		IconChevronDown,
		IconCircleAlert,
		IconClose,
		IconPlus
	} from '#lib/icons.ts';
	import ComposerEditor from '#lib/agent/components/ComposerEditor.svelte';
	import SuggestPanel, { type SuggestionItem } from '#lib/agent/components/SuggestPanel.svelte';
	import { createCommandBadgeElement, createFileBadgeElement, type ComposerTrigger } from '#lib/agent/composerDoc.ts';
	import { computeCaretAnchorLeft, loadProjectFiles, rankFileCandidates } from '#lib/agent/fileMention.ts';
	import { SUGGEST_WIDTH, fileSuggestions } from '#lib/agent/suggestItems.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { directiveDisplayName } from '#lib/stores/taskDirectives.ts';
	import type { Project } from '#lib/stores/projects.svelte.ts';
	import { companionStore, type AttentionRequest } from '#lib/stores/companion.svelte.ts';
	import ProviderLogo from '#lib/components/models/ProviderLogo.svelte';
	import type { ConversationViewState } from '#lib/companion/companionPresentation.ts';
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
		onReturnToPrevious,
		onCloseCard
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
		onCloseCard: () => void;
	} = $props();

	let replyEditor = $state<ComposerEditor | null>(null);
	let replyShellEl = $state<HTMLDivElement | null>(null);
	let currentTrigger = $state<ComposerTrigger | null>(null);
	let suggestItems = $state<SuggestionItem[]>([]);
	let suggestIndex = $state(0);

	const knownDirectives = $derived(settingsStore.taskDirectives.filter((d) => !d.hidden));

	$effect(() => {
		const trigger = currentTrigger;
		suggestIndex = 0;
		if (!trigger) {
			suggestItems = [];
			return;
		}
		const query = trigger.query.toLowerCase();
		if (trigger.kind === '/') {
			suggestItems = knownDirectives
				.filter((d) => !query || directiveDisplayName(d).toLowerCase().includes(query) || (d.tag ?? '').toLowerCase().includes(query))
				.map((d) => ({
					kind: 'directive' as const,
					value: (d.tag ?? directiveDisplayName(d)).replace(/^\//, ''),
					label: directiveDisplayName(d),
					hint: d.tag
				}));
		} else if (trigger.kind === '@' && project.canonicalProjectPath) {
			const projectPath = project.canonicalProjectPath;
			suggestItems = [];
			void loadProjectFiles(projectPath).then((files) => {
				if (currentTrigger !== trigger) return;
				suggestItems = fileSuggestions(rankFileCandidates(trigger.query, files, {}));
			});
		} else {
			suggestItems = [];
		}
	});

	const suggestAnchor = $derived.by(() => {
		if (!currentTrigger || !replyShellEl) return { left: 0, top: 0 };
		const rect = replyShellEl.getBoundingClientRect();
		return {
			left: computeCaretAnchorLeft(currentTrigger.caretRect, rect, SUGGEST_WIDTH),
			top: currentTrigger.caretRect.top - rect.top + 24 + 6
		};
	});

	function pickSuggestion(item: SuggestionItem) {
		if (!currentTrigger || !replyEditor) return;
		let badge: HTMLElement;
		if (item.kind === 'file') {
			badge = createFileBadgeElement(item.item.path);
		} else if (item.kind === 'cmd') {
			badge = createCommandBadgeElement(item.command.name);
		} else if (item.kind === 'directive') {
			badge = createCommandBadgeElement(item.value);
		} else {
			return;
		}
		replyEditor.replaceTrigger(badge, currentTrigger);
		currentTrigger = null;
		onDraftChange(replyEditor.getWireText());
	}

	$effect(() => {
		if (!convState.draft && replyEditor && replyEditor.getWireText()) {
			replyEditor.clear();
		}
	});

	const name = $derived(project.label?.trim() || project.name);

	const isWorking = $derived(project.lane.agentState === 'working');
	const isAsking = $derived(viewMode === 'question' && Boolean(attention));
	const runtime = $derived(
		companionStore.projectRuntimes.find(
			(r) => r.projectId.toLowerCase() === project.id.toLowerCase()
		)
	);
	const activeModelLabel = $derived(
		runtime?.modelLabel || runtime?.modelId || attention?.modelName || null
	);
	const activeProvider = $derived(runtime?.provider || null);

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
			if (replyEditor) {
				replyEditor.focusEnd();
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
			{attention ? (attention.pendingUi.kind === 'ask' ? m.companion_kind_ask_tool() : m.companion_kind_message_proposals()) : ''}
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
			class="project-card question-card focus-card"
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
					<Tooltip text={m.companion_card_close_title()} placement="top">
						<button
							type="button"
							class="composer-icon-btn close-card-btn"
							aria-label={m.companion_card_close_title()}
							onclick={onCloseCard}
						>
							<IconClose />
						</button>
					</Tooltip>
				</div>
				<div class="card-row-meta">
					{#if activeModelLabel}
						<span class="p-model">
							<ProviderLogo provider={activeProvider || activeModelLabel} size={11} />
							<span>{activeModelLabel}</span>
						</span>
					{/if}
					{#if queuedCount > 0}
						<span class="p-queue-count">{queuedCount}</span>
					{/if}
					<span class="p-state">
						<span class="p-dot" style="background: var(--warn)"></span>
						{attention.pendingUi.kind === 'ask' ? m.companion_kind_ask_tool() : m.companion_kind_message_proposals()}
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
		<!-- Domanda non più presente: si chiude automaticamente -->
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
						</button>
					</Tooltip>
					<Tooltip text={m.companion_card_close_title()} placement="top">
						<button
							type="button"
							class="composer-icon-btn close-card-btn"
							aria-label={m.companion_card_close_title()}
							onclick={onCloseCard}
						>
							<IconClose />
						</button>
					</Tooltip>
				</div>
				<div class="card-row-meta">
					{#if activeModelLabel}
						<span class="p-model">
							<ProviderLogo provider={activeProvider || activeModelLabel} size={11} />
							<span>{activeModelLabel}</span>
						</span>
					{/if}
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

							<div class="composer-area">
								{#if currentTrigger && suggestItems.length > 0}
									<SuggestPanel
										kind={currentTrigger.kind}
										query={currentTrigger.query}
										items={suggestItems}
										selectedIndex={suggestIndex}
										left={suggestAnchor.left}
										bottom={0}
										top={suggestAnchor.top}
										onPick={pickSuggestion}
										onHover={(index) => (suggestIndex = index)}
									/>
								{/if}

								<div class="composer-shell" bind:this={replyShellEl}>
									<div class="composer-editor-wrapper">
										<ComposerEditor
											bind:this={replyEditor}
											placeholder={m.companion_reply_placeholder()}
											ariaLabel={m.companion_reply_agent()}
											disabled={!convState.snapshot?.sessionId}
											triggers={['@', '/']}
											onTriggerChange={(t) => (currentTrigger = t)}
											onInput={() => onDraftChange(replyEditor?.getWireText() ?? '')}
											onSend={() => {
												if (canSendReply) onSendReply();
											}}
										/>
									</div>
									<div class="composer-toolbar">
										<Tooltip
											text={convState.snapshot?.canSend === false
												? convState.snapshot.sendBlockReason || m.companion_reason_blocked_default()
												: m.companion_send_message()}
											placement="top"
										>
											<button
												type="button"
												class="composer-send-btn send-message-btn"
												disabled={!canSendReply}
												onclick={onSendReply}
												aria-label={m.companion_send_message()}
											>
												<IconArrowRight />
											</button>
										</Tooltip>
									</div>
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

	.composer-area {
		position: relative;
	}

	:global(.followup .composer-shell) {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2);
	}

	:global(.followup .composer-editor) {
		font-size: var(--text-body) !important;
		line-height: 1.45;
		min-height: 48px;
	}

	.composer-toolbar {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		margin-top: var(--space-2);
	}

	.send-message-btn {
		margin-left: auto;
	}

	.companion-empty-session {
		margin: var(--space-4) 0;
		font-size: var(--text-label);
		color: var(--ink-muted);
		font-style: italic;
	}
</style>
