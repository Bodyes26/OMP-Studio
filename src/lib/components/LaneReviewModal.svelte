<!--
  LaneReviewModal.svelte — Superficie di revisione e integrazione di una corsia isolata in un clic.

  Invarianti:
  1. Revisione non muta mai il branch target ne' il working tree principale.
  2. Mostra target/base/current SHA, drift, commit, file con numstat e diff Monaco side-by-side.
  3. Include sia file tracciati sia file non tracciati rilevanti.
  4. Evidenze dal transcript rigorosamente reali: comandi, exit code, durata misurata.
  5. Integrazione deterministica in un clic gestita dal servizio `laneLanding` (squash).
  6. Azioni lecite: torna alla corsia, prepara commit selezionato, integra, rifiuta, chiedi all'agente di risolvere conflitti.
  7. Accessibilita' APG: dialog modale, trapFocus, navigazione tastiera, contrasti WCAG AA.
-->
<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import {
		IconWarning,
		IconCheck,
		IconRefresh,
		IconDiff,
		IconFile,
		IconGitBranch,
		IconSearch,
		IconRoleCommit,
		IconTerminal,
		IconClose
	} from '$lib/icons';
	import {
		createDiffEditorInstance,
		applyEditorSettings,
		languageForFile
	} from '$lib/editor/monaco';
	import type { AgentLane, ProjectId } from '$lib/types/lanes';
	import type { LaneRecord } from '$lib/stores/lanePersistence';
	import type { Project } from '$lib/stores/projects.svelte';
	import { laneStore } from '$lib/stores/lanes.svelte';
	import { sessionRegistry } from '$lib/agent/sessionRegistry';
	import { laneLanding } from '$lib/lanes/laneLanding.svelte';
	import { deleteWorktreeLane } from '$lib/lanes/laneLifecycle';
	import {
		listLaneProcesses,
		laneProcessesFor,
		type LaneProcessInfo
	} from '$lib/lanes/processSupervisor';
	import {
		extractCommandEvidence,
		type CommandEvidence
	} from '$lib/lanes/commandEvidence';
	import {
		evaluateIntegrationGate,
		type IntegrationGateResult
	} from '$lib/lanes/integrationGate';
	import { formatDuration } from '$lib/agent/tools/types';

	export interface ReviewCommitInfo {
		hash: string;
		short: string;
		author: string;
		time: number;
		subject: string;
	}

	export interface ReviewFileDiff {
		path: string;
		status: string;
		additions: number;
		deletions: number;
		isUntracked: boolean;
	}

	export interface WorktreeReviewInspection {
		targetBranch: string;
		targetSha: string;
		baseSha: string;
		currentSha: string;
		driftAhead: number;
		driftBehind: number;
		isTargetDirty: boolean;
		targetDirtyFiles: string[];
		isLaneDirty: boolean;
		laneDirtyFiles: string[];
		isTargetCheckedOut: boolean;
		hasUnresolvedConflicts: boolean;
		commits: ReviewCommitInfo[];
		files: ReviewFileDiff[];
		totalAdditions: number;
		totalDeletions: number;
	}

	let {
		open = false,
		lane = null,
		project,
		onClose,
		onResolveConflicts,
		onPrepareCommit
	} = $props<{
		open?: boolean;
		lane: AgentLane | LaneRecord | null;
		project: Project;
		onClose: () => void;
		onResolveConflicts?: (prompt: string) => void;
		onPrepareCommit?: (commit: ReviewCommitInfo) => void;
	}>();

	// Stato dei dati di revisione
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let reviewData = $state<WorktreeReviewInspection | null>(null);
	let liveProcesses = $state<LaneProcessInfo[]>([]);

	// Stato navigazione interna
	let activeTab = $state<'files' | 'commits' | 'evidence'>('files');
	let selectedFilePath = $state<string | null>(null);
	let fileFilter = $state('');

	// Stato visualizzazione Monaco Diff
	let diffContainerEl: HTMLElement | null = $state(null);
	let diffEditorInstance: any = null;
	let diffLoading = $state(false);
	let diffError = $state<string | null>(null);

	// Stato azioni
	let confirmReject = $state(false);
	let confirmStopReject = $state(false);
	let isRejecting = $state(false);
	let rejectError = $state<string | null>(null);
	let integrateMessage = $state('');
	let isIntegrating = $state(false);
	let integrateError = $state<string | null>(null);
	let integrateDetail = $state<string | null>(null);
	let integrateOutcomeMessage = $state<string | null>(null);
	let processCheckFailed = $state(false);

	$effect(() => {
		if (open && lane) {
			integrateMessage = lane.title ?? '';
			integrateError = null;
			integrateDetail = null;
			integrateOutcomeMessage = null;
		}
	});

	// Evidenze reali estratte dal transcript
	const commandEvidence = $derived.by<CommandEvidence[]>(() => {
		if (!lane) return [];
		try {
			const session = sessionRegistry?.getLaneSession?.(project.id, lane.laneId);
			if (!session || !session.entries) return [];
			return extractCommandEvidence(session.entries);
		} catch {
			return [];
		}
	});

	// Valutazione gate di sicurezza
	const liveLane = $derived.by(() => {
		if (!lane) return null;
		return (
			laneStore.lanesFor(project.id as ProjectId).find((row) => row.laneId === lane.laneId) ??
			lane
		);
	});

	const gateResult = $derived.by<IntegrationGateResult>(() => {
		if (!reviewData || !liveLane) {
			return { canIntegrate: false, reasons: [] };
		}
		return evaluateIntegrationGate(
			{
				laneStatus: liveLane.status,
				isTargetCheckedOut: reviewData.isTargetCheckedOut,
				processCheckFailed,
				hasUnresolvedConflicts: reviewData.hasUnresolvedConflicts
			},
			{
				checkoutMismatch: () => m.lanereview_gate_checkout(),
				processCheckFailed: () => m.lanereview_gate_process_check(),
				notReady: (status) => m.lanereview_gate_not_ready({ status }),
				conflicts: () => m.lanereview_gate_conflicts()
			}
		);
	});

	const integrateTooltipText = $derived(
		gateResult.canIntegrate
			? ''
			: (gateResult.reasons[0] ?? m.lanereview_action_integrate_disabled_tooltip())
	);

	// File filtrati
	const filteredFiles = $derived.by<ReviewFileDiff[]>(() => {
		if (!reviewData?.files) return [];
		const query = fileFilter.trim().toLowerCase();
		if (!query) return reviewData.files;
		return reviewData.files.filter((f) => f.path.toLowerCase().includes(query));
	});

	// File selezionato corrente
	const currentFileDiff = $derived.by<ReviewFileDiff | undefined>(() => {
		if (!selectedFilePath || !reviewData?.files) return undefined;
		return reviewData.files.find((f) => f.path === selectedFilePath);
	});

	// Caricamento dati di revisione all'apertura o al cambio di corsia
	$effect(() => {
		if (open && lane && lane.workspacePath) {
			loadReviewData();
		} else {
			cleanupDiff();
			reviewData = null;
			selectedFilePath = null;
			confirmReject = false;
			confirmStopReject = false;
			integrateMessage = '';
			integrateError = null;
			rejectError = null;
			processCheckFailed = false;
		}
	});

	async function loadReviewData() {
		if (!lane || !lane.workspacePath) return;
		loading = true;
		loadError = null;

		try {
			const inspection = await invoke<WorktreeReviewInspection>('worktree_review_inspect', {
				args: {
					projectPath: project.canonicalProjectPath,
					worktreePath: lane.workspacePath,
					targetBranch: lane.targetBranch ?? undefined
				}
			});
			reviewData = inspection;

			// Carica i processi vivi runtime per la corsia
			try {
				const allProc = await listLaneProcesses();
				liveProcesses = laneProcessesFor(allProc, project.id, lane.laneId);
				processCheckFailed = false;
			} catch {
				liveProcesses = [];
				processCheckFailed = true;
			}
			await syncReviewStatus(inspection);

			// Seleziona il primo file disponibile se non già selezionato
			if (!selectedFilePath && inspection.files.length > 0) {
				selectedFilePath = inspection.files[0].path;
			} else if (
				selectedFilePath &&
				!inspection.files.some((f) => f.path === selectedFilePath)
			) {
				selectedFilePath = inspection.files.length > 0 ? inspection.files[0].path : null;
			}
		} catch (err: any) {
			loadError = err?.message || String(err);
		} finally {
			loading = false;
		}
	}

	function cleanupDiff() {
		if (diffEditorInstance) {
			try {
				const models = diffEditorInstance.getModel?.();
				diffEditorInstance.dispose();
				models?.original?.dispose();
				models?.modified?.dispose();
			} catch {
				// Silenzioso su rilascio
			}
			diffEditorInstance = null;
		}
	}

	// Montaggio e aggiornamento Monaco Diff quando cambia il file selezionato
	$effect(() => {
		const filePath = selectedFilePath;
		const container = diffContainerEl;
		const inspection = reviewData;

		if (!filePath || !container || !open || !lane?.workspacePath || !inspection) {
			cleanupDiff();
			return;
		}

		let active = true;
		diffLoading = true;
		diffError = null;

		async function mountDiff() {
			try {
				const fileInfo = inspection!.files.find((f) => f.path === filePath);
				let original = '';
				let modified = '';

				if (fileInfo?.isUntracked) {
					// File non tracciato: assente sul target, presente nel worktree
					original = '';
					const modRes = await invoke<{ content: string }>('file_read', {
						projectPath: lane!.workspacePath,
						rel: filePath
					});
					modified = modRes.content;
				} else if (fileInfo?.status === 'D') {
					// File rimosso: presente sul target, assente nel worktree
					const origRes = await invoke<{ content: string; exists: boolean }>('file_git_rev', {
						projectPath: project.canonicalProjectPath,
						rel: filePath,
						rev: inspection!.targetBranch
					});
					original = origRes.exists ? origRes.content : '';
					modified = '';
				} else {
					// File modificato o aggiunto tracciato
					const origRes = await invoke<{ content: string; exists: boolean }>('file_git_rev', {
						projectPath: project.canonicalProjectPath,
						rel: filePath,
						rev: inspection!.targetBranch
					});
					original = origRes.exists ? origRes.content : '';

					const modRes = await invoke<{ content: string }>('file_read', {
						projectPath: lane!.workspacePath,
						rel: filePath
					});
					modified = modRes.content;
				}

				if (!active) return;
				if (!container || !filePath) return;
				cleanupDiff();

				const lang = languageForFile(filePath);
				diffEditorInstance = createDiffEditorInstance(
					container,
					original,
					modified,
					lang,
					true // sola lettura per review
				);
				applyEditorSettings(diffEditorInstance);
			} catch (err: any) {
				if (!active) return;
				diffError = err?.message || String(err);
				cleanupDiff();
			} finally {
				if (active) {
					diffLoading = false;
				}
			}
		}

		void mountDiff();

		return () => {
			active = false;
			cleanupDiff();
		};
	});

	function invokeErrorMessage(error: unknown): string {
		if (typeof error === 'object' && error !== null) {
			const message = (error as { message?: unknown }).message;
			if (typeof message === 'string' && message.length > 0) return message;
		}
		return error instanceof Error ? error.message : String(error);
	}

	async function syncReviewStatus(inspection: WorktreeReviewInspection) {
		const current = lane;
		if (!current) return;
		const projectId = project.id as ProjectId;
		const record = laneStore.lanesFor(projectId).find((row) => row.laneId === current.laneId);
		if (!record || record.status === 'integrating' || record.status === 'archived') return;
		if (inspection.hasUnresolvedConflicts) {
			if (record.status !== 'conflict') {
				await laneStore.updateLane(projectId, current.laneId, { status: 'conflict' });
			}
			return;
		}
		if (record.status === 'active' || record.status === 'conflict') {
			await laneStore.updateLane(projectId, current.laneId, { status: 'review_ready' });
		}
	}

	async function handleRejectLane() {
		if (!lane || isRejecting) return;
		isRejecting = true;
		rejectError = null;
		try {
			const outcome = await deleteWorktreeLane(project.id as ProjectId, lane.laneId, {
				stopProcesses: false
			});
			if (outcome.kind === 'deleted') {
				onClose();
				return;
			}
			if (outcome.kind === 'processes-active') {
				confirmStopReject = true;
				return;
			}
			rejectError = outcome.message;
		} catch (error) {
			rejectError = invokeErrorMessage(error);
		} finally {
			isRejecting = false;
		}
	}

	async function handleRejectStop() {
		if (!lane || isRejecting) return;
		isRejecting = true;
		rejectError = null;
		try {
			const outcome = await deleteWorktreeLane(project.id as ProjectId, lane.laneId, {
				stopProcesses: true
			});
			if (outcome.kind === 'deleted') {
				onClose();
				return;
			}
			if (outcome.kind === 'processes-active') {
				confirmStopReject = true;
				return;
			}
			rejectError = outcome.message;
		} catch (error) {
			rejectError = invokeErrorMessage(error);
		} finally {
			isRejecting = false;
		}
	}

	function handleAskAgent() {
		if (!reviewData) return;
		onResolveConflicts?.(m.lanereview_conflict_prompt({ branch: reviewData.targetBranch }));
	}

	async function handleIntegrate() {
		if (!gateResult.canIntegrate || !lane || isIntegrating) return;
		confirmReject = false;
		confirmStopReject = false;
		isIntegrating = true;
		integrateError = null;
		integrateDetail = null;
		integrateOutcomeMessage = null;
		try {
			const message = integrateMessage.trim() || lane.title;
			const result = await laneLanding.land(project, lane.laneId, {
				message,
				caller: { kind: 'gui' }
			});
			if (result.kind === 'integrated' || result.kind === 'already_integrated') {
				onClose();
				return;
			}
			if (result.kind === 'error') {
				integrateError = result.error.message;
				integrateDetail = result.error.detail ?? null;
			} else if (result.kind === 'conflicts') {
				integrateError = m.lanereview_gate_conflicts();
				integrateDetail = result.files.join(', ');
				await loadReviewData();
			} else if (result.kind === 'queued') {
				integrateOutcomeMessage = result.agentText;
			} else if (result.kind === 'nothing') {
				integrateOutcomeMessage = result.agentText;
			}
		} catch (error) {
			integrateError = invokeErrorMessage(error);
		} finally {
			isIntegrating = false;
		}
	}

	// Format helpers
	function formatDate(unixSeconds: number): string {
		if (!unixSeconds) return '';
		const d = new Date(unixSeconds * 1000);
		return d.toLocaleDateString(undefined, {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function shortSha(sha: string): string {
		if (!sha) return '';
		return sha.slice(0, 7);
	}
</script>

{#if open && lane}
	<Dialog
		open={true}
		title={m.lanereview_modal_title({ title: lane.title })}
		size="full"
		flush
		onClose={onClose}
		initialFocus="[data-dialog-primary]"
	>
		{#snippet icon()}
			<span class="header-icon" aria-hidden="true">
				<IconDiff />
			</span>
		{/snippet}

		{#snippet actions()}
			<div class="meta-row">
				<Tooltip text={m.lanereview_target_branch({ branch: reviewData?.targetBranch ?? 'main' })}>
					<span class="badge badge-target">
						<IconGitBranch />
						<span>{reviewData?.targetBranch ?? lane?.targetBranch ?? 'main'}</span>
					</span>
				</Tooltip>
				{#if reviewData}
					<Tooltip text={m.lanereview_target_sha({ sha: reviewData.targetSha })}>
						<span class="sha-pill">
							<span class="sha-label">target:</span>
							<code>{shortSha(reviewData.targetSha)}</code>
						</span>
					</Tooltip>
					<Tooltip text={m.lanereview_base_sha({ sha: reviewData.baseSha })}>
						<span class="sha-pill">
							<span class="sha-label">base:</span>
							<code>{shortSha(reviewData.baseSha)}</code>
						</span>
					</Tooltip>
					<Tooltip text={m.lanereview_head_sha({ sha: reviewData.currentSha })}>
						<span class="sha-pill">
							<span class="sha-label">head:</span>
							<code>{shortSha(reviewData.currentSha)}</code>
						</span>
					</Tooltip>
					{#if reviewData.driftAhead > 0}
						<Tooltip text={m.lanereview_drift_ahead({ count: reviewData.driftAhead })}>
							<span class="badge badge-drift-ahead">
								<IconWarning />
								<span>{m.lanereview_drift_ahead({ count: reviewData.driftAhead })}</span>
							</span>
						</Tooltip>
					{:else if reviewData.driftBehind > 0}
						<span class="badge badge-drift-clean">
							<span>{m.lanereview_drift_behind({ count: reviewData.driftBehind })}</span>
						</span>
					{:else}
						<span class="badge badge-drift-clean">
							<span>{m.lanereview_drift_clean()}</span>
						</span>
					{/if}
				{/if}
			</div>
		{/snippet}

		{#snippet body()}
			<div class="review-body">
				{#if loading}
					<div class="state-overlay">
						<div class="spinner-icon"><IconRefresh /></div>
						<p>{m.lanereview_loading()}</p>
					</div>
				{:else if loadError}
					<div class="state-overlay error">
						<div class="state-icon"><IconWarning /></div>
						<p>{m.lanereview_error({ error: loadError })}</p>
						<button type="button" class="ui-button ui-button-secondary" onclick={loadReviewData}>
							<IconRefresh />
							<span>{m.lanereview_retry()}</span>
						</button>
					</div>
				{:else if reviewData}
					<!-- Colonna sinistra: Tab e navigazione master -->
					<aside class="master-panel">
						<!-- Selettore Tab -->
						<div class="tab-strip" role="tablist">
							<button
								type="button"
								role="tab"
								class="tab-btn"
								class:active={activeTab === 'files'}
								aria-selected={activeTab === 'files'}
								onclick={() => (activeTab = 'files')}
							>
								<IconFile />
								<span>{m.lanereview_tab_files({ count: reviewData.files.length })}</span>
							</button>
							<button
								type="button"
								role="tab"
								class="tab-btn"
								class:active={activeTab === 'commits'}
								aria-selected={activeTab === 'commits'}
								onclick={() => (activeTab = 'commits')}
							>
								<IconRoleCommit />
								<span>{m.lanereview_tab_commits({ count: reviewData.commits.length })}</span>
							</button>
							<button
								type="button"
								role="tab"
								class="tab-btn"
								class:active={activeTab === 'evidence'}
								aria-selected={activeTab === 'evidence'}
								onclick={() => (activeTab = 'evidence')}
							>
								<IconTerminal />
								<span>{m.lanereview_tab_evidence({ count: commandEvidence.length })}</span>
							</button>
						</div>

						<!-- Pannello 1: File modificati -->
						{#if activeTab === 'files'}
							<div class="files-view">
								<div class="filter-box">
									<span class="filter-icon" aria-hidden="true"><IconSearch /></span>
									<input
										type="text"
										class="ui-input filter-input"
										placeholder={m.lanereview_files_filter_placeholder()}
										bind:value={fileFilter}
										aria-label={m.lanereview_files_filter_placeholder()}
									/>
									{#if fileFilter}
										<button
											type="button"
											class="filter-clear"
											onclick={() => (fileFilter = '')}
											aria-label={m.settings_appearance_clear_filter()}
										>
											<IconClose />
										</button>
									{/if}
								</div>

								<div class="files-list" role="listbox" aria-label={m.lanereview_tab_files({ count: filteredFiles.length })}>
									{#if filteredFiles.length === 0}
										<div class="empty-list">
											<p>{m.lanereview_no_files()}</p>
										</div>
									{:else}
										{#each filteredFiles as file (file.path)}
											{@const isSelected = selectedFilePath === file.path}
											<button
												type="button"
												role="option"
												class="file-item"
												class:selected={isSelected}
												aria-selected={isSelected}
												onclick={() => (selectedFilePath = file.path)}
											>
												<Tooltip text={m.lanereview_file_status({ status: file.status })}>
													<span class="file-status status-{file.status}">
														{file.status}
													</span>
												</Tooltip>
												<span class="file-name">{file.path}</span>
												{#if file.isUntracked}
													<span class="untracked-tag">{m.lanereview_untracked_badge()}</span>
												{/if}
												<span class="numstat">
													{#if file.additions > 0}
														<span class="num-add">+{file.additions}</span>
													{/if}
													{#if file.deletions > 0}
														<span class="num-del">-{file.deletions}</span>
													{/if}
												</span>
											</button>
										{/each}
									{/if}
								</div>
							</div>
						{/if}

						<!-- Pannello 2: Commit eseguiti nella corsia -->
						{#if activeTab === 'commits'}
							<div class="commits-view" role="list">
								{#if reviewData.commits.length === 0}
									<div class="empty-list">
										<p>{m.lanereview_no_commits()}</p>
									</div>
								{:else}
									{#each reviewData.commits as commit (commit.hash)}
										<div class="commit-card" role="listitem">
											<div class="commit-header">
												<Tooltip text={commit.hash}>
													<code class="commit-sha">{commit.short}</code>
												</Tooltip>
												<span class="commit-meta">{commit.author} • {formatDate(commit.time)}</span>
											</div>
											<p class="commit-subject">{commit.subject}</p>
											{#if onPrepareCommit}
												<button
													type="button"
													class="btn-commit-action"
													onclick={() => onPrepareCommit?.(commit)}
												>
													{m.lanereview_prepare_commit()}
												</button>
											{/if}
										</div>
									{/each}
								{/if}
							</div>
						{/if}

						<!-- Pannello 3: Evidenze di verifica dal transcript -->
						{#if activeTab === 'evidence'}
							<div class="evidence-view" role="list">
								{#if commandEvidence.length === 0}
									<div class="empty-list">
										<p>{m.lanereview_no_evidence()}</p>
									</div>
								{:else}
									{#each commandEvidence as ev (ev.id)}
										<div class="evidence-card" class:has-error={ev.isError} role="listitem">
											<div class="evidence-head">
												<span class="cmd-label">{m.lanereview_evidence_cmd()}</span>
												<div class="evidence-meta">
													{#if ev.exitCode !== undefined}
														<span class="exit-badge" class:error={ev.exitCode !== 0}>
															{m.lanereview_evidence_exit({ code: ev.exitCode })}
														</span>
													{/if}
													{#if ev.durationMs !== undefined}
														<span class="dur-badge">
															{m.lanereview_evidence_dur({ duration: formatDuration(ev.durationMs) ?? `${ev.durationMs}ms` })}
														</span>
													{/if}
												</div>
											</div>
											<pre class="cmd-line"><code>{ev.command}</code></pre>
											{#if ev.outputSnippet}
												<pre class="cmd-output"><code>{ev.outputSnippet}</code></pre>
											{/if}
										</div>
									{/each}
								{/if}
							</div>
						{/if}
					</aside>

					<!-- Colonna destra: Monaco Diff side-by-side -->
					<main class="diff-panel">
						{#if selectedFilePath && currentFileDiff}
							<div class="diff-header-bar">
								<div class="diff-file-info">
									<span class="file-path">{selectedFilePath}</span>
									{#if currentFileDiff.isUntracked}
										<span class="untracked-tag">{m.lanereview_untracked_badge()}</span>
									{/if}
								</div>
								<div class="diff-sides-legend">
									<span class="legend-side original">
										{m.lanereview_diff_original({ branch: reviewData.targetBranch })}
									</span>
									<span class="legend-sep">↔</span>
									<span class="legend-side modified">
										{m.lanereview_diff_modified({ branch: lane.branchName ?? lane.title })}
									</span>
								</div>
							</div>

							<div class="diff-editor-host">
								<div class="monaco-diff-container" bind:this={diffContainerEl}></div>
								{#if diffLoading}
									<div class="diff-state-overlay">
										<div class="spinner-icon"><IconRefresh /></div>
										<p>{m.lanereview_loading()}</p>
									</div>
								{:else if diffError}
									<div class="diff-state-overlay error">
										<p>{diffError}</p>
									</div>
								{/if}
							</div>
						{:else}
							<div class="diff-placeholder">
								<IconDiff />
								<p>{m.lanereview_select_file()}</p>
							</div>
						{/if}
					</main>
				{/if}
			</div>
		{/snippet}

		{#snippet footer()}
			<div class="review-footer-layout">
				<div class="footer-left">
					{#if gateResult.reasons.length > 0}
						<div class="gate-warning" role="alert">
							<IconWarning />
							<span>{gateResult.reasons[0]}</span>
						</div>
					{/if}

					{#if integrateError}
						<div class="update-outcome error" role="alert">
							<IconWarning />
							<div class="error-stack">
								<span>{integrateError}</span>
								{#if integrateDetail}
									<small class="detail-text">{integrateDetail}</small>
								{/if}
							</div>
						</div>
					{/if}

					{#if integrateOutcomeMessage}
						<div class="update-outcome info" role="status">
							<IconCheck />
							<span>{integrateOutcomeMessage}</span>
						</div>
					{/if}

					{#if rejectError}
						<div class="update-outcome error" role="alert">
							<IconWarning />
							<span>{rejectError}</span>
						</div>
					{/if}
				</div>

				<div class="footer-center">
					<label class="integrate-message">
						<span class="message-label">{m.lanereview_message_label()}</span>
						<textarea
							rows="2"
							bind:value={integrateMessage}
							placeholder={lane.title}
							disabled={isIntegrating}
						></textarea>
					</label>
				</div>

				<div class="footer-right">
					<button type="button" class="ui-button ui-button-secondary" onclick={onClose}>
						{m.lanereview_action_return()}
					</button>

					{#if reviewData?.hasUnresolvedConflicts || liveLane?.status === 'conflict'}
						<button type="button" class="ui-button ui-button-secondary" onclick={handleAskAgent}>
							{m.lanereview_conflict_ask()}
						</button>
					{/if}

					<!-- Pulsante Rifiuta corsia -->
					{#if confirmStopReject}
						<div class="reject-confirm-group">
							<button type="button" class="ui-button ui-button-danger" disabled={isRejecting} onclick={handleRejectStop}>
								{m.lanereview_reject_stop()}
							</button>
							<button type="button" class="ui-button ui-button-secondary btn-sm" onclick={() => (confirmStopReject = false)}>
								{m.lanereview_confirm_cancel()}
							</button>
						</div>
					{:else if confirmReject}
						<div class="reject-confirm-group">
							<button
								type="button"
								class="ui-button ui-button-danger"
								disabled={isRejecting}
								onclick={handleRejectLane}
							>
								{m.lanereview_reject_confirm()}
							</button>
							<button
								type="button"
								class="ui-button ui-button-secondary btn-sm"
								onclick={() => (confirmReject = false)}
							>
								{m.lanereview_confirm_cancel()}
							</button>
						</div>
					{:else}
						<Tooltip text={m.lanereview_action_reject_title()}>
							<button
								type="button"
								class="ui-button ui-button-ghost btn-reject-ghost"
								onclick={() => (confirmReject = true)}
							>
								{m.lanereview_action_reject()}
							</button>
						</Tooltip>
					{/if}

					<Tooltip text={integrateTooltipText} disabled={!integrateTooltipText}>
						<button
							type="button"
							class="ui-button ui-button-primary"
							data-dialog-primary
							disabled={!gateResult.canIntegrate || isIntegrating}
							onclick={handleIntegrate}
						>
							{#if isIntegrating}
								<span class="btn-spinner"><IconRefresh /></span>
								<span>{m.lanereview_integrating()}</span>
							{:else}
								<IconCheck />
								<span>{m.lanereview_action_integrate({ branch: reviewData?.targetBranch ?? 'main' })}</span>
							{/if}
						</button>
					</Tooltip>
				</div>
			</div>
		{/snippet}
	</Dialog>
{/if}

<style>
	.header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-muted);
		--icon-size: 16px;
	}

	.meta-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-size: var(--text-caption);
		font-weight: 500;
	}

	.badge-target {
		background: color-mix(in srgb, var(--ink) 8%, transparent);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.sha-pill {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.sha-label {
		color: var(--ink-faint);
	}

	.sha-pill code {
		font-family: var(--font-mono);
		color: var(--ink-muted);
		background: var(--bg-sunken);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		font-variant-numeric: tabular-nums;
	}

	.badge-drift-ahead {
		background: color-mix(in srgb, var(--warn) 15%, transparent);
		color: var(--warn);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
	}

	.badge-drift-clean {
		background: color-mix(in srgb, var(--success) 15%, transparent);
		color: var(--success);
		border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
	}

	/* Corpo a due colonne */
	.review-body {
		flex: 1;
		display: grid;
		grid-template-columns: 360px 1fr;
		min-height: 0;
		height: 100%;
		overflow: hidden;
		position: relative;
	}

	/* Colonna Master */
	.master-panel {
		background: var(--bg-base);
		border-right: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	.tab-strip {
		display: flex;
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
	}

	.tab-btn {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-1);
		font-size: var(--text-caption);
		font-weight: 500;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--ink-muted);
		cursor: pointer;
		transition: color var(--dur-fast), border-color var(--dur-fast);
	}

	.tab-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.tab-btn.active {
		color: var(--ink);
		border-bottom-color: var(--brand);
		background: var(--bg-base);
	}

	/* Files view */
	.files-view {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.filter-box {
		padding: var(--space-2);
		border-bottom: 1px solid var(--line);
		display: flex;
		align-items: center;
		gap: var(--space-1);
		position: relative;
	}

	.filter-icon {
		color: var(--ink-faint);
		display: flex;
		align-items: center;
	}

	.filter-input {
		flex: 1;
		font-size: var(--text-caption);
	}

	.filter-clear {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		--icon-size: 12px;
		display: inline-flex;
		padding: 2px 4px;
	}

	.files-list {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-1);
	}

	.file-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 5px 8px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		text-align: left;
		font-size: var(--text-caption);
		transition: background var(--dur-fast);
	}

	.file-item:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.file-item.selected {
		background: var(--bg-active);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.file-status {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: var(--text-caption);
		min-width: 14px;
		text-align: center;
	}

	.file-status.status-M { color: var(--warn); }
	.file-status.status-A { color: var(--success); }
	.file-status.status-D { color: var(--danger); }
	.file-status.status-R { color: var(--brand-ink); }
	.file-status.status-C { color: var(--brand-ink); }
	.file-status.status-U { color: var(--warn); }

	.file-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl;
		text-align: left;
	}

	.untracked-tag {
		font-size: var(--text-caption);
		padding: 1px 4px;
		background: color-mix(in srgb, var(--warn) 15%, transparent);
		color: var(--warn);
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	.numstat {
		display: inline-flex;
		gap: 4px;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.num-add { color: var(--success); }
	.num-del { color: var(--danger); }

	/* Commits view */
	.commits-view {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.commit-card {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.commit-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: var(--text-caption);
	}

	.commit-sha {
		font-family: var(--font-mono);
		color: var(--brand-ink);
		background: var(--bg-sunken);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
	}

	.commit-meta {
		color: var(--ink-faint);
	}

	.commit-subject {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink);
		line-height: 1.35;
	}

	.btn-commit-action {
		align-self: flex-start;
		margin-top: 4px;
		font-size: var(--text-caption);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		padding: 2px 6px;
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.btn-commit-action:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	/* Evidence view */
	.evidence-view {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.evidence-card {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.evidence-card.has-error {
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
	}

	.evidence-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: var(--text-caption);
	}

	.cmd-label {
		font-weight: 600;
		color: var(--ink-muted);
		font-size: var(--text-caption);
	}

	.evidence-meta {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.exit-badge {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--ink-muted);
	}

	.exit-badge.error {
		background: color-mix(in srgb, var(--danger) 15%, transparent);
		color: var(--danger);
	}

	.dur-badge {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.cmd-line {
		margin: 0;
		background: var(--bg-sunken);
		padding: 4px 6px;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink);
		overflow-x: auto;
	}

	.cmd-output {
		margin: 0;
		background: var(--bg-sunken);
		padding: 4px 6px;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		max-height: 80px;
		overflow-y: auto;
		white-space: pre-wrap;
	}

	/* Colonna Diff */
	.diff-panel {
		background: var(--bg-sunken);
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
		position: relative;
	}

	.diff-header-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		font-size: var(--text-caption);
		gap: var(--space-2);
	}

	.diff-file-info {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		overflow: hidden;
	}

	.file-path {
		font-family: var(--font-mono);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.diff-sides-legend {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		white-space: nowrap;
	}

	.legend-side {
		font-family: var(--font-mono);
	}

	.legend-side.original {
		color: var(--ink-faint);
	}

	.legend-side.modified {
		color: var(--brand-ink);
	}

	.legend-sep {
		color: var(--ink-faint);
	}

	.diff-editor-host {
		flex: 1;
		min-height: 0;
		position: relative;
	}

	.monaco-diff-container {
		width: 100%;
		height: 100%;
	}

	.diff-state-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: color-mix(in srgb, var(--bg-sunken) 80%, transparent);
		z-index: var(--z-splitter);
		gap: var(--space-2);
		color: var(--ink-muted);
	}

	.diff-state-overlay.error {
		color: var(--danger);
	}

	.diff-placeholder {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		color: var(--ink-faint);
		font-size: var(--text-body);
	}

	.empty-list {
		padding: var(--space-4);
		text-align: center;
		color: var(--ink-faint);
		font-size: var(--text-caption);
	}

	.state-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		color: var(--ink-muted);
		background: var(--bg-base);
		z-index: var(--z-sticky);
	}

	.state-overlay.error {
		color: var(--danger);
	}

	.spinner-icon {
		animation: spin 1s linear infinite;
	}

	/* Footer */
	.review-footer-layout {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.footer-center {
		flex: 1 1 240px;
		max-width: 440px;
	}

	.integrate-message {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.message-label {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		font-weight: 500;
	}

	.integrate-message textarea {
		width: 100%;
		min-height: 2.2rem;
		height: 2.2rem;
		resize: none;
		font: inherit;
		font-size: var(--text-caption);
		color: var(--ink);
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		line-height: 1.3;
	}

	.integrate-message textarea:focus {
		border-color: var(--brand);
	}

	.error-stack {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.error-stack .detail-text {
		font-size: var(--text-caption);
		opacity: 0.85;
		word-break: break-all;
	}

	.footer-left {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex: 1;
		min-width: 0;
	}

	.gate-warning {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--danger);
		font-size: var(--text-caption);
		font-weight: 500;
	}

	.update-outcome {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-caption);
		color: var(--success);
	}

	.update-outcome.error {
		color: var(--danger);
	}

	.footer-right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.btn-sm {
		padding: 4px 8px;
		font-size: var(--text-caption);
	}

	.btn-reject-ghost {
		color: var(--danger);
	}

	.btn-reject-ghost:hover:not(:disabled) {
		background: color-mix(in oklab, var(--danger) 10%, transparent);
		color: var(--danger);
	}

	.reject-confirm-group {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.btn-spinner {
		display: inline-flex;
		animation: spin 1s linear infinite;
	}
</style>
