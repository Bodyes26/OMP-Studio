/**
 * Comandi remoti di configurazione della corsia (Gate R44, lane_config):
 * - Catalogo del composer (composer_catalog)
 * - Impostazione ruolo (set_lane_role)
 * - Impostazione modello (set_lane_model)
 * - Impostazione livello di ragionamento (set_lane_thinking)
 */

import type {
	RemoteComposerCatalog,
	RemoteSlashCommand,
	RemoteModelOption,
	RemoteRoleOption,
	RemoteDirectiveOption
} from '$remote-protocol';
import { settingsStore } from '#lib/stores/settings.svelte.ts';
import { directiveDisplayName, directiveDisplayDescription } from '#lib/stores/taskDirectives.ts';
import { projectStore, type Project } from '#lib/stores/projects.svelte.ts';
import { laneOrchestrator } from '#lib/lanes/laneOrchestrator.svelte.ts';
import type { LaneRecord } from '#lib/stores/lanes.svelte.ts';
import type { AgentLane } from '#lib/types/lanes.ts';
import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
import { m } from '#lib/paraglide/messages.js';
import {
	parseRoleSelector,
	resolveCatalogModel,
	supportedThinkingLevels,
	STANDARD_ROLE_METAS,
	type ModelDto
} from '#lib/stores/modelSettingsHelpers.ts';
import type { ThinkingLevel } from '#lib/agent/wire.ts';
import { STUDIO_SLASH_COMMANDS, mergeCommands } from '#lib/agent/commands.ts';
import { isSkillName } from '#lib/agent/suggestItems.ts';
import { routeComposerSubmit } from '#lib/agent/composerSubmit.ts';
import { applyRoleToSession, RoleApplyError, type RoleSettingsContext } from '#lib/agent/laneRole.ts';
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
		throw new RemoteCommandFailure('not_found', m.l10n_lab_remote_project_not_found({ project: projectId }));
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;

	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure(
			'not_found',
			m.l10n_lab_remote_lane_not_found({ lane: laneId ?? 'main', project: projectId })
		);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	return { project, lane, isMain, effectiveLaneId, surface };
}

export interface LaneConfigDeps {
	ensureLoaded: () => Promise<void>;
	/** Solo `config.yml` e catalogo: applicare un ruolo non richiede `omp models --json`. */
	ensureRoleConfig: () => Promise<void>;
	getModelConfig: () => { modelRoles?: Record<string, string>; cycleOrder?: string[] } | null | undefined;
	getAssignableCatalog: () => ModelDto[];
	getKnownSelectors?: () => ReadonlySet<string>;
}

export function createLaneConfigCommands(deps: LaneConfigDeps) {
	const roleContext: RoleSettingsContext = {
		ensureLoaded: deps.ensureRoleConfig,
		getModelConfig: deps.getModelConfig,
		getKnownSelectors: deps.getKnownSelectors
	};


	async function getRemoteComposerCatalog(
		projectId: string,
		laneId: string | null
	): Promise<RemoteComposerCatalog> {
		const { project, lane, isMain, effectiveLaneId, surface } = resolveTargetLane(projectId, laneId);

		if (surface === 'terminal') {
			throw new RemoteCommandFailure(
				'unsupported',
				m.l10n_lab_remote_composer_catalog_terminal_unavailable()
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
		const models: RemoteModelOption[] = assignable.slice(0, 600).map((option) => ({
			provider: option.provider,
			id: option.id,
			name: option.name,
			contextWindow: option.contextWindow,
			maxTokens: option.maxTokens,
			reasoning: option.reasoning,
			thinking: option.thinking,
			input: option.input
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

		// 5. Direttive visibili del catalogo dei task (Gate R48)
		const directives: RemoteDirectiveOption[] = (settingsStore.taskDirectives || [])
			.filter((d) => !d.hidden)
			.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
			.map((d) => ({
				id: d.id,
				name: directiveDisplayName(d) || d.name,
				description: directiveDisplayDescription(d) || d.description || null
			}));

		return {
			commands,
			models,
			roles,
			thinkingLevels,
			directives
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
				m.l10n_lab_remote_role_config_terminal_unavailable()
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
					m.l10n_lab_remote_lab_lane_not_open()
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
				m.l10n_lab_remote_model_config_terminal_unavailable()
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
					m.l10n_lab_remote_lab_lane_not_open()
				);
			}
			await session.open(null);
		}

		await deps.ensureLoaded();
		const assignable = deps.getAssignableCatalog() ?? [];
		const found =
			assignable.find((option) => option.provider === provider && option.id === modelId) ??
			assignable.find(
				(option) => option.selector === `${provider}/${modelId}` || option.selector === modelId
			);

		if (!found) {
			throw new RemoteCommandFailure(
				'rejected',
				m.l10n_lab_remote_model_not_found({ model: `${provider}/${modelId}` })
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
				m.l10n_lab_remote_thinking_config_terminal_unavailable()
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
					m.l10n_lab_remote_lab_lane_not_open()
				);
			}
			await session.open(null);
		}

		const supported = supportedThinkingLevels(session.model) ?? DEFAULT_THINKING_LEVELS;
		if (!(supported as readonly string[]).includes(level)) {
			throw new RemoteCommandFailure(
				'rejected',
				m.l10n_lab_remote_thinking_level_invalid({ level })
			);
		}

		await session.client.send({
			type: 'set_thinking_level',
			level: level as ThinkingLevel
		});
		await session.refreshState();
	}

	return {
		getRemoteComposerCatalog,
		setRemoteLaneRole,
		setRemoteLaneModel,
		setRemoteLaneThinking
	};
}
