<!--
  Renderer per `resolve` / `reject` / `propose` (risoluzione proposte e anteprime).

  Nel corpo espanso mostra il file target tramite ToolFileHeader,
  la motivazione tramite PromptBlock (Two Voices Rule),
  i metadati dell'operazione in KeyValue e l'eventuale output in OutputBlock.
-->
<script lang="ts">
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PromptBlock from '../parts/PromptBlock.svelte';
	import ToolFileHeader from '../parts/ToolFileHeader.svelte';
	import {
		asRecord,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { name, args, result }: ToolRenderProps = $props();

	const reason = $derived(
		str(args.reason) ?? str(args.content) ?? str(args.text) ?? str(args.message) ?? str(args.slug) ?? ''
	);
	const targetPath = $derived(str(args.target) ?? str(args.path));
	const text = $derived(resultText(result));
	const details = $derived(asRecord(result?.details));

	type Outcome = 'applied' | 'rejected' | 'proposed';

	const outcome = $derived.by<Outcome>(() => {
		const lowerName = name.toLowerCase();
		const action = str(args.action)?.toLowerCase();
		if (lowerName.includes('reject') || action === 'reject' || action === 'discard') {
			return 'rejected';
		}
		if (lowerName.includes('propose') || action === 'propose') {
			return 'proposed';
		}
		return 'applied';
	});

	const outcomeLabel = $derived.by(() => {
		switch (outcome) {
			case 'rejected':
				return 'Rifiutato';
			case 'proposed':
				return 'Proposto';
			case 'applied':
			default:
				return 'Applicato';
		}
	});

	const metaRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		rows.push({ key: 'Esito', value: outcomeLabel });
		const action = str(args.action);
		if (action) rows.push({ key: 'Azione', value: action });
		const invokerId = str(details?.invokerId) ?? str(details?.id);
		if (invokerId) rows.push({ key: 'ID', value: invokerId });
		return rows;
	});
</script>

<div class="resolve-body">
	{#if targetPath}
		<ToolFileHeader path={targetPath} action="File:" />
	{/if}

	{#if reason}
		<PromptBlock text={reason} label="Motivazione" />
	{/if}

	{#if metaRows.length > 0}
		<KeyValue rows={metaRows} />
	{/if}

	{#if text && text !== reason}
		<OutputBlock {text} label="esito" />
	{/if}
</div>

<style>
	.resolve-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
