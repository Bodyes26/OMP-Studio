<!--
  ProjectHistorySheet.svelte — Storico delle sessioni di un progetto, unito su tutte le copie (R-REM-15, R-REM-21).
  Le sessioni di ogni macchina raggiungibile stanno in un solo elenco, in ordine
  di data, ognuna con il glifo della sua macchina; la ricerca vale su tutte.
  Una macchina spenta lo dice in testa invece di far fallire lo storico.
-->
<script lang="ts">
	import type { RemoteSessionSummary, RemoteSessionPage } from '../../../src/protocol.ts';
	import { t, getFormatLocale } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { navigation } from '../navigation.svelte.ts';
	import { IconClose, IconSearch, IconChevronRight } from '../icons.ts';
	import { scrim, bottomSheet } from '../motion.ts';
	import MachineGlyph from './MachineGlyph.svelte';
	import { reachableCopies, type ProjectGroup } from '../multiMachine.ts';

	let {
		group,
		onClose
	}: {
		group: ProjectGroup;
		onClose: () => void;
	} = $props();

	interface SessionRow {
		hostId: string;
		hostName: string;
		online: boolean;
		session: RemoteSessionSummary;
	}

	let searchQuery = $state('');
	/** Sessioni di tutte le copie raggiungibili, unite per id di sessione. */
	let sessions = $state<SessionRow[]>([]);
	/** Cursore di pagina per macchina: ogni copia ha il suo storico. */
	let cursors = $state<Record<string, string | null>>({});
	let isLoading = $state(false);
	let isLoadingMore = $state(false);
	let errorMessage = $state<string | null>(null);
	let searchTimer: number | null = null;
	let activeRequestGen = 0;

	const copies = $derived(reachableCopies(group));
	const offlineHosts = $derived(group.copies.filter((copy) => !copy.online).map((copy) => copy.hostName));

	// Sessioni agganciate alle corsie del progetto: sono quelle in corso, non storico.
	const activeSessionIds = $derived.by<Set<string>>(() => {
		const set = new Set<string>();
		for (const copy of group.copies) {
			for (const lane of copy.project.lanes) {
				if (lane.session?.id) set.add(lane.session.id);
			}
		}
		return set;
	});

	const displaySessions = $derived(sessions.filter((row) => !activeSessionIds.has(row.session.sessionId)));
	/** Almeno una copia ha ancora pagine indietro. */
	const hasMore = $derived(Object.values(cursors).some((cursor) => cursor !== null));

	$effect(() => {
		void fetchHistory(false);
	});

	function handleSearchInput(event: Event): void {
		searchQuery = (event.target as HTMLInputElement).value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = window.setTimeout(() => {
			void fetchHistory(false);
		}, 300);
	}

	/** Interroga in parallelo le copie raggiungibili e unisce per data. */
	async function fetchHistory(append = false): Promise<void> {
		const reqGen = ++activeRequestGen;
		const query = searchQuery.trim() || undefined;
		const limit = 30;

		if (append) {
			if (isLoadingMore) return;
			isLoadingMore = true;
		} else {
			sessions = [];
			cursors = {};
			isLoading = true;
			errorMessage = null;
		}

		const targets = copies;
		if (targets.length === 0) {
			if (reqGen === activeRequestGen) {
				isLoading = false;
				isLoadingMore = false;
			}
			return;
		}

		try {
			const responses = await Promise.allSettled(
				targets.map(async (copy) => {
					const before = append ? (cursors[copy.hostId] ?? null) : null;
					// Una copia senza altre pagine non viene richiesta di nuovo.
					if (append && before === null) return { copy, page: undefined };
					const page = (await connection.sendCommand(copy.hostId, {
						kind: 'list_sessions',
						projectId: copy.project.id,
						query,
						before,
						limit
					})) as RemoteSessionPage | undefined;
					return { copy, page };
				})
			);

			if (reqGen !== activeRequestGen) return;

			const merged: SessionRow[] = append ? [...sessions] : [];
			const nextCursors: Record<string, string | null> = append ? { ...cursors } : {};
			let failures = 0;
			for (const result of responses) {
				if (result.status !== 'fulfilled') {
					failures++;
					continue;
				}
				const { copy, page } = result.value;
				if (!append) nextCursors[copy.hostId] = null;
				if (!page || !Array.isArray(page.sessions)) continue;
				nextCursors[copy.hostId] = page.before ?? null;
				for (const session of page.sessions) {
					if (merged.some((row) => row.session.sessionId === session.sessionId)) continue;
					merged.push({
						hostId: copy.hostId,
						hostName: copy.hostName,
						online: copy.online,
						session
					});
				}
			}

			merged.sort((a, b) => b.session.createdAt - a.session.createdAt);
			sessions = merged;
			cursors = nextCursors;

			// Una macchina spenta o una richiesta fallita non nascondono le altre.
			if (failures > 0 && failures === targets.length && merged.length === 0) {
				errorMessage = t('historyLoadError');
			} else {
				errorMessage = null;
			}
		} finally {
			if (reqGen === activeRequestGen) {
				isLoading = false;
				isLoadingMore = false;
			}
		}
	}

	function handleOpenSession(row: SessionRow): void {
		navigation.openChat({
			hostId: row.hostId,
			projectId: group.copies.find((copy) => copy.hostId === row.hostId)?.project.id ?? group.primary.project.id,
			sessionId: row.session.sessionId,
			sessionTitle: row.session.title || row.session.prompt.slice(0, 40),
			isHistory: true
		});
		onClose();
	}

	function formatDate(ts: number): string {
		if (!ts) return '';
		const d = new Date(ts);
		return d.toLocaleDateString(getFormatLocale(), {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div class="backdrop" transition:scrim onclick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
	<div class="sheet" transition:bottomSheet role="dialog" aria-modal="true" aria-label={t('projectHistoryTitle')}>
		<div class="grip" aria-hidden="true"></div>

		<div class="sheet-head">
			<div class="head-titles">
				<h2>{t('projectHistoryTitle')}</h2>
				<p class="sub">{group.primary.project.name}</p>
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
			{#if offlineHosts.length > 0}
				<p class="offline-notice">{t('historyMachineOffline')}</p>
			{/if}
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
					{#each displaySessions as row (row.session.sessionId)}
						{@const s = row.session}
						<button
							type="button"
							class="session-item"
							onclick={() => handleOpenSession(row)}
						>
							<div class="session-info">
								<span class="session-title">
									{s.title || (s.prompt.length > 60 ? s.prompt.slice(0, 59) + '…' : s.prompt)}
								</span>
								<span class="session-meta">
									<MachineGlyph glyph={{ kind: 'remote' }} size={10} />
									<span class="session-machine">{row.hostName}</span>
									<span class="sep">·</span>
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

					{#if hasMore}
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

	.offline-notice {
		margin: 0 0 8px;
		padding: 8px 12px;
		border-radius: var(--radius-md);
		background: color-mix(in oklch, var(--warn) 10%, transparent);
		color: var(--warn);
		font-size: var(--text-xs);
	}

	.session-machine {
		color: var(--ink-muted);
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

</style>
