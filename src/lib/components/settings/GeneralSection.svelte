<script lang="ts">
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { settingsStore, type DefaultSurface, type CloseWithQueuedTasks } from '$lib/stores/settings.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { studioUpdaterStore } from '$lib/stores/studioUpdater.svelte';

	async function browseProjectRoot() {
		const sel = await openDialog({ directory: true, defaultPath: projectStore.projectRoot });
		if (typeof sel === 'string') {
			projectStore.setProjectRoot(sel);
		}
	}
</script>

<div class="settings-section">
	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">Superficie di avvio</span>
				<span class="form-row-desc">Con quale vista nasce un progetto aperto per la prima volta: terminale OMP o editor grafico.</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.defaultSurface}
					onchange={(e) => settingsStore.patchGeneral({ defaultSurface: (e.currentTarget as HTMLSelectElement).value as DefaultSurface })}
				>
					<option value="terminal">Terminale</option>
					<option value="gui">Editor (GUI)</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">Chiusura con task in coda</span>
				<span class="form-row-desc">Cosa fare della coda quando chiudi un progetto che ha ancora task in attesa.</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.closeWithQueuedTasks}
					onchange={(e) => settingsStore.patchGeneral({ closeWithQueuedTasks: (e.currentTarget as HTMLSelectElement).value as CloseWithQueuedTasks })}
				>
					<option value="ask">Chiedi conferma</option>
					<option value="keep">Mantieni la coda</option>
					<option value="discard">Scarta la coda</option>
				</select>
			</div>
		</div>
	</div>

	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">Cartella progetti</span>
				<span class="form-row-desc">Dove Studio cerca le cartelle da proporre come nuovo progetto.</span>
				<span class="form-row-path" title={projectStore.projectRoot}>{projectStore.projectRoot}</span>
			</div>
			<div class="form-row-control">
				<button type="button" class="btn btn-secondary" onclick={browseProjectRoot}>Cambia...</button>
			</div>
		</div>
	</div>

	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">Canale aggiornamenti</span>
				<span class="form-row-desc">Stabile per release verificate, Nightly per l'ultima build (può essere instabile).</span>
			</div>
			<div class="form-row-control">
				<fieldset class="channel-options" disabled={studioUpdaterStore.channelChangeDisabled}>
					<label class="channel-option" class:checked={studioUpdaterStore.channel === 'stable'}>
						<input
							type="radio"
							name="settings-update-channel"
							value="stable"
							checked={studioUpdaterStore.channel === 'stable'}
							onchange={() => void studioUpdaterStore.setChannel('stable')}
						/>
						<span>Stabile</span>
					</label>
					<label class="channel-option" class:checked={studioUpdaterStore.channel === 'nightly'}>
						<input
							type="radio"
							name="settings-update-channel"
							value="nightly"
							checked={studioUpdaterStore.channel === 'nightly'}
							onchange={() => void studioUpdaterStore.setChannel('nightly')}
						/>
						<span>Nightly</span>
					</label>
				</fieldset>
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

	.form-row-path {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		margin-top: 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 420px;
	}

	.form-row-control {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
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
		min-width: 180px;
	}

	select:focus {
		border-color: var(--brand);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 6px 14px;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
		font-family: var(--font-ui);
		cursor: pointer;
		border: 1px solid transparent;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-secondary {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.btn-secondary:hover {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}

	.channel-options {
		display: flex;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		margin: 0;
		padding: 0;
	}

	.channel-options:disabled {
		opacity: 0.6;
	}

	.channel-option {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.channel-option + .channel-option {
		border-left: 1px solid var(--line);
	}

	.channel-option:hover {
		background: var(--bg-hover);
	}

	.channel-option.checked {
		color: var(--ink);
		font-weight: 600;
		background: var(--bg-active);
	}
</style>
