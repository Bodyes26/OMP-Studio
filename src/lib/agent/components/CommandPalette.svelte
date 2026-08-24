<script lang="ts">
	// Riquadro compatto dei comandi slash disponibili sopra il composer.
	//
	// Mostra i comandi censiti da omp (`get_available_commands`) filtrati per
	// sottostringa su nome, alias e descrizione. Navigabile con frecce, Enter
	// ed Esc.
	import type { AvailableCommand } from '../wire';

	let { open, commands = [], query = '', onPick, onClose } = $props<{
		open: boolean;
		commands: AvailableCommand[];
		query: string;
		onPick: (name: string) => void;
		onClose: () => void;
	}>();

	let selectedIndex = $state(0);
	let listEl = $state<HTMLElement | null>(null);

	const cleanQuery = $derived.by(() => {
		let q = query.trim().toLowerCase();
		if (q.startsWith('/')) q = q.slice(1).trim();
		return q;
	});

	const filteredCommands = $derived.by((): AvailableCommand[] => {
		if (!cleanQuery) return commands;
		return commands.filter((cmd: AvailableCommand) => {
			if (cmd.name.toLowerCase().includes(cleanQuery)) return true;
			if (cmd.description && cmd.description.toLowerCase().includes(cleanQuery)) return true;
			if (cmd.aliases && cmd.aliases.some((alias: string) => alias.toLowerCase().includes(cleanQuery))) return true;
			return false;
		});
	});

	// Mantiene la selezione entro i limiti quando l'elenco filtrato cambia
	$effect(() => {
		if (filteredCommands.length === 0) {
			selectedIndex = 0;
		} else if (selectedIndex >= filteredCommands.length) {
			selectedIndex = filteredCommands.length - 1;
		}
	});

	// Autoscroll della voce selezionata
	$effect(() => {
		if (open && listEl && selectedIndex >= 0 && selectedIndex < filteredCommands.length) {
			const item = listEl.children[selectedIndex] as HTMLElement | undefined;
			if (item) {
				item.scrollIntoView({ block: 'nearest' });
			}
		}
	});

	function handleKeydown(event: KeyboardEvent) {
		if (!open || filteredCommands.length === 0) return;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			event.stopPropagation();
			selectedIndex = (selectedIndex + 1) % filteredCommands.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			event.stopPropagation();
			selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
		} else if (event.key === 'Enter' || event.key === 'Tab') {
			if (filteredCommands[selectedIndex]) {
				event.preventDefault();
				event.stopPropagation();
				onPick(filteredCommands[selectedIndex].name);
			}
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="palette-container" role="dialog" aria-label="Tavolozza comandi">
		{#if filteredCommands.length > 0}
			<div class="palette-list" bind:this={listEl} role="listbox">
				{#each filteredCommands as cmd, index (cmd.name)}
					<button
						type="button"
						class="palette-item"
						class:selected={index === selectedIndex}
						role="option"
						aria-selected={index === selectedIndex}
						onclick={() => onPick(cmd.name)}
						onmouseenter={() => (selectedIndex = index)}
					>
						<div class="item-header">
							<span class="cmd-name">/{cmd.name}</span>
							{#if cmd.input?.hint}
								<span class="cmd-hint">{cmd.input.hint}</span>
							{/if}
							{#if cmd.aliases && cmd.aliases.length > 0}
								<span class="cmd-aliases">({cmd.aliases.map((a: string) => '/' + a).join(', ')})</span>
							{/if}
						</div>
						{#if cmd.description}
							<div class="cmd-desc">{cmd.description}</div>
						{/if}
					</button>
				{/each}
			</div>
		{:else}
			<div class="palette-empty">Nessun comando corrispondente a &ldquo;{query}&rdquo;</div>
		{/if}
	</div>
{/if}

<style>
	.palette-container {
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		margin-bottom: var(--space-1);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-overlay);
		overflow: hidden;
		max-width: 100%;
	}

	.palette-list {
		max-height: 320px;
		overflow-y: auto;
		padding: var(--space-1);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.palette-item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		width: 100%;
		padding: var(--space-1) var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		text-align: left;
		cursor: pointer;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		line-height: 1.3;
	}

	.palette-item:hover,
	.palette-item.selected {
		background: var(--bg-hover);
	}

	.palette-item.selected {
		color: var(--ink);
	}

	.item-header {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		width: 100%;
		overflow: hidden;
	}

	.cmd-name {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--brand-ink);
		white-space: nowrap;
	}

	.cmd-hint {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cmd-aliases {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		white-space: nowrap;
		margin-left: auto;
	}

	.cmd-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		width: 100%;
	}

	.palette-empty {
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		text-align: center;
	}
</style>
