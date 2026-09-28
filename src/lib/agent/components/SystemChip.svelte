<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Riga singola per messaggi di sistema senza tessera propria.
	// Linguaggio v2: traccia leggera (12.5px, --ink-muted, icona 14px, chevron espandibile).
	import type { SystemChipEntry } from '../session.svelte';
	import OutputBlock from '../tools/parts/OutputBlock.svelte';
	import { IconChevronRight, IconInfo } from '$lib/icons';

	let { entry, fresh = false }: { entry: SystemChipEntry; fresh?: boolean } = $props();

	let expanded = $state(false);

	const hasBody = $derived(Boolean(entry.body && entry.body.trim().length > 0));

	const bodyPreview = $derived(
		entry.body ? entry.body.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
	);
</script>

<div
	class="system-chip-row"
	class:rv-blur={fresh}
	class:internal={entry.internal}
	style={fresh ? '--dur: 400ms; --blur: 4px;' : undefined}
>
	{#if hasBody}
		<button
			type="button"
			class="chip-toggle"
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}
			title={expanded ? m.ui_systemchip_comprimi_messaggio_di_sistema_175d() : m.ui_systemchip_espandi_messaggio_di_sistema_b95f()}
		>
			<span class="chevron" class:expanded aria-hidden="true">
				<IconChevronRight />
			</span>
			<span class="title">{entry.title}</span>
			{#if entry.internal}
				<span class="internal-tag" title={m.ui_systemchip_messaggio_di_sistema_interno_nascosto_di_default_4677()}>interno</span>
			{/if}
			{#if !expanded && bodyPreview}
				<span class="preview">· {bodyPreview}</span>
			{/if}
		</button>
	{:else}
		<div class="chip-static">
			<span class="static-icon" aria-hidden="true">
				<IconInfo />
			</span>
			<span class="title">{entry.title}</span>
			{#if entry.internal}
				<span class="internal-tag" title={m.ui_systemchip_messaggio_di_sistema_interno_nascosto_di_default_4677()}>interno</span>
			{/if}
		</div>
	{/if}

	{#if hasBody && expanded}
		<div class="chip-body rv-blur" style="--dur: 200ms; --blur: 2px;">
			<OutputBlock text={entry.body} label={m.ui_systemchip_messaggio_19f2()} />
		</div>
	{/if}
</div>

<style>
	.system-chip-row {
		width: 100%;
		padding: 2px 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--ink-muted);
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.chip-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: none;
		padding: 2px 4px;
		margin-left: -4px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--ink-muted);
		width: 100%;
		min-width: 0;
		transition: background-color var(--dur-fast), color var(--dur-fast);
	}

	.chip-toggle:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.chip-static {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 0;
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--ink-muted);
	}

	.chevron {
		--icon-size: 14px;
		width: 14px;
		height: 14px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: transform var(--dur-fast) var(--ease-out);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.chip-toggle:hover .chevron {
		color: var(--ink-muted);
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.static-icon {
		--icon-size: 14px;
		width: 14px;
		height: 14px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.title {
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.preview {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
	}

	.internal-tag {
		font-size: 10px;
		line-height: 1.2;
		padding: 0 4px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		color: var(--ink-faint);
		background: var(--bg-sunken);
		user-select: none;
		flex-shrink: 0;
	}

	.chip-body {
		margin-top: 2px;
		border-left: 1px solid var(--line);
		margin-left: 3px;
		padding-left: 10px;
	}
</style>
