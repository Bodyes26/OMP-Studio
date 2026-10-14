import type { RemoteAskQuestion, RemoteAnswer } from '../../src/protocol.ts';

export interface QuestionAnswerState {
	selectedOptions: string[];
	customInput?: string;
}

/**
 * Inizializza lo stato delle risposte per ciascuna domanda.
 * Se una domanda specifica una scelta raccomandata (`recommended`),
 * viene preselezionata automaticamente mantenendo l'opzione intatta finche' l'utente non la cambia.
 */
export function initializeAskState(questions: RemoteAskQuestion[]): Record<string, QuestionAnswerState> {
	const state: Record<string, QuestionAnswerState> = {};
	for (const q of questions) {
		const preselected: string[] = [];
		if (q.recommended != null && q.options[q.recommended]) {
			preselected.push(q.options[q.recommended].label);
		}
		state[q.id] = {
			selectedOptions: preselected,
			customInput: ''
		};
	}
	return state;
}

/**
 * Aggiorna la selezione di un'opzione in base al tipo di domanda (singola o multipla).
 */
export function toggleOptionSelection(currentOptions: string[], optionLabel: string, multi: boolean): string[] {
	if (!multi) {
		return [optionLabel];
	}
	const exists = currentOptions.includes(optionLabel);
	if (exists) {
		return currentOptions.filter((opt) => opt !== optionLabel);
	}
	return [...currentOptions, optionLabel];
}

/**
 * Costruisce il frame canonico RemoteAnswer di tipo 'ask' da inviare al relay.
 * Include l'eventuale testo libero `customInput` solo se non vuoto.
 */
export function buildAskAnswer(
	questions: RemoteAskQuestion[],
	state: Record<string, QuestionAnswerState>
): RemoteAnswer {
	const answers = questions.map((q) => {
		const s = state[q.id] || { selectedOptions: [] };
		const trimmedCustom = s.customInput?.trim();
		const entry: { id: string; selectedOptions: string[]; customInput?: string } = {
			id: q.id,
			selectedOptions: [...s.selectedOptions]
		};
		if (trimmedCustom) {
			entry.customInput = trimmedCustom;
		}
		return entry;
	});

	return {
		action: 'ask',
		answers
	};
}
