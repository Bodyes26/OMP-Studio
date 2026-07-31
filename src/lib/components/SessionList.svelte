<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { onMount } from 'svelte';

	let { projectPath } = $props<{ projectPath: string }>();

	let sessions = $state<{id: string, title: string, created_at: number}[]>([]);
	let query = $state('');
	let loading = $state(false);

	async function loadSessions() {
		loading = true;
		try {
			if (query.trim() === '') {
				sessions = await invoke('sessions_list', { projectPath });
			} else {
				sessions = await invoke('sessions_search', { query, projectPath });
			}
		} catch (e) {
			console.error("Failed to load sessions", e);
		} finally {
			loading = false;
		}
	}

	function formatDate(sec: number) {
		const d = new Date(sec * 1000);
		return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
	}

	function handleSearch(e: Event) {
		e.preventDefault();
		loadSessions();
	}

	$effect(() => {
		if (projectPath) {
			loadSessions();
		}
	});
</script>

<div class="session-list">
	<form onsubmit={handleSearch} class="search-form">
		<input type="text" bind:value={query} placeholder="Search history..." class="search-input" />
	</form>

	<div class="list">
		{#if loading}
			<div class="msg">Loading...</div>
		{:else if sessions.length === 0}
			<div class="msg">No sessions found.</div>
		{:else}
			{#each sessions as s}
				<button class="session-card" onclick={() => console.log('Resume', s.id)}>
					<div class="title">{s.title || 'Untitled Session'}</div>
					<div class="meta">{formatDate(s.created_at)}</div>
				</button>
			{/each}
		{/if}
	</div>
</div>

<style>
	.session-list {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--bg-base);
	}

	.search-form {
		padding: var(--space-2);
		border-bottom: 1px solid var(--line);
	}

	.search-input {
		width: 100%;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink);
		padding: 4px 8px;
		border-radius: var(--radius-sm);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
	}

	.search-input:focus {
		outline: 1px solid var(--brand);
		border-color: var(--brand);
	}

	.list {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.msg {
		color: var(--ink-faint);
		font-size: var(--text-sm);
		text-align: center;
		padding: var(--space-4);
	}

	.session-card {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		text-align: left;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.session-card:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.title {
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 500;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		line-height: 1.4;
	}

	.meta {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-family: var(--font-mono);
	}
</style>