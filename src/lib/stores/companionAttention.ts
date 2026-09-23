/**
 * Logica di convergenza delle richieste di attenzione del Companion.
 *
 * Vive fuori da `companion.svelte.ts` perche' deve restare priva di rune: le
 * decisioni di scrittura sono pura aritmetica sui dati e vanno verificabili
 * dagli smoke test, che girano con il solo type-stripping di Node.
 *
 * Il contratto e' uno solo: `upsert` e `remove` restituiscono `null` quando
 * l'elenco e' gia' nello stato richiesto. Chi scrive nello store si ferma su
 * `null` e non tocca `$state`.
 *
 * Non e' un'ottimizzazione. Le due funzioni vengono chiamate da un `$effect`
 * che rilegge l'elenco: riassegnare un array nuovo a ogni passata
 * invaliderebbe la dipendenza appena letta e l'effetto si richiamerebbe da
 * solo fino a `effect_update_depth_exceeded`, cioe' una superficie che non
 * finisce mai di caricare.
 */

import type { AttentionRequest, PendingUiPayload, RecentChatMessage } from './companion.svelte';
import type { BlockedQuotaState } from '../agent/quotaRecovery';

/**
 * Uguaglianza strutturale su valori serializzabili in JSON.
 *
 * `PendingUiPayload.questions` e' dichiarato `unknown[]`: arriva dal runtime e
 * non ha una forma nota a compile time, quindi l'unico confronto onesto e'
 * ricorsivo. Nessuna serializzazione intermedia: `JSON.stringify` allocherebbe
 * due stringhe per ogni passata dell'effetto.
 */
function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return false;
	if (typeof a !== 'object') return false;

	const aArray = Array.isArray(a);
	if (aArray !== Array.isArray(b)) return false;

	if (aArray) {
		const left = a as unknown[];
		const right = b as unknown[];
		if (left.length !== right.length) return false;
		for (let i = 0; i < left.length; i++) {
			if (!jsonEqual(left[i], right[i])) return false;
		}
		return true;
	}

	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	// Chiave assente e chiave con valore `undefined` descrivono lo stesso
	// stato: l'eco IPC passa da JSON, che scarta le seconde (le domande di
	// `ask` ne hanno diverse: `header`, `recommended`, `description`).
	// Confrontare il numero di chiavi rendeva diverso un payload identico, e
	// l'effetto che lo produce riscriveva e ritrasmetteva senza fine.
	for (const key of Object.keys(left)) {
		if (!jsonEqual(left[key], right[key])) return false;
	}
	for (const key of Object.keys(right)) {
		if (!(key in left) && right[key] !== undefined) return false;
	}
	return true;
}

function sameRecentMessages(a: RecentChatMessage[], b: RecentChatMessage[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const left = a[i];
		const right = b[i];
		if (left.role !== right.role || left.text !== right.text || left.timestamp !== right.timestamp) {
			return false;
		}
	}
	return true;
}

/**
 * Vero quando le due richieste descrivono lo stesso stato di attesa.
 *
 * Il chiamante ricostruisce `recentMessages` e `pendingUi` a ogni passata
 * dell'effetto, quindi l'identita' di riferimento non dice nulla: serve il
 * confronto sui contenuti.
 */
export function sameAttentionRequest(a: AttentionRequest, b: AttentionRequest): boolean {
	const left = a.pendingUi;
	const right = b.pendingUi;
	return (
		a.projectId === b.projectId &&
		(a.laneId ?? 'main').toLowerCase() === (b.laneId ?? 'main').toLowerCase() &&
		a.projectName === b.projectName &&
		a.projectHue === b.projectHue &&
		a.modelName === b.modelName &&
		left.kind === right.kind &&
		left.requestId === right.requestId &&
		(left.laneId ?? 'main').toLowerCase() === (right.laneId ?? 'main').toLowerCase() &&
		left.title === right.title &&
		left.message === right.message &&
		left.method === right.method &&
		left.placeholder === right.placeholder &&
		left.prefill === right.prefill &&
		left.questionIndex === right.questionIndex &&
		left.totalQuestions === right.totalQuestions &&
		jsonEqual(left.options, right.options) &&
		jsonEqual(left.optionDetails, right.optionDetails) &&
		jsonEqual(left.questions, right.questions) &&
		sameRecentMessages(a.recentMessages, b.recentMessages) &&
		jsonEqual(left.blockedQuota, right.blockedQuota)
	);
}

/**
 * Traduce una sessione con domanda aperta nella richiesta che la companion
 * mostra. Restituisce `null` quando non c'e' nulla da chiedere all'utente.
 *
 * L'unica condizione e' la presenza della richiesta interattiva. In
 * particolare **non** si pretende `message`: nel protocollo la domanda sta in
 * `title` e `message` e' un dettaglio facoltativo, quindi filtrare su
 * `message` faceva sparire la quasi totalita' delle domande dalla companion,
 * che restava con il solo stato "chiede risposta" e nessun modo di
 * rispondere.
 */
export function buildAttentionRequest(
	project: { id: string; name: string; hue: number },
	session: {
		laneId?: string | null;
		laneTitle?: string | null;
		pendingUi?: PendingUiPayload | null;
		blockedQuotaState?: BlockedQuotaState | null;
		inferredAttention?: { question: string; suggestions: string[] } | null;
		model?: { id?: string; name?: string } | null;
		recentMessages: RecentChatMessage[];
	}
): AttentionRequest | null {
	const laneId = session.laneId ?? 'main';
	const laneTitle = session.laneTitle ?? (laneId !== 'main' ? laneId : 'Principale');
	const pendingUi = session.pendingUi;
	if (pendingUi && pendingUi.kind === 'ask') {
		return {
			projectId: project.id,
			laneId,
			laneTitle,
			projectName: project.name,
			projectHue: project.hue,
			modelName: session.model ? session.model.name || session.model.id : undefined,
			recentMessages: session.recentMessages,
			pendingUi: {
				...pendingUi,
				laneId: pendingUi.laneId ?? laneId
			}
		};
	}

	const bq = session.blockedQuotaState;
	if (bq && !bq.dismissed) {
		const suggested = bq.suggestedModel
			? {
					selector: bq.suggestedModel.selector,
					modelName: bq.suggestedModel.modelName,
					roleLabel: bq.suggestedModel.roleLabel,
					provider: bq.suggestedModel.provider,
					modelId: bq.suggestedModel.modelId
				}
			: null;

		const available = (bq.availableRecoveryModels || []).map((m) => ({
			selector: m.selector,
			modelName: m.modelName,
			roleLabel: m.roleLabel,
			provider: m.provider,
			modelId: m.modelId
		}));

		const recoveryUi: PendingUiPayload = {
			kind: 'quota_blocked',
			requestId: bq.id,
			laneId,
			title: bq.title,
			message: bq.message,
			method: 'select',
			options: available.map((m) => m.selector),
			blockedQuota: {
				reasonKind: bq.reasonKind,
				rawError: bq.rawError,
				failedProvider: bq.failedProvider,
				failedModelId: bq.failedModelId,
				failedSelector: bq.failedSelector,
				suggestedModel: suggested,
				availableRecoveryModels: available
			}
		};

		return {
			projectId: project.id,
			laneId,
			laneTitle,
			projectName: project.name,
			projectHue: project.hue,
			modelName: session.model ? session.model.name || session.model.id : undefined,
			recentMessages: session.recentMessages,
			pendingUi: recoveryUi
		};
	}

	const inf = session.inferredAttention;
	if (inf && inf.question) {
		const inferredUi: PendingUiPayload = {
			kind: 'inferred_input',
			requestId: `inferred-${project.id}-${laneId}`,
			laneId,
			title: inf.question,
			method: 'select',
			options: inf.suggestions && inf.suggestions.length > 0 ? inf.suggestions : ['Procedi pure']
		};

		return {
			projectId: project.id,
			laneId,
			laneTitle,
			projectName: project.name,
			projectHue: project.hue,
			modelName: session.model ? session.model.name || session.model.id : undefined,
			recentMessages: session.recentMessages,
			pendingUi: inferredUi
		};
	}
	return null;
}

/**
 * Inserisce o aggiorna la richiesta del progetto.
 *
 * Restituisce `null` quando l'elenco contiene gia' esattamente questa
 * richiesta: nessuna scrittura, nessun broadcast IPC.
 */
export function upsertAttentionRequest(
	list: readonly AttentionRequest[],
	request: AttentionRequest
): AttentionRequest[] | null {
	const targetLane = (request.laneId ?? 'main').toLowerCase();
	const index = list.findIndex(
		(entry) =>
			entry.projectId.toLowerCase() === request.projectId.toLowerCase() &&
			(entry.laneId ?? 'main').toLowerCase() === targetLane
	);
	if (index >= 0) {
		if (sameAttentionRequest(list[index], request)) return null;
		const next = list.slice();
		next[index] = request;
		return next;
	}
	return [...list, request];
}

/**
 * Rimuove la richiesta del progetto (facoltativamente ristretta a una specifica corsia).
 *
 * Restituisce `null` quando non c'era nulla da rimuovere: e' il caso normale a
 * ogni avvio, quando nessun progetto ha una domanda pendente, ed e' proprio
 * quello che non deve produrre scritture.
 */
export function removeAttentionRequest(
	list: readonly AttentionRequest[],
	projectId: string,
	laneId?: string | null
): AttentionRequest[] | null {
	const pKey = projectId.toLowerCase();
	if (laneId !== undefined && laneId !== null) {
		const lKey = laneId.toLowerCase();
		if (
			!list.some(
				(entry) =>
					entry.projectId.toLowerCase() === pKey &&
					(entry.laneId ?? 'main').toLowerCase() === lKey
			)
		) {
			return null;
		}
		return list.filter(
			(entry) =>
				!(
					entry.projectId.toLowerCase() === pKey &&
					(entry.laneId ?? 'main').toLowerCase() === lKey
				)
		);
	}
	if (!list.some((entry) => entry.projectId.toLowerCase() === pKey)) return null;
	return list.filter((entry) => entry.projectId.toLowerCase() !== pKey);
}

