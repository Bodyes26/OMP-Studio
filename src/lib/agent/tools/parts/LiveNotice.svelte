<script lang="ts">
	/**
	 * LiveNotice.svelte
	 *
	 * Indicatore dal vivo per tool in esecuzione (Edit, Bash, ecc.).
	 * Conforme alla The Alive-and-Visible Rule: usa spinner due toni StatusMark
	 * e testo che luccica (.text-shimmer).
	 */
	import StatusMark from '$lib/ui/StatusMark.svelte';

	let {
		label,
		active = true
	}: {
		label: string;
		active?: boolean;
	} = $props();
</script>

<div class="live-notice" role="status" aria-live="polite">
	<span class="mark-wrap">
		<StatusMark status="running" {active} />
	</span>
	<span class="live-label text-shimmer">{label}</span>
</div>

<style>
	.live-notice {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		padding: var(--space-1) 0;
	}

	.mark-wrap {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.live-label {
		font-weight: 500;
	}
</style>
