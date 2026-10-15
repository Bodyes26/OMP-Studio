/**
 * Comandi remoti di configurazione della corsia (Gate R44, lane_config):
 * - Nuova sessione (new_session)
 * - Catalogo del composer (composer_catalog)
 * - Impostazione ruolo (set_lane_role)
 * - Impostazione modello (set_lane_model)
 * - Impostazione livello di ragionamento (set_lane_thinking)
 */

import type {
	RemoteComposerCatalog,
	RemoteSlashCommand,
	RemoteModelOption,
	RemoteRoleOption
} from '$remote-protocol';
import { projectStore, type Project } from '$lib/stores/projects.svelte';
import { laneOrchestrator } from '$lib/lanes/laneOrchestrator.svelte';
import type { LaneRecord } from '$lib/stores/lanes.svelte';
import type { AgentLane } from '$lib/types/lanes';
import { sessionRegistry } from '$lib/agent/sessionRegistry';
import {
	parseRoleSelector,
	resolveCatalogModel,
	supportedThinkingLevels,
	STANDARD_ROLE_METAS,
	type ModelDto
} from '$lib/stores/modelSettingsHelpers';
import type { ThinkingLevel } from '$lib/agent/wire';
import { STUDIO_SLASH_COMMANDS, mergeCommands } from '$lib/agent/commands';
import { isSkillName } from '$lib/agent/suggestItems';
import { routeComposerSubmit } from '$lib/agent/composerSubmit';
import { applyRoleToSession, RoleApplyError, type RoleSettingsContext } from '$lib/agent/laneRole';
import { RemoteCommandFailure } from './commands';

const DEFAULT_THINKING_LEVELS = [
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
	'max'
];

interface TargetLaneResolution {
	project: Project;
	lane: AgentLane | LaneRecord | undefined;
	isMain: boolean;
	effectiveLaneId: string;
	surface: 'gui' | 'terminal';
}

function resolveTargetLane(projectId: string, laneId: string | null): TargetLaneResolution {
	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', `Progetto "${projectId}" non trovato`);
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;

	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure(
			'not_found',
			`Corsia "${laneId}" non trovata nel progetto "${projectId}"`
		);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	return { project, lane, isMain, effectiveLaneId, surface };
}

export interface LaneConfigDeps {
	ensureLoaded: () => Promise<void>;
	getModelConfig: () => { modelRoles?: Record<string, string>; cycleOrder?: string[] } | null | undefined;
	getAssignableCatalog: () => ModelDto[];
	getKnownSelectors?: () => ReadonlySet<string>;
}

export function createLaneConfigCommands(deps: LaneConfigDeps) {
	const roleContext: RoleSettingsContext = {
		ensureLoaded: deps.ensureLoaded,
		getModelConfig: deps.getModelConfig,
		getKnownSelectors: deps.getKnownSelectors
	};

	async function newRemoteSession(projectId: string, laneId: string | null): Promise<void> {
		const { project, lane, isMain, effectiveLaneId, surface } = resolveTargetLane(projectId, laneId);

		if (surface === 'terminal') {
			throw new RemoteCommandFailure(
				'unsupported',
				"La nuova chat non e' disponibile per corsie aperte su terminale."
			);
		}

		if (lane?.kind === 'lab') {
			throw new RemoteCommandFailure(
				'unsupported',
				"Le corsie Laboratorio mantengono una conversazione continua e non supportano nuove sessioni."
			);
		}

		let session = isMain
			? sessionRegistry.getMainSession(projectId)
			: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

		if (!session) {
			session = laneOrchestrator.getOrCreateAgentSession(project, lane ?? project.lane);
		}

		if (session.isStreaming || session.backgroundPending || session.agentState === 'working') {
			throw new RemoteCommandFailure(
				'rejected',
				"Impossibile avviare una nuova chat mentre l'agente sta lavorando o ha compiti in background."
			);
		}

		if (!session.isOpen) {
			await session.open(null);
		}

		await session.newSession();
	}

	async function getRemoteComposerCatalog(
		projectId: string,
		laneId: string | null
	): Promise<RemoteComposerCatalog> {
		const { project, lane, isMain, effectiveLaneId, surface } = resolveTargetLane(projectId, laneId);

		if (surface === 'terminal') {
			throw new RemoteCommandFailure(
				'unsupported',
				"Il catalogo del composer non e' disponibile per corsie su terminale."
			);
		}

		let session = isMain
			? sessionRegistry.getMainSession(projectId)
			: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

		if (!session) {
			session = laneOrchestrator.getOrCreateAgentSession(project, lane ?? project.lane);
		}

		await deps.ensureLoaded();

		// 1. Comandi e skill: solo quelli che routeComposerSubmit inoltra a omp
		const merged = mergeCommands(STUDIO_SLASH_COMMANDS, session.availableCommands ?? []);
		const commands: RemoteSlashCommand[] = [];
		for (const cmd of merged) {
			const isSkill = cmd.source === 'skill' || cmd.name.startsWith('skill:') || isSkillName(merged, cmd.name);
			const cleanName = cmd.name.replace(/^skill:/, '');
			const wireText = isSkill ? `/skill:${cleanName}` : `/${cmd.name}`;
			const route = routeComposerSubmit(wireText);
			if (route.kind === 'omp') {
				commands.push({
					name: cleanName,
					kind: isSkill ? 'skill' : 'command',
					description: cmd.description ?? null,
					hint: cmd.input?.hint ?? null
				});
			}
		}

		// 2. Modelli assegnabili (tetto a 600)
		const assignable = deps.getAssignableCatalog() ?? [];
		const models: RemoteModelOption[] = assignable.slice(0, 600).map((m) => ({
			provider: m.provider,
			id: m.id,
			name: m.name,
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
			reasoning: m.reasoning,
			thinking: m.thinking,
			input: m.input
		}));

		// 3. Ruoli standard con assegnazioni da configurazione
		const cfg = deps.getModelConfig();
		const rolesMap = cfg?.modelRoles || {};
		const known = deps.getKnownSelectors?.();
		const roles: RemoteRoleOption[] = STANDARD_ROLE_METAS.map((meta) => {
			const full = rolesMap[meta.id];
			let model: string | null = null;
			let modelLabel: string | null = null;
			let thinking: string | null = null;
			if (full) {
				const parsed = parseRoleSelector(full, known);
				model = parsed.provider ? `${parsed.provider}/${parsed.modelId}` : parsed.modelId;
				const catModel = resolveCatalogModel(assignable, full);
				modelLabel = catModel?.name ?? parsed.modelId;
				thinking = parsed.thinking ?? null;
			}
			return {
				id: meta.id,
				label: meta.label,
				model,
				modelLabel,
				thinking
			};
		});

		// 4. Livelli di ragionamento supportati dal modello attivo
		const thinkingLevels = (supportedThinkingLevels(session.model) ?? DEFAULT_THINKING_LEVELS) as string[];

		return {
			commands,
			models,
			roles,
			thinkingLevels
		};
	}

	async function setRemoteLaneRole(
		projectId: string,
		laneId: string | null,
		roleId: string
	): Promise<void> {
		const { project, lane, isMain, effectiveLaneId, surface } = resolveTargetLane(projectId, laneId);

		if (surface === 'terminal') {
			throw new RemoteCommandFailure(
				'unsupported',
				"La configurazione del ruolo non e' disponibile per corsie su terminale."
			);
		}

		let session = isMain
			? sessionRegistry.getMainSession(projectId)
			: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

		if (!session) {
			session = laneOrchestrator.getOrCreateAgentSession(project, lane ?? project.lane);
		}

		if (!session.isOpen) {
			if (lane?.kind === 'lab') {
				throw new RemoteCommandFailure(
					'rejected',
					"La sessione Laboratorio non e' aperta in Studio."
				);
			}
			await session.open(null);
		}

		try {
			await applyRoleToSession(session, roleId, roleContext);
		} catch (err) {
			if (err instanceof RoleApplyError) throw new RemoteCommandFailure('rejected', err.message);
			throw err;
		}
	}

	async function setRemoteLaneModel(
		projectId: string,
		laneId: string | null,
		provider: string,
		modelId: string
	): Promise<void> {
		const { project, lane, isMain, effectiveLaneId, surface } = resolveTargetLane(projectId, laneId);

		if (surface === 'terminal') {
			throw new RemoteCommandFailure(
				'unsupported',
				"La configurazione del modello non e' disponibile per corsie su terminale."
			);
		}

		let session = isMain
			? sessionRegistry.getMainSession(projectId)
			: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

		if (!session) {
			session = laneOrchestrator.getOrCreateAgentSession(project, lane ?? project.lane);
		}

		if (!session.isOpen) {
			if (lane?.kind === 'lab') {
				throw new RemoteCommandFailure(
					'rejected',
					"La sessione Laboratorio non e' aperta in Studio."
				);
			}
			await session.open(null);
		}

		await deps.ensureLoaded();
		const assignable = deps.getAssignableCatalog() ?? [];
		const found =
			assignable.find((m) => m.provider === provider && m.id === modelId) ??
			assignable.find((m) => m.selector === `${provider}/${modelId}` || m.selector === modelId);

		if (!found) {
			throw new RemoteCommandFailure(
				'rejected',
				`Modello "${provider}/${modelId}" non trovato tra i modelli assegnabili configurati.`
			);
		}

		await session.client.send({
			type: 'set_model',
			provider,
			modelId
		});
		await session.refreshState();
	}

	async function setRemoteLaneThinking(
		projectId: string,
		laneId: string | null,
		level: string
	): Promise<void> {
		const { project, lane, isMain, effectiveLaneId, surface } = resolveTargetLane(projectId, laneId);

		if (surface === 'terminal') {
			throw new RemoteCommandFailure(
				'unsupported',
				"La configurazione del ragionamento non e' disponibile per corsie su terminale."
			);
		}

		let session = isMain
			? sessionRegistry.getMainSession(projectId)
			: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

		if (!session) {
			session = laneOrchestrator.getOrCreateAgentSession(project, lane ?? project.lane);
		}

		if (!session.isOpen) {
			if (lane?.kind === 'lab') {
				throw new RemoteCommandFailure(
					'rejected',
					"La sessione Laboratorio non e' aperta in Studio."
				);
			}
			await session.open(null);
		}

		const supported = supportedThinkingLevels(session.model) ?? DEFAULT_THINKING_LEVELS;
		if (!(supported as readonly string[]).includes(level)) {
			throw new RemoteCommandFailure(
				'rejected',
				`Livello di ragionamento "${level}" non valido o non supportato dal modello.`
			);
		}

		await session.client.send({
			type: 'set_thinking_level',
			level: level as ThinkingLevel
		});
		await session.refreshState();
	}

	return {
		newRemoteSession,
		getRemoteComposerCatalog,
		setRemoteLaneRole,
		setRemoteLaneModel,
		setRemoteLaneThinking
	};
}
