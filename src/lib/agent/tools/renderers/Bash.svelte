<!--
  Renderer per il tool `bash`.

  Nel sommario mostra il comando eseguito su una sola riga monospazio.
  Nel corpo mostra l'output (completo o parziale durante lo streaming via
  `tool_execution_update`) e una tabella con durata effettiva, timeout,
  directory di lavoro (cwd) e flag pty/async se configurati.
-->
<script lang="ts">
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		bool,
		formatDuration,
		num,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, running = false, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const command = $derived(str(args.command) ?? str(args.cmd) ?? '');
	const text = $derived(resultText(result));

	const wallTimeMs = $derived(num(details?.wallTimeMs));
	const timeoutSec = $derived(num(details?.timeoutSeconds) ?? num(args.timeout));
	const cwd = $derived(str(args.cwd));
	const pty = $derived(bool(args.pty));
	const isAsync = $derived(bool(args.async));

	const metaRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (wallTimeMs !== undefined) {
			const formatted = formatDuration(wallTimeMs);
			if (formatted) {
				rows.push({ key: 'Durata', value: formatted });
			}
		}
		if (timeoutSec !== undefined) {
			rows.push({ key: 'Timeout', value: `${timeoutSec}s` });
		}
		if (cwd) {
			rows.push({ key: 'Cartella', value: cwd });
		}
		if (pty !== undefined) {
			rows.push({ key: 'PTY', value: pty ? 'abilitato' : 'disabilitato' });
		}
		if (isAsync !== undefined) {
			rows.push({ key: 'Async', value: isAsync ? 'sì' : 'no' });
		}
		return rows;
	});
</script>

{#if view === 'summary'}
	<span class="bash-summary" title={command}>{command}</span>
{:else}
	<div class="bash-body">
		{#if text}
			<OutputBlock {text} label="output bash" />
		{:else if running}
			<div class="running-indicator">Esecuzione in corso...</div>
		{/if}
		{#if metaRows.length > 0}
			<KeyValue rows={metaRows} />
		{/if}
	</div>
{/if}

<style>
	.bash-summary {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
		min-width: 0;
	}

	.bash-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.running-indicator {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-style: italic;
	}
</style>
