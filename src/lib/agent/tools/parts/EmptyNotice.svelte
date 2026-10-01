<script lang="ts">
	/**
	 * EmptyNotice.svelte
	 *
	 * Avviso per output vuoti o elenchi troncati (Glob, Grep, Bash, ecc.).
	 * Sostituisce i testi corsivi ad hoc con stile coerente (--ink-faint, --text-caption).
	 */
	let {
		text
	}: {
		text: string;
	} = $props();
</script>

<div class="empty-notice">
	{text}
</div>

<style>
	.empty-notice {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		line-height: var(--line-height-caption);
		color: var(--ink-faint);
		padding: var(--space-1) 0;
		user-select: text;
	}
</style>
