<!--
  UpdatesStep.svelte — passo Aggiornamenti (SET-014).

  Due sole scelte, e la conseguenza scritta sotto in chiaro: `update.auto` è una
  chiave di `omp`, quindi il valore mostrato è esattamente quello che finisce
  nel file di configurazione.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { setupFlow } from '#lib/stores/setupFlow.svelte.ts';

	const value = $derived(setupFlow.updateMode);
</script>

<div class="updates" role="radiogroup" aria-label={m.setup2_updates_aria()}>
	<button
		type="button"
		role="radio"
		aria-checked={value === 'auto'}
		class="su-choice"
		onclick={() => void setupFlow.setUpdateMode('auto')}
	>
		<span class="su-radio-dot"></span>
		<span class="text">
			<span class="head">
				<span class="title">{m.setup2_updates_auto()}</span>
				<span class="su-pill">{m.setup2_updates_recommended()}</span>
			</span>
			<span class="su-label desc">{m.setup2_updates_auto_desc()}</span>
		</span>
	</button>

	<button
		type="button"
		role="radio"
		aria-checked={value === 'notify'}
		class="su-choice"
		onclick={() => void setupFlow.setUpdateMode('notify')}
	>
		<span class="su-radio-dot"></span>
		<span class="text">
			<span class="title">{m.setup2_updates_notify()}</span>
			<span class="su-label desc">{m.setup2_updates_notify_desc()}</span>
		</span>
	</button>

	<p class="su-meta foot">
		{m.setup2_updates_saved_as()} <code class="su-mono">update.auto = {value === 'auto' ? 'true' : 'false'}</code>
	</p>
</div>

<style>
	.updates {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.text {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.title {
		font-size: var(--text-base);
		font-weight: 500;
		color: var(--ink);
	}

	.desc {
		display: block;
		margin-top: 2px;
		color: var(--ink-muted);
	}

	.foot {
		margin: var(--space-2) 0 0;
		color: var(--ink-faint);
	}
</style>
