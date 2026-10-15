<!--
  SuggestTray.svelte — Palette dei suggerimenti per comandi slash e skill nel composer.
  Ancorata sopra la sagoma .composer-shell, fedele a src/lib/agent/components/SuggestPanel.svelte di Studio.
-->
<script lang="ts">
	import type { CommandSuggestionItem } from '../../chat/suggest.ts';
	import { IconSparkles } from '../../icons.ts';
	import { t } from '../../i18n.ts';

	let {
		items = [],
		selectedIndex = 0,
		onSelect,
		onHover
	}: {
		items: CommandSuggestionItem[];
		selectedIndex: number;
		onSelect: (item: CommandSuggestionItem) => void;
		onHover?: (index: number) => void;
	} = $props();

	let listEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!listEl || items.length === 0) return;
		const el = listEl.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | null;
		el?.scrollIntoView({ block: 'nearest' });
	});
</script>

{#snippet highlightText(text: string, hits: number[] = [])}
	{#if hits.length === 0}
		{text}
	{:else}
		{@const hitSet = new Set(hits)}
		{#each [...text] as ch, i}
			{#if hitSet.has(i)}
				<mark class="highlight-char">{ch}</mark>
			{:else}
				<span>{ch}</span>
			{/if}
		{/each}
	{/if}
{/snippet}

<div class="suggest-tray" role="listbox" tabindex="-1">
	<div bind:this={listEl} class="suggest-list">
		{#if items.length === 0}
			<div class="empty-notice">
				{t('suggestEmpty')}
			</div>
		{:else}
			{#each items as item, index (item.command.name + (item.isSkill ? ':skill' : ':cmd'))}
				{@const active = index === selectedIndex}
				{@const prev = items[index - 1]}
				{@const cmd = item.command}

				<!-- Header di sezione: comandi regolari o skill -->
				{#if !prev || prev.isSkill !== item.isSkill}
					<div class="section-header">
						{item.isSkill ? t('suggestSkills') : t('suggestCommands')}
					</div>
				{/if}

				<button
					type="button"
					role="option"
					aria-selected={active}
					data-index={index}
					class="suggest-row cmd-row"
					class:active
					onmousedown={(e) => e.preventDefault()}
					onmouseenter={() => onHover?.(index)}
					onclick={() => onSelect(item)}
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
								{#if item.isSkill}
									/skill:{@render highlightText(cmd.name, item.hits)}
								{:else}
									/{@render highlightText(cmd.name, item.hits)}
								{/if}
							</span>
							{#if cmd.hint}
								<span class="cmd-args font-mono">‹{cmd.hint}›</span>
							{/if}
							{#if !item.isSkill && (cmd.name === 'new' || cmd.name === 'clear' || cmd.name === 'compact')}
								<span class="cmd-badge-immediate">{t('suggestImmediate')}</span>
							{/if}
						</div>
						{#if cmd.description}
							<span class="cmd-desc">{cmd.description}</span>
						{/if}
					</div>
				</button>
			{/each}
		{/if}
	</div>
</div>

<style>
	.suggest-tray {
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		margin-bottom: 6px;
		z-index: var(--z-overlay, 50);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		color: var(--ink);
		font-family: var(--font-ui);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.suggest-list {
		padding: var(--space-1);
		max-height: 260px;
		overflow-x: hidden;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.empty-notice {
		padding: 10px 12px;
		font-size: var(--text-caption);
		color: var(--ink-faint);
		text-align: center;
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
		align-items: flex-start;
		gap: var(--space-2);
		width: 100%;
		padding: 6px var(--space-2);
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
		background: color-mix(in oklch, var(--brand) 22%, transparent);
		color: var(--brand-ink);
		font-weight: 700;
		border-radius: 2px;
		padding: 0 1px;
	}
</style>
