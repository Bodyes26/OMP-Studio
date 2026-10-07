/**
 * Formattazione e validazione delle risposte del tool `ask` (nativo via `set_ask_dialog`).
 *
 * Vive fuori dal componente per due ragioni:
 * 1. e' la logica che decide **cosa arriva all'agente**, quindi va verificata
 *    dai test sul codice di produzione, non su una copia;
 * 2. una risposta inventata (per esempio la prima opzione, quando l'utente non
 *    ha scelto niente) e' indistinguibile da una decisione dell'utente: qui
 *    non esiste nessun ripiego silenzioso.
 */

import { m as msg } from '$lib/paraglide/messages.js';
import type { AskDialogAnswer } from './wire';

/**
 * Domanda come l'ha dichiarata l'agente negli argomenti del tool `ask`. Vive
 * qui e non nella sessione perche' i test devono poterla usare senza istanziare una sessione.
 */
export interface AskQuestionOption {
	label: string;
	description?: string;
	preview?: string;
}

export interface AskQuestion {
	id: string;
	question: string;
	header?: string;
	options: AskQuestionOption[];
	multi?: boolean;
	recommended?: number;
}

export interface AnswerableOption {
	/** Etichetta come l'ha mandata l'agente: e' quella che si rimanda. */
	label: string;
	/** Etichetta senza il suffisso ` (Recommended)`: e' la chiave di selezione. */
	cleanLabel: string;
	isOther: boolean;
	isDoneSentinel?: boolean;
}

export interface AnswerableQuestion {
	id: string;
	options: AnswerableOption[];
	multi: boolean;
	/** Chiavi `cleanLabel` selezionate. */
	selectedOptions: Set<string>;
	note: string;
	customInput: string;
	/** Vero quando l'utente chiede all'agente di decidere ("Decidi tu"). */
	decideForMe: boolean;
	isCustom: boolean;
	/** Vero appena l'utente interviene sulla domanda: selezione, testo, nota. */
	touched: boolean;
	/**
	 * Vero quando la domanda e' stata davvero mostrata all'utente. La
	 * pre-selezione dell'opzione consigliata e' un **valore predefinito**, non
	 * una risposta: senza questa distinzione ogni domanda con `recommended`
	 * risultava completata prima di essere letta, il riepilogo dichiarava
	 * tutto pronto e l'invio spediva all'agente scelte che l'utente non aveva
	 * mai visto.
	 */
	visited: boolean;
}

const RECOMMENDED_SUFFIX = ' (Recommended)';

export function cleanOptionLabel(label: string): string {
	return label.endsWith(RECOMMENDED_SUFFIX)
		? label.slice(0, -RECOMMENDED_SUFFIX.length)
		: label;
}

export function isOtherOption(label: string): boolean {
	const lower = label.toLowerCase();
	return (
		lower === 'other (type your own)' ||
		lower.startsWith('other (') ||
		lower === 'other' ||
		lower === 'altro (scrivi la tua risposta)' ||
		lower === 'altro'
	);
}

export function isDoneOption(label: string): boolean {
	const lower = label.toLowerCase();
	return (
		lower.includes('done selecting') || lower.includes('fine selezione') || label.startsWith('✔')
	);
}

/**
 * Vero solo quando la risposta esiste davvero:
 * - "Altro" richiede del testo, non basta averlo scelto;
 * - una domanda mai mostrata non ha risposta, nemmeno quando l'opzione
 *   consigliata e' gia' selezionata: quella e' la proposta del codice, e
 *   spedirla come scelta dell'utente e' esattamente l'errore che il wizard
 *   deve impedire;
 * - a scelta singola, sulla domanda vista, basta un'opzione selezionata
 *   (anche la consigliata, che l'utente vede evidenziata prima di confermare);
 * - a scelta multipla l'insieme vuoto e' una risposta valida ("nessuna"), ma
 *   solo se l'utente ha davvero toccato la domanda.
 */
export function isQuestionAnswered(question: AnswerableQuestion): boolean {
	// "Decidi tu" e' una risposta esplicita dell'utente, valida anche a
	// scelta multipla: delega la scelta all'agente e chiude la domanda.
	if (question.decideForMe) return true;
	if (question.isCustom) return question.customInput.trim().length > 0;
	if (!question.visited) return false;
	if (question.selectedOptions.size > 0) return true;
	return question.multi && question.touched;
}

/** Indice della prima domanda senza risposta, `-1` quando sono tutte pronte. */
export function firstUnansweredIndex(questions: AnswerableQuestion[]): number {
	return questions.findIndex((question) => !isQuestionAnswered(question));
}

export const OTHER_LABEL = 'Other (type your own)';

/**
 * Testo convenzionale con cui "Decidi tu" viaggia sul filo: la risposta
 * libera deve essere distinguibile da una scelta tra le opzioni. Va al
 * modello, quindi segue la lingua dell'interfaccia come il resto dei
 * messaggi dell'utente.
 */
export function decideForMeText(): string {
	return msg.chat_v2_ask_decide_for_me_wire();
}

/** Riconosce il testo in entrambe le lingue: lo storico puo' venire da una sessione nell'altra lingua. */
export function isDecideForMeText(text: string): boolean {
	return (['it', 'en'] as const).some((locale) => text === msg.chat_v2_ask_decide_for_me_wire({}, { locale }));
}

/**
 * Risposta dell'utente o del wizard a una richiesta interattiva.
 * Accetta sia il formato ad azione esplicita (`action`) sia i payload normali
 * `{ value }`, `{ confirmed }`, `{ cancelled }`, `{ answers }`.
 */
export type PromptAnswer =
	| { action: 'select'; value: string }
	| { action: 'confirm'; confirmed: boolean }
	| { action: 'input' | 'editor'; value: string }
	| { action: 'wizard' | 'ask'; answers: AskDialogAnswer[]; value?: string }
	| { action: 'cancel' }
	| {
			action: 'select' | 'confirm' | 'input' | 'editor' | 'wizard' | 'ask' | 'cancel';
			value?: string;
			confirmed?: boolean;
			answers?: AskDialogAnswer[];
	  }
	| { value: string }
	| { confirmed: boolean }
	| { cancelled: true }
	| { answers: AskDialogAnswer[] };

export interface NormalizedPromptAnswer {
	action: 'select' | 'confirm' | 'input' | 'editor' | 'wizard' | 'ask' | 'cancel';
	value?: string;
	confirmed?: boolean;
	answers?: AskDialogAnswer[];
}

/**
 * Normalizza qualsiasi variante di risposta nel contratto canonico.
 */
export function normalizePromptAnswer(answer: PromptAnswer): NormalizedPromptAnswer {
	if ('action' in answer) {
		return answer;
	}
	if ('cancelled' in answer && answer.cancelled) {
		return { action: 'cancel' };
	}
	if ('confirmed' in answer && typeof answer.confirmed === 'boolean') {
		return { action: 'confirm', confirmed: answer.confirmed };
	}
	if ('answers' in answer && Array.isArray(answer.answers)) {
		return { action: 'wizard', answers: answer.answers };
	}
	if ('value' in answer && typeof answer.value === 'string') {
		return { action: 'select', value: answer.value };
	}
	return { action: 'cancel' };
}

/** Etichetta originale dell'opzione scelta, o la chiave se non si ritrova. */
export function originalLabel(question: AnswerableQuestion, key: string): string {
	return question.options.find((option) => option.cleanLabel === key || option.label === key)?.label ?? key;
}

/**
 * Costruisce le risposte nel formato nativo `AskDialogAnswer` di omp 18.8.
 * Restituisce `null` se manca almeno una risposta, così il chiamante non
 * può inviare risposte parziali.
 */
export function buildAskDialogAnswers(questions: AnswerableQuestion[]): AskDialogAnswer[] | null {
	if (questions.length === 0 || firstUnansweredIndex(questions) !== -1) return null;

	return questions.map((question) => {
		const note = question.note.trim();

		// "Decidi tu": invia il testo convenzionale in customInput e nessuna opzione selezionata
		if (question.decideForMe) {
			const decide = decideForMeText();
			const custom = note ? `${decide} (nota: ${note})` : decide;
			return {
				id: question.id,
				selectedOptions: [],
				customInput: custom
			};
		}

		// Opzione personalizzata ("Altro...")
		if (question.isCustom) {
			const customVal = question.customInput.trim();
			const custom = note ? `${customVal} (nota: ${note})` : (customVal || undefined);
			return {
				id: question.id,
				selectedOptions: [],
				customInput: custom
			};
		}

		if (question.multi) {
			const selected = Array.from(question.selectedOptions).map((key) =>
				originalLabel(question, key)
			);
			const custom = note ? `nota: ${note}` : undefined;
			return {
				id: question.id,
				selectedOptions: selected,
				customInput: custom
			};
		}

		// Scelta singola:
		const selectedKeys = Array.from(question.selectedOptions);
		if (selectedKeys.length === 0) {
			const custom = note ? `nota: ${note}` : undefined;
			return {
				id: question.id,
				selectedOptions: [],
				customInput: custom
			};
		}

		const label = originalLabel(question, selectedKeys[0]);
		if (note) {
			// Per omp 18.8, una risposta a scelta singola non può avere contemporaneamente
			// selectedOptions non vuoto e customInput non nullo (parseAskDialogResponse solleverebbe errore).
			// Se l'utente ha inserito una nota, uniamo l'etichetta e la nota in customInput.
			return {
				id: question.id,
				selectedOptions: [],
				customInput: `${label} (nota: ${note})`
			};
		}

		return {
			id: question.id,
			selectedOptions: [label],
			customInput: undefined
		};
	});
}

/**
 * Domande dichiarate negli argomenti del tool. Le forme malformate vengono
 * normalizzate perche' gli argomenti arrivano dal modello: quello che non si
 * riesce a leggere diventa un'etichetta vuota, non un errore.
 */
export function parseAskQuestions(args: unknown): AskQuestion[] | undefined {
	if (!args || typeof args !== 'object') return undefined;
	const raw = (args as Record<string, unknown>).questions;
	if (!Array.isArray(raw)) return undefined;
	const questions = raw
		.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object')
		.map((entry, index) => ({
			id: typeof entry.id === 'string' ? entry.id : `q${index + 1}`,
			question:
				typeof entry.question === 'string'
					? entry.question
					: typeof entry.prompt === 'string'
						? entry.prompt
						: '',
			header: typeof entry.header === 'string' ? entry.header : undefined,
			multi: entry.multi === true,
			recommended: typeof entry.recommended === 'number' ? entry.recommended : undefined,
			options: Array.isArray(entry.options)
				? entry.options.map((option) => {
						if (typeof option === 'string') return { label: option };
						if (option && typeof option === 'object') {
							const fields = option as Record<string, unknown>;
							return {
								label:
									typeof fields.label === 'string'
										? fields.label
										: String(fields.name ?? fields.text ?? ''),
								description: typeof fields.description === 'string' ? fields.description : undefined,
								preview: typeof fields.preview === 'string' ? fields.preview : undefined
							};
						}
						return { label: String(option) };
					})
				: []
		}));
	return questions.length > 0 ? questions : undefined;
}

/**
 * Inverso per una singola etichetta: serve al renderer che rilegge le risposte
 * gia' inviate e deve mostrare separatamente l'opzione scelta e la nota che l'utente le aveva allegato.
 */
export function extractNoteFromLabel(label: string): { clean: string; note?: string } {
	const match = label.match(/^(.*?)\s*\((?:nota|note):\s*([^)]+)\)$/i);
	if (match) {
		return { clean: match[1].trim(), note: match[2].trim() };
	}
	return { clean: label };
}
