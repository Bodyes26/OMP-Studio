<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { projectStore, normalizeProjectPath } from '$lib/stores/projects.svelte';

	let { open = false, onClose } = $props<{ open?: boolean; onClose?: () => void }>();

	interface Candidate {
		name: string;
		path: string;
	}

	let candidates = $state<Candidate[]>([]);
	let error = $state<string | null>(null);
	let query = $state('');
	let index = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return q ? candidates.filter(c => c.name.toLowerCase().includes(q)) : candidates;
	});

	// L'ultima riga selezionabile e' «Sfoglia cartella…», quindi l'estremo
	// superiore dell'indice e' incluso. Il clamp vive in un effetto: scrivere
	// stato dentro un $derived e' vietato in Svelte 5.
	$effect(() => {
		if (index > filtered.length) index = filtered.length;
		else if (index < 0) index = 0;
	});

	const openKeys = $derived(
		new Set(projectStore.projects.filter(p => p.path).map(p => p.path.toLowerCase()))
	);

	async function loadCandidates() {
		error = null;
		try {
			const entries = await invoke<{ name: string; path: string; is_dir: boolean }[]>(
				'tree_read',
				{ projectPath: projectStore.projectRoot, rel: '' }
			);
			candidates = entries
				.filter(e => e.is_dir && !e.name.startsWith('.'))
				.map(e => ({
					name: e.name,
					path: normalizeProjectPath(`${projectStore.projectRoot}\\${e.name}`)
				}));
		} catch (e) {
			candidates = [];
			error = String(e);
		}
	}

	$effect(() => {
		if (!open) return;
		query = '';
		index = 0;
		loadCandidates();
		inputEl?.focus();
	});

	function pick(i: number) {
		if (i < filtered.length) {
			projectStore.openProject(filtered[i].path);
			onClose?.();
		} else {
			browse();
		}
	}

	async function browse() {
		const sel = await openDialog({ directory: true, defaultPath: projectStore.projectRoot });
		if (typeof sel === 'string') {
			projectStore.openProject(sel);
			onClose?.();
		}
	}

	function onKeydown(e: KeyboardEvent) {
		const last = filtered.length; // indice della voce «Sfoglia cartella…»
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			index = index >= last ? 0 : index + 1;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			index = index <= 0 ? last : index - 1;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			pick(index);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onClose?.();
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="backdrop" onclick={() => onClose?.()}></div>
	<div class="palette">
		<input
			bind:this={inputEl}
			bind:value={query}
			onkeydown={onKeydown}
			placeholder="Cerca una cartella in {projectStore.projectRoot}"
			spellcheck="false"
		/>
		<div class="rows">
			{#if error}
				<div class="error">Impossibile leggere {projectStore.projectRoot}: {error}</div>
			{/if}
			{#each filtered as c, i (c.path)}
				<button
					class="row"
					class:sel={i === index}
					onmouseenter={() => index = i}
					onclick={() => pick(i)}
				>
					<span class="name">{c.name}</span>
					{#if openKeys.has(c.path.toLowerCase())}
						<span class="badge">già aperto</span>
					{/if}
					<span class="path">{c.path}</span>
				</button>
			{/each}
			<button
				class="row browse"
				class:sel={index === filtered.length}
				onmouseenter={() => index = filtered.length}
				onclick={() => browse()}
			>
				<span class="name">Sfoglia cartella…</span>
			</button>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-backdrop);
	}

	.palette {
		position: fixed;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
		width: 520px;
		max-height: calc(100vh - 120px);
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-dialog);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		color: var(--ink);
	}

	input {
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--line);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-md);
		padding: var(--space-3) var(--space-4);
		outline: none;
	}

	.rows {
		overflow-y: auto;
		padding: var(--space-1);
		display: flex;
		flex-direction: column;
	}

	.row {
		background: transparent;
		border: none;
		color: var(--ink);
		text-align: left;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.row.sel {
		background: var(--bg-hover);
	}

	.name {
		flex: 0 0 auto;
	}

	.badge {
		flex: 0 0 auto;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		padding: 0 6px;
	}

	.path {
		flex: 1 1 auto;
		text-align: right;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.error {
		padding: var(--space-2);
		font-size: var(--text-sm);
		color: var(--warn);
	}
</style>
