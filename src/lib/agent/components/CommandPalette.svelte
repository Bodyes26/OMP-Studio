<script lang="ts">
	// Palette dei comandi censiti da omp. Il dato autorevole contiene nome,
	// alias, firma degli argomenti e sottocomandi: la GUI non inventa un
	// catalogo parallelo e non inoltra i comandi come prompt.
	import type { AvailableCommand } from '../wire';

	interface PaletteOption {
		key: string;
		value: string;
		label: string;
		description?: string;
		command: AvailableCommand;
		subcommand?: { name: string; description?: string };
		keepsOpen: boolean;
		submitImmediately: boolean;
	}

	interface ScoredOption {
		option: PaletteOption;
		order: number;
		rank: number;
	}

	let {
		open,
		commands = [],
		query = '',
		onPick,
		onClose,
		onSubmitFallback
	} = $props<{
		open: boolean;
		commands: AvailableCommand[];
		query: string;
		onPick: (value: string, keepsOpen: boolean, submitImmediately: boolean) => void;
		onClose: () => void;
		onSubmitFallback: () => void;
	}>();

	let selectedIndex = $state(0);
	let listEl = $state<HTMLElement | null>(null);

	const parsed = $derived.by(() => {
		const raw = query.trimStart().replace(/^\//, '');
		const space = raw.search(/\s/);
		if (space === -1) {
			return { commandQuery: raw.trim().toLowerCase(), subQuery: '', parent: null as AvailableCommand | null };
		}
		const token = raw.slice(0, space).toLowerCase();
		const parent =
			commands.find(
				(command: AvailableCommand) =>
					command.name.toLowerCase() === token
					|| command.aliases?.some((alias: string) => alias.toLowerCase() === token)
			) ?? null;
		return {
			commandQuery: token,
			subQuery: raw.slice(space + 1).trim().toLowerCase(),
			parent
		};
	});

	function isStudio(source?: string): boolean {
		return source === 'studio';
	}

	function sourceLabel(source?: string): string {
		if (source === 'studio') return 'Studio';
		if (source === 'extension') return 'Estensione';
		if (source === 'skill') return 'Skill';
		if (source === 'custom') return 'Personalizzato';
		return 'omp';
	}

	function rank(value: string, description: string | undefined, aliases: string[] | undefined, needle: string): number {
		const name = value.toLowerCase();
		if (!needle || name.startsWith(needle)) return 0;
		if (name.includes(needle)) return 1;
		if (aliases?.some((alias) => alias.toLowerCase().startsWith(needle))) return 2;
		if (aliases?.some((alias) => alias.toLowerCase().includes(needle))) return 3;
		if (description?.toLowerCase().includes(needle)) return 4;
		return Number.POSITIVE_INFINITY;
	}

	const options = $derived.by((): PaletteOption[] => {
		const parent = parsed.parent;
		if (parent?.subcommands?.length) {
			return parent.subcommands
				.map((subcommand: { name: string; description?: string }, order: number): ScoredOption => ({
					option: {
						key: `${parent.name}:${subcommand.name}`,
						value: `${parent.name} ${subcommand.name}`,
						label: `/${parent.name} ${subcommand.name}`,
						description: subcommand.description,
						command: parent,
						subcommand,
						keepsOpen: false,
						submitImmediately: true
					},
					order,
					rank: rank(subcommand.name, subcommand.description, undefined, parsed.subQuery)
				}))
				.filter((entry: ScoredOption) => Number.isFinite(entry.rank))
				.sort((left: ScoredOption, right: ScoredOption) => left.rank - right.rank || left.order - right.order)
				.map((entry: ScoredOption) => entry.option);
		}

		return commands
			.map((command: AvailableCommand, order: number): ScoredOption => ({
				option: {
					key: command.name,
					value: command.name,
					label: `/${command.name}`,
					description: command.description,
					command,
					keepsOpen: Boolean(command.subcommands?.length),
					submitImmediately: !command.subcommands?.length && !command.input?.hint
				},
				order,
				rank: rank(command.name, command.description, command.aliases, parsed.commandQuery)
			}))
			.filter((entry: ScoredOption) => Number.isFinite(entry.rank))
			.sort((left: ScoredOption, right: ScoredOption) => left.rank - right.rank || left.order - right.order)
			.map((entry: ScoredOption) => entry.option);
	});

	const activeIndex = $derived(options.length > 0 ? Math.min(selectedIndex, options.length - 1) : 0);
	const activeOption = $derived(options[activeIndex] ?? null);

	// Una nuova query riparte dalla prima voce. L'effetto legge solo `query`:
	// non rilegge lo stato che scrive e non puo' autoalimentarsi.
	$effect(() => {
		void query;
		selectedIndex = 0;
	});

	$effect(() => {
		if (!open || !listEl || options.length === 0) return;
		const item = listEl.children[activeIndex] as HTMLElement | undefined;
		item?.scrollIntoView({ block: 'nearest' });
	});

	function choose(option: PaletteOption) {
		onPick(option.value, option.keepsOpen, option.submitImmediately);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onClose();
			return;
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault();
			event.stopPropagation();
			if (activeOption) choose(activeOption);
			else onSubmitFallback();
			return;
		}
		if (options.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			event.stopPropagation();
			selectedIndex = (activeIndex + 1) % options.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			event.stopPropagation();
			selectedIndex = (activeIndex - 1 + options.length) % options.length;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="palette-container" role="dialog" tabindex="-1" aria-label="Comandi disponibili">
		<div class="palette-main">
			{#if options.length > 0}
				<div class="palette-list" bind:this={listEl} role="listbox" aria-label="Comandi">
					{#each options as option, index (option.key)}
						<button
							type="button"
							class="palette-item"
							class:selected={index === activeIndex}
							role="option"
							aria-selected={index === activeIndex}
							onclick={() => choose(option)}
							onmouseenter={() => (selectedIndex = index)}
						>
							<div class="cmd-header">
								<span class="cmd-name">{option.label}</span>
								<span class="source-badge" class:studio={isStudio(option.command.source)} class:omp={!isStudio(option.command.source)}>
									{sourceLabel(option.command.source)}
								</span>
							</div>
							{#if option.description}
								<span class="cmd-desc">{option.description}</span>
							{/if}
						</button>
					{/each}
				</div>
			{:else}
				<div class="palette-empty">
					<strong>Nessuna corrispondenza</strong>
					<span>Premi Invio per mandare comunque il testo.</span>
				</div>
			{/if}

			{#if activeOption}
				<aside class="command-preview" aria-live="polite">
					<div class="preview-header">
						<div class="preview-title">{activeOption.label}</div>
						<span class="source-badge" class:studio={isStudio(activeOption.command.source)} class:omp={!isStudio(activeOption.command.source)}>
							{sourceLabel(activeOption.command.source)}
						</span>
					</div>
					<div class="preview-row">
						<span class="preview-label">Origine</span>
						<span class="preview-source-desc">
							{isStudio(activeOption.command.source) ? 'Guscio GUI (azione locale di Studio)' : 'Agente / omp (inviato via RPC)'}
						</span>
					</div>
					{#if activeOption.command.aliases?.length}
						<div class="preview-row">
							<span class="preview-label">Alias</span>
							<code>{activeOption.command.aliases.map((alias) => `/${alias}`).join(', ')}</code>
						</div>
					{/if}
					{#if activeOption.command.input?.hint}
						<div class="preview-row">
							<span class="preview-label">Uso</span>
							<code>/{activeOption.command.name} {activeOption.command.input.hint}</code>
						</div>
					{/if}
					{#if activeOption.description}
						<p class="preview-description">{activeOption.description}</p>
					{/if}
					{#if !activeOption.subcommand && activeOption.command.subcommands?.length}
						<div class="subcommands">
							<div class="preview-label">Sottocomandi</div>
							{#each activeOption.command.subcommands as subcommand (subcommand.name)}
								<div class="subcommand-row">
									<code>{subcommand.name}</code>
									{#if subcommand.description}<span>{subcommand.description}</span>{/if}
								</div>
							{/each}
						</div>
					{/if}
				</aside>
			{/if}
		</div>
		<div class="palette-help">
			<span>↑↓ naviga</span>
			<span>Invio seleziona</span>
			<span>Esc chiude</span>
		</div>
	</div>
{/if}

<style>
	.palette-container {
		position: absolute;
		bottom: 100%;
		left: var(--space-3);
		right: var(--space-3);
		margin-bottom: var(--space-1);
		max-width: calc(100vw - 2 * var(--space-4));
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-overlay);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.palette-main {
		display: grid;
		grid-template-columns: minmax(180px, 0.9fr) minmax(220px, 1.1fr);
		grid-template-rows: minmax(0, 1fr);
		min-height: 150px;
		max-height: 380px;
		overflow: hidden;
	}

	.palette-list {
		min-height: 0;
		height: 100%;
		overflow-y: auto;
		padding: var(--space-1);
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-right: 1px solid var(--line);
	}
	.palette-item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		width: 100%;
		padding: var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		text-align: left;
		cursor: pointer;
		color: var(--ink);
		font-family: var(--font-ui);
	}

	.palette-item:hover,
	.palette-item.selected {
		background: var(--bg-hover);
	}

	.cmd-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		gap: var(--space-2);
	}

	.source-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		line-height: 1;
		padding: 2px 5px;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		flex-shrink: 0;
	}

	.source-badge.studio {
		background: color-mix(in srgb, var(--brand) 15%, transparent);
		color: var(--brand-ink);
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.source-badge.omp {
		background: var(--bg-sunken);
		color: var(--ink-faint);
		border: 1px solid var(--line);
	}

	.cmd-name,
	code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--brand-ink);
	}
	.cmd-desc {
		font-size: var(--text-xs);
		line-height: 1.35;
		color: var(--ink-muted);
	}

	.command-preview {
		min-height: 0;
		height: 100%;
		overflow-y: auto;
		padding: var(--space-3);
		background: var(--bg-sunken);
	}

	.preview-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	.preview-header .preview-title {
		margin-bottom: 0;
	}

	.preview-title {
		font-family: var(--font-mono);
		font-size: var(--text-base);
		font-weight: 650;
		color: var(--ink);
		margin-bottom: var(--space-3);
	}

	.preview-source-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.preview-row {
		display: grid;
		grid-template-columns: 64px 1fr;
		gap: var(--space-2);
		align-items: baseline;
		margin-bottom: var(--space-2);
	}

	.preview-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-faint);
	}

	.preview-description {
		margin: var(--space-3) 0;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		line-height: 1.5;
	}

	.subcommands {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}

	.subcommand-row {
		display: grid;
		grid-template-columns: minmax(80px, auto) 1fr;
		gap: var(--space-2);
		align-items: baseline;
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.palette-empty {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-4);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		text-align: center;
	}

	.palette-empty strong {
		color: var(--ink-muted);
	}

	.palette-help {
		flex-shrink: 0;
		position: relative;
		z-index: 1;
		display: flex;
		gap: var(--space-3);
		padding: var(--space-1) var(--space-2);
		border-top: 1px solid var(--line);
		background: var(--bg-sunken);
		color: var(--ink-faint);
		font-size: 10px;
	}

	@media (max-width: 720px) {
		.palette-main {
			grid-template-columns: 1fr;
		}

		.command-preview {
			display: none;
		}

		.palette-list {
			border-right: none;
		}
	}
</style>
