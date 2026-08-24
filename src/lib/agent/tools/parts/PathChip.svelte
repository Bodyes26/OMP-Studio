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
		background: transparent;
		border: none;
		padding: 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		cursor: pointer;
		text-align: left;
		overflow-wrap: anywhere;
		border-bottom: 1px solid transparent;
	}

	.path-chip:hover {
		border-bottom-color: var(--line-strong);
	}

	.line {
		color: var(--ink-faint);
	}
</style>
