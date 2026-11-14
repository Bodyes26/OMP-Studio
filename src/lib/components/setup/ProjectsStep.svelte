<!--
  ProjectsStep.svelte — passo Progetti (SET-015).

  Chiede solo la cartella predefinita dei progetti: le cartelle dove l'utente
  tiene già i repository, più «Sfoglia…». Non apre progetti (lo fa lo stato
  vuoto di Studio, SET-018); il conteggio dice se la cartella contiene qualcosa
  di riconoscibile come repository.
-->
<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { m } from '#lib/paraglide/messages.js';
	import { IconFolderOpen, IconFolderPlus } from '#lib/icons.ts';
	import { projectStore } from '#lib/stores/projects.svelte.ts';
	import { setupFlow, type RootCandidate } from '#lib/stores/setupFlow.svelte.ts';

	let { onBrowseState }: { onBrowseState?: (busy: boolean) => void } = $props();

	const chosen = $derived(setupFlow.projectFolder);

	/** La cartella scelta a mano non è nell'elenco dei candidati: la si aggiunge. */
	const folders = $derived.by<RootCandidate[]>(() => {
		const list = setupFlow.projectRoots;
		if (!chosen || list.some((f) => f.path === chosen)) return list;
		return [...list, { path: chosen, repoCount: 0, exists: true }];
	});

	async function browse() {
		onBrowseState?.(true);
		try {
			const picked = await openDialog({
				directory: true,
				defaultPath: chosen || projectStore.projectRoot
			});
			if (typeof picked !== 'string') return;
			// Il conteggio dei repository della cartella scelta a mano non si
			// indovina: si chiede al backend, che già sa leggere una cartella.
			let repoCount = 0;
			try {
				const entries = await invoke<{ name: string; is_dir: boolean }[]>('tree_read', {
					projectPath: picked,
					rel: ''
				});
				repoCount = entries.filter((e) => e.is_dir && !e.name.startsWith('.')).length;
			} catch {
				repoCount = 0;
			}
			setupFlow.projectRoots = [...setupFlow.projectRoots.filter((f) => f.path !== picked), { path: picked, repoCount, exists: true }];
			await setupFlow.setProjectFolder(picked);
		} catch (e) {
			console.error('Scelta della cartella dei progetti', e);
		} finally {
			onBrowseState?.(false);
		}
	}
</script>

<div class="projects">
	<p class="su-label lead">{m.setup2_projects_lead()}</p>

	{#if folders.length > 0}
		<div class="list" role="radiogroup" aria-label={m.setup2_projects_aria()}>
			{#each folders as folder (folder.path)}
				<button
					type="button"
					role="radio"
					aria-checked={chosen === folder.path}
					class="su-choice row"
					onclick={() => void setupFlow.setProjectFolder(folder.path)}
				>
					<span class="su-radio-dot dot"></span>
					<span class="icon" aria-hidden="true"><IconFolderOpen /></span>
					<code class="su-mono path">{folder.path}</code>
					<span class="su-meta count">{m.setup2_projects_repo_count({ count: folder.repoCount })}</span>
				</button>
			{/each}
		</div>
	{:else}
		<p class="su-label empty">{m.setup2_projects_none()}</p>
	{/if}

	<button type="button" class="ui-button ui-button-secondary browse" onclick={() => void browse()}>
		<IconFolderPlus /> {m.setup2_projects_browse()}
	</button>
</div>

<style>
	.projects {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.lead {
		margin: 0;
		color: var(--ink-muted);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.row {
		align-items: center;
	}

	.dot {
		margin-top: 0;
	}

	.icon {
		display: grid;
		place-items: center;
		flex: none;
		color: var(--ink-faint);
		--icon-size: 15px;
	}

	.path {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12.5px;
		color: var(--ink);
	}

	.count {
		flex: none;
		width: 96px;
		text-align: right;
		color: var(--ink-muted);
	}

	.empty {
		margin: 0;
		color: var(--ink-muted);
	}

	.browse {
		align-self: flex-start;
	}
</style>
