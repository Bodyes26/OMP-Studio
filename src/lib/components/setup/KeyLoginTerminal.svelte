<script lang="ts">
	/**
	 * Mini-terminale di login per i provider a chiave (SET-040).
	 *
	 * Non è una simulazione grafica: è `omp login <id>` in un vero PTY, come il
	 * Dialog di accesso della tab Provider. Il motivo è che omp chiede la chiave
	 * in modo nascosto e la scrive lui in `agent.db`: Studio non deve né leggerla
	 * né salvarla, quindi non esiste una via per farlo con un campo suo.
	 *
	 * Alla chiusura il passo rilegge gli account e decide se la tessera è
	 * collegata: il terminale non dichiara mai «Collegato» da sé.
	 */
	import { m } from '#lib/paraglide/messages.js';
	import { IconClose } from '#lib/icons.ts';
	import Terminal from '#lib/terminal/Terminal.svelte';
	import type { TerminalAgentState } from '#lib/terminal/terminal.ts';

	let {
		providerId,
		providerName,
		/** Chiamato quando il terminale è chiuso o l'utente lo chiude: rilegge lo stato. */
		onDone
	} = $props<{
		providerId: string;
		providerName: string;
		onDone: () => void;
	}>();

	// `omp login` stampa l'esito nel terminale e termina: dopo un po' di quiete
	// si può dire «fatto», ma l'esito vero lo dà la rilettura degli account.
	let state = $state<TerminalAgentState>('unknown');
	const hint = $derived.by(() => {
		if (state === 'working') return m.setup2_prov_term_waiting();
		if (state === 'attention') return m.setup2_prov_term_attention();
		return m.setup2_prov_term_hint();
	});
</script>

<div class="key-term rv-lift" style="--dur: 210ms">
	<div class="key-term-bar">
		<code class="key-term-title">omp login {providerId}</code>
		<span class="key-term-hint">{hint}</span>
		<button
			type="button"
			class="key-term-close"
			aria-label={m.setup2_prov_term_close()}
			onclick={onDone}
		>
			<IconClose />
		</button>
	</div>
	<div class="key-term-body">
		{#key providerId}
			<Terminal cwd={''} launchArgs={['login', providerId]} onStateChange={(s) => (state = s)} />
		{/key}
	</div>
	<p class="key-term-foot">{m.setup2_prov_term_foot({ name: providerName })}</p>
</div>

<style>
	.key-term {
		/* Sta dentro la tessera allargata: è un controllo, non un pannello, quindi
		   niente doppio bordo (regola «niente card annidate»). */
		margin-top: 10px;
		border-top: 1px solid var(--line);
		padding-top: 8px;
	}

	.key-term-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 22px;
		margin-bottom: 6px;
	}

	.key-term-title {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.key-term-hint {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.key-term-close {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		margin-left: auto;
		flex: none;
		padding: 0;
		border-radius: var(--radius-sm);
		border: none;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
	}

	.key-term-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.key-term-body {
		/* Altezza fissa: il terminale ha bisogno di un contenitore dimensionato,
		   e la tessera deve restare nella griglia senza saltare a ogni riga. */
		position: relative;
		height: 190px;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		overflow: hidden;
	}

	.key-term-foot {
		margin: 6px 0 0;
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	@media (prefers-reduced-motion: reduce) {
		.key-term {
			animation: none;
		}
	}
</style>
