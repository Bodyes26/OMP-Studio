<!--
  AttentionCard.svelte — Scheda richiesta di attenzione dell'agente.
  Port fedele di Studio AskCard: superficie bg-raised, ombra raise, raggio xl,
  voce chat in .ask-text (15px/24px 500), opzioni .ask-opt con .ask-rec,
  countdown in mono tabulare e azioni ghost + primary nel piede.
-->
<script lang="ts">
	import type { RemoteAttention, RemoteAskQuestion, Feature } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { untrack } from 'svelte';
	import {
		initializeAskState,
		toggleOptionSelection,
		buildAskAnswer,
		isQuestionAnswered,
		type QuestionAnswerState
	} from '../askAnswers.ts';
	import { formatCommandError } from '../errors.ts';
	import { IconCheck, IconChevronDown, IconChevronUp } from '../icons.ts';
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
	// Una domanda per volta, come AskCard; `questions.length` e' il riepilogo.
	let step = $state(0);

	// Ogni istantanea della macchina porta un oggetto `attention` nuovo: lo stato
	// delle risposte si azzera solo quando cambia la richiesta, altrimenti le
	// scelte fatte sparirebbero mentre l'agente lavora su un'altra corsia.
	let initializedFor: string | null = null;
	$effect(() => {
		const requestId = attention.requestId;
		if (requestId === initializedFor) return;
		initializedFor = requestId;
		untrack(() => {
			textValue = attention.prefill || '';
			askState = initializeAskState(attention.questions || []);
			step = 0;
		});
	});

	const multiSteps = $derived(attention.method === 'ask' && attention.questions.length > 1);
	const isReviewStep = $derived(multiSteps && step >= attention.questions.length);
	const currentQuestion = $derived(isReviewStep ? undefined : attention.questions[step]);
	const allAnswered = $derived(attention.questions.every((q: RemoteAskQuestion) => isQuestionAnswered(askState[q.id])));

	function answerSummary(q: RemoteAskQuestion): string {
		const s = askState[q.id];
		const parts = [...(s?.selectedOptions ?? [])];
		const custom = s?.customInput?.trim();
		if (custom) parts.push(custom);
		return parts.join(', ');
	}

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

	// Nelle domande di `ask` il titolo e' la domanda corrente, come in AskCard:
	// ripeterla in piccolo sotto «Richiesta dell'agente» la faceva sembrare secondaria.
	const isAsk = $derived(attention.method === 'ask' && attention.questions.length > 0);
	const headline = $derived(
		isAsk
			? (currentQuestion?.question ?? t('askReviewTitle'))
			: attention.title || attention.message || t('attentionFallbackTitle')
	);
	const detail = $derived(
		isAsk
			? attention.title || null
			: attention.message && attention.title && attention.message !== attention.title
				? attention.message
				: null
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

		{#if multiSteps}
			<nav class="ask-steps" aria-label={t('askStepsAria')}>
				{#each attention.questions as q, idx (q.id)}
					{@const done = isQuestionAnswered(askState[q.id])}
					{@const cur = step === idx}
					<button
						type="button"
						class="ask-step"
						class:cur
						class:done={done && !cur}
						onclick={() => (step = idx)}
						title={q.question}
						aria-current={cur ? 'step' : undefined}
					>
						<span class="ask-step-badge" aria-hidden="true">
							{#if done && !cur}<IconCheck />{:else}{idx + 1}{/if}
						</span>
						<span class="ask-step-label">{q.header || t('askCounter', { current: idx + 1, total: attention.questions.length })}</span>
					</button>
				{/each}
				<button
					type="button"
					class="ask-step review"
					class:cur={isReviewStep}
					onclick={() => (step = attention.questions.length)}
					aria-current={isReviewStep ? 'step' : undefined}
				>
					<span class="ask-step-badge" aria-hidden="true"><IconCheck /></span>
					<span class="ask-step-label">{t('askReviewTab')}</span>
				</button>
			</nav>
		{:else if currentQuestion?.header}
			<span class="ask-counter">{currentQuestion.header}</span>
		{/if}

		<h3 class="ask-text">{headline}</h3>
		{#if detail}
			<p class="ask-detail">{detail}</p>
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
				{#if isReviewStep}
					<div class="ask-review">
						{#each attention.questions as q, idx (q.id)}
							{@const summary = answerSummary(q)}
							<button type="button" class="ask-review-row" onclick={() => (step = idx)}>
								<span class="ask-review-q" title={q.question}>{q.header || q.question}</span>
								<span class="ask-review-a">
									{#if summary}{summary}{:else}<span class="ask-missing">—</span>{/if}
								</span>
							</button>
						{/each}
					</div>
				{:else if currentQuestion}
					{@const q = currentQuestion}
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
								<span class="opt-indicator" class:multi={q.multi} class:selected={isSelected} aria-hidden="true"></span>
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
									const val = e.currentTarget.value;
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
				{/if}

				<div class="ask-footer">
					<button
						type="button"
						class="ui-button ui-button-ghost"
						disabled={isSubmitting}
						onclick={handleCancel}
					>
						{t('cancel')}
					</button>
					{#if multiSteps && step > 0}
						<button type="button" class="ui-button ui-button-secondary" onclick={() => (step -= 1)}>
							{t('askBack')}
						</button>
					{/if}
					{#if multiSteps && !isReviewStep}
						<!-- L'ultima domanda porta al riepilogo: l'invio parte solo da li', come in AskCard. -->
						<button
							type="button"
							class="ui-button ui-button-primary"
							disabled={!currentQuestion || !isQuestionAnswered(askState[currentQuestion.id])}
							onclick={() => (step += 1)}
						>
							{t('askNext')}
						</button>
					{:else}
						<button
							type="button"
							class="ui-button ui-button-primary"
							disabled={isSubmitting || !allAnswered}
							onclick={handleAskSubmit}
						>
							{isSubmitting ? t('running') : t('submit')}
						</button>
					{/if}
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

	/* Stepper e riepilogo: valori di AskCard in Studio. */
	.ask-steps {
		display: flex;
		align-items: center;
		gap: 4px;
		overflow-x: auto;
		padding-bottom: 2px;
	}

	.ask-step {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		padding: 4px 10px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		cursor: pointer;
		white-space: nowrap;
	}
	.ask-step:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}
	/* Scheda corrente in negativo: si vede a colpo d'occhio a che punto si e'. */
	.ask-step.cur,
	.ask-step.cur:hover {
		background: var(--ink);
		color: var(--bg-base);
	}
	.ask-step.cur .ask-step-badge {
		opacity: 0.6;
	}
	.ask-step.done .ask-step-badge {
		color: var(--success);
	}
	.ask-step.review {
		margin-left: auto;
	}
	.ask-step-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		--icon-size: 11px;
		font-variant-numeric: tabular-nums;
		min-width: 14px;
	}
	.ask-step-label {
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 140px;
	}

	.ask-review {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.ask-review-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: 6px 10px;
		border: none;
		background: transparent;
		color: inherit;
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
	}
	.ask-review-row:hover {
		background: var(--bg-hover);
	}
	.ask-review-row + .ask-review-row {
		border-top: 1px solid var(--line);
	}
	.ask-review-q {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
	}
	.ask-review-a {
		color: var(--ink);
		text-align: right;
	}
	.ask-missing {
		color: var(--warn);
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

	/* Scelta multipla: casella quadrata, come le caselle di Studio; il cerchio resta alla scelta singola. */
	.opt-indicator.multi {
		border-radius: var(--radius-sm);
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
