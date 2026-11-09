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
		IconCheck,
		IconChevronDown,
		IconChevronUp,
		IconClose,
		IconNote,
		IconPlus,
		IconWarning
	} from '#lib/icons.ts';
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

	// Bozza locale reattiva per commit sincrono e protezione da corse asincrone
	let localDraft = $state<AskFormDraft>(copyAskFormDraft(draft));

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

	function handleSelect(name: string, isMulti: boolean, e: Event) {
		const sel = e.currentTarget as HTMLSelectElement;
		const cloned = copyAskFormDraft(localDraft);
		if (isMulti) {
			const values = Array.from(sel.selectedOptions).map((o) => o.value);
			const hasOther = values.includes('__other__');
			cloned.data[name] = values.filter((v) => v !== '__other__');
			if (cloned.other[name]) {
				cloned.other[name].enabled = hasOther;
			} else if (hasOther) {
				cloned.other[name] = { enabled: true, text: '' };
			}
		} else {
			const val = sel.value;
			if (val === '__other__') {
				cloned.data[name] = '';
				if (!cloned.other[name]) cloned.other[name] = { enabled: true, text: '' };
				else cloned.other[name].enabled = true;
			} else {
				cloned.data[name] = val;
				if (cloned.other[name]) cloned.other[name].enabled = false;
			}
		}
		commitDraft(cloned);
	}

	function isChoiceChecked(name: string, val: string): boolean {
		const curr = localDraft.data[name];
		if (Array.isArray(curr)) return curr.includes(val);
		return curr === val && !localDraft.other[name]?.enabled;
	}

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

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
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

<!-- Componente AskForm principale -->
<div
	class="ask-form-card"
	class:expanded
	class:compact
	role="region"
	aria-label={form.title || m.chat_v2_ask_title_single()}
	onkeydown={handleKeyDown}
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
		onkeydown={(e) => {
			if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
				const tag = (e.target as HTMLElement | null)?.tagName;
				if (tag !== 'TEXTAREA') {
					e.preventDefault();
				}
			}
		}}
	>
		{#each form.form.sections as section, sIdx (sIdx)}
			{@const targetField = getFirstNamedField(section)}
			{@const ann = targetField ? getAnnotation(targetField) : null}
			{@const noteOpen = targetField ? isSectionNoteActive(targetField) : false}
			{@const sectionError = targetField ? mediaErrors[targetField] : undefined}

			<section
				class="form-section"
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
								<label class="field-label" for={`f_${field.name}`}>
									{@render renderSpans(field.label)}
									{#if field.required}
										<span class="field-req" aria-hidden="true">*</span>
									{/if}
								</label>

								{#if field.kind === 'choice'}
									{#if field.select}
										<!-- Controllo Select nativo -->
										<div class="select-wrap">
											<select
												id={`f_${field.name}`}
												name={field.name}
												class="ui-select"
												multiple={field.multi}
												required={field.required}
												onchange={(e) => handleSelect(field.name, field.multi, e)}
											>
												{#if !field.multi}
													<option value="" disabled selected={!localDraft.data[field.name] && !localDraft.other[field.name]?.enabled}>
														{m.ask_form_select_placeholder()}
													</option>
												{/if}
												{#each field.options as opt}
													<option
														value={opt.value}
														disabled={opt.disabled}
														selected={isChoiceChecked(field.name, opt.value)}
													>
														{opt.label.map((s) => s.text).join('')}
													</option>
												{/each}
												{#if field.other}
													<option value="__other__" selected={localDraft.other[field.name]?.enabled ?? false}>
														{m.chat_v2_ask_other()}
													</option>
												{/if}
											</select>
										</div>
										{#if field.other && localDraft.other[field.name]?.enabled}
											<input
												type="text"
												class="ui-input other-text-input"
												placeholder={m.ask_form_other_placeholder()}
												value={localDraft.other[field.name]?.text ?? ''}
												required={field.required}
												oninput={(e) => setOtherText(field.name, e.currentTarget.value)}
											/>
										{/if}
									{:else if field.multi}
										<!-- Checkbox multipli: required SOLO sulla prima checkbox e solo se niente è selezionato -->
										<div class="choice-group">
											{#each field.options as opt, optIdx (opt.value || optIdx)}
												<label class="choice-label" class:disabled={opt.disabled}>
													<input
														type="checkbox"
														name={field.name}
														value={opt.value}
														disabled={opt.disabled}
														required={optIdx === 0 && field.required && !hasCheckedMulti(field.name) && !(localDraft.other[field.name]?.enabled && localDraft.other[field.name]?.text.trim())}
														checked={isChoiceChecked(field.name, opt.value)}
														onchange={(e) => toggleCheckbox(field.name, opt.value, e.currentTarget.checked)}
													/>
													<span class="choice-text">{@render renderSpans(opt.label)}</span>
												</label>
											{/each}
											{#if field.other}
												<label class="choice-label">
													<input
														type="checkbox"
														checked={localDraft.other[field.name]?.enabled ?? false}
														onchange={(e) => toggleOtherCheckbox(field.name, e.currentTarget.checked)}
													/>
													<span class="choice-text">{m.chat_v2_ask_other()}</span>
												</label>
												{#if localDraft.other[field.name]?.enabled}
													<input
														type="text"
														class="ui-input other-text-input"
														placeholder={m.ask_form_other_placeholder()}
														value={localDraft.other[field.name]?.text ?? ''}
														required={field.required && !hasCheckedMulti(field.name)}
														oninput={(e) => setOtherText(field.name, e.currentTarget.value)}
													/>
												{/if}
											{/if}
										</div>
									{:else}
										<!-- Radio singoli -->
										<div class="choice-group">
											{#each field.options as opt, optIdx (opt.value || optIdx)}
												<label class="choice-label" class:disabled={opt.disabled}>
													<input
														type="radio"
														name={field.name}
														value={opt.value}
														disabled={opt.disabled}
														required={field.required && !localDraft.data[field.name] && !localDraft.other[field.name]?.enabled}
														checked={isChoiceChecked(field.name, opt.value)}
														onchange={() => selectRadio(field.name, opt.value)}
													/>
													<span class="choice-text">{@render renderSpans(opt.label)}</span>
												</label>
											{/each}
											{#if field.other}
												<label class="choice-label">
													<input
														type="radio"
														name={field.name}
														value="__other__"
														required={field.required && !localDraft.data[field.name] && !localDraft.other[field.name]?.enabled}
														checked={localDraft.other[field.name]?.enabled ?? false}
														onchange={() => selectOtherRadio(field.name)}
													/>
													<span class="choice-text">{m.chat_v2_ask_other()}</span>
												</label>
												{#if localDraft.other[field.name]?.enabled}
													<input
														type="text"
														class="ui-input other-text-input"
														placeholder={m.ask_form_other_placeholder()}
														value={localDraft.other[field.name]?.text ?? ''}
														required={field.required}
														oninput={(e) => setOtherText(field.name, e.currentTarget.value)}
													/>
												{/if}
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
		font-size: var(--text-body);
		font-weight: 600;
		color: var(--ink);
		line-height: 1.4;
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
		line-height: 1.45;
		color: var(--ink);
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
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}
	.field-req {
		color: var(--danger);
		font-weight: 600;
	}

	.ui-input,
	.ui-select {
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
	.ui-input:focus,
	.ui-select:focus {
		border-color: var(--brand-ink);
	}
	.field-textarea {
		resize: vertical;
		min-height: 64px;
	}
	.select-wrap {
		display: flex;
		flex-direction: column;
	}

	.choice-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.choice-label {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 6px 8px;
		border-radius: var(--radius-md);
		background: color-mix(in oklab, var(--bg-sunken) 50%, transparent);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out);
		user-select: none;
	}
	.choice-label:hover {
		background: var(--bg-hover);
	}
	.choice-label.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.choice-label input[type='radio'],
	.choice-label input[type='checkbox'] {
		accent-color: var(--brand);
		margin-top: 2px;
		cursor: inherit;
	}
	.choice-text {
		font-size: var(--text-label);
		line-height: 1.4;
		color: var(--ink);
	}
	.other-text-input {
		margin-left: 24px;
		margin-top: 4px;
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
