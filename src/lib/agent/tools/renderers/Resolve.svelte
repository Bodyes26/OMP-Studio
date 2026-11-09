<!--
  Renderer per `resolve` / `reject` / `propose` (risoluzione proposte e anteprime).

  Nel corpo espanso mostra il file target tramite ToolFileHeader,
  la motivazione tramite PromptBlock (Two Voices Rule),
  i metadati dell'operazione in KeyValue e l'eventuale output in OutputBlock.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
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
				return m.l10n_tools_value_rejected();
			case 'proposed':
				return m.l10n_tools_value_proposed();
			case 'applied':
			default:
				return m.l10n_tools_value_applied();
		}
	});

	const metaRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		rows.push({ key: m.l10n_tools_label_outcome(), value: outcomeLabel });
		const action = str(args.action);
		if (action) rows.push({ key: m.l10n_tools_label_action(), value: action });
		const invokerId = str(details?.invokerId) ?? str(details?.id);
		if (invokerId) rows.push({ key: m.l10n_tools_label_id(), value: invokerId });
		return rows;
	});
</script>

<div class="resolve-body">
	{#if targetPath}
		<ToolFileHeader path={targetPath} action={`${m.ui_filetree_file_8635()}:`} />
	{/if}

	{#if reason}
		<PromptBlock text={reason} label={m.l10n_tools_label_reason()} />
	{/if}

	{#if metaRows.length > 0}
		<KeyValue rows={metaRows} />
	{/if}

	{#if text && text !== reason}
		<OutputBlock {text} label={m.l10n_tools_label_outcome_lower()} />
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
