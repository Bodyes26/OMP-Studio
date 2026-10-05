<script lang="ts">
	import { untrack } from 'svelte';
	import { ask } from '@tauri-apps/plugin-dialog';
	import { m } from '$lib/paraglide/messages.js';
	import { taskStore, type StudioTask } from '$lib/stores/tasks.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { roleBadge, splitTaskText, taskLabel } from '$lib/stores/taskTitle';
	import { requestTaskTitle } from '$lib/stores/taskTitles';
	import { contextMenu, type ContextMenuEntry } from '$lib/contextMenu.svelte';
	import {
		IconArrowDown,
		IconArrowUp,
		IconChevronDown,
		IconChevronUp,
		IconCopy,
		IconGitBranch,
		IconGrip,
		IconPencil,
		IconPlay,
		IconTrash
	} from '$lib/icons';
	import Markdown from '$lib/agent/components/Markdown.svelte';
	import { lexMarkdownWithMentions } from '$lib/agent/markdown';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';

	/**
	 * Un task della coda, condiviso da pannello Agente e cassetto globale.
	 *
	 * - Il click sul testo del prompt apre/chiude i dettagli senza mai avviare il task.
	 * - I task non in coda (in_progress, completed, abandoned) consentono anch'essi la lettura completa.
	 * - I pulsanti espliciti "Avvia" e "Modifica" sono sempre visibili senza hover.
	 * - "Avvia" supporta Shift (nuova corsia isolata) e Ctrl (follow).
	 */
	let {
		task,
		blocked = false,
		attention = false,
		blockedTitle = '',
		explainId,
		explainOpen = false,
		reorderable = false,
		maxDirectives = 2,
		onLaunch,
		onEdit,
		onOpenFile
	}: {
		task: StudioTask;
		/** Il cancello non instrada: "Avvia" spiega il blocco invece di partire. */
		blocked?: boolean;
		attention?: boolean;
		blockedTitle?: string;
		/** Riquadro che spiega il blocco, per `aria-controls`. */
		explainId?: string;
		explainOpen?: boolean;
		/** Maniglia con riordino da tastiera (Alt+freccia): solo nel pannello. */
		reorderable?: boolean;
		maxDirectives?: number;
		onLaunch: (options: { shiftKey: boolean; ctrlKey: boolean }) => void;
		onEdit: () => void;
		onOpenFile?: (path: string) => void;
	} = $props();

	let expanded = $state(false);
	let overflowing = $state(false);
	let bodyEl = $state<HTMLElement | null>(null);
	const isCards = $derived((settingsStore.appearance.queueView ?? 'compact') === 'cards');
	const text = $derived(splitTaskText(task));
	const label = $derived(taskLabel(task) || m.queue_drawer_title_new_task());
	const role = $derived(roleBadge(task.options?.role));
	const imageCount = $derived(task.images?.length ?? 0);
	const launchDisabled = $derived(!task.prompt.trim() && imageCount === 0);
	const isQueued = $derived(task.status === 'queued');
	const finished = $derived(task.status === 'completed' || task.status === 'abandoned');
	const directives = $derived(task.options?.directives ?? []);
	// Mostra un'intestazione separata solo se il titolo e' stato generato dall'IA
	// e quindi non fa parte del testo del prompt. Se invece l'utente ha scritto
	// un titolo markdown (# ...) o una prima riga, l'intero prompt viene reso in un
	// unico blocco Markdown in .body per evitare salti di layout tra anteprima ed espansione.
	const showHeadline = $derived(
		Boolean(text.headline && text.headlineSource === 'generated')
	);
	const promptContent = $derived.by(() => {
		const trimmed = task.prompt.trim();
		if (trimmed) return trimmed;
		if (imageCount > 0) return m.queue_drawer_attached_images({ count: imageCount });
		return m.agent_panel_empty_prompt();
	});
	const tokens = $derived(lexMarkdownWithMentions(promptContent));


	// Rendering = task visibile: e' qui che parte il recupero dei titoli
	// mancanti. Si seguono solo i campi di questo task: `taskById` legge
	// l'intera lista e ogni modifica altrui riavvierebbe l'attesa.
	$effect(() => {
		void [task.prompt, task.title, task.titleHash, task.status, settingsStore.taskTitles.autoGenerate];
		untrack(() => requestTaskTitle(task.id));
	});

	// "Leggi tutto" appare solo quando il contenuto eccede le 3 righe (altezza massima di collasso).
	// La misura usa ResizeObserver ed e' dinamica rispetto a larghezza e densita'.
	// All'espansione, aggiorniamo --expanded-height con lo scrollHeight esatto per consentire
	// una transizione di altezza fluida senza salti o ritardi.
	$effect(() => {
		const el = bodyEl;
		if (!el) return;
		void promptContent;
		void isCards;

		const updateMeasure = () => {
			if (!expanded) {
				overflowing = el.scrollHeight > el.clientHeight + 1;
			} else {
				el.style.setProperty('--expanded-height', `${el.scrollHeight}px`);
			}
		};

		updateMeasure();
		const observer = new ResizeObserver(updateMeasure);
		observer.observe(el);
		return () => observer.disconnect();
	});

	$effect(() => {
		const el = bodyEl;
		if (!el) return;
		if (expanded) {
			el.style.setProperty('--expanded-height', `${el.scrollHeight}px`);
		}
	});

	function handlePromptClick(event: MouseEvent) {
		if (event.button !== 0) return;
		// Menzioni, pulsanti e link hanno la propria azione.
		if ((event.target as Element | null)?.closest('button, a, input, [role="button"]')) return;
		// Chi sta selezionando del testo non sta chiedendo di espandere/collassare.
		if (window.getSelection()?.toString()) return;
		if (!overflowing && !expanded) return;
		expanded = !expanded;
	}

	function handleMoveKey(event: KeyboardEvent) {
		if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
		event.preventDefault();
		taskStore.moveTaskBy(task.id, event.key === 'ArrowUp' ? -1 : 1);
	}

	async function confirmDelete() {
		const confirmed = await ask(m.queue_task_delete_confirm_message({ title: label }), {
			title: m.queue_task_delete_confirm_title(),
			kind: 'warning',
			okLabel: m.queue_task_delete_confirm_ok(),
			cancelLabel: m.common_cancel()
		});
		if (confirmed) taskStore.deleteTask(task.id);
	}

	function openMenu(event: MouseEvent) {
		event.stopPropagation();
		const siblings = taskStore.tasksFor(task.projectPath).filter((t) => t.status !== 'dispatching');
		const index = siblings.findIndex((t) => t.id === task.id);
		const items: ContextMenuEntry[] = [
			{
				kind: 'item',
				label: m.queue_drawer_run_btn(),
				icon: IconPlay,
				disabled: launchDisabled,
				run: () => onLaunch({ shiftKey: false, ctrlKey: false })
			},
			{
				kind: 'item',
				label: m.queue_task_new_lane(),
				icon: IconGitBranch,
				shortcut: 'Shift+Click',
				disabled: launchDisabled,
				run: () => onLaunch({ shiftKey: true, ctrlKey: false })
			},
			{ kind: 'item', label: m.queue_drawer_edit_btn_title(), icon: IconPencil, run: onEdit },
			{
				kind: 'item',
				label: m.queue_task_menu_copy(),
				icon: IconCopy,
				disabled: !task.prompt.trim(),
				run: () => navigator.clipboard.writeText(task.prompt)
			},
			{ kind: 'separator' },
			{
				kind: 'item',
				label: m.queue_task_menu_move_up(),
				icon: IconArrowUp,
				shortcut: 'Alt+↑',
				disabled: index <= 0,
				run: () => taskStore.moveTaskBy(task.id, -1)
			},
			{
				kind: 'item',
				label: m.queue_task_menu_move_down(),
				icon: IconArrowDown,
				shortcut: 'Alt+↓',
				disabled: index < 0 || index >= siblings.length - 1,
				run: () => taskStore.moveTaskBy(task.id, 1)
			},
			{ kind: 'separator' },
			{ kind: 'item', label: m.queue_task_menu_delete(), icon: IconTrash, danger: true, run: confirmDelete }
		];
		contextMenu.open(event, {
			label: m.queue_task_menu_label({ title: label }),
			items,
			invoker: event.currentTarget as HTMLElement
		});
	}
</script>

<div
	class="queue-task"
	role="group"
	aria-label={label}
	class:cards={isCards}
	class:blocked={blocked && isQueued}
	oncontextmenu={openMenu}
>
	{#if reorderable}
		<Tooltip text={m.agent_panel_reorder_handle_title()} placement="top" offset={6}>
			<button
				type="button"
				class="grip"
				aria-label={m.agent_panel_reorder_handle_aria({ title: label })}
				onkeydown={handleMoveKey}
			>
				<IconGrip />
			</button>
		</Tooltip>
	{/if}

	<div class="content">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="prompt-text"
			onclick={handlePromptClick}
		>
			{#if showHeadline && text.headline}
				<div class="head">
					<span class="headline" class:finished>
						{text.headline}
					</span>
					{#if role}<span class="chip role">{role}</span>{/if}
				</div>
			{/if}

			<div
				id={`queue-task-body-${task.id}`}
				class="body dense"
				class:expanded
				class:finished
				class:placeholder={!task.prompt.trim()}
				class:overflowing={overflowing && !expanded}
				bind:this={bodyEl}
			>
				<Markdown {tokens} {onOpenFile} />
			</div>

			{#if overflowing || expanded}
				<button
					type="button"
					class="read-more"
					aria-expanded={expanded}
					aria-controls={`queue-task-body-${task.id}`}
					onclick={(e) => {
						e.stopPropagation();
						expanded = !expanded;
					}}
				>
					{expanded ? m.queue_task_read_less() : m.queue_task_read_more()}
					{#if expanded}<IconChevronUp />{:else}<IconChevronDown />{/if}
				</button>
			{/if}
		</div>

		<div class="chips">
			{#if task.status === 'in_progress'}
				<span class="chip status in-progress">
					<StatusMark status="running" active={true} />
					<span>{m.queue_drawer_status_in_progress()}</span>
				</span>
			{:else if task.status === 'completed'}
				<span class="chip status completed">
					<StatusMark status="completed" />
					<span>{m.queue_drawer_status_completed()}</span>
				</span>
			{:else if task.status === 'abandoned'}
				<span class="chip status abandoned">
					<StatusMark status="failed" active={false} />
					<span>{m.queue_drawer_status_abandoned()}</span>
				</span>
			{/if}
			{#if role && (!showHeadline || !text.headline)}<span class="chip role">{role}</span>{/if}
			{#each directives.slice(0, maxDirectives) as d (d.id)}
				<span class="chip mode">{d.name}</span>
			{/each}
			{#if directives.length > maxDirectives}
				<span class="chip mode" title={directives.slice(maxDirectives).map((d) => d.name).join(', ')}>
					+{directives.length - maxDirectives}
				</span>
			{/if}
			{#if imageCount > 0 && (text.body || text.headline)}
				<span class="chip img">img {imageCount}</span>
			{/if}
		</div>

		{#if isQueued}
			<div class="actions">
				<button
					type="button"
					class="ui-button ui-button-secondary action run"
					class:blocked
					class:attention={blocked && attention}
					disabled={launchDisabled}
					aria-expanded={blocked ? explainOpen : undefined}
					aria-controls={blocked ? explainId : undefined}
					aria-label={blocked
						? m.gate_explain_task_aria({ title: label })
						: m.ui_queuedrawer_avvia_task_value1_0055({ value1: label })}
					title={blocked ? blockedTitle : m.ui_agentpanel_avvia_value1_18da({ value1: label })}
					onclick={(event) => onLaunch({ shiftKey: event.shiftKey, ctrlKey: event.ctrlKey || event.metaKey })}
				>
					<IconPlay />
					<span>{m.queue_drawer_run_btn()}</span>
				</button>
				<button
					type="button"
					class="ui-button ui-button-secondary action lane"
					disabled={launchDisabled}
					title={m.queue_task_new_lane_title()}
					onclick={(event) => onLaunch({ shiftKey: true, ctrlKey: event.ctrlKey || event.metaKey })}
				>
					<IconGitBranch />
					<span>{m.queue_task_new_lane()}</span>
				</button>
			</div>
		{/if}
	</div>

	<Tooltip text={m.queue_drawer_edit_btn_title()} placement="top" offset={6}>
		<button
			type="button"
			class="edit"
			onclick={onEdit}
			aria-label={m.agent_panel_edit_task_aria({ title: label })}
		>
			<IconPencil />
		</button>
	</Tooltip>
</div>

<style>
	/* `--queue-task-surface` e' lo sfondo opaco sotto la riga. */
	.queue-task {
		--queue-task-hover: color-mix(in srgb, var(--ink) 10%, var(--queue-task-surface, var(--bg-base)));
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 26px;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-1) var(--space-2) var(--space-2);
		border-bottom: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.queue-task:has(.grip) {
		grid-template-columns: 18px minmax(0, 1fr) 26px;
		padding-left: var(--space-1);
	}

	.queue-task:hover,
	.queue-task:focus-within {
		background: var(--queue-task-hover);
	}

	.queue-task.cards {
		padding: var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--queue-task-surface, var(--bg-base));
	}

	.queue-task.cards:hover,
	.queue-task.cards:focus-within {
		border-color: var(--line-strong);
		background: var(--queue-task-hover);
	}

	.grip,
	.edit,
	.read-more,
	.action {
		border: 0;
		background: transparent;
		font: inherit;
	}

	.grip,
	.edit {
		align-self: start;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 22px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-faint);
	}

	.grip {
		width: 18px;
		cursor: grab;
		--icon-size: 14px;
	}

	.grip:active {
		cursor: grabbing;
	}

	.edit {
		width: 24px;
		cursor: pointer;
		--icon-size: 13px;
	}

	.grip:hover,
	.edit:hover {
		color: var(--ink);
		background: var(--bg-hover);
		border-color: var(--line);
	}

	.grip:focus-visible,
	.edit:focus-visible,
	.read-more:focus-visible,
	.action:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.content {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.prompt-text {
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.head {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		min-width: 0;
	}

	.headline {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
		font-size: var(--text-label);
		font-weight: 600;
		line-height: 1.35;
	}

	.cards .headline {
		white-space: normal;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow-wrap: anywhere;
	}

	/* Il prompt viene reso in Markdown sia compatto che espanso.
	   Collassato: max-height = 3 righe (3 x 1.5em) con sfumatura inferiore quando eccede.
	   Espanso: transizione con --dur-tray e --ease-reveal mantenendo la stessa dimensione
	   del testo (nessun ingrandimento a --text-chat). */
	.body {
		margin: 0;
		max-height: calc(3 * 1.5em);
		overflow: hidden;
		color: var(--ink-muted);
		font-size: var(--text-caption);
		line-height: 1.5;
		overflow-wrap: anywhere;
		transition: max-height var(--dur-tray) var(--ease-reveal);
	}

	.cards .body {
		font-size: var(--text-label);
	}

	.body.expanded {
		max-height: var(--expanded-height, 2000px);
	}

	.body.overflowing {
		-webkit-mask-image: linear-gradient(to bottom, var(--ink) calc(100% - 1.5em), transparent);
		mask-image: linear-gradient(to bottom, var(--ink) calc(100% - 1.5em), transparent);
	}

	.body.placeholder {
		color: var(--ink-faint);
		font-style: italic;
	}

	/* Markdown compatto specifico per la coda dei task.
	   Intestazioni h1-h6 alla stessa dimensione del testo (peso 600),
	   spaziatura verticale minima (4px) per mostrare contenuti utili in 3 righe. */
	.body.dense :global(.heading) {
		font-size: 1em;
		font-weight: 600;
		line-height: inherit;
		margin: var(--space-1) 0;
		color: var(--ink);
	}

	.body.dense :global(.heading:first-child) {
		margin-top: 0;
	}

	.body.dense :global(.paragraph) {
		margin: 0 0 var(--space-1) 0;
		line-height: inherit;
		color: inherit;
	}

	.body.dense :global(.paragraph:last-child) {
		margin-bottom: 0;
	}

	.body.dense :global(.list) {
		margin: 0 0 var(--space-1) 0;
		padding-left: var(--space-3);
		line-height: inherit;
	}

	.body.dense :global(.list:last-child) {
		margin-bottom: 0;
	}

	.body.dense :global(.list-item) {
		margin: 2px 0;
	}

	.body.dense :global(.blockquote) {
		margin: var(--space-1) 0;
		padding: 0 0 0 var(--space-2);
		border-left: 2px solid var(--line);
		color: var(--ink-muted);
	}

	.body.dense :global(.codespan) {
		font-size: 0.92em;
	}

	.body.dense :global(.code-block) {
		font-size: 0.92em;
		margin: var(--space-1) 0;
	}

	.body.dense :global(.file-chips-block) {
		font-size: 0.92em;
		margin: var(--space-1) 0;
	}

	.body.dense :global(.table-wrap) {
		margin: var(--space-1) 0;
	}

	.body.dense :global(.hr) {
		margin: var(--space-1) 0;
	}

	.body.dense :global(.text-block),
	.body.dense :global(.generic-block) {
		margin: 0 0 var(--space-1) 0;
		line-height: inherit;
	}

	.finished {
		text-decoration: line-through;
		color: var(--ink-faint);
	}

	.read-more {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 0;
		border-radius: var(--radius-md);
		color: var(--brand-ink);
		font-size: var(--text-caption);
		font-weight: 600;
		cursor: pointer;
		--icon-size: 12px;
	}

	.cards .read-more {
		font-size: var(--text-label);
	}

	.read-more:hover {
		text-decoration: underline;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
	}

	.chips:empty {
		display: none;
	}

	.chip {
		max-width: 100%;
		overflow: hidden;
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip.role {
		flex-shrink: 0;
		background: var(--brand-dim);
		color: var(--ink);
		font-weight: 600;
	}

	.chip.mode {
		border: 1px solid var(--line);
	}

	.chip.img {
		color: var(--ink-faint);
	}

	.chip.status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.chip.status.in-progress {
		color: var(--ink);
	}

	.chip.status.completed {
		color: var(--ink-muted);
	}

	.chip.status.abandoned {
		color: var(--danger);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		margin-top: 2px;
	}

	.cards .actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-1);
		margin-top: 2px;
	}

	.action {
		min-width: 0;
		height: 22px;
		padding: 0 var(--space-2);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-caption);
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		--icon-size: 12px;
	}

	.cards .action {
		height: 24px;
		font-size: var(--text-label);
	}

	.action span {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.action:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.action.run:not(.blocked) {
		border-color: color-mix(in srgb, var(--brand) 40%, transparent);
		background: var(--brand-dim);
		color: var(--ink);
	}

	.action.run:not(.blocked):hover:not(:disabled) {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand-dim) 80%, var(--bg-hover));
	}

	.action.run.blocked {
		cursor: help;
	}

	.action.run.attention {
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
		color: var(--warn);
	}

	.action.run.attention:hover:not(:disabled) {
		border-color: var(--warn);
		background: color-mix(in srgb, var(--warn) 10%, transparent);
	}

	.action:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	@media (prefers-reduced-motion: no-preference) {
		.queue-task,
		.action {
			transition:
				background-color var(--dur-fast) var(--ease-out),
				border-color var(--dur-fast) var(--ease-out);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.body {
			transition: none;
		}
	}

	:root[data-animations="false"] .body {
		transition: none;
	}
</style>
