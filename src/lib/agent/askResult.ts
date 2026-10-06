/**
 * Lettura di una chiamata al tool `ask` gia' conclusa: domande, opzioni e
 * risposte ricostruite da argomenti e `result.details` di omp, per il
 * riepilogo che resta nella chat dopo l'invio.
 */
import {
	cleanOptionLabel,
	extractNoteFromLabel,
	isDecideForMeText,
	isDoneOption,
	isOtherOption
} from './askAnswers.ts';
import { asRecord, bool, recordList, str, strList } from './tools/types.ts';
import { m as msg } from '$lib/paraglide/messages.js';

export interface AskResultOption {
	label: string;
	cleanLabel: string;
	description?: string;
	selected: boolean;
	note?: string;
}

export interface AskResultQuestion {
	id: string;
	question: string;
	header?: string;
	multi: boolean;
	options: AskResultOption[];
	selectedLabels: string[];
	note?: string;
	customInput?: string;
}

/** Risposta pronta da mostrare: etichette scelte, delega all'agente o nulla. */
export interface AskAnswerSummary {
	kind: 'answered' | 'decided' | 'none';
	labels: string[];
	note?: string;
}

/**
 * Ricostruisce le domande con le rispettive risposte. omp consegna tre forme:
 * `details.results[]` per le sequenze multi-domanda, domande multiple negli
 * argomenti con un solo risultato, e la domanda singola classica.
 */
export function parseAskToolCall(args: Record<string, unknown>, details: unknown): AskResultQuestion[] {
	const rec = asRecord(details);
	const rawResults = Array.isArray(rec?.results) ? recordList(rec?.results) : [];
	const rawArgsQuestions = Array.isArray(args.questions) ? recordList(args.questions) : [];

	if (rawResults.length > 0) {
		return rawResults.map((res, idx) => {
			const selectedList = strList(res.selectedOptions).map((s) => extractNoteFromLabel(s).clean);
			const matchingArgQ = rawArgsQuestions[idx];
			const rawArgOpts = matchingArgQ ? recordList(matchingArgQ.options) : [];
			const options: AskResultOption[] = Array.isArray(res.options)
				? res.options.map((opt, oIdx) => {
						const labelStr =
							typeof opt === 'string' ? opt : (str(asRecord(opt)?.label) ?? msg.chat_v2_ask_option_n({ n: oIdx + 1 }));
						const parsed = extractNoteFromLabel(labelStr);
						const description =
							typeof opt === 'object' ? str(asRecord(opt)?.description) : str(rawArgOpts[oIdx]?.description);
						return {
							label: labelStr,
							cleanLabel: parsed.clean,
							description,
							selected: selectedList.includes(parsed.clean) || selectedList.includes(labelStr),
							note: parsed.note
						};
					})
				: [];
			return {
				id: str(res.id) ?? `q${idx + 1}`,
				question: str(res.question) ?? msg.chat_v2_ask_question_n({ n: idx + 1 }),
				header: matchingArgQ ? str(matchingArgQ.header) : undefined,
				multi: bool(res.multi) ?? false,
				options,
				selectedLabels: selectedList,
				note: str(res.note),
				customInput: str(res.customInput)
			};
		});
	}

	if (rawArgsQuestions.length > 1) {
		const selectedList = strList(rec?.selectedOptions);
		return rawArgsQuestions.map((qRec, idx) => ({
			id: str(qRec.id) ?? `q${idx + 1}`,
			question: str(qRec.question) ?? str(qRec.prompt) ?? msg.chat_v2_ask_question_n({ n: idx + 1 }),
			header: str(qRec.header),
			multi: bool(qRec.multi) ?? false,
			options: recordList(qRec.options).map((opt) => {
				const label = str(opt.label) ?? str(opt.text) ?? '';
				return { label, cleanLabel: label, description: str(opt.description), selected: selectedList.includes(label) };
			}),
			selectedLabels: selectedList,
			note: str(rec?.note),
			customInput: str(rec?.customInput)
		}));
	}

	const firstArgQ = rawArgsQuestions[0];
	const questionText =
		str(rec?.question) ??
		str(args.question) ??
		str(args.prompt) ??
		(firstArgQ ? (str(firstArgQ.question) ?? str(firstArgQ.prompt) ?? '') : '');

	const selectedList: string[] = [];
	let labelNote: string | undefined;
	for (const s of strList(rec?.selectedOptions)) {
		const parsed = extractNoteFromLabel(s);
		selectedList.push(parsed.clean);
		if (parsed.note) labelNote = parsed.note;
	}

	const rawOptions = rec?.options ?? args.options ?? firstArgQ?.options;
	const rawDetails = recordList(rec?.optionDetails ?? args.optionDetails);
	const options: AskResultOption[] = Array.isArray(rawOptions)
		? rawOptions.map((opt, idx) => {
				let label: string;
				let description: string | undefined;
				if (typeof opt === 'string') {
					label = opt;
					description = str(rawDetails[idx]?.description);
				} else {
					const optRec = asRecord(opt);
					label = str(optRec?.label) ?? str(optRec?.text) ?? str(optRec?.name) ?? msg.chat_v2_ask_option_n({ n: idx + 1 });
					description = str(optRec?.description);
				}
				const parsed = extractNoteFromLabel(label);
				return {
					label,
					cleanLabel: parsed.clean,
					description,
					selected:
						selectedList.includes(parsed.clean) || selectedList.includes(label) || selectedList.includes(String(idx)),
					note: parsed.note
				};
			})
		: [];

	return [
		{
			id: 'q1',
			question: questionText || msg.chat_v2_ask_agent_question(),
			header: firstArgQ ? str(firstArgQ.header) : undefined,
			multi: bool(rec?.multi) ?? bool(args.multi) ?? false,
			options,
			selectedLabels: selectedList,
			note: str(rec?.note) ?? labelNote,
			customInput: str(rec?.customInput)
		}
	];
}

/**
 * Riduce la risposta a quello che l'utente ha deciso. "Decidi tu" viaggia come
 * testo libero convenzionale (`decideForMeText`) e la nota puo' arrivare
 * attaccata al testo come `(nota: …)`: qui tornano a essere delega e nota.
 * Le sentinelle tecniche (Other, fine selezione) non sono risposte.
 */
export function summarizeAskAnswer(q: AskResultQuestion): AskAnswerSummary {
	let note = q.note?.trim() || undefined;
	let custom = q.customInput?.trim() ?? '';
	if (custom) {
		const parsed = extractNoteFromLabel(custom);
		custom = parsed.clean;
		note ??= parsed.note;
	}
	note ??= q.options.find((o) => o.selected && o.note)?.note;

	if (isDecideForMeText(custom) || q.selectedLabels.some(isDecideForMeText)) {
		return { kind: 'decided', labels: [], note };
	}

	const labels = q.selectedLabels
		.filter((l) => !isOtherOption(l) && !isDoneOption(l))
		.map(cleanOptionLabel);
	if (custom) labels.push(`“${custom}”`);
	return labels.length > 0 ? { kind: 'answered', labels, note } : { kind: 'none', labels: [], note };
}
