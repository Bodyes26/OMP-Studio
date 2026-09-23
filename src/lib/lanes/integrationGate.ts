// Valutazione dei gate di sicurezza per l'integrazione di una corsia.
//
// Invarianti:
// 1. L'integrazione e' disabilitata se il checkout principale non e' il target.
// 2. L'integrazione e' disabilitata se ci sono conflitti Git non risolti o lo stato e' 'conflict'.
// 3. L'integrazione e' disabilitata se la corsia e' archiviata o in fase di integrazione.
// 4. L'integrazione e' disabilitata se non si riesce a verificare i processi della corsia.
//
// La pipeline Rust gestisce autonomamente corsia sporca, target avanzato,
// target sporco e processi dell'agente chiamante.

import type { LaneStatus } from '$lib/types/lanes';

export interface IntegrationGateInput {
	laneStatus: LaneStatus;
	isTargetCheckedOut: boolean;
	processCheckFailed: boolean;
	hasUnresolvedConflicts: boolean;
	// Campi opzionali gestiti dalla pipeline Rust, non bloccano il gate:
	isLaneDirty?: boolean;
	laneDirtyFilesCount?: number;
	isTargetDirty?: boolean;
	targetDirtyFilesCount?: number;
	driftAhead?: number;
	liveProcessesCount?: number;
}

export interface IntegrationGateResult {
	canIntegrate: boolean;
	reasons: string[];
}

export function evaluateIntegrationGate(
	input: IntegrationGateInput,
	messages: {
		checkoutMismatch: () => string;
		processCheckFailed: () => string;
		notReady: (status: LaneStatus) => string;
		conflicts: () => string;
	}
): IntegrationGateResult {
	const reasons: string[] = [];

	if (!input.isTargetCheckedOut) {
		reasons.push(messages.checkoutMismatch());
	}

	if (input.processCheckFailed) {
		reasons.push(messages.processCheckFailed());
	}

	if (input.laneStatus === 'archived' || input.laneStatus === 'integrating') {
		reasons.push(messages.notReady(input.laneStatus));
	}

	if (input.hasUnresolvedConflicts || input.laneStatus === 'conflict') {
		reasons.push(messages.conflicts());
	}

	return {
		canIntegrate: reasons.length === 0,
		reasons
	};
}
