<script lang="ts">
	import type { RemoteAttention, Feature } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { initializeAskState, toggleOptionSelection, buildAskAnswer, type QuestionAnswerState } from '../askAnswers.ts';
	import { formatCommandError } from '../errors.ts';

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

	async function runAction(actionFn: () => Promise<void>): Promise<void> {
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
</script>

<div class="attention-card">
	<div class="attention-header">
		<div class="badge-row">
			<span class="attention-badge">
				<span class="badge-dot"></span>
				{#if attention.laneTitle}
					{attention.laneTitle}
				{:else}
					{hostName}
				{/if}
			</span>
			{#if formattedDeadline}
				<span class="deadline-pill">
					{t('expiresIn', { time: formattedDeadline })}
				</span>
			{/if}
		</div>

		<h3 class="attention-title">{attention.title || attention.message || t('attentionFallbackTitle')}</h3>
		{#if attention.message && attention.title && attention.message !== attention.title}
			<p class="attention-message">{attention.message}</p>
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
				class="context-toggle-btn btn btn-ghost"
				onclick={() => (showRecentContext = !showRecentContext)}
			>
				<span>{t('recentContext')} ({attention.recentMessages.length})</span>
				<span class="chevron">{showRecentContext ? '▲' : '▼'}</span>
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
				<p class="quota-reason">
					{attention.quotaBlocked.reason === 'quota_exhausted'
						? 'Quota esaurita per il modello'
						: 'Errore provider'}
					{#if attention.quotaBlocked.provider}
						({attention.quotaBlocked.provider})
					{/if}
				</p>
				{#if canQuotaAction}
					<div class="btn-group">
						<button
							class="btn btn-primary"
							disabled={isSubmitting}
							onclick={handleWaitQuota}
						>
							{t('waitQuotaReset')}
						</button>
						<button
							class="btn btn-secondary"
							disabled={isSubmitting}
							onclick={handleDismissQuota}
						>
							{t('dismissQuotaBlocked')}
						</button>
					</div>
				{/if}
			</div>

		{:else if attention.method === 'select'}
			<div class="options-vertical">
				{#each attention.options as opt, optIdx (optIdx)}
					<button
						class="btn btn-secondary option-btn"
						disabled={isSubmitting}
						onclick={() => handleSelectOption(opt.label)}
					>
						<span class="opt-label">{opt.label}</span>
						{#if opt.description}
							<span class="opt-desc">{opt.description}</span>
						{/if}
					</button>
				{/each}
			</div>

		{:else if attention.method === 'confirm'}
			<div class="btn-group">
				<button
					class="btn btn-primary confirm-btn"
					disabled={isSubmitting}
					onclick={() => handleConfirm(true)}
				>
					{t('yes')}
				</button>
				<button
					class="btn btn-secondary confirm-btn"
					disabled={isSubmitting}
					onclick={() => handleConfirm(false)}
				>
					{t('no')}
				</button>
			</div>

		{:else if attention.method === 'input' || attention.method === 'editor'}
			<div class="text-input-form">
				<textarea
					class="input-field text-area"
					rows={attention.method === 'editor' ? 5 : 2}
					placeholder={attention.placeholder || ''}
					bind:value={textValue}
					disabled={isSubmitting}
				></textarea>
				<div class="btn-group-end">
					<button class="btn btn-ghost" disabled={isSubmitting} onclick={handleCancel}>
						{t('cancel')}
					</button>
					<button
						class="btn btn-primary"
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
							<div class="q-header">{q.header}</div>
						{/if}
						<div class="q-title">{q.question}</div>

						<div class="q-options">
							{#each q.options as opt, optIdx (optIdx)}
								{@const isSelected = askState[q.id]?.selectedOptions.includes(opt.label)}
								{@const isRecommended = q.recommended === optIdx}

								<button
									type="button"
									class="q-opt-btn"
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
									<div class="q-opt-main">
										<span class="opt-check">{isSelected ? '✓' : '○'}</span>
										<span class="opt-label">{opt.label}</span>
										{#if isRecommended}
											<span class="recommended-tag">{t('recommendedBadge')}</span>
										{/if}
									</div>
									{#if opt.description}
										<div class="opt-desc">{opt.description}</div>
									{/if}
								</button>
							{/each}

							<!-- Opzione Altro/customInput -->
							<div class="custom-input-row">
								<input
									type="text"
									class="input-field"
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

				<div class="btn-group-end">
					<button class="btn btn-ghost" disabled={isSubmitting} onclick={handleCancel}>
						{t('cancel')}
					</button>
					<button class="btn btn-primary" disabled={isSubmitting} onclick={handleAskSubmit}>
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
		border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--line));
		border-radius: var(--radius-lg);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		box-shadow: 0 2px 8px color-mix(in srgb, var(--bg-sunken) 80%, transparent);
	}

	.attention-header {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.badge-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.attention-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 600;
		color: var(--warn);
		background: var(--warn-bg);
		padding: 3px 8px;
		border-radius: var(--radius-full);
	}

	.badge-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--warn);
	}

	.deadline-pill {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--warn);
	}

	.attention-title {
		font-size: 14px;
		font-weight: 650;
		color: var(--ink);
		line-height: 1.3;
	}

	.attention-message {
		font-size: 13px;
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.error-line {
		font-size: 12px;
		color: var(--danger);
		background: var(--danger-bg);
		padding: 6px 10px;
		border-radius: var(--radius-sm);
	}

	/* Contesto recente */
	.recent-context-block {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.context-toggle-btn {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		font-size: 12px;
		border-radius: 0;
	}

	.messages-stream {
		max-height: 200px;
		overflow-y: auto;
		padding: 8px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-top: 1px solid var(--line);
	}

	.chat-line {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 12px;
	}

	.role-badge {
		font-size: 10px;
		text-transform: uppercase;
		font-weight: 700;
		color: var(--ink-faint);
	}

	.msg-text {
		color: var(--ink);
		white-space: pre-wrap;
		word-break: break-word;
	}

	/* Azioni */
	.action-body {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.btn-group {
		display: flex;
		gap: 8px;
	}

	.btn-group-end {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 6px;
	}

	.confirm-btn {
		flex: 1;
	}

	.options-vertical {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.option-btn {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		text-align: left;
		padding: 10px 14px;
		gap: 2px;
	}

	.opt-label {
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
	}

	.opt-desc {
		font-size: 11px;
		color: var(--ink-faint);
	}

	.text-input-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.text-area {
		resize: vertical;
		font-family: var(--font-ui);
	}

	/* Ask form */
	.ask-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.question-block {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.q-header {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.q-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
	}

	.q-options {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.q-opt-btn {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 10px 12px;
		text-align: left;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 4px;
		transition: border-color var(--dur-fast), background var(--dur-fast);
	}

	.q-opt-btn.selected {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 10%, var(--bg-sunken));
	}

	.q-opt-main {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.opt-check {
		font-size: 13px;
		color: var(--brand);
	}

	.recommended-tag {
		font-size: 10px;
		font-weight: 650;
		color: var(--success);
		background: color-mix(in srgb, var(--success) 14%, transparent);
		padding: 2px 6px;
		border-radius: var(--radius-full);
	}

	.custom-input-row {
		margin-top: 4px;
	}
</style>
