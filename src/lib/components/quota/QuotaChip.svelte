<script lang="ts">
	import type { QuotaSemanticStatus, QuotaLongWindowAlert } from '$lib/quota/projectQuota';
	import { IconWarning, IconQuota } from '$lib/icons';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { motionReduced } from '$lib/agent/motionState.svelte';

	let {
		showProvider = true,
		alwaysShowPct = false,
		semanticColors = false,
		status = 'ok',
		remainingPct = null,
		shortName = '',
		hasLimits = false,
		title = '',
		ariaLabel = '',
		onclick,
		interactive = true,
		class: className = '',
		longWindowAlert = null
	} = $props<{
		showProvider?: boolean;
		alwaysShowPct?: boolean;
		semanticColors?: boolean;
		status?: QuotaSemanticStatus;
		remainingPct?: number | null;
		shortName?: string;
		hasLimits?: boolean;
		title?: string;
		ariaLabel?: string;
		onclick?: (e: MouseEvent) => void;
		interactive?: boolean;
		class?: string;
		longWindowAlert?: QuotaLongWindowAlert | null;
	}>();

	// Calcoli geometrici per l'anello circolare SVG (raggio = 6.5px, perimetro = ~40.84px).
	// Semantica: pieno = quota disponibile (clampedRemaining).
	const RING_RADIUS = 6.5;
	const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

	const clampedRemaining = $derived(Math.max(0, Math.min(100, remainingPct ?? 0)));
	const strokeFilled = $derived((clampedRemaining / 100) * CIRCUMFERENCE);

	const showPct = $derived(
		hasLimits && remainingPct !== null && (alwaysShowPct || status !== 'ok')
	);

	// Respiro ammesso solo se exhausted, visibile, sullo schermo, documento attivo e motion non ridotto
	let chipNode = $state<HTMLButtonElement | null>(null);
	let onScreen = $state(false);
	let pageVisible = $state(true);
	const isAnimated = $derived(onScreen && pageVisible && !motionReduced());

	$effect(() => {
		const node = chipNode;
		if (!node || status !== 'exhausted') return;
		onScreen = false;
		const updateVisibility = () => {
			pageVisible = typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true;
		};
		updateVisibility();
		const observer = new IntersectionObserver(([entry]) => {
			const style = getComputedStyle(node);
			onScreen = entry.isIntersecting && style.visibility !== 'hidden' && style.display !== 'none';
		});
		observer.observe(node);
		document.addEventListener('visibilitychange', updateVisibility);
		return () => {
			observer.disconnect();
			document.removeEventListener('visibilitychange', updateVisibility);
		};
	});

	// Etichetta accessibile descrittiva conforme a WCAG
	const computedAriaLabel = $derived.by(() => {
		if (ariaLabel) return ariaLabel;
		if (status === 'exhausted') return m.quota_chip_exhausted();
		if (status === 'offline') return m.quota_chip_offline_aria();
		if (status === 'unconfigured') return m.quota_chip_unconfigured_aria();
		// Provider e percentuale possono mancare: gli spazi doppi si richiudono.
		const pct = remainingPct !== null ? `${remainingPct}%` : '';
		let text = m.quota_chip_aria({ provider: shortName ?? '', pct }).replace(/\s+/g, ' ').trim();
		if (longWindowAlert) {
			text += m.quota_chip_long_window_aria({ label: longWindowAlert.label, pct: longWindowAlert.remainingPct });
		}
		return text;
	});

	// Tooltip testuale completo (nessun attributo title nativo sul button)
	const computedTooltip = $derived.by(() => {
		if (title) return title;
		let t = computedAriaLabel;
		if (longWindowAlert && !title) {
			t += m.quota_chip_long_window_tooltip({ label: longWindowAlert.label, pct: longWindowAlert.remainingPct });
		}
		return t;
	});
</script>

<Tooltip text={computedTooltip} disabled={!computedTooltip}>
	<button
		bind:this={chipNode}
		type="button"
		class="quota-chip status-{status} {className}"
		class:is-breathing={status === 'exhausted' && isAnimated}
		class:quota-semantic={semanticColors}
		aria-label={computedAriaLabel}
		disabled={!interactive}
		onclick={(e) => {
			if (interactive) onclick?.(e);
		}}
	>
		{#if status === 'exhausted'}
			<IconWarning />
			<span class="chip-label">{m.quota_chip_exhausted()}</span>
		{:else if status === 'offline'}
			<IconQuota />
			<span class="chip-label">{m.quota_chip_offline()}</span>
		{:else if status === 'unconfigured'}
			<IconQuota />
			<span class="chip-label">{m.quota_chip_unconfigured()}</span>
		{:else}
			{#if hasLimits}
				<svg class="ring-svg" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
					<circle
						cx="8"
						cy="8"
						r={RING_RADIUS}
						fill="none"
						stroke-width="2.2"
						class="ring-track"
					/>
					<circle
						cx="8"
						cy="8"
						r={RING_RADIUS}
						fill="none"
						stroke-width="2.2"
						stroke-linecap="round"
						stroke-dasharray="{strokeFilled} {CIRCUMFERENCE}"
						class="ring-indicator"
					/>
				</svg>
			{:else}
				<IconQuota />
			{/if}
			<span class="chip-label">{m.quota_chip_label()}</span>
		{/if}

		{#if showProvider && shortName && status !== 'unconfigured'}
			<span class="provider-label">· {shortName}</span>
		{/if}

		{#if showPct && remainingPct !== null && status !== 'exhausted' && status !== 'offline' && status !== 'unconfigured'}
			<span class="pct-value">{remainingPct}%</span>
		{/if}

		{#if longWindowAlert}
			<span
				class="secondary-alert-dot alert-{longWindowAlert.status}"
				aria-hidden="true"
			></span>
			<span class="sr-only">{m.quota_chip_long_window_sr({ label: longWindowAlert.label, pct: longWindowAlert.remainingPct })}</span>
		{/if}
	</button>
</Tooltip>

<style>
	.quota-chip {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--ink-muted);
		padding: 3px 8px;
		font-size: var(--text-xs);
		line-height: 1.2;
		border-radius: var(--radius-md);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		transition: color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			background var(--dur-fast) var(--ease-out);
		user-select: none;
		position: relative;
	}

	.quota-chip:hover:not(:disabled) {
		color: var(--ink);
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	.quota-chip:disabled {
		cursor: default;
	}

	.chip-label {
		font-weight: 500;
	}

	.provider-label {
		font-weight: 400;
	}

	.pct-value {
		font-family: var(--font-mono);
		font-weight: 600;
	}

	/* --- Stati semantici conformi alle regole token (C4) --- */

	.status-ok {
		color: var(--quota-ok, var(--ink-muted));
	}

	.status-ok .ring-indicator {
		stroke: var(--quota-ok, var(--ink-muted));
	}

	.status-warn {
		color: var(--warn);
		border-color: var(--warn-dim);
	}

	.status-warn .ring-indicator {
		stroke: var(--warn);
	}

	.status-warn:hover:not(:disabled) {
		border-color: var(--warn);
		background: color-mix(in srgb, var(--warn) 10%, transparent);
	}

	.status-critical {
		color: var(--danger);
		border-color: var(--danger-dim);
	}

	.status-critical .ring-indicator {
		stroke: var(--danger);
	}

	.status-critical:hover:not(:disabled) {
		border-color: var(--danger);
		background: color-mix(in srgb, var(--danger) 12%, transparent);
	}

	.status-exhausted {
		color: var(--danger);
		border-color: var(--danger-dim);
		background: color-mix(in srgb, var(--danger) 10%, transparent);
	}

	.status-exhausted.is-breathing {
		animation: quota-breathe 2.6s ease-in-out infinite;
	}

	.status-exhausted:hover:not(:disabled) {
		background: color-mix(in srgb, var(--danger) 18%, transparent);
	}
	.status-offline {
		color: var(--ink-muted);
		border-color: var(--line);
		background: transparent;
	}

	.status-offline :global(svg) {
		color: var(--warn);
	}

	.status-unconfigured {
		border-color: var(--line);
		border-style: dashed;
		color: var(--ink-faint);
	}

	/* --- Anello Progressivo Singolo --- */

	.ring-svg {
		flex-shrink: 0;
		transform: rotate(-90deg);
	}

	.ring-track {
		stroke: var(--line-strong);
	}

	.ring-indicator {
		transition: stroke-dasharray var(--dur-fast) var(--ease-reveal);
	}

	/* --- Indicatore secondario finestra lunga (segnale statico senza pulse infinito) --- */

	.secondary-alert-dot {
		position: absolute;
		top: 2px;
		right: 4px;
		width: 5px;
		height: 5px;
		border-radius: var(--radius-full);
		border: 1px solid var(--bg-overlay);
		pointer-events: none;
	}

	.secondary-alert-dot.alert-warn {
		background-color: var(--warn);
	}

	.secondary-alert-dot.alert-critical,
	.secondary-alert-dot.alert-exhausted {
		background-color: var(--danger);
	}

	@keyframes quota-breathe {
		0%, 100% {
			border-color: var(--danger);
			background-color: color-mix(in srgb, var(--danger) 10%, transparent);
		}
		50% {
			border-color: var(--danger-dim);
			background-color: color-mix(in srgb, var(--danger) 4%, transparent);
		}
	}
	:global([data-animations='false']) .status-exhausted {
		animation: none !important;
	}
</style>
