<script lang="ts">
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import {
		settingsStore,
		type DefaultSurface,
		type CloseWithQueuedTasks,
		type ChatWidth,
		type StreamingBehavior,
		type QueueMode,
		type InterruptMode
	} from '$lib/stores/settings.svelte';
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

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">Larghezza chat</span>
				<span class="form-row-desc">Distribuzione dei messaggi: centrata con margini bilanciati per la lettura o estesa a tutta la colonna.</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.chatWidth}
					onchange={(e) => settingsStore.patchGeneral({ chatWidth: (e.currentTarget as HTMLSelectElement).value as ChatWidth })}
				>
					<option value="readable">Centrata (leggibile)</option>
					<option value="full">Tutta la colonna</option>
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
						<span class="channel-name">Stabile</span>
					</label>
					<label class="channel-option" class:checked={studioUpdaterStore.channel === 'nightly'}>
						<input
							type="radio"
							name="settings-update-channel"
							value="nightly"
							checked={studioUpdaterStore.channel === 'nightly'}
							onchange={() => void studioUpdaterStore.setChannel('nightly')}
						/>
						<span class="channel-name">Nightly</span>
					</label>
				</fieldset>
			</div>
		</div>
	</div>

	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">Invio durante l'elaborazione</span>
				<span class="form-row-desc">Decide il comportamento del tasto Invio quando l'agente sta lavorando. Alt+Invio usa sempre l'altra modalita.</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.defaultStreamingBehavior}
					onchange={(e) => settingsStore.patchGeneral({ defaultStreamingBehavior: (e.currentTarget as HTMLSelectElement).value as StreamingBehavior })}
				>
					<option value="steer">Steer (interrompe il turno in corso)</option>
					<option value="followUp">Follow-up (attende la fine del turno)</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">Estrazione messaggi steer</span>
				<span class="form-row-desc">Quanti messaggi steer OMP preleva per ciascun turno di elaborazione.</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.steeringMode}
					onchange={(e) => settingsStore.patchGeneral({ steeringMode: (e.currentTarget as HTMLSelectElement).value as QueueMode })}
				>
					<option value="one-at-a-time">Uno per turno</option>
					<option value="all">Tutti insieme</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">Estrazione messaggi follow-up</span>
				<span class="form-row-desc">Quanti messaggi follow-up OMP preleva per ciascun turno di elaborazione.</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.followUpMode}
					onchange={(e) => settingsStore.patchGeneral({ followUpMode: (e.currentTarget as HTMLSelectElement).value as QueueMode })}
				>
					<option value="one-at-a-time">Uno per turno</option>
					<option value="all">Tutti insieme</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">Interruzione durante i tool</span>
				<span class="form-row-desc">Comportamento quando un messaggio interrompe l'elaborazione: interruzione immediata dei tool rimanenti o attesa a fine turno.</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.interruptMode}
					onchange={(e) => settingsStore.patchGeneral({ interruptMode: (e.currentTarget as HTMLSelectElement).value as InterruptMode })}
				>
					<option value="immediate">Immediata</option>
					<option value="wait">Attendi fine turno</option>
				</select>
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
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		margin: 0;
		padding: 3px;
	}

	.channel-options:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.channel-option {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 5px var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		cursor: pointer;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: transparent;
		transition: background var(--dur-fast) var(--ease-out),
		            border-color var(--dur-fast) var(--ease-out),
		            color var(--dur-fast) var(--ease-out);
	}

	.channel-option:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.channel-option.checked {
		color: var(--ink);
		font-weight: 500;
		background: var(--bg-raised);
		border-color: var(--line-strong);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
	}

	.channel-options:disabled .channel-option {
		cursor: not-allowed;
	}

	.channel-name {
		user-select: none;
	}
</style>
