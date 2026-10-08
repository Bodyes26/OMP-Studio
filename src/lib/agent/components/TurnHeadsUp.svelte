<script lang="ts">
	// Heads-up di fine turno (Gate R40): una frase, prima del piè di
	// turno, solo quando c'e' qualcosa che l'utente rischia di perdere a meta'
	// del racconto. Due gesti soli: il clic sulla frase porta al punto del
	// turno, la X la segna come vista. Niente elenchi, niente pulsanti di
	// azione: chi vuole agire risponde nel composer.
	//
	// Colore: superficie neutra; l'ambra sta solo nell'icona (Outcome-Only
	// Color Rule). La provenienza (agente, smol, fatti) e' nel tooltip, cosi'
	// una sintesi dedotta non si spaccia per un fatto (Principio 7).
	import { m } from '$lib/paraglide/messages.js';
	import { IconClose, IconWarning } from '$lib/icons';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import type { TurnHeadsUp } from '../turnHeadsUp';

	let {
		headsUp,
		onGoto,
		onDismiss
	}: {
		headsUp: TurnHeadsUp;
		onGoto?: () => void;
		onDismiss: () => void;
	} = $props();

	const sourceLabel = $derived(
		headsUp.source === 'agent'
			? m.headsup_source_agent()
			: headsUp.source === 'smol'
				? m.headsup_source_smol()
				: m.headsup_source_facts()
	);
</script>

<aside class="turn-headsup rv-blur" style="--dur: 400ms; --blur: 4px;" aria-label={m.headsup_label()}>
	<span class="hu-icon" aria-hidden="true"><IconWarning /></span>
	<Tooltip text={`${sourceLabel} · ${m.headsup_goto_title()}`} placement="top">
		<button type="button" class="hu-text" onclick={() => onGoto?.()} disabled={!onGoto}>
			<span class="hu-label">{m.headsup_label()}</span>
			<span class="hu-sentence">{headsUp.text}</span>
		</button>
	</Tooltip>
	<Tooltip text={m.headsup_dismiss()} placement="top">
		<button type="button" class="hu-close" aria-label={m.headsup_dismiss_aria()} onclick={onDismiss}>
			<IconClose />
		</button>
	</Tooltip>
</aside>

<style>
	.turn-headsup {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin-top: var(--space-3);
		padding: 6px 6px 6px 10px;
		max-width: 100%;
		width: fit-content;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		font-size: var(--text-trace);
		line-height: 1.45;
	}

	.hu-icon {
		--icon-size: 14px;
		display: inline-flex;
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--warn);
	}

	.hu-text {
		display: inline;
		min-width: 0;
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.hu-text:disabled {
		cursor: default;
	}

	.hu-text:not(:disabled):hover .hu-sentence {
		text-decoration: underline;
		text-decoration-color: var(--line-strong);
		text-underline-offset: 3px;
	}

	.hu-text:focus-visible {
		outline: 2px solid var(--focus-ring, var(--brand));
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}

	.hu-label {
		margin-right: 6px;
		color: var(--ink-muted);
		font-weight: 560;
	}

	.hu-close {
		--icon-size: 12px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		padding: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--ink-faint);
		cursor: pointer;
	}

	.hu-close:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}
</style>
