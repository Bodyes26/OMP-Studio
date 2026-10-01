<script lang="ts">
	/**
	 * Menu a tendina per la selezione del livello di thinking/reasoning.
	 */
	import type { ThinkingLevel, ModelInfo } from '$lib/agent/wire';
	import { modelSupportsReasoning } from '$lib/agent/wire';
	import { IconCheck } from '$lib/icons';
	import ThinkingMeter from './ThinkingMeter.svelte';
	import { m } from '$lib/paraglide/messages.js';

	let {
		level = 'off',
		model = null,
		onPick
	} = $props<{
		level?: ThinkingLevel;
		model?: ModelInfo | null;
		onPick: (l: ThinkingLevel) => void;
	}>();

	interface LevelOption {
		id: ThinkingLevel;
		label: string;
		description: string;
	}

	const LEVELS: LevelOption[] = [
		{ id: 'off', label: 'off', description: 'Disattiva il reasoning' },
		{ id: 'minimal', label: 'minimal', description: 'Reasoning minimo' },
		{ id: 'low', label: 'low', description: 'Reasoning basso' },
		{ id: 'medium', label: 'medium', description: 'Reasoning bilanciato' },
		{ id: 'high', label: 'high', description: 'Reasoning approfondito' },
		{ id: 'xhigh', label: 'xhigh', description: 'Reasoning molto alto' },
		{ id: 'max', label: 'max', description: 'Reasoning massimo' }
	];

	const isSupported = $derived(modelSupportsReasoning(model));
</script>

<div class="menu-container">
	{#if !isSupported}
		<div class="unsupported-msg">
			{m.chat_v2_composer_thinking_unsupported({ model: model?.name || model?.id || 'Questo modello' })}
		</div>
	{:else}
		<div class="menu-header">
			<span>{m.chat_v2_composer_thinking_title()}</span>
		</div>

		<div class="menu-list" role="listbox">
			{#each LEVELS as opt}
				{@const active = opt.id === level}
				<button
					type="button"
					role="option"
					aria-selected={active}
					class="menu-item"
					class:active
					onclick={() => onPick(opt.id)}
				>
					<ThinkingMeter level={opt.id} />
					<span class="level-name">{opt.label}</span>
					<span class="level-desc">{opt.description}</span>
					{#if active}
						<span class="check-icon"><IconCheck /></span>
					{/if}
				</button>
			{/each}
		</div>

		<div class="menu-footer">
			<span>{m.chat_v2_composer_thinking_footer()}</span>
		</div>
	{/if}
</div>

<style>
	.menu-container {
		display: flex;
		flex-direction: column;
		min-width: 320px;
	}

	.unsupported-msg {
		padding: var(--space-3);
		font-size: var(--text-xs);
		line-height: 1.4;
		color: var(--ink-muted);
	}

	.menu-header {
		padding: var(--space-2) var(--space-3) var(--space-1);
		font-size: var(--text-group-label);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
		border-bottom: 1px solid var(--line);
	}

	.menu-list {
		padding: var(--space-1);
		display: flex;
		flex-direction: column;
		gap: 1px;
		max-height: 280px;
		overflow-y: auto;
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		text-align: left;
		cursor: pointer;
		width: 100%;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.menu-item:hover {
		background: var(--bg-hover);
	}

	.menu-item.active {
		background: var(--bg-hover);
		font-weight: 500;
	}

	.level-name {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		width: 54px;
		flex-shrink: 0;
	}

	.level-desc {
		flex: 1;
		color: var(--ink-muted);
		font-size: var(--text-meta);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.check-icon {
		flex-shrink: 0;
		color: var(--brand-ink);
		display: inline-flex;
		align-items: center;
		--icon-size: 14px;
	}

	.menu-footer {
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--line);
		background: var(--bg-base);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		border-bottom-left-radius: var(--radius-lg);
		border-bottom-right-radius: var(--radius-lg);
	}
</style>
