// Valutazione dei gate di sicurezza per l'integrazione di una corsia (Gate R27 / PLAN W13).
//
// Invarianti:
// 1. L'integrazione e' disabilitata se il branch target presenta modifiche non salvate.
// 2. L'integrazione e' disabilitata se la corsia non e' un commit pulito.
// 3. L'integrazione e' disabilitata se il checkout principale non e' il target.
// 4. L'integrazione e' disabilitata se non si riesce a leggere i processi, o se ne restano di vivi.
// 5. L'integrazione e' disabilitata fuori da 'review_ready', salvo il ritento di cleanup in 'integrating'.
// 6. L'integrazione e' disabilitata se ci sono conflitti non risolti.
// 7. Se il target e' avanzato, si aggiorna la corsia: il pulsante resta spento finche' il drift non e' assorbito.
//    Durante 'integrating' il drift e' atteso (lo squash stesso sposta il target) e non blocca il cleanup.

import type { LaneStatus } from '$lib/types/lanes';

export interface IntegrationGateInput {
	laneStatus: LaneStatus;
	isTargetDirty: boolean;
	targetDirtyFilesCount: number;
	isLaneDirty: boolean;
	laneDirtyFilesCount: number;
	isTargetCheckedOut: boolean;
	liveProcessesCount: number;
	processCheckFailed: boolean;
	hasUnresolvedConflicts: boolean;
	driftAhead: number;
}

export interface IntegrationGateResult {
	canIntegrate: boolean;
	reasons: string[];
	needsUpdateFromTarget: boolean;
}

export function evaluateIntegrationGate(
	input: IntegrationGateInput,
	messages: {
		targetDirty: (count: number) => string;
		laneDirty: (count: number) => string;
		checkoutMismatch: () => string;
		liveProcesses: (count: number) => string;
		processCheckFailed: () => string;
		notReady: (status: LaneStatus) => string;
		conflicts: () => string;
		targetAdvanced: () => string;
	}
): IntegrationGateResult {
	const reasons: string[] = [];
	const reconciling = input.laneStatus === 'integrating';

	if (input.isTargetDirty) {
		reasons.push(messages.targetDirty(input.targetDirtyFilesCount));
	}

	if (input.isLaneDirty) {
		reasons.push(messages.laneDirty(input.laneDirtyFilesCount));
	}

	if (!input.isTargetCheckedOut) {
		reasons.push(messages.checkoutMismatch());
	}

	if (input.processCheckFailed) {
		reasons.push(messages.processCheckFailed());
	} else if (input.liveProcessesCount > 0) {
		reasons.push(messages.liveProcesses(input.liveProcessesCount));
	}

	if (input.laneStatus !== 'review_ready' && !reconciling) {
		reasons.push(messages.notReady(input.laneStatus));
	}

	if (input.hasUnresolvedConflicts || input.laneStatus === 'conflict') {
		reasons.push(messages.conflicts());
	}

	if (input.driftAhead > 0 && !reconciling) {
		reasons.push(messages.targetAdvanced());
	}

	return {
		canIntegrate: reasons.length === 0,
		reasons,
		needsUpdateFromTarget: input.driftAhead > 0 && !reconciling
	};
}
