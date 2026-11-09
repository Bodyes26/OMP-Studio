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
import type { ContentBlock } from './wire.ts';
import { m as msg } from '#lib/paraglide/messages.js';

export interface AskResultImage {
	data: string;
	mimeType: string;
}

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
	images?: AskResultImage[];
	delegated?: boolean;
}

/** Risposta pronta da mostrare: etichette scelte, delega all'agente o nulla. Senza immagini il campo non c'e': `undefined` non e' un allegato. */
export interface AskAnswerSummary {
	kind: 'answered' | 'decided' | 'none';
	labels: string[];
	note?: string;
	images?: AskResultImage[];
}

/**
 * Ricostruisce le domande con le rispettive risposte. omp consegna tre forme:
 * `details.results[]` per le sequenze multi-domanda, domande multiple negli
 * argomenti con un solo risultato, e la domanda singola classica.
 */
export function parseAskToolCall(
	args: Record<string, unknown>,
	details: unknown,
	content?: ContentBlock[]
): AskResultQuestion[] {
	const rec = asRecord(details);
	const rawResults = Array.isArray(rec?.results) ? recordList(rec?.results) : [];
	const rawArgsQuestions = Array.isArray(args.questions) ? recordList(args.questions) : [];

	// Supporto per il nuovo formato HTML form e risposte con annotazioni / immagini
	const isNewAsk =
		rec !== null &&
		(rec?.answers !== undefined ||
			rec?.delegated !== undefined ||
			rec?.annotations !== undefined ||
			typeof args.html === 'string');

	if (isNewAsk) {
		const delegated = rec?.delegated === true;
		const rawAnnotations = Array.isArray(rec?.annotations) ? recordList(rec?.annotations) : [];

		// Mappatura annotazioni per campo con estrazione immagini da `content`
		const annotationsByField = new Map<string, { note?: string; images: AskResultImage[] }>();
		for (const ann of rawAnnotations) {
			const fieldName = str(ann.field) ?? '';
			const noteText = str(ann.note);
			const annImages: AskResultImage[] = [];
			const indices = Array.isArray(ann.imageIndices) ? ann.imageIndices : [];

			if (Array.isArray(content) && indices.length > 0) {
				for (const idx of indices) {
					if (typeof idx === 'number' && content[idx]) {
						const block = content[idx];
						if (block.type === 'image' && typeof block.data === 'string' && typeof block.mimeType === 'string') {
							annImages.push({ data: block.data, mimeType: block.mimeType });
						}
					}
				}
			}
			annotationsByField.set(fieldName, { note: noteText, images: annImages });
		}

		// Se content contiene blocchi immagine ma non c'erano imageIndices, raccogli le immagini rimaste
		if (Array.isArray(content)) {
			const unassignedImages: AskResultImage[] = [];
			for (let i = 0; i < content.length; i++) {
				const block = content[i];
				if (block.type === 'image' && typeof block.data === 'string' && typeof block.mimeType === 'string') {
					const isClaimed = rawAnnotations.some((ann) =>
						Array.isArray(ann.imageIndices) && ann.imageIndices.includes(i)
					);
					if (!isClaimed) {
						unassignedImages.push({ data: block.data, mimeType: block.mimeType });
					}
				}
			}
			if (unassignedImages.length > 0) {
				const targetField = rawAnnotations[0] ? str(rawAnnotations[0].field) ?? '' : '';
				const existing = annotationsByField.get(targetField) ?? { images: [] };
				existing.images = [...existing.images, ...unassignedImages];
				annotationsByField.set(targetField, existing);
			}
		}

		// Mappatura domande/etichette da rec.questions o args.html
		const questionsMap: Record<string, string> = {};
		if (rec?.questions && typeof rec.questions === 'object') {
			for (const [k, v] of Object.entries(rec.questions as Record<string, unknown>)) {
				if (typeof v === 'string') questionsMap[k] = v;
			}
		}
		if (typeof args.html === 'string') {
			const labelRegex = /<label[^>]+for=["']([^"']+)["'][^>]*>([\s\S]*?)<\/label>/gi;
			let lMatch: RegExpExecArray | null;
			while ((lMatch = labelRegex.exec(args.html)) !== null) {
				const name = lMatch[1];
				const text = lMatch[2].replace(/<[^>]+>/g, '').trim();
				if (name && text && !questionsMap[name]) questionsMap[name] = text;
			}
		}

		// Risoluzione delle risposte
		const results: AskResultQuestion[] = [];
		const rawAnswers = rec?.answers;

		if (Array.isArray(rawAnswers)) {
			for (let idx = 0; idx < rawAnswers.length; idx++) {
				const ans = rawAnswers[idx];
				const ansRec = asRecord(ans);
				const fieldName = str(ansRec?.name) ?? str(ansRec?.field) ?? `field_${idx + 1}`;
				const questionText = str(ansRec?.question) ?? questionsMap[fieldName] ?? fieldName;
				const rawVal = ansRec ? (ansRec.answer ?? ansRec.value) : ans;
				const selectedList = Array.isArray(rawVal)
					? rawVal.map((v) => str(v) ?? '').filter(Boolean)
					: rawVal !== undefined && rawVal !== null && rawVal !== ''
						? [String(rawVal)]
						: [];

				const ann = annotationsByField.get(fieldName);
				results.push({
					id: fieldName,
					question: questionText,
					multi: Array.isArray(rawVal),
					options: selectedList.map((lbl) => ({ label: lbl, cleanLabel: lbl, selected: true })),
					selectedLabels: selectedList,
					note: ann?.note,
					images: ann?.images,
					delegated
				});
			}
		} else if (rawAnswers && typeof rawAnswers === 'object') {
			for (const [fieldName, rawValOrRec] of Object.entries(rawAnswers as Record<string, unknown>)) {
				const valRec = asRecord(rawValOrRec);
				const questionText = str(valRec?.question) ?? questionsMap[fieldName] ?? fieldName;
				const rawVal = valRec && (valRec.answer !== undefined || valRec.value !== undefined)
					? (valRec.answer ?? valRec.value)
					: rawValOrRec;
				const selectedList = Array.isArray(rawVal)
					? rawVal.map((v) => str(v) ?? '').filter(Boolean)
					: rawVal !== undefined && rawVal !== null && rawVal !== ''
						? [String(rawVal)]
						: [];

				const ann = annotationsByField.get(fieldName);
				results.push({
					id: fieldName,
					question: questionText,
					multi: Array.isArray(rawVal),
					options: selectedList.map((lbl) => ({ label: lbl, cleanLabel: lbl, selected: true })),
					selectedLabels: selectedList,
					note: ann?.note,
					images: ann?.images,
					delegated
				});
			}
		} else if (delegated || annotationsByField.size > 0) {
			// Nessuna risposta esplicita per campo, ma presente delega o annotazione
			const targetField = annotationsByField.keys().next().value ?? 'form';
			const ann = annotationsByField.get(targetField);
			results.push({
				id: targetField,
				question: questionsMap[targetField] ?? msg.chat_v2_ask_agent_question(),
				multi: false,
				options: [],
				selectedLabels: [],
				note: ann?.note,
				images: ann?.images,
				delegated
			});
		}

		if (results.length > 0) {
			return results;
		}
	}
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
function withImages(summary: AskAnswerSummary, images: AskResultImage[] | undefined): AskAnswerSummary {
	return images === undefined ? summary : { ...summary, images };
}

export function summarizeAskAnswer(q: AskResultQuestion): AskAnswerSummary {
	let note = q.note?.trim() || undefined;
	let custom = q.customInput?.trim() ?? '';
	if (custom) {
		const parsed = extractNoteFromLabel(custom);
		custom = parsed.clean;
		note ??= parsed.note;
	}
	note ??= q.options.find((o) => o.selected && o.note)?.note;
	if (q.delegated || isDecideForMeText(custom) || q.selectedLabels.some(isDecideForMeText)) {
		return withImages({ kind: 'decided', labels: [], note }, q.images);
	}

	const labels = q.selectedLabels
		.filter((l) => !isOtherOption(l) && !isDoneOption(l))
		.map(cleanOptionLabel);
	if (custom) labels.push(`“${custom}”`);
	const hasContent = labels.length > 0 || !!note || (q.images && q.images.length > 0);
	return withImages(hasContent ? { kind: 'answered', labels, note } : { kind: 'none', labels: [], note }, q.images);
}
