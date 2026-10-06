<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { fetchSessionsList, type SessionEntry } from '$lib/agent/sessionsList';
	import { onMount, untrack } from 'svelte';
	import { taskStore } from '$lib/stores/tasks.svelte';
	import { backfillSessionTitles } from '$lib/stores/sessionTitles';
	import { IconGitBranch, IconListTodo, IconSearch } from '$lib/icons';
	import Segmented, { type SegmentedOption } from '$lib/ui/Segmented.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import { chatReveal } from '$lib/agent/motion';

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
					prompt: '',
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

	const DAY_MS = 86_400_000;
	const GROUP_LABELS = [
		m.session_list_group_today,
		m.session_list_group_yesterday,
		m.session_list_group_week,
		m.session_list_group_month,
		m.session_list_group_older
	];

	/** 0 oggi, 1 ieri, 2 ultimi 7 giorni, 3 ultimi 30, 4 piu' vecchie: per giorni di calendario, non per ore. */
	function groupOf(seconds: number): number {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const day = new Date(seconds * 1000);
		day.setHours(0, 0, 0, 0);
		// Arrotondare assorbe l'ora in piu' o in meno dei cambi d'ora legale.
		const days = Math.round((today.getTime() - day.getTime()) / DAY_MS);
		if (days <= 0) return 0;
		if (days === 1) return 1;
		if (days < 7) return 2;
		if (days < 30) return 3;
		return 4;
	}

	const groupedSessions = $derived.by(() => {
		const groups: SessionEntry[][] = GROUP_LABELS.map(() => []);
		for (const session of displaySessions) groups[groupOf(session.created_at)].push(session);
		return groups
			.map((sessions, index) => ({ index, sessions }))
			.filter((group) => group.sessions.length > 0);
	});

	/**
	 * L'intestazione del gruppo dice gia' il giorno: la riga porta solo il
	 * dettaglio che manca (minuti o ore oggi, l'orario ieri, il giorno della
	 * settimana, la data).
	 */
	function formatShortTime(seconds: number): string {
		const ms = seconds * 1000;
		const delta = Math.max(0, Date.now() - ms);
		switch (groupOf(seconds)) {
			case 0:
				if (delta < 60_000) return i18n.formatRelativeTime(0, 'second');
				return delta < 3_600_000
					? new Intl.NumberFormat(i18n.formatLocale, { style: 'unit', unit: 'minute', unitDisplay: 'short' }).format(Math.floor(delta / 60_000))
					: new Intl.NumberFormat(i18n.formatLocale, { style: 'unit', unit: 'hour', unitDisplay: 'short' }).format(Math.floor(delta / 3_600_000));
			case 1:
				return i18n.formatDate(ms, { hour: '2-digit', minute: '2-digit' });
			case 2:
				return i18n.formatDate(ms, { weekday: 'short' });
			default:
				return i18n.formatDate(ms, { day: 'numeric', month: 'short' });
		}
	}

	/** Seconda riga quando il titolo manca: da dove viene la sessione. */
	function originLabel(session: SessionEntry): string {
		if (session.laneKind === 'worktree') {
			return session.laneTitle
				? `${m.session_list_lane_filter_worktree()} · ${session.laneTitle}`
				: m.session_list_lane_filter_worktree();
		}
		if (taskStore.isTaskSession(projectPath, session.id)) return m.session_list_from_queue();
		return m.session_list_lane_filter_main();
	}

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
			// Solo l'elenco completo: i risultati di una ricerca sono un
			// sottoinsieme casuale, i titoli si generano all'apertura dello storico.
			if (!q.trim()) {
				backfillSessionTitles(result, (sessionId, title) => {
					sessions = sessions.map((session) => (session.id === sessionId ? { ...session, title } : session));
				});
			}
		} catch (error) {
			if (token !== requestToken || target !== projectPath) return;
			loadError = m.session_list_history_unavailable({ error: String(error) });
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

	<div class="list" role="region" aria-label={m.session_list_list_aria()} aria-busy={loading}>
		{#if loading && displaySessions.length === 0}
			<div class="loading-state" aria-live="polite">
				<StatusMark status="running" label={m.session_list_loading()} />
				<span class="loading-label">{m.session_list_loading()}</span>
			</div>
		{:else if loadError}
			<div class="msg error" role="alert">{loadError}</div>
		{:else if displaySessions.length === 0}
			<div class="msg">{m.session_list_empty()}</div>
		{:else}
			{#each groupedSessions as group (group.index)}
				<section class="group" aria-labelledby="session-group-{group.index}">
					<h3 class="group-label" id="session-group-{group.index}">{GROUP_LABELS[group.index]()}</h3>
					<ul class="rows">
						{#each group.sessions as session (session.id)}
							{@const isCurrent = session.id === currentSessionId}
							{@const primary = session.title || session.prompt || m.session_list_untitled()}
							{@const showsPrompt = Boolean(session.title && session.prompt)}
							{@const secondary = showsPrompt
								? session.prompt
								: session.title || session.prompt
									? originLabel(session)
									: m.session_list_no_messages()}
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
												? m.session_list_resume_title({ title: primary })
												: automationReason}
									aria-label={isCurrent ? m.ui_sessionlist_sessione_attiva_value1_dd4e({ value1: primary }) : m.session_list_resume_aria({ title: primary, age: formatRelative(session.created_at) })}
									onclick={() => onResume(session.id)}
								>
									<span class="line">
										<span class="title">{primary}</span>
										<span class="time">
											{#if session.optimistic}
												<StatusMark status="running" />
											{:else}
												{formatShortTime(session.created_at)}
											{/if}
										</span>
									</span>
									<span class="line secondary">
										<span class="subtitle">{secondary}</span>
										{#if showsPrompt && taskStore.isTaskSession(projectPath, session.id)}
											<span class="mark" title={m.session_list_from_queue()}><IconListTodo /></span>
										{/if}
										{#if showsPrompt && session.laneKind === 'worktree'}
											<span class="mark" title={session.laneTitle ?? m.session_list_lane_filter_worktree()}><IconGitBranch /></span>
										{/if}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		{/if}
	</div>
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
		padding: 0 0 var(--space-2) 0;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	/* L'intestazione resta in vista mentre scorrono le righe del suo gruppo. */
	.group-label {
		position: sticky;
		top: 0;
		z-index: 1;
		margin: 0;
		padding: var(--space-3) var(--space-3) var(--space-1);
		background: var(--bg-base);
		color: var(--ink-faint);
		font-size: var(--text-group-label);
		font-weight: 500;
	}

	.group:first-child .group-label {
		padding-top: var(--space-1);
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0 var(--space-1);
		display: flex;
		flex-direction: column;
		gap: 1px;
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

	/* Senza reset WebKit dipinge il <button> col grigio di sistema (ButtonFace). */
	.session-row {
		position: relative;
		width: 100%;
		min-height: 50px;
		padding: 7px var(--space-2) 7px 10px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out);
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

	.session-row.current::before {
		content: '';
		position: absolute;
		left: 0;
		top: var(--space-2);
		bottom: var(--space-2);
		width: 2px;
		border-radius: var(--radius-full);
		background: var(--brand);
	}

	.session-row:disabled {
		cursor: default;
	}

	.line {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
	}

	.line.secondary {
		align-items: center;
		gap: 6px;
	}

	.title,
	.subtitle {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title {
		color: var(--ink);
		font-size: var(--text-body);
		font-weight: 450;
		line-height: 1.35;
	}

	.session-row.current .title {
		font-weight: 560;
	}

	.session-row:disabled:not(.current) .title {
		color: var(--ink-muted);
	}

	.subtitle {
		color: var(--ink-faint);
		font-size: var(--text-label);
		line-height: 1.35;
	}

	.time {
		flex: 0 0 auto;
		color: var(--ink-faint);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.mark {
		--icon-size: 12px;
		flex: 0 0 auto;
		display: inline-flex;
		color: var(--ink-faint);
	}
</style>
