<!--
  EngineStep.svelte — passo Motore (SET-010).

  Un solo messaggio per stato, nessun elenco di passaggi spuntati: quello che
  conta è se omp c'è, se è rotto, se è troppo vecchio. Impronta SHA-256 e font
  Nerd restano silenziosi (SET-031): sono dettagli dell'installazione, non
  decisioni dell'utente. Il download parte durante l'ingresso, quindi al primo
  sguardo la barra è già avanti.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import BrandMark from '#lib/ui/BrandMark.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import { IconRefresh, IconWarning } from '#lib/icons.ts';
	import { setupFlow } from '#lib/stores/setupFlow.svelte.ts';

	const engine = $derived(setupFlow.engine);
	const status = $derived(setupFlow.status);
	const working = $derived(engine.phase === 'downloading');

	function megabytes(bytes: number): string {
		if (bytes <= 0) return '0';
		const mb = bytes / (1024 * 1024);
		return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
	}

	const title = $derived.by(() => {
		if (engine.phase === 'checking') return m.setup2_engine_checking();
		if (working) {
			if (engine.job === 'install') return m.setup2_engine_not_installed();
			if (engine.job === 'repair') return m.setup2_engine_repairing();
			return m.setup2_engine_updating();
		}
		if (engine.phase === 'error') return m.setup2_engine_error_title();
		if (engine.phase === 'broken') return m.setup2_engine_broken_title();
		if (engine.phase === 'outdated') return m.setup2_engine_outdated_title();
		return m.setup2_engine_ready_title();
	});

	const subtitle = $derived.by(() => {
		if (engine.phase === 'checking') return m.setup2_engine_checking_hint();
		if (working) return m.setup2_engine_installing_hint();
		if (engine.phase === 'error') return engine.error ?? '';
		if (engine.phase === 'broken') {
			return m.setup2_engine_broken_body({ path: status?.ompBrokenPath ?? status?.ompPath ?? 'omp' });
		}
		if (engine.phase === 'outdated') {
			return m.setup2_engine_outdated_body({
				current: status?.ompVersion ?? '?',
				min: status?.minOmpVersion ?? '?'
			});
		}
		return m.setup2_engine_ready_body();
	});
</script>

<div class="engine">
	<div class="badge">
		<BrandMark class="logo" />
	</div>

	<div class="body">
		<div class="su-title headline" class:shimmer={working}>{title}</div>
		<p class="su-label subtitle">{subtitle}</p>

		{#if working}
			<div class="bar">
				<div
					class="su-progress"
					role="progressbar"
					aria-label={m.setup2_engine_progress_aria()}
					aria-valuenow={Math.round(engine.percentage)}
					aria-valuemin="0"
					aria-valuemax="100"
				>
					<span style:width="{Math.min(100, Math.max(0, engine.percentage))}%"></span>
				</div>
				<div class="su-meta numbers">
					<span>
						{#if engine.totalBytes > 0}
							{m.setup2_engine_progress_bytes({
								done: megabytes(engine.downloadedBytes),
								total: megabytes(engine.totalBytes)
							})}
						{:else}
							{m.setup2_engine_progress_starting()}
						{/if}
					</span>
					<span>{Math.round(engine.percentage)}%</span>
				</div>
			</div>
		{/if}

		{#if engine.phase === 'broken'}
			<div class="action">
				<button type="button" class="ui-button ui-button-primary" onclick={() => void setupFlow.runEngineJob('repair')}>
					<IconRefresh /> {m.setup2_engine_repair()}
				</button>
			</div>
		{/if}

		{#if engine.phase === 'outdated'}
			<div class="action">
				<button type="button" class="ui-button ui-button-primary" onclick={() => void setupFlow.runEngineJob('update')}>
					{m.setup2_engine_update({ version: status?.minOmpVersion ?? '' })}
				</button>
			</div>
		{/if}

		{#if engine.phase === 'error'}
			<div class="trace">
				<span class="icon" aria-hidden="true"><IconWarning /></span>
				<span class="su-trace">
					{engine.diagnostic ?? m.setup2_engine_error_hint()}
				</span>
			</div>
			<div class="action">
				<button type="button" class="ui-button ui-button-primary" onclick={() => void setupFlow.runEngineJob(engine.job)}>
					<IconRefresh /> {m.setup2_engine_retry()}
				</button>
			</div>
		{/if}

		{#if engine.phase === 'ready'}
			<div class="trace ok">
				<StatusMark status="completed" />
				<span class="su-trace">{m.setup2_engine_ready_trace()}</span>
			</div>
		{/if}

		<!-- Avvisi non bloccanti (SET-021): non aprono il setup da soli, ma chi
		     arriva qui dal chip della barra deve leggere cosa c'è e come risolverlo. -->
		{#if status?.bashMissing}
			<div class="trace">
				<span class="icon" aria-hidden="true"><IconWarning /></span>
				<span class="su-trace">{m.setup2_engine_bash_missing()}</span>
			</div>
		{/if}
		{#if setupFlow.brokenDatabases.length > 0}
			<div class="trace">
				<span class="icon" aria-hidden="true"><IconWarning /></span>
				<span class="su-trace">
					{m.setup2_engine_db_unreadable({ dbs: setupFlow.brokenDatabases.map((db) => db.name).join(', ') })}
				</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.engine {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
	}

	.badge {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		flex: none;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		color: var(--ink);
	}

	.badge :global(.logo) {
		width: 22px;
		height: 18px;
	}

	.body {
		min-width: 0;
		flex: 1;
		padding-top: 2px;
	}

	.headline {
		font-size: var(--text-md);
		font-weight: 550;
	}

	.shimmer {
		background: linear-gradient(
			90deg,
			var(--ink-muted) 0%,
			var(--ink-muted) 35%,
			var(--ink) 50%,
			var(--ink-muted) 65%,
			var(--ink-muted) 100%
		);
		background-size: 250% 100%;
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		animation: engine-shimmer 2.2s linear infinite;
	}

	.subtitle {
		margin: 2px 0 0;
		color: var(--ink-muted);
	}

	.bar {
		margin-top: var(--space-3);
	}

	.numbers {
		display: flex;
		justify-content: space-between;
		margin-top: 6px;
		color: var(--ink-faint);
	}

	.action {
		margin-top: var(--space-3);
	}

	.trace {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 26px;
		margin-top: var(--space-3);
		color: var(--ink);
	}

	.trace.ok {
		color: var(--ink-muted);
	}

	.icon {
		display: grid;
		place-items: center;
		width: 16px;
		flex: none;
		color: var(--warn);
		--icon-size: 14px;
	}

	@keyframes engine-shimmer {
		from {
			background-position: 100% 0;
		}
		to {
			background-position: -150% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.shimmer {
			animation: none;
			background: none;
			-webkit-text-fill-color: var(--ink);
			color: var(--ink);
		}
	}
</style>
