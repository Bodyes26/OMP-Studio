<!--
  CompactChoiceCard.svelte.

  Scheda sopra il composer quando `/compact` (scritto o da pulsante) arriva
  con un modello che legge le immagini: snapcompact, soft o remote, un clic.
  Come la TUI, snapcompact e' la proposta (tasto 1, preselezionata).
  Sparisce da sola alla scelta o con Esc; il composer resta usabile.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { IconClose } from '#lib/icons.ts';
	import { COMPACT_MODES, type CompactMode } from '../compactMode';
	import type { AgentSession } from '../session.svelte';

	let { session, visible = true } = $props<{ session: AgentSession; visible?: boolean }>();

	function label(mode: CompactMode): string {
		return mode === 'snapcompact'
			? m.compact_choice_snapcompact()
			: mode === 'soft'
				? m.compact_choice_soft()
				: m.compact_choice_remote();
	}

	function description(mode: CompactMode): string {
		return mode === 'snapcompact'
			? m.compact_choice_snapcompact_desc()
			: mode === 'soft'
				? m.compact_choice_soft_desc()
				: m.compact_choice_remote_desc();
	}

	function choose(mode: CompactMode) {
		void session.compact(undefined, mode);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!visible || e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			session.compactChoiceOpen = false;
			return;
		}
		// I tasti 1-3 valgono solo a composer vuoto: altrimenti sono testo.
		const target = e.target as HTMLElement | null;
		if (target?.closest('input, textarea, [contenteditable="true"]')) return;
		const mode = COMPACT_MODES[Number(e.key) - 1];
		if (mode) {
			e.preventDefault();
			choose(mode);
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="compact-choice rv-lift" style="--dur: 200ms;" role="region" aria-label={m.compact_choice_title()}>
	<div class="cc-head">
		<div class="cc-q">{m.compact_choice_title()}</div>
		<button
			type="button"
			class="cc-close"
			aria-label={m.compact_choice_cancel()}
			title={m.compact_choice_cancel()}
			onclick={() => (session.compactChoiceOpen = false)}
		>
			<IconClose aria-hidden="true" />
		</button>
	</div>
	<div class="cc-d">{m.compact_choice_desc()}</div>
	<div class="cc-opts">
		{#each COMPACT_MODES as mode, index (mode)}
			<button type="button" class="cc-opt" class:rec={index === 0} onclick={() => choose(mode)}>
				<span class="cc-opt-l">
					{label(mode)}
					<span class="cc-kbd font-mono">{index + 1}</span>
				</span>
				<span class="cc-opt-dd">{description(mode)}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.compact-choice {
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-2xl);
		box-shadow: var(--shadow-raise);
		padding: var(--space-3) var(--space-4);
		min-width: 0;
		margin-bottom: var(--space-2);
	}
	.cc-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.cc-q {
		font-size: 15px;
		font-weight: 500;
		color: var(--ink);
	}
	.cc-close {
		display: inline-flex;
		padding: 4px;
		border: 0;
		background: transparent;
		color: var(--ink-faint);
		border-radius: var(--radius-sm);
		cursor: pointer;
		--icon-size: 14px;
	}
	.cc-close:hover {
		color: var(--ink);
		background: color-mix(in srgb, var(--ink) 8%, transparent);
	}
	.cc-d {
		font-size: var(--text-sm);
		color: var(--ink-muted);
		margin: 2px 0 10px;
	}
	.cc-opts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}
	.cc-opt {
		display: flex;
		flex-direction: column;
		gap: 4px;
		align-items: flex-start;
		text-align: left;
		padding: 8px 12px;
		font: inherit;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background-color var(--dur-instant) var(--ease-out), border-color var(--dur-instant) var(--ease-out);
	}
	.cc-opt:hover {
		background: color-mix(in srgb, var(--ink) 6%, transparent);
		border-color: var(--line-strong);
	}
	.cc-opt:focus-visible {
		outline: none;
		box-shadow: var(--focus-inset);
	}
	.cc-opt.rec {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 7%, transparent);
	}
	.cc-opt-l {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 13.5px;
		font-weight: 500;
		color: var(--ink);
	}
	.cc-opt-dd {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}
	.cc-kbd {
		font-size: 10.5px;
		padding: 0 5px;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		line-height: 16px;
	}
	@media (max-width: 560px) {
		.cc-opts {
			grid-template-columns: 1fr;
		}
	}
</style>
