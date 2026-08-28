<script lang="ts">
	import { settingsStore } from '$lib/stores/settings.svelte';
</script>

<div class="settings-section">
	<div class="section-header">
		<h4>Accessibilità e Movimento</h4>
		<button type="button" class="btn btn-secondary" onclick={() => settingsStore.reset('accessibility')}>Ripristina</button>
	</div>

	<div class="section-block">
		<span class="block-title">Movimento e Animazioni</span>
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Animazioni e transizioni dell'interfaccia</span>
					<span class="form-row-desc">Abilita animazioni fluide, caricamenti graduali (staggered) e transizioni di reveal. Disattiva per una risposta visiva istantanea o per ridurre l'impegno della GPU.</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.accessibility.animations}
							onchange={(e) => settingsStore.patchAccessibility({ animations: (e.currentTarget as HTMLInputElement).checked })}
						/>
						<span class="slider"></span>
					</label>
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
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.03em;
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
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.form-row-control {
		flex-shrink: 0;
	}

	.btn {
		height: 28px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 500;
		cursor: pointer;
		border: 1px solid transparent;
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-secondary {
		background: var(--bg-base);
		border-color: var(--line);
		color: var(--ink-muted);
	}

	.btn-secondary:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.switch {
		position: relative;
		display: inline-block;
		width: 36px;
		height: 20px;
		cursor: pointer;
	}

	.switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.slider {
		position: absolute;
		inset: 0;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.slider::before {
		position: absolute;
		content: "";
		height: 14px;
		width: 14px;
		left: 2px;
		bottom: 2px;
		background: var(--ink-muted);
		border-radius: 50%;
		transition: transform var(--dur-fast), background var(--dur-fast);
	}

	.switch input:checked + .slider {
		background: var(--brand);
		border-color: var(--brand);
	}

	.switch input:checked + .slider::before {
		transform: translateX(16px);
		background: var(--on-brand);
	}

	.switch input:focus-visible + .slider {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
</style>
