/**
 * Parser tollerante per argomenti parziali del tool `ask` in streaming.
 * Gestisce JSON troncato in qualsiasi punto dei delta toolcall e restituisce
 * lo stato progressivo di domande e opzioni generate, permettendo alla UI
 * di mostrare scheletri o elementi man mano che arrivano dal modello.
 */

import type { AskQuestion, AskQuestionOption } from './askAnswers';

export interface StreamOption {
	label: string;
	description?: string;
	preview?: string;
	/** True solo quando l'etichetta dell'opzione e' stata interamente chiusa dal JSON. */
	complete: boolean;
}

export interface StreamQuestion {
	id: string;
	question: string;
	header?: string;
	multi?: boolean;
	recommended?: number;
	options: StreamOption[];
	/** True se la stringa della domanda e' terminata nel JSON. */
	textComplete: boolean;
	/** True se l'array `options` e' terminato nel JSON. */
	optionsComplete: boolean;
	/** True se l'intero oggetto della domanda e' terminato. */
	complete: boolean;
}

export interface StreamAskState {
	questions: StreamQuestion[];
	complete: boolean;
	raw?: string;
}

/**
 * Tenta di riparare una stringa JSON parziale chiudendo stringhe aperte,
 * chiavi sospese e contenitori aperti ('{' e '[').
 */
export function repairPartialJson(raw: string): unknown | null {
	if (!raw || typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;

	// Tentativo rapido con JSON valido
	try {
		return JSON.parse(trimmed);
	} catch {
		// Prosegue con la riparazione
	}

	// Rimuove eventuali backslash finali dispari (escape non finito)
	let s = trimmed;
	let bs = 0;
	for (let i = s.length - 1; i >= 0 && s[i] === '\\'; i--) bs++;
	if (bs % 2 === 1) s = s.slice(0, -1);

	function attemptRepair(candidate: string): unknown | null {
		const stack: ('{' | '[')[] = [];
		let inString = false;
		let escaped = false;

		for (let i = 0; i < candidate.length; i++) {
			const ch = candidate[i];
			if (inString) {
				if (escaped) {
					escaped = false;
				} else if (ch === '\\') {
					escaped = true;
				} else if (ch === '"') {
					inString = false;
				}
			} else {
				if (ch === '"') {
					inString = true;
				} else if (ch === '{' || ch === '[') {
					stack.push(ch);
				} else if (ch === '}' || ch === ']') {
					if (stack.length > 0) {
						const last = stack[stack.length - 1];
						if ((ch === '}' && last === '{') || (ch === ']' && last === '[')) {
							stack.pop();
						}
					}
				}
			}
		}

		let repaired = candidate;
		if (inString) repaired += '"';

		let working = repaired.trimEnd();
		while (working.endsWith(',')) {
			working = working.slice(0, -1).trimEnd();
		}
		if (working.endsWith(':')) {
			working += 'null';
		}

		for (let j = stack.length - 1; j >= 0; j--) {
			working += stack[j] === '{' ? '}' : ']';
		}

		try {
			return JSON.parse(working);
		} catch {
			return null;
		}
	}

	let res = attemptRepair(s);
	if (res !== null) return res;

	// In caso di fallimento su caratteri sintattici parziali, indietreggia fino all'ultimo delimitatore
	for (let len = s.length - 1; len > 0; len--) {
		const ch = s[len];
		if (ch === ',' || ch === ':' || ch === '{' || ch === '[' || ch === '}' || ch === ']') {
			res = attemptRepair(s.slice(0, len));
			if (res !== null) return res;
		}
	}

	return null;
}

/**
 * Converte qualsiasi input (stringa delta parziale, JSON completo o oggetto gia' deserializzato)
 * in uno stato coerente `StreamAskState`. Non lancia mai eccezioni.
 */
export function parsePartialAskStream(input: unknown): StreamAskState {
	if (input === null || input === undefined || input === '') {
		return { questions: [], complete: false };
	}

	let rawObj: unknown = null;
	let isRawComplete = false;

	if (typeof input === 'object') {
		rawObj = input;
		isRawComplete = true;
	} else if (typeof input === 'string') {
		const trimmed = input.trim();
		if (!trimmed) return { questions: [], complete: false };
		try {
			rawObj = JSON.parse(trimmed);
			isRawComplete = true;
		} catch {
			rawObj = repairPartialJson(trimmed);
			isRawComplete = false;
		}
	}

	if (!rawObj || typeof rawObj !== 'object') {
		return { questions: [], complete: false, raw: typeof input === 'string' ? input : undefined };
	}

	const dict = rawObj as Record<string, unknown>;
	const questionsArr = Array.isArray(dict.questions) ? dict.questions : [];
	const rawStr = typeof input === 'string' ? input.trim() : JSON.stringify(input);

	const questions: StreamQuestion[] = [];

	for (let idx = 0; idx < questionsArr.length; idx++) {
		const qObj = questionsArr[idx];
		if (!qObj || typeof qObj !== 'object') continue;
		const entry = qObj as Record<string, unknown>;

		const isLastQ = idx === questionsArr.length - 1;
		const id = typeof entry.id === 'string' ? entry.id : `q_${idx + 1}`;
		const questionText =
			typeof entry.question === 'string'
				? entry.question
				: typeof entry.prompt === 'string'
					? entry.prompt
					: '';
		const header = typeof entry.header === 'string' ? entry.header : undefined;
		const multi = entry.multi === true;
		const recommended = typeof entry.recommended === 'number' ? entry.recommended : undefined;

		let textComplete = isRawComplete || !isLastQ;
		if (!textComplete && questionText) {
			const needle = JSON.stringify(questionText);
			if (rawStr.includes(needle)) {
				textComplete = true;
			}
		}

		const optionsRaw = Array.isArray(entry.options) ? entry.options : [];
		const options: StreamOption[] = [];

		for (let optIdx = 0; optIdx < optionsRaw.length; optIdx++) {
			const opt = optionsRaw[optIdx];
			const isLastOpt = optIdx === optionsRaw.length - 1;
			let label = '';
			let description: string | undefined = undefined;
			let preview: string | undefined = undefined;

			if (typeof opt === 'string') {
				label = opt;
			} else if (opt && typeof opt === 'object') {
				const optFields = opt as Record<string, unknown>;
				label =
					typeof optFields.label === 'string'
						? optFields.label
						: String(optFields.name ?? optFields.text ?? '');
				if (typeof optFields.description === 'string') description = optFields.description;
				if (typeof optFields.preview === 'string') preview = optFields.preview;
			} else if (opt !== null && opt !== undefined) {
				label = String(opt);
			}

			let optComplete = isRawComplete || !isLastQ || !isLastOpt;
			if (!optComplete && label) {
				const needle = JSON.stringify(label);
				if (rawStr.includes(needle)) {
					optComplete = true;
				}
			}

			options.push({
				label,
				description,
				preview,
				complete: optComplete
			});
		}

		let optionsComplete = isRawComplete || !isLastQ;
		if (!optionsComplete && entry.options !== undefined) {
			const qIndexInRaw = rawStr.indexOf(questionText || id);
			const sub = qIndexInRaw >= 0 ? rawStr.slice(qIndexInRaw) : rawStr;
			const optIdx = sub.indexOf('"options"');
			if (optIdx >= 0) {
				const afterOpt = sub.slice(optIdx);
				if (afterOpt.includes(']')) {
					optionsComplete = true;
				}
			}
		}

		const qComplete =
			isRawComplete ||
			!isLastQ ||
			(textComplete && optionsComplete && options.length > 0 && options.every((o) => o.complete));

		questions.push({
			id,
			question: questionText,
			header,
			multi,
			recommended,
			options,
			textComplete,
			optionsComplete,
			complete: qComplete
		});
	}

	const allQuestionsComplete = questions.length > 0 && questions.every((q) => q.complete);
	const complete = isRawComplete && allQuestionsComplete;

	return {
		questions,
		complete,
		raw: typeof input === 'string' ? input : undefined
	};
}

/**
 * Converte domande in streaming completate o parziali nel formato `AskQuestion[]`.
 */
export function streamToAskQuestions(streamQuestions: StreamQuestion[]): AskQuestion[] {
	return streamQuestions.map((q) => ({
		id: q.id,
		question: q.question,
		header: q.header,
		multi: q.multi,
		recommended: q.recommended,
		options: q.options.map((o): AskQuestionOption => ({
			label: o.label,
			description: o.description,
			preview: o.preview
		}))
	}));
}

/** Chiamata di tool come la descrive omp nei `toolcall_*`, quando la porta. */
export interface StreamToolCallRef {
	id?: string;
	name?: string;
	arguments?: unknown;
}

export interface StreamAskSnapshot {
	toolCallId: string | null;
	state: StreamAskState;
}

/**
 * Accumulatore dell'anteprima di `ask` in streaming. I delta arrivano in due
 * forme: `message_update/toolcall_delta` (con la chiamata in `partial`) e i
 * `studio_delta` di tipo `toolcall` che il backend Rust ricompone senza
 * nome del tool. Il legame con `ask` lo da' l'indice aperto da
 * `toolcall_start`: un'altra chiamata sullo stesso indice lo chiude.
 */
export class AskStreamTracker {
	#raw = '';
	#index: number | null = null;
	current: StreamAskSnapshot | null = null;

	/** Vero se l'anteprima e' cambiata. */
	start(index: number, call: StreamToolCallRef | undefined): boolean {
		if (call?.name !== 'ask') {
			// Un'altra chiamata riusa l'indice (ogni messaggio riparte da 0):
			// i suoi delta non sono argomenti di `ask`.
			if (this.#index === index) {
				this.#index = null;
				this.#raw = '';
			}
			return false;
		}
		this.#raw = '';
		this.#index = index;
		this.current = { toolCallId: call.id ?? null, state: { questions: [], complete: false } };
		return true;
	}

	delta(index: number, delta: string, call?: StreamToolCallRef): boolean {
		if (call?.name !== undefined && call.name !== 'ask') return false;
		if (this.#index !== index && call?.name !== 'ask') return false;
		if (this.#index !== index) {
			this.#raw = '';
			this.#index = index;
		}
		this.#raw += delta;
		this.current = {
			toolCallId: call?.id ?? this.current?.toolCallId ?? null,
			state: parsePartialAskStream(this.#raw)
		};
		return true;
	}

	end(index: number, call: StreamToolCallRef | undefined): boolean {
		this.#raw = '';
		if (call?.name !== 'ask') return false;
		this.#index = index;
		this.current = {
			toolCallId: call.id ?? this.current?.toolCallId ?? null,
			state: parsePartialAskStream(call.arguments)
		};
		return true;
	}

	reset(): void {
		this.#raw = '';
		this.#index = null;
		this.current = null;
	}
}
