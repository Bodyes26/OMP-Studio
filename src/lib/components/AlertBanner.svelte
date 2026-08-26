<script lang="ts">
	import { fade, slide } from 'svelte/transition';
	import type { Snippet } from 'svelte';

	export type AlertVariant = 'error' | 'warning' | 'info' | 'success';

	export interface AlertAction {
		label: string;
		onClick: () => void | Promise<void>;
		variant?: 'primary' | 'secondary' | 'danger';
		disabled?: boolean;
		loading?: boolean;
	}

	let {
		variant = 'error',
		title = '',
		message = '',
		diagnostic = '',
		actions = [],
		retryLabel = 'Riprova',
		onRetry,
		onDismiss,
		dismissible = false,
		children
	} = $props<{
		variant?: AlertVariant;
		title?: string;
		message?: string;
		diagnostic?: string;
		actions?: AlertAction[];
		retryLabel?: string;
		onRetry?: () => void | Promise<void>;
		onDismiss?: () => void;
		dismissible?: boolean;
		children?: Snippet;
	}>();

	let showDetails = $state(false);
	let copied = $state(false);
	let retrying = $state(false);

	async function handleRetry() {
		if (!onRetry || retrying) return;
		retrying = true;
		try {
			await onRetry();
		} finally {
			retrying = false;
		}
	}

	async function copyDiagnostic() {
		if (!diagnostic) return;
		try {
			await navigator.clipboard.writeText(diagnostic);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch (e) {
			console.error('Impossibile copiare negli appunti:', e);
		}
	}
</script>

<div
	class="alert-banner variant-{variant}"
	role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
	aria-live={variant === 'error' ? 'assertive' : 'polite'}
	transition:fade={{ duration: 120 }}
>
	<div class="alert-main">
		<div class="alert-icon-col" aria-hidden="true">
			{#if variant === 'error'}
				<svg class="alert-icon error" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
					<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM7.25 4.5v4a.75.75 0 0 0 1.5 0v-4a.75.75 0 0 0-1.5 0Zm.75 6.75a.875.875 0 1 0 0-1.75.875.875 0 0 0 0 1.75Z"/>
				</svg>
			{:else if variant === 'warning'}
				<svg class="alert-icon warning" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
					<path d="M7.14 2.27a1 1 0 0 1 1.72 0l5.8 10.05a1 1 0 0 1-.86 1.48H2.2a1 1 0 0 1-.86-1.48l5.8-10.05Zm.86 1.5L2.94 12.3h10.12L8 3.77ZM7.25 6.5v3a.75.75 0 0 0 1.5 0v-3a.75.75 0 0 0-1.5 0Zm.75 5.25a.875.875 0 1 0 0-1.75.875.875 0 0 0 0 1.75Z"/>
				</svg>
			{:else if variant === 'success'}
				<svg class="alert-icon success" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
					<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm3.03 4.22a.75.75 0 0 0-1.06 0L7.25 9.44 5.78 7.97a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.25-3.25a.75.75 0 0 0 0-1.06Z"/>
				</svg>
			{:else}
				<svg class="alert-icon info" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
					<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM8 4.75a.875.875 0 1 0 0 1.75.875.875 0 0 0 0-1.75Zm-.75 3v3.5a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-1.5 0Z"/>
				</svg>
			{/if}
		</div>

		<div class="alert-body">
			{#if title}
				<div class="alert-title">{title}</div>
			{/if}

			{#if message}
				<div class="alert-message">{message}</div>
			{/if}

			{#if children}
				<div class="alert-custom-content">
					{@render children()}
				</div>
			{/if}

			{#if diagnostic}
				<div class="alert-diagnostic-toggle">
					<button
						type="button"
						class="btn-text"
						onclick={() => (showDetails = !showDetails)}
						aria-expanded={showDetails}
						aria-label={showDetails ? 'Nascondi dettagli diagnostici' : 'Mostra dettagli diagnostici'}
					>
						<span class="chevron" class:open={showDetails}>▶</span>
						{showDetails ? 'Nascondi dettagli diagnostici' : 'Mostra dettagli diagnostici'}
					</button>
				</div>

				{#if showDetails}
					<div class="alert-diagnostic-box" transition:slide={{ duration: 150 }}>
						<div class="diagnostic-actions">
							<span class="diagnostic-label">Dettaglio tecnico</span>
							<button
								type="button"
								class="btn-copy"
								onclick={copyDiagnostic}
								aria-label={copied ? 'Dettagli diagnostici copiati negli appunti' : 'Copia dettagli diagnostici negli appunti'}
							>
								{copied ? 'Copiato!' : 'Copia'}
							</button>
						</div>
						<pre class="diagnostic-code"><code>{diagnostic}</code></pre>
					</div>
				{/if}
			{/if}
		</div>

		<div class="alert-actions-col">
			{#if onRetry}
				<button
					type="button"
					class="btn-action primary"
					onclick={handleRetry}
					disabled={retrying}
				>
					{retrying ? 'Ripristino in corso...' : retryLabel}
				</button>
			{/if}

			{#each actions as action}
				<button
					type="button"
					class="btn-action {action.variant ?? 'secondary'}"
					onclick={action.onClick}
					disabled={action.disabled || action.loading}
				>
					{action.loading ? 'Attendere...' : action.label}
				</button>
			{/each}

			{#if dismissible && onDismiss}
				<button
					type="button"
					class="btn-close"
					onclick={onDismiss}
					aria-label="Chiudi avviso"
				>
					✕
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.alert-banner {
		position: relative;
		border-radius: var(--radius-md, 6px);
		padding: var(--space-3, 10px) var(--space-3, 12px);
		font-family: var(--font-ui, system-ui, sans-serif);
		font-size: var(--text-sm, 13px);
		line-height: 1.45;
		box-sizing: border-box;
		border: 1px solid var(--line);
		background: var(--bg-raised);
	}

	.variant-error {
		border-color: color-mix(in srgb, var(--danger) 35%, transparent);
		background: color-mix(in srgb, var(--danger) 10%, var(--bg-raised));
	}

	.variant-warning {
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
		background: color-mix(in srgb, var(--warn) 10%, var(--bg-raised));
	}

	.variant-info {
		border-color: color-mix(in srgb, var(--brand) 35%, transparent);
		background: color-mix(in srgb, var(--brand) 10%, var(--bg-raised));
	}

	.variant-success {
		border-color: color-mix(in srgb, var(--git-added, oklch(0.68 0.16 145)) 35%, transparent);
		background: color-mix(in srgb, var(--git-added, oklch(0.68 0.16 145)) 10%, var(--bg-raised));
	}

	.alert-main {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3, 10px);
	}

	.alert-icon-col {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding-top: 2px;
	}

	.alert-icon {
		display: block;
	}

	.alert-icon.error {
		color: var(--danger);
	}

	.alert-icon.warning {
		color: var(--warn);
	}

	.alert-icon.info {
		color: var(--brand-ink);
	}

	.alert-icon.success {
		color: var(--git-added, oklch(0.68 0.16 145));
	}
	.alert-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.alert-title {
		font-weight: 600;
		font-size: var(--text-sm, 13px);
		color: var(--ink);
	}

	.variant-error .alert-title {
		color: var(--danger);
	}

	.variant-warning .alert-title {
		color: var(--warn);
	}

	.variant-info .alert-title {
		color: var(--brand-ink);
	}

	.variant-success .alert-title {
		color: var(--git-added, oklch(0.68 0.16 145));
	}

	.alert-message {
		color: var(--ink);
		font-size: var(--text-xs, 12px);
		word-break: break-word;
	}

	.alert-custom-content {
		margin-top: 4px;
	}

	.alert-diagnostic-toggle {
		margin-top: 4px;
	}

	.btn-text {
		background: none;
		border: none;
		padding: 0;
		font-family: inherit;
		font-size: 11px;
		color: var(--ink-muted, #9ca3af);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.btn-text:hover {
		color: var(--ink, #f3f4f6);
	}

	.chevron {
		display: inline-block;
		font-size: 8px;
		transition: transform 0.15s ease;
	}

	.chevron.open {
		transform: rotate(90deg);
	}

	.alert-diagnostic-box {
		margin-top: 6px;
		background: var(--bg-sunken, #0f1115);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.08));
		border-radius: var(--radius-sm, 4px);
		padding: 6px 8px;
		max-width: 100%;
		overflow: hidden;
	}

	.diagnostic-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}

	.diagnostic-label {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-faint, #6b7280);
	}

	.btn-copy {
		background: var(--bg-hover, rgba(255, 255, 255, 0.06));
		border: 1px solid var(--line, rgba(255, 255, 255, 0.1));
		border-radius: 3px;
		padding: 2px 6px;
		font-size: 10px;
		color: var(--ink-muted, #9ca3af);
		cursor: pointer;
	}

	.btn-copy:hover {
		background: var(--bg-active, rgba(255, 255, 255, 0.12));
		color: var(--ink, #ffffff);
	}

	.diagnostic-code {
		margin: 0;
		padding: 0;
		font-family: var(--font-mono, monospace);
		font-size: 11px;
		line-height: 1.4;
		color: var(--ink-muted, #d1d5db);
		white-space: pre-wrap;
		word-break: break-all;
		max-height: 120px;
		overflow-y: auto;
	}

	.alert-actions-col {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2, 6px);
		margin-left: auto;
	}

	.btn-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px 10px;
		border-radius: var(--radius-sm, 4px);
		font-size: var(--text-xs, 12px);
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		border: 1px solid transparent;
		transition: background 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
		white-space: nowrap;
	}

	.btn-action.primary {
		background: var(--brand);
		color: var(--on-brand);
		font-weight: 600;
	}

	.btn-action.primary:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.btn-action.secondary {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.btn-action.secondary:hover:not(:disabled) {
		background: var(--bg-active);
	}

	.btn-action.danger {
		background: var(--danger);
		color: var(--on-danger);
	}

	.btn-action.danger:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.btn-close {
		background: none;
		border: none;
		color: var(--ink-faint);
		font-size: 13px;
		padding: 2px 4px;
		cursor: pointer;
		border-radius: 3px;
		line-height: 1;
	}

	.btn-close:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}
</style>
