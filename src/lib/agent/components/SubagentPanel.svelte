<script lang="ts">
	// Pannello roster dei subagent: stato, modello, tool corrente, token, durata.
	// Clic apre `SubagentDrawer`.
	//
	// In sola lettura: il protocollo RPC non espone comandi per steerare
	// o uccidere un subagent. Lo dichiara in fondo invece di inventare bottoni.
	import AgentLink from '../tools/parts/AgentLink.svelte';
	import type { AgentProgress } from '../wire';

	let {
		subagents,
		onOpenDrawer,
		onClose
	} = $props<{
		subagents: AgentProgress[];
		onOpenDrawer: (id: string) => void;
		onClose: () => void;
	}>();

	function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
			return;
		}
		if (e.key === 'Escape') {
			e.stopPropagation();
			onClose();
		}
	}

	// Azione per intrappolare il fuoco dentro il pannello: sposta il fuoco
	// sul primo elemento interattivo all'apertura e lo confina con Tab/Shift+Tab,
	// cosi' l'aria-modal dichiarato e' vero e non solo un'etichetta.
	function trapFocus(node: HTMLElement) {
		const previouslyFocused = document.activeElement as HTMLElement | null;
		const focusableSelector =
			'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

		const first = node.querySelector<HTMLElement>(focusableSelector);
		if (first) {
			first.focus();
		}

		function onKeydown(e: KeyboardEvent) {
			if (e.key !== 'Tab') return;
			const focusables = Array.from(node.querySelectorAll<HTMLElement>(focusableSelector));
			if (focusables.length === 0) return;
			const firstEl = focusables[0];
			const lastEl = focusables[focusables.length - 1];

			if (e.shiftKey) {
				if (document.activeElement === firstEl) {
					e.preventDefault();
					lastEl.focus();
				}
			} else if (document.activeElement === lastEl) {
				e.preventDefault();
				firstEl.focus();
			}
		}

		node.addEventListener('keydown', onKeydown);

		return {
			destroy() {
				node.removeEventListener('keydown', onKeydown);
				// Ripristina il fuoco a chi aveva aperto il pannello
				if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
					previouslyFocused.focus();
				}
			}
		};
	}
</script>

<svelte:window onkeydown={handleKeydown} />
<!-- Bottone decorativo: chiude al clic ma resta fuori da tab e albero di
     accessibilita'; il fuoco vero passa dal pannello (fuoco iniziale +
     trap) e da Esc, non dal backdrop. -->
<button type="button" class="panel-backdrop" onclick={onClose} aria-hidden="true" tabindex="-1"></button>

<div class="subagent-panel" role="dialog" aria-modal="true" aria-label="Elenco subagent" use:trapFocus>
	<div class="panel-head">
		<span class="title">Subagent del progetto ({subagents.length})</span>
		<button type="button" class="btn-close" onclick={onClose} aria-label="Chiudi">×</button>
	</div>

	<div class="roster">
		{#each subagents as progress (progress.id ?? progress.index)}
			<AgentLink {progress} />
		{:else}
			<div class="empty">Nessun subagent registrato in questa sessione.</div>
		{/each}
	</div>

	<div class="readonly-notice">
		<span>Per steerare o terminare un subagent passa al terminale (Alt+A).</span>
	</div>
</div>

<style>
	.panel-backdrop {
		position: absolute;
		inset: 0;
		background: var(--backdrop);
		border: none;
		padding: 0;
		margin: 0;
		cursor: default;
		z-index: var(--z-overlay);
	}

	.subagent-panel {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		max-height: 70%;
		background: var(--bg-overlay);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		box-shadow: var(--shadow-overlay);
		display: flex;
		flex-direction: column;
		z-index: var(--z-dialog);
		overflow: hidden;
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--line);
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.title {
		color: var(--ink);
	}

	.btn-close {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		font-size: var(--text-lg);
		cursor: pointer;
		line-height: 1;
		padding: 0 4px;
	}

	.btn-close:hover {
		color: var(--ink);
	}

	.roster {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-2) var(--space-3);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.empty {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		padding: var(--space-3) 0;
		font-style: italic;
	}

	.readonly-notice {
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--line);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		background: var(--bg-sunken);
	}
</style>
