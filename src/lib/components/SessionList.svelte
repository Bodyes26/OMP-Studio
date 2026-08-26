<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { onMount, untrack } from 'svelte';
	import { taskStore } from '$lib/stores/tasks.svelte';
	interface SessionEntry {
		id: string;
		title: string;
		created_at: number;
		optimistic?: boolean;
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
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let reconciliationTimer: number | null = null;
	let searchTimer: number | null = null;
	let reconciliationAttempts = 0;
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
		return [...optimistic, ...sessions].sort((left, right) => right.created_at - left.created_at);
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

	async function loadSessions(customQuery?: string) {
		loading = true;
		loadError = null;
		const q = customQuery !== undefined ? customQuery : untrack(() => query);
		try {
			sessions = q.trim()
				? await invoke<SessionEntry[]>('sessions_search', { query: q.trim(), projectPath })
				: await invoke<SessionEntry[]>('sessions_list', { projectPath });
			scheduleReconciliation();
		} catch (error) {
			loadError = `Storico non disponibile: ${String(error)}`;
		} finally {
			loading = false;
		}
	}

	function formatRelative(seconds: number) {
		const delta = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
		if (delta < 60) return 'adesso';
		if (delta < 3600) return `${Math.floor(delta / 60)} min fa`;
		if (delta < 86400) return `${Math.floor(delta / 3600)} h fa`;
		if (delta < 604800) return `${Math.floor(delta / 86400)} g fa`;
		return new Date(seconds * 1000).toLocaleDateString();
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
		// untrack evita che la lettura di query renda l'effetto dipendente da ogni battuta di tasto
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
		<label for="session-search">Cerca nelle sessioni</label>
		<div class="search-row">
			<svg viewBox="0 0 16 16" aria-hidden="true">
				<circle cx="7" cy="7" r="4.5" />
				<path d="m10.5 10.5 3.5 3.5" />
			</svg>
			<input
				id="session-search"
				type="search"
				value={query}
				oninput={handleQueryInput}
				placeholder="Cerca nello storico..."
				aria-label="Cerca nello storico delle sessioni"
			/>
		</div>
	</form>

	<ul class="list" aria-label="Elenco sessioni" aria-busy={loading}>
		{#if loading && displaySessions.length === 0}
			<li class="msg">Caricamento sessioni...</li>
		{:else if loadError}
			<li class="msg error" role="alert">{loadError}</li>
		{:else if displaySessions.length === 0}
			<li class="msg">Nessuna sessione trovata per questo progetto.</li>
		{:else}
			{#each displaySessions as session (session.id)}
				{@const isCurrent = session.id === currentSessionId}
				<li>
					<button
						type="button"
						class="session-row"
						class:current={isCurrent}
						disabled={isCurrent || !canAutomate}
						title={isCurrent
							? 'Sessione attiva'
							: session.optimistic
								? 'La sessione si sta sincronizzando con lo storico'
								: canAutomate
									? `Riprendi: ${session.title}`
									: automationReason}
						aria-label={isCurrent ? `Sessione attiva: ${session.title || 'senza titolo'}` : `Riprendi sessione: ${session.title || 'senza titolo'}, ${formatRelative(session.created_at)}`}
						onclick={() => onResume(session.id)}
					>
						<span class="title">{session.title || 'Sessione senza titolo'}</span>
						<span class="meta">
							{formatRelative(session.created_at)}
							{#if taskStore.isTaskSession(projectPath, session.id)}
								<span class="badge">TASK</span>
							{/if}
							{#if isCurrent}
								<span class="current-label">ATTIVA</span>
							{:else if session.optimistic}
								<span>in sincronizzazione</span>
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

	.search-form label {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.search-row {
		height: 28px;
		padding: 0 var(--space-2);
		display: flex;
		align-items: center;
		gap: var(--space-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--ink-faint);
	}

	.search-row:focus-within {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
		border-color: transparent;
	}

	.search-row svg {
		width: 12px;
		height: 12px;
		flex: 0 0 auto;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
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
		font-size: var(--text-sm);
	}

	.search-row input::placeholder {
		color: var(--ink-faint);
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
	.msg {
		padding: var(--space-4) var(--space-3);
		color: var(--ink-faint);
		font-size: var(--text-sm);
		line-height: 1.45;
	}

	.msg.error {
		margin: 0 var(--space-2);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--brand-dim);
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
		border-radius: var(--radius-sm);
		background: transparent;
		text-align: left;
		cursor: pointer;
	}

	.session-row:hover:not(:disabled) {
		background: var(--bg-hover);
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
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		color: var(--ink);
		font-size: var(--text-base);
		font-weight: 500;
		line-height: 1.3;
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
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	.badge,
	.current-label {
		padding: 1px var(--space-1);
		border-radius: var(--radius-full);
		background: var(--bg-raised);
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.current-label {
		color: var(--brand-ink);
	}
</style>