<script lang="ts">
	/**
	 * Vista Git del popover progetti: riepilogo della **Principale** (TPR-018..022).
	 *
	 * - Nessuna testata propria: il genitore rende titolo, pulsante Indietro e X.
	 * - Il branch mostrato viene da Git (`git_branch_list`), non da una preferenza
	 *   locale: riaprire la card mostra sempre il branch effettivo (TPR-019).
	 * - Il nome del branch apre il selettore e il clic esegue un checkout vero,
	 *   lo stesso comando del pannello Git (nessuno stash o reset automatico).
	 * - Checkout chiuso mentre l'agente della Principale lavora o mentre una
	 *   sincronizzazione e' in corso, e ricontrollato al clic (TPR-020).
	 * - Scarica aggiornamenti e' il pull fast-forward esistente, con gli stessi
	 *   blocchi della card precedente (TPR-021).
	 * - Caricamento, errore di lettura, nessun upstream e aggiornato sono stati
	 *   distinti: un dato mancante non diventa mai «Aggiornato» (TPR-022).
	 */
	import { m } from '#lib/paraglide/messages.js';
	import {
		IconArrowDown,
		IconArrowUp,
		IconCheck,
		IconChevronDown,
		IconDownload,
		IconGitBranch,
		IconRefresh
	} from '#lib/icons.ts';
	import { untrack } from 'svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
	import { laneStore } from '#lib/stores/lanes.svelte.ts';
	import { githubStore } from '#lib/stores/github.svelte.ts';
	import {
		gitDiffStore,
		hasGitChanges,
		notifyGitStatusRefresh
	} from '#lib/stores/gitDiff.svelte.ts';
	import { normalizeProjectPath, type Project } from '#lib/stores/projects.svelte.ts';
	import { MAIN_LANE_ID, type ProjectId } from '#lib/types/lanes.ts';
	import {
		branchGateReason,
		checkoutBranch,
		loadBranchPlan,
		type BranchBlockReason,
		type BranchPlan
	} from './projectGitActions.ts';

	let { project }: { project: Project } = $props();

	const canonicalPath = $derived(project.canonicalProjectPath ?? '');
	const canonicalKey = $derived(
		canonicalPath ? normalizeProjectPath(canonicalPath).toLowerCase() : ''
	);

	// Stato remoto e locale arrivano dagli store esistenti, con la stessa chiave
	// del pannello Git: nessuna copia parallela.
	const upstream = $derived(canonicalKey ? (githubStore.upstreamByPath[canonicalKey] ?? null) : null);
	const remoteError = $derived(
		canonicalKey ? (githubStore.remoteErrorByPath[canonicalKey] ?? null) : null
	);
	const isSyncing = $derived(canonicalKey ? Boolean(githubStore.isSyncingByPath[canonicalKey]) : false);
	const diffStats = $derived(canonicalPath ? gitDiffStore.forPath(canonicalPath) : null);

	/** Branch effettivo e selettore: la fonte resta Git. */
	let plan = $state<BranchPlan | null>(null);
	let planLoading = $state(false);
	let planError = $state<string | null>(null);
	let branchMenuOpen = $state(false);
	let branchError = $state<string | null>(null);

	let readFailed = $state(false);

	// Operazioni ed esiti indicizzati per percorso: cambiare progetto non
	// cancella il pull o il checkout chiesto per un altro destinatario, e un
	// esito che arriva tardi non viene applicato alla vista del nuovo progetto.
	// L'esito resta finche' non parte un'altra operazione sullo stesso percorso.
	let pullingPaths = $state<string[]>([]);
	let checkoutTargets = $state<{ path: string; name: string }[]>([]);
	let pullOutcomes = $state<Record<string, { ok: boolean; message: string } | undefined>>({});

	// I contatori non sono reattivi: servono solo a scartare le risposte vecchie.
	let planRequest = 0;
	let remoteRequest = 0;
	let lastProjectId: string | null = null;

	const isPulling = $derived(pullingPaths.includes(canonicalPath));
	const checkoutPending = $derived(
		checkoutTargets.find((target) => target.path === canonicalPath)?.name ?? null
	);
	const pullOutcome = $derived(canonicalPath ? (pullOutcomes[canonicalPath] ?? null) : null);
	/** Lettura remota fallita: il controllo in background puo' averla segnalata. */
	const readFailure = $derived(readFailed || (remoteError !== null && upstream === null));

	/** Agente della Principale al lavoro: sessione viva o corsia principale. */
	const mainBusy = $derived.by(() => {
		const session = sessionRegistry.getMainSession(project.id);
		if (
			session &&
			(session.isStreaming || session.isCompacting || session.agentState === 'working')
		) {
			return true;
		}
		const mainLane = laneStore
			.lanesFor(project.id as ProjectId)
			.find((lane) => lane.laneId === MAIN_LANE_ID);
		return mainLane?.agentState === 'working';
	});

	const gate = $derived(
		branchGateReason({
			agentBusy: mainBusy,
			syncing: isSyncing || isPulling,
			checkoutPending: checkoutPending !== null
		})
	);

	/** Motivo leggibile del blocco del cambio branch (TPR-020). */
	const gateReason = $derived.by(() => {
		if (gate === 'agent') return m.project_tabs_git_branch_blocked_agent();
		if (isPulling) return m.project_tabs_git_branch_blocked_pull();
		if (checkoutPending) return m.project_tabs_git_branch_checkout_in_progress();
		if (gate === 'syncing') return m.project_tabs_git_branch_blocked_syncing();
		return null;
	});

	const branchLabel = $derived(plan?.current || upstream?.branch || '—');
	const branchAria = $derived(
		m.project_tabs_git_branch_aria({ branch: plan?.current || upstream?.branch || '—' })
	);

	/** Modifiche locali: bloccano pull e checkout, per lo stesso motivo reale. */
	const treeDirty = $derived(
		Boolean(upstream?.isGit) &&
			Boolean(upstream?.hasUncommitted || (diffStats && hasGitChanges(diffStats)))
	);

	/** Stessi blocchi del pull della card precedente (TPR-021). */
	const pullReason = $derived.by(() => {
		if (!upstream?.isGit || !upstream.upstream) return null;
		if (checkoutPending) return m.project_tabs_git_branch_checkout_in_progress();
		if (isSyncing || isPulling) return m.project_popover_git_disabled_syncing();
		if (mainBusy) return m.project_popover_git_disabled_working();
		if (treeDirty) return m.project_popover_git_disabled_dirty();
		// Il pulsante compare solo con commit da ricevere: ahead > 0 qui significa
		// che i due lati sono divergenti e serve un intervento manuale.
		if (upstream.ahead > 0) return m.project_popover_git_disabled_diverged();
		return null;
	});

	/** Nel corpo non si annuncia come blocco la propria operazione in corso. */
	const pullHint = $derived(isPulling ? null : pullReason);

	const commitsToReceive = $derived(
		upstream && upstream.isGit && upstream.behind > 0 ? upstream.incomingCommits.slice(0, 5) : []
	);
	const hiddenCommits = $derived(
		upstream ? Math.max(0, upstream.behind - commitsToReceive.length) : 0
	);

	async function readRemote(path: string, force = false) {
		// Una lettura chiesta per un altro destinatario (fine di un checkout su
		// un progetto lasciato nel frattempo) non consuma il turno di questa vista.
		if (path !== canonicalPath) return;
		const token = ++remoteRequest;
		const status = await githubStore.loadUpstreamStatus(path, force);
		// Una risposta di un progetto lasciato nel frattempo non tocca la vista.
		if (token !== remoteRequest || path !== canonicalPath) return;
		// `loadUpstreamStatus` restituisce null solo se la lettura non e' riuscita:
		// un successo, anche senza upstream, popola sempre la mappa dello store.
		readFailed = status === null;
	}

	async function readBranches(path: string) {
		if (path !== canonicalPath) return;
		const token = ++planRequest;
		planLoading = true;
		try {
			const next = await loadBranchPlan(path);
			if (token !== planRequest || path !== canonicalPath) return;
			plan = next;
			planError = null;
		} catch (error) {
			if (token !== planRequest || path !== canonicalPath) return;
			planError = String(error);
		} finally {
			if (token === planRequest) planLoading = false;
		}
	}

	function retryRead() {
		const path = canonicalPath;
		if (!path) return;
		readFailed = false;
		void readRemote(path, true);
		void readBranches(path);
	}

	$effect(() => {
		const projectId = project.id;
		const path = canonicalPath;

		if (projectId !== lastProjectId) {
			lastProjectId = projectId;
			// Cambio destinatario: si azzerano gli esiti locali, non le operazioni
			// in corso di un altro progetto (che restano legate al loro path).
			plan = null;
			planError = null;
			planLoading = false;
			branchMenuOpen = false;
			branchError = null;
			readFailed = false;
			planRequest++;
			remoteRequest++;
		}

		if (!path) return;
		// Le letture non creano dipendenze: l'effetto segue solo il destinatario.
		untrack(() => {
			void readRemote(path, true);
			void readBranches(path);
			// Le statistiche locali decidono il blocco del pull: si chiedono qui,
			// rispettando la cache dello store, senza un secondo stato parallelo.
			void gitDiffStore.load(path);
		});
	});

	// Un checkout o un pull fatti altrove (pannello Git, barra progetti) devono
	// aggiornare questa vista: la fonte e' Git, non una copia locale.
	$effect(() => {
		const path = canonicalPath;
		if (!path) return;
		const onGitRefresh = (event: Event) => {
			const target = (event as CustomEvent<{ projectPath?: string }>).detail?.projectPath;
			if (target && normalizeProjectPath(target).toLowerCase() !== canonicalKey) return;
			untrack(() => {
				void readRemote(path, true);
				void readBranches(path);
			});
		};
		window.addEventListener('git-status-refresh', onGitRefresh);
		return () => window.removeEventListener('git-status-refresh', onGitRefresh);
	});

	async function handleCheckout(name: string) {
		// Il cancello si ricontrolla al clic: il disabled e' solo visivo.
		if (gateReason !== null || checkoutPending !== null) return;
		const path = canonicalPath;
		if (!path) return;

		const target = plan?.branches.find((branch) => branch.name === name);
		if (!target || target.current || target.blocked) return;

		checkoutTargets = [...checkoutTargets, { path, name }];
		branchError = null;
		try {
			await checkoutBranch(path, name);
			if (path === canonicalPath) branchMenuOpen = false;
		} catch (error) {
			// Nessuno stash o reset automatico: l'errore resta esplicito e il
			// branch dichiarato e' quello che Git rilegge subito dopo.
			if (path === canonicalPath) {
				branchError = m.project_tabs_git_branch_checkout_failed({ error: String(error) });
			}
		} finally {
			checkoutTargets = checkoutTargets.filter(
				(pending) => pending.path !== path || pending.name !== name
			);
			// Git resta la fonte: si rileggono branch e upstream dopo il tentativo.
			void readBranches(path);
			void readRemote(path, true);
		}
	}

	async function handlePull() {
		if (pullReason !== null) return;
		const path = canonicalPath;
		if (!path) return;

		pullingPaths = [...pullingPaths, path];
		pullOutcomes = { ...pullOutcomes, [path]: undefined };
		try {
			await githubStore.syncRepo(path, 'pull-ff');
			pullOutcomes = { ...pullOutcomes, [path]: { ok: true, message: '' } };
			notifyGitStatusRefresh(path);
		} catch (error) {
			pullOutcomes = {
				...pullOutcomes,
				[path]: { ok: false, message: m.project_tabs_git_pull_failed({ error: String(error) }) }
			};
		} finally {
			pullingPaths = pullingPaths.filter((candidate) => candidate !== path);
		}
	}

	function blockedLabel(blocked: BranchBlockReason): string {
		return blocked === 'lane'
			? m.project_tabs_git_branch_blocked_lane()
			: m.project_tabs_git_branch_blocked_worktree();
	}
</script>

<div class="git-view">
	<div class="git-label">{m.lanestrip_tab_main()}</div>

	{#if !canonicalPath}
		<p class="git-reason">{m.project_tabs_git_no_project()}</p>
	{:else}
		<div class="branch-row">
			<MenuButton
				open={branchMenuOpen}
				ariaLabel={branchAria}
				tooltip={m.git_change_branch()}
				width="252px"
				className="branch-trigger"
				onToggle={() => (branchMenuOpen = !branchMenuOpen)}
				onClose={() => (branchMenuOpen = false)}
			>
				{#snippet trigger()}
					<span class="branch-icon" aria-hidden="true"><IconGitBranch /></span>
					<span class="branch-name">{branchLabel}</span>
					<span class="branch-caret" aria-hidden="true"><IconChevronDown /></span>
				{/snippet}

				<div class="branch-menu-title">
					<span>{m.project_tabs_git_branch_menu_title()}</span>
					{#if planLoading}
						<span class="spin" aria-hidden="true"><IconRefresh /></span>
					{/if}
				</div>
				{#if gateReason}
					<p class="branch-menu-note" role="status">{gateReason}</p>
				{/if}
				{#if planError}
					<div class="branch-menu-state error" role="alert">
						<span>{m.lanestrip_branches_error()}</span>
						<button
							type="button"
							class="ui-button ui-button-secondary branch-menu-retry"
							onclick={() => void readBranches(canonicalPath)}
						>
							<IconRefresh /> {m.git_btn_retry()}
						</button>
					</div>
				{:else if !plan}
					<div class="branch-menu-state">{m.lanestrip_branches_loading()}</div>
				{:else if plan.branches.length > 0}
					{#each plan.branches as branch (branch.name)}
						<button
							type="button"
							class="branch-item"
							role="menuitemradio"
							aria-checked={branch.current}
							disabled={branch.current || branch.blocked !== null || gate !== null}
							title={branch.blocked
								? `${blockedLabel(branch.blocked)}${branch.blockedPath ? ` · ${branch.blockedPath}` : ''}`
								: branch.name}
							onclick={() => void handleCheckout(branch.name)}
						>
							<span class="branch-check" aria-hidden="true">
								{#if checkoutPending === branch.name}
									<span class="spin"><IconRefresh /></span>
								{:else if branch.current}
									<IconCheck />
								{/if}
							</span>
							<span class="branch-item-name">{branch.name}</span>
							{#if branch.blocked}
								<span class="branch-note">{blockedLabel(branch.blocked)}</span>
							{/if}
						</button>
					{/each}
				{:else}
					<div class="branch-menu-state">{m.project_tabs_git_branch_empty()}</div>
				{/if}
			</MenuButton>
		</div>

		{#if branchError}
			<div class="git-feedback error" role="alert">{branchError}</div>
		{:else if treeDirty && !gateReason}
			<p class="git-reason">{m.project_tabs_git_branch_dirty_hint()}</p>
		{/if}

		<!-- Il motivo del blocco si legge dove si prova ad agire: nel menu aperto,
		     altrimenti sotto il branch. -->
		{#if gateReason && !branchMenuOpen}
			<p class="git-reason" role="status">{gateReason}</p>
		{/if}

		{#if readFailure}
			<div class="git-feedback error" role="alert">
				<span>{m.project_tabs_git_read_error()}</span>
				{#if remoteError}
					<span class="git-error-detail">{remoteError}</span>
				{/if}
			</div>
			<p class="git-reason">{m.project_tabs_git_read_error_hint()}</p>
			<button type="button" class="ui-button ui-button-secondary git-retry" onclick={retryRead}>
				<IconRefresh /> {m.project_tabs_git_retry()}
			</button>
		{/if}

		{#if !upstream}
			{#if !readFailure}
				<div class="git-state-row">
					<span class="spin" aria-hidden="true"><IconRefresh /></span>
					<span>{m.project_tabs_git_loading()}</span>
				</div>
			{/if}
		{:else if !upstream.isGit}
			<p class="git-reason">{m.git_no_repo()}</p>
		{:else}
			{#if upstream.upstream}
				<div class="git-upstream">{upstream.upstream}</div>
			{:else}
				<div class="git-upstream none">{m.project_tabs_git_no_upstream_title()}</div>
			{/if}

			{#if !upstream.upstream}
				<p class="git-reason">{m.project_tabs_git_no_upstream_hint()}</p>
			{:else if upstream.behind > 0 || upstream.ahead > 0}
				<div class="git-counts">
					{#if upstream.behind > 0}
						<span title={m.topbar_upstream_behind_tooltip({ count: upstream.behind })}>
							<IconArrowDown />
							<strong>{upstream.behind}</strong>
							{m.project_tabs_git_behind()}
						</span>
					{/if}
					{#if upstream.ahead > 0}
						<span title={m.topbar_upstream_ahead_tooltip({ count: upstream.ahead })}>
							<IconArrowUp />
							<strong>{upstream.ahead}</strong>
							{m.project_tabs_git_ahead()}
						</span>
					{/if}
				</div>
			{:else if !readFailure}
				<div class="git-aligned">
					<IconCheck />
					<span>{m.project_tabs_git_updated()}</span>
				</div>
			{/if}
		{/if}

		{#if commitsToReceive.length > 0}
			<div class="git-section-label">{m.project_tabs_git_incoming_title()}</div>
			{#each commitsToReceive as commit (commit.hash || commit.shortHash)}
				<div class="incoming-commit" title={`${commit.author} · ${commit.date}`}>
					<span class="commit-subject">{commit.subject}</span>
					<code>{commit.shortHash}</code>
				</div>
			{/each}
			{#if hiddenCommits > 0}
				<div class="git-more">{m.project_tabs_git_more({ count: hiddenCommits })}</div>
			{/if}
		{/if}

		{#if upstream?.isGit && upstream.upstream && upstream.behind > 0}
			<button
				type="button"
				class="ui-button ui-button-primary git-update"
				disabled={pullReason !== null}
				title={pullHint ?? m.project_popover_git_clean_requirement()}
				onclick={() => void handlePull()}
			>
				{#if isPulling}
					<span class="spin" aria-hidden="true"><IconRefresh /></span>
					<span>{m.project_tabs_git_pulling()}</span>
				{:else}
					<IconDownload />
					<span>{m.project_tabs_git_pull()}</span>
				{/if}
			</button>
		{/if}

		{#if pullHint}
			<p class="git-reason" role="status">{pullHint}</p>
		{:else if !isPulling && upstream?.isGit && upstream.upstream && upstream.behind > 0}
			<p class="git-reason">{m.project_popover_git_clean_requirement()}</p>
		{/if}

		{#if remoteError && !readFailure}
			<p class="git-reason warn" role="status">{remoteError}</p>
		{/if}

		{#if pullOutcome && !pullOutcome.ok}
			<div class="git-feedback error" role="alert">{pullOutcome.message}</div>
		{:else if pullOutcome}
			<div class="git-feedback done" role="status">
				<IconCheck />
				<span>{m.project_tabs_git_pull_done()}</span>
			</div>
		{/if}
	{/if}
</div>

<style>
	.git-view {
		display: flex;
		flex-direction: column;
		min-width: 0;
		--icon-size: 13px;
	}

	.git-label {
		margin-bottom: var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--text-label);
		font-weight: 550;
		color: var(--ink-muted);
	}

	.branch-row {
		display: flex;
		min-width: 0;
	}

	.branch-row :global(.menu-button-container),
	.branch-row :global(.tooltip-wrapper) {
		width: 100%;
	}

	.branch-row :global(.branch-trigger) {
		width: 100%;
		height: 28px;
		padding: 0 var(--space-1);
		justify-content: flex-start;
		color: var(--ink);
		border-radius: var(--radius-md);
	}

	.branch-icon,
	.branch-caret {
		display: inline-flex;
		color: var(--ink-faint);
	}

	.branch-caret {
		--icon-size: 12px;
		margin-left: auto;
	}

	.branch-name {
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.branch-menu-title {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-2) var(--space-1);
		font-family: var(--font-ui);
		font-size: var(--text-group-label);
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.branch-menu-title :global(svg) {
		--icon-size: 11px;
		color: var(--ink-faint);
	}

	.branch-menu-note {
		margin: 0 var(--space-2) var(--space-1);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		line-height: 1.45;
		color: var(--ink-muted);
	}

	.branch-menu-state {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--text-body);
		color: var(--ink-muted);
	}

	.branch-menu-state.error {
		color: var(--danger);
	}

	.branch-menu-retry {
		gap: var(--space-1);
	}

	.branch-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: 6px var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-body);
		text-align: left;
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.branch-item:hover:not(:disabled),
	.branch-item:focus-visible {
		background: var(--bg-hover);
	}

	.branch-item:disabled {
		cursor: default;
		color: var(--ink-faint);
	}

	.branch-item[aria-checked='true'] {
		color: var(--ink);
	}

	.branch-check {
		display: inline-flex;
		width: 12px;
		flex: none;
		--icon-size: 12px;
		color: var(--brand-ink);
	}

	.branch-item-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.branch-note {
		margin-left: auto;
		flex: none;
		max-width: 46%;
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.git-reason.warn {
		color: var(--danger);
	}

	.git-reason {
		margin: var(--space-2) 0 0;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		line-height: 1.5;
		color: var(--ink-muted);
	}

	.git-upstream {
		margin-top: var(--space-1);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.6;
		color: var(--ink-faint);
		overflow-wrap: anywhere;
	}

	.git-upstream.none {
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
	}

	.git-state-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) 0;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.git-counts {
		display: flex;
		gap: var(--space-4);
		margin-top: var(--space-2);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--line);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
	}

	.git-counts span {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.git-counts strong {
		color: var(--ink);
		font-weight: 600;
	}

	.git-aligned {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin-top: var(--space-2);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--line);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--success);
	}

	.git-section-label {
		margin: var(--space-3) 0 var(--space-1);
		font-family: var(--font-ui);
		font-size: var(--text-group-label);
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.incoming-commit {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: baseline;
		gap: var(--space-2);
		padding: 5px 0;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		line-height: 1.45;
		color: var(--ink);
	}

	.commit-subject {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.incoming-commit code {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.git-more {
		padding-top: 2px;
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.git-update {
		width: 100%;
		margin-top: var(--space-3);
		gap: var(--space-2);
	}

	.git-retry {
		margin-top: var(--space-2);
		gap: var(--space-1);
		align-self: flex-start;
	}

	.git-feedback {
		display: flex;
		align-items: flex-start;
		gap: var(--space-1);
		margin-top: var(--space-2);
		padding: 6px var(--space-2);
		border-radius: var(--radius-sm);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		line-height: 1.45;
	}

	.git-feedback.error {
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
		color: var(--danger);
	}

	.git-feedback.done {
		align-items: center;
		background: color-mix(in srgb, var(--success) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 25%, transparent);
		color: var(--success);
	}

	.git-error-detail {
		min-width: 0;
		overflow-wrap: anywhere;
		opacity: 0.9;
	}

	.spin {
		display: inline-flex;
		animation: spin 900ms linear infinite;
	}
</style>
