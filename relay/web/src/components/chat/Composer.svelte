<!--
  Composer.svelte — Riquadro di immissione comandi e prompt ancorato in basso.
  Auto-growing textarea nella sagoma .composer-shell, pulsante di invio, stop di emergenza,
  selettore steer/follow-up durante il turno, e riga di stato monospazio.
  Fedele a src/lib/agent/components/Composer.svelte di Studio.
-->
<script lang="ts">
	import { t } from '../../i18n.ts';
	import { IconArrowUp, IconStop } from '../../icons.ts';
	import ComposerStatusLine from './ComposerStatusLine.svelte';

	let {
		isWorking = false,
		disabled = false,
		disabledReason = null,
		canSessionControl = true,
		modelLabel = null,
		machineName = '',
		onSend,
		onStop
	}: {
		isWorking?: boolean;
		disabled?: boolean;
		disabledReason?: string | null;
		canSessionControl?: boolean;
		modelLabel?: string | null;
		machineName?: string;
		onSend: (text: string, whileBusy: 'steer' | 'follow_up') => Promise<void>;
		onStop: () => Promise<void>;
	} = $props();

	let inputText = $state('');
	let whileBusy = $state<'steer' | 'follow_up'>('steer');
	let isSending = $state(false);
	let isStopping = $state(false);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	const canSubmit = $derived(!disabled && !isSending && inputText.trim().length > 0 && canSessionControl);

	function adjustHeight(): void {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		const next = Math.min(textareaEl.scrollHeight, 180);
		textareaEl.style.height = `${next}px`;
	}

	async function handleSubmit(): Promise<void> {
		const text = inputText.trim();
		if (!text || isSending || disabled || !canSessionControl) return;

		isSending = true;
		try {
			await onSend(text, whileBusy);
			inputText = '';
			if (textareaEl) {
				textareaEl.style.height = 'auto';
			}
		} finally {
			isSending = false;
		}
	}

	async function handleStop(): Promise<void> {
		if (isStopping || !canSessionControl) return;
		isStopping = true;
		try {
			await onStop();
		} finally {
			isStopping = false;
		}
	}

	function handleKeydown(e: KeyboardEvent): void {
		// Cmd+Enter o Ctrl+Enter inviano sempre
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void handleSubmit();
			return;
		}

		// Su desktop (senza puntatore coarse): Invio invia, Shift+Invio va a capo
		const isCoarsePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
		if (e.key === 'Enter' && !e.shiftKey && !isCoarsePointer) {
			e.preventDefault();
			void handleSubmit();
		}
	}
</script>

<div class="composer-root">
	<div class="composer-shell" class:disabled>
		{#if disabled && disabledReason}
			<div class="disabled-notice" role="alert">
				<span>{disabledReason}</span>
			</div>
		{/if}

		<textarea
			bind:this={textareaEl}
			bind:value={inputText}
			oninput={adjustHeight}
			onkeydown={handleKeydown}
			disabled={disabled || !canSessionControl}
			placeholder={disabled ? (disabledReason ?? t('composerDisabled')) : t('chatInputPlaceholder')}
			rows={1}
			class="composer-textarea"
			aria-label={t('chatInputPlaceholder')}
		></textarea>

		<div class="composer-toolbar">
			{#if isWorking && canSessionControl}
				<div class="steer-segmented" role="radiogroup" aria-label="Modalita di invio turno">
					<button
						type="button"
						class="ui-chip segment-chip"
						class:active={whileBusy === 'steer'}
						role="radio"
						aria-checked={whileBusy === 'steer'}
						onclick={() => (whileBusy = 'steer')}
						title={t('chatSteerHint')}
					>
						{t('steerOption')}
					</button>
					<button
						type="button"
						class="ui-chip segment-chip"
						class:active={whileBusy === 'follow_up'}
						role="radio"
						aria-checked={whileBusy === 'follow_up'}
						onclick={() => (whileBusy = 'follow_up')}
						title={t('chatFollowUpHint')}
					>
						{t('followUpOption')}
					</button>
				</div>
			{/if}

			<div class="toolbar-actions">
				{#if isWorking && canSessionControl}
					<button
						type="button"
						class="composer-send-btn stop-btn"
						disabled={isStopping}
						onclick={handleStop}
						title={t('stopButton')}
						aria-label={t('stopButton')}
					>
						<IconStop />
					</button>
				{/if}

				<button
					type="button"
					class="composer-send-btn"
					disabled={!canSubmit}
					onclick={handleSubmit}
					title={t('send')}
					aria-label={t('send')}
				>
					<IconArrowUp />
				</button>
			</div>
		</div>
	</div>

	<ComposerStatusLine {modelLabel} {machineName} />
</div>

<style>
	.composer-root {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.composer-shell {
		position: relative;
		width: 100%;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-2xl);
		box-shadow: var(--shadow-dock);
		display: flex;
		flex-direction: column;
		transition:
			border-color var(--dur-fast) var(--ease-out),
			box-shadow var(--dur-fast) var(--ease-out);
		overflow: hidden;
	}

	.composer-shell:focus-within {
		border-color: var(--line-strong);
	}

	.composer-shell.disabled {
		opacity: 0.75;
		background: var(--bg-sunken);
	}

	.disabled-notice {
		padding: 6px 12px;
		background: color-mix(in oklch, var(--warn) 10%, transparent);
		border-bottom: 1px solid var(--line);
		font-size: var(--text-caption);
		color: var(--warn);
	}

	.composer-textarea {
		width: 100%;
		min-height: 44px;
		max-height: 180px;
		padding: 12px 14px 6px;
		background: transparent;
		border: none;
		outline: none;
		resize: none;
		font-family: var(--font-ui);
		font-size: var(--text-chat);
		line-height: 22px;
		color: var(--ink);
		box-sizing: border-box;
	}

	.composer-textarea::placeholder {
		color: var(--ink-faint);
	}

	.composer-textarea:disabled {
		cursor: not-allowed;
	}

	.composer-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 10px 10px;
		gap: var(--space-2);
	}

	.steer-segmented {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px;
		background: var(--bg-hover);
		border-radius: var(--radius-full);
	}

	.segment-chip {
		height: 24px;
		padding: 0 10px;
		border-radius: var(--radius-full);
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-faint);
		background: transparent;
		border: none;
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.segment-chip.active {
		background: var(--bg-raised);
		color: var(--ink);
		box-shadow: var(--shadow-overlay);
	}

	.toolbar-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.stop-btn {
		background: var(--danger) !important;
		color: var(--on-danger, #ffffff) !important;
	}

	.stop-btn:hover:not(:disabled) {
		background: color-mix(in oklch, var(--danger) 85%, black) !important;
	}

	@media (pointer: coarse) {
		.segment-chip {
			min-height: 32px;
			padding: 0 12px;
		}
	}
</style>
