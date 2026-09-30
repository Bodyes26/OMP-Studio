<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { doctorStore, type DoctorCategory, type DoctorItem } from '$lib/stores/doctor.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { IconCheck, IconWarning, IconClose, IconRefresh, IconCopy } from '$lib/icons';
	import { fade } from 'svelte/transition';

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
					<span
						class="status-pill"
						class:pill-ok={doctorStore.report.overallStatus === 'ok'}
						class:pill-warn={doctorStore.report.overallStatus === 'warn'}
						class:pill-err={doctorStore.report.overallStatus === 'error'}
					>
						{#if doctorStore.report.overallStatus === 'ok'}
							<span class="status-dot dot-ok"></span> {m.settings_doctor_status_ok()}
						{:else if doctorStore.report.overallStatus === 'warn'}
							<span class="status-dot dot-warn"></span> {m.settings_doctor_status_warn()}
						{:else}
							<span class="status-dot dot-err"></span> {m.settings_doctor_status_error()}
						{/if}
						<span class="elapsed-badge">{doctorStore.report.elapsedMs} ms</span>
					</span>
				{/if}
			</div>
			<p class="doctor-desc">{m.settings_doctor_desc()}</p>
		</div>

		<div class="doctor-actions">
			<button
				type="button"
				class="btn-doctor btn-copy"
				onclick={handleCopy}
				disabled={!doctorStore.report || doctorStore.loading}
				title={m.settings_doctor_copy_report()}
			>
				<IconCopy />
				<span>{doctorStore.copiedToast ? m.settings_doctor_copied() : m.settings_doctor_copy_report()}</span>
			</button>

			<button
				type="button"
				class="btn-doctor btn-refresh"
				onclick={handleRefresh}
				disabled={doctorStore.loading}
				title={m.settings_doctor_run()}
			>
				<span class="refresh-icon" class:spinning={doctorStore.loading}>
					<IconRefresh />
				</span>
				<span>{m.settings_doctor_run()}</span>
			</button>
		</div>
	</div>

	<!-- Barra filtri -->
	{#if doctorStore.report}
		<div class="filter-bar">
			<div class="filter-pills" role="tablist">
				<button
					type="button"
					role="tab"
					aria-selected={doctorStore.filter === 'all'}
					class="filter-pill"
					class:active={doctorStore.filter === 'all'}
					onclick={() => (doctorStore.filter = 'all')}
				>
					{m.settings_doctor_filter_all({ count: doctorStore.report.items.length })}
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={doctorStore.filter === 'issues'}
					class="filter-pill"
					class:active={doctorStore.filter === 'issues'}
					class:has-issues={doctorStore.issuesCount > 0}
					onclick={() => (doctorStore.filter = 'issues')}
				>
					{m.settings_doctor_filter_issues({ count: doctorStore.issuesCount })}
				</button>
			</div>

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
			<span class="btn-spinner" aria-hidden="true"></span>
			<span>Esecuzione checkup diagnostico dell'ambiente in corso...</span>
		</div>
	{:else if doctorStore.error}
		<div class="error-banner">
			<IconWarning />
			<div class="error-text">
				<strong>Errore durante l'autodiagnostica:</strong>
				<span>{doctorStore.error}</span>
			</div>
			<button type="button" class="btn-retry" onclick={handleRefresh}>Riprova</button>
		</div>
	{:else if doctorStore.report}
		{#if doctorStore.filteredItems.length === 0}
			<div class="empty-state">
				<div class="empty-icon ok"><IconCheck /></div>
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
											{#if item.status === 'ok'}
												<span class="status-icon icon-ok" title="Superato">
													<IconCheck />
												</span>
											{:else if item.status === 'warn'}
												<span class="status-icon icon-warn" title="Avviso">
													<IconWarning />
												</span>
											{:else}
												<span class="status-icon icon-err" title="Errore">
													<IconClose />
												</span>
											{/if}
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
													<span class="rec-bullet">→</span>
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
		gap: 16px;
		color: var(--ink);
	}

	.doctor-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 16px;
		padding-bottom: 14px;
		border-bottom: 1px solid var(--line);
	}

	.doctor-title-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.title-with-badge {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	.title-with-badge h4 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.doctor-desc {
		margin: 0;
		font-size: 12px;
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 500;
		padding: 3px 8px;
		border-radius: var(--radius-sm, 4px);
		border: 1px solid var(--line);
		background: var(--bg-card);
	}

	.status-pill.pill-ok {
		border-color: rgba(34, 197, 94, 0.3);
		color: var(--ink);
	}

	.status-pill.pill-warn {
		border-color: var(--warn);
		color: var(--warn);
		background: var(--warn-dim, rgba(234, 179, 8, 0.08));
	}

	.status-pill.pill-err {
		border-color: var(--err);
		color: var(--err);
		background: var(--err-dim, rgba(239, 68, 68, 0.08));
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.status-dot.dot-ok {
		background: #22c55e;
	}

	.status-dot.dot-warn {
		background: var(--warn);
	}

	.status-dot.dot-err {
		background: var(--err);
	}

	.elapsed-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		margin-left: 4px;
	}

	.doctor-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.btn-doctor {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 11px;
		font-size: 12px;
		font-weight: 500;
		border-radius: var(--radius-sm, 4px);
		border: 1px solid var(--line);
		background: var(--bg-card);
		color: var(--ink);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-doctor:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--ink-muted);
	}

	.btn-doctor:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-copy {
		border-color: var(--line);
	}

	.btn-refresh {
		background: var(--bg-hover);
	}

	.refresh-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.refresh-icon.spinning {
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.filter-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 4px 0;
	}

	.filter-pills {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.filter-pill {
		padding: 4px 10px;
		font-size: 11px;
		font-weight: 500;
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink-muted);
		border-radius: var(--radius-sm, 4px);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.filter-pill:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.filter-pill.active {
		color: var(--ink);
		background: var(--bg-card);
		border-color: var(--line);
	}

	.filter-pill.has-issues {
		color: var(--warn);
	}

	.filter-pill.has-issues.active {
		border-color: var(--warn);
		background: var(--warn-dim, rgba(234, 179, 8, 0.08));
	}

	.sys-summary {
		font-size: 11px;
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
		gap: 10px;
		padding: 48px 16px;
		color: var(--ink-muted);
		font-size: 13px;
	}

	.btn-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--line);
		border-top-color: var(--brand);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	.error-banner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border-radius: var(--radius-sm, 4px);
		border: 1px solid var(--err);
		background: var(--err-dim, rgba(239, 68, 68, 0.08));
		color: var(--err);
		font-size: 12px;
	}

	.error-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.btn-retry {
		padding: 4px 10px;
		font-size: 11px;
		background: var(--bg-card);
		border: 1px solid var(--err);
		color: var(--err);
		border-radius: var(--radius-sm, 4px);
		cursor: pointer;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 48px 16px;
		color: var(--ink-muted);
		font-size: 13px;
	}

	.empty-icon.ok {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: rgba(34, 197, 94, 0.12);
		color: #22c55e;
	}

	.doctor-table-wrapper {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.category-block {
		border: 1px solid var(--line);
		border-radius: var(--radius-sm, 6px);
		overflow: hidden;
		background: var(--bg-card);
	}

	.category-header {
		padding: 8px 12px;
		background: var(--bg-hover);
		border-bottom: 1px solid var(--line);
	}

	.category-header h5 {
		margin: 0;
		font-size: 12px;
		font-weight: 600;
		color: var(--ink);
		letter-spacing: -0.01em;
	}

	.doctor-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
		text-align: left;
	}

	.doctor-table th {
		padding: 7px 12px;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-faint);
		border-bottom: 1px solid var(--line);
		background: var(--bg-card);
	}

	.col-status {
		width: 44px;
		text-align: center;
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
		transition: background 0.1s ease;
	}

	.item-row:last-child {
		border-bottom: none;
	}

	.item-row:hover {
		background: var(--bg-hover);
	}

	.item-row.row-warn {
		background: rgba(234, 179, 8, 0.03);
	}

	.item-row.row-error {
		background: rgba(239, 68, 68, 0.04);
	}

	.doctor-table td {
		padding: 8px 12px;
		vertical-align: middle;
	}

	.cell-status {
		text-align: center;
		padding: 8px 4px;
	}

	.status-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-sm, 4px);
	}

	.status-icon.icon-ok {
		color: var(--ink-muted);
	}

	.status-icon.icon-warn {
		color: var(--warn);
		background: var(--warn-dim, rgba(234, 179, 8, 0.12));
	}

	.status-icon.icon-err {
		color: var(--err);
		background: var(--err-dim, rgba(239, 68, 68, 0.12));
	}

	.check-name {
		font-weight: 500;
		color: var(--ink);
	}

	.val-code {
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 2px 5px;
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 3px;
		color: var(--ink);
		word-break: break-all;
	}

	.recommendation-box {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		font-size: 11px;
		line-height: 1.35;
	}

	.recommendation-box.rec-warn {
		color: var(--warn);
	}

	.recommendation-box.rec-error {
		color: var(--err);
		font-weight: 500;
	}

	.rec-bullet {
		font-weight: 700;
		opacity: 0.8;
	}

	.rec-text {
		flex: 1;
	}

	.rec-empty {
		color: var(--ink-faint);
		font-size: 11px;
	}
</style>
