<script lang="ts">
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { STANDARD_ROLES } from '$lib/stores/modelSettings.svelte';

	// Solo sei livelli: il resto della granularita' di THINKING_LEVELS serve
	// alla selezione dei modelli, non ai default di lancio di un task.
	const THINKING_LEVEL_OPTIONS = [
		{ id: 'auto', label: 'Auto' },
		{ id: 'off', label: 'Off' },
		{ id: 'low', label: 'Low' },
		{ id: 'medium', label: 'Medium' },
		{ id: 'high', label: 'High' },
		{ id: 'max', label: 'Max' }
	];

	const openProjects = $derived(projectStore.projects.filter((p) => p.path !== ''));
</script>

<div class="settings-section">
	<div class="section-block">
		<span class="block-title">Default globali dei nuovi task</span>
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Ruolo</span>
					<span class="form-row-desc">Il modello con cui parte un task appena creato, salvo override del progetto.</span>
				</div>
				<div class="form-row-control">
					<select
						value={settingsStore.taskDefaults.role}
						onchange={(e) => settingsStore.patchTaskDefaults({ role: (e.currentTarget as HTMLSelectElement).value })}
					>
						{#each STANDARD_ROLES as r (r.id)}
							<option value={r.id}>{r.label}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Livello di ragionamento</span>
					<span class="form-row-desc">Budget di pensiero assegnato al task, se il modello lo supporta.</span>
				</div>
				<div class="form-row-control">
					<select
						value={settingsStore.taskDefaults.thinkingLevel}
						onchange={(e) => settingsStore.patchTaskDefaults({ thinkingLevel: (e.currentTarget as HTMLSelectElement).value })}
					>
						{#each THINKING_LEVEL_OPTIONS as t (t.id)}
							<option value={t.id}>{t.label}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Includi contesto editor</span>
					<span class="form-row-desc">Allega l'elenco dei file aperti e l'eventuale selezione di testo attiva.</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.taskDefaults.includeEditorContext}
							onchange={(e) => settingsStore.patchTaskDefaults({ includeEditorContext: (e.currentTarget as HTMLInputElement).checked })}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</div>
		</div>

		<div class="toggles-grid">
			<label class="toggle-card" class:checked={settingsStore.taskDefaults.planMode}>
				<input
					type="checkbox"
					checked={settingsStore.taskDefaults.planMode}
					onchange={(e) => settingsStore.patchTaskDefaults({ planMode: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<div class="toggle-content">
					<div class="toggle-header">
						<span class="toggle-title">Modalità Piano</span>
						<span class="toggle-tag">Pianificazione</span>
					</div>
					<p class="toggle-desc">
						Non modifica subito i file: formula un piano dettagliato e chiede approvazione prima di eseguire.
					</p>
				</div>
			</label>

			<label class="toggle-card" class:checked={settingsStore.taskDefaults.discussionMode}>
				<input
					type="checkbox"
					checked={settingsStore.taskDefaults.discussionMode}
					onchange={(e) => settingsStore.patchTaskDefaults({ discussionMode: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<div class="toggle-content">
					<div class="toggle-header">
						<span class="toggle-title">Modalità Discussione</span>
						<span class="toggle-tag">/grill-me</span>
					</div>
					<p class="toggle-desc">
						Non tocca il codice: analizza il progetto e interroga con domande mirate prima di procedere.
					</p>
				</div>
			</label>

			<label class="toggle-card" class:checked={settingsStore.taskDefaults.minimalMode}>
				<input
					type="checkbox"
					checked={settingsStore.taskDefaults.minimalMode}
					onchange={(e) => settingsStore.patchTaskDefaults({ minimalMode: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<div class="toggle-content">
					<div class="toggle-header">
						<span class="toggle-title">Soluzione Minimale</span>
						<span class="toggle-tag">/ponytail</span>
					</div>
					<p class="toggle-desc">
						Forza la soluzione più pigra e semplice possibile: niente astrazioni o dipendenze premature.
					</p>
				</div>
			</label>

			<label class="toggle-card" class:checked={settingsStore.taskDefaults.researchMode}>
				<input
					type="checkbox"
					checked={settingsStore.taskDefaults.researchMode}
					onchange={(e) => settingsStore.patchTaskDefaults({ researchMode: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<div class="toggle-content">
					<div class="toggle-header">
						<span class="toggle-title">Modalità Ricerca Online</span>
						<span class="toggle-tag">Ricerca Web</span>
					</div>
					<p class="toggle-desc">
						Dopo aver analizzato la richiesta e il codice, cerca online documentazione e best practice prima di implementare.
					</p>
				</div>
			</label>
		</div>
	</div>

	<div class="section-block">
		<span class="block-title">Progetti aperti</span>
		{#if openProjects.length === 0}
			<p class="empty-note">Nessun progetto aperto.</p>
		{:else}
			<div class="section-group">
				{#each openProjects as p (p.id)}
					<div class="project-row">
						<div class="form-row-copy">
							<span class="form-row-label">{p.label || p.name}</span>
							<span class="form-row-desc">Avvia automaticamente il prossimo task in coda quando l'agente è libero. Vale solo per questo progetto.</span>
							{#if p.taskDefaults}
								<button type="button" class="override-reset" onclick={() => projectStore.setTaskDefaults(p.id, null)}>
									Default personalizzati per questo progetto · Azzera
								</button>
							{/if}
						</div>
						<div class="form-row-control">
							<label class="switch">
								<input
									type="checkbox"
									checked={p.autoDispatch}
									onchange={(e) => projectStore.setAutoDispatch(p.id, (e.currentTarget as HTMLInputElement).checked)}
								/>
								<span class="slider"></span>
							</label>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
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

	.empty-note {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-style: italic;
		padding: var(--space-2) 0;
	}

	.project-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3);
		border-bottom: 1px solid var(--line);
	}

	.project-row:last-child {
		border-bottom: none;
	}

	.override-reset {
		align-self: flex-start;
		margin-top: 2px;
		padding: 1px 6px;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--brand-ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
	}

	.override-reset:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	select {
		height: 30px;
		padding: 0 var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		outline: none;
		transition: border-color var(--dur-fast);
		min-width: 200px;
	}

	select:focus {
		border-color: var(--brand);
	}

	.toggles-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: var(--space-2);
	}

	.toggle-card {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		cursor: pointer;
		user-select: none;
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.toggle-card:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.toggle-card.checked {
		background: color-mix(in srgb, var(--brand) 6%, var(--bg-raised));
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line));
	}

	.toggle-card input[type='checkbox'] {
		margin-top: 2px;
		accent-color: var(--brand);
		cursor: pointer;
	}

	.toggle-content {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.toggle-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-1);
	}

	.toggle-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.toggle-tag {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		padding: 1px 4px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
	}

	.toggle-desc {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.35;
	}

	.switch {
		position: relative;
		display: inline-block;
		width: 32px;
		height: 18px;
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
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.slider::before {
		position: absolute;
		content: '';
		height: 12px;
		width: 12px;
		left: 2px;
		bottom: 2px;
		background: var(--ink-muted);
		border-radius: 50%;
		transition: transform var(--dur-fast), background var(--dur-fast);
	}

	input:checked + .slider {
		background: var(--brand);
		border-color: var(--brand);
	}

	input:checked + .slider::before {
		transform: translateX(14px);
		background: var(--bg-sunken);
	}
</style>
