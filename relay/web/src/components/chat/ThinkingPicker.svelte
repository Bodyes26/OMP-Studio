<!--
  ThinkingPicker.svelte — Selettore del livello di ragionamento / thinking.
  Mostra i livelli del catalogo supportati dal modello corrente con l'indicatore a barre e la descrizione.
-->
<script lang="ts">
	import { IconCheck } from '../../icons.ts';
	import { t, type MessageKey } from '../../i18n.ts';
	import ThinkingMeter from './ThinkingMeter.svelte';

	let {
		levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
		activeLevel = 'off',
		onSelect
	}: {
		levels?: string[];
		activeLevel: string;
		onSelect: (level: string) => void;
	} = $props();

	const LEVEL_LABELS: Record<string, MessageKey> = {
		off: 'thinkingLevelOff',
		minimal: 'thinkingLevelMinimal',
		low: 'thinkingLevelLow',
		medium: 'thinkingLevelMedium',
		high: 'thinkingLevelHigh',
		xhigh: 'thinkingLevelXhigh',
		max: 'thinkingLevelMax'
	};

	const LEVEL_DESCRIPTIONS: Record<string, MessageKey> = {
		off: 'thinkingDescOff',
		minimal: 'thinkingDescMinimal',
		low: 'thinkingDescLow',
		medium: 'thinkingDescMedium',
		high: 'thinkingDescHigh',
		xhigh: 'thinkingDescXhigh',
		max: 'thinkingDescMax'
	};
</script>

<div class="thinking-picker-container">
	<div class="level-list" role="listbox">
		{#each levels as level (level)}
			{@const active = level === activeLevel}
			{@const labelKey = LEVEL_LABELS[level]}
			{@const descKey = LEVEL_DESCRIPTIONS[level]}
			{@const label = labelKey ? t(labelKey) : level}
			{@const desc = descKey ? t(descKey) : ''}

			<button
				type="button"
				role="option"
				aria-selected={active}
				class="level-row"
				class:active
				onclick={() => onSelect(level)}
			>
				<div class="meter-wrapper">
					<ThinkingMeter {level} />
				</div>

				<div class="level-content">
					<span class="level-title font-mono">{label}</span>
					{#if desc}
						<span class="level-desc">{desc}</span>
					{/if}
				</div>

				{#if active}
					<span class="check-icon" aria-hidden="true">
						<IconCheck />
					</span>
				{/if}
			</button>
		{/each}
	</div>
</div>

<style>
	.thinking-picker-container {
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	.level-list {
		padding: var(--space-1);
		max-height: 340px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.level-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 8px 10px;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		text-align: left;
		cursor: pointer;
		width: 100%;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.level-row:hover,
	.level-row.active {
		background: var(--bg-hover);
	}

	.meter-wrapper {
		display: flex;
		align-items: center;
		width: 24px;
		justify-content: center;
		flex-shrink: 0;
	}

	.level-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.level-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.level-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.check-icon {
		display: grid;
		place-items: center;
		color: var(--brand-ink);
		--icon-size: 16px;
		flex-shrink: 0;
	}
</style>
