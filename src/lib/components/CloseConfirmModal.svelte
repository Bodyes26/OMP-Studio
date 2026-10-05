<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/ui/Dialog.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { IconClose, IconWarning, IconQueue, IconCheck } from '$lib/icons';

	export interface ProjectCloseTarget {
		id: string;
		name: string;
		path: string;
		queuedCount: number;
		isWorking: boolean;
		runningTaskPrompt?: string;
	}

	let {
		open = false,
		project,
		onConfirmKeep,
		onConfirmDiscard,
		onCancel
	} = $props<{
		open?: boolean;
		project?: ProjectCloseTarget;
		onConfirmKeep: () => void;
		onConfirmDiscard: () => void;
		onCancel: () => void;
	}>();

	// La chiusura di un progetto e' l'unico momento in cui la sorte della coda
	// va decisa: chiudendo Studio le code restano nei rispettivi
	// `.omp/tasks.json` e non c'e' niente da chiedere.
	const hasWorking = $derived(Boolean(project?.isWorking));
</script>

<Dialog
	open={open && Boolean(project)}
	onClose={onCancel}
	initialFocus="button.ui-button-primary"
	ariaLabelledBy="close-confirm-title"
>
	{#snippet header()}
		<div class="modal-header">
			<div class="header-icon" class:warning={hasWorking}>
				<IconWarning />
			</div>
			<div class="header-text">
				<h3 id="close-confirm-title">
					{m.close_confirm_title_project({ name: project?.name || 'progetto' })}
				</h3>
				<p class="subtitle">
					{#if hasWorking}
						{m.close_confirm_sub_has_working()}
					{:else}
						{m.close_confirm_sub_has_queued()}
					{/if}
				</p>
			</div>
			<Tooltip text={m.close_confirm_cancel_aria()}>
				<button
					type="button"
					class="btn-close"
					onclick={onCancel}
					aria-label={m.close_confirm_cancel_aria()}
				>
					<IconClose />
				</button>
			</Tooltip>
		</div>
	{/snippet}

	{#if project}
		<div class="modal-body-content">
			{#if project.isWorking}
				<div class="trace-row">
					<div class="trace-lead">
						<StatusMark status="running" active={true} />
						<strong>{m.close_confirm_working_banner_title()}</strong>
					</div>
					<p class="trace-desc">
						{m.close_confirm_working_banner_desc()}
					</p>
				</div>
			{/if}

			{#if project.queuedCount > 0}
				<div class="queue-info">
					<div class="queue-icon"><IconQueue /></div>
					<div class="queue-text">
						<span class="queue-count">{m.close_confirm_project_queued_info({ count: project.queuedCount })}</span>
					</div>
				</div>
			{/if}

			<p class="question-text">
				{#if project.isWorking}
					{m.close_confirm_project_working_question()}
				{:else}
					{m.close_confirm_project_queued_question()}
				{/if}
			</p>
		</div>
	{/if}

	{#snippet footer()}
		<button type="button" class="ui-button ui-button-secondary" onclick={onCancel}>
			{m.close_confirm_btn_cancel()}
		</button>

		<Tooltip text={m.ui_closeconfirmmodal_chiude_ed_elimina_i_task_in_coda_7d6d()}>
			<button
				type="button"
				class="ui-button ui-button-danger"
				onclick={onConfirmDiscard}
			>
				{m.close_confirm_btn_discard_project()}
			</button>
		</Tooltip>

		<Tooltip text={m.close_confirm_keep_tooltip()}>
			<button
				type="button"
				class="ui-button ui-button-primary"
				onclick={onConfirmKeep}
			>
				<IconCheck />
				<span>{m.close_confirm_btn_keep_project()}</span>
			</button>
		</Tooltip>
	{/snippet}
</Dialog>

<style>
	.modal-header {
		display: flex;
		align-items: center;
		gap: var(--space-3, 12px);
		padding: var(--space-4, 16px) var(--space-4, 16px) var(--space-3, 12px);
		border-bottom: 1px solid var(--line);
	}

	.header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-full, 50%);
		background: var(--bg-hover);
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.header-icon.warning {
		background: color-mix(in oklab, var(--warn) 15%, transparent);
		color: var(--warn);
	}

	.header-text {
		flex: 1;
		min-width: 0;
	}

	.header-text h3 {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-title);
		font-weight: 550;
		color: var(--ink);
		line-height: 1.3;
		text-wrap: balance;
	}

	.subtitle {
		margin: 2px 0 0;
		font-size: var(--text-xs, 12px);
		color: var(--ink-muted);
		line-height: 1.3;
	}

	.btn-close {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		padding: 6px;
		border-radius: var(--radius-sm, 4px);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background var(--dur-fast, 120ms) var(--ease-out, ease),
			color var(--dur-fast, 120ms) var(--ease-out, ease);
	}

	.btn-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.modal-body-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-3, 12px);
	}

	.trace-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: 0;
		color: var(--ink);
	}

	.trace-lead {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-body);
		color: var(--ink);
	}

	.trace-desc {
		margin: 0;
		font-size: var(--text-label);
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.queue-info {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: var(--space-2, 8px) var(--space-3, 12px);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md, 6px);
		font-size: var(--text-sm, 13px);
		color: var(--ink);
	}

	.queue-count {
		font-variant-numeric: tabular-nums;
	}

	.queue-icon {
		display: flex;
		align-items: center;
		color: var(--ink-muted);
	}

	.question-text {
		margin: 4px 0 0;
		font-size: var(--text-xs, 12px);
		color: var(--ink-muted);
		line-height: 1.4;
	}
</style>
