/**
 * Applicazione di un ruolo alla sessione dell'agente.
 * Condivisa tra il comando slash della GUI (/role) e il controllo remoto (set_lane_role).
 */

import {
	parseRoleSelector,
	resolveActiveRole,
	nextCycleRole
} from '$lib/stores/modelSettingsHelpers';
import type { RpcCommand, ThinkingLevel } from '$lib/agent/wire';

/**
 * Ruolo non applicabile. Il motivo e' un codice e non un testo: la GUI lo
 * traduce coi suoi messaggi, il controllo remoto lo rifiuta come `rejected`.
 */
// Campi espliciti: i test girano con lo strip dei tipi di Node, che non accetta
// le parameter property.
export class RoleApplyError extends Error {
	readonly reason: 'no_configured_roles' | 'unconfigured_role';
	readonly role: string;

	constructor(reason: 'no_configured_roles' | 'unconfigured_role', role: string) {
		super(reason === 'no_configured_roles' ? 'Nessun ruolo configurato nel ciclo rapido' : `Ruolo "${role}" senza modello assegnato`);
		this.name = 'RoleApplyError';
		this.reason = reason;
		this.role = role;
	}
}

export interface RoleApplicableSession {
	client: { send: <T = unknown>(command: RpcCommand) => Promise<T> };
	model?: { id?: string; name?: string; provider?: string } | null;
	thinkingLevel?: string | null;
	lastPickedRole?: string | null;
	refreshState: () => Promise<unknown>;
}

export interface RoleSettingsContext {
	ensureLoaded?: () => Promise<void>;
	getModelConfig: () => { modelRoles?: Record<string, string>; cycleOrder?: string[] } | null | undefined;
	getKnownSelectors?: () => ReadonlySet<string>;
}

export async function applyRoleToSession(
	session: RoleApplicableSession,
	roleArg: string,
	context: RoleSettingsContext
): Promise<{ role: string; modelId: string; provider: string; thinking: string | null }> {
	const trimmed = (roleArg ?? '').trim();
	if (!trimmed) {
		throw new RoleApplyError('unconfigured_role', '');
	}

	if (context.ensureLoaded) {
		await context.ensureLoaded();
	}
	const cfg = context.getModelConfig();
	const rolesMap = cfg?.modelRoles || {};
	const known = context.getKnownSelectors?.();

	const arg = trimmed.toLowerCase();
	let role = arg;
	if (arg === 'next' || arg === 'cycle') {
		const current = resolveActiveRole(
			rolesMap,
			session.model,
			session.thinkingLevel,
			session.lastPickedRole,
			known
		);
		const next = nextCycleRole(cfg?.cycleOrder ?? [], rolesMap, current);
		if (!next) {
			throw new RoleApplyError('no_configured_roles', arg);
		}
		role = next;
	}

	const full = rolesMap[role];
	const { provider, modelId, thinking } = full ? parseRoleSelector(full, known) : { provider: '', modelId: '', thinking: null };
	if (!modelId) {
		throw new RoleApplyError('unconfigured_role', role);
	}

	const resolvedProvider = provider || session.model?.provider || '';
	await session.client.send({
		type: 'set_model',
		provider: resolvedProvider,
		modelId
	});

	if (thinking && thinking !== 'auto') {
		await session.client.send({
			type: 'set_thinking_level',
			level: thinking as ThinkingLevel
		});
	}

	session.lastPickedRole = role;
	await session.refreshState();

	return {
		role,
		modelId,
		provider: resolvedProvider,
		thinking: thinking ?? null
	};
}
