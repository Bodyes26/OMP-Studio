<script lang="ts">
	let {
		additions,
		deletions,
		compact = false
	}: {
		additions: number;
		deletions: number;
		compact?: boolean;
	} = $props();
</script>

{#if additions > 0 || deletions > 0}
	<span class="git-diff-badge" class:compact title={`Git diff HEAD: +${additions} −${deletions}`}>
		<span class="additions">+{additions}</span>
		<span class="deletions">−{deletions}</span>
	</span>
{/if}

<style>
	.git-diff-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: max-content;
		height: 18px;
		box-sizing: border-box;
		padding: 0 4px;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--ink) 6%, transparent);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-weight: 550;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		white-space: nowrap;
		flex: none;
	}

	.git-diff-badge.compact {
		height: 16px;
		padding-inline: 3px;
		border-color: transparent;
		background: color-mix(in srgb, var(--ink) 5%, transparent);
		font-size: var(--text-caption);
	}

	/* Esito del diff: verde e rosso sempre accompagnati dal segno + e −. */
	.additions {
		color: var(--success);
	}

	.deletions {
		color: var(--danger);
	}
</style>
