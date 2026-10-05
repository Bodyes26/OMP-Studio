<script lang="ts">
	// Sezione Doctor (autodiagnostica di sistema e runtime OMP, Design v2).
	// Usa StatusMark per tutti gli stati (completato/attenzione/fallito),
	// Segmented per i filtri e bottoni standard .ui-button.
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { doctorStore, type DoctorCategory, type DoctorItem } from '$lib/stores/doctor.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { IconWarning, IconRefresh, IconCopy, IconArrowRight } from '$lib/icons';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';

	const activePath = $derived(
		projectStore.activeProject?.lane.workspacePath ||
		projectStore.activeProject?.canonicalProjectPath ||
		undefined
	);

	onMount(() => {
		if (!doctorStore.report && !doctorStore.loading) {
			void doctorStore.runDoctor(activePath);
		}
	});

	function handleRefresh() {
		void doctorStore.runDoctor(activePath);
	}

	function handleCopy() {
		void doctorStore.copyReport();
	}

	const categoryTitles: Record<DoctorCategory, string> = {
		omp: m.settings_doctor_cat_omp(),
		shell_git: m.settings_doctor_cat_shell_git(),
		pty: m.settings_doctor_cat_pty(),
		sqlite: m.settings_doctor_cat_sqlite(),
		providers: m.settings_doctor_cat_providers()
	};

	const CATEGORY_ORDER: DoctorCategory[] = ['omp', 'shell_git', 'pty', 'sqlite', 'providers'];

	function groupByCategory(items: DoctorItem[]): { category: DoctorCategory; title: string; items: DoctorItem[] }[] {
		const groups: { category: DoctorCategory; title: string; items: DoctorItem[] }[] = [];
		for (const cat of CATEGORY_ORDER) {
			const catItems = items.filter((i) => i.category === cat);
			if (catItems.length > 0) {
				groups.push({
					category: cat,
					title: categoryTitles[cat] || cat,
					items: catItems
				});
			}
		}
		return groups;
	}

	const groupedItems = $derived(groupByCategory(doctorStore.filteredItems));
</script>

<div class="doctor-section">
	<!-- Intestazione del dottore con sommario e controlli rapidi -->
	<div class="doctor-header">
		<div class="doctor-title-block">
			<div class="title-with-badge">
				<h4>{m.settings_doctor_title()}</h4>
				{#if doctorStore.report}
					<div class="doctor-status-summary">
						{#if doctorStore.report.overallStatus === 'ok'}
							<StatusMark status="completed" label="Tutti i controlli superati" />
							<span class="status-summary-text">{m.settings_doctor_status_ok()}</span>
						{:else if doctorStore.report.overallStatus === 'warn'}
							<StatusMark status="attention" active={false} label="Avvisi riscontrati" />
							<span class="status-summary-text">
								{#if doctorStore.warningsCount > 0}
									<span class="status-count">{doctorStore.warningsCount}</span>
								{/if}
								{m.settings_doctor_status_warn()}
							</span>
						{:else}
							<StatusMark status="failed" label="Errori critici riscontrati" />
							<span class="status-summary-text">
								{#if doctorStore.errorsCount > 0}
									<span class="status-count">{doctorStore.errorsCount}</span>
								{/if}
								{m.settings_doctor_status_error()}
							</span>
						{/if}
						<span class="elapsed-badge">{doctorStore.report.elapsedMs} ms</span>
					</div>
				{/if}
			</div>
			<p class="doctor-desc">{m.settings_doctor_desc()}</p>
		</div>

		<div class="doctor-actions">
			<button
				type="button"
				class="ui-button ui-button-secondary btn-doctor"
				onclick={handleCopy}
				disabled={!doctorStore.report || doctorStore.loading}
				aria-label={m.settings_doctor_copy_report()}
			>
				<IconCopy />
				<span>{doctorStore.copiedToast ? m.settings_doctor_copied() : m.settings_doctor_copy_report()}</span>
			</button>

			<button
				type="button"
				class="ui-button ui-button-secondary btn-doctor"
				onclick={handleRefresh}
				disabled={doctorStore.loading}
				aria-label={m.settings_doctor_run()}
			>
				{#if doctorStore.loading}
					<StatusMark status="running" label="Esecuzione in corso" />
				{:else}
					<IconRefresh />
				{/if}
				<span>{m.settings_doctor_run()}</span>
			</button>
		</div>
	</div>

	<!-- Barra filtri -->
	{#if doctorStore.report}
		<div class="filter-bar">
			<Segmented
				options={[
					{
						value: 'all',
						label: m.settings_doctor_filter_all_label(),
						count: doctorStore.report.items.length
					},
					{
						value: 'issues',
						label: m.settings_doctor_filter_issues_label(),
						count: doctorStore.issuesCount,
						countTone: doctorStore.issuesCount > 0 ? 'attention' : 'neutral'
					}
				]}
				value={doctorStore.filter}
				onChange={(val) => (doctorStore.filter = val as 'all' | 'issues')}
				ariaLabel="Filtra controlli diagnostici"
			/>

			<div class="sys-summary">
				<span><strong>OS:</strong> {doctorStore.report.system.os} ({doctorStore.report.system.arch})</span>
				<span class="sys-sep">·</span>
				<span><strong>Studio:</strong> v{doctorStore.report.system.studioVersion}</span>
			</div>
		</div>
	{/if}

	<!-- Corpo principale: tabella o stato caricamento -->
	{#if doctorStore.loading && !doctorStore.report}
		<div class="loading-box">
			<StatusMark status="running" label="Caricamento diagnostica" />
			<span>Esecuzione checkup diagnostico dell'ambiente in corso...</span>
		</div>
	{:else if doctorStore.error}
		<div class="error-banner">
			<IconWarning />
			<div class="error-text">
				<strong>Errore durante l'autodiagnostica:</strong>
				<span>{doctorStore.error}</span>
			</div>
			<button type="button" class="ui-button ui-button-danger btn-retry" onclick={handleRefresh}>Riprova</button>
		</div>
	{:else if doctorStore.report}
		{#if doctorStore.filteredItems.length === 0}
			<div class="empty-state">
				<StatusMark status="completed" label="Nessuna anomalia" />
				<p>{m.settings_doctor_empty_issues()}</p>
			</div>
		{:else}
			<div class="doctor-table-wrapper">
				{#each groupedItems as group (group.category)}
					<div class="category-block">
						<div class="category-header">
							<h5>{group.title}</h5>
						</div>

						<table class="doctor-table">
							<thead>
								<tr>
									<th class="col-status">{m.settings_doctor_col_status()}</th>
									<th class="col-check">{m.settings_doctor_col_check()}</th>
									<th class="col-val">{m.settings_doctor_col_value()}</th>
									<th class="col-rec">{m.settings_doctor_col_rec()}</th>
								</tr>
							</thead>
							<tbody>
								{#each group.items as item (item.id)}
									<tr class="item-row" class:row-warn={item.status === 'warn'} class:row-error={item.status === 'error'}>
										<td class="cell-status">
											<span class="status-cell-wrap">
												{#if item.status === 'ok'}
													<StatusMark status="completed" label={m.settings_doctor_item_ok()} />
													<span class="status-cell-text">{m.settings_doctor_item_ok()}</span>
												{:else if item.status === 'warn'}
													<StatusMark status="attention" active={false} label={m.settings_doctor_item_warn()} />
													<span class="status-cell-text text-warn">{m.settings_doctor_item_warn()}</span>
												{:else}
													<StatusMark status="failed" label={m.settings_doctor_item_error()} />
													<span class="status-cell-text text-error">{m.settings_doctor_item_error()}</span>
												{/if}
											</span>
										</td>

										<td class="cell-check">
											<span class="check-name">{item.name}</span>
										</td>

										<td class="cell-val">
											<code class="val-code">{item.value}</code>
										</td>

										<td class="cell-rec">
											{#if item.recommendation}
												<div class="recommendation-box" class:rec-error={item.status === 'error'} class:rec-warn={item.status === 'warn'}>
													<span class="rec-bullet" aria-hidden="true"><IconArrowRight /></span>
													<span class="rec-text">{item.recommendation}</span>
												</div>
											{:else}
												<span class="rec-empty">—</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.doctor-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		color: var(--ink);
	}

	.doctor-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-4);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--line);
	}

	.doctor-title-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.title-with-badge {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.title-with-badge h4 {
		margin: 0;
		font-size: var(--text-title);
		font-weight: 600;
	}

	.doctor-desc {
		margin: 0;
		font-size: var(--text-label);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.doctor-status-summary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.status-summary-text {
		color: var(--ink);
	}

	.status-count {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		margin-right: 2px;
	}

	.elapsed-badge {
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
		margin-left: 4px;
	}

	.doctor-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.btn-doctor {
		gap: 6px;
		--icon-size: 14px;
	}

	.filter-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: 2px 0;
		flex-wrap: wrap;
	}

	.sys-summary {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.sys-sep {
		color: var(--ink-faint);
	}

	.loading-box {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: 48px 16px;
		color: var(--ink-muted);
		font-size: var(--text-body);
	}

	.error-banner {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		border: 1px solid var(--danger);
		background: color-mix(in oklab, var(--danger) 8%, var(--bg-raised));
		color: var(--danger);
		font-size: var(--text-label);
		--icon-size: 16px;
	}

	.error-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.btn-retry {
		padding: 4px 10px;
		font-size: var(--text-caption);
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: 48px 16px;
		color: var(--ink-muted);
		font-size: var(--text-body);
	}

	.empty-state p {
		margin: 0;
	}

	.doctor-table-wrapper {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.category-block {
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--bg-raised);
	}

	.category-header {
		padding: 8px 12px;
		background: var(--bg-hover);
		border-bottom: 1px solid var(--line);
	}

	.category-header h5 {
		margin: 0;
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		text-transform: none;
		letter-spacing: normal;
	}

	.doctor-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-label);
		text-align: left;
	}

	.doctor-table th {
		padding: 7px 12px;
		font-size: var(--text-caption);
		font-weight: 600;
		text-transform: none;
		letter-spacing: normal;
		color: var(--ink-muted);
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
	}

	.col-status {
		width: 120px;
		text-align: left;
	}

	.col-check {
		width: 220px;
	}

	.col-val {
		width: 320px;
	}

	.col-rec {
		min-width: 200px;
	}

	.item-row {
		border-bottom: 1px solid var(--line);
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.item-row:last-child {
		border-bottom: none;
	}

	.item-row:hover {
		background: var(--bg-hover);
	}

	.item-row.row-warn {
		background: color-mix(in oklab, var(--warn) 4%, transparent);
	}

	.item-row.row-error {
		background: color-mix(in oklab, var(--danger) 5%, transparent);
	}

	.doctor-table td {
		padding: 8px 12px;
		vertical-align: middle;
	}

	.cell-status {
		text-align: left;
		padding: 8px 12px;
	}

	.status-cell-wrap {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.status-cell-text {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink);
	}

	.status-cell-text.text-warn {
		color: var(--warn);
	}

	.status-cell-text.text-error {
		color: var(--danger);
		font-weight: 600;
	}

	.check-name {
		font-weight: 500;
		color: var(--ink);
	}

	.val-code {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		padding: 2px 6px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		word-break: break-all;
	}

	.recommendation-box {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		font-size: var(--text-caption);
		line-height: 1.4;
	}

	.recommendation-box.rec-warn {
		color: var(--warn);
	}

	.recommendation-box.rec-error {
		color: var(--danger);
		font-weight: 500;
	}

	.rec-bullet {
		--icon-size: 12px;
		color: var(--ink-faint);
		display: inline-flex;
		align-items: center;
		margin-top: 2px;
		flex-shrink: 0;
	}

	.rec-text {
		flex: 1;
	}

	.rec-empty {
		color: var(--ink-faint);
		font-size: var(--text-caption);
	}
</style>
