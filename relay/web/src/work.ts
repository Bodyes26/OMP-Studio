/**
 * Regole pure del pannello Nuovo lavoro / Lavoro in coda (Gate R48, R-REM-09…12).
 */

import type { RemoteLane, RemoteQuota, RemoteRoleOption } from '../../src/protocol.ts';
import { normalizeProviderId } from '#lib/components/models/providerLogos.ts';
import { formatHHMM } from './schedule.ts';
import { providerDisplayName } from './projectHelpers.ts';
import { t } from './i18n.ts';

/**
 * Principale occupata secondo le regole della coda di Studio
 * (`src/lib/lanes/queueDispatch.ts`): al lavoro, in background o in attesa di
 * una risposta. Un errore o una sessione chiusa la lasciano libera.
 */
export function isMainBusy(lanes: readonly RemoteLane[]): boolean {
	const main = lanes.find((lane) => lane.kind === 'main');
	if (!main) return false;
	const state = main.agent.state;
	return state === 'working' || state === 'background' || state === 'attention';
}

/** Dove partira' «Avvia ora», detto prima di toccarlo (R-REM-09). */
export function explainDestination(lanes: readonly RemoteLane[], newWorktree: boolean): string {
	if (newWorktree) return t('destNewLaneToggle');
	if (isMainBusy(lanes)) return t('destMainBusyNewLane');
	return t('destStartsInMain');
}

/** `provider/id` diviso nelle sue parti; senza `/` e' un id senza provider. */
export function splitSelector(selector: string | null | undefined): { provider: string | null; modelId: string | null } {
	if (!selector) return { provider: null, modelId: null };
	const slash = selector.indexOf('/');
	if (slash <= 0) return { provider: null, modelId: selector };
	return { provider: selector.slice(0, slash), modelId: selector.slice(slash + 1) };
}

/** Ruolo del catalogo, con il predefinito quando il lavoro non ne indica uno. */
export function findRole(roles: readonly RemoteRoleOption[] | undefined, roleId: string | null): RemoteRoleOption | null {
	return roles?.find((role) => role.id === (roleId ?? 'default')) ?? null;
}

/**
 * Reset stimato della quota del provider del lavoro, per la voce «Al reset
 * della quota»: la finestra piu' consumata fra quelle che dicono quando si azzerano.
 */
export function providerResetEstimate(
	quota: RemoteQuota | null | undefined,
	provider: string | null | undefined
): { provider: string; window: string; time: string } | null {
	if (!quota || !provider) return null;
	const target = normalizeProviderId(provider);
	const now = Date.now();
	let best: { label: string; resetsAt: number; used: number } | null = null;
	for (const entry of quota.providers) {
		if (normalizeProviderId(entry.provider) !== target) continue;
		for (const window of entry.windows) {
			if (!window.resetsAt || window.resetsAt <= now) continue;
			const used = window.usedFraction ?? 0;
			if (!best || used > best.used) best = { label: window.label, resetsAt: window.resetsAt, used };
		}
	}
	if (!best) return null;
	return { provider: providerDisplayName(provider), window: best.label.toLowerCase(), time: formatHHMM(best.resetsAt) };
}
