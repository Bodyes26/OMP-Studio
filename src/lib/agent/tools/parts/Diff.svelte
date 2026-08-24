<script lang="ts">
	// Diff a colonna singola.
	//
	// Il formato di `EditToolDetails.diff` **non** e' un diff unificato,
	// nonostante il nome: e' una riga per riga di diff, `<segno><numero>|<testo>`,
	// senza header di hunk (rilevato sul filo, `ricerca/TOOL-DETAILS.md`).
	// Segno ` ` e `-` numerano sul file vecchio, `+` sul nuovo, e un salto di
	// numerazione e' l'unico indizio di un nuovo hunk.
	//
	// Mai side-by-side: la colonna destra sta intorno a 820px su 1920 e la
	// griglia deve restare intatta.

	let { diff, maxLines = 400 } = $props<{ diff: string; maxLines?: number }>();

	interface DiffRow {
		sign: '+' | '-' | ' ';
		line: number | null;
		text: string;
	}

	const LINE = /^([-+ ])(\d*)\|(.*)$/;

	let expanded = $state(false);

	const rows = $derived.by<DiffRow[]>(() => {
		const out: DiffRow[] = [];
		for (const raw of diff.split('\n')) {
			const match = LINE.exec(raw);
			if (!match) {
				// Riga fuori formato: si mostra come contesto invece di
				// scartarla, cosi' un cambio di formato a monte resta visibile.
				out.push({ sign: ' ', line: null, text: raw });
				continue;
			}
			const sign = match[1] === '+' || match[1] === '-' ? match[1] : ' ';
			out.push({ sign, line: match[2] ? Number(match[2]) : null, text: match[3] });
		}
		return out;
	});

	const added = $derived(rows.filter((row) => row.sign === '+').length);
	const removed = $derived(rows.filter((row) => row.sign === '-').length);

	// Diff enormi: testa e coda, con il conto di quello che manca in mezzo.
	const HEAD = 200;
	const TAIL = 100;
	const clipped = $derived(!expanded && rows.length > maxLines);
	const head = $derived(clipped ? rows.slice(0, HEAD) : rows);
	const tail = $derived(clipped ? rows.slice(rows.length - TAIL) : []);
	const omitted = $derived(clipped ? rows.length - HEAD - TAIL : 0);

	/** Salto di numerazione = confine di hunk. Serve una riga di stacco. */
	function gapBefore(list: DiffRow[], index: number): boolean {
		if (index === 0) return false;
		const previous = list[index - 1];
		const current = list[index];
		if (previous.line === null || current.line === null) return false;
		if (previous.sign === '+' && current.sign !== '+') return false;
		if (current.sign === '+' && previous.sign !== '+') return false;
		return current.line > previous.line + 1;
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
				{omitted} righe omesse — mostra tutto
			</button>
			{#each tail as row, index (index)}
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
		font-size: var(--text-xs);
	}

	.plus {
		color: var(--git-added);
	}

	.minus {
		color: var(--git-deleted);
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
		background: color-mix(in srgb, var(--git-added) 10%, transparent);
	}

	.add .sign,
	.add .text {
		color: var(--git-added);
	}

	.del {
		background: color-mix(in srgb, var(--git-deleted) 10%, transparent);
	}

	.del .sign,
	.del .text {
		color: var(--git-deleted);
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
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
	}

	.omitted:hover {
		color: var(--ink);
	}
</style>
