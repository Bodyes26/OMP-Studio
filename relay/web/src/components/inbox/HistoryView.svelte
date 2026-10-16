<!--
  HistoryView.svelte — Modalità cronologia sessioni passate (Gate R44 Fleet Hub).
  Permette di scegliere o cercare un progetto tra le macchine filtrate,
  paginare e cercare le sessioni con list_sessions, escludendo quelle correnti.
  Gestisce le identità di richiesta asincrona per evitare visualizzazione di dati stantii.
-->
<script lang="ts">
	import type { RemoteProject, Feature, RemoteSessionSummary, RemoteSessionPage } from '../../../../src/protocol.ts';
	import { t } from '../../i18n.ts';
	import { connection } from '../../connection.svelte.ts';
	import { navigation } from '../../navigation.svelte.ts';
	import ProjectIcon from './ProjectIcon.svelte';
	import MachineBadge from './MachineBadge.svelte';
	import { IconSearch, IconChevronRight } from '../../icons.ts';
	import { untrack } from 'svelte';

	let {
		hostFilter = 'all'
	}: {
		hostFilter?: string;
	} = $props();

	let searchQuery = $state('');
	let selectedProjectKey = $state<string | null>(null);
	let sessions = $state<RemoteSessionSummary[]>([]);
	let beforeCursor = $state<string | null>(null);
	let isLoading = $state(false);
	let isLoadingMore = $state(false);
	let errorMessage = $state<string | null>(null);

	// Identità della richiesta corrente per ignorare ritorni asincroni stantii
	let activeRequestIdentity = 0;

	interface ProjectWithHost {
		project: RemoteProject;
		hostId: string;
		hostName: string;
		hostOnline: boolean;
		hostFeatures: Feature[];
	}

	const availableProjects = $derived.by<ProjectWithHost[]>(() => {
		const result: ProjectWithHost[] = [];
		for (const host of connection.hosts) {
			if (hostFilter !== 'all' && host.id !== hostFilter) continue;
			const state = connection.hostStates[host.id]?.state;
			if (!state?.projects) continue;
			for (const p of state.projects) {
				result.push({
					project: p,
					hostId: host.id,
					hostName: host.name,
					hostOnline: host.online,
					hostFeatures: host.features
				});
			}
		}
		return result;
	});

	// Imposta il primo progetto di default se non impostato o non più presente
	$effect(() => {
		const list = availableProjects;
		if (selectedProjectKey) {
			const exists = list.some((p) => `${p.hostId}:${p.project.id}` === selectedProjectKey);
			if (!exists) {
				selectedProjectKey = list[0] ? `${list[0].hostId}:${list[0].project.id}` : null;
			}
		} else if (list.length > 0) {
			selectedProjectKey = `${list[0].hostId}:${list[0].project.id}`;
		}
	});

	const currentProjectWithHost = $derived.by(() => {
		if (!selectedProjectKey) return null;
		return availableProjects.find((p) => `${p.hostId}:${p.project.id}` === selectedProjectKey) || null;
	});

	const supportsFleet = $derived(
		Boolean(currentProjectWithHost?.hostFeatures.includes('fleet'))
	);

	// ID delle sessioni correntemente attive in questo progetto da escludere dalla lista storica
	const currentActiveSessionIds = $derived.by<Set<string>>(() => {
		const set = new Set<string>();
		if (!currentProjectWithHost) return set;
		for (const lane of currentProjectWithHost.project.lanes) {
			const sId = lane.session?.id;
			if (sId) set.add(sId);
		}
		return set;
	});

	// Sessioni storiche escluse quelle correnti
	const filteredHistoricalSessions = $derived.by(() => {
		return sessions.filter((s) => !currentActiveSessionIds.has(s.sessionId));
	});

	let searchTimer: number | null = null;
	function handleSearchInput(e: Event) {
		searchQuery = (e.target as HTMLInputElement).value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = window.setTimeout(() => {
			fetchHistory(false);
		}, 300);
	}

	async function fetchHistory(append = false) {
		if (!currentProjectWithHost || !supportsFleet) return;
		const { hostId, project } = currentProjectWithHost;
		const cursor = append ? beforeCursor : null;
		const query = searchQuery.trim() || undefined;

		const reqGen = ++activeRequestIdentity;

		if (append) {
			if (isLoadingMore || !cursor) return;
			isLoadingMore = true;
		} else {
			// Pulizia immediata quando si carica un nuovo progetto o nuova ricerca
			sessions = [];
			beforeCursor = null;
			isLoading = true;
			errorMessage = null;
		}

		try {
			const res = (await connection.sendCommand(hostId, {
				kind: 'list_sessions',
				projectId: project.id,
				before: cursor,
				limit: 25,
				query
			})) as RemoteSessionPage | undefined;

			// Ignora risultati obsoleti
			if (reqGen !== activeRequestIdentity) return;

			const newSessions = res?.sessions ?? [];
			if (append) {
				sessions = [...sessions, ...newSessions];
			} else {
				sessions = newSessions;
			}
			beforeCursor = res?.before ?? null;
		} catch (err: unknown) {
			if (reqGen !== activeRequestIdentity) return;
			errorMessage = (err as { message?: string })?.message || t('errFailed');
		} finally {
			if (reqGen === activeRequestIdentity) {
				isLoading = false;
				isLoadingMore = false;
			}
		}
	}

	$effect(() => {
		// Ricarica la cronologia solo quando cambia la chiave del progetto selezionato
		const key = selectedProjectKey;
		untrack(() => {
			if (key && supportsFleet) {
				fetchHistory(false);
			} else {
				sessions = [];
				beforeCursor = null;
			}
		});
	});

	function formatDate(ts: number): string {
		if (!ts) return '';
		const d = new Date(ts);
		return d.toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function handleOpenHistorySession(item: RemoteSessionSummary) {
		if (!currentProjectWithHost) return;
		navigation.openChat({
			hostId: currentProjectWithHost.hostId,
			projectId: currentProjectWithHost.project.id,
			sessionId: item.sessionId,
			sessionTitle: item.title || item.prompt,
			isHistory: true
		});
	}
</script>

<div class="history-view">
	<!-- Selezione del progetto -->
	<div class="history-controls">
		<div class="controls-row">
			<label class="project-picker-label" for="history-project-select">{t('chooseProject')}:</label>
			<select
				id="history-project-select"
				class="project-select"
				bind:value={selectedProjectKey}
			>
				{#each availableProjects as item (`${item.hostId}:${item.project.id}`)}
					<option value={`${item.hostId}:${item.project.id}`}>
						{item.project.name} ({item.hostName})
					</option>
				{/each}
			</select>
		</div>

		<!-- Barra di ricerca sessioni -->
		<div class="search-input-wrap">
			<span class="search-icon" aria-hidden="true"><IconSearch /></span>
			<input
				type="search"
				class="search-input"
				value={searchQuery}
				oninput={handleSearchInput}
				placeholder={t('searchHistoryPlaceholder')}
				disabled={!supportsFleet || isLoading}
			/>
		</div>
	</div>

	<!-- Stato non supportato o offline -->
	{#if currentProjectWithHost && !supportsFleet}
		<div class="unsupported-box">
			<p class="unsupported-msg">{t('historyUnsupported')}</p>
		</div>
	{:else if currentProjectWithHost && !currentProjectWithHost.hostOnline}
		<div class="unsupported-box">
			<p class="unsupported-msg">{t('chatMachineOffline')}</p>
		</div>
	{:else}
		<!-- Lista sessioni passate -->
		<div class="history-sessions-list">
			{#if errorMessage}
				<div class="history-error-alert" role="alert">
					{errorMessage}
				</div>
			{/if}

			{#if isLoading}
				<div class="loading-state">
					<div class="spinner"></div>
				</div>
			{:else if filteredHistoricalSessions.length === 0}
				<div class="empty-state">
					<p class="empty-hint">{t('noHistoryFound')}</p>
				</div>
			{:else}
				<ul class="sessions-list">
					{#each filteredHistoricalSessions as item (item.sessionId)}
						<li>
							<button
								type="button"
								class="history-row-btn"
								onclick={() => handleOpenHistorySession(item)}
							>
								<div class="history-row-main">
									<div class="history-row-title">
										{item.title || item.prompt}
									</div>
									<div class="history-row-meta">
										{#if item.laneTitle}
											<span class="lane-badge font-mono">{item.laneTitle}</span>
										{/if}
										{#if item.createdAt}
											<span class="date-label">{formatDate(item.createdAt)}</span>
										{/if}
									</div>
								</div>
								<span class="arrow-icon" aria-hidden="true"><IconChevronRight /></span>
							</button>
						</li>
					{/each}
				</ul>

				{#if beforeCursor}
					<div class="load-more-wrap">
						<button
							type="button"
							class="ui-button ui-button-ghost load-more-btn"
							disabled={isLoadingMore}
							onclick={() => fetchHistory(true)}
						>
							{isLoadingMore ? t('loadingOlder') : t('loadMoreSessions')}
						</button>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.history-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--bg-sunken);
		overflow-y: auto;
	}

	.history-controls {
		padding: 14px 16px;
		background: var(--bg-base);
		border-bottom: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex-shrink: 0;
	}

	.controls-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.project-picker-label {
		font-size: var(--text-mini, 11px);
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
	}

	.project-select {
		flex: 1;
		min-width: 0;
		padding: 6px 10px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-sunken);
		color: var(--ink);
		font-size: var(--text-caption, 12px);
		font-weight: 500;
	}

	.search-input-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon {
		position: absolute;
		left: 10px;
		color: var(--ink-faint);
		pointer-events: none;
		--icon-size: 14px;
		display: inline-flex;
	}

	.search-input {
		width: 100%;
		padding: 8px 12px 8px 32px;
		border-radius: var(--radius-lg);
		border: 1px solid var(--line);
		background: var(--bg-sunken);
		color: var(--ink);
		font-size: var(--text-caption, 12px);
		outline: none;
	}

	.search-input:focus {
		border-color: var(--brand);
		background: var(--bg-raised);
	}

	.unsupported-box {
		padding: 32px 20px;
		text-align: center;
		background: var(--bg-base);
		margin: 16px;
		border-radius: var(--radius-xl);
		border: 1px solid var(--line);
	}

	.unsupported-msg {
		font-size: var(--text-caption, 12px);
		color: var(--ink-muted);
		line-height: 1.5;
		margin: 0;
	}

	.history-sessions-list {
		flex: 1;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.history-error-alert {
		padding: 10px 14px;
		border-radius: var(--radius-lg);
		background: color-mix(in oklch, var(--danger) 15%, transparent);
		border: 1px solid color-mix(in oklch, var(--danger) 30%, transparent);
		color: var(--danger);
		font-size: var(--text-caption, 12px);
	}

	.loading-state,
	.empty-state {
		padding: 40px 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--line);
		border-top-color: var(--brand);
		border-radius: var(--radius-full);
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.empty-hint {
		font-size: var(--text-caption, 12px);
		color: var(--ink-muted);
		margin: 0;
	}

	.sessions-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.history-row-btn {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
		border-radius: var(--radius-xl);
		background: var(--bg-base);
		border: 1px solid var(--line);
		text-align: left;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.history-row-btn:hover {
		background: var(--bg-raised);
		border-color: var(--line-active, var(--line));
	}

	.history-row-main {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.history-row-title {
		font-size: var(--text-label, 13px);
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.history-row-meta {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-mini, 11px);
		color: var(--ink-muted);
	}

	.lane-badge {
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
	}

	.arrow-icon {
		color: var(--ink-faint);
		--icon-size: 14px;
		display: inline-flex;
		align-items: center;
	}

	.load-more-wrap {
		display: flex;
		justify-content: center;
		padding: 8px 0;
	}

	.load-more-btn {
		font-size: var(--text-caption, 12px);
	}
</style>
