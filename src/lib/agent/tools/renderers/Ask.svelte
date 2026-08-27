<!--
  Renderer per il tool `ask`.

  Rappresenta le richieste interattive all'utente (scelte singole o multiple,
  note allegate e sequenze multi-domanda).
  Nel sommario mostra la domanda (o il numero di domande) e la sintesi delle scelte.
  Nel corpo mostra ciascuna domanda per esteso con le opzioni contrassegnate
  ([✓]/[ ] o [●]/[○]), eventuali note dell'utente e risposte personalizzate.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		bool,
		recordList,
		resultText,
		str,
		strList,
		type ToolRenderProps
	} from '../types';
	import {
		IconCheckboxChecked,
		IconCheckbox,
		IconRadioChecked,
		IconRadio,
		IconNote
	} from '$lib/icons';

	let { args, result, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const textResult = $derived(resultText(result));

	// Estrazione note da stringa o dettagli
	function extractNoteFromLabel(label: string): { clean: string; note?: string } {
		const match = label.match(/^(.*?)\s*\((?:nota|note):\s*([^)]+)\)$/i);
		if (match) {
			return { clean: match[1].trim(), note: match[2].trim() };
		}
		return { clean: label };
	}

	interface RenderOption {
		label: string;
		cleanLabel: string;
		description?: string;
		selected: boolean;
		note?: string;
	}

	interface RenderQuestion {
		id: string;
		question: string;
		header?: string;
		multi: boolean;
		options: RenderOption[];
		selectedLabels: string[];
		note?: string;
		customInput?: string;
	}

	// Costruzione dell'elenco normalizzato di tutte le domande
	const questionsList = $derived.by<RenderQuestion[]>(() => {
		const rawResults = Array.isArray(details?.results) ? recordList(details?.results) : [];
		const rawArgsQuestions = Array.isArray(args.questions) ? recordList(args.questions) : [];

		if (rawResults.length > 0) {
			// Risultati multi-domanda completati
			return rawResults.map((res, idx) => {
				const id = str(res.id) ?? `q${idx + 1}`;
				const question = str(res.question) ?? `Domanda ${idx + 1}`;
				const isMulti = bool(res.multi) ?? false;
				const selectedList = strList(res.selectedOptions).map((s) => extractNoteFromLabel(s).clean);
				const rawOpts = res.options;
				const note = str(res.note);
				const customInput = str(res.customInput);

				const matchingArgQ = rawArgsQuestions[idx];
				const rawArgOpts = matchingArgQ ? recordList(matchingArgQ.options) : [];

				let opts: RenderOption[] = [];
				if (Array.isArray(rawOpts)) {
					opts = rawOpts.map((opt, oIdx) => {
						const labelStr = typeof opt === 'string' ? opt : str(asRecord(opt)?.label) ?? `Opzione ${oIdx + 1}`;
						const parsed = extractNoteFromLabel(labelStr);
						const desc = typeof opt === 'object' ? str(asRecord(opt)?.description) : str(rawArgOpts[oIdx]?.description);
						const selected = selectedList.includes(parsed.clean) || selectedList.includes(labelStr);
						return {
							label: labelStr,
							cleanLabel: parsed.clean,
							description: desc,
							selected,
							note: parsed.note
						};
					});
				}

				return {
					id,
					question,
					header: matchingArgQ ? str(matchingArgQ.header) : undefined,
					multi: isMulti,
					options: opts,
					selectedLabels: selectedList,
					note,
					customInput
				};
			});
		}

		if (rawArgsQuestions.length > 1) {
			// Più domande da argomenti ma singolo risultato o in corso
			return rawArgsQuestions.map((qRec, idx) => {
				const id = str(qRec.id) ?? `q${idx + 1}`;
				const question = str(qRec.question) ?? str(qRec.prompt) ?? `Domanda ${idx + 1}`;
				const isMulti = bool(qRec.multi) ?? false;
				const rawOpts = recordList(qRec.options);
				const selectedList = strList(details?.selectedOptions);

				const opts: RenderOption[] = rawOpts.map((opt) => {
					const label = str(opt.label) ?? str(opt.text) ?? '';
					const desc = str(opt.description);
					const selected = selectedList.includes(label);
					return {
						label,
						cleanLabel: label,
						description: desc,
						selected
					};
				});

				return {
					id,
					question,
					header: str(qRec.header),
					multi: isMulti,
					options: opts,
					selectedLabels: selectedList,
					note: str(details?.note),
					customInput: str(details?.customInput)
				};
			});
		}

		// Singola domanda standard
		const singleQText =
			str(details?.question) ??
			str(args.question) ??
			str(args.prompt) ??
			(rawArgsQuestions.length > 0 ? (str(rawArgsQuestions[0].question) ?? str(rawArgsQuestions[0].prompt) ?? '') : '');

		const isMulti = bool(details?.multi) ?? bool(args.multi) ?? false;
		const rawSelected = strList(details?.selectedOptions);
		const selectedList: string[] = [];
		let labelNote: string | undefined;

		for (const s of rawSelected) {
			const parsed = extractNoteFromLabel(s);
			selectedList.push(parsed.clean);
			if (parsed.note) labelNote = parsed.note;
		}

		const globalNote = str(details?.note) ?? labelNote;
		const customInput = str(details?.customInput);

		const rawOptions = details?.options ?? args.options ?? (rawArgsQuestions.length > 0 ? rawArgsQuestions[0].options : undefined);
		const rawDetails = recordList(details?.optionDetails ?? args.optionDetails);

		let options: RenderOption[] = [];
		if (Array.isArray(rawOptions)) {
			options = rawOptions.map((opt, idx) => {
				let label = '';
				let description: string | undefined;
				if (typeof opt === 'string') {
					label = opt;
					const matchingDetail = rawDetails[idx];
					if (matchingDetail) description = str(matchingDetail.description);
				} else {
					const rec = asRecord(opt);
					label = str(rec?.label) ?? str(rec?.text) ?? str(rec?.name) ?? `Opzione ${idx + 1}`;
					description = str(rec?.description);
				}
				const parsed = extractNoteFromLabel(label);
				const selected = selectedList.includes(parsed.clean) || selectedList.includes(label) || selectedList.includes(String(idx));
				return {
					label,
					cleanLabel: parsed.clean,
					description,
					selected,
					note: parsed.note
				};
			});
		}

		return [
			{
				id: 'q1',
				question: singleQText || 'Domanda agente',
				header: rawArgsQuestions.length > 0 ? str(rawArgsQuestions[0].header) : undefined,
				multi: isMulti,
				options,
				selectedLabels: selectedList,
				note: globalNote,
				customInput
			}
		];
	});

	// Sintesi complessiva per la vista summary
	const summaryAnswers = $derived.by<string[]>(() => {
		const resultArr: string[] = [];
		for (const q of questionsList) {
			if (q.customInput) {
				resultArr.push(`“${q.customInput}”`);
			} else if (q.selectedLabels.length > 0) {
				resultArr.push(q.selectedLabels.join(', '));
			}
		}
		return resultArr;
	});
</script>

{#if view === 'summary'}
	<div class="ask-summary">
		{#if questionsList.length > 1}
			<span class="question-count">{questionsList.length} domande</span>
		{:else if questionsList[0]?.question}
			<span class="question" title={questionsList[0].question}>{questionsList[0].question}</span>
		{:else}
			<span class="question">Domanda</span>
		{/if}

		{#if summaryAnswers.length > 0}
			<CountBadge text={summaryAnswers.join(' · ')} />
		{/if}
	</div>
{:else}
	<div class="ask-body">
		{#each questionsList as q, qIdx (q.id + qIdx)}
			<div class="question-block" class:multi-question={questionsList.length > 1}>
				{#if questionsList.length > 1}
					<div class="question-header">
						<span class="q-num">#{qIdx + 1}</span>
						<span class="question-full">{q.question}</span>
						{#if q.multi}
							<span class="multi-badge">scelta multipla</span>
						{/if}
					</div>
				{:else}
					{#if q.question}
						<div class="question-full">{q.question}</div>
					{/if}
					{#if q.multi}
						<div class="multi-hint">Scelta multipla consentita</div>
					{/if}
				{/if}

				{#if q.options.length > 0}
					<div class="options-list">
						{#each q.options as opt, i (opt.label + i)}
							<div class="option-row" class:selected={opt.selected}>
								<span class="mark" aria-hidden="true">
									{#if q.multi}
										{#if opt.selected}<IconCheckboxChecked />{:else}<IconCheckbox />{/if}
									{:else}
										{#if opt.selected}<IconRadioChecked />{:else}<IconRadio />{/if}
									{/if}
								</span>
								<div class="option-content">
									<div class="option-label-row">
										<span class="option-label">{opt.cleanLabel}</span>
										{#if opt.selected}
											<span class="selected-pill">Scelta</span>
										{/if}
									</div>
									{#if opt.description}
										<span class="option-desc">{opt.description}</span>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}

				{#if q.customInput}
					<div class="custom-answer-block">
						<span class="custom-label">Risposta personalizzata:</span>
						<span class="custom-text">“{q.customInput}”</span>
					</div>
				{/if}

				{#if q.note}
					<div class="note-block">
						<IconNote />
						<span class="note-content"><strong>Nota:</strong> {q.note}</span>
					</div>
				{/if}
			</div>
		{/each}

		{#if questionsList.length === 0 && textResult}
			<OutputBlock text={textResult} label="risposta" />
		{/if}
	</div>
{/if}

<style>
	.ask-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.question-count {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--brand);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px 6px;
	}

	.question {
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.ask-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}

	.question-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.question-block.multi-question {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
	}

	.question-header {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.q-num {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--brand);
	}

	.question-full {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
		line-height: 1.4;
		flex: 1;
		user-select: text;
	}

	.multi-badge {
		font-size: 10px;
		font-weight: 600;
		color: var(--accent);
		background: var(--accent-subtle, rgba(59, 130, 246, 0.1));
		border: 1px solid var(--accent);
		border-radius: var(--radius-sm);
		padding: 1px 5px;
		text-transform: uppercase;
		letter-spacing: 0.3px;
	}

	.multi-hint {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-style: italic;
	}

	.options-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.option-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		font-size: var(--text-sm);
		transition: border-color var(--dur-fast), background var(--dur-fast);
	}

	.option-row.selected {
		border-color: var(--brand);
		background: var(--bg-hover);
	}

	.mark {
		--icon-size: 13px;
		display: inline-flex;
		align-items: center;
		color: var(--ink-faint);
		margin-top: 2px;
		flex-shrink: 0;
	}

	.selected .mark {
		color: var(--brand);
	}

	.option-content {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.option-label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.option-label {
		color: var(--ink);
		font-weight: 500;
		overflow-wrap: anywhere;
		user-select: text;
	}

	.selected-pill {
		font-size: 10px;
		font-weight: 600;
		color: var(--brand);
		background: var(--brand-subtle, rgba(234, 88, 12, 0.1));
		border: 1px solid var(--brand);
		border-radius: var(--radius-sm);
		padding: 0 4px;
		text-transform: uppercase;
		letter-spacing: 0.3px;
	}

	.option-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		overflow-wrap: anywhere;
		user-select: text;
		line-height: 1.35;
	}

	.custom-answer-block {
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: var(--bg-raised);
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		font-size: var(--text-sm);
	}

	.custom-label {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		font-weight: 500;
	}

	.custom-text {
		color: var(--ink);
		font-style: italic;
		user-select: text;
	}

	.note-block {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: var(--accent-subtle, rgba(59, 130, 246, 0.08));
		border: 1px solid var(--accent);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink);
	}

	.note-content {
		user-select: text;
		overflow-wrap: anywhere;
	}
</style>
