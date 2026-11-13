<script lang="ts">
	/**
	 * Coda rapida di un progetto, vista interna del popover dei tab (TPR-012..017).
	 *
	 * Vive dentro la card del popover: non ha testata, pulsante Indietro o X —
	 * li rende il genitore. Lo stato del popover resta al genitore; qui c'e'
	 * solo il contenuto della coda di un progetto.
	 *
	 * Cosa mostra:
	 * - in alto l'avvio automatico del progetto con `Switch`, con la label
	 *   cliccabile che attiva lo switch (TPR-012);
	 * - ogni task con titolo e badge del modello con il logo del provider
	 *   risolto dai contratti reali della coda, e nient'altro (TPR-013);
	 * - quattro azioni sempre presenti come icone che si espandono al passaggio
	 *   del puntatore o al fuoco: Avvia, Avvia su nuovo worktree, Modifica,
	 *   Programma (TPR-014). Titolo e badge del task non si spostano.
	 *
	 * Niente «Nuovo task», niente elenco delle code degli altri progetti, niente
	 * prompt: quelle azioni restano dove sono sempre state (TPR-017).
	 */
	import { m } from '#lib/paraglide/messages.js';
	import { taskStore, type StudioTask } from '#lib/stores/tasks.svelte.ts';
	import { projectStore, type Project } from '#lib/stores/projects.svelte.ts';
	import { taskLabel } from '#lib/stores/taskTitle.ts';
	import { resolveTaskModelBadge } from './taskModelBadge.ts';
	import { IconGitBranch, IconPencil, IconPlay, IconWarning } from '#lib/icons.ts';
	import Switch from '#lib/ui/Switch.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import ProviderLogo from './models/ProviderLogo.svelte';
	import ScheduleMenu from './schedule/ScheduleMenu.svelte';

	interface Props {
		project: Project;
		/**
		 * Avvio in background (TPR-015): la card resta aperta. Con `follow` la
		 * card si chiude dopo che la callback ha risposto, cosi' un avvio
		 * rifiutato resta leggibile. `newWorktree` chiede una corsia isolata: la
		 * rotta la decide il dispatcher reale, non questo componente.
		 * Restituisce true solo dopo l'avvio; false indica una conferma ancora
		 * aperta, non un task gia' partito.
		 */
		onRunTask?: (
			projectId: string,
			taskId: string,
			follow: boolean,
			newWorktree?: boolean
		) => boolean | Promise<boolean>;
		/** Apre il progetto e il task nel Task Editor esistente. */
		onEditTask?: (projectId: string, taskId: string) => void;
		/** Informa sul blocco corrente, senza duplicare il routing del dispatcher. */
		canRunTask?: (projectId: string) => boolean;
		runReason?: (projectId: string) => string;
		/** Chiude l'intero popover. */
		onClose: () => void;
	}

	let { project, onRunTask, onEditTask, canRunTask, runReason, onClose }: Props = $props();

	/**
	 * Avvii in corso, per chiave `progetto:task`. Non si azzera al cambio di
	 * progetto: l'operazione del destinatario precedente resta in volo e, se si
	 * torna su quella coda, il pulsante deve essere ancora spento.
	 */
	let inFlight = $state<string[]>([]);
	let error = $state('');
	/** Destinatario dell'errore: un esito in ritardo non parla di un altro progetto. */
	let errorProjectId = $state<string | null>(null);
	/** Conferma breve dell'avvio riuscito: la card resta aperta e lo stato e' visibile. */
	let startedLabel = $state('');
	let startedTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Coda del progetto dal contratto reale (`tasksFor`): solo le voci in
	 * attesa. Un task gia' in corso o concluso non si avvia e non si programma,
	 * e mostrarlo qui con quattro icone spente sarebbe una promessa falsa.
	 */
	const tasks = $derived(
		project.canonicalProjectPath
			? taskStore.tasksFor(project.canonicalProjectPath).filter((task) => task.status === 'queued')
			: []
	);
	const ready = $derived(canRunTask?.(project.id) ?? false);
	const reason = $derived(runReason?.(project.id) ?? '');
	const autoDispatchId = $derived(`popover-auto-dispatch-${project.id}`);
	const autoDispatchLabelId = $derived(`${autoDispatchId}-label`);
	/** Il task di questa coda attualmente in avvio, se c'e'. */
	const runningLabel = $derived.by(() => {
		const running = tasks.find((task) => inFlight.includes(flightKey(project.id, task.id)));
		return running ? labelOf(running) : '';
	});

	// Cambio progetto: la vista resta montata e cambia destinatario, quindi gli
	// stati locali di questo destinatario si azzerano invece di raccontare il
	// precedente. Gli avvii ancora in volo restano tracciati: sono di un'altra
	// coda e devono ritrovare il pulsante spento se ci si torna.
	let mountedProjectId: string | null = null;
	$effect(() => {
		if (project.id === mountedProjectId) return;
		mountedProjectId = project.id;
		error = '';
		errorProjectId = null;
		startedLabel = '';
		clearTimeout(startedTimer);
	});

	$effect(() => () => clearTimeout(startedTimer));

	/** Chiave stabile di un avvio: progetto e task, non un solo id che si ripete. */
	function flightKey(projectId: string, taskId: string): string {
		return `${projectId}:${taskId}`;
	}

	/** Il titolo del task, con gli stessi ripieghi della coda reale. */
	function labelOf(task: StudioTask): string {
		return (
			taskLabel(task) ||
			(task.images?.length ? m.queue_drawer_title_only_images() : m.queue_drawer_title_new_task())
		);
	}

	/** Stesso limite reale di `QueueTaskItem`: un prompt vuoto senza immagini non parte. */
	function hasContent(task: StudioTask): boolean {
		return Boolean(task.prompt.trim()) || (task.images?.length ?? 0) > 0;
	}

	function launchDisabled(task: StudioTask): boolean {
		return inFlight.includes(flightKey(project.id, task.id)) || !hasContent(task);
	}

	function showError(message: string) {
		error = message;
		errorProjectId = project.id;
	}

	/**
	 * Avvio in background. Il destinatario si cattura prima dell'await: un cambio
	 * di progetto nel frattempo non deve chiudere la card sbagliata ne' scrivere
	 * l'esito nella vista di un altro progetto.
	 *
	 * Il gate non spegne il pulsante: `Principale` occupata non e' un blocco, e'
	 * una deviazione che il dispatcher reale sa fare (corsia nuova o domanda di
	 * concorrenza). Un blocco vero torna dal dispatcher e finisce nella riga di
	 * stato, quindi nessuna partenza finta e nessun silenzio. `reason` resta nel
	 * tooltip per dire prima del click cosa sta occupando la corsia.
	 */
	async function run(task: StudioTask, follow: boolean, newWorktree: boolean) {
		if (!onRunTask || launchDisabled(task)) return;
		const projectId = project.id;
		const taskId = task.id;
		const key = flightKey(projectId, taskId);
		inFlight = [...inFlight, key];
		error = '';
		errorProjectId = null;
		try {
			const started = await onRunTask(projectId, taskId, follow, newWorktree || undefined);
			if (!started) return;
			if (project.id !== projectId) return;
			if (follow) {
				onClose();
				return;
			}
			// Avvio in background riuscito: la card resta aperta e dice cosa e'
			// partito, cosi' il click non sembra non aver fatto nulla.
			clearTimeout(startedTimer);
			startedLabel = labelOf(task);
			startedTimer = setTimeout(() => (startedLabel = ''), 4000);
		} catch (failure) {
			if (project.id === projectId) {
				showError(failure instanceof Error ? failure.message : String(failure));
			}
		} finally {
			inFlight = inFlight.filter((entry) => entry !== key);
		}
	}

	/** Modifica apre progetto e task nell'editor esistente e chiude la card. */
	function edit(task: StudioTask) {
		if (!onEditTask) return;
		const projectId = project.id;
		onEditTask(projectId, task.id);
		if (project.id === projectId) onClose();
	}

	/** Una sola riga di stato: esito, avvio in corso. Niente spiegazioni fisse. */
	const hasNotice = $derived(
		Boolean((error && errorProjectId === project.id) || startedLabel || runningLabel)
	);

	function runTitle(task: StudioTask): string {
		if (!hasContent(task)) return m.agent_panel_empty_prompt();
		return ready
			? m.ui_projectpopover_avvia_in_background_ctrl_click_avvia_e_6a02()
			: reason || m.topbar_queue_not_runnable();
	}
</script>

<div class="queue-view">
	<div class="auto-row">
		<label class="auto-label" for={autoDispatchId} id={autoDispatchLabelId}>
			{m.project_tabs_queue_auto_dispatch()}
		</label>
		<Tooltip
			text={project.autoDispatch
				? m.project_tabs_queue_auto_dispatch_on_tip()
				: m.project_tabs_queue_auto_dispatch_off_tip()}
			placement="top"
			offset={6}
		>
			<Switch
				id={autoDispatchId}
				checked={project.autoDispatch}
				ariaLabelledBy={autoDispatchLabelId}
				onChange={(checked) => projectStore.setAutoDispatch(project.id, checked)}
			/>
		</Tooltip>
	</div>

	{#if tasks.length === 0}
		<p class="empty">{m.project_tabs_queue_empty()}</p>
	{:else}
		<ul class="task-list" aria-label={m.queue_drawer_project_tasks_aria({ project: project.name })}>
			{#each tasks as task (task.id)}
				{@const badge = resolveTaskModelBadge(task)}
				{@const label = labelOf(task)}
				{@const disabled = launchDisabled(task)}
				<li class="task">
					<div class="task-head">
						<span class="task-title" title={label}>{label}</span>
						<Tooltip text={badge.tooltip} placement="top" offset={4}>
							<span class="model-badge" class:session={badge.isSession}>
								{#if badge.provider}
									<ProviderLogo provider={badge.provider} size={11} />
								{/if}
								<span class="model-name">{badge.label}</span>
							</span>
						</Tooltip>
					</div>
					<div class="actions">
						<Tooltip text={runTitle(task)} placement="top" offset={6}>
							<button
								type="button"
								class="action"
								{disabled}
								aria-label={m.project_tabs_queue_run_aria({ task: label })}
								onclick={(event) => void run(task, event.ctrlKey || event.metaKey, false)}
							>
								<IconPlay />
								<span class="action-label" aria-hidden="true">{m.queue_drawer_run_btn()}</span>
							</button>
						</Tooltip>
						<Tooltip text={m.project_tabs_queue_worktree_title()} placement="top" offset={6}>
							<button
								type="button"
								class="action"
								{disabled}
								aria-label={m.project_tabs_queue_worktree_aria({ task: label })}
								onclick={(event) => void run(task, event.ctrlKey || event.metaKey, true)}
							>
								<IconGitBranch />
								<span class="action-label" aria-hidden="true">{m.project_tabs_queue_worktree()}</span>
							</button>
						</Tooltip>
						<Tooltip text={m.project_popover_edit_task_title()} placement="top" offset={6}>
							<button
								type="button"
								class="action"
								disabled={!onEditTask}
								aria-label={m.project_popover_edit_task_aria({ task: label })}
								onclick={() => edit(task)}
							>
								<IconPencil />
								<span class="action-label" aria-hidden="true">{m.queue_drawer_edit_btn()}</span>
							</button>
						</Tooltip>
						<ScheduleMenu
							task={task}
							align="right"
							size="row"
							label={m.project_tabs_queue_schedule()}
						/>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<!-- Regione di stato sempre presente: un annuncio che nasce insieme al testo
	     non viene letto dagli screen reader. -->
	<p
		class="notice"
		class:error={Boolean(error) && errorProjectId === project.id}
		class:quiet={!hasNotice}
		role="status"
		aria-live="polite"
	>
		{#if error && errorProjectId === project.id}
			<IconWarning aria-hidden="true" />
			<span>{error}</span>
		{:else if startedLabel}
			<span>{m.project_tabs_queue_started({ task: startedLabel })}</span>
		{:else if runningLabel}
			<span>{m.project_tabs_queue_starting({ task: runningLabel })}</span>
		{/if}
	</p>
</div>

<style>
	.queue-view {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	/* Avvio automatico: etichetta cliccabile e switch sulla stessa linea.
	   Nessuna spiegazione permanente: il perche' sta nel tooltip. */
	.auto-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: 24px;
		margin-bottom: 6px;
	}

	.auto-label {
		font-size: var(--text-label);
		color: var(--ink-muted);
		cursor: pointer;
		user-select: none;
	}

	.auto-row:hover .auto-label {
		color: var(--ink);
	}

	.task-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		/* Elenco lungo: scorre dentro la card, cosi' la riga dell'avvio automatico
		   resta a vista. Il tetto e' lo spazio della tappa del genitore
		   (`min(65vh, --anchored-space - 104px)`) meno i suoi 16+16 px di padding
		   e le due righe qui sopra; `max(180px, ...)` tiene leggibile la lista
		   anche in finestre molto basse, dove poi scorre la card intera. */
		max-height: max(180px, calc(min(65vh, var(--anchored-space, 82vh) - 104px) - 62px));
		overflow-y: auto;
		scrollbar-width: thin;
	}

	.task {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 7px 0;
		min-width: 0;
	}

	.task + .task {
		border-top: 1px solid var(--line);
	}

	.task-head {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		min-width: 0;
	}

	.task-title {
		display: -webkit-box;
		min-width: 0;
		max-width: 100%;
		font-size: var(--text-body, 13px);
		line-height: 1.45;
		color: var(--ink);
		overflow-wrap: anywhere;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.model-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex: 0 1 auto;
		max-width: 100%;
		padding: 0 5px;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-caption);
		line-height: 16px;
		white-space: nowrap;
		overflow: hidden;
	}

	.model-badge.session {
		color: var(--ink-faint);
	}

	.model-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 2px;
		min-width: 0;
	}

	.action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		gap: 0;
		height: 28px;
		min-width: 30px;
		padding: 0 6px;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink-muted);
		font: inherit;
		cursor: pointer;
		overflow: hidden;
		--icon-size: 14px;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.action:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.action:focus-visible {
		background: var(--bg-hover);
		color: var(--ink);
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.action:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.action-label {
		max-width: 0;
		opacity: 0;
		overflow: hidden;
		white-space: nowrap;
		font-size: var(--text-caption);
		transition:
			max-width var(--dur-base) var(--ease-out),
			opacity var(--dur-fast) var(--ease-out),
			margin-left var(--dur-base) var(--ease-out);
	}

	/* Il tetto tiene le quattro azioni dentro i 274 px di contenuto anche con
	   due etichette aperte insieme (puntatore su una, fuoco su un'altra). */
	.action:hover:not(:disabled) .action-label,
	.action:focus-visible .action-label {
		max-width: 68px;
		opacity: 1;
		margin-left: 6px;
	}

	.empty {
		margin: 0;
		padding: 18px 4px;
		text-align: center;
		color: var(--ink-muted);
		font-size: var(--text-label);
	}

	.notice {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 4px 0 0;
		padding: 0 4px;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		overflow-wrap: anywhere;
		--icon-size: 13px;
	}

	/* Nessun annuncio in corso: la riga non occupa spazio ma resta nel DOM per
	   gli screen reader. */
	.notice.quiet {
		margin: 0;
		padding: 0;
		height: 0;
		min-height: 0;
		overflow: hidden;
	}

	.notice.error {
		color: var(--danger);
	}

	.notice :global(svg) {
		flex: none;
		margin-top: 1px;
	}

	@media (prefers-reduced-motion: reduce) {
		.action-label {
			transition: none;
		}
	}

	:global(:root[data-animations='false']) .action-label {
		transition: none;
	}
</style>
