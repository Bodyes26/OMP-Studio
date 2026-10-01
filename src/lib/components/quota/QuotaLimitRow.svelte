<script lang="ts">
	import type { QuotaTone } from '$lib/quota/resolve';

	let {
		label = '',
		remainingPercent = 0,
		tone = 'ok',
		resetCountdown = '',
		resetExact = '',
		valueText = '',
		delayIndex = 0
	} = $props<{
		label?: string;
		remainingPercent?: number;
		tone?: QuotaTone;
		resetCountdown?: string;
		resetExact?: string;
		valueText?: string;
		delayIndex?: number;
	}>();

	const fillScale = $derived(Math.max(0, Math.min(100, remainingPercent)) / 100);

	// Testo dello stato per WCAG 1.4.1 (segnale non cromatico sempre presente o distintivo)
	const statusText = $derived(tone === 'bad' ? 'CRIT' : tone === 'warn' ? 'WARN' : 'OK');

	// Valore testuale formattato (se non fornito, ricade sulla percentuale residua)
	const displayValue = $derived(valueText || `${remainingPercent}%`);

	// Descrizione accessibile completa per il ruolo meter
	const meterAriaValueText = $derived(
		`${remainingPercent}% disponibile${resetCountdown ? `, reset ${resetCountdown}` : ''}`
	);
	const meterAriaLabel = $derived(label || 'Quota');
</script>

<div
	class="quota-limit-row"
	data-tone={tone}
	style="--row-delay: {delayIndex}; --fill-scale: {fillScale};"
>
	<div class="limit-top">
		<span class="limit-label" title={label}>{label}</span>
		<span class="limit-readout">
			<span class="status-token">{statusText}</span>
			<span class="separator" aria-hidden="true"> · </span>
			<span class="value-token">{displayValue}</span>
		</span>
	</div>

	<div
		class="limit-bar"
		role="meter"
		aria-valuenow={remainingPercent}
		aria-valuemin={0}
		aria-valuemax={100}
		aria-label={meterAriaLabel}
		aria-valuetext={meterAriaValueText}
	>
		<span class="limit-fill" aria-hidden="true"></span>
	</div>

	{#if resetCountdown}
		<div class="limit-bottom" title={resetExact || undefined}>
			reset {resetCountdown}
		</div>
	{/if}
</div>

<style>
	.quota-limit-row[data-tone='ok'] {
		--row-color: var(--quota-ok, var(--ink-muted));
	}

	.quota-limit-row[data-tone='warn'] {
		--row-color: var(--warn);
	}

	.quota-limit-row[data-tone='bad'] {
		--row-color: var(--danger);
	}

	.quota-limit-row {
		display: block;
		width: 100%;
	}

	.limit-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--text-label);
		line-height: 1.4;
	}

	.limit-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
		font-weight: 500;
	}

	.limit-readout {
		flex-shrink: 0;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.status-token {
		color: var(--row-color);
		font-weight: 600;
	}

	.separator {
		color: var(--ink-faint);
	}

	.value-token {
		color: var(--ink);
	}

	.limit-bar {
		position: relative;
		height: 4px;
		margin-top: var(--space-1);
		border-radius: var(--radius-full);
		overflow: hidden;
		background-color: color-mix(in srgb, var(--ink) 8%, transparent);
	}

	.limit-fill {
		position: absolute;
		inset: 0;
		transform-origin: left center;
		transform: scaleX(var(--fill-scale, 0));
		background: var(--row-color);
		border-radius: inherit;
		transition: transform var(--dur-fast) var(--ease-reveal);
		animation: quota-fill-in var(--dur-row) var(--ease-reveal)
			calc(min(var(--row-delay, 0), 8) * 40ms) both;
	}

	@keyframes quota-fill-in {
		from {
			transform: scaleX(0);
		}
	}

	.limit-bottom {
		margin-top: 3px;
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.3;
	}

	:global([data-animations='false']) .limit-fill {
		animation: none !important;
	}
</style>
