<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import Switch from '$lib/ui/Switch.svelte';
</script>

<div class="settings-section">
	<div class="section-header">
		<h4>{m.ui_accessibilitysection_accessibilita_e_movimento_1c87()}</h4>
		<button type="button" class="ui-button ui-button-secondary" onclick={() => settingsStore.reset('accessibility')}>Ripristina</button>
	</div>

	<div class="section-block">
		<span class="block-title">Movimento e Animazioni</span>
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span id="settings-accel-anim-label" class="form-row-label">Animazioni e transizioni dell'interfaccia</span>
					<span id="settings-accel-anim-desc" class="form-row-desc">Abilita animazioni fluide, caricamenti graduali (staggered) e transizioni di reveal. Disattiva per una risposta visiva istantanea o per ridurre l'impegno della GPU.</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="settings-accel-anim"
						checked={settingsStore.accessibility.animations}
						ariaLabelledBy="settings-accel-anim-label"
						ariaDescribedBy="settings-accel-anim-desc"
						onChange={(checked) => settingsStore.patchAccessibility({ animations: checked })}
					/>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--line);
	}

	.section-header h4 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.section-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.block-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		text-transform: none;
		letter-spacing: normal;
	}

	.section-group {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		overflow: hidden;
	}

	.form-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3);
		border-bottom: 1px solid var(--line);
	}

	.form-row:last-child {
		border-bottom: none;
	}

	.form-row-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.form-row-label {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.form-row-control {
		flex-shrink: 0;
	}

</style>
