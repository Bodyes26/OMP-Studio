<script lang="ts">
	// Renderer per `resolve` / `reject` / `propose` (risoluzione proposte e anteprime).
	//
	// Cosa mostra:
	// - summary: esito dell'azione (Applicato, Rifiutato o Proposto, dedotto dal
	//   nome del tool `name` o da `args.action`) e motivazione sintetica.
	// - body: motivazione estesa, metadati dell'operazione (`KeyValue`) e riscontro
	//   dell'esecuzione tramite `OutputBlock`.
	//
	// Comportamento quando `details` e' assente:
	// Il componente deduce l'esito dal nome del tool (`name`) e legge la motivazione
	// direttamente da `args.reason` o `args.content`, mostrando l'eventuale output
	// da `resultText(result)`.

	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import {
		asRecord,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { name, args, result, view }: ToolRenderProps = $props();

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

	const firstReasonLine = $derived(reason.split('\n', 1)[0] ?? '');

	const metaRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		rows.push({ key: 'esito', value: outcomeLabel });
		const action = str(args.action);
		if (action) rows.push({ key: 'azione', value: action });
		const invokerId = str(details?.invokerId) ?? str(details?.id);
		if (invokerId) rows.push({ key: 'id', value: invokerId });
		return rows;
	});
</script>

{#if view === 'summary'}
	<span class="summary-line">
		<span class="outcome-badge" class:applied={outcome === 'applied'} class:rejected={outcome === 'rejected'} class:proposed={outcome === 'proposed'}>
			{outcomeLabel}
		</span>
		{#if firstReasonLine}
			<span class="reason-preview">{firstReasonLine}</span>
		{:else if text}
			<span class="fallback-preview">{text.split('\n', 1)[0]}</span>
		{/if}
	</span>
{:else}
	<div class="resolve-body">
		{#if targetPath}
			<div class="target-row">
				<span class="target-label">File:</span>
				<PathChip path={targetPath} full />
			</div>
		{/if}

		{#if reason}
			<div class="reason-section">
				<span class="reason-label">Motivazione</span>
				<p class="reason-text">{reason}</p>
			</div>
		{/if}

		{#if metaRows.length > 0}
			<KeyValue rows={metaRows} />
		{/if}

		{#if text && text !== reason}
			<OutputBlock {text} label="esito" />
		{/if}
	</div>
{/if}

<style>
	.summary-line {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-sm);
	}

	.outcome-badge {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		padding: 1px var(--space-1);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-sunken);
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.outcome-badge.applied {
		color: var(--ink);
	}

	.outcome-badge.rejected {
		color: var(--danger);
	}

	.outcome-badge.proposed {
		color: var(--ink-muted);
		background: var(--bg-hover);
	}

	.reason-preview {
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.fallback-preview {
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.resolve-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.target-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.target-label {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.reason-section {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.reason-label {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.reason-text {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink);
		line-height: 1.4;
		user-select: text;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
