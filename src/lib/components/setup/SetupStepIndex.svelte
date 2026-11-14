<!--
  SetupStepIndex.svelte — indice dei passi a sinistra della finestra.

  Il segno racconta il passo (fatto, qui, da fare); a destra una meta breve dice
  il risultato già prodotto (versione di omp, provider collegati, tema). I passi
  fatti restano cliccabili per tornare indietro senza perdere nulla; quelli non
  ancora raggiunti no, così non si salta un requisito (SET-010/011).
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import BrandMark from '#lib/ui/BrandMark.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import { SETUP_STEPS, setupFlow, type SetupStepId } from '#lib/stores/setupFlow.svelte.ts';
	import { stepLabel } from './stepLabels.ts';

	let { onNavigate }: { onNavigate: (step: SetupStepId) => void } = $props();

	/** La meta del passo: solo un fatto già avvenuto, mai un'anteprima. */
	function metaFor(id: SetupStepId): string | null {
		const status = setupFlow.status;
		if (id === 'engine') {
			if (!status?.ompInstalled || status.ompBroken) return null;
			return status.ompVersion ? `omp ${status.ompVersion}` : 'omp';
		}
		if (id === 'providers') {
			const count = setupFlow.connectedProviders.length || (status?.credentialProviders.length ?? 0);
			return count > 0 ? String(count) : null;
		}
		if (id === 'appearance' && setupFlow.done.includes('appearance')) return setupFlow.themeName;
		return null;
	}

	function reachable(id: SetupStepId): boolean {
		return id === setupFlow.step || setupFlow.done.includes(id) || id === setupFlow.firstOpenStep;
	}
</script>

<aside class="index">
	<div class="brand">
		<BrandMark class="mark" />
		<div class="brand-text">
			<div class="brand-name">OMP Studio</div>
			<div class="su-meta faint">{setupFlow.mode === 'first' ? m.setup2_mode_first() : m.setup2_mode_return()}</div>
		</div>
	</div>

	<nav aria-label={m.setup2_steps_aria()}>
		<ol>
			{#each SETUP_STEPS as id (id)}
				{@const current = id === setupFlow.step}
				{@const finished = setupFlow.done.includes(id) && !current}
				{@const open = reachable(id)}
				{@const meta = metaFor(id)}
				<li>
					<button
						type="button"
						class="step"
						class:current
						class:finished
						class:locked={!open}
						disabled={!open}
						aria-current={current ? 'step' : undefined}
						onclick={() => onNavigate(id)}
					>
						{#if current}
							<span class="su-mark-current"></span>
						{:else if finished}
							<StatusMark status="completed" />
						{:else}
							<StatusMark status="pending" />
						{/if}
						<span class="su-label label" class:medium={current}>{stepLabel(id)}</span>
						{#if meta}
							<span class="su-meta meta">{meta}</span>
						{/if}
					</button>
				</li>
			{/each}
		</ol>
	</nav>
</aside>

<style>
	.index {
		display: flex;
		width: 212px;
		flex: none;
		flex-direction: column;
		border-right: 1px solid var(--line);
		background: var(--bg-base);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 18px 16px 16px;
	}

	.brand :global(.mark) {
		width: 22px;
		height: 18px;
		flex: none;
		color: var(--ink);
	}

	.brand-text {
		line-height: 1.2;
	}

	.brand-name {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.faint {
		color: var(--ink-faint);
	}

	nav {
		flex: 1;
		padding: 0 8px;
		overflow-y: auto;
		scrollbar-width: thin;
	}

	ol {
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.step {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: 32px;
		padding: 0 8px;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink-muted);
		text-align: left;
		cursor: pointer;
		transition:
			background-color 120ms var(--ease-out),
			color 120ms var(--ease-out);
	}

	.step:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.step.finished {
		color: var(--ink-muted);
	}

	.step.current {
		background: var(--bg-active);
		color: var(--ink);
	}

	.step.locked {
		color: var(--ink-faint);
		cursor: default;
	}

	.label {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.medium {
		font-weight: 500;
	}

	.meta {
		flex: none;
		max-width: 74px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
	}
</style>
