<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { settingsStore, type CompanionSpotlightDismiss } from '$lib/stores/settings.svelte';

	const SPOTLIGHT_OPTIONS: {
		id: CompanionSpotlightDismiss;
		label: () => string;
		desc: string;
	}[] = [
		{
			id: 'esc-only',
			label: () => m.settings_companion_spotlight_esc_only(),
			desc: 'Chiudi la Companion solo con il tasto Esc.'
		},
		{
			id: 'esc-and-blur',
			label: () => m.settings_companion_spotlight_esc_blur(),
			desc: 'Chiudi anche quando la finestra perde il fuoco (click fuori).'
		}
	];


	function setSpotlightDismiss(mode: CompanionSpotlightDismiss) {
		settingsStore.patchCompanionSpotlightDismiss(mode);
	}
</script>

<div class="settings-section">
	<div class="section-block">
		<div class="block-head-row">
			<div class="block-titles">
				<h4>{m.settings_companion_spotlight_title()}</h4>
				<span class="block-desc">
					In modalita Spotlight la finestra e' una superficie di comando: scegli quando nasconderla.
				</span>
			</div>
		</div>

		<div class="layout-variant-grid spotlight-grid" role="radiogroup" aria-label={m.settings_companion_spotlight_title()}>
			{#each SPOTLIGHT_OPTIONS as opt (opt.id)}
				<button
					type="button"
					class="variant-card"
					class:selected={settingsStore.appearance.companionSpotlightDismiss === opt.id}
					role="radio"
					aria-checked={settingsStore.appearance.companionSpotlightDismiss === opt.id}
					onclick={() => setSpotlightDismiss(opt.id)}
				>
					<div class="card-radio-head">
						<div class="radio-indicator">
							{#if settingsStore.appearance.companionSpotlightDismiss === opt.id}
								<span class="radio-dot"></span>
							{/if}
						</div>
						<span class="variant-title">{opt.label()}</span>
					</div>
					<p class="variant-desc">{opt.desc}</p>
					<div class="variant-preview">
						<div class="spotlight-mini-preview {opt.id}" aria-hidden="true">
							{#if opt.id === 'esc-only'}
								<kbd>Esc</kbd>
							{:else}
								<kbd>Esc</kbd>
								<span class="spotlight-sep">+</span>
								<span class="spotlight-blur"></span>
							{/if}
						</div>
					</div>
				</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-4);
	}

	.section-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.block-head-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.block-titles {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.block-titles h4 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.block-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.block-divider {
		height: 1px;
		background: var(--line);
		margin: var(--space-1) 0;
	}

	.layout-variant-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-3);
	}

	.spotlight-grid {
		grid-template-columns: repeat(2, 1fr);
	}

	@media (max-width: 640px) {
		.layout-variant-grid {
			grid-template-columns: 1fr;
		}
	}

	.variant-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		text-align: left;
		padding: var(--space-3);
		background: var(--bg-surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
		user-select: none;
	}

	.variant-card:hover {
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	.variant-card.selected {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 4%, var(--bg-surface));
		box-shadow: 0 0 0 1px var(--brand);
	}

	.card-radio-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-1);
	}

	.radio-indicator {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1.5px solid var(--line-strong);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.15s ease;
	}

	.variant-card.selected .radio-indicator {
		border-color: var(--brand);
	}

	.radio-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--brand);
	}

	.variant-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.variant-desc {
		margin: 0 0 var(--space-3) 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.variant-preview {
		margin-top: auto;
		padding-top: var(--space-2);
		display: flex;
		align-items: center;
		width: 100%;
	}

	.variant-card:hover .spotlight-mini-preview {
		border-color: var(--line-strong);
	}

	.variant-card.selected .spotlight-mini-preview {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand-tint) 15%, var(--bg-sunken));
	}

	.spotlight-mini-preview {
		width: 100%;
		height: 40px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		box-sizing: border-box;
		transition: border-color 0.15s ease;
	}

	.spotlight-mini-preview kbd {
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line-strong);
		background: var(--bg-surface);
		color: var(--ink);
	}

	.spotlight-sep {
		font-size: 10px;
		color: var(--ink-faint);
	}

	.spotlight-blur {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1px dashed var(--line-strong);
		background: color-mix(in srgb, var(--ink-faint) 12%, transparent);
	}
</style>
