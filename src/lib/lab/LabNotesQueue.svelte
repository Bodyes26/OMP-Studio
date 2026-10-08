<script lang="ts">
	// Coda delle note visive nel composer della corsia Laboratorio (Gate R3X-lab-indica).
	// Un chip per nota (numero, elemento, nota); un clic apre la nota per
	// modificarla e mostra il blocco esatto che ricevera' l'agente.
	// Componente proprio: ComposerPinnedItem e' il pulsante dei comandi fissati.

	import { m } from '$lib/paraglide/messages.js';
	import { IconClose, IconWarning, IconInspect } from '$lib/icons';
	import type { LabVisualNotes } from './visualNotesStore.svelte';
	import { formatLabNote, shortTargetLabel, type LabNote } from './visualNotes';
	import { labNotesLabels } from './visualNotesLabels';

	let { notes } = $props<{ notes: LabVisualNotes }>();

	let openId = $state<string | null>(null);
	const openNote = $derived(notes.notes.find((n: LabNote) => n.id === openId) ?? null);
	const labels = labNotesLabels();

	function chipLabel(note: LabNote): string {
		if (note.kind === 'area') return m.lab_note_area_label({ count: String(note.total ?? note.targets.length) });
		if (note.targets.length > 1) return m.lab_note_elements_label({ count: String(note.targets.length) });
		return note.targets[0] ? shortTargetLabel(note.targets[0]) : '';
	}

	function toggle(note: LabNote): void {
		openId = openId === note.id ? null : note.id;
		notes.activeId = openId;
	}

	const warningText = $derived.by(() => {
		const w = notes.frame?.warnings ?? [];
		const parts: string[] = [];
		if (w.includes('images')) parts.push(m.lab_notes_frame_warn_images());
		if (w.includes('fonts')) parts.push(m.lab_notes_frame_warn_fonts());
		if (w.includes('media')) parts.push(m.lab_notes_frame_warn_media());
		return parts.join('; ');
	});
</script>

<section class="vn-queue" aria-label={m.lab_notes_aria()}>
	<header class="vn-head">
		<span class="vn-icon" aria-hidden="true"><IconInspect /></span>
		<span class="vn-title">{m.lab_notes_title({ count: String(notes.notes.length) })}</span>
		<span
			class="vn-frame"
			class:is-failed={notes.captureStatus === 'failed'}
			title={warningText || notes.captureError || undefined}
		>
			{#if notes.captureStatus === 'pending'}
				{m.lab_notes_frame_pending()}
			{:else if notes.captureStatus === 'failed'}
				<IconWarning />
				{m.lab_notes_frame_failed()}
			{:else if notes.captureStatus === 'ok'}
				{m.lab_notes_frame_ready()}{#if warningText}<span class="vn-warn"> · {warningText}</span>{/if}
			{/if}
		</span>
		<button type="button" class="vn-clear" onclick={() => notes.clear()}>{m.lab_notes_clear()}</button>
	</header>

	<div class="vn-strip" role="list">
		{#each notes.notes as note (note.id)}
			<div
				class="vn-chip"
				class:is-open={openId === note.id}
				class:is-stale={note.stale}
				role="listitem"
			>
				<button
					type="button"
					class="vn-chip-main"
					onclick={() => toggle(note)}
					aria-expanded={openId === note.id}
					title={note.stale ? m.lab_note_stale() : undefined}
				>
					<span class="vn-num" class:is-stale={note.stale}>{note.n}</span>
					<span class="vn-body">
						<span class="vn-label">{chipLabel(note)}</span>
						<span class="vn-text" class:is-empty={!note.text.trim()}>
							{note.text.trim() || m.lab_notes_empty_note()}
						</span>
					</span>
				</button>
				<button
					type="button"
					class="vn-x"
					aria-label={m.lab_notes_remove_aria({ n: String(note.n) })}
					onclick={() => {
						if (openId === note.id) openId = null;
						notes.remove(note.id);
					}}
				>
					<IconClose />
				</button>
			</div>
		{/each}
	</div>

	{#if openNote}
		<div class="vn-detail">
			{#if openNote.stale}
				<p class="vn-stale"><IconWarning /> {m.lab_note_stale()}</p>
			{/if}
			<textarea
				class="vn-input"
				rows="2"
				placeholder={m.lab_note_placeholder()}
				value={openNote.text}
				oninput={(e) => notes.setText(openNote.id, e.currentTarget.value)}
				onkeydown={(e) => {
					if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
						e.preventDefault();
						e.stopPropagation();
						openId = null;
					}
				}}
			></textarea>
			<div class="vn-preview-title">{m.lab_notes_agent_preview()}</div>
			<pre class="vn-preview">{formatLabNote(openNote, labels)}</pre>
		</div>
	{/if}
</section>

<style>
	.vn-queue {
		margin: 8px 10px 0;
		border-bottom: 1px solid var(--line);
		padding-bottom: 6px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.vn-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 22px;
		padding: 0 4px;
		--icon-size: 13px;
	}

	.vn-icon {
		display: inline-flex;
		color: var(--brand-ink);
	}

	.vn-title {
		color: var(--ink);
		font-weight: 500;
	}

	.vn-frame {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex: 1;
		min-width: 0;
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		--icon-size: 12px;
	}

	.vn-frame.is-failed {
		color: var(--warn);
	}

	.vn-warn {
		color: var(--warn);
	}

	.vn-clear {
		border: 0;
		background: transparent;
		color: var(--ink-faint);
		font: inherit;
		cursor: pointer;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.vn-clear:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.vn-strip {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		padding: 8px 2px 2px 6px;
	}

	.vn-chip {
		flex: none;
		position: relative;
		display: flex;
		align-items: center;
		max-width: 240px;
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
	}

	.vn-chip:hover {
		border-color: var(--line-strong);
	}

	.vn-chip.is-open {
		border-color: color-mix(in oklch, var(--brand) 55%, transparent);
	}

	.vn-chip.is-stale {
		border-color: color-mix(in oklch, var(--warn) 45%, transparent);
	}

	.vn-chip-main {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		padding: 3px 2px 3px 14px;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.vn-num {
		position: absolute;
		left: -5px;
		top: -6px;
		min-width: 18px;
		height: 18px;
		padding: 0 4px;
		border-radius: 9px;
		background: var(--brand);
		color: var(--bg-sunken);
		font-size: 10.5px;
		font-weight: 700;
		line-height: 18px;
		text-align: center;
	}

	.vn-num.is-stale {
		background: var(--warn);
	}

	.vn-body {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.vn-label {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--brand-ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.vn-text {
		max-width: 170px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--ink-muted);
	}

	.vn-text.is-empty {
		color: var(--ink-faint);
		font-style: italic;
	}

	.vn-x {
		display: inline-flex;
		align-items: center;
		border: 0;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		padding: 0 4px;
		align-self: stretch;
		--icon-size: 12px;
	}

	.vn-x:hover {
		color: var(--ink);
	}

	.vn-detail {
		margin: 8px 4px 2px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.vn-stale {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		color: var(--warn);
		--icon-size: 12px;
	}

	.vn-input {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		min-height: 40px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font: 13px/1.45 inherit;
		font-family: inherit;
		padding: 6px 8px;
		outline: none;
	}

	.vn-input:focus {
		border-color: color-mix(in oklch, var(--brand) 55%, transparent);
	}

	.vn-preview-title {
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.vn-preview {
		margin: 0;
		max-height: 140px;
		overflow: auto;
		padding: 6px 8px;
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		font: 11px/1.5 var(--font-mono);
		color: var(--ink-muted);
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>
