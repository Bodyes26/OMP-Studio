<!--
  PlanDocCard.svelte (Gate R36).

  Il piano proposto come card nel racconto: titolo, percorso `local://`, una
  sezione per ogni `##`. In revisione ogni sezione si commenta, si modifica o si
  elimina (con annulla); i commenti diventano «Chiedi modifiche» nella scheda di
  approvazione. Dopo la decisione la card resta come documento in sola lettura.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { tick } from 'svelte';
	import { IconClose, IconComment, IconExternalLink, IconPencil, IconPlan, IconTrash, IconUndo } from '$lib/icons';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { lexMarkdown } from '../markdown';
	import { agentUiHooks } from '../ui-context';
	import type { PlanController, PlanDocState } from '../planController.svelte';
	import type { PlanSection } from '../planMode';
	import Markdown from './Markdown.svelte';

	let { plan, doc } = $props<{ plan: PlanController; doc: PlanDocState }>();

	const hooks = agentUiHooks();
	const reviewing = $derived(doc.status === 'review' && plan.review?.docId === doc.id);
	let editing = $state<string | null>(null);
	let editDraft = $state('');
	let commenting = $state<string | null>(null);
	let commentDraft = $state('');

	const statusLabel = $derived.by(() => {
		switch (doc.status) {
			case 'refining':
				return m.plan_doc_status_refining();
			case 'approved':
				return m.plan_doc_status_approved();
			case 'saved':
				return m.plan_doc_status_saved();
			case 'closed':
				return m.plan_doc_status_closed();
			default:
				return null;
		}
	});

	function bodyOf(section: PlanSection): string {
		return doc.bodies[section.id] ?? section.body;
	}

	async function startComment(section: PlanSection) {
		editing = null;
		commenting = section.id;
		commentDraft = '';
		await tick();
		document.getElementById(`plan-cm-${doc.id}-${section.id}`)?.focus();
	}

	function addComment(section: PlanSection) {
		if (!commentDraft.trim()) return;
		plan.addComment(doc.id, section.id, commentDraft);
		commenting = null;
		commentDraft = '';
	}

	async function startEdit(section: PlanSection) {
		commenting = null;
		editing = section.id;
		editDraft = bodyOf(section);
		await tick();
		document.getElementById(`plan-ed-${doc.id}-${section.id}`)?.focus();
	}

	function saveEdit(section: PlanSection) {
		plan.saveSectionBody(doc.id, section.id, editDraft);
		editing = null;
	}

	function openInEditor() {
		if (doc.request.localPath) hooks.openFile(doc.request.localPath);
	}
</script>

<article class="plan-doc" aria-label={doc.request.title}>
	<header class="pd-head">
		<span class="pd-icon" aria-hidden="true"><IconPlan /></span>
		<span class="pd-title">{doc.request.title}</span>
		<span class="pd-path font-mono">{doc.request.planFilePath}</span>
		<span class="pd-spacer"></span>
		{#if reviewing && doc.request.localPath}
			<button type="button" class="ui-button ui-button-secondary pd-open" onclick={openInEditor}>
				<IconExternalLink aria-hidden="true" />
				{m.plan_doc_open_editor()}
			</button>
		{:else if statusLabel}
			<span class="plan-badge" class:ok={doc.status === 'approved' || doc.status === 'saved'}>{statusLabel}</span>
		{/if}
	</header>

	<div class="pd-body">
		{#if doc.doc.sections.length === 0}
			<div class="pd-sec">
				<div class="pd-txt"><Markdown tokens={lexMarkdown(doc.request.content)} /></div>
			</div>
		{/if}
		{#each doc.doc.sections as section (section.id)}
			{@const deleted = doc.deleted.includes(section.id)}
			{@const comments = doc.comments[section.id] ?? []}
			<section
				class="pd-sec"
				class:deleted
				class:sel={reviewing && (editing === section.id || commenting === section.id)}
				class:interactive={reviewing}
			>
				{#if reviewing && editing !== section.id}
					<div class="pd-tools">
						<Tooltip text={m.plan_doc_comment()}>
							<button type="button" class="pd-ib" aria-label={m.plan_doc_comment()} onclick={() => startComment(section)}>
								<IconComment aria-hidden="true" />
							</button>
						</Tooltip>
						<Tooltip text={m.plan_doc_edit()}>
							<button type="button" class="pd-ib" aria-label={m.plan_doc_edit()} onclick={() => startEdit(section)}>
								<IconPencil aria-hidden="true" />
							</button>
						</Tooltip>
						<Tooltip text={deleted ? m.plan_doc_restore() : m.plan_doc_delete()}>
							<button
								type="button"
								class="pd-ib"
								aria-label={deleted ? m.plan_doc_restore() : m.plan_doc_delete()}
								onclick={() => plan.toggleDeleted(doc.id, section.id)}
							>
								{#if deleted}<IconUndo aria-hidden="true" />{:else}<IconTrash aria-hidden="true" />{/if}
							</button>
						</Tooltip>
					</div>
				{/if}
				<h3 class="pd-h">
					{section.heading}
					{#if comments.length > 0}
						<span class="plan-badge warn">{m.plan_doc_comments_count({ count: comments.length })}</span>
					{/if}
					{#if deleted}
						<span class="plan-badge">{m.plan_doc_deleted_badge()}</span>
					{/if}
					{#if doc.bodies[section.id] !== undefined && doc.bodies[section.id] !== section.body}
						<span class="plan-badge">{m.plan_doc_edited_badge()}</span>
					{/if}
				</h3>
				{#if editing === section.id}
					<textarea
						id={`plan-ed-${doc.id}-${section.id}`}
						class="pd-input pd-textarea font-mono"
						bind:value={editDraft}
						onkeydown={(e) => {
							if (e.key === 'Escape') {
								e.stopPropagation();
								editing = null;
							} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
								e.preventDefault();
								e.stopPropagation();
								saveEdit(section);
							}
						}}
					></textarea>
					<div class="pd-row">
						<span class="pd-hint">{m.plan_doc_edit_hint()}</span>
						<button type="button" class="ui-button ui-button-secondary" onclick={() => (editing = null)}>
							{m.plan_doc_cancel()}
						</button>
						<button type="button" class="ui-button ui-button-primary" onclick={() => saveEdit(section)}>
							{m.plan_doc_save()}
						</button>
					</div>
				{:else}
					<div class="pd-txt"><Markdown tokens={lexMarkdown(bodyOf(section))} /></div>
				{/if}
				{#each comments as comment, index (index)}
					<div class="pd-cmt rv-lift" style="--dur: 200ms;">
						<span class="pd-cmt-icon" aria-hidden="true"><IconComment /></span>
						<span class="pd-cmt-text">{comment}</span>
						{#if reviewing}
							<button
								type="button"
								class="pd-cmt-del"
								aria-label={m.plan_doc_comment_remove()}
								onclick={() => plan.removeComment(doc.id, section.id, index)}
							>
								<IconClose aria-hidden="true" />
							</button>
						{/if}
					</div>
				{/each}
				{#if reviewing && commenting === section.id}
					<div class="pd-row">
						<input
							id={`plan-cm-${doc.id}-${section.id}`}
							class="pd-input"
							placeholder={m.plan_doc_comment_placeholder({ section: section.heading })}
							bind:value={commentDraft}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									e.stopPropagation();
									addComment(section);
								} else if (e.key === 'Escape') {
									e.stopPropagation();
									commenting = null;
								}
							}}
						/>
						<button type="button" class="ui-button ui-button-secondary" onclick={() => addComment(section)}>
							{m.plan_doc_comment_add()}
						</button>
					</div>
				{/if}
			</section>
		{/each}
	</div>
</article>

<style>
	.plan-doc {
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-2xl);
		overflow: hidden;
		min-width: 0;
	}
	.pd-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 10px 14px;
		border-bottom: 1px solid var(--line);
		min-width: 0;
		--icon-size: 16px;
	}
	.pd-icon {
		display: inline-flex;
		color: var(--ink-muted);
	}
	.pd-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.pd-path {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		flex-shrink: 1;
	}
	.pd-spacer {
		flex: 1;
	}
	.pd-open {
		--icon-size: 12px;
		padding: 4px 10px;
		white-space: nowrap;
	}
	.pd-body {
		padding: 6px 6px 10px;
	}
	.pd-sec {
		position: relative;
		padding: 8px 10px 8px 12px;
		border-radius: var(--radius-lg);
		border: 1px solid transparent;
	}
	.pd-sec.interactive:hover,
	.pd-sec.interactive:focus-within {
		background: color-mix(in srgb, var(--ink) 4%, transparent);
	}
	.pd-sec.sel {
		border-color: var(--line-strong);
		background: color-mix(in srgb, var(--ink) 4%, transparent);
	}
	.pd-sec.deleted {
		opacity: 0.45;
	}
	.pd-sec.deleted .pd-txt {
		text-decoration: line-through;
	}
	.pd-tools {
		position: absolute;
		top: 6px;
		right: 8px;
		display: none;
		gap: 2px;
	}
	.pd-sec.interactive:hover .pd-tools,
	.pd-sec.interactive:focus-within .pd-tools,
	.pd-sec.sel .pd-tools {
		display: flex;
	}
	.pd-ib {
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: var(--radius-md);
		border: 0;
		background: transparent;
		color: var(--ink-muted);
		cursor: pointer;
	}
	.pd-ib:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}
	.pd-h {
		margin: 0 0 4px;
		font-size: 15px;
		font-weight: 600;
		color: var(--ink);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-right: 90px;
	}
	.pd-txt {
		font-size: 13.5px;
		line-height: 21px;
		color: var(--ink-muted);
		min-width: 0;
	}
	.pd-txt :global(p) {
		margin: 0 0 6px;
	}
	.pd-txt :global(ol),
	.pd-txt :global(ul) {
		margin: 2px 0;
		padding-left: 20px;
	}
	.pd-cmt {
		margin-top: 6px;
		display: flex;
		gap: 6px;
		align-items: flex-start;
		font-size: 12.5px;
		color: var(--ink);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 6px 8px;
		--icon-size: 13px;
	}
	.pd-cmt-icon {
		display: inline-flex;
		color: var(--warn);
		margin-top: 2px;
	}
	.pd-cmt-text {
		flex: 1;
		min-width: 0;
		white-space: pre-wrap;
	}
	.pd-cmt-del {
		margin-left: auto;
		border: 0;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		display: inline-flex;
		padding: 0;
		--icon-size: 12px;
	}
	.pd-cmt-del:hover {
		color: var(--ink);
	}
	.pd-row {
		margin-top: 6px;
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.pd-hint {
		flex: 1;
		font-size: 11.5px;
		color: var(--ink-faint);
	}
	.pd-input {
		flex: 1;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		padding: 6px 8px;
		color: var(--ink);
		font: inherit;
		font-size: 12.5px;
		outline: none;
		min-width: 0;
	}
	.pd-input:focus {
		border-color: var(--brand);
	}
	.pd-textarea {
		display: block;
		width: 100%;
		box-sizing: border-box;
		min-height: 110px;
		font-size: 12px;
		line-height: 18px;
		resize: vertical;
	}
	.plan-badge {
		font-size: 10.5px;
		font-weight: 500;
		padding: 1px 7px;
		border-radius: var(--radius-full);
		border: 1px solid var(--line-strong);
		color: var(--ink-muted);
		white-space: nowrap;
	}
	.plan-badge.warn {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 45%, transparent);
	}
	.plan-badge.ok {
		color: var(--success);
		border-color: color-mix(in srgb, var(--success) 40%, transparent);
	}
</style>
