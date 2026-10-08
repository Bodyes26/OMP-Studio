<script lang="ts">
	// Scheda «Progetto» del pannello Agente (Gate R3X-diario, variante A).
	//
	// Il diario e i documenti li mantiene l'agente da solo (tool `project_docs`):
	// qui si guardano, si aprono nell'editor per correggerli a mano e si
	// interrogano. Nessuna proposta da approvare, nessun pulsante per
	// scrivere: l'unico gesto che parte dall'agente e' l'inizializzazione.
	import { m } from '$lib/paraglide/messages.js';
	import { IconFile, IconHistory, IconNote, IconRefresh, IconSend } from '$lib/icons';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { chatReveal } from '$lib/agent/motion';
	import { projectDocsStore } from '$lib/projectDocs/projectDocsStore.svelte';
	import { PROMPT_LINE_TOKENS, isDefaultDoc, latestEntries, type DocRole } from '$lib/projectDocs/projectDocs';

	let {
		projectPath,
		agentBusy = false,
		onOpenFile,
		onInitJournal
	}: {
		projectPath: string;
		/** L'agente del progetto sta lavorando: a fine lavoro si rilegge. */
		agentBusy?: boolean;
		onOpenFile: (relPath: string) => void;
		onInitJournal: (storage: 'repo' | 'local') => void;
	} = $props();

	const view = $derived(projectDocsStore.view(projectPath));
	const ask = $derived(projectDocsStore.ask(projectPath));
	const recent = $derived(latestEntries(view.entries, 5));
	const docTokens = $derived(projectDocsStore.documentTokens(projectPath));

	const ROLE_LABEL: Record<DocRole, () => string> = {
		scopo: () => m.project_docs_role_scopo(),
		uso: () => m.project_docs_role_uso(),
		decisioni: () => m.project_docs_role_decisioni(),
		storia: () => m.project_docs_role_storia(),
		'domande-aperte': () => m.project_docs_role_domande()
	};

	// Rilettura all'apertura della scheda e ogni volta che l'agente finisce:
	// e' li' che di solito aggiorna diario e documenti.
	let wasBusy = false;
	$effect(() => {
		const busy = agentBusy;
		if (!busy && (wasBusy || !projectDocsStore.views[projectPath])) void projectDocsStore.load(projectPath);
		wasBusy = busy;
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		void projectDocsStore.submitQuestion(projectPath);
	}

	function location(): string {
		const manifest = view.manifest;
		if (!manifest) return '';
		return manifest.storage === 'local' ? m.project_docs_storage_local() : m.project_docs_storage_repo();
	}
</script>

<div class="project-docs">
	{#if view.status === 'none'}
		<div class="pd-empty" in:chatReveal>
			<span class="pd-empty-icon" aria-hidden="true"><IconNote /></span>
			<p class="pd-empty-title">{m.project_docs_empty_title()}</p>
			<p class="pd-empty-body">{m.project_docs_empty_body()}</p>
			<button type="button" class="ui-button ui-button-primary" onclick={() => onInitJournal('repo')}>
				<IconHistory />
				{m.project_docs_init_btn()}
			</button>
			<button type="button" class="ui-button ui-button-ghost pd-local" onclick={() => onInitJournal('local')}>
				{m.project_docs_init_local_btn()}
			</button>
			<p class="pd-hint">{m.project_docs_init_hint()}</p>
		</div>
	{:else if view.status === 'error'}
		<div class="pd-error" role="alert">{m.project_docs_error({ error: view.error ?? '' })}</div>
	{:else if view.status === 'loading'}
		<div class="pd-loading" role="status">
			<StatusMark status="running" active />
			<span class="text-shimmer">{m.project_docs_loading()}</span>
		</div>
	{:else}
		<form class="pd-ask" onsubmit={submit}>
			<input
				class="ui-input pd-ask-input"
				type="text"
				placeholder={m.project_docs_ask_placeholder()}
				aria-label={m.project_docs_ask_placeholder()}
				value={ask.question}
				oninput={(e) => projectDocsStore.setQuestion(projectPath, (e.currentTarget as HTMLInputElement).value)}
				disabled={ask.busy}
			/>
			<Tooltip text={m.project_docs_ask_send()} placement="top">
				<button type="submit" class="pd-ask-send" aria-label={m.project_docs_ask_send()} disabled={ask.busy || !ask.question.trim()}>
					<IconSend />
				</button>
			</Tooltip>
		</form>
		<div role="status" aria-live="polite">
			{#if ask.busy}
				<div class="pd-trace">
					<StatusMark status="running" active />
					<span class="text-shimmer">{m.project_docs_ask_busy()}</span>
				</div>
			{:else if ask.answer}
				<div class="pd-answer" in:chatReveal>
					<p class="pd-answer-text">{ask.answer}</p>
					<p class="pd-answer-note">{m.project_docs_ask_note()}</p>
				</div>
			{:else if ask.error}
				<div class="pd-answer pd-answer-error">{ask.error === 'empty' ? m.project_docs_ask_empty() : ask.error}</div>
			{/if}
		</div>

		<div class="pd-section-title">
			<span>{m.project_docs_docs_heading()}</span>
			<span class="pd-count">{view.docs.length}</span>
			<span class="pd-where">{location()}</span>
			<Tooltip text={m.project_docs_refresh()} placement="top">
				<button type="button" class="pd-icon-btn" aria-label={m.project_docs_refresh()} onclick={() => void projectDocsStore.load(projectPath)}>
					<IconRefresh />
				</button>
			</Tooltip>
		</div>
		<ul class="pd-docs">
			{#each view.docs as doc (doc.role)}
				{@const mapped = view.manifest ? !isDefaultDoc(view.manifest, doc.role) : false}
				<li>
					<Tooltip text={mapped ? m.project_docs_mapped_title({ path: doc.rel }) : doc.rel} placement="right-start">
						<button type="button" class="pd-doc-row" disabled={!doc.exists} onclick={() => onOpenFile(doc.rel)}>
							<IconFile />
							<span class="pd-doc-name">{ROLE_LABEL[doc.role]()}</span>
							{#if mapped}<span class="pd-doc-map">{doc.rel.slice(doc.rel.lastIndexOf('/') + 1)}</span>{/if}
							<span class="pd-doc-meta">{doc.exists ? m.project_docs_lines({ count: doc.lines }) : m.project_docs_missing()}</span>
						</button>
					</Tooltip>
				</li>
			{/each}
		</ul>

		<div class="pd-section-title">
			<span>{m.project_docs_diary_heading()}</span>
			<span class="pd-count">{view.entries.length}</span>
			{#if view.diaryRel}
				<button type="button" class="ui-button ui-button-ghost pd-open" onclick={() => view.diaryRel && onOpenFile(view.diaryRel)}>
					{m.project_docs_open()}
				</button>
			{/if}
		</div>
		{#if recent.length === 0}
			<p class="pd-hint">{m.project_docs_no_entries()}</p>
		{:else}
			<ul class="pd-entries">
				{#each recent as entry, i (`${entry.date}-${i}`)}
					<li class="pd-entry">
						<span class="pd-entry-date">{entry.date}</span>
						<span class="pd-entry-text">{entry.text}</span>
						{#if entry.sources.length > 0}
							<span class="pd-entry-sources">
								{#each entry.sources as source (source.label)}
									<span class="pd-source">{source.label}</span>
								{/each}
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<p class="pd-budget">{m.project_docs_budget({ prompt: PROMPT_LINE_TOKENS, docs: docTokens.toLocaleString() })}</p>
		<p class="pd-hint">{m.project_docs_commands_hint()}</p>
	{/if}
</div>

<style>
	.project-docs {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: 0 var(--space-2) var(--space-3);
		min-height: 0;
		overflow-y: auto;
		font-size: var(--text-label);
	}

	.pd-empty {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-1);
		text-align: center;
	}

	.pd-empty-icon {
		--icon-size: 24px;
		color: var(--ink-faint);
		display: flex;
		justify-content: center;
	}

	.pd-empty-title {
		margin: 0;
		color: var(--ink);
		font-weight: 500;
	}

	.pd-empty-body,
	.pd-hint {
		margin: 0;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		line-height: 1.5;
	}

	.pd-empty .ui-button {
		justify-content: center;
		--icon-size: 14px;
	}

	.pd-local {
		font-size: var(--text-xs);
	}

	.pd-error {
		padding: var(--space-2);
		border-radius: var(--radius-md);
		background: var(--danger-dim);
		color: var(--ink);
		font-size: var(--text-xs);
	}

	.pd-loading,
	.pd-trace {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		padding: var(--space-1) 0;
	}

	.pd-ask {
		display: flex;
		gap: var(--space-1);
		align-items: center;
	}

	.pd-ask-input {
		flex: 1;
		min-width: 0;
		height: 28px;
	}

	.pd-ask-send,
	.pd-icon-btn {
		--icon-size: 14px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink-muted);
		cursor: pointer;
	}

	.pd-icon-btn {
		width: 22px;
		height: 22px;
		border: 0;
		--icon-size: 12px;
	}

	.pd-ask-send:hover:not(:disabled),
	.pd-icon-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.pd-ask-send:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.pd-answer {
		padding: var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		color: var(--ink);
		font-size: var(--text-trace);
		line-height: 1.5;
	}

	.pd-answer-text {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.pd-answer-note {
		margin: var(--space-1) 0 0;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}

	.pd-answer-error {
		color: var(--ink-muted);
	}

	.pd-section-title {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin-top: var(--space-2);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-weight: 500;
	}

	.pd-count {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.pd-where {
		margin-left: auto;
		color: var(--ink-faint);
		font-weight: 400;
	}

	.pd-open {
		margin-left: auto;
		height: 22px;
		font-size: var(--text-xs);
	}

	.pd-docs,
	.pd-entries {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.pd-doc-row {
		--icon-size: 13px;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-width: 0;
		padding: 4px var(--space-1);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.pd-doc-row:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	.pd-doc-row:disabled {
		color: var(--ink-faint);
		cursor: default;
	}

	.pd-doc-name {
		flex: none;
	}

	.pd-doc-map {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-faint);
	}

	.pd-doc-meta {
		margin-left: auto;
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.pd-entry {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-1) 0;
		border-bottom: 1px solid var(--line);
		line-height: 1.45;
	}

	.pd-entry:last-child {
		border-bottom: 0;
	}

	.pd-entry-date {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.pd-entry-text {
		color: var(--ink);
		font-size: var(--text-trace);
		overflow-wrap: anywhere;
	}

	.pd-entry-sources {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.pd-source {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-faint);
	}

	.pd-budget {
		margin: var(--space-2) 0 0;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		line-height: 1.5;
	}
</style>
