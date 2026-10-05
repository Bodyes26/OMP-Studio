<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { fetchSessionsList } from '$lib/agent/sessionsList';
	import { onMount, untrack } from 'svelte';
	import { taskStore } from '$lib/stores/tasks.svelte';
	import { IconSearch } from '$lib/icons';
	import Segmented, { type SegmentedOption } from '$lib/ui/Segmented.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import { chatReveal } from '$lib/agent/motion';
	interface SessionEntry {
		id: string;
		title: string;
		created_at: number;
		optimistic?: boolean;
		/** Corsia che ha eseguito il task, quando la sessione nasce dalla coda. */
		laneKind?: 'main' | 'worktree';
		laneTitle?: string;
	}

	let {
		projectPath,
		canAutomate,
		automationReason,
		currentSessionId,
		onResume
	}: {
		projectPath: string;
		canAutomate: boolean;
		automationReason: string;
		currentSessionId: string | null;
		onResume: (sessionId: string) => void;
	} = $props();

	let sessions = $state<SessionEntry[]>([]);
	let query = $state('');
	/** Filtro dello storico per corsia di esecuzione (Gate R27 / W09). */
	let laneFilter = $state<'all' | 'main' | 'worktree'>('all');
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let reconciliationTimer: number | null = null;
	let searchTimer: number | null = null;
	let reconciliationAttempts = 0;

	// Opzioni del filtro corsia per Segmented (Gate R27 / W09)
	const laneOptions = $derived<SegmentedOption<'all' | 'main' | 'worktree'>[]>([
		{ value: 'all', label: m.session_list_lane_filter_all() },
		{ value: 'main', label: m.session_list_lane_filter_main() },
		{ value: 'worktree', label: m.session_list_lane_filter_worktree() }
	]);

	// Righe nuove: chatReveal solo per le chiavi comparse dopo la prima lettura.
	// Montaggio, cambio scheda e ricaricamento restano fermi (Still-Room Rule).
	let knownSessions: Set<string> | null = null;
	let freshKeys = $state(new Set<string>());

	function trackFresh(known: Set<string> | null, keys: string[], fresh: Set<string>): Set<string> {
		if (known) {
			for (const key of keys) if (!known.has(key)) fresh.add(key);
		}
		return new Set(keys);
	}
	const displaySessions = $derived.by(() => {
		const known = new Set(sessions.map((session) => session.id));
		const normalizedQuery = query.trim().toLocaleLowerCase();
		const nowSec = Math.floor(Date.now() / 1000);
		const optimistic = taskStore.originsFor(projectPath)
			.filter((origin) => !known.has(origin.sessionId))
			.filter((origin) => !normalizedQuery || origin.title.toLocaleLowerCase().includes(normalizedQuery))
			.map((origin): SessionEntry => {
				const created_at = Math.floor(origin.launchedAt / 1000);
				// Se il task e' stato lanciato da oltre 15 secondi, non e' piu' in attesa iniziale di sync
				const isRecent = nowSec - created_at < 15;
				return {
					id: origin.sessionId,
					title: origin.title,
					created_at,
					optimistic: isRecent
				};
			});
		return [...optimistic, ...sessions]
			.map((session): SessionEntry => {
				// Il record di lancio sopravvive alla corsia: dopo l'integrazione
				// il worktree sparisce dal disco, il badge resta nello storico.
				const run = taskStore.taskRunFor(projectPath, session.id);
				return run
					? { ...session, laneKind: run.laneKind, laneTitle: run.laneTitle }
					: session;
			})
			.filter((session) => {
				if (laneFilter === 'all') return true;
				const kind = session.laneKind ?? 'main';
				return kind === laneFilter;
			})
			.sort((left, right) => right.created_at - left.created_at);
	});

	function scheduleReconciliation() {
		const known = new Set(sessions.map((session) => session.id));
		const hasMissingTaskSession = taskStore.originsFor(projectPath)
			.some((origin) => !known.has(origin.sessionId));
		if (!hasMissingTaskSession) {
			reconciliationAttempts = 0;
			if (reconciliationTimer !== null) window.clearTimeout(reconciliationTimer);
			reconciliationTimer = null;
			return;
		}
		if (query.trim() || reconciliationTimer !== null || reconciliationAttempts >= 8) return;

		const delay = Math.min(2000, 250 * 2 ** reconciliationAttempts);
		reconciliationAttempts += 1;
		reconciliationTimer = window.setTimeout(() => {
			reconciliationTimer = null;
			void loadSessions();
		}, delay);
	}

	/**
	 * Le risposte lente vanno scartate, non applicate. Il pannello non e'
	 * ricreato al cambio progetto: senza questa guardia la lista del progetto
	 * precedente arrivava dopo ed elencava sessioni che non sono di qui.
	 */
	let requestToken = 0;

	async function loadSessions(customQuery?: string) {
		const target = projectPath;
		const token = ++requestToken;
		loading = true;
		loadError = null;
		const q = customQuery !== undefined ? customQuery : untrack(() => query);
		try {
			const result = q.trim()
				? await invoke<SessionEntry[]>('sessions_search', { query: q.trim(), projectPath: target })
				: await fetchSessionsList(target);
			if (token !== requestToken || target !== projectPath) return;
			const fresh = new Set<string>();
			knownSessions = trackFresh(knownSessions, result.map((s) => s.id), fresh);
			freshKeys = fresh;
			sessions = result;
			scheduleReconciliation();
		} catch (error) {
			if (token !== requestToken || target !== projectPath) return;
			loadError = `Storico non disponibile: ${String(error)}`;
		} finally {
			if (token === requestToken) loading = false;
		}
	}

	function formatRelative(seconds: number) {
		const delta = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
		if (delta < 60) return i18n.formatRelativeTime(0, 'second');
		if (delta < 3600) return i18n.formatRelativeTime(-Math.floor(delta / 60), 'minute');
		if (delta < 86400) return i18n.formatRelativeTime(-Math.floor(delta / 3600), 'hour');
		if (delta < 604800) return i18n.formatRelativeTime(-Math.floor(delta / 86400), 'day');
		return i18n.formatDate(seconds * 1000);
	}

	function handleQueryInput(event: Event) {
		const val = (event.target as HTMLInputElement).value;
		query = val;
		if (searchTimer !== null) window.clearTimeout(searchTimer);
		searchTimer = window.setTimeout(() => {
			searchTimer = null;
			void loadSessions(val);
		}, 280);
	}

	function handleSearch(event: SubmitEvent) {
		event.preventDefault();
		if (searchTimer !== null) {
			window.clearTimeout(searchTimer);
			searchTimer = null;
		}
		void loadSessions();
	}

	$effect(() => {
		if (!projectPath) return;
		reconciliationAttempts = 0;
		if (reconciliationTimer !== null) window.clearTimeout(reconciliationTimer);
		reconciliationTimer = null;
		if (searchTimer !== null) window.clearTimeout(searchTimer);
		searchTimer = null;
		knownSessions = null;
		freshKeys = new Set();
		// La lista del progetto precedente sparisce subito: mostrarla mentre
		// arriva quella nuova e' peggio di un caricamento vuoto.
		sessions = [];
		untrack(() => {
			void loadSessions();
		});
	});

	onMount(() => {
		const refresh = (event: Event) => {
			const detail = (event as CustomEvent<{ projectPath?: string }>).detail;
			if (!detail?.projectPath || detail.projectPath.toLowerCase() === projectPath.toLowerCase()) {
				reconciliationAttempts = 0;
				void loadSessions();
			}
		};
		const onFocus = () => void loadSessions();
		window.addEventListener('focus', onFocus);
		window.addEventListener('studio-sessions-refresh', refresh);
		return () => {
			window.removeEventListener('focus', onFocus);
			window.removeEventListener('studio-sessions-refresh', refresh);
			if (reconciliationTimer !== null) window.clearTimeout(reconciliationTimer);
			if (searchTimer !== null) window.clearTimeout(searchTimer);
		};
	});
</script>

<div class="session-list">
	<form onsubmit={handleSearch} class="search-form">
		<label for="session-search" class="sr-only">{m.session_list_search_label()}</label>
		<div class="search-row">
			{#if loading && displaySessions.length > 0}
				<StatusMark status="running" />
			{:else}
				<span class="search-icon" aria-hidden="true"><IconSearch /></span>
			{/if}
			<input
				id="session-search"
				type="search"
				value={query}
				oninput={handleQueryInput}
				placeholder={m.session_list_search_placeholder()}
				aria-label={m.session_list_search_aria()}
			/>
		</div>
	</form>

	<div class="lane-filter-wrap">
		<Segmented
			options={laneOptions}
			value={laneFilter}
			fill
			ariaLabel={m.session_list_lane_filter_aria()}
			onChange={(val) => (laneFilter = val)}
		/>
	</div>

	<ul class="list" aria-label={m.session_list_list_aria()} aria-busy={loading}>
		{#if loading && displaySessions.length === 0}
			<li class="loading-state" aria-live="polite">
				<StatusMark status="running" label={m.session_list_loading()} />
				<span class="loading-label">{m.session_list_loading()}</span>
			</li>
		{:else if loadError}
			<li class="msg error" role="alert">{loadError}</li>
		{:else if displaySessions.length === 0}
			<li class="msg">{m.session_list_empty()}</li>
		{:else}
			{#each displaySessions as session (session.id)}
				{@const isCurrent = session.id === currentSessionId}
				<li in:chatReveal={{ duration: freshKeys.has(session.id) ? undefined : 0 }}>
					<button
						type="button"
						class="session-row"
						class:current={isCurrent}
						disabled={isCurrent || !canAutomate}
						title={isCurrent
							? m.ui_sessionlist_sessione_attiva_1526()
							: session.optimistic
								? m.ui_sessionlist_la_sessione_si_sta_sincronizzando_con_lo_82e6()
								: canAutomate
									? `Riprendi: ${session.title}`
									: automationReason}
						aria-label={isCurrent ? m.ui_sessionlist_sessione_attiva_value1_dd4e({ value1: session.title || 'senza titolo' }) : m.session_list_resume_aria({ title: session.title || 'senza titolo', age: formatRelative(session.created_at) })}
						onclick={() => onResume(session.id)}
					>
						<span class="title">{session.title || m.session_list_untitled()}</span>
						<span class="meta">
							{formatRelative(session.created_at)}
							{#if taskStore.isTaskSession(projectPath, session.id)}
								<span class="badge">{m.page_columns_header_task()}</span>
							{/if}
							{#if session.laneKind === 'worktree'}
								<span class="badge worktree" title={session.laneTitle ?? ''}>
									{m.session_list_lane_badge_worktree()}
								</span>
							{/if}
							{#if isCurrent}
								<span class="current-label">{m.session_list_active_badge()}</span>
							{:else if session.optimistic}
								<span>{m.session_list_syncing()}</span>
							{/if}
						</span>
					</button>
				</li>
			{/each}
		{/if}
	</ul>
</div>

<style>
	.session-list {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		background: var(--bg-base);
	}

	.search-form {
		padding: 0 var(--space-2) var(--space-2);
	}

	.search-row {
		--icon-size: 12px;
		height: 28px;
		padding: 0 var(--space-2);
		display: flex;
		align-items: center;
		gap: var(--space-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		color: var(--ink-faint);
	}

	.search-row:focus-within {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
		border-color: transparent;
	}

	.search-icon {
		display: flex;
		align-items: center;
		flex: 0 0 auto;
	}

	.search-row input {
		min-width: 0;
		flex: 1;
		padding: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-label);
	}

	.search-row input::placeholder {
		color: var(--ink-faint);
	}

	.lane-filter-wrap {
		padding: 0 var(--space-2) var(--space-2);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0 0 var(--space-2) 0;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.list > li {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-6) var(--space-4);
		color: var(--ink-muted);
		text-align: center;
	}

	.loading-label {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		letter-spacing: 0.02em;
	}

	.msg {
		padding: var(--space-4) var(--space-3);
		color: var(--ink-faint);
		font-size: var(--text-label);
		line-height: 1.45;
	}

	.msg.error {
		margin: 0 var(--space-2);
		padding: var(--space-2);
		border-radius: var(--radius-md);
		background: var(--danger-dim);
		color: var(--ink);
	}

	.session-row {
		width: 100%;
		min-height: 44px;
		padding: var(--space-1) var(--space-2);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: var(--space-1);
		border: 0;
		border-radius: var(--radius-md);
		text-align: left;
		cursor: pointer;
	}

	.session-row:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	.session-row:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}
	.session-row:active:not(:disabled) {
		background: var(--bg-active);
	}

	.session-row.current {
		background: var(--bg-active);
	}

	.session-row:disabled {
		cursor: default;
	}

	.title {
		width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
		font-size: var(--text-body);
		font-weight: 450;
		line-height: 1.45;
	}

	.session-row:disabled:not(.current) .title {
		color: var(--ink-muted);
	}

	.meta {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.badge,
	.current-label {
		padding: 1px var(--space-1);
		border-radius: var(--radius-full);
		background: var(--bg-raised);
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		font-weight: 600;
	}

	.current-label {
		color: var(--brand-ink);
	}

	.badge.worktree {
		background: color-mix(in srgb, var(--brand-ink, currentColor) 18%, transparent);
		color: var(--brand-ink);
		letter-spacing: 0.04em;
	}
</style>
