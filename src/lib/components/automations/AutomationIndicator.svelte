<script lang="ts">
	import { automationsStore } from '#lib/automations/store.svelte.ts';
	import { occurrenceActivity, occurrenceUrgentState } from '#lib/automations/activity.ts';
	import type { AutomationOccurrence, ExecutionState } from '#lib/automations/types.ts';
	import { backgroundJobs } from '#lib/stores/backgroundJobs.svelte.ts';
	import { t, formatDateTime, formatDuration } from '#lib/automations/i18n.ts';
	import { anchoredPopover } from '#lib/anchoredPopover.ts';
	import { rvLift, badgeReveal } from '#lib/agent/motion.ts';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import IconAutomation from './IconAutomation.svelte';
	import {
		IconPlay,
		IconPause,
		IconStop,
		IconCheck,
		IconWarning,
		IconClose,
		IconExternalLink,
		IconSchedule,
		IconSparkles,
		IconSettings
	} from '#lib/icons.ts';

	interface Props {
		onOpenView?: () => void;
		onOpenSession?: (sessionId: string) => void;
	}

	let { onOpenView, onOpenSession }: Props = $props();

	let open = $state(false);
	let triggerBtnEl = $state<HTMLButtonElement | null>(null);
	let popoverEl = $state<HTMLDivElement | null>(null);
	let now = $state(Date.now());

	// Update timer for elapsed calculation while open
	$effect(() => {
		if (open) {
			now = Date.now();
			const timer = setInterval(() => {
				now = Date.now();
			}, 1000);
			return () => clearInterval(timer);
		}
	});

	// Ensure store is initialized
	$effect(() => {
		if (!automationsStore.snapshot && !automationsStore.loading && !automationsStore.error) {
			void automationsStore.init();
		}
	});

	const snapshot = $derived(automationsStore.snapshot);
	const runs = $derived(snapshot?.runs || []);
	const nextRuns = $derived(snapshot?.nextRuns || {});
	const definitions = $derived(snapshot?.definitions || []);


	// Running occurrences (personal rules + titles, deduplicated per-occurrence)
	const isTitleRunning = $derived(
		backgroundJobs.running?.id === 'taskTitles' || backgroundJobs.running?.id === 'sessionTitles'
	);
	const runningRuns = $derived(
		runs.filter((run) => occurrenceActivity(run) === 'running')
	);
	const totalRunning = $derived(runningRuns.length + (isTitleRunning ? 1 : 0));
	const hasRunning = $derived(totalRunning > 0);

	// Occurrences requiring attention (AUT-102: scadenze perse/saltate, needsInput, errore, timeout, unknown, requiresReview)
	// Unresolved items (domanda, revisione, unknown) non possono essere risolti da un semplice ack
	const attentionRuns = $derived(runs.filter((run) => occurrenceActivity(run) === 'attention'));
	const totalAttention = $derived(attentionRuns.length);

	// Waiting occurrences: personal rules waiting (senza attention o running) + pending titles singolarmente (AUT-101)
	const waitingRuns = $derived(runs.filter((run) => occurrenceActivity(run) === 'waiting'));
	const taskTitlesPending = $derived(
		backgroundJobs.views.find((v) => v.id === 'taskTitles')?.pending ?? 0
	);
	const sessionTitlesPending = $derived(
		backgroundJobs.views.find((v) => v.id === 'sessionTitles')?.pending ?? 0
	);
	const titlesPending = $derived(taskTitlesPending + sessionTitlesPending);
	const totalWaiting = $derived(waitingRuns.length + titlesPending);

	// Title quota floor pause check
	const titlesQuotaPaused = $derived(
		backgroundJobs.views.some(
			(v) => (v.id === 'taskTitles' || v.id === 'sessionTitles') && v.paused === 'quotaFloor'
		)
	);

	// Priority state calculation for button text & badge (AUT-050 / AUT-101: attention > running > waiting)
	const buttonLabel = $derived.by(() => {
		if (totalAttention > 0) {
			return `${t('indicator_title')} · ${t('indicator_needs_attention', { count: totalAttention })}`;
		}
		if (totalRunning > 0) {
			return `${t('indicator_title')} · ${t('indicator_running', { count: totalRunning })}`;
		}
		if (totalWaiting > 0) {
			return `${t('indicator_title')} · ${t('indicator_waiting', { count: totalWaiting })}`;
		}
		return t('indicator_title');
	});

	const tooltipText = $derived(
		t('indicator_tooltip', {
			attention: totalAttention,
			running: totalRunning,
			waiting: totalWaiting
		})
	);

	function togglePopover() {
		open = !open;
	}

	function closePopover() {
		if (!open) return;
		open = false;
		triggerBtnEl?.focus();
	}

	function handleManageClick() {
		closePopover();
		automationsStore.open();
		onOpenView?.();
	}
	function handleReviewFromIndicator(automationId: string) {
		closePopover();
		const drafts = automationsStore.snapshot?.drafts || [];
		const draft = drafts.find((d) => d.definition.id === automationId);
		if (draft) {
			automationsStore.openReview(draft.id).catch(() => {
				const def = automationsStore.snapshot?.definitions.find((d) => d.id === automationId);
				if (def) automationsStore.edit(def);
			});
		} else {
			const def = automationsStore.snapshot?.definitions.find((d) => d.id === automationId);
			if (def) automationsStore.edit(def);
		}
		onOpenView?.();
	}

	function handleTriggerKeyDown(e: KeyboardEvent) {
		if (e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			open = true;
		}
	}

	function handlePopoverKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closePopover();
		}
	}

	function handleFocusOut(e: FocusEvent) {
		const next = e.relatedTarget as Node | null;
		if (popoverEl && next && popoverEl.contains(next)) return;
		if (triggerBtnEl && next && triggerBtnEl.contains(next)) return;
		open = false;
	}

	function formatElapsed(startMs: number | null): string {
		if (!startMs) return '—';
		const diffSec = Math.max(0, Math.floor((now - startMs) / 1000));
		if (diffSec < 60) return `${diffSec}s`;
		const min = Math.floor(diffSec / 60);
		const sec = diffSec % 60;
		return `${min}m ${sec}s`;
	}
</script>

<div class="automations-indicator-wrapper">
	<Tooltip text={tooltipText} disabled={open} placement="top-start" offset={6}>
		<button
			bind:this={triggerBtnEl}
			type="button"
			class="version-btn automations-indicator-btn"
			class:has-attention={attentionRuns.length > 0}
			class:active={open}
			aria-expanded={open}
			aria-haspopup="dialog"
			aria-label={tooltipText}
			onclick={togglePopover}
			onkeydown={handleTriggerKeyDown}
		>
			<!-- Canonical Icon: Terminal + Clock SVG -->
			{#if hasRunning}
				<!-- Segno fermo e attenuato: un'automazione in corso e' informazione di
				     fondo, si legge se la si cerca; il movimento la renderebbe un richiamo. -->
				<span class="btn-spinner" transition:badgeReveal={{ duration: 160, blur: 2 }}>
					<StatusMark status="running" active={false} />
				</span>
			{:else if attentionRuns.length > 0}
				<span class="status-glyph warn" aria-hidden="true">
					<IconWarning />
				</span>
			{:else}
				<IconAutomation size={14} class="status-icon" />
			{/if}

			<span class="indicator-label font-medium">{buttonLabel}</span>

			{#if totalAttention > 0}
				<span class="update-chip warn" transition:badgeReveal>
					<span class="chip-text">{totalAttention}</span>
				</span>
			{:else if totalRunning === 0 && totalWaiting > 0}
				<span class="update-chip neutral" transition:badgeReveal>
					<span class="chip-text">{totalWaiting}</span>
				</span>
			{/if}
		</button>
	</Tooltip>

	<!-- Popover riepilogo operativo (senza editor completo) -->
	{#if open}
		<div
			bind:this={popoverEl}
			class="automations-popover rv-lift"
			role="dialog"
			tabindex="-1"
			aria-label={t('popover_title')}
			popover="manual"
			use:anchoredPopover={{
				anchor: triggerBtnEl,
				placement: 'top-start',
				offset: 8,
				constrainHeight: true,
				motion: true
			}}
			transition:rvLift={{ blur: 3 }}
			onkeydown={handlePopoverKeyDown}
			onfocusout={handleFocusOut}
		>
			<!-- Intestazione popover -->
			<div class="popover-header">
				<div class="header-left">
					<IconAutomation size={18} />
					<h3 class="popover-title">{t('popover_title')}</h3>
				</div>

				<div class="header-actions">
					<button
						type="button"
						class="ui-button ui-button-secondary text-xs"
						onclick={handleManageClick}
					>
						<span>{t('popover_manage_btn')}</span>
					</button>

					<button
						type="button"
						class="ui-button ui-button-ghost icon-only-btn"
						onclick={closePopover}
						aria-label={t('btn_close')}
					>
						<IconClose />
					</button>
				</div>
			</div>

			<div class="popover-body">
				<!-- Sezione 1: Richiedono attenzione -->
				{#if attentionRuns.length > 0}
					<div class="popover-section attention-section">
						<div class="section-header-line">
							<IconWarning />
							<span class="section-title text-xs font-semibold">{t('popover_section_attention')} ({attentionRuns.length})</span>
						</div>
						<div class="items-list">
							{#each attentionRuns as run (run.id)}
								<div class="popover-item-card warn-card">
									<div class="item-card-top">
										<span class="item-name font-medium">{run.name}</span>
										<span class="status-badge warn">{t(`exec_${run.state}` as any) || run.state}</span>
									</div>
									<div class="item-card-meta text-xs">
										<span>{formatDateTime(run.scheduledAt)}</span>
										{#if run.executions.some(e => e.question)}
											<span class="bullet">·</span>
											<span class="question-notice">Richiede risposta</span>
										{/if}
									</div>
									<div class="item-card-actions">
										{#if run.executions.some(e => e.sessionId) && onOpenSession}
											{@const execWithSession = run.executions.find(e => e.sessionId)}
											<button
												type="button"
												class="ui-button ui-button-primary action-xs"
												onclick={() => { closePopover(); onOpenSession?.(execWithSession!.sessionId!); }}
											>
												<IconExternalLink />
												<span>{t('popover_action_open_session')}</span>
											</button>
										{/if}
										{#if run.requiresReview}
											<button
												type="button"
												class="ui-button ui-button-secondary action-xs"
												onclick={() => handleReviewFromIndicator(run.automationId)}
											>
												<span>{t('occ_btn_review_script')}</span>
											</button>
										{/if}
										{#if !run.acknowledged && !run.requiresReview && run.state !== 'unknown' && !run.executions.some(e => e.state === 'needsInput') && (run.state === 'completed' || run.state === 'error' || run.state === 'timeout' || run.state === 'skipped' || run.state === 'interrupted')}
											<button
												type="button"
												class="ui-button ui-button-secondary action-xs"
												onclick={() => void automationsStore.acknowledge(run.id)}
											>
												<IconCheck />
												<span>{t('popover_action_ack')}</span>
											</button>
										{/if}
										{#if run.state === 'running' || run.state === 'needsInput' || run.executions.some(e => e.state === 'running' || e.state === 'needsInput')}
											<button
												type="button"
												class="ui-button ui-button-danger action-xs"
												onclick={() => void automationsStore.cancel(run.id)}
											>
												<IconStop />
												<span>{t('popover_action_stop')}</span>
											</button>
										{/if}
										<button
											type="button"
											class="ui-button ui-button-ghost action-xs"
											onclick={() => {
												closePopover();
												automationsStore.selectedId = run.automationId;
												automationsStore.selectedRunId = run.id;
												automationsStore.open();
												onOpenView?.();
											}}
										>
											<span>{t('occ_details_btn')}</span>
										</button>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Sezione 2: In esecuzione -->
				{#if runningRuns.length > 0 || isTitleRunning}
					<div class="popover-section running-section">
						<div class="section-header-line">
							<StatusMark status="running" active={true} />
							<span class="section-title text-xs font-semibold">{t('popover_section_running')}</span>
						</div>
						<div class="items-list">
							{#each runningRuns as run (run.id)}
								<div class="popover-item-card running-card">
									<div class="item-card-top">
										<span class="item-name font-medium">{run.name}</span>
										<span class="elapsed-badge font-mono text-xs">
											{formatElapsed(run.executions[0]?.startedAt || run.createdAt)}
										</span>
									</div>
									<div class="item-card-actions">
										<button
											type="button"
											class="ui-button ui-button-danger action-xs"
											onclick={() => void automationsStore.cancel(run.id)}
										>
											<IconStop />
											<span>{t('popover_action_stop')}</span>
										</button>
									</div>
								</div>
							{/each}

							{#if isTitleRunning}
								<div class="popover-item-card running-card">
									<div class="item-card-top">
										<span class="item-name font-medium">Titoli AI: {backgroundJobs.running?.running?.label || 'Generazione in corso'}</span>
										<span class="elapsed-badge font-mono text-xs">
											{formatElapsed(backgroundJobs.running?.running?.startedAt || null)}
										</span>
									</div>
									<div class="item-card-actions">
										<button
											type="button"
											class="ui-button ui-button-danger action-xs"
											onclick={() => backgroundJobs.cancelCurrent()}
										>
											<IconStop />
											<span>{t('popover_action_stop')}</span>
										</button>
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Avviso Quota Floor per Titoli AI -->
				{#if titlesQuotaPaused}
					<div class="quota-warning-banner">
						<IconWarning />
						<span class="text-xs">Titoli AI sospesi per riserva quota (soglia 30% raggiunta).</span>
					</div>
				{/if}

				<!-- Sezione 3: In attesa o Prossime scadenze -->
				{#if waitingRuns.length > 0}
					<div class="popover-section waiting-section">
						<div class="section-header-line">
							<IconSchedule />
							<span class="section-title text-xs font-semibold">{t('popover_section_waiting')} ({waitingRuns.length})</span>
						</div>
						<div class="items-list">
							{#each waitingRuns as run (run.id)}
								<div class="popover-item-card waiting-card text-xs">
									<span class="item-name">{run.name}</span>
									<span class="text-muted">{formatDateTime(run.scheduledAt)}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if attentionRuns.length === 0 && !hasRunning && waitingRuns.length === 0}
					<div class="empty-popover-notice text-xs">
						<p>{t('popover_empty')}</p>
					</div>
				{/if}
			</div>

			<!-- Footer popover -->
			<div class="popover-footer">
				<button
					type="button"
					class="footer-link-btn text-xs"
					onclick={handleManageClick}
				>
					<span>Vedi tutte le {definitions.length} automazioni…</span>
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.automations-indicator-wrapper {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.automations-indicator-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border-radius: var(--radius-sm);
		background: transparent;
		border: 1px solid transparent;
		color: var(--ink-muted);
		font-size: 12px;
		cursor: pointer;
		transition: all var(--dur-fast, 120ms) ease;
	}

	.automations-indicator-btn:hover,
	.automations-indicator-btn.active {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.automations-indicator-btn.has-attention {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
		background: color-mix(in srgb, var(--warn) 10%, transparent);
	}

	.status-glyph.warn {
		color: var(--warn);
		display: inline-flex;
	}

	.btn-spinner {
		display: inline-flex;
		opacity: 0.7;
	}

	.update-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: var(--radius-full);
		font-size: 11px;
		font-weight: 600;
	}

	.update-chip.warn {
		background: var(--warn);
		color: #000;
	}

	.update-chip.neutral {
		background: var(--bg-raised);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.automations-popover {
		width: 360px;
		max-height: 480px;
		display: flex;
		flex-direction: column;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
		color: var(--ink);
		z-index: 9999;
		overflow: hidden;
	}

	.popover-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
	}

	.popover-header .header-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.popover-title {
		font-size: 13px;
		font-weight: 600;
		margin: 0;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.popover-body {
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		overflow-y: auto;
		max-height: 380px;
	}

	.popover-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.section-header-line {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ink-muted);
	}

	.items-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.popover-item-card {
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-sunken);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.popover-item-card.warn-card {
		border-color: color-mix(in srgb, var(--warn) 30%, transparent);
		background: color-mix(in srgb, var(--warn) 8%, var(--bg-sunken));
	}

	.popover-item-card.running-card {
		border-color: color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.item-card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.item-name {
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-card-meta {
		color: var(--ink-muted);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.question-notice {
		color: var(--warn);
		font-weight: 500;
	}

	.item-card-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 4px;
	}

	.action-xs {
		padding: 3px 6px;
		font-size: 11px;
		min-height: 22px;
	}

	.quota-warning-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		color: var(--warn);
		border: 1px solid color-mix(in srgb, var(--warn) 25%, transparent);
	}

	.empty-popover-notice {
		text-align: center;
		padding: 16px 8px;
		color: var(--ink-muted);
	}

	.popover-footer {
		padding: 8px 12px;
		background: var(--bg-sunken);
		border-top: 1px solid var(--line);
		display: flex;
		justify-content: center;
	}

	.footer-link-btn {
		background: transparent;
		border: none;
		color: var(--brand-ink);
		cursor: pointer;
		padding: 2px 4px;
	}

	.footer-link-btn:hover {
		text-decoration: underline;
	}

	.bullet {
		opacity: 0.5;
	}

	.status-badge {
		font-size: 10px;
		padding: 1px 5px;
		border-radius: var(--radius-full);
		font-weight: 600;
	}

	.status-badge.warn {
		background: color-mix(in srgb, var(--warn) 20%, transparent);
		color: var(--warn);
	}
</style>
