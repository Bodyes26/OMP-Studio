<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import {
		settingsStore,
		type CompanionLayoutVariant,
		type CompanionSpotlightDismiss
	} from '$lib/stores/settings.svelte';

	const LAYOUT_OPTIONS: {
		id: CompanionLayoutVariant;
		label: () => string;
		desc: () => string;
	}[] = [
		{
			id: 'balanced',
			label: () => m.settings_companion_layout_balanced(),
			desc: () => m.settings_companion_layout_balanced_desc()
		},
		{
			id: 'dashboard',
			label: () => m.settings_companion_layout_dashboard(),
			desc: () => m.settings_companion_layout_dashboard_desc()
		},
		{
			id: 'inbox',
			label: () => m.settings_companion_layout_inbox(),
			desc: () => m.settings_companion_layout_inbox_desc()
		},
		{
			id: 'compact',
			label: () => m.settings_companion_layout_compact(),
			desc: () => m.settings_companion_layout_compact_desc()
		},
		{
			id: 'launcher',
			label: () => m.settings_companion_layout_launcher(),
			desc: () => m.settings_companion_layout_launcher_desc()
		}
	];

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

	function setLayout(variant: CompanionLayoutVariant) {
		settingsStore.patchCompanionLayout(variant);
	}

	function setSpotlightDismiss(mode: CompanionSpotlightDismiss) {
		settingsStore.patchCompanionSpotlightDismiss(mode);
	}
</script>

<div class="settings-section">
	<div class="section-block">
		<div class="block-head-row">
			<div class="block-titles">
				<h4>{m.settings_companion_layout_title()}</h4>
				<span class="block-desc">{m.settings_companion_layout_desc()}</span>
			</div>
		</div>

		<div class="layout-variant-grid companion-layout-grid" role="radiogroup" aria-label={m.settings_companion_layout_title()}>
			{#each LAYOUT_OPTIONS as opt (opt.id)}
				<button
					type="button"
					class="variant-card"
					class:selected={settingsStore.appearance.companionLayout === opt.id}
					role="radio"
					aria-checked={settingsStore.appearance.companionLayout === opt.id}
					onclick={() => setLayout(opt.id)}
				>
					<div class="card-radio-head">
						<div class="radio-indicator">
							{#if settingsStore.appearance.companionLayout === opt.id}
								<span class="radio-dot"></span>
							{/if}
						</div>
						<span class="variant-title">{opt.label()}</span>
					</div>
					<p class="variant-desc">{opt.desc()}</p>
					<div class="variant-preview">
						<div class="companion-mini-preview {opt.id}" aria-hidden="true">
							{#if opt.id === 'balanced'}
								<div class="mini-pane attention"></div>
								<div class="mini-pane composer"></div>
							{:else if opt.id === 'dashboard'}
								<div class="mini-tile quota"></div>
								<div class="mini-tile attention"></div>
								<div class="mini-tile queue"></div>
								<div class="mini-tile composer"></div>
							{:else if opt.id === 'inbox'}
								<div class="mini-inbox-list">
									<span></span><span></span><span></span>
								</div>
								<div class="mini-inbox-detail"></div>
							{:else if opt.id === 'compact'}
								<div class="mini-stack-line"></div>
								<div class="mini-stack-line short"></div>
								<div class="mini-stack-composer"></div>
							{:else}
								<div class="mini-launcher-composer"></div>
							{/if}
						</div>
					</div>
				</button>
			{/each}
		</div>
	</div>

	<div class="block-divider"></div>

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

	.companion-layout-grid {
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
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

	.companion-mini-preview {
		width: 100%;
		height: 52px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 4px;
		display: flex;
		gap: 3px;
		box-sizing: border-box;
		transition: border-color 0.15s ease;
	}

	.variant-card:hover .companion-mini-preview,
	.variant-card:hover .spotlight-mini-preview {
		border-color: var(--line-strong);
	}

	.variant-card.selected .companion-mini-preview,
	.variant-card.selected .spotlight-mini-preview {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand-tint) 15%, var(--bg-sunken));
	}

	.companion-mini-preview.balanced .mini-pane {
		flex: 1;
		border-radius: 2px;
		border: 1px solid var(--line);
		background: var(--bg-surface);
	}

	.companion-mini-preview.balanced .mini-pane.attention {
		background: var(--bg-raised);
	}

	.companion-mini-preview.balanced .mini-pane.composer {
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line));
	}

	.companion-mini-preview.dashboard {
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
	}

	.companion-mini-preview .mini-tile {
		border-radius: 2px;
		border: 1px solid var(--line);
		background: var(--bg-surface);
	}

	.companion-mini-preview .mini-tile.attention {
		background: var(--bg-raised);
	}

	.companion-mini-preview .mini-tile.composer {
		grid-column: 1 / -1;
		height: 12px;
	}

	.companion-mini-preview.inbox .mini-inbox-list {
		width: 38%;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.companion-mini-preview.inbox .mini-inbox-list span {
		height: 6px;
		border-radius: 2px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
	}

	.companion-mini-preview.inbox .mini-inbox-detail {
		flex: 1;
		border-radius: 2px;
		border: 1px solid var(--line);
		background: var(--bg-surface);
	}

	.companion-mini-preview.compact {
		flex-direction: column;
		gap: 2px;
		padding: 3px;
	}

	.companion-mini-preview .mini-stack-line {
		height: 5px;
		width: 85%;
		border-radius: 2px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
	}

	.companion-mini-preview .mini-stack-line.short {
		width: 55%;
	}

	.companion-mini-preview .mini-stack-composer {
		margin-top: auto;
		height: 10px;
		border-radius: 2px;
		border: 1px solid color-mix(in srgb, var(--brand) 40%, var(--line));
		background: var(--bg-surface);
	}

	.companion-mini-preview.launcher {
		align-items: center;
		justify-content: center;
		padding: 6px;
	}

	.companion-mini-preview .mini-launcher-composer {
		width: 78%;
		height: 14px;
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--brand) 45%, var(--line));
		background: var(--bg-surface);
		box-shadow: 0 1px 0 color-mix(in srgb, var(--brand) 20%, transparent);
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
