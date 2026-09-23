/**
 * Perche' un task in coda non puo' partire.
 *
 * Vive fuori dai componenti e dalle rune: la decisione e' aritmetica sui dati
 * di sessione, quindi resta verificabile dagli smoke test che girano con il
 * solo type-stripping di Node.
 *
 * Il contratto ha due meta'. La prima e' `ready`: l'unica risposta che la
 * coda usa per decidere. La seconda e' la spiegazione (`label`, `detail`,
 * `hint`): serve all'interfaccia per dire *cosa* blocca invece di limitarsi a
 * spegnere il pulsante. Prima di questo modulo il motivo era una stringa
 * libera confrontata con l'etichetta "Pronto": bastava tradurla per
 * trasformare un blocco in un via libera.
 *
 * Distinzione che regge tutto il resto: una domanda posta col tool `ask`
 * sospende davvero il processo omp (aspetta il frame di risposta su stdin),
 * mentre una domanda dedotta a fine turno dall'analisi semantica e' solo
 * conversazionale. La prima blocca la coda, la seconda la accompagna con una
 * nota. Confonderle significava non poter avviare nulla perche' il modello
 * aveva chiuso con "vuoi che faccia anche questo?".
 */

import { m } from '$lib/paraglide/messages.js';
import type { AgentState } from '$lib/stores/projects.svelte';

export type AutomationBlock =
	| 'ready'
	| 'busy'
	| 'no-session'
	| 'starting'
	| 'question'
	| 'quota'
	| 'working'
	| 'compacting'
	| 'terminal-input'
	| 'terminal-unknown';

export interface AutomationGate {
	/** Vero solo quando un task puo' partire adesso. */
	ready: boolean;
	/**
	 * L'auto-dispatch e' piu' prudente del click: aspetta la classificazione
	 * post-turno e non scavalca una domanda testuale dedotta.
	 */
	autoDispatchReady: boolean;
	block: AutomationBlock;
	/** Etichetta breve per chip e tooltip. */
	label: string;
	/** Cosa blocca, con la domanda reale della chat quando esiste. */
	detail: string;
	/** Cosa fare per sbloccare. Vuoto quando non c'e' nulla da fare. */
	hint: string;
	/** Il blocco si risolve rispondendo in chat. */
	needsAnswer: boolean;
	/** Domanda testuale dedotta: informativa, il click manuale resta possibile. */
	note: string | null;
}

/** Stato della sessione GUI che conta per l'avvio di un task. */
export interface GuiGateSnapshot {
	ready: boolean;
	attached: boolean;
	streaming: boolean;
	compacting: boolean;
	/** Domanda del tool `ask`: il processo omp e' sospeso in attesa. */
	blockingQuestion: string | null;
	/** Titolo del blocco di quota non ancora archiviato. */
	quotaBlock: string | null;
	/** Analisi post-turno ancora in corso. */
	inferencePending: boolean;
	/** Domanda dedotta a fine turno: il processo e' libero, ma puo' richiedere una risposta. */
	inferredQuestion: string | null;
}

export type AutomationGateInput =
	| { surface: 'gui'; busy: boolean; session: GuiGateSnapshot | null }
	| { surface: 'terminal'; busy: boolean; inputPending: boolean; agentState: AgentState };

function gate(
	block: AutomationBlock,
	label: string,
	detail: string,
	hint: string,
	options: { needsAnswer?: boolean; note?: string | null; pauseAutoDispatch?: boolean } = {}
): AutomationGate {
	return {
		ready: block === 'ready',
		autoDispatchReady: block === 'ready' && options.pauseAutoDispatch !== true,
		block,
		label,
		detail,
		hint,
		needsAnswer: options.needsAnswer === true,
		note: options.note ?? null
	};
}

/** Tronca la domanda: nel riquadro serve il senso, non il turno intero. */
function excerpt(text: string, max = 180): string {
	const compact = text.replace(/\s+/g, ' ').trim();
	if (compact.length <= max) return compact;
	return `${compact.slice(0, max - 1).trimEnd()}\u2026`;
}

/**
 * Il blocco dipende dall'agente della corsia, non dal task: `Principale` e'
 * viva ma occupata. In questo caso la coda non si ferma, si sposta (W09): il
 * click apre il prompt della nuova corsia invece della spiegazione del blocco.
 * Domande in attesa, quota e sessioni assenti restano blocchi da risolvere.
 */
export function isLaneRoutable(gate: AutomationGate): boolean {
	switch (gate.block) {
		case 'ready':
		case 'busy':
		case 'working':
		case 'starting':
		case 'compacting':
		case 'terminal-input':
			return true;
		default:
			return false;
	}
}

export function resolveAutomationGate(input: AutomationGateInput): AutomationGate {
	if (input.busy) {
		return gate(
			'busy',
			m.ui__page_operazione_in_corso_6690(),
			m.gate_detail_busy(),
			m.gate_hint_busy()
		);
	}

	if (input.surface === 'terminal') {
		if (input.inputPending) {
			return gate(
				'terminal-input',
				m.ui__page_completa_il_testo_nel_terminale_a985(),
				m.gate_detail_terminal_input(),
				m.gate_hint_terminal_input()
			);
		}
		if (input.agentState === 'working') {
			return gate('working', m.gate_label_working(), m.gate_detail_working(), m.gate_hint_working());
		}
		if (input.agentState === 'attention') {
			return gate(
				'question',
				m.ui__page_omp_aspetta_una_risposta_1202(),
				m.gate_detail_question_generic(),
				m.gate_hint_question(),
				{ needsAnswer: true }
			);
		}
		// `finished` e' un `idle` che l'utente non ha ancora visto (il lavoro e'
		// finito mentre guardava un altro progetto): la coda puo' ripartire.
		if (input.agentState !== 'idle' && input.agentState !== 'finished') {
			return gate(
				'terminal-unknown',
				m.ui__page_stato_omp_non_disponibile_194d(),
				m.gate_detail_unknown(),
				m.gate_hint_unknown()
			);
		}
		return gate('ready', m.page_agent_state_ready(), m.gate_detail_ready(), '');
	}

	const session = input.session;
	if (!session) {
		return gate(
			'no-session',
			m.gate_label_no_session(),
			m.gate_detail_no_session(),
			m.gate_hint_no_session()
		);
	}

	// La domanda viene prima dello streaming: quando `ask` e' aperto la
	// sessione risulta ancora in streaming, ma l'informazione utile e' la
	// domanda, non il turno in corso.
	if (session.blockingQuestion) {
		const question = excerpt(session.blockingQuestion);
		return gate(
			'question',
			m.ui__page_omp_aspetta_una_risposta_1202(),
			question ? m.gate_detail_question({ question }) : m.gate_detail_question_generic(),
			m.gate_hint_question(),
			{ needsAnswer: true }
		);
	}

	if (session.quotaBlock) {
		return gate(
			'quota',
			m.gate_label_quota(),
			m.gate_detail_quota({ reason: excerpt(session.quotaBlock) }),
			m.gate_hint_quota(),
			{ needsAnswer: true }
		);
	}

	if (!session.ready || !session.attached) {
		return gate(
			'starting',
			m.gate_label_starting(),
			m.gate_detail_starting(),
			m.gate_hint_starting()
		);
	}

	if (session.streaming) {
		return gate('working', m.gate_label_working(), m.gate_detail_working(), m.gate_hint_working());
	}

	if (session.compacting) {
		return gate(
			'compacting',
			m.ui__page_compattazione_in_corso_538c(),
			m.gate_detail_compacting(),
			m.gate_hint_compacting()
		);
	}

	const inferred = session.inferredQuestion?.trim();
	return gate('ready', m.page_agent_state_ready(), m.gate_detail_ready(), '', {
		note: inferred ? m.gate_note_inferred_question({ question: excerpt(inferred) }) : null,
		pauseAutoDispatch: session.inferencePending || Boolean(inferred)
	});
}
