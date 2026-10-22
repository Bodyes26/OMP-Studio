<!--
  NewChatModal.svelte — Modale "Nuova chat" confermata per Fleet Hub (Variante A).
  Selettore esplicito del progetto (con macchina di appartenenza) + destinazione (Principale,
  corsie GUI non-Lab/non-terminal, o nuovo worktree isolato) + primo prompt.
  Gestione rigorosa di consenso all'interruzione (new_session con interrupt condizionato)
  e invio del prompt con whileBusy:'follow_up', o creazione worktree verificata.
-->
<script lang="ts">
	import type { RemoteProject, Feature, RemoteLane } from '../../../../src/protocol.ts';
	import { t } from '../../i18n.ts';
	import { connection } from '../../connection.svelte.ts';
	import { navigation } from '../../navigation.svelte.ts';
	import ProjectIcon from './ProjectIcon.svelte';
	import MachineBadge from './MachineBadge.svelte';
	import { IconClose, IconSearch, IconSparkles } from '../../icons.ts';

	let {
		initialHostId,
		initialProjectId,
		onClose
	}: {
		initialHostId?: string;
		initialProjectId?: string;
		onClose: () => void;
	} = $props();

	let searchQuery = $state('');
	let prompt = $state('');
	let isWorktree = $state(false);
	let selectedLaneId = $state<string>('main');
	let isSubmitting = $state(false);
	let errorMessage = $state<string | null>(null);
	let showInterruptConsent = $state(false);
	let dialogEl = $state<HTMLDialogElement | null>(null);
	$effect(() => {
		if (dialogEl && !dialogEl.open) dialogEl.showModal();
	});

	interface ProjectWithHost {
		project: RemoteProject;
		hostId: string;
		hostName: string;
		hostOnline: boolean;
		hostFeatures: Feature[];
	}

	const allProjectsWithHost = $derived.by<ProjectWithHost[]>(() => {
		const result: ProjectWithHost[] = [];
		for (const host of connection.hosts) {
			const state = connection.hostStates[host.id]?.state;
			if (!state?.projects) continue;
			for (const p of state.projects) {
				result.push({
					project: p,
					hostId: host.id,
					hostName: host.name,
					hostOnline: host.online,
					hostFeatures: host.features
				});
			}
		}
		return result;
	});

	// Progetti recenti (fino a 4)
	const recentProjects = $derived.by(() => {
		return allProjectsWithHost.slice(0, 4);
	});

	let selectedProjectKey = $state<string | null>(null);

	$effect(() => {
		if (selectedProjectKey) return;
		if (initialProjectId) {
			const found = allProjectsWithHost.find((p) => {
				if (initialHostId) return p.hostId === initialHostId && p.project.id === initialProjectId;
				return p.project.id === initialProjectId;
			});
			if (found) {
				selectedProjectKey = `${found.hostId}:${found.project.id}`;
				return;
			}
		}
		if (recentProjects.length > 0) {
			selectedProjectKey = `${recentProjects[0].hostId}:${recentProjects[0].project.id}`;
		}
	});

	const currentProjectWithHost = $derived.by(() => {
		if (!selectedProjectKey) return recentProjects[0] || null;
		return allProjectsWithHost.find((p) => `${p.hostId}:${p.project.id}` === selectedProjectKey) || null;
	});

	const filteredProjects = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return allProjectsWithHost;
		return allProjectsWithHost.filter((p) => p.project.name.toLowerCase().includes(q));
	});

	const canFleet = $derived(
		Boolean(currentProjectWithHost?.hostFeatures.includes('fleet'))
	);

	// Corsie idonee esistenti: escluse le Lab e le corsie con surface 'terminal'
	const eligibleLanes = $derived.by<RemoteLane[]>(() => {
		if (!currentProjectWithHost) return [];
		return currentProjectWithHost.project.lanes.filter((l) => {
			if (l.kind === 'lab') return false;
			const surface = (l.agent as unknown as { surface?: string })?.surface;
			if (surface === 'terminal') return false;
			return true;
		});
	});

	const currentSelectedLane = $derived.by(() => {
		if (isWorktree) return null;
		return eligibleLanes.find((l) => l.id === selectedLaneId) || eligibleLanes[0] || null;
	});

	$effect(() => {
		if (!eligibleLanes.some((lane) => lane.id === selectedLaneId)) {
			selectedLaneId = eligibleLanes[0]?.id ?? 'main';
		}
	});

	const canStart = $derived(Boolean(
		currentProjectWithHost?.hostOnline && connection.status === 'connected' &&
		(isWorktree ? canFleet : currentSelectedLane &&
			currentProjectWithHost.hostFeatures.includes('lane_config') &&
			currentProjectWithHost.hostFeatures.includes('session_control'))
	));

	const isTargetBusy = $derived.by(() => {
		if (isWorktree || !currentSelectedLane) return false;
		const s = currentSelectedLane.agent.state;
		return s === 'working' || s === 'background' || s === 'attention';
	});

	function handleSelectProject(item: ProjectWithHost) {
		if (isSubmitting) return;
		showInterruptConsent = false;
		selectedProjectKey = `${item.hostId}:${item.project.id}`;
		selectedLaneId = 'main';
		searchQuery = '';
	}

	async function executeNewChat(confirmedInterrupt = false) {
		if (!currentProjectWithHost || !prompt.trim() || isSubmitting || !canStart) return;

		const { hostId, project, hostFeatures, hostOnline } = currentProjectWithHost;
		const destinationLaneId = selectedLaneId;
		const firstPrompt = prompt.trim();
		if (!hostOnline) {
			errorMessage = t('errHostOffline');
			return;
		}

		errorMessage = null;

		// 1. Creazione nuovo worktree isolato
		if (isWorktree) {
			if (!hostFeatures.includes('fleet')) {
				errorMessage = t('worktreeUnsupported');
				return;
			}

			isSubmitting = true;
			try {
				const res = (await connection.sendCommand(hostId, {
					kind: 'create_lane',
					projectId: project.id,
					title: firstPrompt.slice(0, 36),
					prompt: firstPrompt
				})) as { laneId?: string } | undefined;

				if (!res || typeof res.laneId !== 'string' || !res.laneId.trim()) {
					throw new Error(t('errFailed'));
				}

				navigation.openChat({ hostId, projectId: project.id, laneId: res.laneId });
				onClose();
			} catch (err: unknown) {
				errorMessage = (err as { message?: string })?.message || t('errFailed');
			} finally {
				isSubmitting = false;
			}
			return;
		}

		// 2. Corsia esistente (Principale o altro worktree)
		// Se la corsia è occupata e l'utente non ha esplicitamente confermato l'interruzione, chiedi consenso
		if (isTargetBusy && !confirmedInterrupt) {
			showInterruptConsent = true;
			return;
		}
		showInterruptConsent = false;

		isSubmitting = true;
		try {
			// Invio comando new_session con interrupt SOLO se confermato dall'utente
			await connection.sendCommand(hostId, {
				kind: 'new_session',
				projectId: project.id,
				laneId: destinationLaneId === 'main' ? null : destinationLaneId,
				interrupt: confirmedInterrupt
			});

			// Invio del primo prompt con parametro obbligatorio whileBusy:'follow_up'
			await connection.sendCommand(hostId, {
				kind: 'send_prompt',
				projectId: project.id,
				laneId: destinationLaneId === 'main' ? null : destinationLaneId,
				text: firstPrompt,
				whileBusy: 'follow_up'
			});

			navigation.openChat({ hostId, projectId: project.id, laneId: destinationLaneId });
			onClose();
		} catch (err: unknown) {
			// Se il server rifiuta per stato occupato intervenuto nel frattempo, mostra il consenso
			const errCode = (err as { code?: string; message?: string })?.code;
			if (errCode === 'rejected' && !confirmedInterrupt) {
				showInterruptConsent = true;
			} else {
				errorMessage = (err as { message?: string })?.message || t('newChatError');
			}
		} finally {
			isSubmitting = false;
		}
	}
</script>

<dialog bind:this={dialogEl} class="modal-backdrop" aria-labelledby="new-chat-title"
	onclick={(event) => { if (event.target === event.currentTarget && !isSubmitting) onClose(); }}
	oncancel={(event) => { if (isSubmitting) event.preventDefault(); else onClose(); }}
	onclose={onClose}>
	<div class="new-chat-card">
		<header class="card-header">
			<h2 id="new-chat-title" class="card-title">{t('newChat')}</h2>
			<button
				type="button"
				class="btn-close"
				disabled={isSubmitting}
				onclick={onClose}
				aria-label={t('close')}
				title={t('close')}
			>
				<IconClose />
			</button>
		</header>

		<div class="card-body">
			{#if errorMessage}
				<div class="card-error-alert" role="alert">
					{errorMessage}
				</div>
			{/if}

			<!-- Selettore progetto -->
			<div class="form-group">
				<label class="group-label" for="project-search-input">{t('chooseProject')}</label>

				<!-- Chips progetti recenti con nome macchina -->
				{#if recentProjects.length > 0}
					<div class="recent-projects-chips">
						{#each recentProjects as item (`${item.hostId}:${item.project.id}`)}
							{@const isSelected = selectedProjectKey === `${item.hostId}:${item.project.id}`}
							<button
								type="button"
								class="project-chip"
								class:selected={isSelected}
								onclick={() => handleSelectProject(item)}
							>
								<ProjectIcon project={item.project} size="sm" />
								<span class="chip-name">{item.project.name}</span>
								<span class="chip-host font-mono">({item.hostName})</span>
							</button>
						{/each}
					</div>
				{/if}

				<!-- Ricerca tra tutti i progetti -->
				<div class="search-input-wrapper">
					<span class="search-icon" aria-hidden="true"><IconSearch /></span>
					<input
						id="project-search-input"
						type="search"
						class="search-input"
						bind:value={searchQuery}
						placeholder={t('searchProjectsPlaceholder')}
					/>
				</div>

				{#if searchQuery.trim()}
					<div class="projects-search-results">
						{#if filteredProjects.length === 0}
							<div class="empty-search-hint">{t('noProjectsFound')}</div>
						{:else}
							<ul class="results-list">
								{#each filteredProjects as item (`${item.hostId}:${item.project.id}`)}
									<li>
										<button
											type="button"
											class="result-row-btn"
											onclick={() => handleSelectProject(item)}
										>
											<ProjectIcon project={item.project} size="sm" />
											<span class="result-name">{item.project.name}</span>
											<MachineBadge name={item.hostName} online={item.hostOnline} short />
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Destinazione / Progetto corrente -->
			{#if currentProjectWithHost}
				<div class="current-target-card">
					<div class="target-lead">
						<ProjectIcon project={currentProjectWithHost.project} size="md" />
						<div class="target-info">
							<div class="target-name">
								{currentProjectWithHost.project.name}
								<MachineBadge
									name={currentProjectWithHost.hostName}
									online={currentProjectWithHost.hostOnline}
									short
								/>
							</div>
						</div>
					</div>

					<!-- Destinazione: opzione Worktree vs corsia esistente -->
					<div class="destination-controls">
						<label class="destination-option" class:disabled={!canFleet}>
							<input
								type="checkbox"
								class="dest-checkbox"
								bind:checked={isWorktree}
								disabled={!canFleet || isSubmitting}
								onchange={() => (showInterruptConsent = false)}
							/>
							<span class="dest-label">{t('newWorktreeOption')}</span>
						</label>

						{#if !isWorktree && eligibleLanes.length > 0}
							<div class="lane-select-wrap">
								<span class="lane-select-label">{t('destinationLabel')}:</span>
								<select class="lane-select" bind:value={selectedLaneId} disabled={isSubmitting}
									onchange={() => (showInterruptConsent = false)}>
									{#each eligibleLanes as l (l.id)}
										<option value={l.id}>{l.title}</option>
									{/each}
								</select>
							</div>
						{/if}
					</div>

					{#if !canFleet && isWorktree}
						<div class="hint-warn">
							{t('worktreeUnsupported')}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Primo prompt -->
			<div class="form-group">
				<textarea
					class="prompt-textarea"
					bind:value={prompt}
					rows="3"
					placeholder={t('promptPlaceholder')}
					disabled={isSubmitting}
				></textarea>
			</div>

			<!-- Avviso di interruzione corsia occupata -->
			{#if showInterruptConsent}
				<div class="consent-alert" role="alert">
					<div class="consent-text">{t('newChatConfirmInterrupt')}</div>
					<div class="consent-actions">
						<button
							type="button"
							class="ui-button ui-button-primary btn-sm"
							onclick={() => executeNewChat(true)}
							disabled={isSubmitting}
						>
							{t('confirm')}
						</button>
						<button
							type="button"
							class="ui-button ui-button-ghost btn-sm"
							onclick={() => (showInterruptConsent = false)}
							disabled={isSubmitting}
						>
							{t('cancel')}
						</button>
					</div>
				</div>
			{/if}
		</div>

		<footer class="card-footer">
			<div class="footer-meta">
				{#if currentProjectWithHost}
					<span class="starts-on-text">
						{t('startsOnMachine', { machine: currentProjectWithHost.hostName })}
					</span>
				{/if}
			</div>

			<div class="footer-actions">
				<button
					type="button"
					class="ui-button ui-button-ghost"
					onclick={onClose}
					disabled={isSubmitting}
				>
					{t('cancel')}
				</button>
				<button
					type="button"
					class="ui-button ui-button-primary"
					disabled={!prompt.trim() || isSubmitting || !canStart}
					onclick={() => executeNewChat(false)}
				>
					<IconSparkles />
					<span>{isSubmitting ? t('sendingPrompt') : t('startChatBtn')}</span>
				</button>
			</div>
		</footer>
	</div>
</dialog>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		margin: 0;
		border: 0;
		width: 100%;
		height: 100dvh;
		max-width: none;
		max-height: none;
		box-sizing: border-box;
		z-index: 200;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 0;
	}

	@media (min-width: 640px) {
		.modal-backdrop {
			align-items: center;
			padding: 24px;
		}
	}

	.new-chat-card {
		width: 100%;
		max-width: 540px;
		max-height: 90vh;
		max-height: 90dvh;
		padding-bottom: env(safe-area-inset-bottom, 0px);
		background: var(--bg-base);
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		box-shadow: var(--shadow-dock);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--line);
	}

	@media (min-width: 640px) {
		.new-chat-card {
			border-radius: var(--radius-xl);
		}
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.card-title {
		font-size: var(--text-label, 14px);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	.btn-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-sunken);
		color: var(--ink-muted);
		cursor: pointer;
	}

	.btn-close:hover {
		color: var(--ink);
		background: var(--bg-raised);
	}

	.card-body {
		padding: 16px 20px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.card-error-alert {
		padding: 10px 14px;
		border-radius: var(--radius-lg);
		background: color-mix(in oklch, var(--danger) 15%, transparent);
		border: 1px solid color-mix(in oklch, var(--danger) 30%, transparent);
		color: var(--danger);
		font-size: var(--text-caption, 12px);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.group-label {
		font-size: var(--text-mini, 11px);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-muted);
	}

	.recent-projects-chips {
		display: flex;
		align-items: center;
		gap: 8px;
		overflow-x: auto;
		padding-bottom: 4px;
	}

	.project-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px 4px 6px;
		border-radius: var(--radius-full);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink);
		font-size: var(--text-caption, 12px);
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.project-chip:hover {
		background: var(--bg-raised);
		border-color: var(--line-active, var(--line));
	}

	.project-chip.selected {
		background: var(--bg-raised);
		border-color: var(--brand);
		box-shadow: inset 0 0 0 1px var(--brand);
		font-weight: 600;
	}

	.chip-name {
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chip-host {
		font-size: 10px;
		color: var(--ink-faint);
	}

	.search-input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon {
		position: absolute;
		left: 10px;
		color: var(--ink-faint);
		pointer-events: none;
		--icon-size: 14px;
		display: inline-flex;
	}

	.search-input {
		width: 100%;
		padding: 8px 12px 8px 32px;
		border-radius: var(--radius-lg);
		border: 1px solid var(--line);
		background: var(--bg-sunken);
		color: var(--ink);
		font-size: var(--text-caption, 12px);
		outline: none;
	}

	.search-input:focus {
		border-color: var(--brand);
		background: var(--bg-raised);
	}

	.projects-search-results {
		max-height: 160px;
		overflow-y: auto;
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: var(--bg-base);
	}

	.results-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.result-row-btn {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		font-size: var(--text-caption, 12px);
		color: var(--ink);
		border-bottom: 1px solid var(--line);
	}

	.result-row-btn:hover {
		background: var(--bg-sunken);
	}

	.result-name {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.empty-search-hint {
		padding: 12px;
		text-align: center;
		font-size: var(--text-mini, 11px);
		color: var(--ink-muted);
	}

	/* Target card */
	.current-target-card {
		padding: 12px 14px;
		border-radius: var(--radius-lg);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.target-lead {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.target-info {
		min-width: 0;
		flex: 1;
	}

	.target-name {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-label, 13px);
		font-weight: 600;
		color: var(--ink);
	}


	.destination-controls {
		display: flex;
		align-items: center;
		gap: 16px;
		padding-top: 8px;
		border-top: 1px solid var(--line);
		flex-wrap: wrap;
	}

	.destination-option {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-caption, 12px);
		font-weight: 500;
		color: var(--ink);
		cursor: pointer;
		user-select: none;
	}

	.destination-option.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.dest-checkbox {
		width: 16px;
		height: 16px;
		accent-color: var(--brand);
		cursor: pointer;
	}

	.lane-select-wrap {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-caption, 12px);
		color: var(--ink-muted);
	}

	.lane-select {
		padding: 3px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-base);
		color: var(--ink);
		font-size: var(--text-caption, 12px);
	}

	.hint-warn {
		font-size: var(--text-mini, 11px);
		color: var(--color-warn-text, #b45309);
	}

	.prompt-textarea {
		width: 100%;
		padding: 10px 14px;
		border-radius: var(--radius-lg);
		border: 1px solid var(--line);
		background: var(--bg-base);
		color: var(--ink);
		font-size: var(--text-label, 13px);
		line-height: 1.5;
		resize: vertical;
		outline: none;
		box-sizing: border-box;
	}

	.prompt-textarea:focus {
		border-color: var(--brand);
		box-shadow: inset 0 0 0 1px var(--brand);
	}

	/* Consent alert */
	.consent-alert {
		padding: 12px 14px;
		border-radius: var(--radius-lg);
		background: color-mix(in oklab, var(--warn) 12%, var(--bg-raised));
		border: 1px solid color-mix(in oklab, var(--warn) 35%, transparent);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.consent-text {
		font-size: var(--text-caption, 12px);
		color: var(--warn);
		line-height: 1.4;
	}

	.consent-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.btn-sm {
		padding: 4px 10px;
		font-size: var(--text-mini, 11px);
		height: auto;
		min-height: 26px;
	}

	.card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 20px;
		border-top: 1px solid var(--line);
		background: var(--bg-sunken);
		flex-shrink: 0;
	}

	.starts-on-text {
		font-size: var(--text-mini, 11px);
		color: var(--ink-muted);
	}

	.footer-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}
</style>
