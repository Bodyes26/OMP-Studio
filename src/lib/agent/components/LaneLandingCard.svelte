<!--
	Tessera chat per le operazioni di atterraggio corsia (Lane Landing).
	Visualizza esiti di integrazione, conflitti, attese di conferma, accodamenti
	e permette l'annullamento (undo) o l'interazione con l'agente.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { LaneLandingEntry } from '../session.svelte';
	import { laneLanding } from '$lib/lanes/laneLanding.svelte';
	import {
		IconCheck,
		IconWarning,
		IconRefresh,
		IconUndo,
		IconGitBranch,
		IconQueue,
		IconChevronRight,
		IconChevronDown,
		IconFile
	} from '$lib/icons';

	let { entry }: { entry: LaneLandingEntry } = $props();

	const record = $derived(laneLanding.records[entry.landingId]);

	let showFiles = $state(false);
	let isAskingAgent = $state(false);
	let isConfirming = $state(false);

	const shortCommit = $derived(
		record?.commit ? record.commit.slice(0, 7) : ''
	);

	async function handleUndo() {
		if (!record || record.isUndoing) return;
		await laneLanding.undo(record.id);
	}

	async function handleConfirm() {
		if (!record || isConfirming) return;
		isConfirming = true;
		try {
			await laneLanding.confirmLanding(record.id);
		} finally {
			isConfirming = false;
		}
	}

	async function handleAskAgent() {
		if (!record || isAskingAgent) return;
		isAskingAgent = true;
		try {
			await laneLanding.askLaneToResolveConflicts(record.projectId, record.laneId);
		} finally {
			isAskingAgent = false;
		}
	}
</script>

{#if record}
	<div
		class="landing-card"
		class:kind-integrated={record.kind === 'integrated'}
		class:kind-undone={record.kind === 'undone'}
		class:kind-conflicts={record.kind === 'conflicts'}
		class:kind-queued={record.kind === 'queued'}
		class:kind-awaiting={record.kind === 'awaiting_confirm'}
		class:kind-error={record.kind === 'error'}
		role="region"
		aria-label="Lane Landing"
	>
		<!-- Header -->
		<div class="card-header">
			<div class="header-left">
				<span class="status-icon" aria-hidden="true">
					{#if record.kind === 'integrated'}
						<IconCheck />
					{:else if record.kind === 'undone'}
						<IconUndo />
					{:else if record.kind === 'conflicts'}
						<IconWarning />
					{:else if record.kind === 'queued'}
						<IconQueue />
					{:else if record.kind === 'awaiting_confirm'}
						<IconWarning />
					{:else if record.kind === 'error'}
						<IconWarning />
					{:else}
						<IconCheck />
					{/if}
				</span>

				<span class="status-title">
					{#if record.kind === 'integrated'}
						{m.lanelanding_card_title_integrated()}
					{:else if record.kind === 'undone'}
						{m.lanelanding_card_title_undone()}
					{:else if record.kind === 'already_integrated'}
						{m.lanelanding_card_title_already_integrated()}
					{:else if record.kind === 'conflicts'}
						{m.lanelanding_card_title_conflicts()}
					{:else if record.kind === 'queued'}
						{m.lanelanding_card_title_queued()}
					{:else if record.kind === 'awaiting_confirm'}
						{m.lanelanding_card_title_awaiting_confirm()}
					{:else if record.kind === 'error'}
						{m.lanelanding_card_title_error()}
					{:else if record.kind === 'nothing'}
						{m.lanelanding_card_title_nothing()}
					{/if}
				</span>
			</div>

			<div class="header-right">
				<span class="badge badge-lane" title={`Corsia: ${record.laneTitle}`}>
					<IconGitBranch />
					<span>{record.laneTitle}</span>
				</span>
				{#if record.targetBranch}
					<span class="badge badge-target" title={`Target: ${record.targetBranch}`}>
						<span>&rarr; {record.targetBranch}</span>
					</span>
				{/if}
			</div>
		</div>

		<!-- Body per stato -->
		<div class="card-body">
			{#if record.kind === 'integrated'}
				<div class="summary-row">
					{#if shortCommit}
						<span class="meta-pill">
							<code>{shortCommit}</code>
						</span>
					{/if}
					{#if record.files && record.files.length > 0}
						<button
							type="button"
							class="files-toggle-btn"
							onclick={() => (showFiles = !showFiles)}
						>
							{#if showFiles}
								<IconChevronDown />
							{:else}
								<IconChevronRight />
							{/if}
							<span>{m.lanelanding_files_changed({ count: record.files.length })}</span>
						</button>
					{/if}
				</div>

				{#if showFiles && record.files && record.files.length > 0}
					<ul class="file-list" role="list">
						{#each record.files as file}
							<li class="file-item">
								<IconFile />
								<span>{file}</span>
							</li>
						{/each}
					</ul>
				{/if}

				<div class="card-actions">
					<button
						type="button"
						class="btn-undo"
						disabled={record.isUndoing}
						onclick={handleUndo}
					>
						{#if record.isUndoing}
							<span class="btn-spinner"><IconRefresh /></span>
							<span>{m.lanelanding_undoing()}</span>
						{:else}
							<IconUndo />
							<span>{m.lanelanding_undo()}</span>
						{/if}
					</button>
				</div>

				{#if record.undoError}
					<div class="undo-error" role="alert">
						<IconWarning />
						<span>{record.undoError}</span>
						{#if record.undoDetail}
							<small class="detail-text">{record.undoDetail}</small>
						{/if}
					</div>
				{/if}

			{:else if record.kind === 'undone'}
				<div class="undone-content">
					<p class="undone-msg">
						{m.lanelanding_undone_branch({ branch: record.restoredBranch ?? '' })}
					</p>
				</div>

			{:else if record.kind === 'conflicts'}
				<div class="conflicts-content">
					{#if record.files && record.files.length > 0}
						<div class="conflicts-summary">
							<span class="conflict-badge">
								{m.lanelanding_conflict_files({ count: record.files.length })}
							</span>
						</div>
						<ul class="file-list conflicts" role="list">
							{#each record.files as file}
								<li class="file-item conflict">
									<IconFile />
									<span>{file}</span>
								</li>
							{/each}
						</ul>
					{/if}

					<div class="card-actions">
						<button
							type="button"
							class="btn-action"
							disabled={isAskingAgent}
							onclick={handleAskAgent}
						>
							{#if isAskingAgent}
								<span class="btn-spinner"><IconRefresh /></span>
							{/if}
							<span>{m.lanelanding_ask_agent()}</span>
						</button>
					</div>
				</div>

			{:else if record.kind === 'awaiting_confirm'}
				<div class="awaiting-content">
					<p class="awaiting-text">
						La corsia ha avuto conflitti in precedenza ed e' in attesa di conferma utente per completare l'integrazione.
					</p>
					<div class="card-actions">
						<button
							type="button"
							class="btn-confirm"
							disabled={isConfirming}
							onclick={handleConfirm}
						>
							{#if isConfirming}
								<span class="btn-spinner"><IconRefresh /></span>
							{/if}
							<span>{m.lanelanding_confirm()}</span>
						</button>
					</div>
				</div>

			{:else if record.kind === 'queued'}
				<div class="queued-content">
					<p class="queued-reason">
						{#if record.reason === 'main_busy'}
							{m.lanelanding_reason_main_busy()}
						{:else}
							{m.lanelanding_reason_target_overlap()}
						{/if}
					</p>
					{#if record.files && record.files.length > 0}
						<ul class="file-list" role="list">
							{#each record.files as file}
								<li class="file-item">
									<IconFile />
									<span>{file}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

			{:else if record.kind === 'error'}
				<div class="error-content" role="alert">
					<p class="error-msg">{record.error?.message ?? 'Errore sconosciuto'}</p>
					{#if record.error?.detail}
						<pre class="error-detail-block">{record.error.detail}</pre>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.landing-card {
		width: 100%;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		overflow: hidden;
		font-size: var(--text-sm);
		line-height: 1.4;
		display: flex;
		flex-direction: column;
		margin: var(--space-2) 0;
	}

	.landing-card.kind-integrated {
		border-color: var(--line-strong);
	}

	.landing-card.kind-conflicts {
		border-color: var(--warning, #d97706);
		background: var(--bg-base);
	}

	.landing-card.kind-awaiting {
		border-color: var(--brand-line, #3b82f6);
	}

	.landing-card.kind-error {
		border-color: var(--danger, #ef4444);
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-overlay, var(--bg-raised));
		border-bottom: 1px solid var(--line);
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.status-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.kind-integrated .status-icon {
		color: var(--success, #10b981);
	}

	.kind-undone .status-icon {
		color: var(--ink-muted);
	}

	.kind-conflicts .status-icon,
	.kind-awaiting .status-icon {
		color: var(--warning, #d97706);
	}

	.kind-error .status-icon {
		color: var(--danger, #ef4444);
	}

	.status-title {
		font-weight: 600;
		color: var(--ink);
	}

	.badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px var(--space-2);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.card-body {
		padding: var(--space-2) var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.summary-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.meta-pill code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		padding: 2px 6px;
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		color: var(--brand-ink);
	}

	.files-toggle-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: transparent;
		border: none;
		padding: 0;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.files-toggle-btn:hover {
		color: var(--ink);
	}

	.file-list {
		list-style: none;
		margin: 0;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		max-height: 140px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.file-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-item.conflict {
		color: var(--warning-ink, #b45309);
	}

	.card-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}

	.btn-undo,
	.btn-action,
	.btn-confirm {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 4px var(--space-3);
		font-size: var(--text-xs);
		font-family: inherit;
		border-radius: var(--radius-sm);
		cursor: pointer;
		line-height: 1.2;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.btn-undo {
		background: var(--bg-base);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.btn-undo:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.btn-confirm,
	.btn-action {
		background: var(--brand-ink);
		color: var(--bg-base);
		border: 1px solid transparent;
		font-weight: 500;
	}

	.btn-confirm:hover:not(:disabled),
	.btn-action:hover:not(:disabled) {
		opacity: 0.9;
	}

	.btn-undo:disabled,
	.btn-confirm:disabled,
	.btn-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-spinner {
		display: inline-flex;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.undo-error {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--danger);
		border-radius: var(--radius-sm);
		color: var(--danger);
		font-size: var(--text-xs);
	}

	.detail-text {
		color: var(--ink-muted);
		word-break: break-all;
	}

	.undone-msg {
		margin: 0;
		color: var(--ink-muted);
		font-size: var(--text-xs);
	}

	.conflicts-summary {
		margin-bottom: var(--space-1);
	}

	.conflict-badge {
		font-weight: 600;
		color: var(--warning, #d97706);
		font-size: var(--text-xs);
	}

	.awaiting-text {
		margin: 0;
		color: var(--ink-muted);
	}

	.queued-reason {
		margin: 0;
		color: var(--ink-muted);
	}

	.error-msg {
		margin: 0;
		color: var(--danger);
		font-weight: 500;
	}

	.error-detail-block {
		margin: var(--space-1) 0 0 0;
		padding: var(--space-2);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 120px;
		overflow-y: auto;
		color: var(--ink-muted);
	}
</style>
