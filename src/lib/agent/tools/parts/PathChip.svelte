<script lang="ts">
	// Percorso cliccabile: apre il file nell'editor riusando lo stesso
	// percorso del terminale (`resolve_project_file`), non una risoluzione
	// nuova.
	import { agentUiHooks } from '../../ui-context';
	import { baseName } from '../types';

	let {
		path,
		line = null,
		full = false
	} = $props<{ path: string; line?: number | null; full?: boolean }>();

	const hooks = agentUiHooks();
	const label = $derived(full ? path : baseName(path));
</script>

<button
	type="button"
	class="path-chip"
	title={line ? `${path}:${line}` : path}
	onclick={() => hooks.openFile(path, line)}
>
	{label}{#if line}<span class="line">:{line}</span>{/if}
</button>

<style>
	.path-chip {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		cursor: pointer;
		text-align: left;
		overflow-wrap: anywhere;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		gap: 2px;
		transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
	}

	.path-chip:hover {
		color: var(--brand-ink);
		border-color: var(--brand);
		background: var(--bg-hover);
	}
	.line {
		color: var(--ink-faint);
	}
</style>
