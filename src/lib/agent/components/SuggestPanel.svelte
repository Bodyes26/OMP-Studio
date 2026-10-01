<script lang="ts">
	/**
	 * Tendina dei suggerimenti per menzioni file (@) e comandi slash (/) nel composer (C20).
	 * Si posiziona sopra il cursore usando le coordinate del Range rettangolo del caret.
	 */
	import type { AvailableCommand } from '$lib/agent/wire';
	import type { RankedFileItem } from '$lib/agent/fileMention';
	import { IconFile, IconEditor, IconHistory, IconSparkles } from '$lib/icons';
	import { formatTokens } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages.js';

	export type SuggestionItem =
		| { kind: 'file'; item: RankedFileItem; hits?: number[] }
		| { kind: 'cmd'; command: AvailableCommand; isSkill: boolean; hits?: number[] };

	let {
		kind = '@',
		query = '',
		items = [],
		selectedIndex = 0,
		left = 0,
		bottom = 0,
		onPick,
		onHover
	} = $props<{
		kind: '@' | '/';
		query: string;
		items: SuggestionItem[];
		selectedIndex: number;
		left: number;
		bottom: number;
		onPick: (s: SuggestionItem) => void;
		onHover: (index: number) => void;
	}>();

	let listEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!listEl || items.length === 0) return;
		const el = listEl.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | null;
		el?.scrollIntoView({ block: 'nearest' });
	});
</script>

{#snippet highlightText(text: string, hits: number[] = [], offset = 0)}
	{#if hits.length === 0}
		{text}
	{:else}
		{@const hitSet = new Set(hits)}
		{#each [...text] as ch, i}
			{#if hitSet.has(i + offset)}
				<mark class="highlight-char">{ch}</mark>
			{:else}
				<span>{ch}</span>
			{/if}
		{/each}
	{/if}
{/snippet}

<div
	class="suggest-panel rv-lift"
	style="left: {left}px; bottom: {bottom}px;"
	role="listbox"
	tabindex="-1"
>
	<div bind:this={listEl} class="suggest-list">
		{#if items.length === 0}
			<div class="empty-notice">
				{kind === '@'
					? m.chat_v2_composer_no_files({ query })
					: m.chat_v2_composer_no_commands({ query })}
			</div>
		{:else}
			{#each items as item, index}
				{@const active = index === selectedIndex}
				{@const prev = items[index - 1]}

				<!-- Header di sezione -->
				{#if item.kind === 'file' && index === 0}
					<div class="section-header">
						{query.trim().length === 0
							? m.chat_v2_composer_recent_files()
							: m.chat_v2_composer_project_files()}
					</div>
				{:else if item.kind === 'cmd' && (!prev || (prev.kind === 'cmd' && prev.isSkill !== item.isSkill))}
					<div class="section-header">
						{item.isSkill
							? m.chat_v2_composer_skills()
							: m.chat_v2_composer_commands()}
					</div>
				{/if}

				{#if item.kind === 'file'}
					{@const file = item.item}
					{@const nameIdx = file.path.lastIndexOf('/') + 1}
					<button
						type="button"
						role="option"
						aria-selected={active}
						data-index={index}
						class="suggest-row"
						class:active
						onmousedown={(e) => e.preventDefault()}
						onmouseenter={() => onHover(index)}
						onclick={() => onPick(item)}
					>
						<span class="row-icon">
							{#if file.priority === 'active' || file.priority === 'open'}
								<IconEditor />
							{:else if file.priority === 'touched'}
								<IconHistory />
							{:else}
								<IconFile />
							{/if}
						</span>

						<span class="file-name">
							{@render highlightText(file.path.slice(nameIdx), item.hits, nameIdx)}
						</span>

						{#if nameIdx > 0}
							<span class="file-dir font-mono">
								{@render highlightText(file.path.slice(0, nameIdx), item.hits, 0)}
							</span>
						{/if}

						{#if active}
							<span class="token-est font-mono">
								~{formatTokens(Math.min(40000, Math.round(file.path.length * 30)))} tok
							</span>
						{/if}
					</button>
				{:else}
					{@const cmd = item.command}
					<button
						type="button"
						role="option"
						aria-selected={active}
						data-index={index}
						class="suggest-row cmd-row"
						class:active
						onmousedown={(e) => e.preventDefault()}
						onmouseenter={() => onHover(index)}
						onclick={() => onPick(item)}
					>
						<span class="row-icon">
							{#if item.isSkill}
								<IconSparkles />
							{:else}
								<span class="slash-glyph font-mono">/</span>
							{/if}
						</span>

						<div class="cmd-content">
							<div class="cmd-top">
								<span class="cmd-name font-mono">
									/<span>{@render highlightText(cmd.name, item.hits)}</span>
								</span>
								{#if cmd.input?.hint}
									<span class="cmd-args font-mono">‹{cmd.input.hint}›</span>
								{/if}
								{#if !item.isSkill && (cmd.source === 'studio' || ['new', 'compact', 'copy', 'model', 'role', 'thinking'].includes(cmd.name))}
									<span class="cmd-badge-immediate">{m.chat_v2_composer_immediate()}</span>
								{/if}
							</div>
							<span class="cmd-desc">{cmd.description}</span>
						</div>
					</button>
				{/if}
			{/each}
		{/if}
	</div>

	<div class="suggest-footer">
		<span><kbd>↑↓</kbd> naviga</span>
		<span><kbd>↵</kbd> o <kbd>Tab</kbd> inserisci</span>
		<span><kbd>Esc</kbd> chiudi</span>
	</div>
</div>

<style>
	.suggest-panel {
		position: absolute;
		z-index: var(--z-overlay);
		/* Larghezza allineata a SUGGEST_WIDTH in Composer.svelte (calcolo dell'ancoraggio). */
		width: 440px;
		max-width: calc(100% - 16px);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		color: var(--ink);
		font-family: var(--font-ui);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		/* La palette segue la digitazione: comparsa rapida, non la rivelazione lenta della chat. */
		--dur: 150ms;
		--blur: 3px;
	}

	.suggest-list {
		padding: var(--space-1);
		max-height: 280px;
		overflow-x: hidden;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.section-header {
		padding: var(--space-2) var(--space-2) 2px;
		font-size: var(--text-group-label);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}

	.suggest-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: 5px var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		text-align: left;
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.suggest-row:hover,
	.suggest-row.active {
		background: var(--bg-hover);
	}

	.cmd-row {
		align-items: flex-start;
		padding: 6px var(--space-2);
	}

	.row-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-muted);
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		margin-top: 1px;
		--icon-size: 14px;
	}

	.slash-glyph {
		font-weight: 700;
		color: var(--ink-muted);
	}

	.file-name {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		flex-shrink: 1;
	}

	.file-dir {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}

	.token-est {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		flex-shrink: 0;
		margin-left: auto;
	}

	.cmd-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.cmd-top {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
	}

	.cmd-name {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.cmd-args {
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.cmd-badge-immediate {
		margin-left: auto;
		font-size: var(--text-caption);
		color: var(--ink-faint);
		padding: 0 4px;
		background: var(--bg-base);
		border-radius: var(--radius-sm);
	}

	.cmd-desc {
		font-size: var(--text-caption);
		line-height: 1.35;
		color: var(--ink-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.suggest-row.active .cmd-desc {
		white-space: normal;
	}

	.highlight-char {
		background: transparent;
		color: var(--ink);
		font-weight: 700;
		text-decoration: underline;
		text-decoration-color: var(--warn);
		text-decoration-thickness: 2px;
		text-underline-offset: 2px;
	}

	.empty-notice {
		padding: var(--space-4);
		text-align: center;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.suggest-footer {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 5px var(--space-3);
		border-top: 1px solid var(--line);
		background: var(--bg-base);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		border-bottom-left-radius: var(--radius-lg);
		border-bottom-right-radius: var(--radius-lg);
	}

	.suggest-footer kbd {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}
</style>
