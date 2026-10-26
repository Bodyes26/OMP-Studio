/**
 * Reattore di proiezione dello stato della macchina per il controllo remoto (Gate R44).
 *
 * Esegue un $effect.root che osserva le collezioni reattive di Studio (progetti,
 * corsie, task, quote, attenzioni), produce HostState con buildHostState,
 * applica debounce di ~400ms, scarta snapshot JSON identiche e invia
 * lo stato aggiornato a Rust tramite remoteBridge.publishState.
 */

import { buildHostState } from './projection';
import { remoteStore } from './remoteStore.svelte';
import { remoteBridge } from './bridge';
import { projectStore } from '#lib/stores/projects.svelte.ts';
import { laneStore } from '#lib/stores/lanes.svelte.ts';
import { companionStore } from '#lib/stores/companion.svelte.ts';
import { taskStore } from '#lib/stores/tasks.svelte.ts';
import { scheduleStore } from '#lib/stores/schedule.svelte.ts';
import { quotaStore } from '#lib/stores/quota.svelte.ts';
import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
import { modelSettingsStore } from '#lib/stores/modelSettings.svelte.ts';
import { onThemeChange, getCurrentAnchors } from '#lib/theme.ts';
import { settingsStore } from '#lib/stores/settings.svelte.ts';
import { buildRemoteSessionSnapshot } from './completion.svelte';

export interface RemoteProjectionOptions {
	getCandidateTaskId?: (projectId: string) => string | null;
}

/**
 * Avvia la sincronizzazione continua dello stato verso il relay.
 * Restituisce una funzione per arrestare l'effetto e annullare timer pendenti.
 */
export function startRemoteProjection(options: RemoteProjectionOptions = {}): () => void {
	let lastPublishedJson = '';
	// Codice della WebView: il timer e' quello del browser, non il tipo di Node.
	let debounceTimer: number | null = null;
	let themeAnchors = $state(getCurrentAnchors());
	const unlistenTheme = onThemeChange(() => {
		themeAnchors = getCurrentAnchors();
	});
	const cleanupRoot = $effect.root(() => {
		$effect(() => {
			const enabled = remoteStore.status.enabled;
			const paired = remoteStore.status.paired;

			// Attivo solo quando il controllo remoto e' abilitato e abbinato
			if (!enabled || !paired) {
				window.clearTimeout(debounceTimer ?? undefined);
				debounceTimer = null;
				lastPublishedJson = '';
				return;
			}

			// Registrazione delle dipendenze reattive di Studio
			const projects = projectStore.projects;
			const activeId = projectStore.activeId;
			const lanes = laneStore.lanes;
			const runtimes = companionStore.projectRuntimes;
			const attentions = companionStore.attentionRequests;
			const tasks = taskStore.tasks;
			const now = scheduleStore.now;
			const quotaReports = quotaStore.reports;
			const quotaFetchedAt = quotaStore.lastFetchedAt;
			const theme = themeAnchors;
			const rolesMap =
				modelSettingsStore.config?.modelRoles ||
				modelSettingsStore.draftConfig?.modelRoles ||
				{};
			const knownSelectors = modelSettingsStore.knownSelectors;
			const hostState = buildHostState({
				projects: projects.map((p) => ({
					id: p.id,
					name: p.name,
					canonicalProjectPath: p.canonicalProjectPath,
					hue: p.hue,
					autoDispatch: p.autoDispatch
				})),
				activeProjectId: activeId,
				lanes: lanes.map((l) => ({
					projectId: l.projectId,
					laneId: l.laneId,
					title: l.title,
					surface: l.surface,
					kind: l.kind,
					agentState: l.agentState
				})),
				sessions: (projectId, laneId) => {
					const s = sessionRegistry.getLaneSession(projectId, laneId);
					if (s) {
						return {
							isOpen: s.isOpen,
							exited: s.exited,
							backgroundPending: s.backgroundPending,
							agentState: s.agentState,
							model: s.model,
							activityLine: s.activityLine,
							headsUp: s.headsUp,
							thinkingLevel: s.thinkingLevel,
							lastPickedRole: s.lastPickedRole,
							session: buildRemoteSessionSnapshot(s),
							context: {
								model: s.model ? {
									id: s.model.id,
									name: s.model.name,
									provider: s.model.provider,
									contextWindow: s.model.contextWindow,
									promptCache: s.model.promptCache
								} : null,
								contextUsage: s.contextUsage,
								currentContextReport: s.currentContextReport,
								contextReportStatus: s.contextReportStatus,
								isReady: s.isReady,
								isAttached: s.isAttached,
								isStreaming: s.isStreaming,
								isCompacting: s.isCompacting,
								isContextBusy: s.isContextBusy,
								sessionId: s.sessionId,
								contextReportVersion: s.contextReportVersion,
								sessionCost: s.sessionCost,
								subagentCost: s.subagentCost,
								promptCacheObservation: s.promptCacheObservation,
								promptCacheContextChanged: s.promptCacheContextChanged,
								cacheWarmingInFlight: s.cacheWarmingInFlight,
								cacheWarmingLast: s.cacheWarmingLast,
								cacheWarmingMode: settingsStore.general.cacheWarming
							}
						};
					}

					// Superficie terminale: interpola lo stato runtime reale del terminale
					const proj = projects.find((p) => p.id === projectId);
					if (proj) {
						const isMain = laneId === 'main' || proj.lane.laneId === laneId;
						const laneRecord = isMain ? null : lanes.find((l) => l.projectId === projectId && l.laneId === laneId);
						const surface = isMain ? proj.lane.surface : (laneRecord?.surface ?? 'gui');
						if (surface === 'terminal') {
							const termState = isMain ? proj.lane.agentState : (laneRecord?.agentState ?? 'unknown');
							if (termState && termState !== 'unknown') {
								return {
									isOpen: true,
									exited: false,
									agentState: termState,
									surface: 'terminal'
								};
							}
						}
					}

					return undefined;
				},
				runtimes,
				attentionRequests: attentions,
				tasks,
				resolveScheduleTarget: (t) => {
					const target = scheduleStore.targetFor(t, now);
					return { dueAt: target.dueAt, provider: target.provider };
				},
				candidateTaskIdForProject: (projId) => {
					return options.getCandidateTaskId?.(projId) ?? null;
				},
				quotaReports,
				quotaFetchedAt,
				theme,
				rolesMap,
				knownSelectors
			});

			const json = JSON.stringify(hostState);
			if (json === lastPublishedJson) return;

			window.clearTimeout(debounceTimer ?? undefined);
			debounceTimer = window.setTimeout(async () => {
				debounceTimer = null;
				lastPublishedJson = json;
				try {
					await remoteBridge.publishState(hostState);
				} catch (err) {
					console.warn('[remote] publishState fallito:', err);
				}
			}, 400);

			return () => {
				window.clearTimeout(debounceTimer ?? undefined);
				debounceTimer = null;
			};
		});
	});

	return () => {
		window.clearTimeout(debounceTimer ?? undefined);
		debounceTimer = null;
		cleanupRoot();
		unlistenTheme();
	};
}
