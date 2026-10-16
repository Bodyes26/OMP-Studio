<!--
  SessionRow.svelte — Riga sessione Inbox A.
  Design Studio fedele: contesto (progetto, macchina, corsia) sopra il titolo,
  indicatore di stato, anteprima attività/domanda, conteggi operativi,
  pulsanti rapidi Approva/Rifiuta per richieste di conferma reali con controllo di scadenza e stato online.
  Separazione corretta tra l'apertura della chat e le azioni rapide per evitare attivazioni indebite da tastiera.
-->
<script lang="ts">
	import type { FleetSessionItem } from '../../fleet.ts';
	import { t } from '../../i18n.ts';
	import { connection } from '../../connection.svelte.ts';
	import { navigation } from '../../navigation.svelte.ts';
	import StateDot from './StateDot.svelte';
	import ProjectIcon from './ProjectIcon.svelte';
	import MachineBadge from './MachineBadge.svelte';
	import { IconCheck, IconBot, IconTerminal } from '../../icons.ts';

	let {
		item,
		showProject = true,
		active = false,
		onclick
	}: {
		item: FleetSessionItem;
		showProject?: boolean;
		active?: boolean;
		onclick?: () => void;
	} = $props();

	let isActionPending = $state(false);
	let actionError = $state<string | null>(null);

	const isAttention = $derived(item.state === 'waiting' || item.state === 'error');
	const att = $derived(item.attention);
	const isConfirm = $derived(att?.method === 'confirm');

	// Timer reattivo per la scadenza live
	let now = $state(Date.now());
	$effect(() => {
		if (att?.deadline == null) return;
		const timer = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(timer);
	});

	const isExpired = $derived(att?.deadline != null && now >= att.deadline);
	const isHostAvailable = $derived(item.hostOnline && connection.status === 'connected');
	const canRespond = $derived(item.hostFeatures.includes('respond_ui') && !isExpired && isHostAvailable);

	const timeAgoLabel = $derived.by(() => {
		if (!item.updatedAt) return '';
		const diffSec = Math.max(0, Math.floor((now - item.updatedAt) / 1000));
		if (diffSec < 60) return t('agoJustNow');
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return t('agoMinutes', { count: diffMin });
		const diffHour = Math.floor(diffMin / 60);
		if (diffHour < 24) return t('agoHours', { count: diffHour });
		const diffDay = Math.floor(diffHour / 24);
		return t('agoDays', { count: diffDay });
	});

	function handleOpenChat() {
		if (onclick) {
			onclick();
		} else {
			navigation.openChat({
				hostId: item.hostId,
				projectId: item.project.id,
				laneId: item.lane.id
			});
		}
	}


	async function handleConfirmAction(confirmed: boolean, e: MouseEvent) {
		e.stopPropagation();
		if (!att || isActionPending) return;

		// Ri-controllo puntuale della scadenza al click effettivo
		if (att.deadline != null && Date.now() >= att.deadline) {
			actionError = t('expired');
			return;
		}

		// Ri-controllo dello stato di connettività
		if (!item.hostOnline || connection.status !== 'connected') {
			actionError = t('errHostOffline');
			return;
		}

		isActionPending = true;
		actionError = null;
		try {
			await connection.sendCommand(item.hostId, {
				kind: 'respond_ui',
				projectId: item.project.id,
				laneId: att.laneId,
				requestId: att.requestId,
				answer: { action: 'confirm', confirmed }
			});
		} catch (err: unknown) {
			const msg = (err as { message?: string })?.message || t('errFailed');
			actionError = msg;
		} finally {
			isActionPending = false;
		}
	}
</script>

<div
	class="session-row"
	class:is-active={active}
	class:is-attention={isAttention}
>
	<div class="row-lead">
		<StateDot state={item.state} />
	</div>

	<div class="row-body">
		<button type="button" class="session-open" onclick={handleOpenChat}>
		<!-- Contesto sopra il titolo -->
		<span class="row-context">
			{#if showProject}
				<span class="context-project">
					<ProjectIcon project={item.project} size="sm" />
					<span class="project-name">{item.project.name}</span>
				</span>
				<span class="context-sep">·</span>
			{/if}
			<MachineBadge name={item.hostName} online={item.hostOnline} short />
			{#if item.lane.kind !== 'main' || item.lane.title !== 'Principale'}
				<span class="context-sep">·</span>
				<span class="lane-name font-mono">{item.lane.title}</span>
			{/if}
		</span>

		<!-- Titolo e tempo relativo -->
		<span class="row-title-line">
			<span class="session-title">{item.title}</span>
			{#if item.unread}
				<span class="unread-dot" title={t('sectionDone')} aria-hidden="true"></span>
			{/if}
			{#if timeAgoLabel}
				<span class="time-ago">{timeAgoLabel}</span>
			{/if}
		</span>

		<!-- Anteprima attività o richiesta -->
		{#if item.preview}
			<span class="row-preview" class:attention-text={isAttention}>
				{item.preview}
			</span>
		{/if}

		<!-- Indicatori operativi: avanzamento, subagent, job, coda -->
		<span class="row-meta">
			{#if item.todo}
				<span class="meta-item todo font-mono">
					<span class="meta-icon" aria-hidden="true"><IconCheck /></span>
					{t('todoCount', { done: item.todo.done, total: item.todo.total })}
				</span>
			{/if}

			{#if item.subagentsCount > 0}
				<span class="meta-item">
					<span class="meta-icon" aria-hidden="true"><IconBot /></span>
					{t('subagentCount', { count: item.subagentsCount })}
				</span>
			{/if}

			{#if item.jobsCount > 0}
				<span class="meta-item">
					<span class="meta-icon" aria-hidden="true"><IconTerminal /></span>
					{t('jobCount', { count: item.jobsCount })}
				</span>
			{/if}

			{#if item.tasksCount > 0}
				<span class="meta-item queue-tag">
					{t('queuedCountSuffix', { count: item.tasksCount })}
				</span>
			{/if}
		</span>
		</button>

		<!-- Azioni rapide per richieste di conferma o domande -->
		{#if isAttention}
			<div class="quick-actions" role="presentation">
				{#if isConfirm}
					<button
						type="button"
						class="ui-button ui-button-primary btn-sm btn-approve"
						disabled={isActionPending || !canRespond}
						onclick={(e) => handleConfirmAction(true, e)}
					>
						{t('btnApprove')}
					</button>
					<button
						type="button"
						class="ui-button ui-button-ghost btn-sm btn-reject"
						disabled={isActionPending || !canRespond}
						onclick={(e) => handleConfirmAction(false, e)}
					>
						{t('btnReject')}
					</button>
				{:else}
					<button
						type="button"
						class="ui-button ui-button-primary btn-sm"
						onclick={handleOpenChat}
					>
						{item.state === 'error' ? t('btnViewError') : t('btnReply')}
					</button>
				{/if}
				{#if actionError}
					<span class="action-error">{actionError}</span>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.session-row {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 14px;
		border-radius: var(--radius-xl);
		background: var(--bg-base);
		border: 1px solid var(--line);
		cursor: pointer;
		text-align: left;
		transition: all var(--dur-fast, 0.15s) ease;
		user-select: none;
		outline: none;
	}

	.session-row:hover {
		border-color: var(--line-active, var(--line));
		background: var(--bg-raised);
	}

	.session-row.is-active {
		border-color: var(--brand);
		background: var(--bg-raised);
		box-shadow: 0 0 0 1px var(--brand);
	}

	.session-row.is-attention {
		border-color: color-mix(in oklab, var(--warn) 35%, transparent);
		background: color-mix(in oklab, var(--warn) 8%, var(--bg-base));
	}

	.session-row:focus-within {
		box-shadow: 0 0 0 2px var(--brand);
	}

	.row-lead {
		padding-top: 4px;
		flex-shrink: 0;
	}

	.row-body {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.session-open {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 100%;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.row-context {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-mini, 11px);
		color: var(--ink-muted);
		min-width: 0;
		flex-wrap: wrap;
	}

	.context-project {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-weight: 600;
		color: var(--ink);
	}

	.project-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 140px;
	}

	.context-sep {
		color: var(--ink-faint);
	}

	.lane-name {
		font-size: var(--text-mini, 11px);
		color: var(--ink-muted);
	}

	.row-title-line {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.session-title {
		font-size: var(--text-label, 13px);
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
		line-height: 1.3;
	}

	.unread-dot {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background-color: var(--brand);
		flex-shrink: 0;
	}

	.time-ago {
		font-size: var(--text-mini, 11px);
		color: var(--ink-muted);
		flex-shrink: 0;
		white-space: nowrap;
	}

	.row-preview {
		font-size: var(--text-caption, 12px);
		color: var(--ink-muted);
		line-height: 1.4;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row-preview.attention-text {
		color: var(--warn);
		font-weight: 500;
	}

	.row-meta {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin-top: 4px;
		font-size: var(--text-mini, 11px);
		color: var(--ink-muted);
	}

	.meta-item {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.meta-icon {
		display: inline-flex;
		align-items: center;
		--icon-size: 13px;
		color: var(--ink-faint);
	}

	.queue-tag {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-weight: 500;
	}

	.quick-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
	}

	.btn-sm {
		padding: 4px 10px;
		font-size: var(--text-mini, 11px);
		height: auto;
		min-height: 26px;
		border-radius: var(--radius-md);
	}

	.btn-approve {
		background: var(--ink);
		color: var(--bg-base);
	}

	.btn-reject {
		background: var(--bg-base);
		color: var(--ink);
		border: 1px solid var(--line);
	}

	.action-error {
		font-size: var(--text-mini, 11px);
		color: var(--danger);
	}
</style>
