<!--
  ConfirmDialog.svelte — Conferma semplice sopra `Dialog` (Design v2).

  Una domanda, un testo e due azioni: annulla fantasma, conferma primaria o di
  pericolo. Il fuoco iniziale va sulla conferma, come nelle finestre di sistema;
  Esc e il velo annullano. Il corpo puo' essere un testo (`message`) o uno
  snippet quando serve contenuto ricco (versioni, nomi in mono).
  Un'azione secondaria facoltativa (`secondaryLabel` + `onSecondary`) copre le
  scelte a due esiti piu' l'annullamento, senza che Esc o il velo ne scelgano una.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Dialog from './Dialog.svelte';
	import { m } from '$lib/paraglide/messages.js';

	let {
		open = false,
		title,
		message,
		children,
		icon,
		confirmLabel,
		cancelLabel,
		tone = 'primary',
		confirmDisabled = false,
		secondaryLabel,
		onSecondary,
		onConfirm,
		onCancel
	}: {
		open?: boolean;
		title: string;
		message?: string;
		children?: Snippet;
		icon?: Snippet;
		confirmLabel: string;
		cancelLabel?: string;
		/** `danger` per le azioni che distruggono o interrompono. */
		tone?: 'primary' | 'danger';
		confirmDisabled?: boolean;
		/** Seconda scelta, mostrata tra annulla e conferma. */
		secondaryLabel?: string;
		onSecondary?: () => void;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();
</script>

<Dialog {open} {title} {icon} onClose={onCancel} initialFocus="button.confirm-dialog-action">
	{#snippet body()}
		{#if message}
			<p class="confirm-dialog-message">{message}</p>
		{/if}
		{@render children?.()}
	{/snippet}
	{#snippet footer()}
		<button type="button" class="ui-button ui-button-ghost" onclick={onCancel}>
			{cancelLabel ?? m.common_cancel()}
		</button>
		{#if secondaryLabel && onSecondary}
			<button
				type="button"
				class="ui-button ui-button-secondary"
				disabled={confirmDisabled}
				onclick={onSecondary}
			>
				{secondaryLabel}
			</button>
		{/if}
		<button
			type="button"
			class="ui-button confirm-dialog-action"
			class:ui-button-primary={tone === 'primary'}
			class:ui-button-danger={tone === 'danger'}
			disabled={confirmDisabled}
			onclick={onConfirm}
		>
			{confirmLabel}
		</button>
	{/snippet}
</Dialog>

<style>
	.confirm-dialog-message {
		margin: 0;
		font-size: var(--text-body);
		line-height: 1.45;
		color: var(--ink-muted);
		text-wrap: pretty;
	}
</style>
