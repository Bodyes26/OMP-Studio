<script lang="ts">
	/**
	 * Tasto o chip generico per un comando fissato (pin) nel composer.
	 *
	 * - `form === 'icon'`: pulsante compatto con sola icona e tooltip accessibile;
	 * - `form === 'chip'`: icona + titolo sintetico nella lingua corrente.
	 *
	 * Lo stile si adatta alla zona (`toolbar` usa le metriche dei pulsanti della barra,
	 * `statusLine` adotta l'aspetto monospazio discreto delle voci di stato della chat).
	 */
	import type { Component } from 'svelte';
	import type { CommandManifestEntry, ComposerForm, ComposerZone } from '$lib/agent/commandCatalog/types';
	import { resolveCommandText } from '$lib/agent/commandCatalog/text';
	import * as icons from '$lib/icons';
	import Tooltip from '$lib/ui/Tooltip.svelte';

	let {
		entry,
		form,
		zone,
		disabled = false,
		active = false,
		onActivate
	} = $props<{
		entry: CommandManifestEntry;
		form: ComposerForm;
		zone: ComposerZone;
		disabled?: boolean;
		active?: boolean;
		onActivate?: (entry: CommandManifestEntry) => void;
	}>();

	const text = $derived(resolveCommandText(entry));
	const tooltip = $derived(
		text.summary ? `${text.title}: ${text.summary}` : text.title
	);

	// Risoluzione dinamica dell'icona dal registro centrale: se un'icona non esiste,
	// usiamo un fallback neutro (IconInfo) per non rompere il rendering.
	const IconComponent = $derived(
		(icons as unknown as Record<string, Component>)[entry.icon] ?? icons.IconInfo
	);

	function handleClick() {
		if (disabled) return;
		onActivate?.(entry);
	}
</script>

<Tooltip text={tooltip} placement="top" offset={6} disabled={disabled}>
	<button
		type="button"
		class="pinned-btn"
		class:in-toolbar={zone === 'toolbar'}
		class:in-status={zone === 'statusLine'}
		class:form-icon={form === 'icon'}
		class:form-chip={form === 'chip'}
		class:is-active={active}
		aria-label={tooltip}
		aria-pressed={entry.control === 'toggle' ? active : undefined}
		{disabled}
		onclick={handleClick}
	>
		<span class="pinned-icon" aria-hidden="true">
			<IconComponent />
		</span>
		{#if form === 'chip'}
			<span class="pinned-label font-mono">{text.title}</span>
		{/if}
	</button>
</Tooltip>

<style>
	/* Stile unificato per i comandi fissati nel composer */
	.pinned-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		background: transparent;
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.pinned-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.pinned-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	/* Zona Toolbar: riprende le metriche e il raggio di MenuButton e composer-icon-btn */
	.pinned-btn.in-toolbar.form-icon {
		width: 28px;
		height: 28px;
		padding: 0;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		--icon-size: 15px;
	}

	.pinned-btn.in-toolbar.form-chip {
		height: 28px;
		padding: 0 8px;
		gap: 6px;
		border-radius: var(--radius-md);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		--icon-size: 14px;
	}

	.pinned-btn.in-toolbar:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.pinned-btn.in-toolbar.is-active {
		background: var(--bg-hover);
		color: var(--brand-ink);
		border-color: var(--line);
	}

	/* Zona StatusLine: riprende lo stile leggero e monospazio di ComposerStatusLine */
	.pinned-btn.in-status {
		gap: 4px;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		border: 0;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: inherit;
		--icon-size: 11px;
	}

	.pinned-btn.in-status.form-icon {
		padding: 2px 4px;
	}

	.pinned-btn.in-status:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.pinned-btn.in-status.is-active {
		color: var(--ink);
	}

	.pinned-btn.in-status.is-active .pinned-icon {
		color: var(--brand-ink);
	}

	.pinned-label {
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
