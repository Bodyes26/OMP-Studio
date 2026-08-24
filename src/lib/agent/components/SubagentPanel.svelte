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
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="panel-backdrop" onclick={onClose}></div>

<div class="subagent-panel" role="dialog" aria-label="Elenco subagent">
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
		<span>Per steerare o terminare un subagent passa alla scheda TERMINAL (Alt+A).</span>
	</div>
</div>

<style>
	.panel-backdrop {
		position: absolute;
		inset: 0;
		background: var(--backdrop);
		z-index: var(--z-overlay);
	}

	.subagent-panel {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		max-height: 70%;
		background: var(--bg-overlay);
		border-top: 1px solid var(--line-strong);
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
