<!--
  AttentionCard.svelte — Scheda richiesta di attenzione dell'agente.
  Port fedele di Studio AskCard: superficie bg-raised, ombra raise, raggio xl,
  voce chat in .ask-text (15px/24px 500), opzioni .ask-opt con .ask-rec,
  countdown in mono tabulare e azioni ghost + primary nel piede.
-->
<script lang="ts">
	import type { RemoteAttention, Feature } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { initializeAskState, toggleOptionSelection, buildAskAnswer, type QuestionAnswerState } from '../askAnswers.ts';
	import { formatCommandError } from '../errors.ts';
	import { IconChevronDown, IconChevronUp } from '../icons.ts';
	import StatusMark from './StatusMark.svelte';

	let {
		hostId,
		hostName,
		hostFeatures,
		projectId,
		attention
	} = $props<{
		hostId: string;
		hostName: string;
		hostFeatures: Feature[];
		projectId: string;
		attention: RemoteAttention;
	}>();

	let isSubmitting = $state(false);
	let errorMessage = $state<string | null>(null);
	let showRecentContext = $state(false);

	// Per input/editor
	let textValue = $state('');

	// Per ask
	let askState = $state<Record<string, QuestionAnswerState>>({});

	$effect(() => {
		textValue = attention.prefill || '';
		askState = initializeAskState(attention.questions || []);
	});

	// Scadenza live
	let now = $state(Date.now());
	$effect(() => {
		if (attention.deadline == null) return;
		const timer = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(timer);
	});

	const remainingSecs = $derived.by(() => {
		if (attention.deadline == null) return null;
		return Math.max(0, Math.floor((attention.deadline - now) / 1000));
	});

	const formattedDeadline = $derived.by(() => {
		if (remainingSecs == null) return null;
		if (remainingSecs === 0) return t('expired');
		const m = Math.floor(remainingSecs / 60);
		const s = remainingSecs % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	});

	const canQuotaAction = $derived(hostFeatures.includes('quota_actions'));

	async function runAction(actionFn: () => Promise<unknown>): Promise<void> {
		if (isSubmitting) return;
		isSubmitting = true;
		errorMessage = null;
		try {
			await actionFn();
		} catch (err) {
			errorMessage = formatCommandError(err as any);
		} finally {
			isSubmitting = false;
		}
	}

	function handleSelectOption(val: string): void {
		runAction(() =>
			connection.sendCommand(hostId, {
				kind: 'respond_ui',
				projectId,
				laneId: attention.laneId,
				requestId: attention.requestId,
				answer: { action: 'select', value: val }
			})
		);
	}

	function handleConfirm(confirmed: boolean): void {
		runAction(() =>
			connection.sendCommand(hostId, {
				kind: 'respond_ui',
				projectId,
				laneId: attention.laneId,
				requestId: attention.requestId,
				answer: { action: 'confirm', confirmed }
			})
		);
	}

	function handleTextInputSubmit(): void {
		runAction(() =>
			connection.sendCommand(hostId, {
				kind: 'respond_ui',
				projectId,
				laneId: attention.laneId,
				requestId: attention.requestId,
				answer: {
					action: attention.method === 'editor' ? 'editor' : 'input',
					value: textValue
				}
			})
		);
	}

	function handleAskSubmit(): void {
		const answer = buildAskAnswer(attention.questions, askState);
		runAction(() =>
			connection.sendCommand(hostId, {
				kind: 'respond_ui',
				projectId,
				laneId: attention.laneId,
				requestId: attention.requestId,
				answer
			})
		);
	}

	function handleCancel(): void {
		runAction(() =>
			connection.sendCommand(hostId, {
				kind: 'respond_ui',
				projectId,
				laneId: attention.laneId,
				requestId: attention.requestId,
				answer: { action: 'cancel' }
			})
		);
	}

	function handleWaitQuota(): void {
		runAction(() =>
			connection.sendCommand(hostId, {
				kind: 'wait_quota_reset',
				projectId,
				laneId: attention.laneId
			})
		);
	}

	function handleDismissQuota(): void {
		runAction(() =>
			connection.sendCommand(hostId, {
				kind: 'dismiss_quota_blocked',
				projectId,
				laneId: attention.laneId
			})
		);
	}

	// Con una sola domanda e senza titolo la domanda e' il titolo, come in AskCard:
	// ripeterla in piccolo sotto «Richiesta dell'agente» la faceva sembrare secondaria.
	const singleQuestion = $derived(attention.method === 'ask' && attention.questions.length === 1 && !attention.title);
	const headline = $derived(
		singleQuestion ? attention.questions[0].question : attention.title || attention.message || t('attentionFallbackTitle')
	);
</script>

<div class="attention-card ask-card-root rv-lift" id={`attention-${attention.requestId}`}>
	<div class="card-lead">
		<div class="badge-row">
			<span class="lane-tag">
				<StatusMark status="attention" />
				<span class="lane-label">{attention.laneTitle || hostName}</span>
			</span>
			{#if formattedDeadline}
				<span class="ask-counter">
					{remainingSecs === 0 ? t('expired') : t('expiresIn', { time: formattedDeadline })}
				</span>
			{/if}
		</div>

		<h3 class="ask-text">{headline}</h3>
		{#if attention.message && attention.title && attention.message !== attention.title}
			<p class="ask-detail">{attention.message}</p>
		{/if}
	</div>

	{#if errorMessage}
		<div class="error-line" role="alert">
			{errorMessage}
		</div>
	{/if}

	<!-- Sezione contesto conversazione recente -->
	{#if attention.recentMessages && attention.recentMessages.length > 0}
		<div class="recent-context-block">
			<button
				type="button"
				class="context-toggle-btn ui-button ui-button-ghost"
				onclick={() => (showRecentContext = !showRecentContext)}
			>
				<span>{t('recentContext')} ({attention.recentMessages.length})</span>
				<span class="chevron" aria-hidden="true">
					{#if showRecentContext}
						<IconChevronUp />
					{:else}
						<IconChevronDown />
					{/if}
				</span>
			</button>

			{#if showRecentContext}
				<div class="messages-stream">
					{#each attention.recentMessages as msg, idx (idx)}
						<div class="chat-line role-{msg.role}">
							<span class="role-badge">{msg.role}</span>
							<p class="msg-text">{msg.text}</p>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Corpo azione in base al metodo -->
	<div class="action-body">
		{#if attention.quotaBlocked}
			<div class="quota-blocked-content">
				<p class="ask-detail">
					{attention.quotaBlocked.reason === 'quota_exhausted' ? t('quotaBlockedTitle') : t('providerErrorTitle')}
					{#if attention.quotaBlocked.provider}
						({attention.quotaBlocked.provider})
					{/if}
				</p>
				{#if canQuotaAction}
					<div class="ask-footer">
						<button
							type="button"
							class="ui-button ui-button-secondary"
							disabled={isSubmitting}
							onclick={handleDismissQuota}
						>
							{t('dismissQuotaBlocked')}
						</button>
						<button
							type="button"
							class="ui-button ui-button-primary"
							disabled={isSubmitting}
							onclick={handleWaitQuota}
						>
							{t('waitQuotaReset')}
						</button>
					</div>
				{/if}
			</div>

		{:else if attention.method === 'select'}
			<div class="ask-options">
				{#each attention.options as opt, optIdx (optIdx)}
					<button
						type="button"
						class="ask-opt"
						disabled={isSubmitting}
						onclick={() => handleSelectOption(opt.label)}
					>
						<div class="ask-opt-body">
							<div class="ask-opt-label">
								<span>{opt.label}</span>
							</div>
							{#if opt.description}
								<div class="ask-opt-desc">{opt.description}</div>
							{/if}
						</div>
					</button>
				{/each}
			</div>

		{:else if attention.method === 'confirm'}
			<div class="ask-footer">
				<button
					type="button"
					class="ui-button ui-button-secondary"
					disabled={isSubmitting}
					onclick={() => handleConfirm(false)}
				>
					{t('no')}
				</button>
				<button
					type="button"
					class="ui-button ui-button-primary"
					disabled={isSubmitting}
					onclick={() => handleConfirm(true)}
				>
					{t('yes')}
				</button>
			</div>

		{:else if attention.method === 'input' || attention.method === 'editor'}
			<div class="text-input-form">
				<textarea
					class="ui-input text-area"
					rows={attention.method === 'editor' ? 5 : 2}
					placeholder={attention.placeholder || ''}
					bind:value={textValue}
					disabled={isSubmitting}
				></textarea>
				<div class="ask-footer">
					<button
						type="button"
						class="ui-button ui-button-ghost"
						disabled={isSubmitting}
						onclick={handleCancel}
					>
						{t('cancel')}
					</button>
					<button
						type="button"
						class="ui-button ui-button-primary"
						disabled={isSubmitting || !textValue.trim()}
						onclick={handleTextInputSubmit}
					>
						{isSubmitting ? t('running') : t('send')}
					</button>
				</div>
			</div>

		{:else if attention.method === 'ask'}
			<div class="ask-form">
				{#each attention.questions as q, qIdx (qIdx)}
					<div class="question-block">
						{#if q.header}
							<div class="ask-counter">{q.header}</div>
						{/if}
						{#if !singleQuestion}
							<div class="q-title">{q.question}</div>
						{/if}

						<div class="ask-options">
							{#each q.options as opt, optIdx (optIdx)}
								{@const isSelected = askState[q.id]?.selectedOptions.includes(opt.label)}
								{@const isRecommended = q.recommended === optIdx}

								<button
									type="button"
									class="ask-opt"
									class:selected={isSelected}
									onclick={() => {
										if (!askState[q.id]) {
											askState[q.id] = { selectedOptions: [opt.label], customInput: '' };
											return;
										}
										const curr = askState[q.id].selectedOptions || [];
										askState[q.id].selectedOptions = toggleOptionSelection(curr, opt.label, q.multi);
									}}
								>
									<span class="opt-indicator" class:selected={isSelected} aria-hidden="true"></span>
									<div class="ask-opt-body">
										<div class="ask-opt-label">
											<span>{opt.label}</span>
											{#if isRecommended}
												<span class="ask-rec">{t('recommendedBadge')}</span>
											{/if}
										</div>
										{#if opt.description}
											<div class="ask-opt-desc">{opt.description}</div>
										{/if}
									</div>
								</button>
							{/each}

							<!-- Opzione Altro/customInput -->
							<div class="custom-input-wrap">
								<input
									type="text"
									class="ui-input other-input"
									placeholder={t('otherOption')}
									value={askState[q.id]?.customInput || ''}
									oninput={(e) => {
										const val = (e.target as HTMLInputElement).value;
										if (!askState[q.id]) {
											askState[q.id] = { selectedOptions: [], customInput: val };
										} else {
											askState[q.id].customInput = val;
										}
									}}
									disabled={isSubmitting}
								/>
							</div>
						</div>
					</div>
				{/each}

				<div class="ask-footer">
					<button
						type="button"
						class="ui-button ui-button-ghost"
						disabled={isSubmitting}
						onclick={handleCancel}
					>
						{t('cancel')}
					</button>
					<button
						type="button"
						class="ui-button ui-button-primary"
						disabled={isSubmitting}
						onclick={handleAskSubmit}
					>
						{isSubmitting ? t('running') : t('submit')}
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.attention-card {
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-raise);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		position: relative;
	}

	.card-lead {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.badge-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.lane-tag {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-meta);
		color: var(--ink-muted);
	}

	.lane-label {
		font-weight: 500;
	}

	.error-line {
		color: var(--danger);
		font-size: var(--text-caption);
		line-height: 1.4;
	}

	.recent-context-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.context-toggle-btn {
		font-size: var(--text-caption);
		align-self: flex-start;
		height: 26px;
		padding: 0 6px;
		gap: 4px;
	}

	.chevron {
		--icon-size: 12px;
		display: grid;
		place-items: center;
	}

	.messages-stream {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 10px;
		background: var(--bg-sunken);
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		max-height: 180px;
		overflow-y: auto;
	}

	.chat-line {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.role-badge {
		font-size: var(--text-meta);
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.msg-text {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink);
		line-height: 1.4;
		white-space: pre-wrap;
	}

	.action-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.ask-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.text-input-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.text-area {
		width: 100%;
		min-height: 60px;
		height: auto;
		resize: vertical;
		padding: 8px 10px;
		line-height: 1.45;
		font-size: var(--text-chat);
		border-radius: var(--radius-md);
	}

	.question-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.q-title {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.opt-indicator {
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		border: 1.5px solid var(--line-strong);
		flex-shrink: 0;
		margin-top: 3px;
		box-sizing: border-box;
		transition: border-color var(--dur-fast) var(--ease-out),
		            background-color var(--dur-fast) var(--ease-out);
	}

	.opt-indicator.selected {
		border-color: var(--brand);
		background: var(--brand);
		box-shadow: inset 0 0 0 2px var(--bg-base);
	}

	.custom-input-wrap {
		margin-top: 4px;
	}

	.other-input {
		width: 100%;
	}
</style>
