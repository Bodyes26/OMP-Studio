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

/**
 * Domanda come l'ha dichiarata l'agente negli argomenti del tool `ask`. Vive
 * qui e non nella sessione perche' il piano di consegna si costruisce da
 * questa forma e i test devono poterla usare senza istanziare una sessione.
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
 * Chiave di confronto tra le opzioni di una richiesta e quelle di una domanda
 * dichiarata negli argomenti del tool. Fuori restano il suffisso
 * ` (Recommended)` e le voci aggiunte dal runtime di omp ("Altro", "Fine
 * selezione"), che compaiono e scompaiono tra un round e l'altro dello stesso
 * elenco.
 */
export function optionSignature(labels: string[]): string {
	return labels
		.map(cleanOptionLabel)
		.filter((label) => !isOtherOption(label) && !isDoneOption(label))
		.join('\u0000');
}

/**
 * Indice della domanda le cui opzioni corrispondono alla richiesta in arrivo,
 * `-1` quando non ce n'e' nessuna. `preferred` (l'indice dichiarato dal
 * titolo `(k/N)`) viene provato per primo.
 *
 * Serve a non fidarsi a occhi chiusi degli argomenti del tool: il protocollo
 * di `ask` e' sequenziale e una lista disallineata farebbe finire la risposta
 * di una domanda nella casella di un'altra.
 */
export function matchQuestionIndex(
	questions: { options: { label: string }[] }[],
	signature: string,
	preferred = 0
): number {
	const signatures = questions.map((question) =>
		optionSignature(question.options.map((option) => option.label))
	);
	if (preferred >= 0 && preferred < signatures.length && signatures[preferred] === signature) {
		return preferred;
	}
	return signatures.indexOf(signature);
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
	if (question.isCustom) return question.customInput.trim().length > 0;
	if (!question.visited) return false;
	if (question.selectedOptions.size > 0) return true;
	return question.multi && question.touched;
}

/** Indice della prima domanda senza risposta, `-1` quando sono tutte pronte. */
export function firstUnansweredIndex(questions: AnswerableQuestion[]): number {
	return questions.findIndex((question) => !isQuestionAnswered(question));
}

/**
 * Etichette riservate dal runtime di `omp`. `OTHER_LABEL` e' l'unica voce
 * sintetica che compare davvero sul filo; la sentinella di fine selezione
 * dipende dal `symbolPreset` del tema (`unicode` -> `✔`, `nerd` -> un glifo
 * della private use area, `ascii` -> `[ok]`) e non viene mai inviata da omp
 * quando la navigazione avanti e' attiva, quindi va indovinata: per questo il
 * passo di chiusura porta con se' un ripiego.
 */
export const OTHER_LABEL = 'Other (type your own)';
export const DONE_SENTINEL = '✔ Done selecting';

/**
 * Un passo del piano di consegna: una richiesta di omp, una risposta. Il
 * protocollo di `ask` e' sequenziale e irreversibile, quindi il piano si
 * costruisce **intero** quando l'utente ha finito di compilare, e si consegna
 * un passo per richiesta.
 */
export type AskFlushStep =
	| {
			method: 'select';
			value: string;
			/** Firma delle opzioni della domanda a cui il passo appartiene. */
			signature: string;
			/**
			 * Passo che chiude una domanda a scelta multipla. Se omp ripropone
			 * la stessa domanda significa che non ha riconosciuto la sentinella:
			 * `recovery` la annulla (rinviarla la toglie dal set) e chiude per
			 * la strada che non dipende dal tema.
			 */
			recovery?: AskFlushStep[];
	  }
	| { method: 'editor'; value: string };

/** Firma delle opzioni dichiarate per una domanda del wizard. */
export function answerableSignature(question: AnswerableQuestion): string {
	return optionSignature(question.options.map((option) => option.label));
}

/** Etichetta originale dell'opzione scelta, o la chiave se non si ritrova. */
function originalLabel(question: AnswerableQuestion, key: string): string {
	return question.options.find((option) => option.cleanLabel === key)?.label ?? key;
}

/** Riassunto leggibile di una risposta a scelta multipla, nota compresa. */
function multiSummary(question: AnswerableQuestion, selected: string[]): string {
	const note = question.note.trim();
	const labels = selected.map((key) => cleanOptionLabel(originalLabel(question, key)));
	const body = labels.length > 0 ? labels.join(', ') : 'nessuna opzione';
	return note ? `${body} (nota: ${note})` : body;
}

/**
 * Passi da consegnare per una domanda. Chiamarla su una domanda senza risposta
 * e' un errore di programmazione: restituirebbe una risposta inventata, che nel
 * protocollo sequenziale di `ask` finirebbe anche sulla domanda sbagliata.
 */
export function buildQuestionSteps(question: AnswerableQuestion): AskFlushStep[] {
	if (!isQuestionAnswered(question)) {
		throw new Error('Risposta assente: la domanda non e\u2019 stata compilata');
	}

	const signature = answerableSignature(question);
	const note = question.note.trim();

	if (question.multi) {
		const selected = Array.from(question.selectedOptions);
		const steps: AskFlushStep[] = selected.map((key) => ({
			method: 'select' as const,
			value: originalLabel(question, key),
			signature
		}));

		// Se l'utente ha indicato un valore personalizzato ("Altro"), inviamo
		// la richiesta attraverso la voce Other e il prompt editor
		if (question.isCustom) {
			const custom = question.customInput.trim();
			const customValue = note ? `${custom} (nota: ${note})` : custom;
			steps.push(
				{ method: 'select', value: OTHER_LABEL, signature },
				{ method: 'editor', value: customValue }
			);
			return steps;
		}

		// Ogni spunta e' un round: il ciclo di omp ripropone lo stesso elenco
		// dopo ognuna. La nota non puo' viaggiare come spunta, perche' omp
		// aggiunge al set qualunque valore ignoto e l'agente si ritroverebbe
		// un'opzione inesistente tra quelle scelte.
		const summary = multiSummary(question, selected);
		const viaOther: AskFlushStep[] = [
			{ method: 'select', value: OTHER_LABEL, signature },
			{ method: 'editor', value: note || summary }
		];
		if (note) {
			// Con una nota la chiusura passa per `Other`: omp conserva le spunte
			// e mette il testo in `customInput`, che e' il solo campo del
			// protocollo in cui una nota puo' arrivare intera.
			steps.push(...viaOther);
			return steps;
		}
		steps.push({
			method: 'select',
			value: DONE_SENTINEL,
			signature,
			// Sentinella non riconosciuta: rinviarla la toglie dal set, poi si
			// chiude per la strada indipendente dal tema.
			recovery: [{ method: 'select', value: DONE_SENTINEL, signature }, ...viaOther]
		});
		return steps;
	}

	// Scelta singola con "Altro": il valore va spedito cosi' com'e'. Il ramo a
	// scelta singola di omp accetta qualunque stringa e la registra come risposta,
	// quindi non serve passare per `Other` e per la richiesta `editor` che ne seguirebbe.
	if (question.isCustom) {
		const custom = question.customInput.trim();
		return [{ method: 'select', value: note ? `${custom} (nota: ${note})` : custom, signature }];
	}

	const selected = Array.from(question.selectedOptions);

	const label = originalLabel(question, selected[0]);
	return [
		{
			method: 'select',
			value: note ? `${cleanOptionLabel(label)} (nota: ${note})` : label,
			signature
		}
	];
}

/**
 * Piano completo del wizard, o `null` se manca almeno una risposta: il
 * chiamante non deve poter inviare un wizard incompleto.
 */
export function buildFlushPlan(questions: AnswerableQuestion[]): AskFlushStep[] | null {
	if (questions.length === 0 || firstUnansweredIndex(questions) !== -1) return null;
	return questions.flatMap(buildQuestionSteps);
}

/** Vero quando il passo puo' essere consegnato a questa richiesta. */
export function stepAcceptsRequest(
	step: AskFlushStep,
	request: { method: string; signature: string }
): boolean {
	if (step.method === 'select') {
		return request.method === 'select' && request.signature === step.signature;
	}
	// La richiesta di testo libero aperta da `Other` arriva come `editor`;
	// `input` e' la stessa cosa con una riga sola.
	return request.method === 'editor' || request.method === 'input';
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
 * Inverso di `buildQuestionSteps` per una singola etichetta: serve al
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
