<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Riga singola per tutti i messaggi di sistema che non hanno una tessera propria.
	// Rende le notifiche, i promemoria e le comunicazioni interne consultabili
	// in modo discreto e collassabile senza interrompere il flusso della conversazione.
	import type { SystemChipEntry } from '../session.svelte';
	import OutputBlock from '../tools/parts/OutputBlock.svelte';
	import { IconChevronRight } from '$lib/icons';

	let { entry }: { entry: SystemChipEntry } = $props();

	let expanded = $state(false);

	const hasBody = $derived(Boolean(entry.body && entry.body.trim().length > 0));

	// Titoli come «Processo supervisionato terminato» si ripetono identici: senza
	// un'anteprima del corpo due righe consecutive sono indistinguibili e l'unica
	// informazione utile resta chiusa dietro il chevron.
	const bodyPreview = $derived(
		entry.body ? entry.body.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
	);
</script>

<div class="system-chip-row" class:internal={entry.internal}>
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
				<span class="preview">{bodyPreview}</span>
			{/if}
		</button>
	{:else}
		<div class="chip-static">
			<span class="title">{entry.title}</span>
			{#if entry.internal}
				<span class="internal-tag" title={m.ui_systemchip_messaggio_di_sistema_interno_nascosto_di_default_4677()}>interno</span>
			{/if}
		</div>
	{/if}

	{#if hasBody && expanded}
		<div class="chip-body">
			<OutputBlock text={entry.body} label={m.ui_systemchip_messaggio_19f2()} />
		</div>
	{/if}
</div>

<style>
	.system-chip-row {
		width: 100%;
		border-top: 1px solid var(--line);
		padding: var(--space-1) 0;
		font-size: var(--text-xs);
		line-height: 1.4;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.chip-toggle {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		background: transparent;
		border: none;
		padding: 2px var(--space-1);
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		width: 100%;
	}

	.chip-toggle:hover {
		color: var(--ink-muted);
		background: var(--bg-hover);
	}

	.chip-static {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px var(--space-1);
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.chevron {
		--icon-size: 12px;
		display: inline-flex;
		align-items: center;
		transition: transform var(--dur-fast) var(--ease-out);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.title {
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex-shrink: 0;
	}

	/* L'anteprima cede spazio al titolo e si tronca: la riga resta alta una riga. */
	.preview {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
		opacity: 0.75;
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
		padding-left: calc(12px + var(--space-2));
		padding-top: var(--space-1);
		padding-bottom: var(--space-1);
	}
</style>
