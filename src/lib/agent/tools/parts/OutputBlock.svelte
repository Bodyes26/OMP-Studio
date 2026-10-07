<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Output monospazio con troncamento: l'output di un tool puo' essere
	// arbitrariamente lungo e la colonna e' larga ~820px su 1920.
	// Evita text.split('\n') per non allocare array di stringhe enormi
	// a ogni aggiornamento e protegge da freeze del layout su output giganti.
	let {
		text,
		maxLines = 24,
		label = 'output'
	} = $props<{ text: string; maxLines?: number; label?: string }>();

	let expanded = $state(false);

	const MAX_SAFE_BYTES = 2 * 1024 * 1024; // 2 MB
	const MAX_SAFE_LINES = 20_000;

	// Anteprima compatta: trova l'indice di taglio con un ciclo indexOf('\n')
	// che si ferma dopo maxLines, senza allocare array intermedi.
	const preview = $derived.by(() => {
		if (!text) return { shown: '', hidden: 0, hasMore: false };

		let lineCount = 0;
		let pos = -1;
		let cutIndex = -1;

		while (lineCount < maxLines && (pos = text.indexOf('\n', pos + 1)) !== -1) {
			lineCount++;
			cutIndex = pos;
		}

		// Se non ha raggiunto maxLines newline, tutto il testo rientra nelle maxLines
		if (pos === -1) {
			return { shown: text, hidden: 0, hasMore: false };
		}

		// Ha raggiunto maxLines: controlla se c'e' ulteriore testo oltre il newline
		const hasMore = pos < text.length - 1;
		if (!hasMore) {
			return { shown: text, hidden: 0, hasMore: false };
		}

		// Conteggio delle righe nascoste: rapido senza allocazioni di array
		let remainingLines = 0;
		let countPos = pos;
		if (text.length <= 512 * 1024) {
			while ((countPos = text.indexOf('\n', countPos + 1)) !== -1) {
				remainingLines++;
			}
			if (text[text.length - 1] !== '\n') {
				remainingLines++;
			}
		} else {
			// Per output molto grandi, limita il conteggio per evitare overhead
			while (remainingLines < MAX_SAFE_LINES && (countPos = text.indexOf('\n', countPos + 1)) !== -1) {
				remainingLines++;
			}
			if (remainingLines >= MAX_SAFE_LINES) {
				return {
					shown: text.slice(0, cutIndex),
					hidden: `${MAX_SAFE_LINES}+`,
					hasMore: true
				};
			}
		}

		return {
			shown: text.slice(0, cutIndex),
			hidden: Math.max(1, remainingLines),
			hasMore: true
		};
	});

	// Quando espanso, limita il testo renderizzato a dimensioni sicure
	// (primi 2 MB / 20k righe) per non congelare il motore di rendering della WebView.
	const expandedData = $derived.by(() => {
		if (!text) return { shown: '', isCapped: false };

		if (text.length <= MAX_SAFE_BYTES) {
			let lines = 0;
			let pos = -1;
			let capPos = -1;
			while ((pos = text.indexOf('\n', pos + 1)) !== -1) {
				lines++;
				if (lines === MAX_SAFE_LINES) {
					capPos = pos;
					break;
				}
			}
			if (capPos !== -1 && capPos < text.length - 1) {
				return { shown: text.slice(0, capPos), isCapped: true };
			}
			return { shown: text, isCapped: false };
		}

		// Se supera MAX_SAFE_BYTES, taglia all'ultimo newline precedente al limite
		let capPos = text.lastIndexOf('\n', MAX_SAFE_BYTES);
		if (capPos === -1 || capPos < MAX_SAFE_BYTES / 2) {
			capPos = MAX_SAFE_BYTES;
		}
		return { shown: text.slice(0, capPos), isCapped: true };
	});

	const shown = $derived(expanded ? expandedData.shown : preview.shown);
	const hasHidden = $derived(preview.hasMore);
	const hiddenCount = $derived(preview.hidden);
	const isCapped = $derived(expanded && expandedData.isCapped);
</script>

{#if text}
	<div class="output">
		<pre>{shown}</pre>
		{#if isCapped}
			<div class="output-truncated-note">
				{m.output_block_truncated_note({ max: '20.000' })}
			</div>
		{/if}
		{#if hasHidden}
			<button type="button" onclick={() => (expanded = !expanded)}>
				{expanded ? m.output_block_collapse({ label }) : m.ui_outputblock_value1_righe_in_piu_d8e9({ value1: hiddenCount })}
			</button>
		{/if}
	</div>
{/if}

<style>
	.output {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	pre {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.5;
		color: var(--ink-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}
	.output-truncated-note {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--warn);
		font-style: italic;
	}

	button {
		align-self: flex-start;
		background: transparent;
		border: none;
		padding: 0;
		color: var(--ink-faint);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		cursor: pointer;
		font-variant-numeric: tabular-nums;
		transition: color var(--dur-fast) var(--ease-out);
	}

	button:hover {
		color: var(--ink);
	}
</style>
