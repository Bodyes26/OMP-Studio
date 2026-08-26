<script lang="ts">
	// Numero secco accanto al nome del tool. Neutro: nel guscio il colore
	// marca identita' e attenzione, non conteggi.
	let { text, muted = false } = $props<{ text: string; muted?: boolean }>();
</script>

<span class="badge" class:muted>{text}</span>

<style>
	.badge {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.muted {
		color: var(--ink-faint);
	}
</style>
