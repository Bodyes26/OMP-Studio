<script module lang="ts">
	export type QuotaRowVariant = 'telemetry' | 'radial';
</script>

<script lang="ts">
	import type { QuotaTone } from '$lib/quota/resolve';

	// Raggio e circonferenza esatta dell'indicatore radiale (2 * PI * r)
	const RADIUS = 13;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

	let {
		variant = 'telemetry',
		label = '',
		remainingPercent = 0,
		tone = 'ok',
		resetCountdown = '',
		resetExact = '',
		valueText = '',
		delayIndex = 0
	} = $props<{
		variant?: QuotaRowVariant;
		label?: string;
		remainingPercent?: number;
		tone?: QuotaTone;
		resetCountdown?: string;
		resetExact?: string;
		valueText?: string;
		delayIndex?: number;
	}>();

	// Nessun gate JS sull'animazione: `requestAnimationFrame` viene sospeso quando la
	// finestra non e' in primo piano, e la barra resterebbe a zero fino al ritorno del
	// fuoco. La comparsa e' un keyframe CSS (da zero al valore) e gli aggiornamenti di
	// quota a popover aperto sono coperti dalla transizione sulla stessa proprieta'.
	const fillScale = $derived(Math.max(0, Math.min(100, remainingPercent)) / 100);
	const dashOffset = $derived(CIRCUMFERENCE * (1 - fillScale));

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
	data-variant={variant}
	data-tone={tone}
	style="--row-delay: {delayIndex}; --fill-scale: {fillScale}; --dash-full: {CIRCUMFERENCE}; --dash-offset: {dashOffset};"
>
	{#if variant === 'telemetry'}
		<!-- Variante Telemetria: riga superiore tecnica con label e stato/percentuale monospace -->
		<div class="telemetry-top">
			<span class="telemetry-label" title={label}>{label}</span>
			<span class="telemetry-readout">
				<span class="status-token">{statusText}</span>
				<span class="separator" aria-hidden="true"> · </span>
				<span class="value-token">{displayValue}</span>
			</span>
		</div>

		<!-- Barra di consumo: track a tratteggio 45deg e fill trasformato su scala X -->
		<div
			class="telemetry-bar"
			role="meter"
			aria-valuenow={remainingPercent}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-label={meterAriaLabel}
			aria-valuetext={meterAriaValueText}
		>
			<span class="telemetry-fill" aria-hidden="true"></span>
		</div>

		<!-- Riga inferiore facoltativa col countdown di ripristino -->
		{#if resetCountdown}
			<div class="telemetry-bottom" title={resetExact || undefined}>
				reset {resetCountdown}
			</div>
		{/if}
	{:else}
		<!-- Variante Radiale: gauge circolare a sinistra e dettagli testuali a destra -->
		<div class="radial-layout">
			<svg
				class="radial-gauge"
				width="32"
				height="32"
				viewBox="0 0 32 32"
				role="meter"
				aria-valuenow={remainingPercent}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label={meterAriaLabel}
				aria-valuetext={meterAriaValueText}
			>
				<circle
					class="radial-track"
					cx="16"
					cy="16"
					r={RADIUS}
					fill="none"
					stroke-width="3.5"
				/>
				<circle
					class="radial-fill"
					cx="16"
					cy="16"
					r={RADIUS}
					fill="none"
					stroke-width="3.5"
					stroke-linecap="round"
					stroke-dasharray={CIRCUMFERENCE}
					stroke-dashoffset={dashOffset}
					transform="rotate(-90 16 16)"
				/>
			</svg>

			<div class="radial-info">
				<div class="radial-label" title={label}>{label}</div>
				<div class="radial-meta">
					<span class="radial-value">{displayValue}</span>
					<span class="radial-available">disponibile</span>
					{#if resetCountdown}
						<span class="radial-reset" title={resetExact || undefined}>
							· reset {resetCountdown}
						</span>
					{/if}
					{#if tone !== 'ok'}
						<span class="radial-badge" aria-hidden="true">{statusText}</span>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* --- Risoluzione del colore di riga con i fallback ESATTI del contratto --- */
	.quota-limit-row[data-tone='ok'] {
		--row-color: var(--quota-ok, var(--ink-muted));
	}

	.quota-limit-row[data-tone='warn'] {
		--row-color: var(--quota-warn, var(--warn, #f59e0b));
	}

	.quota-limit-row[data-tone='bad'] {
		--row-color: var(--quota-bad, var(--brand, #ef4444));
	}

	.quota-limit-row {
		display: block;
		width: 100%;
	}

	/* --- Variante Telemetria --- */
	.telemetry-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.telemetry-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
	}

	.telemetry-readout {
		flex-shrink: 0;
		white-space: nowrap;
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

	.telemetry-bar {
		position: relative;
		height: 5px;
		margin-top: var(--space-1);
		border-radius: var(--radius-full);
		overflow: hidden;
		background-color: color-mix(in srgb, var(--ink) 7%, transparent);
		background-image: repeating-linear-gradient(
			45deg,
			color-mix(in srgb, var(--ink) 18%, transparent) 0,
			color-mix(in srgb, var(--ink) 18%, transparent) 2px,
			transparent 2px,
			transparent 4px
		);
	}

	.telemetry-fill {
		position: absolute;
		inset: 0;
		transform-origin: left center;
		transform: scaleX(var(--fill-scale, 0));
		background: var(--row-color);
		border-radius: inherit;
		/* La transizione copre gli aggiornamenti di quota mentre il popover e' aperto. */
		transition: transform var(--dur-calm) cubic-bezier(0.16, 1, 0.3, 1);
		/* La comparsa parte da zero e si ferma sul valore reale: nessun salto al termine. */
		animation: quota-fill-in var(--dur-calm) cubic-bezier(0.16, 1, 0.3, 1)
			calc(min(var(--row-delay, 0), 8) * 40ms) both;
	}

	@keyframes quota-fill-in {
		from {
			transform: scaleX(0);
		}
		to {
			transform: scaleX(var(--fill-scale, 0));
		}
	}

	.telemetry-bottom {
		margin-top: 3px;
		font-family: var(--font-mono);
		/* Un gradino sotto l'etichetta: il countdown e' contesto, non intestazione. */
		font-size: calc(var(--text-xs) - 1px);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--ink-faint);
		opacity: 0.85;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* --- Variante Radiale --- */
	.radial-layout {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.radial-gauge {
		flex-shrink: 0;
		display: block;
	}

	.radial-track {
		stroke: color-mix(in srgb, var(--ink) 12%, transparent);
	}

	.radial-fill {
		stroke: var(--row-color);
		transition: stroke-dashoffset var(--dur-calm) cubic-bezier(0.16, 1, 0.3, 1);
		animation: quota-arc-in var(--dur-calm) cubic-bezier(0.16, 1, 0.3, 1)
			calc(min(var(--row-delay, 0), 8) * 40ms) both;
	}

	/* L'arco si carica dal vuoto (offset pieno) fino al residuo reale. */
	@keyframes quota-arc-in {
		from {
			stroke-dashoffset: var(--dash-full);
		}
		to {
			stroke-dashoffset: var(--dash-offset);
		}
	}

	.radial-info {
		min-width: 0;
		flex: 1;
	}

	.radial-label {
		font-size: var(--text-sm);
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.25;
	}

	.radial-meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-top: 2px;
		font-size: var(--text-xs);
		line-height: 1.3;
	}

	.radial-value {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ink);
		font-weight: 500;
	}

	.radial-available,
	.radial-reset {
		color: var(--ink-faint);
	}

	.radial-badge {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		text-transform: uppercase;
		padding: 0 4px;
		border-radius: var(--radius-sm);
		border: 1px solid color-mix(in srgb, var(--row-color) 45%, transparent);
		background-color: color-mix(in srgb, var(--row-color) 12%, transparent);
		color: var(--row-color);
		font-weight: 600;
		letter-spacing: 0.04em;
		line-height: 1.3;
	}
</style>
