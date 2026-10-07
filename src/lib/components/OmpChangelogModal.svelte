<!--
  OmpChangelogModal.svelte — Mostra le novita' e il changelog del binario omp.
  Usa Dialog accessibile, rendering Markdown nativo e schede non viste / completo.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/ui/Dialog.svelte';
	import { ompChangelogStore } from '$lib/stores/ompChangelog.svelte';
	import { lexMarkdown } from '$lib/agent/markdown';
	import Markdown from '$lib/agent/components/Markdown.svelte';

	const activeMarkdown = $derived(
		ompChangelogStore.showFull || !ompChangelogStore.unseenMarkdown
			? ompChangelogStore.fullMarkdown
			: ompChangelogStore.unseenMarkdown
	);

	const parsedTokens = $derived(
		activeMarkdown ? lexMarkdown(activeMarkdown) : []
	);
</script>

<Dialog
	open={ompChangelogStore.isModalOpen}
	title={m.page_omp_changelog_modal_title()}
	onClose={() => ompChangelogStore.closeModal()}
	size="wide"
>
	{#snippet actions()}
		{#if ompChangelogStore.unseenMarkdown && ompChangelogStore.fullMarkdown && ompChangelogStore.unseenMarkdown !== ompChangelogStore.fullMarkdown}
			<div class="tabs-segmented" role="tablist">
				<button
					type="button"
					class="tab-btn"
					class:active={!ompChangelogStore.showFull}
					role="tab"
					aria-selected={!ompChangelogStore.showFull}
					onclick={() => (ompChangelogStore.showFull = false)}
				>
					{m.page_omp_changelog_modal_tab_unseen()}
					{#if ompChangelogStore.changeCount > 0}
						<span class="tab-chip">{ompChangelogStore.changeCount}</span>
					{/if}
				</button>
				<button
					type="button"
					class="tab-btn"
					class:active={ompChangelogStore.showFull}
					role="tab"
					aria-selected={ompChangelogStore.showFull}
					onclick={() => (ompChangelogStore.showFull = true)}
				>
					{m.page_omp_changelog_modal_tab_full()}
				</button>
			</div>
		{/if}
	{/snippet}

	<div class="changelog-container">
		{#if parsedTokens.length > 0}
			<div class="changelog-content">
				<Markdown tokens={parsedTokens} />
			</div>
		{:else if ompChangelogStore.isLoading}
			<div class="loading-state">
				<p>{m.page_omp_update_status_checking()}</p>
			</div>
		{:else}
			<p class="empty-hint">{m.page_omp_changelog_modal_empty()}</p>
		{/if}
	</div>

	{#snippet footer()}
		<div class="modal-footer-content">
			{#if ompChangelogStore.currentVersion}
				<span class="version-label">omp v{ompChangelogStore.currentVersion}</span>
			{:else}
				<span></span>
			{/if}
			<button
				type="button"
				class="ui-button ui-button-primary"
				onclick={() => ompChangelogStore.closeModal()}
			>
				{m.page_omp_changelog_modal_close()}
			</button>
		</div>
	{/snippet}
</Dialog>

<style>
	.tabs-segmented {
		display: inline-flex;
		align-items: center;
		padding: 2px;
		background: var(--bg-surface-raised, rgba(255, 255, 255, 0.04));
		border: 1px solid var(--line-subtle, rgba(255, 255, 255, 0.08));
		border-radius: var(--radius-sm, 6px);
		gap: 2px;
	}

	.tab-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		font-family: var(--font-ui, sans-serif);
		font-size: var(--text-xs, 12px);
		color: var(--ink-muted);
		background: transparent;
		border: none;
		border-radius: var(--radius-xs, 4px);
		cursor: pointer;
		transition: all 120ms ease;
	}

	.tab-btn:hover {
		color: var(--ink);
	}

	.tab-btn.active {
		color: var(--ink);
		background: var(--bg-overlay, rgba(255, 255, 255, 0.1));
		font-weight: 500;
	}

	.tab-chip {
		padding: 1px 5px;
		font-size: 10px;
		font-weight: 600;
		color: var(--accent);
		background: var(--accent-subtle, rgba(248, 79, 204, 0.15));
		border-radius: 9999px;
	}

	.changelog-container {
		max-height: 65vh;
		overflow-y: auto;
		padding: var(--space-2, 8px) 0;
	}

	.changelog-content {
		color: var(--ink);
		font-size: var(--text-sm, 13px);
		line-height: 1.6;
	}

	.loading-state,
	.empty-hint {
		text-align: center;
		padding: var(--space-8, 32px);
		color: var(--ink-muted);
	}

	.modal-footer-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.version-label {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs, 12px);
		color: var(--ink-faint);
	}
</style>
