<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Pannello «Rami»: l'albero della sessione aperta (`get_tree`), un nodo per
	// ogni messaggio dell'utente, il ramo attivo dritto a sinistra e i rami
	// alternativi rientrati nel punto in cui si staccano.
	//
	// Stessa superficie del cassetto dei subagenti (dialog laterale sopra la
	// chat, `rv-lift`, Esc chiude). Via RPC omp non sposta la foglia nello
	// stesso file come il `/tree` della TUI: aprire un ramo crea una sessione
	// nuova con `fork` sulla punta di quel ramo, e il pannello lo dice.
	import type { AgentSession } from '../session.svelte';
	import {
		branchTipEntryId,
		buildBranchTree,
		messageText,
		type BranchRow,
		type BranchTree
	} from '../sessionTree';
	import { agentUiHooks } from '../ui-context';
	import { IconClose, IconEditRetry, IconFork, IconGitBranch, IconMore, IconRefresh } from '$lib/icons';
	import { contextMenu, type ContextMenuEntry } from '$lib/contextMenu.svelte';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import { rvLift } from '../motion';
	import { motionReduced } from '../motionState.svelte';
	import { fade } from 'svelte/transition';
	import { trapFocus } from '$lib/focusTrap';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { untrack } from 'svelte';

	let { session, onClose } = $props<{ session: AgentSession; onClose: () => void }>();

	const hooks = agentUiHooks();

	let tree = $state<BranchTree | null>(null);
	let loading = $state(false);
	let errorText = $state<string | null>(null);
	let focusedId = $state<string | null>(null);
	let listEl = $state<HTMLElement | null>(null);
	let loadSeq = 0;

	const canBranch = $derived(session.canBranch);
	const blockedReason = $derived(canBranch ? null : session.branchBlockedReason());

	async function load() {
		const seq = ++loadSeq;
		loading = true;
		try {
			const snapshot = await session.loadBranchTree();
			if (seq !== loadSeq) return;
			tree = buildBranchTree(snapshot);
			errorText = null;
			const rows = tree.rows;
			if (!focusedId || !rows.some((row) => row.entryId === focusedId)) {
				focusedId = rows.find((row) => row.current)?.entryId ?? rows.at(-1)?.entryId ?? null;
			}
		} catch (error) {
			if (seq !== loadSeq) return;
			errorText = error instanceof Error ? error.message : String(error);
		} finally {
			if (seq === loadSeq) loading = false;
		}
	}

	// Si ricarica all'apertura, a ogni cambio di sessione (un ramo aperto da
	// qui ne crea una nuova) e quando l'agente finisce un turno.
	$effect(() => {
		void session.sessionId;
		const streaming = session.isStreaming;
		const switching = session.branchBusy;
		if (streaming || switching) return;
		untrack(() => void load());
	});

	function timeLabel(row: BranchRow): string {
		if (row.time === null) return '';
		const sameDay = new Date(row.time).toDateString() === new Date().toDateString();
		return i18n.formatDate(
			row.time,
			sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
		);
	}

	function userContent(entryId: string): { text: string; images: { data: string; mimeType: string }[] } {
		const content = tree?.lookup(entryId)?.message?.content;
		const images = Array.isArray(content)
			? content
					.filter((block) => block.type === 'image' && typeof block.data === 'string')
					.map((block) => ({ data: block.data as string, mimeType: block.mimeType ?? 'image/png' }))
			: [];
		return { text: messageText(content), images };
	}

	async function switchTo(row: BranchRow) {
		if (!tree || row.active || !canBranch) return;
		const tip = branchTipEntryId(tree, row.entryId);
		if (!tip) return;
		await session.forkAtEntry(tip, m.branch_switch_done());
	}

	async function forkBefore(row: BranchRow) {
		if (!canBranch) return;
		await session.branchBeforeUserEntry(row.entryId, null);
	}

	async function editRetry(row: BranchRow) {
		if (!canBranch) return;
		const outcome = await session.branchBeforeUserEntry(row.entryId, userContent(row.entryId));
		if (outcome.kind === 'done') onClose();
	}

	function rowMenu(row: BranchRow): ContextMenuEntry[] {
		const hint = blockedReason ?? undefined;
		const items: ContextMenuEntry[] = [];
		if (!row.active) {
			items.push({
				kind: 'item',
				label: m.branch_action_switch(),
				icon: IconGitBranch,
				disabled: !canBranch,
				hint: hint ?? m.branch_action_switch_hint(),
				run: () => switchTo(row)
			});
		}
		items.push(
			{
				kind: 'item',
				label: m.branch_action_fork_here(),
				icon: IconFork,
				disabled: !canBranch,
				hint: hint ?? m.branch_action_fork_here_hint(),
				run: () => forkBefore(row)
			},
			{
				kind: 'item',
				label: m.branch_action_edit_retry(),
				icon: IconEditRetry,
				disabled: !canBranch,
				hint: hint ?? m.branch_action_edit_retry_hint(),
				run: () => editRetry(row)
			}
		);
		return items;
	}

	function openRowMenu(event: MouseEvent, row: BranchRow, invoker?: HTMLElement) {
		event.preventDefault();
		event.stopPropagation();
		focusedId = row.entryId;
		contextMenu.open(event, { label: m.branch_panel_selected_actions(), items: rowMenu(row), invoker });
	}

	/** Clic: un ramo inattivo si apre; sul ramo attivo si mostrano le azioni. */
	function activate(event: MouseEvent, row: BranchRow) {
		focusedId = row.entryId;
		if (row.active) {
			openRowMenu(event, row, event.currentTarget as HTMLElement);
			return;
		}
		void switchTo(row);
	}

	function focusRow(entryId: string | undefined) {
		if (!entryId || !listEl) return;
		focusedId = entryId;
		const button = listEl.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(entryId)}"]`);
		button?.focus();
	}

	function handleListKeydown(event: KeyboardEvent) {
		const rows = tree?.rows ?? [];
		if (rows.length === 0) return;
		const index = Math.max(0, rows.findIndex((row) => row.entryId === focusedId));
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			focusRow(rows[Math.min(rows.length - 1, index + 1)]?.entryId);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			focusRow(rows[Math.max(0, index - 1)]?.entryId);
		} else if (event.key === 'Home') {
			event.preventDefault();
			focusRow(rows[0]?.entryId);
		} else if (event.key === 'End') {
			event.preventDefault();
			focusRow(rows.at(-1)?.entryId);
		} else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
			const row = rows[index];
			const target = event.target as HTMLElement;
			if (!row) return;
			event.preventDefault();
			// Ancora da tastiera: il menu si aggancia sotto la riga.
			contextMenu.open(new MouseEvent('contextmenu', { clientX: 0, clientY: 0 }), {
				label: m.branch_panel_selected_actions(),
				items: rowMenu(row),
				invoker: target
			});
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && !contextMenu.isOpen) {
			event.stopPropagation();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="drawer-backdrop" onclick={onClose} transition:fade={{ duration: motionReduced() ? 0 : 240 }}></div>

<div
	class="branch-panel"
	role="dialog"
	aria-modal="true"
	aria-label={m.branch_panel_aria()}
	use:trapFocus={{ restoreFocus: true, onEscape: onClose }}
	transition:rvLift={{ x: 12, distance: 0, duration: 240, blur: 3 }}
>
	<div class="panel-head">
		<div class="head-info">
			<span class="glyph"><IconGitBranch aria-hidden="true" /></span>
			<span class="title">{m.branch_panel_title()}</span>
			{#if tree && tree.branchPoints > 0}
				<span class="ui-count">{m.branch_panel_summary({ count: tree.branchPoints })}</span>
			{/if}
		</div>
		<div class="head-actions">
			<Tooltip text={m.branch_panel_refresh()} placement="bottom" offset={4}>
				<button
					type="button"
					class="icon-btn"
					class:spinning={loading}
					aria-label={m.branch_panel_refresh()}
					onclick={() => void load()}
				>
					<IconRefresh aria-hidden="true" />
				</button>
			</Tooltip>
			<Tooltip text={m.branch_panel_close()} placement="bottom" offset={4}>
				<button type="button" class="icon-btn" aria-label={m.branch_panel_close()} onclick={onClose}>
					<IconClose aria-hidden="true" />
				</button>
			</Tooltip>
		</div>
	</div>

	{#if errorText}
		<div class="error-banner" role="alert">{m.branch_panel_error({ error: errorText })}</div>
	{/if}
	{#if blockedReason && tree && tree.rows.length > 0}
		<div class="blocked-banner" role="status">{blockedReason}</div>
	{/if}

	<div class="panel-body">
		{#if !tree && loading}
			<div class="empty">{m.branch_panel_loading()}</div>
		{:else if tree && tree.rows.length === 0}
			<div class="empty">{m.branch_panel_empty()}</div>
		{:else if tree}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<ul class="rows" role="tree" aria-label={m.branch_panel_aria()} bind:this={listEl} onkeydown={handleListKeydown}>
				{#each tree.rows as row (row.entryId)}
					<li
						class="row"
						class:active={row.active}
						class:current={row.current}
						class:branch-start={row.branchStart}
						role="treeitem"
						aria-selected={row.current}
						aria-level={row.depth + 1}
						style:--depth={row.depth}
					>
						<button
							type="button"
							class="row-main"
							data-entry-id={row.entryId}
							tabindex={row.entryId === focusedId ? 0 : -1}
							title={row.active ? undefined : (blockedReason ?? m.branch_action_switch_hint())}
							aria-disabled={!row.active && !canBranch ? 'true' : undefined}
							onclick={(event) => activate(event, row)}
							oncontextmenu={(event) => openRowMenu(event, row)}
							onfocus={() => (focusedId = row.entryId)}
						>
							<span class="dot" aria-hidden="true"></span>
							<span class="text">
								{#if row.label}<span class="label-chip">{row.label}</span>{/if}
								{row.text || '…'}
							</span>
							<span class="meta">
								{#if row.current}
									<span class="here">{m.branch_panel_current()}</span>
								{:else if row.forks > 0}
									<span class="forks">{m.branch_panel_forks({ count: row.forks })}</span>
								{/if}
								<span class="time">{timeLabel(row)}</span>
							</span>
						</button>
						<button
							type="button"
							class="row-more"
							tabindex="-1"
							aria-label={m.branch_panel_selected_actions()}
							onclick={(event) => openRowMenu(event, row, event.currentTarget as HTMLElement)}
						>
							<IconMore aria-hidden="true" />
						</button>
					</li>
				{/each}
			</ul>
			{#if tree.branchPoints === 0}
				<p class="hint">{m.branch_panel_linear()}</p>
			{/if}
		{/if}
	</div>

	<div class="panel-foot">
		<p class="note">{m.branch_panel_note()}</p>
		<button type="button" class="ui-button ui-button-ghost foot-btn" onclick={() => hooks.switchToTerminal()}>
			{m.branch_panel_open_in_terminal()}
		</button>
	</div>
</div>

<style>
	.drawer-backdrop {
		position: absolute;
		inset: 0;
		background: var(--backdrop);
		z-index: var(--z-backdrop);
	}

	.branch-panel {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 85%;
		max-width: 520px;
		background: var(--bg-overlay);
		box-shadow: var(--shadow-overlay);
		display: flex;
		flex-direction: column;
		z-index: var(--z-dialog);
		overflow: hidden;
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--line);
	}

	.head-info {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.glyph {
		--icon-size: 16px;
		color: var(--brand-ink);
		display: inline-flex;
		align-items: center;
	}

	.title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.head-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.icon-btn {
		--icon-size: 15px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink-faint);
		cursor: pointer;
		transition:
			color var(--dur-fast) var(--ease-out),
			background-color var(--dur-fast) var(--ease-out);
	}

	.icon-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.icon-btn.spinning :global(svg) {
		animation: branch-spin 900ms linear infinite;
	}

	@keyframes branch-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.icon-btn.spinning :global(svg) {
			animation: none;
		}
	}

	.error-banner,
	.blocked-banner {
		padding: var(--space-1) var(--space-3);
		background: var(--bg-sunken);
		font-size: var(--text-trace);
		border-bottom: 1px solid var(--line);
	}

	.error-banner {
		color: var(--danger);
	}

	.blocked-banner {
		color: var(--ink-muted);
	}

	.panel-body {
		flex: 1;
		/* Senza min-height: 0 il flex item non si comprime e la lista non scorre. */
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-2) var(--space-2) var(--space-3);
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.row {
		--rail: calc(var(--depth) * 16px);
		position: relative;
		display: flex;
		align-items: stretch;
		padding-left: var(--rail);
		border-radius: var(--radius-md);
	}

	/* Rotaia verticale del ramo: collega i nodi alla stessa profondita'. */
	.row::before {
		content: '';
		position: absolute;
		left: calc(var(--rail) + 13px);
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--line);
	}

	.row.active::before {
		background: color-mix(in oklch, var(--brand) 55%, var(--line));
	}

	/* Il primo nodo di un ramo alternativo si stacca con un gomito dal nodo sopra. */
	.row.branch-start::after {
		content: '';
		position: absolute;
		left: calc(var(--rail) - 3px);
		top: 0;
		width: 16px;
		height: 50%;
		border-left: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		border-bottom-left-radius: 6px;
	}

	.row-main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px var(--space-2) 6px 8px;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-trace);
		line-height: 1.45;
		text-align: left;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.row-main:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.row-main:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.row.active .row-main {
		color: var(--ink);
	}

	.row.current .row-main {
		background: var(--bg-active);
	}

	.dot {
		position: relative;
		z-index: 1;
		flex-shrink: 0;
		width: 9px;
		height: 9px;
		border-radius: var(--radius-full);
		border: 1.5px solid var(--ink-faint);
		background: var(--bg-overlay);
	}

	.row.active .dot {
		border-color: var(--brand);
		background: var(--brand);
	}

	.row.current .dot {
		box-shadow: 0 0 0 3px color-mix(in oklch, var(--brand) 25%, transparent);
	}

	.text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.label-chip {
		display: inline-block;
		margin-right: var(--space-1);
		padding: 0 5px;
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
	}

	.meta {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.here {
		color: var(--brand-ink);
		font-weight: 500;
	}

	.row-more {
		--icon-size: 14px;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		margin-left: 2px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		cursor: pointer;
		opacity: 0;
		transition:
			opacity var(--dur-fast) var(--ease-out),
			background var(--dur-fast) var(--ease-out);
	}

	.row:hover .row-more,
	.row:focus-within .row-more {
		opacity: 1;
	}

	.row-more:hover {
		background: var(--bg-hover);
		color: var(--ink-muted);
	}

	.empty,
	.hint {
		color: var(--ink-faint);
		font-size: var(--text-trace);
		line-height: 1.5;
	}

	.empty {
		padding: var(--space-4) 0;
		text-align: center;
		font-style: italic;
	}

	.hint {
		margin: var(--space-3) var(--space-2) 0;
	}

	.panel-foot {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--line);
		background: var(--bg-surface);
	}

	.note {
		flex: 1;
		margin: 0;
		font-size: var(--text-meta);
		line-height: 1.45;
		color: var(--ink-faint);
	}

	.foot-btn {
		flex-shrink: 0;
	}
</style>
