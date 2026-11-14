<!--
  SummaryStep.svelte — Riepilogo (SET-017).

  Una riga per passo con quanto è stato scelto e «Modifica» per tornarci. Non è
  una schermata di conferma burocratica: è l'ultimo posto in cui si vede tutto
  insieme, e ogni riga porta esattamente dove si cambia quella cosa.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import ProviderLogo from '#lib/components/models/ProviderLogo.svelte';
	import { githubStore } from '#lib/stores/github.svelte.ts';
	import { SETUP_STEPS, setupFlow, type SetupStepId } from '#lib/stores/setupFlow.svelte.ts';
	import { stepLabel } from './stepLabels.ts';

	let { onEdit }: { onEdit: (step: SetupStepId) => void } = $props();

	const steps = $derived(SETUP_STEPS.filter((id) => id !== 'summary'));
	const status = $derived(setupFlow.status);

	const providers = $derived(
		setupFlow.connectedProviders.length > 0
			? setupFlow.connectedProviders
			: (status?.credentialProviders ?? [])
	);

	const roleCount = $derived(Object.values(setupFlow.rolePicks).filter(Boolean).length);

</script>

<ul class="summary">
	{#each steps as id (id)}
		<li class="row">
			<span class="su-label key">{stepLabel(id)}</span>
			<span class="value">
				{#if id === 'engine'}
					{#if status?.ompVersion}
						<span>omp {status.ompVersion}</span>
						{#if status.ompPath}
							<code class="su-mono path">{status.ompPath}</code>
						{/if}
					{:else}
						<span class="faint">{m.setup2_summary_engine_missing()}</span>
					{/if}
				{:else if id === 'providers'}
					{#if providers.length > 0}
						<span class="logos">
							{#each providers.slice(0, 5) as provider (provider)}
								<ProviderLogo {provider} size={14} />
							{/each}
						</span>
						<span class="truncate">{providers.join(', ')}</span>
					{:else}
						<span class="faint">{m.setup2_summary_providers_none()}</span>
					{/if}
				{:else if id === 'roles'}
					{#if status?.defaultModel}
						<code class="su-mono">{status.defaultModel}</code>
						{#if roleCount > 0}
							<span class="faint">· {m.setup2_summary_roles_count({ count: roleCount })}</span>
						{/if}
					{:else}
						<span class="faint">{m.setup2_summary_roles_none()}</span>
					{/if}
				{:else if id === 'appearance'}
					<span>{setupFlow.themeName}</span>
				{:else if id === 'updates'}
					<span>{setupFlow.updateMode === 'auto' ? m.setup2_updates_auto() : m.setup2_updates_notify()}</span>
				{:else if id === 'projects'}
					{#if setupFlow.projectFolder}
						<code class="su-mono path">{setupFlow.projectFolder}</code>
					{:else}
						<span class="faint">{m.setup2_summary_projects_none()}</span>
					{/if}
				{:else if id === 'github'}
					{#if githubStore.status.authenticated}
						<span>{m.setup2_github_connected_as({ user: githubStore.status.username ?? '' })}</span>
					{:else}
						<span class="faint">{m.setup2_github_skipped()}</span>
					{/if}
				{/if}
			</span>
			<button type="button" class="ui-link su-meta edit" onclick={() => onEdit(id)}>
				{m.setup2_summary_edit()}
			</button>
		</li>
	{/each}
</ul>

<style>
	.summary {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: grid;
		grid-template-columns: 150px minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-4);
		padding: 10px 0;
		border-bottom: 1px solid var(--line);
	}

	.row:last-child {
		border-bottom: 0;
	}

	.key {
		color: var(--ink-muted);
	}

	.value {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
		font-size: 12.5px;
		color: var(--ink);
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.logos {
		display: flex;
		flex: none;
		align-items: center;
		gap: 4px;
		color: var(--ink-muted);
	}

	.path {
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--ink-muted);
	}

	.truncate {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.faint {
		color: var(--ink-faint);
	}

	.edit {
		padding: 0;
		border: 0;
		background: none;
		opacity: 0.6;
		transition: opacity 120ms var(--ease-out);
	}

	.row:hover .edit,
	.edit:focus-visible {
		opacity: 1;
	}
</style>
