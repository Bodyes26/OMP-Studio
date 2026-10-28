<script lang="ts">
	/**
	 * Sezione Impostazioni: Statistiche.
	 *
	 * I numeri chiave dell'uso di omp (costo stimato, richieste, token, cache,
	 * errori, modelli, progetti, subagenti) letti da `~/.omp/stats.db`. Per
	 * tutto il resto (richieste, errori, tracce, tool) c'e' la dashboard web
	 * di omp, che si apre dal pulsante in testata.
	 */
	import { untrack } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import { IconExternalLink } from '#lib/icons.ts';
	import { projectStore } from '#lib/stores/projects.svelte.ts';
	import Segmented from '#lib/ui/Segmented.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import AlertBanner from '#lib/components/AlertBanner.svelte';
	import StatsSparkline from './stats/StatsSparkline.svelte';
	import StatsActivityChart from './stats/StatsActivityChart.svelte';
	import {
		RANGE_HOURS,
		bucketize,
		createFormatters,
		folderLabel,
		share,
		type StatsMetric,
		type StatsRange,
		type StatsSummary
	} from '#lib/stats/usageStats.ts';

	let range = $state<StatsRange>('7d');
	let metric = $state<StatsMetric>('requests');
	let summary = $state<StatsSummary | null>(null);
	let error = $state<{ kind: 'missing' | 'schema' | 'other'; detail: string } | null>(null);
	let syncing = $state(false);
	let syncFailed = $state(false);
	let updatedAt = $state<number | null>(null);
	let opening = $state(false);

	const f = createFormatters(getLocale());

	const projects = $derived(projectStore.projects.filter((p) => p.canonicalProjectPath));
	const projectPaths = $derived(projects.map((p) => p.canonicalProjectPath as string));
	const activePath = $derived(projectStore.activeProject?.canonicalProjectPath ?? null);
	const projectName = (path: string | null) =>
		(path && projects.find((p) => p.canonicalProjectPath === path)?.name) || null;

	async function load(r: StatsRange) {
		try {
			const next = await invoke<StatsSummary>('stats_summary', {
				rangeHours: RANGE_HOURS[r],
				projectPaths: $state.snapshot(projectPaths)
			});
			// Una risposta lenta di un intervallo precedente non sovrascrive quella corrente.
			if (r !== range) return;
			summary = next;
			error = null;
		} catch (e) {
			const text = String(e);
			const kind = text.startsWith('missing:') ? 'missing' : text.startsWith('schema:') ? 'schema' : 'other';
			error = { kind, detail: text.replace(/^(missing|schema):/, '') };
		}
	}

	// Prima i dati gia' nel database (subito), poi omp ingerisce i transcript
	// nuovi e si rilegge: la sezione non resta mai vuota ad aspettare omp.
	async function refresh() {
		await load(range);
		syncing = true;
		try {
			await invoke<boolean>('stats_sync');
			syncFailed = false;
			await load(range);
		} catch {
			syncFailed = true;
		} finally {
			syncing = false;
			updatedAt = Date.now();
		}
	}
	// Un solo giro all'apertura della sezione: `refresh` legge stato reattivo
	// (intervallo, progetti) che non deve rilanciare la sincronizzazione.
	$effect(() => {
		untrack(() => void refresh());
	});

	function selectRange(r: StatsRange) {
		range = r;
		void load(r);
	}

	async function openDashboard() {
		opening = true;
		try {
			await invoke('stats_open_dashboard');
		} catch (e) {
			error = { kind: 'other', detail: String(e) };
		} finally {
			opening = false;
		}
	}

	const totals = $derived(summary?.totals ?? null);
	const buckets = $derived(summary ? bucketize(summary.hours, range) : []);
	const spark = (pick: (b: (typeof buckets)[number]) => number) => buckets.map(pick);

	const MAX_MODELS = 6;
	const MAX_FOLDERS = 8;
	const models = $derived(summary?.models.slice(0, MAX_MODELS) ?? []);
	const otherModels = $derived(summary ? Math.max(summary.models.length - MAX_MODELS, 0) : 0);
	const otherModelRequests = $derived(
		summary?.models.slice(MAX_MODELS).reduce((sum, x) => sum + x.requests, 0) ?? 0
	);

	const folders = $derived.by(() => {
		if (!summary) return [];
		const sorted = [...summary.folders].sort((a, b) => b.cost - a.cost || b.requests - a.requests);
		return sorted.slice(0, MAX_FOLDERS);
	});
	const otherFolders = $derived(summary ? Math.max(summary.folders.length - MAX_FOLDERS, 0) : 0);
	const maxFolderCost = $derived(Math.max(...folders.map((x) => x.cost), 0));

	const agentOrder = ['main', 'subagent', 'advisor'];
	const agents = $derived(
		[...(summary?.agents ?? [])].sort((a, b) => {
			const ia = agentOrder.indexOf(a.agentType);
			const ib = agentOrder.indexOf(b.agentType);
			return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
		})
	);
	const agentLabel = (type: string) =>
		type === 'main'
			? m.settings_stats_agent_main()
			: type === 'subagent'
				? m.settings_stats_agent_subagent()
				: type === 'advisor'
					? m.settings_stats_agent_advisor()
					: type;

	const RANGE_OPTIONS = $derived([
		{ value: '24h' as const, label: m.settings_stats_range_24h() },
		{ value: '7d' as const, label: m.settings_stats_range_7d() },
		{ value: '30d' as const, label: m.settings_stats_range_30d() }
	]);
	const METRIC_OPTIONS = $derived([
		{ value: 'requests' as const, label: m.settings_stats_metric_requests() },
		{ value: 'tokens' as const, label: m.settings_stats_metric_tokens() },
		{ value: 'cost' as const, label: m.settings_stats_metric_cost() }
	]);
</script>

<div class="settings-section">
	<div class="section-header">
		<h4>{m.settings_stats_title()}</h4>
		<div class="header-actions">
			<Segmented
				options={RANGE_OPTIONS}
				value={range}
				ariaLabel={m.settings_stats_range_aria()}
				onChange={selectRange}
			/>
			<button type="button" class="ui-button ui-button-secondary" disabled={opening} onclick={openDashboard}>
				<IconExternalLink size={14} aria-hidden="true" />
				{m.settings_stats_open_dashboard()}
			</button>
		</div>
	</div>

	<p class="section-note">
		<span>{m.settings_stats_note()}</span>
		<span class="sync-state" aria-live="polite">
			{#if syncing}
				<StatusMark status="running" />
				{m.settings_stats_syncing()}
			{:else if syncFailed}
				{m.settings_stats_sync_failed()}
			{:else if updatedAt}
				{m.settings_stats_updated({ time: f.hour(updatedAt) })}
			{/if}
		</span>
	</p>

	{#if error?.kind === 'missing'}
		<AlertBanner
			variant="info"
			title={m.settings_stats_missing_title()}
			message={m.settings_stats_missing_desc()}
			diagnostic={error.detail}
		/>
	{:else if error}
		<AlertBanner
			variant="warning"
			title={error.kind === 'schema' ? m.settings_stats_schema_title() : m.settings_stats_error_title()}
			message={error.kind === 'schema' ? m.settings_stats_schema_desc() : ''}
			diagnostic={error.detail}
			onRetry={refresh}
		/>
	{:else if !summary || !totals}
		<div class="loading">
			<StatusMark status="running" />
			<span>{m.settings_stats_loading()}</span>
		</div>
	{:else if totals.requests === 0}
		<div class="empty">{m.settings_stats_empty_range()}</div>
	{:else}
		<!-- KPI -->
		<div class="kpis">
			<div class="kpi">
				<span class="kpi-label">{m.settings_stats_kpi_cost()}</span>
				<span class="kpi-value tabular">{f.cost(totals.cost)}</span>
				<span class="kpi-sub tabular">
					{totals.unpriced > 0
						? m.settings_stats_kpi_unpriced({ count: f.count(totals.unpriced) })
						: m.settings_stats_kpi_per_request({ cost: f.cost(share(totals.cost, totals.requests)) })}
				</span>
				<StatsSparkline values={spark((b) => b.cost)} />
			</div>
			<div class="kpi">
				<span class="kpi-label">{m.settings_stats_kpi_requests()}</span>
				<span class="kpi-value tabular">{f.count(totals.requests)}</span>
				<span class="kpi-sub tabular">
					{m.settings_stats_kpi_speed({ ttft: f.seconds(totals.avgTtftMs), tps: f.rate(totals.avgTokensPerSecond) })}
				</span>
				<StatsSparkline values={spark((b) => b.requests)} />
			</div>
			<div class="kpi">
				<span class="kpi-label">{m.settings_stats_kpi_tokens()}</span>
				<span class="kpi-value tabular">{f.tokens(totals.totalTokens)}</span>
				<span class="kpi-sub tabular">{m.settings_stats_kpi_output({ tokens: f.tokens(totals.outputTokens) })}</span>
				<StatsSparkline values={spark((b) => b.tokens)} />
			</div>
			<div class="kpi">
				<span class="kpi-label">{m.settings_stats_kpi_cache()}</span>
				<span class="kpi-value tabular">{f.percent(totals.cacheRate)}</span>
				<span class="kpi-sub tabular">{m.settings_stats_kpi_cache_saved({ pct: f.percent(totals.cacheSavings) })}</span>
				<div class="meter" aria-hidden="true"><span style:width={`${totals.cacheRate * 100}%`}></span></div>
			</div>
			<div class="kpi">
				<span class="kpi-label">{m.settings_stats_kpi_errors()}</span>
				<span class="kpi-value tabular">{f.percent(share(totals.failed, totals.requests))}</span>
				<span class="kpi-sub tabular" class:bad={totals.failed > 0}>
					{m.settings_stats_kpi_failed({ count: f.count(totals.failed) })}
				</span>
				<StatsSparkline values={spark((b) => b.failed)} />
			</div>
		</div>

		<!-- Attivita' nel tempo -->
		<section class="block" aria-labelledby="stats-activity-title">
			<div class="block-head">
				<div class="block-copy">
					<span id="stats-activity-title" class="block-title">{m.settings_stats_activity_title()}</span>
					<span class="block-desc">
						{range === '24h' ? m.settings_stats_activity_per_hour() : m.settings_stats_activity_per_day()}
					</span>
				</div>
				<Segmented
					options={METRIC_OPTIONS}
					value={metric}
					ariaLabel={m.settings_stats_metric_aria()}
					onChange={(v) => (metric = v)}
				/>
			</div>
			<StatsActivityChart {buckets} {metric} {range} {f} />
		</section>

		<!-- Modelli -->
		<section class="block" aria-labelledby="stats-models-title">
			<div class="block-head">
				<div class="block-copy">
					<span id="stats-models-title" class="block-title">{m.settings_stats_models_title()}</span>
					<span class="block-desc">{m.settings_stats_models_desc()}</span>
				</div>
			</div>
			<div class="share-bar" aria-hidden="true">
				{#each models as x, i (x.provider + x.model)}
					<span class={`seg s${i}`} style:flex-grow={x.requests}></span>
				{/each}
				{#if otherModelRequests > 0}
					<span class="seg s-other" style:flex-grow={otherModelRequests}></span>
				{/if}
			</div>
			<table class="table">
				<thead>
					<tr>
						<th scope="col">{m.settings_stats_col_model()}</th>
						<th scope="col" class="num">{m.settings_stats_col_requests()}</th>
						<th scope="col" class="num">{m.settings_stats_col_cost()}</th>
						<th scope="col" class="num">{m.settings_stats_col_cache()}</th>
						<th scope="col" class="num">{m.settings_stats_col_tps()}</th>
						<th scope="col" class="num">{m.settings_stats_col_ttft()}</th>
					</tr>
				</thead>
				<tbody>
					{#each models as x, i (x.provider + x.model)}
						<tr>
							<td>
								<span class="name-cell">
									<span class={`swatch s${i}`} aria-hidden="true"></span>
									<span class="name-stack">
										<span class="mono name">{x.model}</span>
										<span class="sub">{x.provider}</span>
									</span>
								</span>
							</td>
							<td class="num tabular">
								{f.count(x.requests)}
								<span class="sub">{f.percent(share(x.requests, totals.requests))}</span>
							</td>
							<td class="num tabular">{x.unpriced > 0 && x.cost === 0 ? '—' : f.cost(x.cost)}</td>
							<td class="num tabular">{f.percent(x.cacheRate)}</td>
							<td class="num tabular">{f.rate(x.avgTokensPerSecond)}</td>
							<td class="num tabular">{f.seconds(x.avgTtftMs)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if otherModels > 0}
				<span class="more">{m.settings_stats_more_models({ count: otherModels })}</span>
			{/if}
		</section>

		<div class="pair">
			<!-- Progetti -->
			<section class="block" aria-labelledby="stats-projects-title">
				<div class="block-head">
					<div class="block-copy">
						<span id="stats-projects-title" class="block-title">{m.settings_stats_projects_title()}</span>
						<span class="block-desc">{m.settings_stats_projects_desc()}</span>
					</div>
				</div>
				<ol class="rank">
					{#each folders as x (x.folder)}
						{@const name = projectName(x.projectPath)}
						{@const active = !!activePath && x.projectPath === activePath}
						<li class="rank-row" class:active>
							<span class="rank-name" title={x.projectPath ?? x.folder}>
								<span class:mono={!name}>{name ?? folderLabel(x.folder)}</span>
								{#if active}<span class="ui-count">{m.settings_stats_project_active()}</span>{/if}
							</span>
							<span class="rank-value tabular">
								{f.cost(x.cost)}
								<span class="sub">· {f.count(x.requests)} {m.settings_stats_requests_short()}</span>
							</span>
							<span class="rank-bar" aria-hidden="true">
								<span style:width={`${share(x.cost, maxFolderCost) * 100}%`}></span>
							</span>
						</li>
					{/each}
				</ol>
				{#if otherFolders > 0}
					<span class="more">{m.settings_stats_more_projects({ count: otherFolders })}</span>
				{/if}
			</section>

			<!-- Agente principale e subagenti -->
			<section class="block" aria-labelledby="stats-agents-title">
				<div class="block-head">
					<div class="block-copy">
						<span id="stats-agents-title" class="block-title">{m.settings_stats_agents_title()}</span>
						<span class="block-desc">{m.settings_stats_agents_desc()}</span>
					</div>
				</div>
				<div class="share-bar tall" aria-hidden="true">
					{#each agents as x (x.agentType)}
						<span class={`seg a-${x.agentType}`} style:flex-grow={x.requests}></span>
					{/each}
				</div>
				<ul class="legend">
					{#each agents as x (x.agentType)}
						<li>
							<span class={`swatch a-${x.agentType}`} aria-hidden="true"></span>
							<span class="legend-name">{agentLabel(x.agentType)}</span>
							<span class="legend-pct tabular">{f.percent(share(x.requests, totals.requests))}</span>
							<span class="sub tabular legend-detail">
								{m.settings_stats_agent_detail({
									requests: f.count(x.requests),
									tokens: f.tokens(x.totalTokens),
									cost: f.cost(x.cost)
								})}
							</span>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	{/if}
</div>

<style>
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--line);
	}

	.section-header h4 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.header-actions .ui-button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.section-note {
		margin: calc(var(--space-2) * -1) 0 0;
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.sync-state {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.loading,
	.empty {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-4);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		color: var(--ink-muted);
		font-size: var(--text-label);
	}

	.tabular {
		font-variant-numeric: tabular-nums;
	}

	.mono {
		font-family: var(--font-mono);
	}

	.sub {
		color: var(--ink-faint);
		font-size: var(--text-caption);
	}

	/* KPI: una striscia unica divisa da linee, non cinque card. */
	.kpis {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		overflow: hidden;
	}

	.kpi {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-3);
		min-width: 0;
		box-shadow: -1px 0 0 var(--line);
	}

	.kpi-label {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.kpi-value {
		font-size: 20px;
		font-weight: 600;
		line-height: 1.25;
		color: var(--ink);
		white-space: nowrap;
	}

	.kpi-sub {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		margin-bottom: 6px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.kpi-sub.bad {
		color: var(--danger);
	}

	.meter {
		margin-top: auto;
		height: 4px;
		border-radius: var(--radius-full);
		background: var(--line);
		overflow: hidden;
		margin-bottom: 10px;
	}

	.meter span {
		display: block;
		height: 100%;
		background: var(--brand);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		min-width: 0;
	}

	.block-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.block-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.block-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.block-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	/* Serie: rampa dell'accento del tema, niente palette parallela. */
	.s0 { background: var(--brand); }
	.s1 { background: color-mix(in oklch, var(--brand) 70%, var(--bg-raised)); }
	.s2 { background: color-mix(in oklch, var(--brand) 45%, var(--bg-raised)); }
	.s3 { background: var(--ink-muted); }
	.s4 { background: color-mix(in oklch, var(--ink-muted) 55%, var(--bg-raised)); }
	.s5 { background: color-mix(in oklch, var(--ink-muted) 30%, var(--bg-raised)); }
	.s-other { background: var(--line-strong); }
	.a-main { background: var(--ink-muted); }
	.a-subagent { background: var(--brand); }
	.a-advisor { background: color-mix(in oklch, var(--brand) 45%, var(--bg-raised)); }

	.share-bar {
		display: flex;
		gap: 2px;
		height: 6px;
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.share-bar.tall {
		height: 10px;
	}

	.seg {
		flex-basis: 0;
		min-width: 2px;
	}

	.swatch {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		flex-shrink: 0;
	}

	.table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-label);
	}

	.table th {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-muted);
		text-align: left;
		padding: 0 8px 6px;
		border-bottom: 1px solid var(--line);
	}

	.table td {
		padding: 6px 8px;
		border-bottom: 1px solid var(--line);
		color: var(--ink);
		vertical-align: middle;
	}

	.table tr:last-child td {
		border-bottom: none;
	}

	.table th:first-child,
	.table td:first-child {
		padding-left: 0;
	}

	.table th:last-child,
	.table td:last-child {
		padding-right: 0;
	}

	.num {
		text-align: right !important;
		white-space: nowrap;
	}

	.num .sub {
		margin-left: 4px;
	}

	.name-cell {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.name-stack {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.name {
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.more {
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: var(--space-4);
	}

	.rank {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.rank-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-rows: auto 4px;
		column-gap: var(--space-3);
		row-gap: 4px;
		font-size: var(--text-label);
	}

	.rank-name {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		color: var(--ink);
	}

	.rank-name > span:first-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rank-name .mono {
		font-size: 12px;
		color: var(--ink-muted);
	}

	.rank-row.active .rank-name {
		font-weight: 600;
	}

	.rank-value {
		white-space: nowrap;
		color: var(--ink);
	}

	.rank-bar {
		grid-column: 1 / -1;
		height: 4px;
		border-radius: var(--radius-full);
		background: var(--line);
		overflow: hidden;
	}

	.rank-bar span {
		display: block;
		height: 100%;
		background: color-mix(in oklch, var(--brand) 55%, var(--bg-raised));
	}

	.rank-row.active .rank-bar span {
		background: var(--brand);
	}

	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.legend li {
		display: grid;
		grid-template-columns: 8px minmax(0, 1fr) auto;
		align-items: center;
		column-gap: 8px;
		font-size: var(--text-label);
	}

	.legend-name {
		color: var(--ink);
	}

	.legend-pct {
		color: var(--ink);
		font-weight: 600;
	}

	.legend-detail {
		grid-column: 2 / -1;
	}
</style>
