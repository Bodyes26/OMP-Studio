/**
 * Ruoli del setup: tipi del contratto, testi dei codici, salvataggio (SET-012,
 * SET-042).
 *
 * La proposta arriva già risolta dal backend (`setup_propose_roles`), che è
 * deterministico e non chiama nessun modello: qui non si indovina niente, si
 * sceglie solo come scriverla. Il salvataggio è la parte delicata:
 * - si scrive un ruolo solo se l'utente l'ha cambiato o se il ruolo è vuoto;
 * - `commit` è una copia della selezione finale di `smol`, e solo se `commit`
 *   non era già configurato;
 * - `slow`, `advisor`, `tiny`, `judge` e le catene di fallback non si toccano.
 * Il motivo è che il setup non è l'editor dei ruoli: chi ha già una
 * configurazione pensata non deve vedersela riscritta per un «Continua».
 */
import { invoke } from '@tauri-apps/api/core';
import { m } from '#lib/paraglide/messages.js';
import { modelSettingsStore } from '#lib/stores/modelSettings.svelte.ts';
import { splitModelSelector } from '#lib/stores/modelSettingsHelpers.ts';
import { familyLabel } from './familyLabels.ts';
import { providerLabel } from './setupProviders.ts';

export type RoleId = 'default' | 'plan' | 'smol' | 'vision' | 'task' | 'commit';

/** Le card del passo: `commit` è nascosto, è una copia di `smol`. */
export const CARD_ROLES: RoleId[] = ['default', 'plan', 'smol', 'vision', 'task'];

export type ReasonCode =
	| 'CURATED_QUALITY'
	| 'CURATED_PLAN'
	| 'CURATED_BALANCED'
	| 'CURATED_SMALL'
	| 'VISION_SUPPORTED'
	| 'LATEST_COMPATIBLE_VERSION'
	| 'EXPLICIT_ALIAS_SELECTED'
	| 'SUBSCRIPTION_PREFERRED'
	| 'FAMILY_ASSIGNMENT_FALLBACK'
	| 'PLAN_HIGH_THINKING'
	| 'PLAN_DEFAULT_THINKING'
	| 'HEURISTIC_SELECTION'
	| 'HEURISTIC_LOWEST_KNOWN_COST'
	| 'LOCAL_PERFORMANCE_UNKNOWN'
	| 'CURRENT_SELECTION_PRESERVED'
	| 'RECOMMENDATION_AVAILABLE'
	| 'USER_SELECTION'
	| 'CURRENT_MODEL_NOT_IN_CATALOG'
	| 'NO_ELIGIBLE_MODEL'
	| 'NO_VISION_MODEL'
	| 'PRICING_UNKNOWN'
	| 'CATALOG_METADATA_CONFLICT';

export type NoteCode =
	| 'SUBSCRIPTION_PREFERRED'
	| 'PLAN_HIGH_THINKING'
	| 'LOCAL_PERFORMANCE_UNKNOWN'
	| 'CURRENT_MODEL_NOT_IN_CATALOG'
	| 'PRICING_UNKNOWN'
	| 'CATALOG_METADATA_CONFLICT';

export interface RoleProposal {
	role: RoleId;
	/** `provider/modelId` concreto dal catalogo; `null` = nessun candidato. */
	selector: string | null;
	/** Solo `plan`: livello «alto» supportato, altrimenti `null`. */
	thinking: string | null;
	provider: string | null;
	modelName: string | null;
	familyId: string | null;
	reason: ReasonCode;
	notes: NoteCode[];
	/** Valori per i segnaposto del testo: family, provider, model, level. */
	params: Record<string, string>;
	confidence: 'curated' | 'heuristic' | 'none';
	/** Valore attuale in `modelRoles`, con eventuale `:thinking`. */
	current: string | null;
	currentInCatalog: boolean;
}

export interface RoleProposalResponse {
	roles: RoleProposal[];
}

export const EMPTY_PROPOSAL: RoleProposalResponse = { roles: [] };

/** Picks dell'utente: `selector[:thinking]`, come li scrive `setRoleModel`. */
export type RolePicks = Partial<Record<RoleId, string>>;

/**
 * Testo della motivazione principale. I segnaposto arrivano da `params`, ma
 * `family` e `provider` si leggono dal codice prima: il backend manda l'id
 * grezzo (`anthropic.opus`) e la frase deve dire «Opus più recente».
 */
export function reasonText(proposal: RoleProposal): string {
	const family = familyLabel(proposal.familyId ?? proposal.params.family ?? null);
	const provider = providerLabel(proposal.provider ?? proposal.params.provider ?? null);
	const model = proposal.modelName ?? proposal.params.model ?? '';
	const level = proposal.params.level ?? proposal.thinking ?? '';
	switch (proposal.reason) {
		case 'CURATED_QUALITY':
			return m.setup2_roles_reason_curated_quality({ family });
		case 'CURATED_PLAN':
			return m.setup2_roles_reason_curated_plan({ family });
		case 'CURATED_BALANCED':
			return m.setup2_roles_reason_curated_balanced({ family });
		case 'CURATED_SMALL':
			return m.setup2_roles_reason_curated_small({ family });
		case 'VISION_SUPPORTED':
			return m.setup2_roles_reason_vision_supported();
		case 'LATEST_COMPATIBLE_VERSION':
			return m.setup2_roles_reason_latest_compatible();
		case 'EXPLICIT_ALIAS_SELECTED':
			return m.setup2_roles_reason_explicit_alias();
		case 'SUBSCRIPTION_PREFERRED':
			return m.setup2_roles_reason_subscription({ provider });
		case 'FAMILY_ASSIGNMENT_FALLBACK':
			return m.setup2_roles_reason_family_fallback({ family });
		case 'PLAN_HIGH_THINKING':
			return m.setup2_roles_reason_plan_high_thinking({ level });
		case 'PLAN_DEFAULT_THINKING':
			return m.setup2_roles_reason_plan_default_thinking();
		case 'HEURISTIC_SELECTION':
			return m.setup2_roles_reason_heuristic();
		case 'HEURISTIC_LOWEST_KNOWN_COST':
			return m.setup2_roles_reason_lowest_cost();
		case 'LOCAL_PERFORMANCE_UNKNOWN':
			return m.setup2_roles_reason_local_unknown();
		case 'CURRENT_SELECTION_PRESERVED':
			return m.setup2_roles_reason_current_preserved();
		case 'RECOMMENDATION_AVAILABLE':
			return m.setup2_roles_reason_recommendation({ model });
		case 'USER_SELECTION':
			return m.setup2_roles_reason_user_selection();
		case 'CURRENT_MODEL_NOT_IN_CATALOG':
			return m.setup2_roles_reason_current_not_in_catalog();
		case 'NO_ELIGIBLE_MODEL':
			return m.setup2_roles_reason_no_eligible();
		case 'NO_VISION_MODEL':
			return m.setup2_roles_reason_no_vision();
		case 'PRICING_UNKNOWN':
			return m.setup2_roles_reason_pricing_unknown();
		case 'CATALOG_METADATA_CONFLICT':
			return m.setup2_roles_reason_metadata_conflict();
		default:
			return '';
	}
}

/** Testo di una nota secondaria: sta nel tooltip, non nella riga. */
export function noteText(note: NoteCode, proposal: RoleProposal): string {
	const provider = providerLabel(proposal.provider ?? proposal.params.provider ?? null);
	const level = proposal.params.level ?? proposal.thinking ?? '';
	switch (note) {
		case 'SUBSCRIPTION_PREFERRED':
			return m.setup2_roles_note_subscription({ provider });
		case 'PLAN_HIGH_THINKING':
			return m.setup2_roles_note_plan_high_thinking({ level });
		case 'LOCAL_PERFORMANCE_UNKNOWN':
			return m.setup2_roles_note_local_unknown();
		case 'CURRENT_MODEL_NOT_IN_CATALOG':
			return m.setup2_roles_note_current_not_in_catalog();
		case 'PRICING_UNKNOWN':
			return m.setup2_roles_note_pricing_unknown();
		case 'CATALOG_METADATA_CONFLICT':
			return m.setup2_roles_note_metadata_conflict();
		default:
			return '';
	}
}

/**
 * Scrive i ruoli scelti in `draftConfig` e salva.
 *
 * Regola (contratto `local://setup-impl.md`): per `default`, `plan`, `smol`,
 * `vision`, `task` si scrive il selettore scelto — pick dell'utente, altrimenti
 * il valore attuale, altrimenti la proposta — ma solo se il ruolo è vuoto o
 * l'utente l'ha cambiato. `commit` copia la selezione finale di `smol` solo se
 * era vuoto. Nessun fallback viene scritto.
 */
export async function saveRoles(
	picks: RolePicks,
	proposal?: RoleProposalResponse | null
): Promise<boolean> {
	await modelSettingsStore.ensureLoaded();
	if (!modelSettingsStore.draftConfig) return false;

	// Il guscio monta `<RolesStep bind:picks />` e non vede la proposta: se non
	// la passa, si richiede qui. Il comando è deterministico e locale, quindi
	// ripeterlo non costa niente e non cambia idea fra il passo e il salvataggio.
	const resolved =
		proposal ?? (await invoke<RoleProposalResponse>('setup_propose_roles').catch(() => EMPTY_PROPOSAL));
	const byRole = new Map(resolved.roles.map((entry) => [entry.role, entry]));
	/** Selezione finale per ruolo: quello che «Continua» considererà confermato. */
	const finalSelection = new Map<RoleId, string>();

	for (const role of CARD_ROLES) {
		const picked = picks[role];
		const entry = byRole.get(role);
		const current = entry?.current ?? modelSettingsStore.draftConfig.modelRoles[role] ?? null;
		const chosen = picked ?? (current ? current : entry?.selector ?? null);
		if (!chosen) continue;
		finalSelection.set(role, chosen);

		// Il setup propone, non riscrive una scelta precedente.
		const changed = picked !== undefined && picked !== current;
		// Un ruolo già configurato e non toccato resta com'è.
		if (!changed && modelSettingsStore.draftConfig.modelRoles[role]) continue;

		const { base, thinking } = splitModelSelector(chosen, modelSettingsStore.knownSelectors);
		// `plan` porta il thinking della proposta (livello alto supportato); per
		// gli altri il thinking non si aggiunge, perché la proposta non lo prevede.
		// Il thinking della proposta vale solo quando si scrive la proposta: una
		// scelta dell'utente porta il proprio (o nessuno), e imporre il livello
		// pensato per un altro modello darebbe un valore non supportato.
		const thinkingFromProposal =
			role === 'plan' && picked === undefined ? (entry?.thinking ?? null) : null;
		modelSettingsStore.setRoleModel(role, base, thinking ?? thinkingFromProposal ?? undefined);
	}

	// `commit` senza modello: prende la selezione finale di `smol`. Con un valore
	// già presente resta quello, che è la scelta di chi ha configurato prima.
	const smolFinal = finalSelection.get('smol') ?? null;
	if (smolFinal && !modelSettingsStore.draftConfig.modelRoles['commit']) {
		const { base, thinking } = splitModelSelector(smolFinal, modelSettingsStore.knownSelectors);
		modelSettingsStore.setRoleModel('commit', base, thinking ?? undefined);
	}

	return modelSettingsStore.saveConfig();
}

/** La selezione che la card mostra: pick utente, poi attuale, poi proposta. */
export function effectiveSelector(
	role: RoleId,
	picks: RolePicks,
	proposal: RoleProposal | null
): string | null {
	return picks[role] ?? proposal?.current ?? proposal?.selector ?? null;
}
