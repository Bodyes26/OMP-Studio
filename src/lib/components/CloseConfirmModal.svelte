<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { trapFocus } from '$lib/focusTrap';
	import { IconClose, IconWarning, IconQueue, IconPlay, IconCheck } from '$lib/icons';

	export interface ProjectCloseTarget {
		id: string;
		name: string;
		path: string;
		queuedCount: number;
		isWorking: boolean;
		runningTaskPrompt?: string;
	}

	export type CloseConfirmMode = 'project' | 'app';

	let {
		open = false,
		mode = 'project',
		project,
		affectedProjects = [],
		onConfirmKeep,
		onConfirmDiscard,
		onCancel
	} = $props<{
		open?: boolean;
		mode?: CloseConfirmMode;
		project?: ProjectCloseTarget;
		affectedProjects?: ProjectCloseTarget[];
		onConfirmKeep: () => void;
		onConfirmDiscard: () => void;
		onCancel: () => void;
	}>();

	let primaryBtnEl = $state<HTMLButtonElement | null>(null);

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onCancel();
		}
	}

	$effect(() => {
		if (open) {
			const timer = setTimeout(() => {
				primaryBtnEl?.focus();
			}, 30);
			return () => clearTimeout(timer);
		}
	});

	const hasWorking = $derived(
		mode === 'project'
			? Boolean(project?.isWorking)
			: affectedProjects.some((p: ProjectCloseTarget) => p.isWorking)
	);

	const totalQueued = $derived(
		mode === 'project'
			? (project?.queuedCount ?? 0)
			: affectedProjects.reduce((acc: number, p: ProjectCloseTarget) => acc + p.queuedCount, 0)
	);
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="modal-backdrop"
		onclick={onCancel}
		transition:fade={{ duration: 150 }}
	></div>

	<div
		class="modal-window"
		role="dialog"
		aria-modal="true"
		aria-labelledby="close-confirm-title"
		use:trapFocus
		transition:fly={{ y: -16, duration: 200, easing: cubicOut }}
	>
		<!-- Header -->
		<div class="modal-header">
			<div class="header-icon" class:warning={hasWorking}>
				<IconWarning />
			</div>
			<div class="header-text">
				<h3 id="close-confirm-title">
					{#if mode === 'project'}
						{m.page_modal_restart_btn_close()} {project?.name || 'progetto'}
					{:else}
						{m.close_confirm_title_app()}
					{/if}
				</h3>
				<p class="subtitle">
					{#if hasWorking}
						{m.close_confirm_sub_has_working()}
					{:else}
						{m.close_confirm_sub_has_queued()}
					{/if}
				</p>
			</div>
			<button
				type="button"
				class="btn-close"
				onclick={onCancel}
				aria-label={m.close_confirm_cancel_aria()}
			>
				<IconClose />
			</button>
		</div>

		<!-- Body -->
		<div class="modal-body">
			{#if mode === 'project' && project}
				{#if project.isWorking}
					<div class="alert-banner warning">
						<div class="alert-title">
							<span class="pulse-dot"></span>
							<strong>{m.close_confirm_working_banner_title()}</strong>
						</div>
						<p class="alert-desc">
							{m.ui_closeconfirmmodal_chiudendo_ora_il_processo_attivo_verra_interrotto_2370()}<code>.omp/tasks.json</code>) per consentirti di riprendere alla riapertura.
						</p>
					</div>
				{/if}

				{#if project.queuedCount > 0}
					<div class="queue-info">
						<div class="queue-icon"><IconQueue /></div>
						<div class="queue-text">
							<span>
								<strong>{project.queuedCount}</strong>
								{project.queuedCount === 1 ? 'task in coda' : 'task in coda'}
								{m.ui_closeconfirmmodal_conservati_per_questo_progetto_d077()}
							</span>
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
			{:else}
				<!-- Mode: App -->
				<p class="app-intro">
					{#if hasWorking}
						{m.ui_closeconfirmmodal_ci_sono_progetti_con_8f06()} <strong>{m.ui_closeconfirmmodal_elaborazioni_in_corso_abfe()}</strong> o con <strong>task in coda</strong>:
					{:else}
						{m.ui_closeconfirmmodal_ci_sono_progetti_con_8f06()} <strong>task in coda</strong> non ancora eseguiti:
					{/if}
				</p>

				<div class="project-list">
					{#each affectedProjects as p (p.id)}
						<div class="project-row">
							<span class="project-name">{p.name}</span>
							<div class="project-badges">
								{#if p.isWorking}
									<span class="badge working">
										<span class="pulse-dot"></span>
										{m.close_confirm_badge_working()}
									</span>
								{/if}
								{#if p.queuedCount > 0}
									<span class="badge queued">
										<IconQueue />
										{p.queuedCount} {p.queuedCount === 1 ? 'in coda' : 'in coda'}
									</span>
								{/if}
							</div>
						</div>
					{/each}
				</div>

				<p class="question-text">
					{m.ui_closeconfirmmodal_se_chiudi_conservando_le_code_gli_eventuali_f159()}
				</p>
			{/if}
		</div>

		<!-- Footer -->
		<div class="modal-footer">
			<button type="button" class="btn btn-secondary" onclick={onCancel}>
				{m.close_confirm_btn_cancel()}
			</button>

			<button
				type="button"
				class="btn btn-danger"
				onclick={onConfirmDiscard}
				title={m.ui_closeconfirmmodal_chiude_ed_elimina_i_task_in_coda_7d6d()}
			>
				{#if mode === 'project'}
					{m.close_confirm_btn_discard_project()}
				{:else}
					{m.close_confirm_btn_discard_app()}
				{/if}
			</button>

			<button
				type="button"
				class="btn btn-primary"
				bind:this={primaryBtnEl}
				onclick={onConfirmKeep}
				title="Chiude conservando tutti i task (compreso quello interrotto) per la prossima volta"
			>
				<IconCheck />
				<span>
					{#if mode === 'project'}
						{m.close_confirm_btn_keep_project()}
					{:else}
						{m.close_confirm_btn_keep_app()}
					{/if}
				</span>
			</button>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg-base) 80%, black);
		backdrop-filter: blur(2px);
		z-index: var(--z-modal, 1000);
	}

	.modal-window {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 520px;
		max-width: calc(100vw - 32px);
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg, 10px);
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45), 0 0 0 1px var(--line-strong);
		z-index: calc(var(--z-modal, 1000) + 1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

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
		border-radius: 50%;
		background: var(--bg-hover);
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.header-icon.warning {
		background: color-mix(in srgb, var(--warn) 20%, transparent);
		color: var(--warn);
	}

	.header-text {
		flex: 1;
		min-width: 0;
	}

	.header-text h3 {
		margin: 0;
		font-size: var(--text-md, 15px);
		font-weight: 600;
		color: var(--ink);
		line-height: 1.3;
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
	}

	.btn-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.modal-body {
		padding: var(--space-4, 16px);
		display: flex;
		flex-direction: column;
		gap: var(--space-3, 12px);
		max-height: 60vh;
		overflow-y: auto;
	}

	.alert-banner {
		padding: var(--space-3, 12px);
		border-radius: var(--radius-md, 6px);
		border: 1px solid transparent;
		background: var(--bg-raised);
	}

	.alert-banner.warning {
		background: color-mix(in srgb, var(--warn) 10%, var(--bg-raised));
		border-color: color-mix(in srgb, var(--warn) 30%, transparent);
	}

	.alert-title {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-sm, 13px);
		color: var(--ink);
		margin-bottom: 6px;
	}

	.alert-desc {
		margin: 0;
		font-size: var(--text-xs, 12px);
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.alert-desc code {
		background: var(--bg-hover);
		padding: 1px 4px;
		border-radius: 3px;
		font-family: inherit;
		font-size: 0.95em;
	}

	.pulse-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--warn);
		box-shadow: 0 0 0 0 color-mix(in srgb, var(--warn) 70%, transparent);
		animation: pulse 1.8s infinite;
	}

	@keyframes pulse {
		0% {
			transform: scale(0.95);
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--warn) 70%, transparent);
		}
		70% {
			transform: scale(1);
			box-shadow: 0 0 0 6px color-mix(in srgb, var(--warn) 0%, transparent);
		}
		100% {
			transform: scale(0.95);
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--warn) 0%, transparent);
		}
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

	.queue-icon {
		display: flex;
		align-items: center;
		color: var(--ink-muted);
	}

	.app-intro {
		margin: 0;
		font-size: var(--text-sm, 13px);
		color: var(--ink);
		line-height: 1.4;
	}

	.project-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 200px;
		overflow-y: auto;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md, 6px);
		padding: 6px;
	}

	.project-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 6px 10px;
		background: var(--bg-overlay);
		border-radius: var(--radius-sm, 4px);
	}

	.project-name {
		font-size: var(--text-sm, 13px);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-badges {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 7px;
		border-radius: 999px;
		font-size: var(--text-xs, 11px);
		font-weight: 500;
	}

	.badge.working {
		background: color-mix(in srgb, var(--warn) 20%, transparent);
		color: var(--warn);
	}

	.badge.queued {
		background: var(--bg-hover);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.question-text {
		margin: 4px 0 0;
		font-size: var(--text-xs, 12px);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2, 8px);
		padding: var(--space-3, 12px) var(--space-4, 16px);
		background: var(--bg-raised);
		border-top: 1px solid var(--line);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 6px 14px;
		font-size: var(--text-sm, 13px);
		font-weight: 500;
		border-radius: var(--radius-md, 6px);
		cursor: pointer;
		border: 1px solid transparent;
		transition: background 0.15s ease, filter 0.15s ease, border-color 0.15s ease;
	}

	.btn-secondary {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.btn-secondary:hover {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}

	.btn-danger {
		background: color-mix(in srgb, var(--danger) 15%, transparent);
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 30%, transparent);
	}

	.btn-danger:hover {
		background: color-mix(in srgb, var(--danger) 25%, transparent);
		border-color: var(--danger);
	}

	.btn-primary {
		background: var(--brand);
		color: var(--on-brand, #fff);
	}

	.btn-primary:hover {
		filter: brightness(1.1);
	}
</style>
