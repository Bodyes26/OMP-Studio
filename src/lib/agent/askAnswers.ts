/**
 * Formattazione e validazione delle risposte del wizard `ask`.
 *
 * Vive fuori dal componente per due ragioni:
 * 1. e' la logica che decide **cosa arriva all'agente**, quindi va verificata
 *    dai test sul codice di produzione, non su una copia;
 * 2. una risposta inventata (per esempio la prima opzione, quando l'utente non
 *    ha scelto niente) e' indistinguibile da una decisione dell'utente: qui
 *    non esiste nessun ripiego silenzioso.
 */

export interface AnswerableOption {
	/** Etichetta come l'ha mandata l'agente: e' quella che si rimanda. */
	label: string;
	/** Etichetta senza il suffisso ` (Recommended)`: e' la chiave di selezione. */
	cleanLabel: string;
	isOther: boolean;
	isDoneSentinel: boolean;
}

export interface AnswerableQuestion {
	options: AnswerableOption[];
	multi: boolean;
	/** Chiavi `cleanLabel` selezionate. */
	selectedOptions: Set<string>;
	note: string;
	customInput: string;
	/** Vero quando l'utente ha scelto "Altro" invece di un'opzione. */
	isCustom: boolean;
	/** Vero appena l'utente interviene sulla domanda: selezione, testo, nota. */
	touched: boolean;
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
 * - a scelta singola serve un'opzione selezionata (anche quella consigliata,
 *   che l'utente vede evidenziata prima di confermare);
 * - a scelta multipla l'insieme vuoto e' una risposta valida ("nessuna"), ma
 *   solo se l'utente ha davvero toccato la domanda.
 */
export function isQuestionAnswered(question: AnswerableQuestion): boolean {
	if (question.isCustom) return question.customInput.trim().length > 0;
	if (question.selectedOptions.size > 0) return true;
	return question.multi && question.touched;
}

/** Indice della prima domanda senza risposta, `-1` quando sono tutte pronte. */
export function firstUnansweredIndex(questions: AnswerableQuestion[]): number {
	return questions.findIndex((question) => !isQuestionAnswered(question));
}

/**
 * Righe da inviare per una domanda. Chiamarla su una domanda senza risposta e'
 * un errore di programmazione: restituirebbe una risposta inventata, che nel
 * protocollo sequenziale di `ask` finirebbe anche sulla domanda sbagliata.
 */
export function formatQuestionAnswer(question: AnswerableQuestion): string[] {
	if (!isQuestionAnswered(question)) {
		throw new Error('Risposta assente: la domanda non e\u2019 stata compilata');
	}

	const note = question.note.trim();

	if (question.isCustom) {
		const custom = question.customInput.trim();
		return [note ? `${custom} (nota: ${note})` : custom];
	}

	const selected = Array.from(question.selectedOptions);

	if (question.multi) {
		const result = selected.map(
			(key) => question.options.find((option) => option.cleanLabel === key)?.label ?? key
		);
		if (note) result.push(`(nota: ${note})`);
		const done = question.options.find((option) => option.isDoneSentinel)?.label ?? '✔ Done selecting';
		result.push(done);
		return result;
	}

	const key = selected[0];
	const match = question.options.find((option) => option.cleanLabel === key);
	const label = match ? match.label : key;
	return [note ? `${cleanOptionLabel(label)} (nota: ${note})` : label];
}

/**
 * Tutte le righe del wizard, o `null` se manca almeno una risposta: il
 * chiamante non deve poter inviare un wizard incompleto.
 */
export function formatWizardAnswers(questions: AnswerableQuestion[]): string[] | null {
	if (questions.length === 0 || firstUnansweredIndex(questions) !== -1) return null;
	return questions.flatMap(formatQuestionAnswer);
}

/**
 * Inverso di `formatQuestionAnswer` per una singola etichetta: serve al
 * renderer che rilegge le risposte gia' inviate e deve mostrare separatamente
 * l'opzione scelta e la nota che l'utente le aveva allegato.
 */
export function extractNoteFromLabel(label: string): { clean: string; note?: string } {
	const match = label.match(/^(.*?)\s*\((?:nota|note):\s*([^)]+)\)$/i);
	if (match) {
		return { clean: match[1].trim(), note: match[2].trim() };
	}
	return { clean: label };
}
