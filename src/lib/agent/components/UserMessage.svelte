<script lang="ts">
	// Messaggio dell'utente nel transcript.
	// Evidenziato come blocco utente con indicatore 'Tu' / badge di attribuzione,
	// superficie `--bg-raised`, bordo discreto e MarkdownInline.
	import { agentUiHooks } from '../ui-context';
	import { lexMarkdownInline } from '../markdown';
	import type { UserEntry } from '../session.svelte';
	import MarkdownInline from './MarkdownInline.svelte';
	import { splitMessageAndEditorContext } from '$lib/editor/editorContext';
	import { baseName } from '../tools/types';
	import { IconChevronRight, IconClose, IconFile } from '$lib/icons';

	let { entry }: { entry: UserEntry } = $props();

	const hooks = agentUiHooks();
	const isNonStandardAttribution = $derived(
		Boolean(entry.attribution && entry.attribution !== 'user')
	);
	const attributionLabel = $derived(
		isNonStandardAttribution ? entry.attribution : 'Tu'
	);

	const parsed = $derived(
		entry.content
			? splitMessageAndEditorContext(entry.content)
			: { userMessage: '', context: null, rawContext: null }
	);

	const displayMessage = $derived(
		parsed.userMessage || (!parsed.context ? entry.content : '')
	);

	const inlineTokens = $derived(
		displayMessage ? lexMarkdownInline(displayMessage) : []
	);

	let showSelectionCode = $state(false);

	const allContextFiles = $derived.by(() => {
		if (!parsed.context) return [];
		const list: string[] = [];
		if (parsed.context.activeFile) {
			list.push(parsed.context.activeFile);
		}
		for (const f of parsed.context.openFiles) {
			if (!list.includes(f)) {
				list.push(f);
			}
		}
		if (parsed.context.selection && !list.includes(parsed.context.selection.file)) {
			list.push(parsed.context.selection.file);
		}
		return list;
	});
</script>

<div class="user-message">
	<div class="user-header">
		<span class="user-badge" class:custom-badge={isNonStandardAttribution}>
			<span class="user-glyph" aria-hidden="true"><IconChevronRight /></span>
			<span class="user-label">{attributionLabel}</span>
		</span>
	</div>

	{#if entry.images && entry.images.length > 0}
		<div class="images-strip">
			{#each entry.images as img, i (i)}
				<button
					type="button"
					class="image-chip"
					onclick={() => hooks.openImage(img.data, img.mimeType)}
					title="Apri immagine allegata"
				>
					<img src={`data:${img.mimeType};base64,${img.data}`} alt="Allegato utente" />
				</button>
			{/each}
		</div>
	{/if}
	{#if displayMessage}
		<div class="content">
			<MarkdownInline tokens={inlineTokens} />
		</div>
	{/if}

	{#if parsed.context}
		<div class="editor-context" role="region" aria-label="File aperti nell'editor inclusi nel contesto">
			<div class="context-chips-row">
				<span class="context-tag" title="File aperti nell'editor inclusi nel contesto del prompt">
					<svg class="context-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9 1.5z" />
						<polyline points="9 1.5 9 5.5 13 5.5" />
					</svg>
					<span class="context-tag-text">Editor</span>
				</span>

				{#each allContextFiles as file (file)}
					{@const isActive = file === parsed.context.activeFile}
					{@const isSelected = parsed.context.selection && parsed.context.selection.file === file}
					{@const targetLine = isSelected ? (parsed.context.selection?.startLine ?? null) : (isActive && parsed.context.cursor ? parsed.context.cursor.line : null)}
					<div class="file-chip-wrap" class:active-file={isActive} class:selected-file={isSelected}>
						<button
							type="button"
							class="file-chip"
							title={`${file}${targetLine ? `:${targetLine}` : ''} • Clicca per aprire nell'editor`}
							onclick={() => hooks.openFile(file, targetLine)}
						>
							<span class="file-glyph"><IconFile aria-hidden="true" /></span>
							<span class="file-name">{baseName(file)}</span>
							{#if isSelected}
								<span class="chip-badge selection-badge" title="Selezione attiva inclusa">
									{parsed.context.selection?.lineRange}
								</span>
							{:else if isActive && parsed.context.cursor}
								<span class="chip-badge cursor-badge" title={`Cursore riga ${parsed.context.cursor.line}`}>
									:{parsed.context.cursor.line}
								</span>
							{:else if isActive}
								<span class="chip-badge active-badge" title="File attivo nell'editor">
									attivo
								</span>
							{/if}
						</button>

						{#if isSelected}
							<button
								type="button"
								class="snippet-toggle-btn"
								class:open={showSelectionCode}
								onclick={() => (showSelectionCode = !showSelectionCode)}
								title={showSelectionCode ? 'Nascondi codice selezionato' : 'Visualizza codice selezionato'}
								aria-expanded={showSelectionCode}
								aria-label="Mostra o nascondi codice selezionato"
							>
								<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<polyline points={showSelectionCode ? '4 10 8 6 12 10' : '4 6 8 10 12 6'} />
								</svg>
								<span>{showSelectionCode ? 'Nascondi' : 'Codice'}</span>
							</button>
						{/if}
					</div>
				{/each}
			</div>

			{#if parsed.context.selection && showSelectionCode}
				<div class="snippet-preview" role="region" aria-label="Codice selezionato allegato">
					<div class="snippet-header">
						<span class="snippet-title">
							<code>{parsed.context.selection.file}</code> ({parsed.context.selection.lineRange})
						</span>
						<button
							type="button"
							class="snippet-close"
							onclick={() => (showSelectionCode = false)}
							title="Chiudi visualizzazione codice"
						>
							<IconClose aria-hidden="true" />
						</button>
					</div>
					<pre class="snippet-code"><code>{parsed.context.selection.text}</code></pre>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.user-message {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		width: 100%;
		align-items: flex-start;
		text-align: left;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.user-message:hover {
		border-color: var(--line-strong);
	}

	.user-header {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		user-select: none;
	}

	.user-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: var(--bg-hover);
		padding: 1px var(--space-2);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		line-height: 1.3;
	}

	.user-badge.custom-badge {
		color: var(--ink-faint);
		text-transform: lowercase;
	}

	.user-glyph {
		--icon-size: 12px;
		color: var(--brand-ink);
		font-weight: 600;
		font-size: var(--text-xs);
		line-height: 1;
	}

	.user-label {
		font-weight: 500;
	}
	.images-strip {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-1);
	}

	.image-chip {
		width: 48px;
		height: 48px;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		cursor: pointer;
		overflow: hidden;
		flex-shrink: 0;
	}

	.image-chip:hover {
		border-color: var(--line-strong);
	}

	.image-chip img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.content {
		font-family: var(--font-ui);
		font-size: var(--text-base);
		line-height: 1.5;
		color: var(--ink);
		white-space: pre-wrap;
		word-break: break-word;
		user-select: text;
	}

	.editor-context {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-1);
		width: 100%;
	}

	.context-chips-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.context-tag {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		user-select: none;
	}

	.context-icon {
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.file-chip-wrap {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px 3px 1px var(--space-2);
		transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
	}

	.file-chip-wrap:hover {
		border-color: var(--line-strong);
	}

	.file-chip-wrap.active-file {
		border-color: var(--line-strong);
		background: color-mix(in oklab, var(--bg-sunken) 85%, var(--bg-base));
	}

	.file-chip-wrap.selected-file {
		border-color: color-mix(in srgb, var(--brand) 35%, var(--line));
	}

	.file-chip {
		background: transparent;
		border: none;
		padding: 2px 4px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		border-radius: var(--radius-sm);
		text-align: left;
		transition: color var(--dur-fast) var(--ease-out);
	}

	.file-chip:hover {
		color: var(--brand-ink);
	}

	.file-glyph {
		--icon-size: 11px;
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.file-name {
		font-weight: 500;
	}

	.chip-badge {
		font-size: 10px;
		padding: 0 4px;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		line-height: 1.4;
		white-space: nowrap;
	}

	.active-badge {
		background: var(--bg-hover);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.cursor-badge {
		background: var(--bg-hover);
		color: var(--ink-muted);
	}

	.selection-badge {
		background: color-mix(in srgb, var(--brand) 15%, transparent);
		color: var(--brand-ink);
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
		font-weight: 500;
	}

	.snippet-toggle-btn {
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		padding: 1px 5px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		transition: all var(--dur-fast) var(--ease-out);
		line-height: 1.3;
	}

	.snippet-toggle-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.snippet-toggle-btn.open {
		background: var(--bg-active);
		color: var(--brand-ink);
		border-color: var(--line-strong);
	}

	.snippet-preview {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		overflow: hidden;
		margin-top: var(--space-1);
		width: 100%;
	}

	.snippet-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-hover);
		border-bottom: 1px solid var(--line);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.snippet-title code {
		color: var(--ink);
		font-weight: 600;
	}

	.snippet-code {
		margin: 0;
		padding: var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.45;
		color: var(--ink);
		overflow-x: auto;
		max-height: 240px;
		white-space: pre;
	}

	.snippet-close {
		--icon-size: 12px;
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		font-size: 11px;
		padding: 2px 4px;
		border-radius: var(--radius-sm);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.snippet-close:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}
</style>
