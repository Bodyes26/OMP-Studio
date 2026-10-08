<script lang="ts">
	// Sezione Doctor (autodiagnostica di sistema e runtime OMP, Design v2).
	// Allineata alle convenzioni grafiche e di layout del centro impostazioni:
	// usa `.settings-section` per il padding esterno, `.section-header` per l'intestazione,
	// `.section-block` e `.section-group` per i raggruppamenti, e `.form-row` per ogni verifica.
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { doctorStore, type DoctorCategory, type DoctorItem } from '$lib/stores/doctor.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { IconWarning, IconRefresh, IconCopy, IconArrowRight } from '$lib/icons';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import {
		getDoctorCheckName,
		getDoctorCheckValue,
		getDoctorCheckRecommendation
	} from './doctorI18n';

	const activePath = $derived(
		projectStore.activeProject?.lane.workspacePath ||
		projectStore.activeProject?.canonicalProjectPath ||
		undefined
	);

	// Esegue la diagnostica al primo ingresso se il referto non e' ancora presente
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

<div class="settings-section">
	<!-- Intestazione standard di sezione con sommario diagnostico e azioni rapide -->
	<div class="section-header">
		<div class="section-title-wrap">
			<div class="title-with-badge">
				<h4>{m.settings_doctor_title()}</h4>
				{#if doctorStore.report}
					<div class="doctor-status-summary">
						{#if doctorStore.report.overallStatus === 'ok'}
							<StatusMark status="completed" label={m.settings_doctor_mark_all_passed()} />
							<span class="status-summary-text">{m.settings_doctor_status_ok()}</span>
						{:else if doctorStore.report.overallStatus === 'warn'}
							<StatusMark status="attention" active={false} label={m.settings_doctor_mark_warnings()} />
							<span class="status-summary-text">
								{#if doctorStore.warningsCount > 0}
									<span class="status-count">{doctorStore.warningsCount}</span>
								{/if}
								{m.settings_doctor_status_warn()}
							</span>
						{:else}
							<StatusMark status="failed" label={m.settings_doctor_mark_errors()} />
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
			<p class="section-lead">{m.settings_doctor_desc()}</p>
		</div>

		<div class="header-actions">
			<button
				type="button"
				class="ui-button ui-button-secondary"
				onclick={handleCopy}
				disabled={!doctorStore.report || doctorStore.loading}
				aria-label={m.settings_doctor_copy_report()}
			>
				<IconCopy />
				<span>{doctorStore.copiedToast ? m.settings_doctor_copied() : m.settings_doctor_copy_report()}</span>
			</button>

			<button
				type="button"
				class="ui-button ui-button-secondary"
				onclick={handleRefresh}
				disabled={doctorStore.loading}
				aria-label={m.settings_doctor_run()}
			>
				{#if doctorStore.loading}
					<StatusMark status="running" label={m.settings_doctor_mark_running()} />
				{:else}
					<IconRefresh />
				{/if}
				<span>{m.settings_doctor_run()}</span>
			</button>
		</div>
	</div>

	<!-- Barra filtri e informazioni ambientali del sistema -->
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
				ariaLabel={m.settings_doctor_filter_aria()}
			/>

			<div class="sys-summary">
				<span><strong>OS:</strong> {doctorStore.report.system.os} ({doctorStore.report.system.arch})</span>
				<span class="sys-sep">·</span>
				<span><strong>Studio:</strong> v{doctorStore.report.system.studioVersion}</span>
			</div>
		</div>
	{/if}

	<!-- Corpo principale: stato caricamento, errore, lista vuota o gruppi di verifiche -->
	{#if doctorStore.loading && !doctorStore.report}
		<div class="loading-state">
			<StatusMark status="running" label={m.settings_doctor_loading_label()} />
			<span>{m.settings_doctor_loading_text()}</span>
		</div>
	{:else if doctorStore.error}
		<div class="error-banner">
			<IconWarning />
			<div class="error-text">
				<strong>{m.settings_doctor_run_error()}</strong>
				<span>{doctorStore.error}</span>
			</div>
			<button type="button" class="ui-button ui-button-danger btn-retry" onclick={handleRefresh}>{m.git_btn_retry()}</button>
		</div>
	{:else if doctorStore.report}
		{#if doctorStore.filteredItems.length === 0}
			<div class="empty-state">
				<StatusMark status="completed" label={m.settings_doctor_mark_no_issues()} />
				<p>{m.settings_doctor_empty_issues()}</p>
			</div>
		{:else}
			{#each groupedItems as group (group.category)}
				<div class="section-block">
					<div class="block-header-row">
						<span class="block-title">{group.title}</span>
						<span class="block-count">{group.items.length}</span>
					</div>

					<!-- Scheda con le righe di verifica nel formato standard del settings center -->
					<div class="section-group">
						{#each group.items as item (item.id)}
							<div class="form-row doctor-row" class:row-warn={item.status === 'warn'} class:row-error={item.status === 'error'}>
								<div class="form-row-copy">
									<div class="doctor-check-line">
										{#if item.status === 'ok'}
											<StatusMark status="completed" label={m.settings_doctor_item_ok()} />
										{:else if item.status === 'warn'}
											<StatusMark status="attention" active={false} label={m.settings_doctor_item_warn()} />
										{:else}
											<StatusMark status="failed" label={m.settings_doctor_item_error()} />
										{/if}
										<span class="form-row-label">{getDoctorCheckName(item)}</span>
									</div>
									{#if item.recommendation}
										<div class="doctor-rec-box" class:rec-error={item.status === 'error'} class:rec-warn={item.status === 'warn'}>
											<span class="rec-bullet" aria-hidden="true"><IconArrowRight /></span>
											<span class="rec-text">{getDoctorCheckRecommendation(item)}</span>
										</div>
									{/if}
								</div>

								<div class="form-row-control">
									<code class="val-code" title={getDoctorCheckValue(item)}>{getDoctorCheckValue(item)}</code>
									<span
										class="status-pill"
										class:status-ok={item.status === 'ok'}
										class:status-warn={item.status === 'warn'}
										class:status-error={item.status === 'error'}
									>
										{item.status === 'ok' ? m.settings_doctor_item_ok() : item.status === 'warn' ? m.settings_doctor_item_warn() : m.settings_doctor_item_error()}
									</span>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		{/if}
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
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--line);
	}

	.section-title-wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.title-with-badge {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.section-header h4 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.section-lead {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.doctor-status-summary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-caption);
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
		margin-left: 2px;
	}

	.filter-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
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

	.section-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.block-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.block-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		text-transform: none;
		letter-spacing: normal;
	}

	.block-count {
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.section-group {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		overflow: hidden;
	}

	.form-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3);
		border-bottom: 1px solid var(--line);
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.form-row:last-child {
		border-bottom: none;
	}

	.form-row:hover {
		background: var(--bg-hover);
	}

	.form-row.row-warn {
		background: color-mix(in oklab, var(--warn) 4%, transparent);
	}

	.form-row.row-warn:hover {
		background: color-mix(in oklab, var(--warn) 8%, var(--bg-hover));
	}

	.form-row.row-error {
		background: color-mix(in oklab, var(--danger) 5%, transparent);
	}

	.form-row.row-error:hover {
		background: color-mix(in oklab, var(--danger) 9%, var(--bg-hover));
	}

	.form-row-copy {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		flex: 1;
	}

	.doctor-check-line {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.form-row-label {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.doctor-rec-box {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		font-size: var(--text-caption);
		line-height: 1.4;
		margin-left: calc(var(--space-2) + 14px);
	}

	.doctor-rec-box.rec-warn {
		color: var(--warn);
	}

	.doctor-rec-box.rec-error {
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

	.form-row-control {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.val-code {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		padding: 2px 6px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		max-width: 320px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status-pill {
		font-size: var(--text-caption);
		font-weight: 500;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-raised);
		color: var(--ink-muted);
	}

	.status-pill.status-warn {
		color: var(--warn);
		border-color: color-mix(in oklab, var(--warn) 30%, var(--line));
		background: color-mix(in oklab, var(--warn) 8%, var(--bg-raised));
	}

	.status-pill.status-error {
		color: var(--danger);
		font-weight: 600;
		border-color: color-mix(in oklab, var(--danger) 30%, var(--line));
		background: color-mix(in oklab, var(--danger) 8%, var(--bg-raised));
	}

	.loading-state,
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
</style>
