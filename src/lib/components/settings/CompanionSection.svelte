<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { settingsStore, type CompanionSpotlightDismiss } from '$lib/stores/settings.svelte';

	const SPOTLIGHT_OPTIONS: {
		id: CompanionSpotlightDismiss;
		label: () => string;
		desc: () => string;
	}[] = [
		{
			id: 'esc-only',
			label: () => m.settings_companion_spotlight_esc_only(),
			desc: () => m.settings_companion_spotlight_esc_only_desc()
		},
		{
			id: 'esc-and-blur',
			label: () => m.settings_companion_spotlight_esc_blur(),
			desc: () => m.settings_companion_spotlight_esc_blur_desc()
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
					{m.settings_companion_spotlight_desc()}
				</span>
			</div>
		</div>

		<div class="layout-variant-grid spotlight-grid" role="radiogroup" aria-label={m.settings_companion_spotlight_title()}>
			{#each SPOTLIGHT_OPTIONS as opt (opt.id)}
				<label class="ui-choice">
					<div class="card-radio-head">
						<input
							type="radio"
							name="settings-companion-spotlight"
							value={opt.id}
							checked={settingsStore.appearance.companionSpotlightDismiss === opt.id}
							onchange={() => setSpotlightDismiss(opt.id)}
						/>
						<span class="variant-title">{opt.label()}</span>
					</div>
					<p class="variant-desc">{opt.desc()}</p>
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
				</label>
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
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		text-transform: none;
		letter-spacing: normal;
	}

	.block-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
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

	.card-radio-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.variant-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.variant-desc {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.variant-preview {
		margin-top: auto;
		display: flex;
		align-items: center;
		width: 100%;
	}

	.ui-choice:hover .spotlight-mini-preview {
		border-color: var(--line-strong);
	}

	.ui-choice:has(input:checked) .spotlight-mini-preview {
		border-color: var(--brand);
		background: color-mix(in oklab, var(--brand) 15%, var(--bg-sunken));
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
		transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
	}

	.spotlight-mini-preview kbd {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line-strong);
		background: var(--bg-sunken);
		color: var(--ink);
	}

	.spotlight-sep {
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.spotlight-blur {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1px dashed var(--line-strong);
		background: color-mix(in oklab, var(--ink-faint) 12%, transparent);
	}
</style>
