<!--
  ProjectHistorySheet.svelte — Storico delle sessioni per singolo progetto (Gate R48, R-REM-15).
  Accessibile dall'espansione del progetto o dal menu ⋯ della chat.
  Elenca le sessioni passate in sola lettura con ricerca e paginazione indietro (list_sessions).
  Il tocco apre la sessione storica in navigazione senza cambiare la sessione attiva.
-->
<script lang="ts">
	import type { RemoteProject, RemoteSessionSummary, RemoteSessionPage } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { navigation } from '../navigation.svelte.ts';
	import { IconClose, IconSearch, IconChevronRight } from '../icons.ts';

	let {
		hostId,
		project,
		onClose
	}: {
		hostId: string;
		project: RemoteProject;
		onClose: () => void;
	} = $props();

	let searchQuery = $state('');
	let sessions = $state<RemoteSessionSummary[]>([]);
	let beforeCursor = $state<string | null>(null);
	let isLoading = $state(false);
	let isLoadingMore = $state(false);
	let errorMessage = $state<string | null>(null);
	let searchTimer: number | null = null;
	let activeRequestGen = 0;

	// Escludi le sessioni attualmente agganciate alle corsie del progetto
	const activeSessionIds = $derived.by<Set<string>>(() => {
		const set = new Set<string>();
		for (const lane of project.lanes) {
			if (lane.session?.id) set.add(lane.session.id);
		}
		return set;
	});

	const displaySessions = $derived(
		sessions.filter((s) => !activeSessionIds.has(s.sessionId))
	);

	$effect(() => {
		void fetchHistory(false);
	});

	function handleSearchInput(e: Event): void {
		searchQuery = (e.target as HTMLInputElement).value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = window.setTimeout(() => {
			void fetchHistory(false);
		}, 300);
	}

	async function fetchHistory(append = false): Promise<void> {
		const reqGen = ++activeRequestGen;
		const query = searchQuery.trim() || undefined;
		const cursor = append ? beforeCursor : null;

		if (append) {
			if (isLoadingMore || !cursor) return;
			isLoadingMore = true;
		} else {
			sessions = [];
			beforeCursor = null;
			isLoading = true;
			errorMessage = null;
		}

		try {
			const res = (await connection.sendCommand(hostId, {
				kind: 'list_sessions',
				projectId: project.id,
				query,
				before: cursor,
				limit: 30
			})) as RemoteSessionPage | undefined;

			if (reqGen !== activeRequestGen) return;

			if (res && Array.isArray(res.sessions)) {
				if (append) {
					sessions = [...sessions, ...res.sessions];
				} else {
					sessions = res.sessions;
				}
				beforeCursor = res.before ?? null;
			}
		} catch (err) {
			if (reqGen !== activeRequestGen) return;
			errorMessage = (err as Error)?.message || 'Errore caricamento storico';
		} finally {
			if (reqGen === activeRequestGen) {
				isLoading = false;
				isLoadingMore = false;
			}
		}
	}

	function handleOpenSession(session: RemoteSessionSummary): void {
		navigation.openChat({
			hostId,
			projectId: project.id,
			sessionId: session.sessionId,
			sessionTitle: session.title || session.prompt.slice(0, 40),
			isHistory: true
		});
		onClose();
	}

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
</script>

<div class="backdrop" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
	<div class="sheet" role="dialog" aria-modal="true" aria-label={t('projectHistoryTitle')}>
		<div class="grip" aria-hidden="true"></div>

		<div class="sheet-head">
			<div class="head-titles">
				<h2>{t('projectHistoryTitle')}</h2>
				<p class="sub">{project.name}</p>
			</div>
			<button
				type="button"
				class="icon-btn"
				onclick={onClose}
				aria-label={t('close')}
				title={t('close')}
			>
				<IconClose />
			</button>
		</div>

		<div class="search-box">
			<span class="search-icon"><IconSearch /></span>
			<input
				type="search"
				class="search-input"
				placeholder={t('projectHistorySearchPlaceholder')}
				value={searchQuery}
				oninput={handleSearchInput}
				aria-label={t('projectHistorySearchPlaceholder')}
			/>
		</div>

		<div class="sheet-body">
			{#if isLoading}
				<div class="loading-state">
					<span class="spinner" aria-hidden="true"></span>
					<p>{t('loadingOlder')}</p>
				</div>
			{:else if errorMessage}
				<div class="error-msg">{errorMessage}</div>
			{:else if displaySessions.length === 0}
				<p class="empty-text">{t('noHistorySessions')}</p>
			{:else}
				<div class="sessions-list">
					{#each displaySessions as s (s.sessionId)}
						<button
							type="button"
							class="session-item"
							onclick={() => handleOpenSession(s)}
						>
							<div class="session-info">
								<span class="session-title">
									{s.title || (s.prompt.length > 60 ? s.prompt.slice(0, 59) + '…' : s.prompt)}
								</span>
								<span class="session-meta">
									<span class="session-date">{formatDate(s.createdAt)}</span>
									{#if s.laneTitle}
										<span class="sep">·</span>
										<span class="session-lane">{s.laneTitle}</span>
									{/if}
								</span>
							</div>
							<span class="chev" aria-hidden="true"><IconChevronRight /></span>
						</button>
					{/each}

					{#if beforeCursor}
						<button
							type="button"
							class="load-more-btn"
							disabled={isLoadingMore}
							onclick={() => void fetchHistory(true)}
						>
							{isLoadingMore ? t('loadingOlder') : t('loadMoreSessions')}
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: color-mix(in oklch, var(--ink) 35%, transparent);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		animation: fade 0.16s ease-out;
	}

	.sheet {
		width: 100%;
		max-width: 560px;
		max-height: min(88dvh, var(--app-h, 100dvh));
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border-radius: 18px 18px 0 0;
		padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
		animation: slideUp 0.24s cubic-bezier(0.22, 1, 0.36, 1);
		box-shadow: var(--shadow-overlay);
	}

	.grip {
		width: 36px;
		height: 5px;
		border-radius: 3px;
		background: var(--line-strong);
		margin: 0 auto 8px;
		flex-shrink: 0;
	}

	.sheet-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 8px;
		padding-bottom: 8px;
		flex-shrink: 0;
	}

	.head-titles h2 {
		font-size: 18px;
		font-weight: 650;
		color: var(--ink);
		margin: 0;
	}

	.head-titles .sub {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		margin: 2px 0 0;
	}

	.icon-btn {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		border-radius: 50%;
	}

	.search-box {
		position: relative;
		display: flex;
		align-items: center;
		margin: 8px 0;
		flex-shrink: 0;
	}

	.search-icon {
		position: absolute;
		left: 12px;
		color: var(--ink-muted);
		display: grid;
		place-items: center;
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		height: 40px;
		padding: 0 12px 0 38px;
		border-radius: 20px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		font-size: var(--text-sm);
		color: var(--ink);
		outline: none;
	}

	.search-input:focus {
		border-color: var(--brand);
	}

	.sheet-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 6px 0 12px;
		-webkit-overflow-scrolling: touch;
	}

	.sessions-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.session-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		text-align: left;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		cursor: pointer;
		min-height: 52px;
	}

	.session-item:hover {
		background: var(--bg-hover);
	}

	.session-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.session-title {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-meta {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.sep {
		opacity: 0.6;
	}

	.chev {
		color: var(--ink-muted);
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.load-more-btn {
		width: 100%;
		min-height: 40px;
		margin-top: 8px;
		background: transparent;
		border: 1px dashed var(--line);
		border-radius: var(--radius-md);
		color: var(--brand);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
	}

	.load-more-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.empty-text,
	.loading-state,
	.error-msg {
		text-align: center;
		padding: 24px 0;
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.error-msg {
		color: var(--danger);
	}

	@keyframes fade {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes slideUp {
		from { transform: translateY(100%); }
		to { transform: translateY(0); }
	}
</style>
