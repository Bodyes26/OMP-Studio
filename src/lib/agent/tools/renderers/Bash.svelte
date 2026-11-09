<!--
  Renderer per il tool `bash`.

  Nel corpo espanso mostra l'output in OutputBlock (o LiveNotice se in corso,
  EmptyNotice se assente) e una tabella con durata effettiva, timeout,
  directory di lavoro (cwd) e flag pty/async se configurati.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import EmptyNotice from '../parts/EmptyNotice.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import LiveNotice from '../parts/LiveNotice.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		bool,
		formatDuration,
		formatMinimized,
		num,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, running = false }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const text = $derived(resultText(result));

	const wallTimeMs = $derived(num(details?.wallTimeMs));
	const timeoutSec = $derived(num(details?.timeoutSeconds) ?? num(args.timeout));
	const cwd = $derived(str(args.cwd));
	const pty = $derived(bool(args.pty));
	const isAsync = $derived(bool(args.async));
	const minimized = $derived(formatMinimized(result?.details));

	const metaRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (wallTimeMs !== undefined) {
			const formatted = formatDuration(wallTimeMs);
			if (formatted) {
				rows.push({ key: m.l10n_tools_label_duration(), value: formatted });
			}
		}
		if (timeoutSec !== undefined) {
			rows.push({ key: m.l10n_tools_label_timeout(), value: `${timeoutSec}s` });
		}
		if (cwd) {
			rows.push({ key: m.ui_filetree_cartella_ee2c(), value: cwd });
		}
		if (pty !== undefined) {
			rows.push({ key: m.l10n_tools_label_pty(), value: pty ? m.l10n_tools_value_enabled() : m.l10n_tools_value_disabled() });
		}
		if (isAsync !== undefined) {
			rows.push({ key: m.l10n_tools_label_async(), value: isAsync ? m.ui_bash_si_ef73() : m.l10n_tools_value_no() });
		}
		if (minimized) {
			rows.push({ key: m.ui_bash_output_ridotto(), value: minimized });
		}
		return rows;
	});
</script>

<div class="bash-body">
	{#if text}
		<OutputBlock {text} label={m.l10n_tools_label_bash_output()} />
	{:else if running}
		<LiveNotice label={m.ui_bash_esecuzione_in_corso_b1d6()} />
	{:else}
		<EmptyNotice text={m.l10n_tools_label_no_output()} />
	{/if}
	{#if metaRows.length > 0}
		<KeyValue rows={metaRows} />
	{/if}
</div>

<style>
	.bash-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
