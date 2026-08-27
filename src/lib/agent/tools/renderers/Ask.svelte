<!--
  Renderer per il tool `ask`.

  Rappresenta le richieste interattive all'utente (scelte singole o multiple).
  Nel sommario mostra la domanda posta al modello/utente troncata su una riga.
  Nel corpo mostra la domanda per esteso, l'elenco delle opzioni disponibili con
  le relative descrizioni, l'indicatore di selezione per le scelte effettuate
  (selectedOptions) e l'indicazione se la selezione consentiva scelte multiple.
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
		IconRadio
	} from '$lib/icons';

	let { args, result, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));

	// `args.questions` e' la forma multi-domanda: la prima (unica finora nell'uso
	// reale) porta sia il testo sia le proprie opzioni, non condivise con `args.options`.
	const firstQuestion = $derived.by(() => {
		if (!Array.isArray(args.questions)) return null;
		return asRecord(args.questions[0]);
	});

	const question = $derived.by(() => {
		const fromDetails = str(details?.question);
		if (fromDetails) return fromDetails;
		const fromArgs = str(args.question) ?? str(args.prompt);
		if (fromArgs) return fromArgs;
		if (Array.isArray(args.questions)) {
			const first = args.questions[0];
			if (typeof first === 'string') return first;
			return str(firstQuestion?.question) ?? str(firstQuestion?.prompt) ?? '';
		}
		return '';
	});

	const isMulti = $derived(bool(details?.multi) ?? bool(args.multi) ?? false);
	const selectedList = $derived(strList(details?.selectedOptions));

	interface OptionItem {
		label: string;
		description?: string;
		selected: boolean;
	}

	const options = $derived.by<OptionItem[]>(() => {
		const rawOptions = details?.options ?? args.options ?? firstQuestion?.options;
		const rawDetails = recordList(details?.optionDetails ?? args.optionDetails);

		if (Array.isArray(rawOptions)) {
			return rawOptions.map((opt, idx) => {
				let label = '';
				let description: string | undefined = undefined;
				if (typeof opt === 'string') {
					label = opt;
					const matchingDetail = rawDetails[idx];
					if (matchingDetail) {
						description = str(matchingDetail.description);
					}
				} else {
					const rec = asRecord(opt);
					label = str(rec?.label) ?? str(rec?.text) ?? str(rec?.name) ?? `Opzione ${idx + 1}`;
					description = str(rec?.description);
				}
				const selected =
					selectedList.includes(label) || selectedList.includes(String(idx));
				return { label, description, selected };
			});
		}

		if (rawDetails.length > 0) {
			return rawDetails.map((det, idx) => {
				const label = str(det.label) ?? str(det.text) ?? `Opzione ${idx + 1}`;
				const description = str(det.description);
				const selected = selectedList.includes(label);
				return { label, description, selected };
			});
		}

		return [];
	});

	const textResult = $derived(resultText(result));
</script>

{#if view === 'summary'}
	<div class="ask-summary">
		<span class="question" title={question}>{question || 'Domanda'}</span>
		{#if selectedList.length > 0}
			<CountBadge text={selectedList.join(', ')} />
		{:else if isMulti}
			<CountBadge text="scelta multipla" muted />
		{/if}
	</div>
{:else}
	<div class="ask-body">
		{#if question}
			<div class="question-full">{question}</div>
		{/if}

		{#if isMulti}
			<div class="multi-hint">Scelta multipla consentita</div>
		{/if}

		{#if options.length > 0}
			<div class="options-list">
				{#each options as opt, i (opt.label + i)}
					<div class="option-row" class:selected={opt.selected}>
						<span class="mark" aria-hidden="true">
							{#if isMulti}
								{#if opt.selected}<IconCheckboxChecked />{:else}<IconCheckbox />{/if}
							{:else}
								{#if opt.selected}<IconRadioChecked />{:else}<IconRadio />{/if}
							{/if}
						</span>
						<div class="option-content">
							<span class="option-label">{opt.label}</span>
							{#if opt.description}
								<span class="option-desc">{opt.description}</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{:else if textResult}
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
		gap: var(--space-2);
		min-width: 0;
	}

	.question-full {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
		line-height: 1.4;
		user-select: text;
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
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		font-size: var(--text-sm);
	}

	.option-row.selected {
		border-color: var(--brand);
		background: var(--bg-hover);
	}

	.mark {
		--icon-size: 12px;
		display: inline-flex;
		align-items: center;
		color: var(--ink-faint);
		margin-top: 1px;
		flex-shrink: 0;
	}

	.selected .mark {
		color: var(--brand-ink);
	}

	.option-content {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.option-label {
		color: var(--ink);
		font-weight: 500;
		overflow-wrap: anywhere;
		user-select: text;
	}

	.option-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		overflow-wrap: anywhere;
		user-select: text;
	}
</style>
