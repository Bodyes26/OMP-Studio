<!--
  LaneReviewModal.svelte — Superficie di revisione e integrazione di una corsia isolata (Gate R27 / PLAN W12).

  Invarianti:
  1. Revisione non muta mai il branch target ne' il working tree principale.
  2. Mostra target/base/current SHA, drift, commit, file con numstat e diff Monaco side-by-side.
  3. Include sia file tracciati sia file non tracciati rilevanti.
  4. Evidenze dal transcript rigorosamente reali: comandi, exit code, durata misurata. Nessun "passed" inventato.
  5. Integrazione disabilitata con motivazioni esplicite (target dirty, corsia sporca, checkout diverso, processi non verificabili o vivi, stato non review_ready, conflitti, target avanzato).
  6. Azioni lecite: torna alla corsia, prepara commit selezionato, aggiorna dal target, integra, rifiuta.
  7. Accessibilita' APG: dialog modale, trapFocus, navigazione tastiera, contrasti WCAG AA.
-->
<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { invoke } from '@tauri-apps/api/core';
	import { m } from '$lib/paraglide/messages.js';
	import { trapFocus } from '$lib/focusTrap';
	import {
		IconClose,
		IconWarning,
		IconCheck,
		IconRefresh,
		IconDiff,
		IconFile,
		IconGitBranch,
		IconSearch,
		IconRoleCommit,
		IconTerminal
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

	export interface WorktreeUpdateOutcome {
		success: boolean;
		conflicted: boolean;
		conflictFiles: string[];
		message: string;
	}

	export interface WorktreeIntegrateOutcome {
		phase: 'integrated' | 'already_integrated';
		commit: string;
		targetBranch: string;
		strategy: 'squash' | 'preserve';
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
	let isUpdating = $state(false);
	let updateOutcome = $state<WorktreeUpdateOutcome | null>(null);
	let confirmReject = $state(false);
	let confirmStopReject = $state(false);
	let isRejecting = $state(false);
	let rejectError = $state<string | null>(null);
	let confirmIntegrate = $state(false);
	let integrateStrategy = $state<'squash' | 'preserve'>('squash');
	let integrateMessage = $state('');
	let deleteBranch = $state(false);
	let isIntegrating = $state(false);
	let integrateError = $state<string | null>(null);
	let integrateCleanup = $state<'processes' | 'pending' | null>(null);
	let pendingBranchDelete = $state(false);
	let processCheckFailed = $state(false);

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
			return { canIntegrate: false, reasons: [], needsUpdateFromTarget: false };
		}
		return evaluateIntegrationGate(
			{
				laneStatus: liveLane.status,
				isTargetDirty: reviewData.isTargetDirty,
				targetDirtyFilesCount: reviewData.targetDirtyFiles.length,
				isLaneDirty: reviewData.isLaneDirty,
				laneDirtyFilesCount: reviewData.laneDirtyFiles.length,
				isTargetCheckedOut: reviewData.isTargetCheckedOut,
				liveProcessesCount: liveProcesses.length,
				processCheckFailed,
				hasUnresolvedConflicts: reviewData.hasUnresolvedConflicts,
				driftAhead: reviewData.driftAhead
			},
			{
				targetDirty: (count) => m.lanereview_gate_target_dirty({ count }),
				laneDirty: (count) => m.lanereview_gate_lane_dirty({ count }),
				checkoutMismatch: () => m.lanereview_gate_checkout(),
				liveProcesses: (count) => m.lanereview_gate_live_processes({ count }),
				processCheckFailed: () => m.lanereview_gate_process_check(),
				notReady: (status) => m.lanereview_gate_not_ready({ status }),
				conflicts: () => m.lanereview_gate_conflicts(),
				targetAdvanced: () => m.lanereview_gate_target_advanced()
			}
		);
	});

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
			updateOutcome = null;
			confirmReject = false;
			confirmStopReject = false;
			confirmIntegrate = false;
			integrateMessage = '';
			deleteBranch = false;
			integrateError = null;
			rejectError = null;
			integrateCleanup = null;
			pendingBranchDelete = false;
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

	function invokeErrorCode(error: unknown): string | null {
		if (typeof error !== 'object' || error === null) return null;
		const code = (error as { code?: unknown }).code;
		return typeof code === 'string' ? code : null;
	}

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

	// Azione: Aggiorna dal target
	async function handleUpdateFromTarget() {
		if (!lane?.workspacePath || isUpdating) return;
		isUpdating = true;
		updateOutcome = null;

		try {
			const outcome = await invoke<WorktreeUpdateOutcome>('worktree_update_from_target', {
				args: {
					projectPath: project.canonicalProjectPath,
					worktreePath: lane.workspacePath,
					targetBranch: reviewData?.targetBranch ?? lane.targetBranch ?? undefined
				}
			});
			updateOutcome = outcome;

			if (outcome.conflicted && lane) {
				await laneStore.updateLane(project.id as ProjectId, lane.laneId, { status: 'conflict' });
			}

			// Ricarica la review per aggiornare drift e file
			await loadReviewData();
		} catch (err: any) {
			updateOutcome = {
				success: false,
				conflicted: false,
				conflictFiles: [],
				message: err?.message || String(err)
			};
		} finally {
			isUpdating = false;
		}
	}

	async function handleRejectLane() {
		if (!lane || isRejecting) return;
		isRejecting = true;
		rejectError = null;
		try {
			const outcome = await laneStore.archiveLane(project.id as ProjectId, lane.laneId, 'rejected', {
				stopProcesses: false
			});
			if (outcome.kind === 'archived') {
				onClose();
				return;
			}
			if (outcome.kind === 'processes-active') confirmStopReject = true;
			rejectError = outcome.diagnosis.message;
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
			const outcome = await laneStore.archiveLane(project.id as ProjectId, lane.laneId, 'rejected', {
				stopProcesses: true
			});
			if (outcome.kind === 'archived') {
				onClose();
				return;
			}
			rejectError = outcome.diagnosis.message;
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

	async function deleteIntegratedBranch(): Promise<boolean> {
		if (!lane) return false;
		try {
			await invoke('worktree_delete_lane_branch', {
				args: {
					projectPath: project.canonicalProjectPath,
					laneId: lane.laneId,
					confirm: true
				}
			});
			pendingBranchDelete = false;
			return true;
		} catch (error) {
			integrateError = invokeErrorMessage(error);
			pendingBranchDelete = true;
			return false;
		}
	}

	async function finishIntegratedArchive(stopProcesses: boolean) {
		if (!lane) return;
		const outcome = await laneStore.archiveLane(project.id as ProjectId, lane.laneId, 'integrated', {
			stopProcesses
		});
		if (outcome.kind === 'archived') {
			integrateCleanup = null;
			if (deleteBranch) {
				const deleted = await deleteIntegratedBranch();
				if (!deleted) return;
			}
			onClose();
			return;
		}
		integrateCleanup = outcome.kind === 'processes-active' ? 'processes' : 'pending';
		integrateError =
			outcome.kind === 'processes-active'
				? m.lanereview_landed_processes()
				: outcome.diagnosis.message || m.lanereview_landed_cleanup();
	}

	async function runIntegrate() {
		if (!lane?.workspacePath || !reviewData || isIntegrating) return;
		const message = (integrateMessage.trim() || lane.title).trim();
		if (integrateStrategy === 'squash' && !message) {
			integrateError = m.lanereview_message_required();
			return;
		}
		isIntegrating = true;
		integrateError = null;
		const projectId = project.id as ProjectId;
		const previous = liveLane?.status ?? lane.status;
		let landed = false;
		try {
			if (previous !== 'integrating') {
				await laneStore.updateLane(projectId, lane.laneId, { status: 'integrating' });
			}
			await invoke<WorktreeIntegrateOutcome>('worktree_integrate', {
				args: {
					projectPath: project.canonicalProjectPath,
					worktreePath: lane.workspacePath,
					laneId: lane.laneId,
					targetBranch: reviewData.targetBranch,
					expectedTargetSha: reviewData.targetSha,
					expectedLaneSha: reviewData.currentSha,
					message,
					strategy: integrateStrategy
				}
			});
			landed = true;
			await finishIntegratedArchive(false);
		} catch (error) {
			const code = invokeErrorCode(error);
			if (!landed && code !== 'checkout_sync_failed' && previous !== 'integrating') {
				const revert = previous === 'conflict' ? 'conflict' : 'review_ready';
				await laneStore.updateLane(projectId, lane.laneId, { status: revert }).catch(() => undefined);
			}
			integrateError = invokeErrorMessage(error);
		} finally {
			isIntegrating = false;
		}
	}

	async function handleStopIntegrateProcesses() {
		if (!lane || isIntegrating) return;
		isIntegrating = true;
		integrateError = null;
		try {
			await finishIntegratedArchive(true);
		} catch (error) {
			integrateError = invokeErrorMessage(error);
		} finally {
			isIntegrating = false;
		}
	}

	function handleIntegrate() {
		if (!gateResult.canIntegrate || !lane) return;
		confirmReject = false;
		confirmStopReject = false;
		if (liveLane?.status === 'integrating') {
			void runIntegrate();
			return;
		}
		confirmIntegrate = true;
		integrateStrategy = 'squash';
		deleteBranch = false;
		if (!integrateMessage.trim()) integrateMessage = lane.title;
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
	<!-- Sfondo modale oscurante -->
	<button
		type="button"
		class="modal-backdrop"
		onclick={onClose}
		aria-label={m.lanereview_close()}
		tabindex="-1"
		transition:fade={{ duration: 150 }}
	></button>

	<!-- Finestra principale della superficie di revisione -->
	<div
		class="review-modal"
		role="dialog"
		aria-modal="true"
		aria-labelledby="review-modal-title"
		use:trapFocus={{ onEscape: onClose }}
		transition:fly={{ y: -16, duration: 200, easing: cubicOut }}
	>
		<!-- Header della revisione -->
		<header class="review-header">
			<div class="header-main">
				<div class="header-icon" aria-hidden="true">
					<IconDiff />
				</div>
				<div class="header-titles">
					<h2 id="review-modal-title" class="title">
						{m.lanereview_modal_title({ title: lane.title })}
					</h2>
					<div class="meta-row">
						<span class="badge badge-target" title={m.lanereview_target_branch({ branch: reviewData?.targetBranch ?? 'main' })}>
							<IconGitBranch />
							<span>{reviewData?.targetBranch ?? lane.targetBranch ?? 'main'}</span>
						</span>
						{#if reviewData}
							<span class="sha-pill" title="Target SHA: {reviewData.targetSha}">
								<span class="sha-label">target:</span>
								<code>{shortSha(reviewData.targetSha)}</code>
							</span>
							<span class="sha-pill" title="Base SHA: {reviewData.baseSha}">
								<span class="sha-label">base:</span>
								<code>{shortSha(reviewData.baseSha)}</code>
							</span>
							<span class="sha-pill" title="Current SHA: {reviewData.currentSha}">
								<span class="sha-label">head:</span>
								<code>{shortSha(reviewData.currentSha)}</code>
							</span>
							{#if reviewData.driftAhead > 0}
								<span class="badge badge-drift-ahead" title={m.lanereview_drift_ahead({ count: reviewData.driftAhead })}>
									<IconWarning />
									<span>{m.lanereview_drift_ahead({ count: reviewData.driftAhead })}</span>
								</span>
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
				</div>
			</div>
			<div class="header-actions">
				<button
					type="button"
					class="btn-close"
					onclick={onClose}
					title={m.lanereview_close()}
					aria-label={m.lanereview_close()}
				>
					<IconClose />
				</button>
			</div>
		</header>

		<!-- Corpo a due colonne: Master lista a sinistra, Diff side-by-side a destra -->
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
					<button type="button" class="btn-secondary" onclick={loadReviewData}>
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
									class="filter-input"
									placeholder={m.lanereview_files_filter_placeholder()}
									bind:value={fileFilter}
									aria-label={m.lanereview_files_filter_placeholder()}
								/>
								{#if fileFilter}
									<button
										type="button"
										class="filter-clear"
										onclick={() => (fileFilter = '')}
										aria-label="Cancella filtro"
									>
										&times;
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
											<span class="file-status status-{file.status}" title="Stato: {file.status}">
												{file.status}
											</span>
											<span class="file-name" title={file.path}>{file.path}</span>
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
											<code class="commit-sha" title={commit.hash}>{commit.short}</code>
											<span class="commit-meta">{commit.author} • {formatDate(commit.time)}</span>
										</div>
										<p class="commit-subject">{commit.subject}</p>
										{#if onPrepareCommit}
											<button
												type="button"
												class="btn-commit-action"
												onclick={() => onPrepareCommit?.(commit)}
											>
												Prepara commit selezionato
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
								<span class="file-status status-{currentFileDiff.status}">
									{currentFileDiff.status}
								</span>
								<span class="file-path">{currentFileDiff.path}</span>
								<span class="numstat">
									{#if currentFileDiff.additions > 0}
										<span class="num-add">+{currentFileDiff.additions}</span>
									{/if}
									{#if currentFileDiff.deletions > 0}
										<span class="num-del">-{currentFileDiff.deletions}</span>
									{/if}
								</span>
							</div>
							<div class="diff-sides-legend">
								<span class="legend-side original">
									{m.lanereview_diff_original({ branch: reviewData.targetBranch })}
								</span>
								<span class="legend-sep">→</span>
								<span class="legend-side modified">
									{m.lanereview_diff_modified({ branch: lane.branch ?? 'lane' })}
								</span>
							</div>
						</div>

						<div class="diff-editor-host">
							{#if diffLoading}
								<div class="diff-state-overlay">
									<div class="spinner-icon"><IconRefresh /></div>
								</div>
							{:else if diffError}
								<div class="diff-state-overlay error">
									<IconWarning />
									<p>{diffError}</p>
								</div>
							{/if}
							<!-- Contenitore nativo per Monaco Diff -->
							<div class="monaco-diff-container" bind:this={diffContainerEl}></div>
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

		<!-- Footer azioni e controlli di integrazione -->
		<footer class="review-footer">
			<div class="footer-left">
				{#if reviewData?.isTargetDirty}
					<div class="gate-warning" role="alert">
						<IconWarning />
						<span>{m.lanereview_gate_target_dirty({ count: reviewData.targetDirtyFiles.length })}</span>
					</div>
				{:else if liveProcesses.length > 0}
					<div class="gate-warning" role="alert">
						<IconWarning />
						<span>{m.lanereview_gate_live_processes({ count: liveProcesses.length })}</span>
					</div>
				{:else if gateResult.reasons.length > 0}
					<div class="gate-warning" role="alert">
						<IconWarning />
						<span>{gateResult.reasons[0]}</span>
					</div>
				{:else if reviewData?.driftAhead && gateResult.needsUpdateFromTarget}
					<div class="gate-hint">
						<IconWarning />
						<span>{m.lanereview_gate_target_advanced()}</span>
					</div>
				{/if}

				{#if integrateError}
					<div class="update-outcome error" role="alert">
						<IconWarning />
						<span>{integrateError}</span>
					</div>
				{/if}
				{#if rejectError}
					<div class="update-outcome error" role="alert">
						<IconWarning />
						<span>{rejectError}</span>
					</div>
				{/if}

				{#if updateOutcome}
					<div class="update-outcome" class:error={updateOutcome.conflicted || !updateOutcome.success}>
						{#if updateOutcome.success}
							<IconCheck />
							<span>{m.lanereview_update_success()}</span>
						{:else if updateOutcome.conflicted}
							<IconWarning />
							<span>{m.lanereview_update_conflict()}</span>
						{:else}
							<IconWarning />
							<span>{updateOutcome.message}</span>
						{/if}
					</div>
				{/if}
			</div>

			{#if confirmIntegrate}
				<form
					class="integrate-confirm"
					onsubmit={(event) => {
						event.preventDefault();
						void runIntegrate();
					}}
				>
					<fieldset>
						<legend>{m.lanereview_confirm_integrate()}</legend>
						<label>
							<input type="radio" name="integrate-strategy" value="squash" bind:group={integrateStrategy} />
							{m.lanereview_strategy_squash()}
						</label>
						<label>
							<input type="radio" name="integrate-strategy" value="preserve" bind:group={integrateStrategy} />
							{m.lanereview_strategy_preserve()}
						</label>
					</fieldset>
					<label class="integrate-message">
						<span>{m.lanereview_message_label()}</span>
						<textarea rows="2" bind:value={integrateMessage}></textarea>
					</label>
					<label>
						<input type="checkbox" bind:checked={deleteBranch} />
						{m.lanereview_delete_branch()}
					</label>
					<p class="integrate-hint">{m.lanereview_delete_branch_hint()}</p>
					<div class="reject-confirm-group">
						<button type="button" class="btn-secondary" onclick={() => (confirmIntegrate = false)}>
							{m.lanereview_confirm_cancel()}
						</button>
						<button type="submit" class="btn-primary" disabled={isIntegrating || !gateResult.canIntegrate}>
							{m.lanereview_confirm_integrate()}
						</button>
					</div>
				</form>
			{/if}

			<div class="footer-right">
				<button type="button" class="btn-secondary" onclick={onClose}>
					{m.lanereview_action_return()}
				</button>

				{#if reviewData?.hasUnresolvedConflicts}
					<button type="button" class="btn-secondary" onclick={handleAskAgent}>
						{m.lanereview_conflict_ask()}
					</button>
				{/if}

				<button
					type="button"
					class="btn-secondary"
					disabled={isUpdating}
					title={m.lanereview_action_update_title()}
					onclick={handleUpdateFromTarget}
				>
					{#if isUpdating}
						<span class="btn-spinner"><IconRefresh /></span>
						<span>{m.lanereview_updating()}</span>
					{:else}
						<IconRefresh />
						<span>{m.lanereview_action_update()}</span>
					{/if}
				</button>

				<!-- Pulsante 3: Rifiuta corsia -->
				{#if confirmStopReject}
					<div class="reject-confirm-group">
						<button type="button" class="btn-danger" disabled={isRejecting} onclick={handleRejectStop}>
							{m.lanereview_reject_stop()}
						</button>
						<button type="button" class="btn-secondary btn-sm" onclick={() => (confirmStopReject = false)}>
							{m.lanereview_confirm_cancel()}
						</button>
					</div>
				{:else if confirmReject}
					<div class="reject-confirm-group">
						<button
							type="button"
							class="btn-danger"
							disabled={isRejecting}
							onclick={handleRejectLane}
						>
							{m.lanereview_reject_confirm()}
						</button>
						<button
							type="button"
							class="btn-secondary btn-sm"
							onclick={() => (confirmReject = false)}
						>
							{m.lanereview_confirm_cancel()}
						</button>
					</div>
				{:else}
					<button
						type="button"
						class="btn-danger-ghost"
						title={m.lanereview_action_reject_title()}
						onclick={() => (confirmReject = true)}
					>
						{m.lanereview_action_reject()}
					</button>
				{/if}

				{#if integrateCleanup === 'processes'}
					<button
						type="button"
						class="btn-danger"
						disabled={isIntegrating}
						onclick={() => void handleStopIntegrateProcesses()}
					>
						{m.lanereview_reject_stop()}
					</button>
				{/if}
				{#if pendingBranchDelete}
					<button type="button" class="btn-secondary" onclick={() => void deleteIntegratedBranch()}>
						{m.lanereview_retry_delete_branch()}
					</button>
				{/if}
				{#if !confirmIntegrate}
					<button
						type="button"
						class="btn-primary"
						disabled={!gateResult.canIntegrate || isIntegrating}
						title={gateResult.canIntegrate ? '' : (gateResult.reasons[0] ?? m.lanereview_action_integrate_disabled_tooltip())}
						onclick={handleIntegrate}
					>
						{#if isIntegrating}
							<span class="btn-spinner"><IconRefresh /></span>
							<span>{m.lanereview_integrating()}</span>
						{:else if liveLane?.status === 'integrating'}
							<IconCheck />
							<span>{m.lanereview_complete_integration()}</span>
						{:else}
							<IconCheck />
							<span>{m.lanereview_action_integrate({ branch: reviewData?.targetBranch ?? 'main' })}</span>
						{/if}
					</button>
				{/if}
			</div>
		</footer>
	</div>
{/if}

<style>
	/* Velo backdrop scuro semitrasparente */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: oklch(0 0 0 / 0.65);
		z-index: var(--z-dialog);
		border: none;
		margin: 0;
		padding: 0;
		cursor: default;
	}

	/* Finestra modale principale */
	.review-modal {
		position: fixed;
		inset: 32px;
		max-width: 1400px;
		max-height: 900px;
		margin: auto;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: calc(var(--z-dialog) + 1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		outline: none;
		font-family: var(--font-ui);
		color: var(--ink);
	}

	/* Header */
	.review-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		gap: var(--space-3);
	}

	.header-main {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}

	.header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--brand-ink);
		font-size: 16px;
	}

	.header-titles {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.title {
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
		font-size: var(--text-xs);
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
		font-size: var(--text-xs);
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

	.btn-close {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		padding: var(--space-1);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.btn-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	/* Corpo a due colonne */
	.review-body {
		flex: 1;
		display: grid;
		grid-template-columns: 360px 1fr;
		min-height: 0;
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
		font-size: var(--text-xs);
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
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		padding: 4px 8px;
		outline: none;
	}

	.filter-input:focus {
		border-color: var(--brand);
	}

	.filter-clear {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		font-size: 14px;
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
		font-size: var(--text-xs);
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
		font-size: 11px;
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
		font-size: 10px;
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
		font-size: 11px;
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
		font-size: 11px;
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
		font-size: var(--text-xs);
		color: var(--ink);
		line-height: 1.35;
	}

	.btn-commit-action {
		align-self: flex-start;
		margin-top: 4px;
		font-size: 11px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		padding: 2px 6px;
		cursor: pointer;
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
		font-size: 11px;
	}

	.cmd-label {
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		font-size: 10px;
		letter-spacing: 0.05em;
	}

	.evidence-meta {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.exit-badge {
		font-family: var(--font-mono);
		font-size: 10px;
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
		font-size: 10px;
		color: var(--ink-faint);
	}

	.cmd-line {
		margin: 0;
		background: var(--bg-sunken);
		padding: 4px 6px;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink);
		overflow-x: auto;
	}

	.cmd-output {
		margin: 0;
		background: var(--bg-sunken);
		padding: 4px 6px;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 10px;
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
		font-size: var(--text-xs);
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
		font-size: 11px;
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
		z-index: 10;
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
		font-size: var(--text-sm);
	}

	.empty-list {
		padding: var(--space-4);
		text-align: center;
		color: var(--ink-faint);
		font-size: var(--text-xs);
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
		z-index: 20;
	}

	.state-overlay.error {
		color: var(--danger);
	}

	.spinner-icon {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	/* Footer */
	.review-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		padding: var(--space-3) var(--space-4);
		background: var(--bg-raised);
		border-top: 1px solid var(--line);
		gap: var(--space-3);
	}

	.integrate-confirm {
		flex: 1 0 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-base);
	}

	.integrate-confirm fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		border: none;
		margin: 0;
		padding: 0;
	}

	.integrate-confirm legend {
		font-size: var(--text-sm);
		font-weight: 600;
		margin-bottom: var(--space-1);
	}

	.integrate-confirm label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-sm);
	}

	.integrate-message {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-1);
	}

	.integrate-confirm textarea {
		width: 100%;
		min-height: 3.5rem;
		resize: vertical;
		font: inherit;
		color: var(--ink);
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2);
	}

	.integrate-hint {
		margin: 0;
		color: var(--ink-faint);
		font-size: var(--text-xs);
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
		font-size: var(--text-xs);
		font-weight: 500;
	}

	.gate-hint {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--warn);
		font-size: var(--text-xs);
	}

	.update-outcome {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-xs);
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

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		padding: 6px 12px;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: background var(--dur-fast);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-sm {
		padding: 4px 8px;
		font-size: var(--text-xs);
	}

	.btn-danger-ghost {
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--danger);
		padding: 6px 12px;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: background var(--dur-fast);
	}

	.btn-danger-ghost:hover {
		background: color-mix(in srgb, var(--danger) 15%, transparent);
	}

	.btn-danger {
		background: var(--danger);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: #ffffff;
		padding: 6px 12px;
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
	}

	.btn-danger:hover:not(:disabled) {
		opacity: 0.9;
	}

	.reject-confirm-group {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: var(--brand);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: #ffffff;
		padding: 6px 14px;
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition: opacity var(--dur-fast);
	}

	.btn-primary:hover:not(:disabled) {
		opacity: 0.92;
	}

	.btn-primary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		background: var(--bg-base);
		color: var(--ink-faint);
		border-color: var(--line);
	}

	.btn-spinner {
		display: inline-flex;
		animation: spin 1s linear infinite;
	}
</style>
