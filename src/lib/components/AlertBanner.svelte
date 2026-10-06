<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { onDestroy, type Snippet } from 'svelte';
	import {
		IconChevronRight,
		IconCircleAlert,
		IconCircleCheck,
		IconClose,
		IconInfo,
		IconWarning
	} from '$lib/icons';
	import { chatReveal } from '$lib/agent/motion';
	import { Lingering } from '$lib/agent/motionState.svelte';

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
		retryLabel = m.alert_retry(),
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

	// Il dettaglio si piega in altezza come le sezioni (tray-in/tray-out) alla
	// durata delle righe: Lingering lo tiene in vita per l'uscita.
	const DETAIL_EXIT_MS = 210;
	let showDetails = $state(false);
	const detailLinger = new Lingering<true>(DETAIL_EXIT_MS);
	$effect(() => {
		detailLinger.update(showDetails ? true : undefined);
	});
	onDestroy(() => detailLinger.dispose());

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
			setTimeout(() => (copied = false), 1500);
		} catch (e) {
			console.error('Impossibile copiare negli appunti:', e);
		}
	}
</script>

<!-- Superficie neutra (Outcome-Only Color Rule): il colore della variante sta
     solo nell'icona. Entra ed esce piegando l'altezza, perche' spinge il
     contenuto che sta sotto; l'uscita la decide il genitore, quindi serve la
     transizione JS gemella di tray (chatReveal) e non la classe CSS. -->
<div
	class="alert-banner variant-{variant}"
	role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
	aria-live={variant === 'error' ? 'assertive' : 'polite'}
	transition:chatReveal={{ blur: 6, distance: 0 }}
>
	<div class="alert-main">
		<span class="alert-icon" aria-hidden="true">
			{#if variant === 'error'}
				<IconCircleAlert />
			{:else if variant === 'warning'}
				<IconWarning />
			{:else if variant === 'success'}
				<IconCircleCheck />
			{:else}
				<IconInfo />
			{/if}
		</span>

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
				<button
					type="button"
					class="btn-text"
					onclick={() => (showDetails = !showDetails)}
					aria-expanded={showDetails}
				>
					<span class="chevron" class:open={showDetails}><IconChevronRight /></span>
					{showDetails ? m.ui_alertbanner_nascondi_dettagli_diagnostici_5c68() : m.ui_alertbanner_mostra_dettagli_diagnostici_67fe()}
				</button>

				{#if detailLinger.shown}
					<div class="diagnostic-fold {detailLinger.leaving ? 'tray-out' : 'tray-in'}">
						<div class="tray-fold-inner">
							<div class="alert-diagnostic-box">
								<div class="diagnostic-actions">
									<span class="diagnostic-label">{m.alert_diagnostic_label()}</span>
									<button
										type="button"
										class="ui-button ui-button-ghost btn-copy"
										onclick={copyDiagnostic}
										aria-label={copied ? m.alert_copied_aria() : m.ui_alertbanner_copia_dettagli_diagnostici_negli_appunti_6191()}
									>
										{copied ? m.alert_copied() : m.context_menu_item_copy()}
									</button>
								</div>
								<pre class="diagnostic-code"><code>{diagnostic}</code></pre>
							</div>
						</div>
					</div>
				{/if}
			{/if}
		</div>

		<div class="alert-actions-col">
			{#if onRetry}
				<button
					type="button"
					class="ui-button ui-button-primary"
					onclick={handleRetry}
					disabled={retrying}
				>
					{retrying ? m.ui_alertbanner_ripristino_in_corso_6d9b() : retryLabel}
				</button>
			{/if}

			{#each actions as action}
				<button
					type="button"
					class="ui-button ui-button-{action.variant ?? 'secondary'}"
					onclick={action.onClick}
					disabled={action.disabled || action.loading}
				>
					{action.loading ? m.alert_wait() : action.label}
				</button>
			{/each}

			{#if dismissible && onDismiss}
					<button
						type="button"
						class="btn-close"
						onclick={onDismiss}
						aria-label={m.common_close()}
					>
						<IconClose />
					</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.alert-banner {
		position: relative;
		box-sizing: border-box;
		padding: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: var(--bg-raised);
		font-family: var(--font-ui);
		font-size: var(--text-body);
		line-height: 1.45;
	}

	.alert-main {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
	}

	/* Alta quanto la prima riga del titolo: l'icona si allinea al testo. */
	.alert-icon {
		flex-shrink: 0;
		display: grid;
		place-items: center;
		height: 19px;
		--icon-size: 16px;
		color: var(--ink-muted);
	}

	.variant-error .alert-icon {
		color: var(--danger);
	}

	.variant-warning .alert-icon {
		color: var(--warn);
	}

	.variant-success .alert-icon {
		color: var(--success);
	}

	.alert-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.alert-title {
		font-weight: 600;
		color: var(--ink);
	}

	.alert-message {
		color: var(--ink-muted);
		font-size: var(--text-label);
		word-break: break-word;
	}

	.alert-custom-content {
		margin-top: var(--space-1);
	}

	.btn-text {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		margin-top: var(--space-1);
		padding: 0;
		background: none;
		border: none;
		font-family: inherit;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease-out);
	}

	.btn-text:hover {
		color: var(--ink);
	}

	.chevron {
		display: inline-grid;
		--icon-size: 12px;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.chevron.open {
		transform: rotate(90deg);
	}

	.diagnostic-fold {
		--dur-tray: var(--dur-row);
	}

	.alert-diagnostic-box {
		margin-top: var(--space-1);
		padding: 6px var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}

	.diagnostic-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-1);
	}

	.diagnostic-label {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-faint);
	}

	.btn-copy {
		height: 22px;
		padding: 0 var(--space-2);
		font-size: var(--text-caption);
	}

	.diagnostic-code {
		margin: 0;
		max-height: 120px;
		overflow-y: auto;
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		line-height: 1.5;
		color: var(--ink-muted);
		white-space: pre-wrap;
		word-break: break-all;
	}

	.alert-actions-col {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-left: auto;
	}

	.btn-close {
		width: 28px;
		height: 28px;
		display: inline-grid;
		place-items: center;
		padding: 0;
		background: none;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink-faint);
		cursor: pointer;
		--icon-size: 14px;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.btn-close:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}
</style>
