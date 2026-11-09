// Il runtime OMP interpreta l'HTML; le superfici Studio condividono soltanto
// il modello risultante e la busta di risposta, senza un secondo parser HTML.
import type { ImageContent } from './wire';

export interface FormSpan {
	text: string;
	style?: 'code' | 'strong' | 'em';
}

export interface FormChoiceField {
	kind: 'choice';
	name: string;
	multi: boolean;
	select: boolean;
	other: boolean;
	label: FormSpan[];
	options: { value: string; label: FormSpan[]; checked: boolean; disabled: boolean }[];
	required: boolean;
}

export interface FormTextField {
	kind: 'text';
	name: string;
	type: string;
	multiline: boolean;
	label: FormSpan[];
	value: string;
	placeholder: string;
	required: boolean;
	min?: number;
	max?: number;
	pattern?: string;
	minLength?: number;
	maxLength?: number;
	rows: number;
}

export type FormField = FormChoiceField | FormTextField;
export type FormBlock =
	| { kind: 'text'; spans: FormSpan[]; heading: boolean }
	| { kind: 'list'; items: FormSpan[][]; ordered: boolean }
	| { kind: 'pre'; text: string }
	| { kind: 'table'; rows: FormSpan[][][]; headerRows: number }
	| { kind: 'image'; src: string; alt: string }
	| { kind: 'svg'; markup: string; alt: string }
	| { kind: 'field'; field: FormField };

export interface AskFormModel {
	sections: { title: FormSpan[]; blocks: FormBlock[] }[];
	fields: FormField[];
	hidden: [string, string][];
	questions: Record<string, string>;
}

export type AskFormValue = string | number | string[];
export type AskFormData = Record<string, AskFormValue>;

export interface AskFormAnnotation {
	field: string;
	note: string;
	images: ImageContent[];
}

export interface AskFormDraft {
	data: AskFormData;
	annotations: AskFormAnnotation[];
	other: Record<string, { enabled: boolean; text: string }>;
	media?: { pending: number; errors: Record<string, string> };
}

export interface AskFormSubmission {
	action: 'submit' | 'delegate';
	data: AskFormData;
	annotations: AskFormAnnotation[];
}

export interface AskFormRequest {
	version: 1;
	toolCallId: string;
	title: string;
	html: string;
	form: AskFormModel;
	defaults: AskFormData;
	draft?: AskFormDraft;
	error?: string;
}

export const ASK_FORM_TITLE_PREFIX = 'studio-ask-form:';
export const ASK_FORM_IMAGE_BUDGET = 700_000;

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function spans(value: unknown): value is FormSpan[] {
	return Array.isArray(value) && value.every((span) => record(span) && typeof span.text === 'string' &&
		(span.style === undefined || span.style === 'code' || span.style === 'strong' || span.style === 'em'));
}

function field(value: unknown): value is FormField {
	if (!record(value) || typeof value.name !== 'string' || !spans(value.label) || typeof value.required !== 'boolean') return false;
	if (value.kind === 'choice') {
		return typeof value.multi === 'boolean' && typeof value.select === 'boolean' && typeof value.other === 'boolean' &&
			Array.isArray(value.options) && value.options.every((option) => record(option) && typeof option.value === 'string' &&
				spans(option.label) && typeof option.checked === 'boolean' && typeof option.disabled === 'boolean');
	}
	if (value.kind !== 'text' || typeof value.type !== 'string' || typeof value.multiline !== 'boolean' ||
		typeof value.value !== 'string' || typeof value.placeholder !== 'string' || typeof value.rows !== 'number') return false;
	return ['min', 'max', 'minLength', 'maxLength'].every((key) => value[key] === undefined ||
		(typeof value[key] === 'number' && Number.isFinite(value[key]))) &&
		(value.pattern === undefined || typeof value.pattern === 'string');
}

function block(value: unknown): value is FormBlock {
	if (!record(value)) return false;
	switch (value.kind) {
		case 'text': return spans(value.spans) && typeof value.heading === 'boolean';
		case 'list': return Array.isArray(value.items) && value.items.every(spans) && typeof value.ordered === 'boolean';
		case 'pre': return typeof value.text === 'string';
		case 'table': return Array.isArray(value.rows) && value.rows.every((row) => Array.isArray(row) && row.every(spans)) &&
			typeof value.headerRows === 'number' && Number.isFinite(value.headerRows);
		case 'image': return typeof value.src === 'string' && typeof value.alt === 'string' &&
			/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=\r\n]*$/i.test(value.src);
		case 'svg': return typeof value.markup === 'string' && typeof value.alt === 'string';
		case 'field': return field(value.field);
		default: return false;
	}
}

function data(value: unknown): value is AskFormData {
	return record(value) && Object.values(value).every((entry) => typeof entry === 'string' ||
		(typeof entry === 'number' && Number.isFinite(entry)) ||
		(Array.isArray(entry) && entry.every((item) => typeof item === 'string')));
}

/**
 * Stesso criterio di `extensions/studio-ask.ts`: l'estensione e' un file
 * isolato e non puo' importare questo modulo. Prima si tolgono gli spazi,
 * poi vale solo l'alfabeto base64 con al massimo due `=` finali.
 */
export function isAskImageData(data: string): boolean {
	const normalized = data.replace(/[ \t\r\n]+/g, '');
	return normalized.length > 0 && /^[a-z\d+/]*={0,2}$/i.test(normalized);
}

export function isAskFormImage(value: unknown): value is ImageContent {
	return record(value) && value.type === 'image' && typeof value.data === 'string' &&
		isAskImageData(value.data) &&
		typeof value.mimeType === 'string' && /^image\/(?:png|jpeg|webp|gif)$/i.test(value.mimeType);
}

export function isAskFormSubmission(value: unknown): value is AskFormSubmission {
	return record(value) && (value.action === 'submit' || value.action === 'delegate') && data(value.data) &&
		Array.isArray(value.annotations) && value.annotations.every((annotation) => record(annotation) &&
			typeof annotation.field === 'string' && typeof annotation.note === 'string' &&
			Array.isArray(annotation.images) && annotation.images.every(isAskFormImage));
}

export function isAskFormDraft(value: unknown): value is AskFormDraft {
	return record(value) && data(value.data) && isAskFormSubmission({ action: 'submit', data: value.data, annotations: value.annotations }) &&
		record(value.other) && Object.values(value.other).every((entry) => record(entry) &&
			typeof entry.enabled === 'boolean' && typeof entry.text === 'string') &&
		(value.media === undefined || (record(value.media) && typeof value.media.pending === 'number' &&
			Number.isInteger(value.media.pending) && value.media.pending >= 0 && record(value.media.errors) &&
			Object.values(value.media.errors).every((error) => typeof error === 'string')));
}

/** Il titolo identifica il canale, il toolCallId lega la busta alla chiamata viva. */
export function parseAskFormRequest(title: unknown, prefill: unknown): AskFormRequest | null {
	if (typeof title !== 'string' || !title.startsWith(ASK_FORM_TITLE_PREFIX) || typeof prefill !== 'string') return null;
	try {
		const meta: unknown = JSON.parse(title.slice(ASK_FORM_TITLE_PREFIX.length));
		const value: unknown = JSON.parse(prefill);
		if (!record(meta) || meta.version !== 1 || typeof meta.toolCallId !== 'string' || !record(value) ||
			value.version !== 1 || value.toolCallId !== meta.toolCallId || !value.toolCallId ||
			typeof value.title !== 'string' || typeof value.html !== 'string' || !data(value.defaults) || !record(value.form)) return null;
		const form = value.form;
		if (!Array.isArray(form.fields) || !form.fields.every(field) || !Array.isArray(form.sections) ||
			!form.sections.every((section) => record(section) && spans(section.title) && Array.isArray(section.blocks) && section.blocks.every(block)) ||
			!Array.isArray(form.hidden) || !form.hidden.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((part) => typeof part === 'string')) ||
			!record(form.questions) || !Object.values(form.questions).every((question) => typeof question === 'string') ||
			(value.draft !== undefined && !isAskFormDraft(value.draft)) ||
			(value.error !== undefined && typeof value.error !== 'string')) return null;
		return value as unknown as AskFormRequest;
	} catch {
		return null;
	}
}

function copyData(source: AskFormData): AskFormData {
	const copied: AskFormData = Object.create(null);
	for (const [key, value] of Object.entries(source)) copied[key] = Array.isArray(value) ? [...value] : value;
	return copied;
}

export function copyAskFormDraft(draft: AskFormDraft): AskFormDraft {
	return {
		data: copyData(draft.data),
		annotations: draft.annotations.map((annotation) => ({ ...annotation, images: annotation.images.map((image) => ({ ...image })) })),
		other: Object.assign(Object.create(null), Object.fromEntries(Object.entries(draft.other).map(([name, value]) => [name, { ...value }]))),
		...(draft.media ? { media: { pending: draft.media.pending, errors: Object.assign(Object.create(null), draft.media.errors) } } : {})
	};
}

export function createAskFormDraft(request: AskFormRequest): AskFormDraft {
	if (request.draft) return copyAskFormDraft(request.draft);
	return { data: copyData(request.defaults), annotations: [], other: Object.create(null) };
}

export function askFormPlainText(value: readonly FormSpan[]): string {
	return value.map((span) => span.text).join('');
}

/** Compone la busta; la validazione definitiva resta nel parser canonico OMP. */
export function buildAskFormSubmission(model: AskFormModel, draft: AskFormDraft, action: 'submit' | 'delegate'): AskFormSubmission {
	const values: AskFormData = Object.create(null);
	for (const [name, value] of model.hidden) values[name] = value;
	for (const current of model.fields) {
		if (!current.name) continue;
		let value = draft.data[current.name];
		if (current.kind === 'choice') {
			const multiple = current.multi && current.options.length > 1;
			if (!multiple && Array.isArray(value)) value = value[0];
			const other = current.other ? draft.other[current.name] : undefined;
			if (other?.enabled) {
				const typed = other.text.trim();
				if (multiple) {
					if (typed) value = [...(Array.isArray(value) ? value : []), typed];
				} else if (typed) value = typed;
				else continue;
			}
			if (value === undefined || (Array.isArray(value) && value.length === 0 && !multiple)) continue;
		} else if (value === undefined) value = '';
		if (current.kind === 'text' && (current.type === 'number' || current.type === 'range') &&
			typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) value = Number(value);
		values[current.name] = Array.isArray(value) ? [...value] : value;
	}
	const names = new Set(model.fields.map((current) => current.name).filter(Boolean));
	return {
		action,
		data: values,
		annotations: draft.annotations.filter((annotation) => names.has(annotation.field) &&
			(annotation.note.trim() || annotation.images.length)).map((annotation) => ({
				field: annotation.field, note: annotation.note, images: annotation.images.map((image) => ({ ...image }))
			}))
	};
}
