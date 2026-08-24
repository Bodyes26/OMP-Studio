<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { onMount } from 'svelte';
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
	let reconciliationAttempts = 0;

	const displaySessions = $derived.by(() => {
		const known = new Set(sessions.map((session) => session.id));
		const normalizedQuery = query.trim().toLocaleLowerCase();
		const optimistic = taskStore.originsFor(projectPath)
			.filter((origin) => !known.has(origin.sessionId))
			.filter((origin) => !normalizedQuery || origin.title.toLocaleLowerCase().includes(normalizedQuery))
			.map((origin): SessionEntry => ({
				id: origin.sessionId,
				title: origin.title,
				created_at: Math.floor(origin.launchedAt / 1000),
				optimistic: true
			}));
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

	async function loadSessions() {
		loading = true;
		loadError = null;
		try {
			sessions = query.trim()
				? await invoke<SessionEntry[]>('sessions_search', { query: query.trim(), projectPath })
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

	function handleSearch(event: SubmitEvent) {
		event.preventDefault();
		void loadSessions();
	}

	$effect(() => {
		if (!projectPath) return;
		reconciliationAttempts = 0;
		if (reconciliationTimer !== null) window.clearTimeout(reconciliationTimer);
		reconciliationTimer = null;
		void loadSessions();
	});

	onMount(() => {
		const refresh = (event: Event) => {
			const detail = (event as CustomEvent<{ projectPath?: string }>).detail;
			if (!detail?.projectPath || detail.projectPath.toLowerCase() === projectPath.toLowerCase()) {
				reconciliationAttempts = 0;
				void loadSessions();
			}
		};
		window.addEventListener('focus', loadSessions);
		window.addEventListener('studio-sessions-refresh', refresh);
		return () => {
			window.removeEventListener('focus', loadSessions);
			window.removeEventListener('studio-sessions-refresh', refresh);
			if (reconciliationTimer !== null) window.clearTimeout(reconciliationTimer);
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
			<input id="session-search" type="search" bind:value={query} placeholder="Cerca nello storico..." />
		</div>
	</form>

	<div class="list" aria-busy={loading}>
		{#if loading && displaySessions.length === 0}
			<div class="msg">Caricamento sessioni...</div>
		{:else if loadError}
			<div class="msg error" role="alert">{loadError}</div>
		{:else if displaySessions.length === 0}
			<div class="msg">Nessuna sessione trovata per questo progetto.</div>
		{:else}
			{#each displaySessions as session (session.id)}
				{@const isCurrent = session.id === currentSessionId}
				<button
					type="button"
					class="session-row"
					class:current={isCurrent}
					disabled={isCurrent || !canAutomate || session.optimistic}
					title={isCurrent
						? 'Sessione attiva'
						: session.optimistic
							? 'La sessione sta entrando nello storico'
							: canAutomate
								? `Riprendi: ${session.title}`
								: automationReason}
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
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-bottom: var(--space-2);
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