<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Messaggio dell'utente nel transcript (Gate R32 - C08).
	// Allineato a destra, bolla --bg-raised con raggio 16px (in basso a destra 6px),
	// max-width 80%, tipografia 15px / 24px.
	// Miniature allegati sopra la bolla, badge cliccabili per @file e /comando,
	// chip contesto editor e cassetto snippet selezione mantenuti e ridisegnati,
	// attribuzione mostrata solo se diversa dall'utente.
	import { agentUiHooks } from '../ui-context';
	import { lexMarkdownInlineWithMentions } from '../markdown';
	import type { UserEntry } from '../session.svelte';
	import MarkdownInline from './MarkdownInline.svelte';
	import { splitMessageAndEditorContext } from '$lib/editor/editorContext';
	import { baseName } from '../tools/types';
	import { IconClose, IconFile } from '$lib/icons';

	let { entry }: { entry: UserEntry } = $props();

	const hooks = agentUiHooks();
	const isNonStandardAttribution = $derived(
		Boolean(entry.attribution && entry.attribution !== 'user')
	);
	const attributionLabel = $derived(
		isNonStandardAttribution ? entry.attribution : ''
	);

	const parsed = $derived(
		entry.content
			? splitMessageAndEditorContext(entry.content)
			: { userMessage: '', context: null, rawContext: null }
	);

	const displayMessage = $derived(
		parsed.userMessage || (!parsed.context ? entry.content : '')
	);

	// Le menzioni @file e i comandi /cmd diventano badge inline.
	const inlineTokens = $derived(
		displayMessage ? lexMarkdownInlineWithMentions(displayMessage) : []
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

<div class="user-message-container">
	{#if isNonStandardAttribution}
		<div class="user-attribution">
			<span class="attribution-badge">{attributionLabel}</span>
		</div>
	{/if}

	{#if entry.images && entry.images.length > 0}
		<div class="images-strip">
			{#each entry.images as img, i (i)}
				<button
					type="button"
					class="image-chip"
					onclick={() => hooks.openImage(img.data, img.mimeType)}
					title={m.user_message_open_image()}
				>
					<img src={`data:${img.mimeType};base64,${img.data}`} alt={m.user_message_attachment_alt()} />
				</button>
			{/each}
		</div>
	{/if}

	<div class="user-bubble rv-lift">
		{#if displayMessage}
			<div class="content">
				<MarkdownInline tokens={inlineTokens} />
			</div>
		{/if}

		{#if parsed.context}
			<div class="editor-context" role="region" aria-label={m.user_message_context_editor_aria()}>
				<div class="context-chips-row">
					<span class="context-tag" title={m.ui_usermessage_file_aperti_nell_editor_inclusi_nel_contesto_75cd()}>
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
								title={m.user_message_open_file_title({ file: `${file}${targetLine ? `:${targetLine}` : ''}` })}
								onclick={() => hooks.openFile(file, targetLine)}
							>
								<span class="file-glyph"><IconFile aria-hidden="true" /></span>
								<span class="file-name">{baseName(file)}</span>
								{#if isSelected}
									<span class="chip-badge selection-badge" title={m.user_message_selection_badge()}>
										{parsed.context.selection?.lineRange}
									</span>
								{:else if isActive && parsed.context.cursor}
									<span class="chip-badge cursor-badge" title={m.user_message_cursor_badge({ line: parsed.context.cursor.line })}>
										:{parsed.context.cursor.line}
									</span>
								{:else if isActive}
									<span class="chip-badge active-badge" title={m.ui_usermessage_file_attivo_nell_editor_7b31()}>
										{m.user_message_active_file_badge()}
									</span>
								{/if}
							</button>

							{#if isSelected}
								<button
									type="button"
									class="snippet-toggle-btn"
									class:open={showSelectionCode}
									onclick={() => (showSelectionCode = !showSelectionCode)}
									title={showSelectionCode ? m.ui_usermessage_nascondi_codice_selezionato_f3bb() : m.user_message_show_selection()}
									aria-expanded={showSelectionCode}
									aria-label={m.ui_usermessage_mostra_o_nascondi_codice_selezionato_47d2()}
								>
									<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<polyline points={showSelectionCode ? '4 10 8 6 12 10' : '4 6 8 10 12 6'} />
									</svg>
									<span>{showSelectionCode ? m.ui_usermessage_nascondi_82ca() : 'Codice'}</span>
								</button>
							{/if}
						</div>
					{/each}
				</div>

				{#if parsed.context.selection && showSelectionCode}
					<div class="snippet-preview" role="region" aria-label={m.user_message_selection_region()}>
						<div class="snippet-header">
							<span class="snippet-title">
								<code>{parsed.context.selection.file}</code> ({parsed.context.selection.lineRange})
							</span>
							<button
								type="button"
								class="snippet-close"
								onclick={() => (showSelectionCode = false)}
								title={m.ui_usermessage_chiudi_visualizzazione_codice_602d()}
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
</div>

<style>
	.user-message-container {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		margin-left: auto;
		max-width: 80%;
		gap: var(--space-2);
		min-width: 0;
	}

	.user-attribution {
		display: flex;
		align-items: center;
		padding-right: var(--space-2);
	}

	.attribution-badge {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		font-family: var(--font-mono);
	}

	.images-strip {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		justify-content: flex-end;
	}

	.image-chip {
		display: inline-block;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		cursor: pointer;
		overflow: hidden;
		line-height: 0;
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.image-chip:hover {
		border-color: var(--line-strong);
	}

	.image-chip img {
		display: block;
		width: 56px;
		height: 56px;
		object-fit: cover;
	}

	.user-bubble {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-2xl) var(--radius-2xl) var(--radius-md) var(--radius-2xl);
		padding: 10px 14px;
		color: var(--ink);
		user-select: text;
		word-break: break-word;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: fit-content;
		min-width: 0;
	}

	.content {
		font-size: var(--text-chat);
		line-height: 24px;
		color: var(--ink);
	}

	.editor-context {
		margin-top: var(--space-1);
		padding-top: var(--space-2);
		border-top: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.context-chips-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
	}

	.context-tag {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 2px 6px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		user-select: none;
	}

	.context-icon {
		opacity: 0.7;
	}

	.context-tag-text {
		font-weight: 500;
	}

	.file-chip-wrap {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px 4px;
		font-size: var(--text-caption);
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.file-chip-wrap:hover {
		border-color: var(--line-strong);
	}

	.file-chip-wrap.active-file {
		border-color: color-mix(in oklch, var(--brand) 40%, var(--line));
	}

	.file-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: transparent;
		border: none;
		padding: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		cursor: pointer;
		text-align: left;
	}

	.file-chip:hover {
		color: var(--ink);
	}

	.file-glyph {
		--icon-size: 11px;
		display: inline-flex;
		align-items: center;
		width: 11px;
		height: 11px;
		opacity: 0.7;
	}

	.file-name {
		font-weight: 500;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip-badge {
		font-size: var(--text-caption);
		padding: 0 3px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--ink-faint);
	}

	.chip-badge.active-badge {
		background: color-mix(in oklch, var(--brand) 15%, transparent);
		color: var(--brand-ink);
	}

	.chip-badge.selection-badge {
		background: color-mix(in oklch, var(--warn) 15%, transparent);
		color: var(--warn);
	}

	.snippet-toggle-btn {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		background: transparent;
		border: none;
		padding: 0 2px;
		font-size: var(--text-caption);
		color: var(--ink-faint);
		cursor: pointer;
		border-radius: var(--radius-sm);
	}
	.snippet-toggle-btn:hover {
		color: var(--ink-muted);
		background: var(--bg-hover);
	}

	.snippet-preview {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-height: 240px;
		overflow: hidden;
	}

	.snippet-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.snippet-title code {
		font-family: var(--font-mono);
		color: var(--brand-ink);
	}

	.snippet-close {
		--icon-size: 12px;
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
	}

	.snippet-close:hover {
		color: var(--ink);
	}

	.snippet-code {
		margin: 0;
		padding: var(--space-1);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.4;
		overflow-x: auto;
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
		color: var(--ink);
		max-height: 180px;
		overflow-y: auto;
	}
</style>
