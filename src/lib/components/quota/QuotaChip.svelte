<script lang="ts">
	import type { QuotaChipVariant } from '$lib/stores/settings.svelte';
	import type { QuotaSemanticStatus, QuotaLongWindowAlert } from '$lib/stores/activeQuota.svelte';
	import { IconWarning, IconQuota } from '$lib/icons';

	let {
		variant = 'ringHalo',
		showProvider = true,
		alwaysShowPct = false,
		status = 'ok',
		remainingPct = null,
		usedPct = 0,
		shortName = '',
		hasLimits = false,
		title = '',
		ariaLabel = '',
		onclick,
		interactive = true,
		class: className = '',
		longWindowAlert = null,
		accountEmail
	} = $props<{
		variant?: QuotaChipVariant;
		showProvider?: boolean;
		alwaysShowPct?: boolean;
		status?: QuotaSemanticStatus;
		remainingPct?: number | null;
		usedPct?: number;
		shortName?: string;
		hasLimits?: boolean;
		title?: string;
		ariaLabel?: string;
		onclick?: (e: MouseEvent) => void;
		interactive?: boolean;
		class?: string;
		longWindowAlert?: QuotaLongWindowAlert | null;
		accountEmail?: string;
	}>();

	// Calcoli geometrici per l'anello circolare SVG (raggio = 6.5px, perimetro = ~40.84px).
	// Allineato alla semantica "pieno = quota disponibile" usando remainingPct invece di usedPct.
	const RING_RADIUS = 6.5;
	const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

	const clampedRemaining = $derived(Math.max(0, Math.min(100, remainingPct ?? 0)));
	const strokeFilled = $derived((clampedRemaining / 100) * CIRCUMFERENCE);

	const showPct = $derived(
		hasLimits && remainingPct !== null && (alwaysShowPct || status !== 'ok')
	);
</script>

{#if status === 'exhausted'}
	<button
		type="button"
		class="quota-chip status-exhausted status-bad {className}"
		{title}
		aria-label={ariaLabel || 'Quota esaurita'}
		disabled={!interactive}
		onclick={(e) => {
			if (interactive) onclick?.(e);
		}}
	>
		<IconWarning />
		<span class="chip-label">Quota esaurita</span>
		{#if showProvider && shortName}
			<span class="provider-label">· {shortName}</span>
		{/if}
		{#if longWindowAlert}
			<span
				class="secondary-alert-dot alert-{longWindowAlert.status}"
				aria-hidden="true"
			></span>
		{/if}
	</button>
{:else if status === 'offline'}
	<button
		type="button"
		class="quota-chip status-offline {className}"
		{title}
		aria-label={ariaLabel || 'Quota offline'}
		disabled={!interactive}
		onclick={(e) => {
			if (interactive) onclick?.(e);
		}}
	>
		<IconQuota />
		<span class="chip-label">Offline</span>
		{#if showProvider && shortName}
			<span class="provider-label">· {shortName}</span>
		{/if}
	</button>
{:else if status === 'unconfigured'}
	<button
		type="button"
		class="quota-chip status-unconfigured {className}"
		{title}
		aria-label={ariaLabel || 'Quota: non configurata'}
		disabled={!interactive}
		onclick={(e) => {
			if (interactive) onclick?.(e);
		}}
	>
		<IconQuota />
		<span class="chip-label">Quota: non config.</span>
	</button>
{:else if variant === 'fillWave'}
	<!-- Variante Pill Riempita (fillWave) -->
	<button
		type="button"
		class="quota-chip fill-variant status-{status} {className}"
		class:status-bad={status === 'critical' || status === 'exhausted'}
		class:has-halo={status !== 'ok'}
		class:critical-breathe={status === 'critical'}
		{title}
		aria-label={ariaLabel || `Quota ${shortName ? `${shortName} ` : ''}${remainingPct !== null ? `${remainingPct}%` : ''}`}
		disabled={!interactive}
		onclick={(e) => {
			if (interactive) onclick?.(e);
		}}
	>
		{#if hasLimits && remainingPct !== null}
			<!-- Livello fluido a larghezza dinamica -->
			<span
				class="fill-liquid"
				style="width: {remainingPct}%;"
				aria-hidden="true"
			></span>
			<!-- Menisco luminoso animato all'apice del riempimento -->
			<span
				class="fill-meniscus"
				style="left: {remainingPct}%;"
				aria-hidden="true"
			></span>
		{/if}

		<span class="chip-content">
			{#if !hasLimits}
				<IconQuota />
			{/if}
			<span class="chip-label">Quota</span>
			{#if showProvider && shortName}
				<span class="provider-label">· {shortName}</span>
			{/if}
			{#if showPct && remainingPct !== null}
				<span class="pct-value">{remainingPct}%</span>
			{/if}
		</span>
		{#if longWindowAlert}
			<span
				class="secondary-alert-dot alert-{longWindowAlert.status}"
				aria-hidden="true"
			></span>
		{/if}
	</button>
{:else}
	<!-- Variante Anello Progressivo (ringHalo) -->
	<button
		type="button"
		class="quota-chip ring-variant status-{status} {className}"
		class:status-bad={status === 'critical' || status === 'exhausted'}
		class:has-halo={status !== 'ok'}
		class:critical-breathe={status === 'critical'}
		{title}
		aria-label={ariaLabel || `Quota ${shortName ? `${shortName} ` : ''}${remainingPct !== null ? `${remainingPct}%` : ''}`}
		disabled={!interactive}
		onclick={(e) => {
			if (interactive) onclick?.(e);
		}}
	>
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

		<span class="chip-label">Quota</span>
		{#if showProvider && shortName}
			<span class="provider-label">· {shortName}</span>
		{/if}
		{#if showPct && remainingPct !== null}
			<span class="pct-value">{remainingPct}%</span>
		{/if}
		{#if longWindowAlert}
			<span
				class="secondary-alert-dot alert-{longWindowAlert.status}"
				aria-hidden="true"
			></span>
		{/if}
	</button>
{/if}

<style>
	.quota-chip {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--ink-muted);
		padding: 3px 10px;
		font-size: var(--text-xs);
		line-height: 1.2;
		border-radius: var(--radius-full);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.2s ease;
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

	.chip-content {
		position: relative;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.chip-label {
		font-weight: 500;
	}

	.provider-label {
		opacity: 0.8;
		font-weight: 400;
	}

	.pct-value {
		font-family: var(--font-mono);
		font-weight: 600;
	}

	/* --- Stati semantici e variabili colore tokenizzate (C4) --- */

	.status-ok {
		--quota-chip-color: var(--quota-ok, var(--ink-muted));
		--quota-chip-fg: var(--quota-ok, currentColor);
		--quota-chip-fill: var(--quota-ok-fill, color-mix(in oklch, currentColor 14%, transparent));
		color: var(--quota-chip-color);
	}

	.status-warn {
		--quota-chip-color: var(--quota-warn, var(--warn, #f59e0b));
		--quota-chip-fg: var(--quota-warn, currentColor);
		--quota-chip-fill: var(--quota-warn-fill, color-mix(in oklch, currentColor 14%, transparent));
		color: var(--quota-chip-color);
		border-color: var(--quota-warn, var(--warn-dim, #f59e0b55));
	}

	.status-warn.has-halo {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--quota-warn, var(--warn, #f59e0b)) 20%, transparent);
	}

	.status-warn:hover:not(:disabled) {
		border-color: var(--quota-warn, var(--warn, #f59e0b));
		background: color-mix(in srgb, var(--quota-warn, var(--warn, #f59e0b)) 10%, transparent);
	}

	.status-critical,
	.status-exhausted,
	.status-bad {
		--quota-chip-color: var(--quota-bad, var(--brand, #ef4444));
		--quota-chip-fg: var(--quota-bad, currentColor);
		--quota-chip-fill: var(--quota-bad-fill, color-mix(in oklch, currentColor 14%, transparent));
		color: var(--quota-chip-color);
		border-color: var(--quota-bad, var(--brand-dim, #ef444455));
	}

	.status-critical.has-halo {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--quota-bad, var(--brand, #ef4444)) 25%, transparent);
	}

	.status-critical:hover:not(:disabled) {
		border-color: var(--quota-bad, var(--brand, #ef4444));
		background: color-mix(in srgb, var(--quota-bad, var(--brand, #ef4444)) 12%, transparent);
	}

	.status-exhausted {
		border-color: var(--quota-bad, var(--brand, #ef4444));
		background: color-mix(in srgb, var(--quota-bad, var(--brand, #ef4444)) 10%, transparent);
		animation: quota-breathe 2.6s ease-in-out infinite;
	}

	.status-exhausted:hover:not(:disabled) {
		background: color-mix(in srgb, var(--quota-bad, var(--brand, #ef4444)) 18%, transparent);
	}

	.status-offline {
		color: var(--warn, #f59e0b);
		border-color: var(--warn-dim, #f59e0b55);
		background: color-mix(in srgb, var(--warn, #f59e0b) 6%, transparent);
	}

	.status-unconfigured {
		border-color: var(--line);
		border-style: dashed;
		color: var(--ink-faint);
	}

	/* --- Variante Anello Progressivo --- */

	.ring-svg {
		flex-shrink: 0;
		transform: rotate(-90deg);
	}

	.ring-track {
		stroke: var(--line-strong, rgba(255, 255, 255, 0.15));
	}

	.ring-indicator {
		transition: stroke-dasharray 0.5s cubic-bezier(0.4, 0, 0.2, 1);
		stroke: var(--quota-chip-fg, currentColor);
	}

	.status-ok .ring-indicator {
		/* Con semaforo attivo usa --quota-ok; senza semaforo fallback alla tinta ink attenuata */
		stroke: var(--quota-ok, color-mix(in srgb, var(--ink) 65%, transparent));
	}

	/* --- Variante Pill Riempita (fillWave) --- */

	.fill-variant {
		overflow: hidden;
	}

	.fill-liquid {
		position: absolute;
		inset-block: 0;
		left: 0;
		transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
		pointer-events: none;
		/* IMPORTANTE: nessun opacity supplementare, il token porta gia' la propria alpha */
		background: var(--quota-chip-fill, color-mix(in oklch, currentColor 14%, transparent));
	}

	.fill-meniscus {
		position: absolute;
		inset-block: 0;
		width: 10px;
		transform: translateX(-50%);
		transition: left 0.6s cubic-bezier(0.4, 0, 0.2, 1);
		pointer-events: none;
		background-color: var(--quota-chip-fg, currentColor);
		opacity: 0.3;
		filter: blur(2.5px);
		animation: quota-bob 2.4s ease-in-out infinite;
	}

	.critical-breathe {
		animation: quota-breathe 2.6s ease-in-out infinite;
	}

	/* --- Indicatore secondario finestra lunga critica (C3/C4) --- */

	.secondary-alert-dot {
		position: absolute;
		top: 2px;
		right: 5px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		pointer-events: none;
		z-index: 2;
		box-shadow: 0 0 0 1px var(--bg-overlay, var(--bg-surface, #1e1e1e));
	}

	.secondary-alert-dot.alert-warn {
		background-color: var(--quota-warn, var(--warn, #f59e0b));
	}

	.secondary-alert-dot.alert-critical,
	.secondary-alert-dot.alert-exhausted {
		background-color: var(--quota-bad, var(--brand, #ef4444));
		animation: quota-dot-pulse 2s ease-in-out infinite;
	}

	@keyframes quota-dot-pulse {
		0%, 100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.4;
			transform: scale(0.85);
		}
	}

	/* Rispetto dell'attributo accessibilita' data-animations */
	:global([data-animations='false']) .secondary-alert-dot,
	:global([data-animations='false']) .fill-meniscus,
	:global([data-animations='false']) .critical-breathe,
	:global([data-animations='false']) .status-exhausted {
		animation: none !important;
	}

	@keyframes quota-bob {
		0%, 100% {
			transform: translate(-50%, 0);
		}
		50% {
			transform: translate(-50%, -1.2px);
		}
	}

	@keyframes quota-breathe {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.65;
		}
	}
</style>
