<script lang="ts">
	/**
	 * Popover di suggerimento per le menzioni dei file (@file) nel Composer.
	 * Mostra l'elenco dei file corrispondenti alla ricerca fuzzy con priorità
	 * per i file aperti o modificati di recente.
	 */
	import { anchoredPopover } from '$lib/anchoredPopover';
	import { IconFile, IconEditor, IconHistory } from '$lib/icons';
	import type { RankedFileItem } from '../fileMention';

	let {
		open = false,
		items = [],
		selectedIndex = 0,
		anchor = null,
		onSelect,
		onClose
	} = $props<{
		open: boolean;
		items: RankedFileItem[];
		selectedIndex: number;
		anchor: HTMLElement | null;
		onSelect: (item: RankedFileItem) => void;
		onClose: () => void;
	}>();

	let listEl = $state<HTMLElement | null>(null);

	$effect(() => {
		if (!open || !listEl || items.length === 0) return;
		const activeEl = listEl.children[selectedIndex] as HTMLElement | undefined;
		activeEl?.scrollIntoView({ block: 'nearest' });
	});
</script>

{#if open}
	<div
		class="file-mention-container"
		role="dialog"
		tabindex="-1"
		aria-label="Menziona file di progetto"
		popover="manual"
		use:anchoredPopover={{ anchor, offset: 8, matchWidth: false, constrainHeight: true }}
	>
		<div class="mention-header">
			<span class="header-title">File del progetto</span>
			<span class="header-count">{items.length} {items.length === 1 ? 'risultato' : 'risultati'}</span>
		</div>

		{#if items.length > 0}
			<div class="mention-list" bind:this={listEl} role="listbox" aria-label="Elenco file">
				{#each items as item, index (item.path)}
					<button
						type="button"
						role="option"
						aria-selected={index === selectedIndex}
						class="mention-item"
						class:selected={index === selectedIndex}
						onclick={() => onSelect(item)}
						onmouseenter={() => {}}
					>
						<div class="item-icon-wrap">
							{#if item.priority === 'active' || item.priority === 'open'}
								<IconEditor size={15} />
							{:else if item.priority === 'touched'}
								<IconHistory size={15} />
							{:else}
								<IconFile size={15} />
							{/if}
						</div>

						<div class="item-text">
							<span class="item-name">{item.name}</span>
							{#if item.dir}
								<span class="item-dir">{item.dir}</span>
							{/if}
						</div>

						{#if item.priority === 'active'}
							<span class="priority-badge active">Attivo</span>
						{:else if item.priority === 'open'}
							<span class="priority-badge open">Aperto</span>
						{:else if item.priority === 'touched'}
							<span class="priority-badge touched">Modificato</span>
						{/if}
					</button>
				{/each}
			</div>
		{:else}
			<div class="mention-empty">
				<span>Nessun file corrispondente</span>
			</div>
		{/if}

		<div class="mention-footer">
			<span>↑↓ naviga</span>
			<span>Invio o Tab inserisce</span>
			<span>Esc chiude</span>
		</div>
	</div>
{/if}

<style>
	.file-mention-container {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: 0;
		border: 1px solid var(--line-strong);
		min-width: 320px;
		max-width: min(520px, calc(100vw - 2 * var(--space-4)));
		max-height: min(340px, var(--anchored-space, 340px));
		background: var(--bg-raised);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-overlay);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		font-family: var(--font-ui);
	}

	.mention-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--line);
		background: var(--bg-surface);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		user-select: none;
	}

	.header-title {
		font-weight: 600;
		color: var(--ink);
		letter-spacing: 0.02em;
	}

	.header-count {
		font-variant-numeric: tabular-nums;
	}

	.mention-list {
		min-height: 0;
		max-height: 250px;
		overflow-y: auto;
		padding: var(--space-1);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.mention-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-2-5);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		text-align: left;
		cursor: pointer;
		color: var(--ink);
		font-family: var(--font-ui);
		transition: background var(--duration-fast) ease;
	}

	.mention-item:hover,
	.mention-item.selected {
		background: var(--bg-hover);
	}

	.item-icon-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--ink-muted);
	}

	.mention-item.selected .item-icon-wrap {
		color: var(--brand);
	}

	.item-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1 1 auto;
		gap: 1px;
	}

	.item-name {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.item-dir {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: var(--font-mono);
	}

	.priority-badge {
		font-size: 10px;
		line-height: 1;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: var(--radius-full, 9999px);
		flex-shrink: 0;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.priority-badge.active {
		background: var(--brand-subtle, rgba(0, 120, 212, 0.15));
		color: var(--brand, #0078d4);
	}

	.priority-badge.open {
		background: var(--bg-raised);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.priority-badge.touched {
		background: rgba(245, 158, 11, 0.12);
		color: rgb(217, 119, 6);
	}

	.mention-empty {
		padding: var(--space-4);
		text-align: center;
		color: var(--ink-muted);
		font-size: var(--text-sm);
	}

	.mention-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-1-5) var(--space-3);
		border-top: 1px solid var(--line);
		background: var(--bg-surface);
		font-size: 11px;
		color: var(--ink-muted);
		user-select: none;
	}
</style>
