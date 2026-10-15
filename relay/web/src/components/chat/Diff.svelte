<!--
  Diff.svelte — Diff a colonna singola nel formato di omp (<segno><numero>|<testo>).
  Fedele a src/lib/agent/tools/parts/Diff.svelte di Studio.
-->
<script lang="ts">
	import { t } from '../../i18n.ts';
	import { parseOmpDiff } from '../../chat/merge.ts';
	import type { DiffRow } from '../../chat/types.ts';

	let { diff, maxLines = 400 } = $props<{ diff: string; maxLines?: number }>();

	let expanded = $state(false);

	const parsed = $derived(parseOmpDiff(diff));
	const rows = $derived(parsed.rows);
	const added = $derived(parsed.added);
	const removed = $derived(parsed.removed);

	const HEAD = 200;
	const TAIL = 100;
	const clipped = $derived(!expanded && rows.length > maxLines);
	const head = $derived(clipped ? rows.slice(0, HEAD) : rows);
	const tail = $derived(clipped ? rows.slice(rows.length - TAIL) : []);
	const omitted = $derived(clipped ? rows.length - HEAD - TAIL : 0);

	function gapBefore(list: DiffRow[], index: number): boolean {
		if (index === 0) return false;
		const prev = list[index - 1];
		const curr = list[index];
		if (prev.line === null || curr.line === null) return false;
		if (prev.sign === '+' && curr.sign !== '+') return false;
		if (curr.sign === '+' && prev.sign !== '+') return false;
		return curr.line > prev.line + 1;
	}
</script>

<div class="diff">
	<div class="tally">
		{#if added > 0}<span class="plus">+{added}</span>{/if}
		{#if removed > 0}<span class="minus">−{removed}</span>{/if}
	</div>
	<div class="body">
		{#each head as row, index (index)}
			{#if gapBefore(head, index)}
				<div class="gap"></div>
			{/if}
			<div class="row {row.sign === '+' ? 'add' : row.sign === '-' ? 'del' : 'ctx'}">
				<span class="num">{row.line ?? ''}</span>
				<span class="sign">{row.sign === ' ' ? '' : row.sign}</span>
				<span class="text">{row.text}</span>
			</div>
		{/each}
		{#if clipped}
			<button type="button" class="omitted" onclick={() => (expanded = true)}>
				{t('chatDiffOmitted', { count: omitted })}
			</button>
			{#each tail as row, index (index)}
				{#if gapBefore(tail, index)}
					<div class="gap"></div>
				{/if}
				<div class="row {row.sign === '+' ? 'add' : row.sign === '-' ? 'del' : 'ctx'}">
					<span class="num">{row.line ?? ''}</span>
					<span class="sign">{row.sign === ' ' ? '' : row.sign}</span>
					<span class="text">{row.text}</span>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.diff {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.tally {
		display: flex;
		gap: var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.plus {
		color: var(--success);
	}

	.minus {
		color: var(--danger);
	}

	.body {
		display: flex;
		flex-direction: column;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.5;
		user-select: text;
	}

	.row {
		display: grid;
		grid-template-columns: 44px 10px minmax(0, 1fr);
		gap: var(--space-1);
	}

	.num {
		text-align: right;
		color: var(--ink-faint);
		opacity: 0.7;
		user-select: none;
		font-variant-numeric: tabular-nums;
	}

	.sign {
		user-select: none;
	}

	.text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.ctx .text {
		color: var(--ink-faint);
	}

	.add {
		background: color-mix(in srgb, var(--success) 10%, transparent);
	}

	.add .sign,
	.add .text {
		color: var(--success);
	}

	.del {
		background: color-mix(in srgb, var(--danger) 10%, transparent);
	}

	.del .sign,
	.del .text {
		color: var(--danger);
	}

	.gap {
		height: 1px;
		margin: var(--space-1) 0;
		background: var(--line);
	}

	.omitted {
		align-self: flex-start;
		margin: var(--space-1) 0;
		background: transparent;
		border: none;
		padding: 0;
		color: var(--ink-faint);
		font-size: var(--text-caption);
		font-family: var(--font-ui);
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}

	.omitted:hover {
		color: var(--ink);
	}
</style>
