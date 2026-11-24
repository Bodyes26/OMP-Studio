<!--
  «Già aperto» su un'altra macchina (IMP-011).

  Non è l'elenco dei file del progetto e non è l'inoltro di una porta di
  sviluppo (R-MI-40): mostra l'editor e l'anteprima che l'altra macchina ha
  davvero aperti in questo stesso lavoro, e li apre qui solo su richiesta.
  Nessuna apertura automatica: la finestra non salta su un'altra macchina da
  sola quando lì si apre un file.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { projectStore, type Project } from '#lib/stores/projects.svelte.ts';
	import { provenance } from '#lib/stores/projectMachines.svelte.ts';
	import { openRemoteFile, openRemotePreview } from '#lib/remote/openItems.ts';
	import { IconFile, IconViewPreview } from '#lib/icons.ts';

	let { project }: { project: Project } = $props();

	/**
	 * Solo le copie raggiungibili che non sono già a video in questa finestra:
	 * una copia locale attiva mostra i suoi tab nell'editor, ripeterli qui
	 * sarebbe rumore. Una copia remota attiva mostra i tab (già sincronizzati)
	 * ma non l'anteprima, che il server loopback dell'altra macchina non serve
	 * qui: di quella copia resta solo la riga dell'anteprima.
	 * Una macchina spenta non compare: l'ultimo elenco ricevuto potrebbe
	 * essere vecchio, e chiamarlo «aperto adesso» sarebbe una bugia.
	 */
	const elsewhere = $derived(
		provenance(project)
			.copies.filter((copy) => copy.online && !(copy.local && copy.project.id === projectStore.activeId))
			.map((copy) => {
				const lanes = projectStore.remoteOpenItems[copy.project.id] ?? [];
				const visibleHere = copy.project.id === projectStore.activeId;
				return {
					copy,
					lanes: visibleHere
						? lanes
								.filter((lane) => Boolean(lane.previewFile))
								.map((lane) => ({ ...lane, openFiles: [] }))
						: lanes
				};
			})
			.filter((entry) => entry.lanes.length > 0)
	);
</script>

{#if elsewhere.length > 0}
	<p class="open-section">{m.open_items_section()}</p>
	{#each elsewhere as entry (entry.copy.project.id)}
		<div class="open-machine">
			<span class="open-machine-name">{entry.copy.name}</span>
			{#each entry.lanes as lane (lane.laneId)}
				<div class="open-lane">
					<span class="open-lane-title">{lane.laneTitle}</span>
					{#if lane.previewFile}
						<button
							type="button"
							class="open-row"
							onclick={() => void openRemotePreview(entry.copy.project, lane, lane.previewFile!)}
						>
							<IconViewPreview />
							<span class="open-file">{lane.previewFile}</span>
							<small>{m.open_items_preview()}</small>
						</button>
					{/if}
					{#each lane.openFiles as file (file)}
						<button
							type="button"
							class="open-row"
							aria-current={file === lane.activeFile ? 'true' : undefined}
							onclick={() => void openRemoteFile(entry.copy.project, lane, file)}
						>
							<IconFile />
							<span class="open-file">{file}</span>
							<small>{m.open_items_editor()}</small>
						</button>
					{/each}
				</div>
			{/each}
		</div>
	{/each}
	<p class="open-hint">{m.open_items_hint()}</p>
{/if}

<style>
	.open-section {
		margin: 6px 0 2px;
		padding: 0 8px;
		font: 600 var(--text-group-label)/1.4 var(--font-ui);
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	.open-machine { padding: 2px 8px 6px; }
	.open-machine-name { display: block; font-size: var(--text-caption); color: var(--ink-faint); padding: 2px 0; }
	.open-lane { display: flex; flex-direction: column; gap: 1px; }
	.open-lane-title {
		font-size: var(--text-meta);
		color: var(--ink-muted);
		padding: 4px 0 2px;
	}
	.open-row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 30px;
		padding: 5px 6px;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: var(--text-label);
		text-align: left;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out);
		--icon-size: 14px;
	}
	.open-row:hover { background: var(--bg-hover); }
	.open-row:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
	.open-row :global(svg) { flex: none; color: var(--ink-faint); }
	/* Scheda attiva sull'altra macchina: è quella che lì si sta guardando. */
	.open-row[aria-current='true'] .open-file { color: var(--ink); font-weight: 550; }
	.open-file {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.open-row small { flex: none; font-size: var(--text-caption); color: var(--ink-faint); }
	.open-hint { margin: 2px 8px 8px; font-size: var(--text-caption); color: var(--ink-faint); }
</style>
