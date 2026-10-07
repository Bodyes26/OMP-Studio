<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconChevronRight } from '$lib/icons';
	// JSON pieghevole: il ripiego quando non c'e' niente di meglio da dire su
	// un payload. Usato da `Generic` e dai renderer per gli argomenti che non
	// hanno una forma propria.
	let { value, label = 'argomenti' } = $props<{ value: unknown; label?: string }>();

	let open = $state(false);
	function hasJsonContent(val: unknown): boolean {
		if (val === null || val === undefined) return false;
		if (typeof val !== 'object') return true;
		if (Array.isArray(val)) return val.length > 0;
		return Object.keys(val).length > 0;
	}

	function estimateJsonLines(val: unknown, depth = 3): number {
		if (val === null || typeof val !== 'object') return 1;
		if (Array.isArray(val)) {
			if (val.length === 0) return 1;
			let lines = 2;
			for (let i = 0; i < val.length; i++) {
				if (lines > 500) return lines;
				lines += depth > 0 && typeof val[i] === 'object' && val[i] !== null
					? estimateJsonLines(val[i], depth - 1)
					: 1;
			}
			return lines;
		}
		const keys = Object.keys(val);
		if (keys.length === 0) return 1;
		let lines = 2;
		for (let i = 0; i < keys.length; i++) {
			if (lines > 500) return lines;
			const v = (val as Record<string, unknown>)[keys[i]];
			lines += depth > 0 && typeof v === 'object' && v !== null
				? estimateJsonLines(v, depth - 1)
				: 1;
		}
		return lines;
	}

	const hasContent = $derived(hasJsonContent(value));

	// Calcola la stringa formattata solo quando il blocco e' aperto,
	// evitando serializzazioni inutili quando i dettagli sono chiusi
	const text = $derived.by(() => {
		if (!open || !hasContent) return '';
		try {
			return JSON.stringify(value, null, 2) ?? '';
		} catch {
			return '(payload non serializzabile)';
		}
	});

	// Conteggio righe: esatto quando aperto (con ciclo rapido su newline),
	// stimato a basso costo quando chiuso senza stringify
	const lineCount = $derived.by(() => {
		if (!hasContent) return 0;
		if (open && text) {
			let count = 1;
			let pos = -1;
			while ((pos = text.indexOf('\n', pos + 1)) !== -1) {
				count++;
			}
			return count;
		}
		return estimateJsonLines(value);
	});
</script>

{#if hasContent}
	<details bind:open>
		<summary>
			<span class="chevron" aria-hidden="true"><IconChevronRight /></span>
			<span>{label} · {m.chat_lines_count({ count: lineCount })}</span>
		</summary>
		{#if open}
			<pre>{text}</pre>
		{/if}
	</details>
{/if}

<style>
	details {
		min-width: 0;
	}

	summary {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		cursor: pointer;
		list-style: none;
		user-select: none;
		font-variant-numeric: tabular-nums;
		transition: color var(--dur-fast) var(--ease-out);
	}

	summary::-webkit-details-marker {
		display: none;
	}

	.chevron {
		--icon-size: 12px;
		display: inline-flex;
		align-items: center;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	details[open] .chevron {
		transform: rotate(90deg);
	}

	summary:hover {
		color: var(--ink);
	}
	pre {
		margin: var(--space-1) 0 0;
		padding: var(--space-1) var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}
</style>
