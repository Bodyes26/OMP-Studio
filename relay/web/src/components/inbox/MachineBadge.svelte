<!--
  MachineBadge.svelte — Badge compatto con nome della macchina e dot di stato.
-->
<script lang="ts">
	let {
		name,
		online = true,
		short = false,
		class: extraClass = ''
	}: {
		name: string;
		online?: boolean;
		short?: boolean;
		class?: string;
	} = $props();

	const displayName = $derived.by(() => {
		if (!short) return name;
		const parts = name.trim().split(/\s+/);
		return parts[parts.length - 1] || name;
	});
</script>

<span class="machine-badge {extraClass}" class:is-offline={!online}>
	<span class="dot" class:online aria-hidden="true"></span>
	<span class="name">{displayName}</span>
</span>

<style>
	.machine-badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 7px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		font-size: var(--text-mini, 11px);
		font-weight: 500;
		color: var(--ink-muted);
		line-height: 1.2;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
		flex-shrink: 0;
	}

	.dot.online {
		background: var(--color-success, var(--brand));
	}

	.is-offline {
		opacity: 0.7;
	}
</style>
