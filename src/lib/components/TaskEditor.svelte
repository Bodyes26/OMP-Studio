<script lang="ts">
	import { onDestroy } from 'svelte';
	import { taskStore, type StudioTask } from '$lib/stores/tasks.svelte';

	let { task, onClose }: { task: StudioTask; onClose: () => void } = $props();
	let prompt = $state('');
	let loadedTaskId = $state('');
	let deleteArmed = $state(false);
	let deleteTimer: number | null = null;
	const title = $derived(prompt.split(/\r?\n/).find((line) => line.trim())?.trim() || 'Nuovo task');

	$effect(() => {
		if (task.id !== loadedTaskId) {
			loadedTaskId = task.id;
			prompt = task.prompt;
			deleteArmed = false;
		}
	});

	function updatePrompt() {
		taskStore.updatePrompt(task.id, prompt);
	}

	function closeEditor() {
		if (!prompt.trim()) taskStore.deleteTask(task.id);
		onClose();
	}

	function requestDelete() {
		if (deleteArmed) {
			taskStore.deleteTask(task.id);
			onClose();
			return;
		}
		deleteArmed = true;
		if (deleteTimer !== null) window.clearTimeout(deleteTimer);
		deleteTimer = window.setTimeout(() => deleteArmed = false, 4000);
	}

	onDestroy(() => {
		if (deleteTimer !== null) window.clearTimeout(deleteTimer);
	});
</script>

<div class="task-editor">
	<header class="task-toolbar">
		<div class="task-heading">
			<span class="task-title" title={title}>{title}</span>
		</div>
		<div class="task-actions">
			<span class="save-state" aria-live="polite">Salvato automaticamente</span>
			<button
				type="button"
				class:confirm-delete={deleteArmed}
				onclick={requestDelete}
				aria-label={deleteArmed ? 'Conferma eliminazione task' : 'Elimina task'}
				title={deleteArmed ? 'Clicca ancora per eliminare' : 'Elimina task'}
			>
				{#if deleteArmed}
					Conferma elimina
				{:else}
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M3 4.5h10M6 2.5h4l.7 2H5.3l.7-2ZM5 6.5v6M8 6.5v6M11 6.5v6M4.5 4.5l.6 9h5.8l.6-9" />
					</svg>
				{/if}
			</button>
			<button type="button" onclick={closeEditor} aria-label="Chiudi editor task" title="Chiudi">
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M4 4l8 8M12 4l-8 8" />
				</svg>
			</button>
		</div>
	</header>

	<div class="prompt-area">
		<label for="task-prompt">Prompt del task</label>
		<textarea
			id="task-prompt"
			bind:value={prompt}
			oninput={updatePrompt}
			placeholder="Scrivi il prossimo prompt per questo progetto..."
			spellcheck="true"
		></textarea>
	</div>
</div>

<style>
	.task-editor {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		background: var(--bg-sunken);
	}

	.task-toolbar {
		height: 36px;
		padding: 0 var(--space-2) 0 var(--space-3);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		background: var(--bg-raised);
	}

	.task-heading,
	.task-actions {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.task-heading {
		gap: var(--space-2);
	}

	.task-actions {
		gap: var(--space-1);
	}


	.task-title {
		max-width: 42ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.save-state {
		margin-right: var(--space-1);
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.task-actions button {
		height: 26px;
		min-width: 26px;
		padding: 0 var(--space-2);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.task-actions button:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.task-actions button:active {
		background: var(--bg-active);
	}

	.task-actions button.confirm-delete {
		background: var(--brand-dim);
		color: var(--ink);
	}

	.task-actions svg {
		width: 13px;
		height: 13px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.prompt-area {
		flex: 1;
		min-height: 0;
		padding: var(--space-3);
	}

	.prompt-area label {
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

	textarea {
		width: 100%;
		height: 100%;
		min-height: 0;
		padding: var(--space-3);
		resize: none;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-base);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-base);
		line-height: 1.55;
		caret-color: var(--brand-ink);
	}

	textarea::placeholder {
		color: var(--ink-faint);
	}

	textarea:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
		border-color: transparent;
	}

	@media (max-width: 900px) {
		.save-state {
			display: none;
		}
	}
</style>
