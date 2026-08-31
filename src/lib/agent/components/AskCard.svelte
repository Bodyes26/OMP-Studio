<script lang="ts">
	// Card per richieste interattive dall'agente (ask: select, input, editor, confirm).
	// Supporta:
	// 1. Scelta singola (radio) e multipla (checkbox) con spunte chiare.
	// 2. Aggiunta note/specifiche alle risposte (tasto N o pulsante nota).
	// 3. Input personalizzato inline per "Altro (scrivi la tua risposta)".
	// 4. Stepper multi-domanda con navigazione libera (frecce sx/dx, tab) e
	//    schermata finale di riepilogo prima dell'invio definitivo.
	// 5. Countdown di scadenza e navigazione accessibile da tastiera: la lista
	//    opzioni e' un listbox con figli `option` e roving tabindex, quindi il
	//    focus reale segue le frecce e un solo elemento entra nel tab order.

	import { tick } from 'svelte';
	import {
		IconArrowLeft,
		IconArrowRight,
		IconCheck,
		IconCheckbox,
		IconCheckboxChecked,
		IconNote,
		IconRadio,
		IconRadioChecked,
		IconRename
	} from '$lib/icons';
	import type { AgentSession, AskQuestion, AskQuestionOption, PendingAsk } from '../session.svelte';
	import {
		cleanOptionLabel,
		firstUnansweredIndex,
		formatWizardAnswers,
		isDoneOption,
		isOtherOption,
		isQuestionAnswered,
		type AnswerableQuestion
	} from '../askAnswers';
	let { session, pending } = $props<{ session: AgentSession; pending: PendingAsk }>();

	// Prefisso unico per gli id ARIA: piu' sessioni possono avere una card
	// aperta insieme e gli id duplicati romperebbero aria-describedby.
	const uid = $props.id();

	// Struttura normalizzata per ogni domanda del wizard
	interface WizardOption {
		label: string;
		cleanLabel: string;
		description?: string;
		preview?: string;
		isRecommended: boolean;
		isOther: boolean;
		isDoneSentinel: boolean;
	}

	interface WizardQuestion extends AnswerableQuestion {
		id: string;
		question: string;
		header?: string;
		options: WizardOption[];
		recommended?: number;
		showNoteInput: boolean;
		cursorIndex: number;
	}


	// Scadenza con countdown
	let now = $state(Date.now());
	$effect(() => {
		if (!pending.deadline) return;
		const timer = setInterval(() => {
			now = Date.now();
		}, 500);
		return () => clearInterval(timer);
	});

	const remainingSeconds = $derived.by(() => {
		if (!pending.deadline) return null;
		const diff = Math.ceil((pending.deadline - now) / 1000);
		return diff > 0 ? diff : 0;
	});

	const showCountdown = $derived(remainingSeconds !== null && remainingSeconds > 0);

	// Parsing del titolo per estrarre eventuale contatore di round `(N selected)` o `(K/N)`
	const parsedTitle = $derived.by(() => {
		const raw = pending.title || '';
		const selectedMatch = raw.match(/^\((\d+\s+selected|\d+\s+selezionat[io]|[^)]+)\)\s*(.*)$/i);
		if (selectedMatch) {
			return {
				counter: selectedMatch[1].trim(),
				text: selectedMatch[2].trim() || raw
			};
		}
		const progMatch = raw.match(/\((\d+)\/(\d+)\)/);
		if (progMatch) {
			return {
				counter: `${progMatch[1]}/${progMatch[2]}`,
				text: raw.replace(/\(\d+\/\d+\)/, '').trim()
			};
		}
		return {
			counter: null,
			text: raw
		};
	});

	// Costruzione dello stato normalizzato delle domande
	let questions = $state<WizardQuestion[]>([]);
	let activeStep = $state(0); // 0..questions.length-1 sono le domande, questions.length è il Riepilogo
	let isReviewStep = $derived(questions.length > 1 && activeStep === questions.length);
	let currentQuestion = $derived<WizardQuestion | undefined>(questions[activeStep]);
	/** Vero quando la domanda corrente puo' essere considerata risposta. */
	const currentAnswered = $derived(
		currentQuestion ? isQuestionAnswered(currentQuestion) : false
	);
	/** Indice della prima domanda incompleta, per il riepilogo e l'invio. */
	const missingIndex = $derived(firstUnansweredIndex(questions));

	// Inizializzazione o aggiornamento delle domande al cambio di pendingUi
	$effect(() => {
		const rawQuestions = pending.questions;
		const rawOptions = pending.options ?? [];
		const rawDetails = pending.optionDetails ?? [];

		if (rawQuestions && rawQuestions.length > 0) {
			// Richiesta con lista strutturata completa di domande
			questions = rawQuestions.map((q: AskQuestion, qIdx: number) => {
				const opts: WizardOption[] = q.options.map((o: AskQuestionOption, oIdx: number) => {
					const clean = cleanOptionLabel(o.label);
					const isRec = o.label.endsWith(' (Recommended)') || q.recommended === oIdx;
					const isOth = isOtherOption(o.label);
					const isDone = isDoneOption(o.label);
					return {
						label: o.label,
						cleanLabel: clean,
						description: o.description,
						preview: o.preview,
						isRecommended: isRec,
						isOther: isOth,
						isDoneSentinel: isDone
					};
				});

				// Se non c'è l'opzione "Altro", aggiungiamola sinteticamente
				if (!opts.some((o) => o.isOther)) {
					opts.push({
						label: 'Other (type your own)',
						cleanLabel: 'Altro (scrivi la tua risposta)',
						description: 'Inserisci una risposta personalizzata',
						isRecommended: false,
						isOther: true,
						isDoneSentinel: false
					});
				}

				// Pre-selezione se consigliata per singola scelta
				const preselected = new Set<string>();
				const recIdx = q.recommended;
				if (!q.multi && typeof recIdx === 'number' && recIdx >= 0 && recIdx < opts.length && !opts[recIdx].isOther) {
					preselected.add(opts[recIdx].cleanLabel);
				}

				return {
					id: q.id || `q${qIdx + 1}`,
					question: q.question,
					header: q.header,
					options: opts,
					multi: q.multi === true,
					recommended: q.recommended,
					selectedOptions: preselected,
					note: '',
					showNoteInput: false,
					customInput: '',
					isCustom: false,
					touched: false,
					cursorIndex: typeof recIdx === 'number' && recIdx >= 0 ? recIdx : 0
				};
			});
			activeStep = 0;
		} else {
			// Fallback: singola domanda ricavata dai parametri immediati di pendingUi
			const isMulti = parsedTitle.counter !== null && /selected|selezionat/i.test(parsedTitle.counter || '');
			const opts: WizardOption[] = rawOptions.map((o: string, oIdx: number) => {
				const clean = cleanOptionLabel(o);
				const isRec = o.endsWith(' (Recommended)');
				const isOth = isOtherOption(o);
				const isDone = isDoneOption(o);
				return {
					label: o,
					cleanLabel: isOth ? 'Altro (scrivi la tua risposta)' : clean,
					description: rawDetails[oIdx]?.description,
					isRecommended: isRec,
					isOther: isOth,
					isDoneSentinel: isDone
				};
			});

			const preselected = new Set<string>();
			const recIdx = opts.findIndex((o) => o.isRecommended);
			if (!isMulti && recIdx >= 0 && !opts[recIdx].isOther) {
				preselected.add(opts[recIdx].cleanLabel);
			}

			questions = [
				{
					id: 'q1',
					question: parsedTitle.text || pending.title || 'Richiesta agente',
					header: undefined,
					options: opts,
					multi: isMulti,
					recommended: recIdx >= 0 ? recIdx : undefined,
					selectedOptions: preselected,
					note: '',
					showNoteInput: false,
					customInput: '',
					isCustom: false,
					touched: false,
					cursorIndex: recIdx >= 0 ? recIdx : 0
				}
			];
			activeStep = 0;
		}
	});

	// Riferimenti DOM ed input
	let cardEl = $state<HTMLElement | null>(null);
	let noteInputEl = $state<HTMLInputElement | null>(null);
	let customTextareaEl = $state<HTMLTextAreaElement | null>(null);
	let plainInputEl = $state<HTMLInputElement | null>(null);
	let plainEditorEl = $state<HTMLTextAreaElement | null>(null);

	let plainInputValue = $state('');
	let plainEditorValue = $state('');
	let submitting = $state(false);

	$effect(() => {
		const _id = pending.requestId;
		plainInputValue = pending.prefill ?? '';
		plainEditorValue = pending.prefill ?? '';
		submitting = false;

		if (pending.method === 'input' && plainInputEl) {
			plainInputEl.focus();
		} else if (pending.method === 'editor' && plainEditorEl) {
			plainEditorEl.focus();
		} else {
			cardEl?.focus();
		}
	});

	// Opzioni visibili per la domanda corrente (esclude sentinelle tecniche "Done selecting")
	const visibleOptions = $derived.by<WizardOption[]>(() => {
		if (!currentQuestion) return [];
		return currentQuestion.options.filter((o) => !o.isDoneSentinel);
	});

	/** Nome accessibile dell'opzione: "consigliata" deve stare nel nome, non
	 * solo nel badge colorato, altrimenti chi non vede il badge la perde. */
	function optionAccessibleName(opt: WizardOption): string {
		return opt.isRecommended ? `${opt.cleanLabel}, consigliata` : opt.cleanLabel;
	}

	// Riferimenti alle opzioni renderizzate: il focus reale deve seguire il
	// cursore, perche' uno screen reader annuncia solo l'elemento a fuoco.
	// Svelte azzera la casella quando l'elemento viene distrutto.
	let optionEls: (HTMLElement | null)[] = [];

	/** Porta cursore e focus reale sull'opzione `index`. Falso se non c'e'. */
	function focusOption(index: number): boolean {
		if (!currentQuestion) return false;
		const total = visibleOptions.length;
		if (total === 0) return false;
		const clamped = Math.min(Math.max(index, 0), total - 1);
		currentQuestion.cursorIndex = clamped;
		const el = optionEls[clamped];
		if (!el?.isConnected) return false;
		el.focus();
		return true;
	}

	/** Frecce su/giu': scorrimento circolare come nelle altre liste dell'app. */
	function moveCursor(delta: number) {
		if (!currentQuestion) return;
		const total = visibleOptions.length;
		if (total === 0) return;
		focusOption((currentQuestion.cursorIndex + delta + total) % total);
	}

	/** Selezione dall'indice: usata sia dal click sia dalla barra spaziatrice. */
	function selectAt(index: number) {
		const opt = visibleOptions[index];
		if (!opt) return;
		focusOption(index);
		toggleOption(opt);
	}

	// Gestione selezione opzioni
	function toggleOption(opt: WizardOption) {
		if (!currentQuestion) return;
		currentQuestion.touched = true;

		if (opt.isOther) {
			currentQuestion.isCustom = true;
			currentQuestion.selectedOptions.clear();
			setTimeout(() => customTextareaEl?.focus(), 50);
			return;
		}

		currentQuestion.isCustom = false;
		if (currentQuestion.multi) {
			if (currentQuestion.selectedOptions.has(opt.cleanLabel)) {
				currentQuestion.selectedOptions.delete(opt.cleanLabel);
			} else {
				currentQuestion.selectedOptions.add(opt.cleanLabel);
			}
		} else {
			currentQuestion.selectedOptions.clear();
			currentQuestion.selectedOptions.add(opt.cleanLabel);
		}
	}

	function toggleNoteInput() {
		if (!currentQuestion) return;
		currentQuestion.touched = true;
		currentQuestion.showNoteInput = !currentQuestion.showNoteInput;
		if (currentQuestion.showNoteInput) {
			setTimeout(() => noteInputEl?.focus(), 50);
		}
	}

	// Navigazione tra le domande
	async function goToStep(stepIndex: number) {
		if (stepIndex < 0 || stepIndex > questions.length) return;
		activeStep = stepIndex;
		if (currentQuestion && currentQuestion.cursorIndex >= visibleOptions.length) {
			currentQuestion.cursorIndex = 0;
		}
		// Le opzioni del passo precedente vengono distrutte: senza riportare il
		// focus dentro la card le scorciatoie da tastiera smetterebbero di
		// funzionare, perche' il gestore ascolta solo il focus interno.
		await tick();
		if (!focusOption(currentQuestion?.cursorIndex ?? 0)) cardEl?.focus();
	}

	function nextStep() {
		// Avanzare senza risposta significherebbe inviarne una inventata al
		// posto dell'utente: il passo resta dov'e'.
		if (!isReviewStep && !currentAnswered) return;
		if (activeStep < questions.length) {
			void goToStep(activeStep + 1);
		} else {
			void submitAllAnswers();
		}
	}

	function prevStep() {
		if (activeStep > 0) {
			void goToStep(activeStep - 1);
		}
	}

	/** Invio definitivo: solo con tutte le risposte davvero compilate. */
	async function submitAllAnswers() {
		if (submitting) return;
		const responses = formatWizardAnswers(questions);
		if (!responses) {
			// Porta l'utente sulla domanda che manca, invece di inviare a meta'.
			if (missingIndex >= 0) goToStep(missingIndex);
			return;
		}

		submitting = true;
		try {
			if (questions.length === 1 && !pending.questions) {
				// Richiesta singola immediata: una sola riga di risposta.
				await session.answerSelect(responses[0]);
			} else {
				await session.submitAskWizard(responses);
			}
		} finally {
			submitting = false;
		}
	}

	// Gestore tastiera unificato
	function handleCardKeydown(e: KeyboardEvent) {
		if (pending.method === 'confirm') {
			if (e.key === 'Enter') {
				e.preventDefault();
				void session.answerConfirm(true);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				void session.answerConfirm(false);
			}
			return;
		}

		if (pending.method === 'input' || pending.method === 'editor') {
			if (e.key === 'Escape') {
				e.preventDefault();
				void session.cancelPendingUi();
			}
			return;
		}

		// Non intercettiamo le frecce/spazio se l'utente sta scrivendo in un input o textarea
		const target = e.target as HTMLElement | null;
		const isInputActive = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

		if (isInputActive) {
			if (e.key === 'Escape') {
				e.preventDefault();
				target?.blur();
				cardEl?.focus();
			} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				if (isReviewStep || questions.length === 1) {
					void submitAllAnswers();
				} else {
					nextStep();
				}
			}
			return;
		}

		if (e.key === 'Escape') {
			e.preventDefault();
			void session.cancelPendingUi();
			return;
		}

		// Navigazione orizzontale tra le domande (← / →)
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			prevStep();
			return;
		}
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			nextStep();
			return;
		}

		// Tasto N per aprire/chiudere il campo nota
		if ((e.key === 'n' || e.key === 'N') && !isReviewStep && currentQuestion) {
			e.preventDefault();
			toggleNoteInput();
			return;
		}

		// Navigazione verticale opzioni (↑ / ↓): sposta anche il focus reale.
		if (e.key === 'ArrowUp' && currentQuestion) {
			e.preventDefault();
			moveCursor(-1);
			return;
		}
		if (e.key === 'ArrowDown' && currentQuestion) {
			e.preventDefault();
			moveCursor(1);
			return;
		}

		// Home / End: prima e ultima opzione dell'elenco.
		if (e.key === 'Home' && currentQuestion) {
			e.preventDefault();
			focusOption(0);
			return;
		}
		if (e.key === 'End' && currentQuestion) {
			e.preventDefault();
			focusOption(visibleOptions.length - 1);
			return;
		}

		// Spazio: seleziona o spunta l'opzione a fuoco.
		if (e.key === ' ' && currentQuestion) {
			e.preventDefault();
			selectAt(currentQuestion.cursorIndex);
			return;
		}

		// Invio: conferma la domanda singola oppure avanza nel wizard.
		if (e.key === 'Enter') {
			e.preventDefault();
			// Senza selezione vale l'opzione a fuoco: e' quella che l'utente sta
			// leggendo, non un ripiego scelto dal codice.
			const needsCursorPick =
				!!currentQuestion && currentQuestion.selectedOptions.size === 0 && !currentQuestion.isCustom;
			if (isReviewStep || (questions.length === 1 && !currentQuestion?.multi)) {
				if (questions.length === 1 && needsCursorPick && currentQuestion) {
					selectAt(currentQuestion.cursorIndex);
				}
				void submitAllAnswers();
			} else {
				if (needsCursorPick && currentQuestion) selectAt(currentQuestion.cursorIndex);
				nextStep();
			}
		}
	}
</script>

<svelte:window onkeydown={(e) => { if (cardEl && cardEl.contains(document.activeElement)) handleCardKeydown(e); }} />

<div
	class="ask-card"
	role="region"
	aria-label={parsedTitle.text || 'Richiesta agente'}
	tabindex="-1"
	bind:this={cardEl}
>
	<!-- Header con Stepper Multi-Domanda e Countdown -->
	<div class="header">
		{#if questions.length > 1}
			<nav class="stepper-bar" aria-label="Passaggi domande">
				{#each questions as q, idx}
					{@const isAnswered = isQuestionAnswered(q)}
					{@const isCurrent = activeStep === idx}
					<button
						type="button"
						class="step-pill"
						class:active={isCurrent}
						class:answered={isAnswered}
						onclick={() => void goToStep(idx)}
						title={q.question}
						aria-current={isCurrent ? 'step' : undefined}
						aria-label={`Domanda ${idx + 1} di ${questions.length}: ${q.header || q.question}, ${isAnswered ? 'completata' : 'ancora senza risposta'}`}
					>
						<span class="step-badge" aria-hidden="true">
							{#if isAnswered && !isCurrent}
								<IconCheck />
							{:else}
								{idx + 1}
							{/if}
						</span>
						<span class="step-label">{q.header || `Domanda ${idx + 1}`}</span>
						<!-- Lo stato non puo' vivere solo nell'icona: qui resta anche
						     come testo per chi legge la pillola a schermo. -->
						<span class="step-state" class:missing={!isAnswered}>
							{isAnswered ? 'ok' : 'da fare'}
						</span>
					</button>
				{/each}
				<button
					type="button"
					class="step-pill review-pill"
					class:active={isReviewStep}
					onclick={() => void goToStep(questions.length)}
					aria-current={isReviewStep ? 'step' : undefined}
					aria-label={missingIndex === -1
						? 'Riepilogo, tutte le risposte compilate'
						: `Riepilogo, manca la risposta alla domanda ${missingIndex + 1}`}
				>
					<span class="step-badge" aria-hidden="true">★</span>
					<span class="step-label">Riepilogo</span>
				</button>
			</nav>
		{/if}

		<div class="title-row">
			{#if parsedTitle.counter && questions.length <= 1}
				<span class="counter-badge">{parsedTitle.counter}</span>
			{/if}
			<h3 class="title-text" id={`${uid}-question`}>
				{#if isReviewStep}
					Riepilogo delle risposte
				{:else if currentQuestion}
					{currentQuestion.question}
				{:else}
					{parsedTitle.text}
				{/if}
			</h3>
			{#if showCountdown}
				<span class="deadline-badge">Scade tra {remainingSeconds}s</span>
			{/if}
		</div>

		{#if pending.message && !isReviewStep}
			<p class="message-text">{pending.message}</p>
		{/if}
	</div>

	<!-- Corpo Card -->
	<div class="body">
		{#if pending.method === 'select'}
			{#if isReviewStep}
				<!-- Vista Riepilogo Finale -->
				<div class="review-container">
					<p class="review-intro">Verifica le risposte selezionate prima di confermare:</p>
					<div class="review-list">
						{#each questions as q, idx}
							<div class="review-item">
								<div class="review-item-header">
									<span class="review-item-num">#{idx + 1}</span>
									<span class="review-item-q">{q.question}</span>
									<button
										type="button"
										class="btn-edit-step"
										onclick={() => void goToStep(idx)}
										title="Modifica questa risposta"
										aria-label={`Modifica la risposta alla domanda ${idx + 1}`}
									>
										<IconRename /> Modifica
									</button>
								</div>
								<div class="review-item-answer">
									{#if q.isCustom && q.customInput.trim()}
										<span class="answer-text custom">“{q.customInput.trim()}”</span>
									{:else if q.selectedOptions.size > 0}
										<div class="answer-tags">
											{#each Array.from(q.selectedOptions) as sel}
												<span class="answer-tag">{sel}</span>
											{/each}
										</div>
									{:else if isQuestionAnswered(q)}
										<span class="answer-text">Nessuna opzione: risposta "nessuna"</span>
									{:else}
										<span class="answer-empty">Risposta mancante: apri la domanda e scegli</span>
									{/if}
									{#if q.note.trim()}
										<div class="review-note">
											<IconNote />
											<span><strong>Nota:</strong> {q.note.trim()}</span>
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>

					{#if missingIndex !== -1}
						<!-- L'invio e' bloccato: il perche' va detto a parole, non solo
						     col pulsante disabilitato. -->
						<p class="review-warning" role="status">
							Manca la risposta alla domanda {missingIndex + 1}: aprila e scegli
							un'opzione prima di inviare.
						</p>
					{/if}

					<div class="actions review-actions">
						<button
							type="button"
							class="btn-cancel"
							onclick={() => session.cancelPendingUi()}
							title="Annulla richiesta (Esc)"
						>
							Annulla <span class="kbd">Esc</span>
						</button>
						<button
							type="button"
							class="btn-nav"
							onclick={() => prevStep()}
							title="Torna alla domanda precedente"
						>
							<IconArrowLeft /> Indietro
						</button>
						<button
							type="button"
							class="btn-submit"
							disabled={submitting || missingIndex !== -1}
							onclick={() => void submitAllAnswers()}
							title={missingIndex === -1
								? 'Invia tutte le risposte (Enter)'
								: `Manca la risposta alla domanda ${missingIndex + 1}`}
						>
							<IconCheck /> Invia tutte le risposte <span class="kbd">↵</span>
						</button>
					</div>
				</div>
			{:else if currentQuestion}
				<!-- Vista Domanda Corrente (Singola o Multipla) -->
				<div class="question-container">
					{#if currentQuestion.multi}
						<div class="multi-indicator">
							<span class="badge-multi">Scelta multipla</span>
							<span class="multi-hint">Usa Spazio o clicca per spuntare più opzioni</span>
						</div>
					{/if}

					<div
						class="options-list"
						role="listbox"
						aria-labelledby={`${uid}-question`}
						aria-multiselectable={currentQuestion.multi}
					>
						{#each visibleOptions as opt, i}
							{@const isSelected = currentQuestion.isCustom ? opt.isOther : currentQuestion.selectedOptions.has(opt.cleanLabel)}
							{@const isFocused = currentQuestion.cursorIndex === i}
							<!-- I figli di un listbox devono essere `option`, e un `option`
							     non puo' contenere controlli: nota e testo libero stanno
							     percio' sotto l'elenco, non dentro l'opzione. Roving
							     tabindex: solo l'opzione a fuoco entra nel tab order. -->
							<div
								bind:this={optionEls[i]}
								id={`${uid}-opt-${i}`}
								class="option-card"
								class:selected={isSelected}
								class:focused={isFocused}
								role="option"
								aria-selected={isSelected}
								aria-label={optionAccessibleName(opt)}
								aria-describedby={opt.description ? `${uid}-opt-${i}-desc` : undefined}
								tabindex={isFocused ? 0 : -1}
								onclick={() => selectAt(i)}
								onfocus={() => {
									if (currentQuestion) currentQuestion.cursorIndex = i;
								}}
								onkeydown={(e) => {
									// Lo spazio si ferma qui: il gestore della card agisce
									// sullo stesso indice e annullerebbe subito la spunta.
									if (e.key === ' ') {
										e.preventDefault();
										e.stopPropagation();
										selectAt(i);
									}
								}}
							>
								<div class="option-header">
									<span class="selection-icon" aria-hidden="true">
										{#if currentQuestion.multi}
											{#if isSelected}
												<span class="icon-checked"><IconCheckboxChecked /></span>
											{:else}
												<span class="icon-unchecked"><IconCheckbox /></span>
											{/if}
										{:else}
											{#if isSelected}
												<span class="icon-checked"><IconRadioChecked /></span>
											{:else}
												<span class="icon-unchecked"><IconRadio /></span>
											{/if}
										{/if}
									</span>

									<div class="option-titles">
										<span class="option-label">
											{opt.cleanLabel}
											{#if opt.isRecommended}
												<span class="recommended-badge">Consigliata</span>
											{/if}
										</span>
										{#if opt.description}
											<span class="option-desc" id={`${uid}-opt-${i}-desc`}>
												{opt.description}
											</span>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>

					{#if currentQuestion.isCustom}
						<!-- Testo libero dell'opzione "Altro": fuori dall'elenco, cosi'
						     resta un campo raggiungibile con Tab e con etichetta propria. -->
						<div class="custom-input-box">
							<label class="custom-label" for={`${uid}-custom`}>
								La tua risposta personalizzata
							</label>
							<textarea
								id={`${uid}-custom`}
								class="custom-textarea"
								placeholder="Scrivi qui la tua risposta personalizzata..."
								bind:value={currentQuestion.customInput}
								bind:this={customTextareaEl}
								rows="2"
							></textarea>
						</div>
					{/if}

					{#if !currentQuestion.showNoteInput &&
						!currentQuestion.note.trim() &&
						(currentQuestion.selectedOptions.size > 0 || currentQuestion.isCustom)}
						<div class="note-actions">
							<button
								type="button"
								class="btn-note-toggle"
								onclick={() => toggleNoteInput()}
								title="Aggiungi una nota alla risposta (N)"
							>
								<IconNote /> Aggiungi nota <span class="kbd">N</span>
							</button>
						</div>
					{/if}

					<!-- Campo Nota Espandibile -->
					{#if currentQuestion.showNoteInput}
						<div class="note-input-drawer">
							<div class="note-header">
								<span class="note-title"><IconNote /> Nota per la risposta:</span>
								<button
									type="button"
									class="btn-close-note"
									onclick={() => {
										if (currentQuestion) currentQuestion.showNoteInput = false;
									}}
									title="Chiudi campo nota"
								>
									Chiudi
								</button>
							</div>
							<input
								type="text"
								class="note-text-input"
								placeholder="Aggiungi dettagli, vincoli o specifiche opzionali..."
								bind:value={currentQuestion.note}
								bind:this={noteInputEl}
							/>
						</div>
					{:else if currentQuestion.note.trim()}
						<div class="note-preview-chip">
							<IconNote />
							<span class="note-text"><strong>Nota:</strong> {currentQuestion.note.trim()}</span>
							<button
								type="button"
								class="btn-edit-note-inline"
								onclick={() => toggleNoteInput()}
								title="Modifica nota"
							>
								Modifica
							</button>
						</div>
					{/if}

					<!-- Barra Azioni e Scorciatoie -->
					<div class="footer-row">
						<div class="shortcut-hints">
							<span><span class="kbd">↑</span> <span class="kbd">↓</span> sposta</span>
							<span><span class="kbd">Spazio</span> {currentQuestion.multi ? 'seleziona/deseleziona' : 'scegli'}</span>
							<span><span class="kbd">N</span> nota</span>
							{#if questions.length > 1}
								<span><span class="kbd">←</span> <span class="kbd">→</span> domande</span>
							{/if}
							<span><span class="kbd">Esc</span> annulla</span>
						</div>

						<div class="actions">
							<button
								type="button"
								class="btn-cancel"
								onclick={() => session.cancelPendingUi()}
								title="Annulla (Esc)"
							>
								Annulla <span class="kbd">Esc</span>
							</button>

							{#if activeStep > 0}
								<button
									type="button"
									class="btn-nav"
									onclick={() => prevStep()}
									title="Domanda precedente (←)"
								>
									<IconArrowLeft /> Indietro
								</button>
							{/if}

							{#if questions.length > 1}
								<button
									type="button"
									class="btn-submit"
									disabled={!currentAnswered}
									onclick={() => nextStep()}
									title={currentAnswered
										? 'Domanda successiva o riepilogo (Enter / →)'
										: 'Scegli una risposta per continuare'}
								>
									{#if activeStep === questions.length - 1}
										Riepilogo <IconArrowRight />
									{:else}
										Avanti <IconArrowRight />
									{/if}
								</button>
							{:else}
								<button
									type="button"
									class="btn-submit"
									disabled={submitting || !currentAnswered}
									onclick={() => void submitAllAnswers()}
									title={currentAnswered
										? 'Invia risposta (Enter)'
										: 'Scegli una risposta o scrivine una in "Altro"'}
								>
									Conferma <span class="kbd">↵</span>
								</button>
							{/if}
						</div>
					</div>
				</div>
			{/if}
		{:else if pending.method === 'input'}
			<div class="input-container">
				<input
					type="text"
					class="text-input"
					placeholder={pending.placeholder ?? ''}
					bind:value={plainInputValue}
					bind:this={plainInputEl}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							void session.answerSelect(plainInputValue);
						} else if (e.key === 'Escape') {
							e.preventDefault();
							void session.cancelPendingUi();
						}
					}}
				/>
				<div class="actions">
					<button
						type="button"
						class="btn-cancel"
						onclick={() => session.cancelPendingUi()}
						title="Annulla (Esc)"
					>
						Annulla <span class="kbd">Esc</span>
					</button>
					<button
						type="button"
						class="btn-submit"
						disabled={submitting}
						onclick={() => void session.answerSelect(plainInputValue)}
						title="Invia risposta (Enter)"
					>
						Invia <span class="kbd">↵</span>
					</button>
				</div>
			</div>
		{:else if pending.method === 'editor'}
			<div class="editor-container">
				<textarea
					class="editor-input"
					placeholder={pending.placeholder ?? ''}
					bind:value={plainEditorValue}
					bind:this={plainEditorEl}
					onkeydown={(e) => {
						if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
							e.preventDefault();
							void session.answerSelect(plainEditorValue);
						} else if (e.key === 'Escape') {
							e.preventDefault();
							void session.cancelPendingUi();
						}
					}}
				></textarea>
				<div class="actions">
					<button
						type="button"
						class="btn-cancel"
						onclick={() => session.cancelPendingUi()}
						title="Annulla (Esc)"
					>
						Annulla <span class="kbd">Esc</span>
					</button>
					<button
						type="button"
						class="btn-submit"
						disabled={submitting}
						onclick={() => void session.answerSelect(plainEditorValue)}
						title="Invia risposta (Ctrl+Enter)"
					>
						Invia <span class="kbd">Ctrl+↵</span>
					</button>
				</div>
			</div>
		{:else if pending.method === 'confirm'}
			<div class="confirm-container">
				<div class="actions">
					<button
						type="button"
						class="btn-cancel"
						onclick={() => session.answerConfirm(false)}
						title="Nega / Annulla (Esc)"
					>
						No <span class="kbd">Esc</span>
					</button>
					<button
						type="button"
						class="btn-submit"
						disabled={submitting}
						onclick={() => void session.answerConfirm(true)}
						title="Conferma (Enter)"
					>
						Sì <span class="kbd">↵</span>
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.ask-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		min-width: 0;
		outline: none;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}

	.ask-card:focus-within {
		border-color: var(--line-strong);
	}

	.header {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	/* Stepper a schede */
	.stepper-bar {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		overflow-x: auto;
		padding-bottom: var(--space-1);
		border-bottom: 1px solid var(--line);
	}

	.step-pill {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 3px 8px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		cursor: pointer;
		white-space: nowrap;
		transition: background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast);
	}

	.step-pill:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.step-pill.active {
		background: var(--bg-hover);
		border-color: var(--brand);
		color: var(--ink);
		font-weight: 600;
	}

	.step-pill.answered:not(.active) {
		border-color: var(--success, #10b981);
		color: var(--ink);
	}

	.step-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-mono);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}

	.review-pill {
		margin-left: auto;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.counter-badge {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 2px 6px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
	}

	.title-text {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
		flex: 1;
		min-width: 140px;
		line-height: 1.35;
	}

	.deadline-badge {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 2px 6px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--warn);
		margin-left: auto;
	}

	.message-text {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.question-container {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.multi-indicator {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.badge-multi {
		background: var(--accent-subtle, rgba(59, 130, 246, 0.1));
		color: var(--accent);
		border: 1px solid var(--accent);
		border-radius: var(--radius-sm);
		padding: 1px 6px;
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.multi-hint {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	/* Lista Opzioni */
	.options-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-height: 320px;
		overflow-y: auto;
		min-width: 0;
	}

	.option-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast);
		user-select: none;
	}

	.option-card:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.option-card.focused {
		outline: 1px solid var(--brand);
	}

	.option-card.selected {
		border-color: var(--brand);
		background: var(--bg-hover);
	}

	.option-header {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		min-width: 0;
	}

	.selection-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-top: 1px;
		flex-shrink: 0;
	}

	.icon-checked {
		color: var(--brand);
	}

	.icon-unchecked {
		color: var(--ink-faint);
	}

	.option-titles {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.option-label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
	}

	.recommended-badge {
		background: var(--brand-subtle, rgba(234, 88, 12, 0.12));
		color: var(--brand);
		border: 1px solid var(--brand);
		border-radius: var(--radius-sm);
		padding: 1px 5px;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.3px;
	}

	.option-desc {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		margin-top: 2px;
		line-height: 1.35;
	}

	.btn-note-toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: transparent;
		border: 1px dashed var(--line);
		border-radius: var(--radius-sm);
		padding: 2px 6px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		cursor: pointer;
		margin-left: auto;
		flex-shrink: 0;
		transition: all var(--dur-fast);
	}

	.btn-note-toggle:hover {
		background: var(--bg-sunken);
		color: var(--ink);
		border-color: var(--brand);
	}


	/* Textarea per opzione "Altro" */
	.custom-input-box {
		margin-top: var(--space-1);
		padding-top: var(--space-1);
		border-top: 1px dashed var(--line);
	}

	.custom-textarea {
		width: 100%;
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		font-size: var(--text-sm);
		font-family: var(--font-ui);
		color: var(--ink);
		resize: vertical;
	}

	.custom-textarea:focus {
		border-color: var(--brand);
		outline: none;
	}

	/* Drawer Campo Nota */
	.note-input-drawer {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		animation: slideDown 150ms ease-out;
	}

	.note-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.note-title {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-weight: 500;
	}

	.btn-close-note {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		cursor: pointer;
		padding: 0 4px;
	}

	.btn-close-note:hover {
		color: var(--ink);
	}

	.note-text-input {
		width: 100%;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
		font-family: var(--font-ui);
		color: var(--ink);
	}

	.note-text-input:focus {
		border-color: var(--brand);
		outline: none;
	}

	.note-preview-chip {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.note-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.btn-edit-note-inline {
		background: transparent;
		border: none;
		color: var(--brand);
		font-size: var(--text-xs);
		cursor: pointer;
		padding: 0 4px;
	}

	/* Vista Riepilogo */
	.review-container {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.review-intro {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.review-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-height: 320px;
		overflow-y: auto;
	}

	.review-item {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
	}

	.review-item-header {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.review-item-num {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--brand);
	}

	.review-item-q {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
		flex: 1;
	}

	.btn-edit-step {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 2px 6px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		cursor: pointer;
	}

	.btn-edit-step:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--brand);
	}

	.review-item-answer {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding-left: var(--space-3);
	}

	.answer-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.answer-tag {
		background: var(--bg-hover);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		padding: 1px 6px;
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink);
	}

	.answer-text.custom {
		font-style: italic;
		color: var(--ink);
		font-size: var(--text-sm);
	}

	.answer-empty {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-style: italic;
	}

	.review-note {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 2px 6px;
		margin-top: 2px;
	}

	/* Footer e Pulsanti */
	.footer-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-top: var(--space-1);
		padding-top: var(--space-2);
		border-top: 1px solid var(--line);
	}

	.shortcut-hints {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.input-container,
	.editor-container {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.text-input {
		width: 100%;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-sm);
		font-family: var(--font-ui);
		color: var(--ink);
		transition: border-color var(--dur-fast);
	}

	.text-input:focus {
		border-color: var(--brand);
		outline: none;
	}

	.editor-input {
		width: 100%;
		min-height: 100px;
		resize: vertical;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		color: var(--ink);
		transition: border-color var(--dur-fast);
	}

	.editor-input:focus {
		border-color: var(--brand);
		outline: none;
	}

	.confirm-container {
		display: flex;
		justify-content: flex-end;
		min-width: 0;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-left: auto;
	}

	button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-cancel {
		background: var(--bg-hover);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.btn-cancel:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.btn-nav {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink);
	}

	.btn-nav:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.btn-submit {
		background: var(--brand);
		border: 1px solid var(--brand);
		color: var(--on-brand);
		font-weight: 600;
	}

	.btn-submit:hover {
		background: var(--brand-dim);
		border-color: var(--brand-dim);
	}

	.btn-submit:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.kbd {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		opacity: 0.75;
	}

	@keyframes slideDown {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
