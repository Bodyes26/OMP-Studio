<script lang="ts">
	// Modulo unico HTML ask (Gate R32): tutte le sezioni visibili e modificabili
	// liberamente prima dell'invio. Supporta blocchi canonici (testo, elenchi, pre,
	// tabelle, immagini data raster, SVG sanitizzati), controlli radio/checkbox/select/text,
	// vincoli browser nativi, opzione Altro…, note/immagini per sezione con budget
	// controllato, piena conservazione della bozza, visualizzazione allargabile ed
	// invio esplicito o delega "Decidi tu". Non importa AgentSession per consentire
	// il riuso su Desktop, Companion e Remote.
	import { m } from '#lib/paraglide/messages.js';
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		IconAsk,
		IconAttach,
		IconCalendar,
		IconCheck,
		IconChevronDown,
		IconChevronLeft,
		IconChevronRight,
		IconChevronUp,
		IconClose,
		IconNote,
		IconPlus,
		IconWarning
	} from '#lib/icons.ts';
	import Slider from '#lib/ui/Slider.svelte';
	import AttachmentThumb, { type ComposerAttachment } from './AttachmentThumb.svelte';
	import { isImageFile, prepareImage, extractImageFiles } from '../images';
	import { agentUiHooks } from '../ui-context';
	import { sanitizeSvg } from '#lib/editor/svgSandbox.ts';
	import {
		ASK_FORM_IMAGE_BUDGET,
		buildAskFormSubmission,
		copyAskFormDraft,
		type AskFormAnnotation,
		type AskFormDraft,
		type AskFormRequest,
		type AskFormSubmission,
		type FormBlock,
		type FormChoiceField,
		type FormField,
		type FormSpan,
		type FormTextField
	} from '../askForm';
	import type { ImageContent } from '../wire';

	let {
		form,
		draft,
		onDraft,
		onSubmit,
		onCancel,
		onMinimize,
		supportsImages = true,
		compact = false,
		imageBudget = ASK_FORM_IMAGE_BUDGET
	}: {
		form: AskFormRequest;
		draft: AskFormDraft;
		onDraft: (draft: AskFormDraft) => void;
		onSubmit: (submission: AskFormSubmission) => Promise<boolean>;
		onCancel: () => Promise<boolean | void>;
		onMinimize?: () => void;
		supportsImages?: boolean;
		compact?: boolean;
		imageBudget?: number;
	} = $props();

	const hooks = agentUiHooks();

	// Bozza locale reattiva per commit sincrono e protezione da corse asincrone.
	// L'inizializzazione prende solo il primo valore: gli aggiornamenti esterni
	// arrivano dall'effect sotto, altrimenti un draft in arrivo sovrascrive
	// la modifica che l'utente sta ancora scrivendo.
	let localDraft = $state<AskFormDraft>(untrack(() => copyAskFormDraft(draft)));

	// Sincronizzazione in arrivo dalla prop draft quando cambia esternamente (es. sync da Companion)
	$effect(() => {
		const incoming = draft;
		untrack(() => {
			localDraft = copyAskFormDraft(incoming);
		});
	});

	function commitDraft(next: AskFormDraft) {
		localDraft = copyAskFormDraft(next);
		onDraft(copyAskFormDraft(localDraft));
	}

	function createEmptyErrors(): Record<string, string> {
		return Object.create(null) as Record<string, string>;
	}

	function cloneErrors(source?: Record<string, string>): Record<string, string> {
		const out: Record<string, string> = Object.create(null);
		if (source) {
			for (const [k, v] of Object.entries(source)) {
				if (typeof v === 'string') out[k] = v;
			}
		}
		return out;
	}

	let formEl = $state<HTMLFormElement | undefined>();
	let expanded = $state(false);
	let isSubmitting = $state(false);
	let activeNoteFields = new SvelteSet<string>();
	let inFlightUploads = 0;

	// Sincronizzazione stato media dalla bozza locale per conservazione cross-minimize
	const mediaState = $derived(localDraft.media ?? { pending: 0, errors: createEmptyErrors() });
	const mediaPending = $derived(mediaState.pending ?? 0);
	const mediaErrors = $derived(mediaState.errors ?? createEmptyErrors());
	const hasMediaErrors = $derived(Object.values(mediaErrors).some((msg) => !!msg));
	const isBlocked = $derived(isSubmitting || mediaPending > 0 || hasMediaErrors);

	// Calcola la dimensione totale in caratteri base64 di tutte le immagini nella bozza
	const totalImageChars = $derived.by(() => {
		let total = 0;
		for (const ann of localDraft.annotations) {
			for (const img of ann.images) {
				total += img.data.length;
			}
		}
		return total;
	});

	function updateMediaState(pendingDelta: number, errorField?: string, errorMsg?: string) {
		const cloned = copyAskFormDraft(localDraft);
		const currentMedia = cloned.media
			? { pending: cloned.media.pending, errors: cloneErrors(cloned.media.errors) }
			: { pending: 0, errors: createEmptyErrors() };

		currentMedia.pending = Math.max(0, currentMedia.pending + pendingDelta);
		if (errorField) {
			if (errorMsg) {
				currentMedia.errors[errorField] = errorMsg;
			} else {
				delete currentMedia.errors[errorField];
			}
		}
		cloned.media = currentMedia;
		commitDraft(cloned);
	}

	function setFieldError(fieldName: string, errorMsg: string) {
		updateMediaState(0, fieldName, errorMsg);
	}

	function clearFieldError(fieldName: string) {
		updateMediaState(0, fieldName, undefined);
	}

	function getFirstNamedField(section: { blocks: FormBlock[] }): string | undefined {
		for (const block of section.blocks) {
			if (block.kind === 'field' && block.field.name) {
				return block.field.name;
			}
		}
		return form.form.fields[0]?.name;
	}

	function getAnnotation(fieldName: string): AskFormAnnotation {
		const found = localDraft.annotations.find((a) => a.field === fieldName);
		if (found) return found;
		return { field: fieldName, note: '', images: [] };
	}

	function setNoteText(fieldName: string, noteText: string) {
		const cloned = copyAskFormDraft(localDraft);
		const existing = cloned.annotations.find((a) => a.field === fieldName);
		if (existing) {
			existing.note = noteText;
		} else {
			cloned.annotations.push({ field: fieldName, note: noteText, images: [] });
		}
		commitDraft(cloned);
	}

	function addImages(fieldName: string, newImages: ImageContent[]) {
		const cloned = copyAskFormDraft(localDraft);
		let existing = cloned.annotations.find((a) => a.field === fieldName);
		if (!existing) {
			existing = { field: fieldName, note: '', images: [] };
			cloned.annotations.push(existing);
		}
		existing.images.push(...newImages);
		commitDraft(cloned);
	}

	function removeImage(fieldName: string, imageIndex: number) {
		const cloned = copyAskFormDraft(localDraft);
		const existing = cloned.annotations.find((a) => a.field === fieldName);
		if (existing) {
			existing.images.splice(imageIndex, 1);
			commitDraft(cloned);
		}
	}

	async function handleFilesUpload(fieldName: string, files: File[]) {
		if (!supportsImages) {
			setFieldError(fieldName, m.ask_form_image_unsupported());
			return;
		}
		activeNoteFields.add(fieldName);
		clearFieldError(fieldName);

		const validFiles = files.filter(isImageFile);
		if (validFiles.length === 0) return;

		let remainingBudget = imageBudget - totalImageChars;
		if (remainingBudget <= 0) {
			setFieldError(fieldName, m.ask_form_image_budget_exceeded());
			return;
		}

		const batchCount = validFiles.length;
		inFlightUploads += batchCount;
		updateMediaState(batchCount);
		let processedInBatch = 0;

		try {
			const prepared: ImageContent[] = [];
			for (let i = 0; i < validFiles.length; i++) {
				const file = validFiles[i];
				try {
					const res = await prepareImage(file, remainingBudget);
					if ('error' in res) {
						setFieldError(fieldName, res.error);
						break;
					} else {
						prepared.push(res);
						remainingBudget -= res.data.length;
						if (remainingBudget <= 0 && i < validFiles.length - 1) {
							setFieldError(fieldName, m.ask_form_image_budget_exceeded());
							break;
						}
					}
				} catch (err) {
					setFieldError(fieldName, err instanceof Error ? err.message : String(err));
					break;
				} finally {
					processedInBatch++;
					inFlightUploads = Math.max(0, inFlightUploads - 1);
					updateMediaState(-1);
				}
			}

			if (prepared.length > 0) {
				addImages(fieldName, prepared);
			}
		} finally {
			// Se il loop è terminato prematuramente per break o errore,
			// scala la quota di questo batch non ancora decrementata
			const leftover = batchCount - processedInBatch;
			if (leftover > 0) {
				inFlightUploads = Math.max(0, inFlightUploads - leftover);
				updateMediaState(-leftover);
			}
		}
	}

	function handleDropFiles(fieldName: string, e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		const files = extractImageFiles(e.dataTransfer);
		if (files.length > 0) {
			void handleFilesUpload(fieldName, files);
		}
	}

	function handlePasteFiles(fieldName: string, e: ClipboardEvent) {
		const files = extractImageFiles(e.clipboardData);
		if (files.length > 0) {
			e.preventDefault();
			void handleFilesUpload(fieldName, files);
		}
	}

	function toAttachment(img: ImageContent, index: number): ComposerAttachment {
		return {
			id: `att_${index}_${img.data.slice(0, 12)}`,
			kind: 'image',
			name: `image_${index + 1}.${img.mimeType.split('/')[1] || 'png'}`,
			size: Math.round((img.data.length * 3) / 4),
			base64: img.data,
			mimeType: img.mimeType,
			tokens: Math.round(img.data.length / 4)
		};
	}

	function setTextValue(name: string, value: string) {
		const cloned = copyAskFormDraft(localDraft);
		cloned.data[name] = value;
		commitDraft(cloned);
	}

	function selectRadio(name: string, value: string) {
		const cloned = copyAskFormDraft(localDraft);
		cloned.data[name] = value;
		if (cloned.other[name]) {
			cloned.other[name].enabled = false;
		}
		commitDraft(cloned);
	}

	function selectOtherRadio(name: string) {
		const cloned = copyAskFormDraft(localDraft);
		cloned.data[name] = '';
		if (!cloned.other[name]) {
			cloned.other[name] = { enabled: true, text: '' };
		} else {
			cloned.other[name].enabled = true;
		}
		commitDraft(cloned);
	}

	function toggleCheckbox(name: string, value: string, checked: boolean) {
		const cloned = copyAskFormDraft(localDraft);
		const current = Array.isArray(cloned.data[name]) ? [...(cloned.data[name] as string[])] : [];
		if (checked) {
			if (!current.includes(value)) current.push(value);
		} else {
			const idx = current.indexOf(value);
			if (idx >= 0) current.splice(idx, 1);
		}
		cloned.data[name] = current;
		commitDraft(cloned);
	}

	function toggleOtherCheckbox(name: string, checked: boolean) {
		const cloned = copyAskFormDraft(localDraft);
		if (!cloned.other[name]) {
			cloned.other[name] = { enabled: checked, text: '' };
		} else {
			cloned.other[name].enabled = checked;
		}
		commitDraft(cloned);
	}

	function setOtherText(name: string, text: string) {
		const cloned = copyAskFormDraft(localDraft);
		if (!cloned.other[name]) {
			cloned.other[name] = { enabled: true, text };
		} else {
			cloned.other[name].text = text;
		}
		commitDraft(cloned);
	}

	function isChoiceChecked(name: string, val: string): boolean {
		const curr = localDraft.data[name];
		if (Array.isArray(curr)) return curr.includes(val);
		return curr === val && !localDraft.other[name]?.enabled;
	}

	function plain(spans: readonly FormSpan[]): string {
		return spans.map((span) => span.text).join('');
	}

	// Il modello scrive «Raccomandazione:» in grassetto. Il resto del paragrafo
	// resta il consiglio, senza ripetere la parola dentro il testo.
	function recommendationBody(spans: readonly FormSpan[]): FormSpan[] | null {
		if (spans.length === 0 || spans[0].style !== 'strong') return null;
		if (!/^\s*(?:raccomandazione|recommendation)\b/i.test(spans[0].text)) return null;
		const inline = spans[0].text.replace(/^\s*(?:raccomandazione|recommendation)\s*[:.\-–—]?\s*/i, '');
		const rest = spans.slice(1).map((span, index) =>
			index === 0 ? { ...span, text: span.text.replace(/^[\s:.\-–—]+/, '') } : span
		);
		return inline ? [{ text: inline }, ...rest] : rest;
	}

	function sectionRecommends(blocks: readonly FormBlock[]): boolean {
		return blocks.some((block) => block.kind === 'text' && !block.heading && recommendationBody(block.spans) !== null);
	}

	let openName = $state<string | null>(null);
	let openKind = $state<'select' | 'date' | null>(null);
	let menuHi = $state(0);
	let dateCursor = $state({ y: new Date().getFullYear(), m: new Date().getMonth() });
	let anchorEl = $state<HTMLElement | null>(null);
	let popEl = $state<HTMLDivElement | null>(null);
	const openField = $derived(form.form.fields.find((field) => field.name === openName) ?? null);
	const weekdays = [0, 1, 2, 3, 4, 5, 6].map((offset) =>
		new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(2024, 0, 1 + offset))
	);

	function closePicker() {
		openName = null;
		openKind = null;
		anchorEl = null;
	}

	function focusNode(node: HTMLInputElement) {
		node.focus();
	}

	function isoOf(year: number, month: number, day: number): string {
		return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	}

	function prettyDate(iso: string): string {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
		const [year, month, day] = iso.split('-').map(Number);
		return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(
			new Date(year, month - 1, day)
		);
	}

	function monthTitle(year: number, month: number): string {
		const label = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
		return label.charAt(0).toLocaleUpperCase() + label.slice(1);
	}

	function monthGrid(year: number, month: number): { iso: string; label: number; outside: boolean }[] {
		const lead = (new Date(year, month, 1).getDay() + 6) % 7;
		const days = new Date(year, month + 1, 0).getDate();
		const prevDays = new Date(year, month, 0).getDate();
		const cells: { iso: string; label: number; outside: boolean }[] = [];
		for (let index = 0; index < lead; index++) {
			const day = prevDays - lead + 1 + index;
			const prev = month - 1;
			cells.push({ iso: isoOf(prev < 0 ? year - 1 : year, (prev + 12) % 12, day), label: day, outside: true });
		}
		for (let day = 1; day <= days; day++) cells.push({ iso: isoOf(year, month, day), label: day, outside: false });
		const tail = (7 - (cells.length % 7)) % 7;
		for (let day = 1; day <= tail; day++) {
			const next = month + 1;
			cells.push({ iso: isoOf(next > 11 ? year + 1 : year, next % 12, day), label: day, outside: true });
		}
		return cells;
	}

	function selectEntries(field: FormChoiceField): { value: string; label: string; disabled: boolean }[] {
		const rows = field.options.map((opt) => ({ value: opt.value, label: plain(opt.label), disabled: opt.disabled }));
		if (field.other) rows.push({ value: '__other__', label: m.chat_v2_ask_other(), disabled: false });
		return rows;
	}

	function selectDisplay(field: FormChoiceField): string {
		if (!field.multi && localDraft.other[field.name]?.enabled) return localDraft.other[field.name]?.text ?? '';
		if (field.multi) {
			const values = Array.isArray(localDraft.data[field.name]) ? (localDraft.data[field.name] as string[]) : [];
			const labels = field.options.filter((opt) => values.includes(opt.value)).map((opt) => plain(opt.label));
			if (localDraft.other[field.name]?.enabled) {
				labels.push(localDraft.other[field.name]?.text.trim() || m.chat_v2_ask_other());
			}
			return labels.join(', ');
		}
		const current = localDraft.data[field.name];
		const found = field.options.find((opt) => opt.value === current);
		return found ? plain(found.label) : '';
	}

	function selectOn(field: FormChoiceField, value: string): boolean {
		if (value === '__other__') return localDraft.other[field.name]?.enabled ?? false;
		return isChoiceChecked(field.name, value);
	}

	function pickSelect(field: FormChoiceField, value: string) {
		const cloned = copyAskFormDraft(localDraft);
		if (field.multi) {
			if (value === '__other__') {
				const enabled = !(cloned.other[field.name]?.enabled);
				cloned.other[field.name] = { enabled, text: cloned.other[field.name]?.text ?? '' };
			} else {
				const current = Array.isArray(cloned.data[field.name]) ? [...(cloned.data[field.name] as string[])] : [];
				const index = current.indexOf(value);
				if (index >= 0) current.splice(index, 1);
				else current.push(value);
				cloned.data[field.name] = current;
			}
		} else if (value === '__other__') {
			cloned.data[field.name] = '';
			cloned.other[field.name] = { enabled: true, text: cloned.other[field.name]?.text ?? '' };
			const face = anchorEl;
			closePicker();
			// Il menu si smonta nel flush successivo: il fuoco va rimesso dopo,
			// altrimenti resta sul pulsante che sta sparendo.
			queueMicrotask(() => face?.focus());
		} else {
			cloned.data[field.name] = value;
			if (cloned.other[field.name]) cloned.other[field.name].enabled = false;
			closePicker();
		}
		commitDraft(cloned);
	}

	function openPicker(kind: 'select' | 'date', name: string, anchor: HTMLElement) {
		if (openKind === kind && openName === name) {
			closePicker();
			return;
		}
		openKind = kind;
		openName = name;
		anchorEl = anchor;
		if (kind === 'date') {
			const raw = String(localDraft.data[name] ?? '');
			const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : new Date();
			dateCursor = { y: parsed.getFullYear(), m: parsed.getMonth() };
		} else {
			const field = form.form.fields.find((item) => item.name === name);
			if (field && field.kind === 'choice') {
				const entries = selectEntries(field);
				const current = entries.findIndex((entry) => selectOn(field, entry.value));
				menuHi = Math.max(0, current);
			}
		}
	}

	function shiftMonth(delta: number) {
		const next = new Date(dateCursor.y, dateCursor.m + delta, 1);
		dateCursor = { y: next.getFullYear(), m: next.getMonth() };
	}

	function chooseDate(name: string, iso: string) {
		setTextValue(name, iso);
		const parsed = new Date(`${iso}T12:00:00`);
		dateCursor = { y: parsed.getFullYear(), m: parsed.getMonth() };
		closePicker();
	}

	$effect(() => {
		const anchor = anchorEl;
		const pop = popEl;
		const name = openName;
		void dateCursor;
		if (!anchor || !pop || !name) return;
		const place = () => {
			const rect = anchor.getBoundingClientRect();
			const width = openKind === 'date' ? 280 : Math.max(rect.width, 220);
			const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
			pop.style.left = `${left}px`;
			pop.style.width = `${width}px`;
			pop.style.top = `${rect.bottom + 4}px`;
			const box = pop.getBoundingClientRect();
			if (box.bottom > window.innerHeight - 8) pop.style.top = `${Math.max(8, rect.top - box.height - 4)}px`;
		};
		place();
		if (!pop.contains(document.activeElement)) pop.focus();
		const scroller = formEl;
		const onScroll = () => place();
		scroller?.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll);
		const onPointer = (event: PointerEvent) => {
			const target = event.target;
			const host = anchor.parentElement;
			if (!(target instanceof Node) || pop.contains(target) || anchor.contains(target) || host?.contains(target)) return;
			closePicker();
		};
		window.addEventListener('pointerdown', onPointer, true);
		return () => {
			scroller?.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			window.removeEventListener('pointerdown', onPointer, true);
		};
	});

	function hasCheckedMulti(name: string): boolean {
		const curr = localDraft.data[name];
		return Array.isArray(curr) && curr.length > 0;
	}

	function isValidRasterDataUrl(src: string): boolean {
		return /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=\r\n]*$/i.test(src);
	}

	function isSectionNoteActive(fieldName: string): boolean {
		const ann = getAnnotation(fieldName);
		const err = mediaErrors[fieldName];
		return activeNoteFields.has(fieldName) || !!ann.note.trim() || ann.images.length > 0 || !!err;
	}

	function toggleSectionNote(fieldName: string) {
		if (activeNoteFields.has(fieldName)) {
			activeNoteFields.delete(fieldName);
		} else {
			activeNoteFields.add(fieldName);
		}
	}

	async function handleSubmit() {
		if (isBlocked) return;
		if (formEl && !formEl.reportValidity()) {
			return;
		}
		isSubmitting = true;
		try {
			const submission = buildAskFormSubmission(form.form, localDraft, 'submit');
			await onSubmit(submission);
		} finally {
			isSubmitting = false;
		}
	}

	async function handleDelegate() {
		if (isBlocked) return;
		isSubmitting = true;
		try {
			const submission = buildAskFormSubmission(form.form, localDraft, 'delegate');
			await onSubmit(submission);
		} finally {
			isSubmitting = false;
		}
	}

	function bindCardKeys(node: HTMLElement) {
		node.addEventListener('keydown', handleKeyDown);
		return {
			destroy() {
				node.removeEventListener('keydown', handleKeyDown);
			}
		};
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
			const tag = (e.target as HTMLElement | null)?.tagName;
			if (tag !== 'TEXTAREA') e.preventDefault();
		}
		if (e.key === 'Escape') {
			if (openName) {
				e.preventDefault();
				e.stopPropagation();
				closePicker();
				return;
			}
			if (onMinimize) {
				e.preventDefault();
				e.stopPropagation();
				onMinimize();
			}
			return;
		}
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			e.stopPropagation();
			void handleSubmit();
		}
	}
</script>

{#snippet renderSpans(spans: readonly FormSpan[])}
	{#each spans as span}
		{#if span.style === 'code'}
			<code>{span.text}</code>
		{:else if span.style === 'strong'}
			<strong>{span.text}</strong>
		{:else if span.style === 'em'}
			<em>{span.text}</em>
		{:else}
			{span.text}
		{/if}
	{/each}
{/snippet}

{#snippet choiceControl(
	field: FormChoiceField,
	opts: {
		value: string;
		other: boolean;
		checked: boolean;
		disabled: boolean;
		required: boolean;
		recommended: boolean;
		label: FormSpan[] | null;
	}
)}
	<label class="ask-opt" class:disabled={opts.disabled} class:selected={opts.checked}>
		<input
			class="sr-only choice-sr"
			type={field.multi ? 'checkbox' : 'radio'}
			name={field.name}
			value={opts.value}
			disabled={opts.disabled}
			required={opts.required}
			checked={opts.checked}
			tabindex={opts.other && opts.checked ? -1 : undefined}
			onchange={(e) => {
				if (opts.other) {
					if (field.multi) toggleOtherCheckbox(field.name, e.currentTarget.checked);
					else selectOtherRadio(field.name);
				} else if (field.multi) toggleCheckbox(field.name, opts.value, e.currentTarget.checked);
				else selectRadio(field.name, opts.value);
			}}
		/>
		{#if field.multi}
			<span class="choice-mark box" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.2 8.3 6.4 11.4 12.6 4.6" /></svg></span>
		{:else}
			<span class="choice-mark ring" aria-hidden="true"><span class="choice-dot"></span></span>
		{/if}
		<span class="ask-opt-body">
			{#if opts.other && opts.checked}
				<input
					class="other-inline"
					type="text"
					autocomplete="off"
					aria-label={m.chat_v2_ask_other()}
					value={localDraft.other[field.name]?.text ?? ''}
					required={field.multi ? field.required && !hasCheckedMulti(field.name) : field.required}
					use:focusNode
					onmousedown={(e) => e.stopPropagation()}
					onclick={(e) => e.stopPropagation()}
					oninput={(e) => setOtherText(field.name, e.currentTarget.value)}
				/>
			{:else}
				<span class="ask-opt-label">
					{#if opts.label}
						{@render renderSpans(opts.label)}
					{:else}
						{m.chat_v2_ask_other()}
					{/if}
					{#if opts.recommended}
						<span class="ask-rec">{m.chat_v2_ask_recommended()}</span>
					{/if}
				</span>
			{/if}
		</span>
	</label>
{/snippet}

<!-- Componente AskForm principale -->
<div
	class="ask-form-card"
	class:expanded
	class:compact
	role="region"
	aria-label={form.title || m.chat_v2_ask_title_single()}
	use:bindCardKeys
>
	<!-- Testata del modulo con titolo, azioni ed espansione -->
	<header class="form-head">
		<span class="head-icon" aria-hidden="true"><IconAsk /></span>
		<h2 class="head-title">{form.title || m.chat_v2_ask_title_single()}</h2>
		<div class="head-actions">
			<button
				type="button"
				class="head-btn"
				onclick={() => (expanded = !expanded)}
				title={expanded ? m.ask_form_collapse() : m.ask_form_expand()}
				aria-label={expanded ? m.ask_form_collapse() : m.ask_form_expand()}
			>
				{#if expanded}
					<IconChevronDown />
				{:else}
					<IconChevronUp />
				{/if}
			</button>
			{#if onMinimize}
				<button
					type="button"
					class="head-btn"
					onclick={() => onMinimize()}
					title={m.chat_v2_ask_minimize()}
					aria-label={m.chat_v2_ask_minimize()}
				>
					<IconClose />
				</button>
			{/if}
		</div>
	</header>

	<!-- Eventuale errore a livello di richiesta del modulo -->
	{#if form.error}
		<div class="form-banner-error" role="alert">
			<IconWarning aria-hidden="true" />
			<span>{form.error}</span>
		</div>
	{/if}

	<!-- Corpo del form compilabile con blocco invio implicito su Enter singolo -->
	<form
		bind:this={formEl}
		class="form-body"
		onsubmit={(e) => {
			e.preventDefault();
		}}
	>
		{#each form.form.sections as section, sIdx (sIdx)}
			{@const targetField = getFirstNamedField(section)}
			{@const ann = targetField ? getAnnotation(targetField) : null}
			{@const noteOpen = targetField ? isSectionNoteActive(targetField) : false}
			{@const sectionError = targetField ? mediaErrors[targetField] : undefined}
			{@const sectionLabel = section.title.length > 0 ? plain(section.title) : m.ask_form_section_default({ n: sIdx + 1 })}

			<section
				class="form-section"
				role="group"
				aria-label={sectionLabel}
				ondragover={(e) => e.preventDefault()}
				ondrop={(e) => {
					if (targetField) handleDropFiles(targetField, e);
				}}
				onpaste={(e) => {
					if (targetField) handlePasteFiles(targetField, e);
				}}
			>
				{#if section.title.length > 0}
					<h3 class="section-title">
						{@render renderSpans(section.title)}
					</h3>
				{:else if form.form.sections.length > 1}
					<h3 class="section-title">
						{m.ask_form_section_default({ n: sIdx + 1 })}
					</h3>
				{/if}

				<!-- Blocchi di contenuto e campi della sezione -->
				<div class="section-blocks">
					{#each section.blocks as block, bIdx (bIdx)}
						{#if block.kind === 'text'}
							{#if block.heading}
								<h4 class="block-heading">{@render renderSpans(block.spans)}</h4>
							{:else if recommendationBody(block.spans)}
								<div class="block-rec">
									<p class="block-rec-kicker">{m.ask_form_recommendation()}</p>
									<p>{@render renderSpans(recommendationBody(block.spans) ?? [])}</p>
								</div>
							{:else}
								<p class="block-text">{@render renderSpans(block.spans)}</p>
							{/if}
						{:else if block.kind === 'list'}
							{#if block.ordered}
								<ol class="block-list">
									{#each block.items as item, iIdx (iIdx)}
										<li>{@render renderSpans(item)}</li>
									{/each}
								</ol>
							{:else}
								<ul class="block-list">
									{#each block.items as item, iIdx (iIdx)}
										<li>{@render renderSpans(item)}</li>
									{/each}
								</ul>
							{/if}
						{:else if block.kind === 'pre'}
							<pre class="block-pre"><code>{block.text}</code></pre>
						{:else if block.kind === 'table'}
							<div class="block-table-wrapper">
								<table class="block-table">
									{#if block.headerRows > 0}
										<thead>
											{#each block.rows.slice(0, block.headerRows) as hRow, rIdx (rIdx)}
												<tr>
													{#each hRow as cell, cIdx (cIdx)}
														<th>{@render renderSpans(cell)}</th>
													{/each}
												</tr>
											{/each}
										</thead>
									{/if}
									<tbody>
										{#each block.rows.slice(block.headerRows) as bRow, rIdx (rIdx)}
											<tr>
												{#each bRow as cell, cIdx (cIdx)}
													<td>{@render renderSpans(cell)}</td>
												{/each}
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{:else if block.kind === 'image'}
							{#if isValidRasterDataUrl(block.src)}
								<div class="block-image-wrap">
									<img src={block.src} alt={block.alt} class="block-image" />
								</div>
							{:else}
								<div class="block-media-error" role="alert">
									<IconWarning aria-hidden="true" />
									<span>{m.ask_form_invalid_media()}</span>
								</div>
							{/if}
						{:else if block.kind === 'svg'}
							<div class="block-svg-wrap">
								<img
									src={`data:image/svg+xml;utf8,${encodeURIComponent(sanitizeSvg(block.markup))}`}
									alt={block.alt}
									class="block-svg-img"
								/>
							</div>
						{:else if block.kind === 'field'}
							{@const field = block.field}
							<div class="field-item">
								<label
									class="field-label"
									for={(field.kind === 'text' && field.type !== 'range') || (field.kind === 'choice' && field.select) ? `f_${field.name}` : undefined}
								>
									{@render renderSpans(field.label)}
									{#if field.required}
										<span class="field-req" aria-hidden="true">*</span>
									{/if}
									{#if field.kind === 'text' && field.type === 'range'}
										<span class="range-value">{localDraft.data[field.name] ?? field.value}</span>
									{/if}
								</label>

								{#if field.kind === 'choice'}
									{#if field.select}
										{@const otherOn = localDraft.other[field.name]?.enabled ?? false}
										<div class="picker-field" class:open={openName === field.name}>
											<input
												id={`f_${field.name}`}
												class="ui-input picker-face"
												readonly={field.multi || !otherOn}
												required={field.required}
												placeholder={otherOn && !field.multi ? '' : m.ask_form_select_placeholder()}
												aria-label={otherOn && !field.multi ? m.chat_v2_ask_other() : undefined}
												autocomplete="off"
												aria-haspopup="listbox"
												aria-expanded={openName === field.name}
												value={selectDisplay(field)}
												oninput={(e) => {
													if (!field.multi && otherOn) setOtherText(field.name, e.currentTarget.value);
												}}
												onclick={(e) => {
													if (!field.multi && otherOn) return;
													openPicker('select', field.name, e.currentTarget);
												}}
												onkeydown={(e) => {
													if ((field.multi || !otherOn) && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
														e.preventDefault();
														e.stopPropagation();
														openPicker('select', field.name, e.currentTarget);
													}
												}}
											/>
											<button
												type="button"
												class="picker-icon chev"
												aria-label={m.ask_form_select_placeholder()}
												onclick={(e) => {
													const face = e.currentTarget.parentElement?.querySelector('input');
													if (face instanceof HTMLElement) openPicker('select', field.name, face);
												}}
											><IconChevronDown /></button>
										</div>
										{#if field.multi && otherOn}
											<input
												class="ui-input other-follow"
												type="text"
												autocomplete="off"
												aria-label={m.chat_v2_ask_other()}
												value={localDraft.other[field.name]?.text ?? ''}
												required={field.required && !hasCheckedMulti(field.name)}
												use:focusNode
												oninput={(e) => setOtherText(field.name, e.currentTarget.value)}
											/>
										{/if}
									{:else}
										<div class="ask-options">
											{#each field.options as opt, optIdx (opt.value || optIdx)}
												{@render choiceControl(field, {
													value: opt.value,
													other: false,
													checked: isChoiceChecked(field.name, opt.value),
													disabled: opt.disabled,
													required: field.multi
														? optIdx === 0 && field.required && !hasCheckedMulti(field.name) && !(localDraft.other[field.name]?.enabled && localDraft.other[field.name]?.text.trim())
														: field.required && !localDraft.data[field.name] && !localDraft.other[field.name]?.enabled,
													recommended: opt.checked && sectionRecommends(section.blocks),
													label: opt.label
												})}
											{/each}
											{#if field.other}
												{@render choiceControl(field, {
													value: '__other__',
													other: true,
													checked: localDraft.other[field.name]?.enabled ?? false,
													disabled: false,
													required: !field.multi && field.required && !localDraft.data[field.name] && !localDraft.other[field.name]?.enabled,
													recommended: false,
													label: null
												})}
											{/if}
										</div>
									{/if}
								{:else if field.kind === 'text'}
									{#if field.multiline}
										<textarea
											id={`f_${field.name}`}
											name={field.name}
											class="ui-input field-textarea"
											rows={field.rows || 3}
											placeholder={field.placeholder || ''}
											required={field.required}
											minlength={field.minLength}
											maxlength={field.maxLength}
											value={localDraft.data[field.name] ?? ''}
											oninput={(e) => setTextValue(field.name, e.currentTarget.value)}
										></textarea>
									{:else if field.type === 'date'}
										<div class="picker-field" class:open={openName === field.name}>
											<input
												id={`f_${field.name}`}
												class="ui-input picker-face"
												readonly
												required={field.required}
												placeholder={m.ask_form_choose_date()}
												aria-haspopup="dialog"
												aria-expanded={openName === field.name}
												value={prettyDate(String(localDraft.data[field.name] ?? ''))}
												onclick={(e) => openPicker('date', field.name, e.currentTarget)}
												onkeydown={(e) => {
													if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
														e.preventDefault();
														e.stopPropagation();
														openPicker('date', field.name, e.currentTarget);
													}
												}}
											/>
											<span class="picker-icon" aria-hidden="true"><IconCalendar /></span>
										</div>
									{:else if field.type === 'range'}
										<Slider
											min={field.min ?? 0}
											max={field.max ?? 100}
											value={Number((localDraft.data[field.name] ?? field.value) || field.min || 0)}
											ariaLabel={plain(field.label)}
											onChange={(value) => setTextValue(field.name, String(value))}
										/>
									{:else}
										<input
											id={`f_${field.name}`}
											type={field.type || 'text'}
											name={field.name}
											class="ui-input field-input"
											placeholder={field.placeholder || ''}
											required={field.required}
											min={field.min}
											max={field.max}
											minlength={field.minLength}
											maxlength={field.maxLength}
											pattern={field.pattern}
											value={localDraft.data[field.name] ?? ''}
											oninput={(e) => setTextValue(field.name, e.currentTarget.value)}
										/>
									{/if}
								{/if}
							</div>
						{/if}
					{/each}
				</div>

				<!-- Sezione Note e Allegati opzionali legata al primo campo con nome -->
				{#if targetField && ann}
					<div class="section-note-dock">
						<button
							type="button"
							class="note-toggle-btn"
							onclick={() => toggleSectionNote(targetField)}
							aria-expanded={noteOpen}
						>
							{#if ann.note.trim() || ann.images.length > 0}
								<IconNote />
								<span class="note-btn-text">
									{m.ask_form_notes_title()}
									{#if ann.images.length > 0}
										({ann.images.length})
									{/if}
								</span>
							{:else}
								<IconPlus />
								<span class="note-btn-text">{m.ask_form_add_note_or_image()}</span>
							{/if}
						</button>

						{#if noteOpen}
							<div class="note-drawer">
								<textarea
									class="ui-input note-textarea"
									rows="2"
									placeholder={m.ask_note_placeholder()}
									value={ann.note}
									oninput={(e) => setNoteText(targetField, e.currentTarget.value)}
								></textarea>

								<!-- Area gestione allegati immagine -->
								{#if supportsImages}
									<div class="note-attach-bar">
										<label class="attach-file-btn">
											<input
												type="file"
												accept="image/png,image/jpeg,image/webp,image/gif"
												multiple
												class="hidden-file-input"
												onchange={(e) => {
													const files = Array.from(e.currentTarget.files || []);
													if (files.length > 0) void handleFilesUpload(targetField, files);
													e.currentTarget.value = '';
												}}
											/>
											<IconAttach />
											<span>{m.ask_attach_image()}</span>
										</label>

										{#if mediaPending > 0}
											<span class="prep-indicator text-shimmer">
												{m.ask_form_image_preparing()}
											</span>
										{/if}
									</div>

									{#if ann.images.length > 0}
										<div class="attach-thumbs-grid" role="list" aria-label={m.ask_images_aria()}>
											{#each ann.images as img, iIdx (iIdx)}
												<div role="listitem">
													<AttachmentThumb
														attachment={toAttachment(img, iIdx)}
														onRemove={() => removeImage(targetField, iIdx)}
														onOpen={() => hooks.openImage(img.data, img.mimeType)}
													/>
												</div>
											{/each}
										</div>
									{/if}
								{/if}

								<!-- Errore specifico per la sezione note/allegati con pulsante di rimozione esplicita -->
								{#if sectionError}
									<div class="section-error-banner" role="alert">
										<IconWarning aria-hidden="true" />
										<span class="error-msg">{sectionError}</span>
										<button
											type="button"
											class="error-dismiss-btn"
											onclick={() => clearFieldError(targetField)}
											title="Rimuovi errore"
											aria-label="Rimuovi errore"
										>
											<IconClose />
										</button>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</section>
		{/each}
	</form>

	{#if openField && openKind === 'select' && openField.kind === 'choice'}
		{@const entries = selectEntries(openField)}
		<div
			class="picker-pop"
			bind:this={popEl}
			role="listbox"
			aria-label={plain(openField.label)}
			tabindex="-1"
			onkeydown={(e) => {
				if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
					e.preventDefault();
					menuHi = (menuHi + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
				} else if (e.key === 'Enter') {
					e.preventDefault();
					const entry = entries[menuHi];
					if (entry && !entry.disabled && openField.kind === 'choice') pickSelect(openField, entry.value);
				} else if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					closePicker();
				}
			}}
		>
			{#each entries as entry, index (entry.value)}
				<button
					type="button"
					class="picker-row"
					class:on={selectOn(openField, entry.value)}
					class:hi={index === menuHi}
					role="option"
					aria-selected={selectOn(openField, entry.value)}
					disabled={entry.disabled}
					onclick={() => {
						if (openField.kind === 'choice') pickSelect(openField, entry.value);
					}}
				>
					{#if openField.multi}
						<span class="choice-mark box" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.2 8.3 6.4 11.4 12.6 4.6" /></svg></span>
					{/if}
					<span class="picker-grow">{entry.label}</span>
					{#if !openField.multi && selectOn(openField, entry.value)}
						<IconCheck />
					{/if}
				</button>
			{/each}
		</div>
	{:else if openField && openKind === 'date' && openField.kind === 'text'}
		{@const today = isoOf(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())}
		{@const selected = String(localDraft.data[openField.name] ?? '')}
		<div class="picker-pop cal" bind:this={popEl} role="dialog" aria-label={plain(openField.label)} tabindex="-1">
			<div class="cal-head">
				<button type="button" class="cal-nav" aria-label={m.ask_form_prev_month()} onclick={() => shiftMonth(-1)}>
					<IconChevronLeft />
				</button>
				<strong>{monthTitle(dateCursor.y, dateCursor.m)}</strong>
				<button type="button" class="cal-nav" aria-label={m.ask_form_next_month()} onclick={() => shiftMonth(1)}>
					<IconChevronRight />
				</button>
			</div>
			<div class="cal-grid">
				{#each weekdays as day, index (index)}
					<span class="cal-wd">{day}</span>
				{/each}
				{#each monthGrid(dateCursor.y, dateCursor.m) as cell (cell.iso + (cell.outside ? '-o' : ''))}
					<button
						type="button"
						class="cal-day"
						class:out={cell.outside}
						class:on={cell.iso === selected}
						class:today={cell.iso === today}
						aria-label={prettyDate(cell.iso)}
						aria-pressed={cell.iso === selected}
						onclick={() => {
							if (openField.kind === 'text') chooseDate(openField.name, cell.iso);
						}}
					>
						{cell.label}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Eventuale banner errore aggregato se presente un errore sui media non risolto -->
	{#if hasMediaErrors}
		<div class="form-banner-error" role="alert">
			<IconWarning aria-hidden="true" />
			<span>{Object.values(mediaErrors)[0]}</span>
		</div>
	{/if}

	<!-- Piede con azioni: Annulla, Decidi tu, Invia risposte -->
	<footer class="form-foot">
		<div class="foot-left">
			<button
				type="button"
				class="ui-button-secondary"
				disabled={isSubmitting}
				onclick={() => void onCancel()}
			>
				{m.ask_form_cancel()}
			</button>
			<button
				type="button"
				class="ui-button-ghost"
				disabled={isBlocked}
				onclick={() => void handleDelegate()}
				title={m.chat_v2_ask_decide_title()}
			>
				{m.chat_v2_ask_decide()}
			</button>
		</div>

		<div class="foot-right">
			<button
				type="button"
				class="ui-button-primary"
				disabled={isBlocked}
				onclick={() => void handleSubmit()}
			>
				<span>{m.ask_form_submit()}</span>
				<kbd class="ui-kbd">Ctrl+↵</kbd>
			</button>
		</div>
	</footer>
</div>

<style>
	.ask-form-card {
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-2xl);
		box-shadow: var(--shadow-raise);
		color: var(--ink);
		min-width: 0;
		max-height: 480px;
		transition: max-height var(--dur-slow) var(--ease-reveal);
	}
	.ask-form-card.expanded {
		max-height: min(85vh, 840px);
	}
	.ask-form-card.compact {
		max-height: 380px;
	}

	.form-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 10px 14px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}
	.head-icon {
		display: inline-flex;
		color: var(--ink-muted);
		--icon-size: 16px;
	}
	.head-title {
		margin: 0;
		font-size: var(--text-title);
		font-weight: 550;
		color: var(--ink);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.head-actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.head-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		width: 26px;
		height: 26px;
		cursor: pointer;
		--icon-size: 14px;
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}
	.head-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.form-banner-error {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		background: color-mix(in oklab, var(--danger) 12%, transparent);
		color: var(--danger);
		font-size: var(--text-caption);
		border-bottom: 1px solid color-mix(in oklab, var(--danger) 25%, transparent);
		flex-shrink: 0;
		--icon-size: 14px;
	}

	.form-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		overflow-y: auto;
		overflow-x: hidden;
		min-height: 0;
		flex: 1;
	}

	.form-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--line);
		transition: background var(--dur-fast) var(--ease-out);
	}
	.form-section:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.section-title {
		margin: 0;
		font-size: var(--text-chat);
		font-weight: 500;
		color: var(--ink);
		line-height: 1.45;
	}
	.section-blocks {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.block-heading {
		margin: var(--space-1) 0;
		font-size: var(--text-body);
		font-weight: 600;
		color: var(--ink);
	}
	.block-text {
		margin: 0;
		font-size: var(--text-body);
		line-height: 1.5;
		color: var(--ink-muted);
		max-width: 68ch;
	}
	.block-rec {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 8px;
	}
	.block-rec-kicker {
		margin: 0;
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink-faint);
	}
	.block-rec p {
		margin: 0;
		font-size: var(--text-chat);
		font-weight: 500;
		line-height: 1.45;
		color: var(--ink);
		max-width: 62ch;
	}
	.block-list {
		margin: 0;
		padding-left: 20px;
		font-size: var(--text-body);
		line-height: 1.45;
		color: var(--ink);
	}
	.block-pre {
		margin: 0;
		padding: 8px 12px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		color: var(--ink);
	}
	.block-table-wrapper {
		overflow-x: auto;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}
	.block-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-body);
		text-align: left;
	}
	.block-table th,
	.block-table td {
		padding: 6px 10px;
		border-bottom: 1px solid var(--line);
	}
	.block-table th {
		background: color-mix(in oklab, var(--bg-sunken) 80%, transparent);
		font-weight: 600;
		color: var(--ink);
	}
	.block-image-wrap {
		border-radius: var(--radius-md);
		overflow: hidden;
		border: 1px solid var(--line);
		max-width: 100%;
		display: inline-flex;
	}
	.block-image {
		max-width: 100%;
		max-height: 320px;
		object-fit: contain;
		display: block;
	}
	.block-media-error {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		background: color-mix(in oklab, var(--danger) 10%, transparent);
		border-radius: var(--radius-sm);
		color: var(--danger);
		font-size: var(--text-caption);
		--icon-size: 14px;
	}
	.block-svg-wrap {
		display: flex;
		justify-content: center;
		padding: 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		max-width: 100%;
		overflow: hidden;
	}
	.block-svg-img {
		max-width: 100%;
		height: auto;
		display: block;
	}

	.field-item {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 4px;
	}
	.field-label {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 100%;
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}
	.range-value {
		margin-left: auto;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}
	.field-req {
		color: var(--danger);
		font-weight: 600;
	}

	.ui-input {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: inherit;
		font-size: var(--text-body);
		padding: 6px 10px;
		min-width: 0;
		outline: none;
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	.ui-input:focus {
		border-color: var(--brand-ink);
	}
	.field-textarea {
		resize: vertical;
		min-height: 64px;
	}

	.ask-opt {
		position: relative;
	}
	.ask-opt:focus-within {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}
	.ask-opt.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.choice-mark {
		width: 18px;
		height: 18px;
		flex: 0 0 18px;
		margin-top: 1px;
		display: grid;
		place-items: center;
		border: 1.5px solid var(--ink-faint);
		background: var(--bg-sunken);
		transition: background-color 160ms var(--ease-out), border-color 160ms var(--ease-out);
	}
	.choice-mark.ring { border-radius: 50%; }
	.choice-mark.box { border-radius: var(--radius-sm); }
	.choice-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--on-brand);
		transform: scale(0);
		transition: transform 160ms var(--ease-out);
	}
	.ask-opt:has(.choice-sr:checked) .choice-mark,
	.picker-row.on .choice-mark {
		background: var(--brand);
		border-color: var(--brand);
	}
	.ask-opt:has(.choice-sr:checked) .choice-dot { transform: scale(1); }
	.choice-mark svg { width: 12px; height: 12px; color: var(--on-brand); }
	.choice-mark path {
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 14;
		stroke-dashoffset: 14;
		transition: stroke-dashoffset 160ms var(--ease-out);
	}
	.ask-opt:has(.choice-sr:checked) .choice-mark path,
	.picker-row.on .choice-mark path { stroke-dashoffset: 0; }
	.other-inline,
	.other-follow {
		width: 100%;
		border: 0;
		background: transparent;
		padding: 0;
		margin: 0;
		font: inherit;
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
		outline: none;
	}
	.other-follow {
		height: 30px;
		padding: 0 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		font-size: var(--text-body);
		font-weight: 400;
	}
	.other-follow:focus { border-color: var(--brand); }
	.picker-field { position: relative; }
	.picker-face {
		width: 100%;
		height: 30px;
		padding-right: 28px;
	}
	.picker-face:read-only { cursor: pointer; }
	.picker-face:not(:read-only) { cursor: text; }
	.picker-icon {
		position: absolute;
		right: 8px;
		top: 0;
		height: 30px;
		display: grid;
		place-items: center;
		color: var(--ink-muted);
		pointer-events: none;
		--icon-size: 15px;
	}
	button.picker-icon {
		width: 28px;
		right: 1px;
		border: 0;
		background: transparent;
		padding: 0;
		cursor: pointer;
		pointer-events: auto;
	}
	.picker-field.open .picker-icon.chev { transform: rotate(180deg); }
	.picker-icon.chev { transition: transform var(--dur-base) var(--ease-out); }
	.picker-pop {
		position: fixed;
		z-index: 40;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		padding: 4px;
		max-height: 280px;
		overflow: auto;
	}
	.picker-row {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 8px;
		text-align: left;
		border: 0;
		background: transparent;
		border-radius: var(--radius-md);
		padding: 7px 8px;
		font: inherit;
		font-size: var(--text-body);
		color: var(--ink);
		cursor: pointer;
	}
	.picker-row:hover,
	.picker-row.hi { background: var(--bg-hover); }
	.picker-row.on { background: var(--bg-active); }
	.picker-row:disabled { opacity: 0.5; cursor: not-allowed; }
	.picker-grow { flex: 1; min-width: 0; }
	.picker-row :global(svg) { --icon-size: 14px; }
	.cal { width: 280px; padding: 8px 8px 10px; }
	.cal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
	}
	.cal-head strong { font-size: var(--text-body); font-weight: 600; }
	.cal-nav {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		background: transparent;
		border: 0;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 14px;
	}
	.cal-nav:hover { background: var(--bg-hover); color: var(--ink); }
	.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
	.cal-wd {
		height: 24px;
		display: grid;
		place-items: center;
		color: var(--ink-faint);
		font-size: var(--text-caption);
	}
	.cal-day {
		height: 32px;
		border: 0;
		background: transparent;
		border-radius: var(--radius-md);
		font: inherit;
		font-size: var(--text-label);
		font-variant-numeric: tabular-nums;
		color: var(--ink);
		cursor: pointer;
	}
	.cal-day.out { color: var(--ink-faint); }
	.cal-day:hover:not(.on) { background: var(--bg-hover); }
	.cal-day.today:not(.on) { box-shadow: inset 0 0 0 1px var(--ink-faint); }
	.cal-day.on { background: var(--brand); color: var(--on-brand); font-weight: 600; }
	@media (prefers-reduced-motion: reduce) {
		.choice-dot,
		.choice-mark,
		.choice-mark path,
		.picker-icon.chev { transition: none; }
	}

	.section-note-dock {
		margin-top: 4px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.note-toggle-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		padding: 4px 8px;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 13px;
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}
	.note-toggle-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}
	.note-drawer {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 10px;
		background: color-mix(in oklab, var(--bg-sunken) 70%, transparent);
		border: 1px dashed var(--line);
		border-radius: var(--radius-md);
	}
	.note-textarea {
		width: 100%;
		resize: vertical;
		font-size: var(--text-caption);
	}
	.note-attach-bar {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.attach-file-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 3px 8px;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 13px;
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}
	.attach-file-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}
	.hidden-file-input {
		display: none;
	}
	.prep-indicator {
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}
	.attach-thumbs-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.section-error-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		background: color-mix(in oklab, var(--danger) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--danger) 25%, transparent);
		border-radius: var(--radius-sm);
		color: var(--danger);
		font-size: var(--text-caption);
		--icon-size: 14px;
	}
	.section-error-banner .error-msg {
		flex: 1;
		min-width: 0;
	}
	.error-dismiss-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--danger);
		cursor: pointer;
		padding: 2px;
		border-radius: var(--radius-sm);
		--icon-size: 12px;
	}
	.error-dismiss-btn:hover {
		background: color-mix(in oklab, var(--danger) 20%, transparent);
	}

	.form-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
		border-top: 1px solid var(--line);
		background: color-mix(in oklab, var(--bg-raised) 92%, var(--bg-base));
		border-radius: 0 0 var(--radius-2xl) var(--radius-2xl);
		flex-shrink: 0;
	}
	.foot-left,
	.foot-right {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.ui-button-primary,
	.ui-button-secondary,
	.ui-button-ghost {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border-radius: var(--radius-md);
		font-size: var(--text-caption);
		font-weight: 500;
		padding: 5px 14px;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
	}
	.ui-button-primary {
		background: var(--brand);
		color: var(--on-brand);
		border: 1px solid transparent;
	}
	.ui-button-primary:hover:not(:disabled) {
		opacity: 0.92;
	}
	.ui-button-primary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.ui-button-secondary {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--ink);
	}
	.ui-button-secondary:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.ui-button-secondary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.ui-button-ghost {
		background: transparent;
		border: 1px solid transparent;
		color: var(--ink-muted);
	}
	.ui-button-ghost:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}
	.ui-button-ghost:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.ui-kbd {
		background: color-mix(in oklab, var(--on-brand) 15%, transparent);
		color: inherit;
		border-radius: var(--radius-sm);
		padding: 1px 4px;
		font-size: 10px;
		font-family: var(--font-mono);
	}
</style>
