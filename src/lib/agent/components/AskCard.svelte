<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Scheda domanda v2 (Gate R32 C17): compatta, al posto del composer.
	// Una domanda per volta con stepper, scelta 1…N, consigliata, multipla,
	// "Altro…" in linea, nota (N), anteprima al passaggio del mouse,
	// "Decidi tu" (testo libero convenzionale in `askAnswers.ts`), avanti/
	// indietro/invia con conferma esplicita e conto alla rovescia del timeout.
	// Il protocollo resta sequenziale: il
	// wizard copre solo le domande ancora da chiedere (`pending.questionIndex`
	// in avanti) e consegna tutto in un piano via `buildFlushPlan`, un passo
	// per richiesta. `Escape` riduce la scheda nel vassoio quando il genitore
	// fornisce `onMinimize`, altrimenti annulla come prima. Nessuna risposta
	// parte prima della richiesta di omp: l'invio richiede domande davvero
	// compilate (`isQuestionAnswered`).

	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { traceFocus } from '$lib/focusTracer';
	import {
		IconArrowLeft,
		IconArrowRight,
		IconAsk,
		IconCheck,
		IconChevronDown,
		IconNote,
		IconPlus,
		IconRename
	} from '$lib/icons';
	import type { AgentSession, PendingAsk } from '../session.svelte';
	import {
		buildFlushPlan,
		cleanOptionLabel,
		firstUnansweredIndex,
		isDoneOption,
		isOtherOption,
		isQuestionAnswered,
		type AnswerableQuestion,
		type AskFlushStep,
		type AskQuestion,
		type AskQuestionOption
	} from '../askAnswers';
	import { parseAskTitle, sanitizeAskDetail } from '../askTitle';
	import { shouldAutoFocusAskCard } from '../askFocus';
	import { promptBus } from '../promptBus';

	let {
		session,
		pending,
		visible = true,
		onMinimize
	} = $props<{
		session: AgentSession;
		pending: PendingAsk;
		visible?: boolean;
		onMinimize?: () => void;
	}>();

	// Prefisso unico per gli id ARIA: piu' sessioni possono avere una card
	// aperta insieme e gli id duplicati romperebbero aria-describedby.
	const uid = $props.id();

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
		/** Numero nella sequenza completa di omp (1-based). */
		number: number;
		/**
		 * Le mutazioni di un `Set` normale sono invisibili alla reattivita'
		 * di Svelte: con un `Set` la spunta non si aggiornava dopo il primo clic.
		 */
		selectedOptions: SvelteSet<string>;
	}

	// Scadenza con countdown: oltre, omp risolve da se' al default e la
	// scheda si chiude da sola come prima (nessun invio dal client).
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

	const parsedTitle = $derived(parseAskTitle(pending.title));
	const detailMessage = $derived(sanitizeAskDetail(pending.message));
	const askedNumber = $derived(Math.max((pending.questionIndex ?? 0) + 1, 1));
	const askedTotal = $derived(Math.max(pending.totalQuestions ?? 1, askedNumber));

	function initWizardQuestions(): WizardQuestion[] {
		const rawQuestions = pending.questions;
		const rawOptions = pending.options ?? [];
		const rawDetails = pending.optionDetails ?? [];
		const baseStart =
			rawQuestions && rawQuestions.length > 0
				? Math.min(Math.max(pending.questionIndex ?? 0, 0), rawQuestions.length - 1)
				: 0;

		if (rawQuestions && rawQuestions.length > 0) {
			return rawQuestions.slice(baseStart).map((q: AskQuestion, qIdx: number) => {
				const opts: WizardOption[] = q.options.map((o: AskQuestionOption, oIdx: number) => {
					const clean = cleanOptionLabel(o.label);
					const isRec = o.label.endsWith(' (Recommended)') || q.recommended === oIdx;
					return {
						label: o.label,
						cleanLabel: clean,
						description: o.description,
						preview: o.preview,
						isRecommended: isRec,
						isOther: isOtherOption(o.label),
						isDoneSentinel: isDoneOption(o.label)
					};
				});

				if (!opts.some((o) => o.isOther)) {
					opts.push({
						label: 'Other (type your own)',
						cleanLabel: m.chat_v2_ask_other(),
						description: m.chat_v2_ask_other_hint(),
						isRecommended: false,
						isOther: true,
						isDoneSentinel: false
					});
				}

				const preselected = new SvelteSet<string>();
				const recIdx = q.recommended;
				if (!q.multi && typeof recIdx === 'number' && recIdx >= 0 && recIdx < opts.length && !opts[recIdx].isOther) {
					preselected.add(opts[recIdx].cleanLabel);
				}

				return {
					id: q.id || `q${baseStart + qIdx + 1}`,
					question: q.question,
					header: q.header,
					number: baseStart + qIdx + 1,
					options: opts,
					multi: q.multi === true,
					recommended: q.recommended,
					selectedOptions: preselected,
					note: '',
					decideForMe: false,
					showNoteInput: false,
					customInput: '',
					isCustom: false,
					touched: false,
					visited: qIdx === 0,
					cursorIndex: typeof recIdx === 'number' && recIdx >= 0 ? recIdx : 0
				};
			});
		}

		const isMulti = parsedTitle.counter !== null && /selected|selezionat/i.test(parsedTitle.counter || '');
		const opts: WizardOption[] = rawOptions.map((o: string, oIdx: number) => {
			const clean = cleanOptionLabel(o);
			const isOth = isOtherOption(o);
			return {
				label: o,
				cleanLabel: isOth ? m.chat_v2_ask_other() : clean,
				description: isOth
					? (rawDetails[oIdx]?.description ?? m.chat_v2_ask_other_hint())
					: rawDetails[oIdx]?.description,
				isRecommended: o.endsWith(' (Recommended)'),
				isOther: isOth,
				isDoneSentinel: isDoneOption(o)
			};
		});

		const preselected = new SvelteSet<string>();
		const recIdx = opts.findIndex((o) => o.isRecommended);
		if (!isMulti && recIdx >= 0 && !opts[recIdx].isOther) {
			preselected.add(opts[recIdx].cleanLabel);
		}

		return [
			{
				id: 'q1',
				question: parsedTitle.text || pending.title,
				header: undefined,
				number: askedNumber,
				options: opts,
				multi: isMulti,
				recommended: recIdx >= 0 ? recIdx : undefined,
				selectedOptions: preselected,
				note: '',
				decideForMe: false,
				showNoteInput: false,
				customInput: '',
				isCustom: false,
				touched: false,
				visited: true,
				cursorIndex: recIdx >= 0 ? recIdx : 0
			}
		];
	}

	let questions = $state<WizardQuestion[]>(initWizardQuestions());
	let activeStep = $state(0);
	let isReviewStep = $derived(questions.length > 1 && activeStep === questions.length);
	let currentQuestion = $derived<WizardQuestion | undefined>(questions[activeStep]);
	const currentAnswered = $derived(currentQuestion ? isQuestionAnswered(currentQuestion) : false);
	const missingIndex = $derived(firstUnansweredIndex(questions));
	const answeredCount = $derived(questions.filter((q) => isQuestionAnswered(q)).length);
	const allAnswered = $derived(missingIndex === -1);

	const startIndex = $derived.by(() => {
		const raw = pending.questions;
		if (!raw || raw.length === 0) return 0;
		return Math.min(Math.max(pending.questionIndex ?? 0, 0), raw.length - 1);
	});

	// Domande la cui risposta e' gia' partita: non modificabili, ma restano
	// nella barra perche' farle sparire rende incomprensibile la numerazione.
	const sentQuestions = $derived.by(() => {
		const raw = pending.questions;
		if (!raw || raw.length === 0) return [];
		return raw.slice(0, startIndex).map((q: AskQuestion, idx: number) => ({
			number: idx + 1,
			label: q.header || `Domanda ${idx + 1}`,
			question: q.question
		}));
	});

	const multiSteps = $derived(sentQuestions.length + questions.length > 1);

	let cardEl = $state<HTMLElement | null>(null);
	let noteInputEl = $state<HTMLInputElement | null>(null);
	let customTextareaEl = $state<HTMLTextAreaElement | null>(null);
	let plainInputEl = $state<HTMLInputElement | null>(null);
	let plainEditorEl = $state<HTMLTextAreaElement | null>(null);

	let plainInputValue = $state('');
	let plainEditorValue = $state('');
	let submitting = $state(false);
	let hoverIdx = $state<number | null>(null);

	$effect(() => {
		const _id = pending.requestId;
		plainInputValue = pending.prefill ?? '';
		plainEditorValue = pending.prefill ?? '';
		submitting = false;

		// Mai rubare il fuoco: la card di un progetto in background e'
		// montata ma invisibile, e l'utente potrebbe stare scrivendo altrove.
		const active = document.activeElement as HTMLElement | null;
		const documentHasFocus =
			typeof document.hasFocus === 'function' ? document.hasFocus() : true;
		if (
			!shouldAutoFocusAskCard(
				visible,
				documentHasFocus,
				active,
				document.body,
				cardEl?.contains(active) ?? false
			)
		) {
			traceFocus('ask-card-focus-skipped', `visible=${visible}`);
			return;
		}
		traceFocus('ask-card-focus');

		if (pending.method === 'input' && plainInputEl) {
			plainInputEl.focus();
		} else if (pending.method === 'editor' && plainEditorEl) {
			plainEditorEl.focus();
		} else {
			cardEl?.focus();
		}
	});

	// Opzioni visibili: fuori le sentinelle tecniche di fine selezione.
	const visibleOptions = $derived.by<WizardOption[]>(() => {
		if (!currentQuestion) return [];
		return currentQuestion.options.filter((o) => !o.isDoneSentinel);
	});

	// Anteprima affiancata: quella sotto il mouse, altrimenti la scelta,
	// altrimenti la consigliata. Solo se almeno un'opzione ne ha una.
	const hasPreview = $derived.by(
		() => !!currentQuestion && currentQuestion.options.some((o) => !!o.preview)
	);
	const previewIdx = $derived.by(() => {
		if (!currentQuestion) return 0;
		if (hoverIdx !== null && hoverIdx < visibleOptions.length) return hoverIdx;
		const firstSelected = visibleOptions.findIndex((o) =>
			currentQuestion!.selectedOptions.has(o.cleanLabel)
		);
		if (firstSelected >= 0) return firstSelected;
		const rec = currentQuestion.recommended;
		if (typeof rec === 'number' && rec >= 0 && rec < visibleOptions.length) return rec;
		return 0;
	});
	const previewOption = $derived(visibleOptions[previewIdx]);
	const noteShown = $derived(!!currentQuestion && (currentQuestion.showNoteInput || !!currentQuestion.note));

	function optionAccessibleName(opt: WizardOption): string {
		return opt.isRecommended ? `${opt.cleanLabel}, ${m.chat_v2_ask_recommended()}` : opt.cleanLabel;
	}

	let optionEls: (HTMLElement | null)[] = [];

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

	// A scelta singola la selezione segue il fuoco come in un radiogroup: il
	// ring che si muoveva lasciando indietro la risposta mandava all'agente
	// l'opzione sbagliata. A scelta multipla le frecce spostano soltanto.
	function moveTo(index: number) {
		if (!currentQuestion) return;
		const total = visibleOptions.length;
		if (total === 0) return;
		focusOption(index);
		if (currentQuestion.multi) return;
		const opt = visibleOptions[currentQuestion.cursorIndex];
		if (opt) applyChoice(opt, false);
	}

	function moveCursor(delta: number) {
		if (!currentQuestion) return;
		const total = visibleOptions.length;
		if (total === 0) return;
		moveTo((currentQuestion.cursorIndex + delta + total) % total);
	}

	function selectAt(index: number) {
		const opt = visibleOptions[index];
		if (!opt) return;
		focusOption(index);
		applyChoice(opt, true);
	}

	function applyChoice(opt: WizardOption, focusCustom: boolean) {
		if (!currentQuestion) return;
		currentQuestion.touched = true;
		currentQuestion.visited = true;
		currentQuestion.decideForMe = false;

		if (opt.isOther) {
			currentQuestion.isCustom = true;
			currentQuestion.selectedOptions.clear();
			if (focusCustom) setTimeout(() => customTextareaEl?.focus(), 50);
			return;
		}

		currentQuestion.isCustom = false;
		if (currentQuestion.multi) {
			if (currentQuestion.selectedOptions.has(opt.cleanLabel)) {
				currentQuestion.selectedOptions.delete(opt.cleanLabel);
			} else {
				currentQuestion.selectedOptions.add(opt.cleanLabel);
			}
			return;
		}

		currentQuestion.selectedOptions.clear();
		currentQuestion.selectedOptions.add(opt.cleanLabel);
	}

	function toggleDecide() {
		if (!currentQuestion) return;
		currentQuestion.touched = true;
		currentQuestion.visited = true;
		currentQuestion.decideForMe = !currentQuestion.decideForMe;
		if (currentQuestion.decideForMe) {
			currentQuestion.selectedOptions.clear();
			currentQuestion.isCustom = false;
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

	// Il riepilogo esiste solo con piu' di una domanda: con una sola, il
	// passo `questions.length` non avrebbe niente da mostrare.
	const lastStep = $derived(questions.length > 1 ? questions.length : Math.max(questions.length - 1, 0));
	const nextExists = $derived(activeStep < lastStep);

	async function goToStep(stepIndex: number) {
		if (stepIndex < 0 || stepIndex > lastStep) return;
		hoverIdx = null;
		activeStep = stepIndex;
		const target = questions[stepIndex];
		if (target) target.visited = true;
		if (currentQuestion && currentQuestion.cursorIndex >= visibleOptions.length) {
			currentQuestion.cursorIndex = 0;
		}
		// Le opzioni del passo precedente vengono distrutte: senza riportare
		// il focus dentro la card le scorciatoie smetterebbero di funzionare.
		await tick();
		if (!focusOption(currentQuestion?.cursorIndex ?? 0)) cardEl?.focus();
	}

	function nextStep() {
		// Avanzare senza risposta significherebbe inviarne una inventata:
		// il passo resta dov'e'.
		if (!isReviewStep && !currentAnswered) return;
		if (activeStep < lastStep) {
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

	async function submitAllAnswers() {
		if (submitting) return;
		const plan = buildFlushPlan(questions);
		if (!plan) {
			if (missingIndex >= 0) void goToStep(missingIndex);
			return;
		}
		submitting = true;
		try {
			await submitPlan(plan);
		} finally {
			submitting = false;
		}
	}

	async function submitPlan(plan: AskFlushStep[]) {
		if (pending.requestId && promptBus.hasPending(pending.requestId)) {
			const handled = await promptBus.resolveRequest(pending.requestId, { action: 'wizard', plan });
			if (handled) return;
		}
		await session.submitAskWizard(plan);
	}

	async function submitSelect(value: string) {
		if (pending.requestId && promptBus.hasPending(pending.requestId)) {
			const handled = await promptBus.resolveRequest(pending.requestId, { action: 'select', value });
			if (handled) return;
		}
		await session.answerSelect(value);
	}

	async function submitConfirm(confirmed: boolean) {
		if (pending.requestId && promptBus.hasPending(pending.requestId)) {
			const handled = await promptBus.resolveRequest(pending.requestId, { action: 'confirm', confirmed });
			if (handled) return;
		}
		await session.answerConfirm(confirmed);
	}

	async function cancelUi() {
		if (pending.requestId && promptBus.hasPending(pending.requestId)) {
			const handled = await promptBus.cancelRequest(pending.requestId);
			if (handled) return;
		}
		await session.cancelPendingUi();
	}

	function minimizeOrCancel() {
		if (onMinimize) onMinimize();
		else void cancelUi();
	}

	function handleCardKeydown(e: KeyboardEvent) {
		if (pending.method === 'confirm') {
			if (e.key === 'Enter') {
				e.preventDefault();
				void submitConfirm(true);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				if (onMinimize) onMinimize();
				else void submitConfirm(false);
			}
			return;
		}

		if (pending.method === 'input' || pending.method === 'editor') {
			if (e.key === 'Escape') {
				e.preventDefault();
				minimizeOrCancel();
			}
			return;
		}

		const target = e.target as HTMLElement | null;
		// Su un pulsante lasciano agire il pulsante: intercettare Invio o
		// Spazio qui significherebbe eseguire l'azione due volte (una dal
		// gestore, una dal clic di default). Frecce, cifre, N ed Esc restano
		// attivi anche dai pulsanti.
		if (target?.closest('button') && (e.key === 'Enter' || e.key === ' ')) return;
		const typing =
			target !== null &&
			(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

		if (typing) {
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
			minimizeOrCancel();
			return;
		}

		if (e.key === 'ArrowLeft' && questions.length > 1) {
			e.preventDefault();
			prevStep();
			return;
		}

		if ((e.key === 'n' || e.key === 'N') && !isReviewStep && currentQuestion) {
			e.preventDefault();
			toggleNoteInput();
			return;
		}

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

		if (e.key === 'Home' && currentQuestion) {
			e.preventDefault();
			moveTo(0);
			return;
		}
		if (e.key === 'End' && currentQuestion) {
			e.preventDefault();
			moveTo(visibleOptions.length - 1);
			return;
		}

		if (e.key === ' ' && currentQuestion && !isReviewStep) {
			e.preventDefault();
			selectAt(currentQuestion.cursorIndex);
			return;
		}

		// Tasti 1…9: scelta diretta, "Altro…" compreso quando e' entro le nove.
		if (/^[1-9]$/.test(e.key) && currentQuestion && !isReviewStep) {
			const idx = Number(e.key) - 1;
			if (idx < visibleOptions.length) {
				e.preventDefault();
				selectAt(idx);
			}
			return;
		}

		if (e.key === 'Enter') {
			e.preventDefault();
			// Senza selezione vale l'opzione a fuoco: e' quella che l'utente
			// sta leggendo. Mai una scelta inventata dal codice, mai sopra
			// un "Decidi tu" o un testo libero.
			const needsCursorPick =
				!!currentQuestion &&
				!currentQuestion.decideForMe &&
				currentQuestion.selectedOptions.size === 0 &&
				!currentQuestion.isCustom;
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
	aria-label={parsedTitle.text || m.chat_v2_ask_title_single()}
	tabindex="-1"
	bind:this={cardEl}
>
	<!-- Intestazione: titolo, avanzamento, countdown, riduzione -->
	<div class="ask-head">
		<span class="ask-icon" aria-hidden="true"><IconAsk /></span>
		<span class="ask-title">
			{#if isReviewStep}
				{m.chat_v2_ask_review_title()}
			{:else if multiSteps}
				{m.chat_v2_ask_title_multi()}
			{:else}
				{m.chat_v2_ask_title_single()}
			{/if}
		</span>
		{#if multiSteps && !isReviewStep}
			<span class="ask-progress">{m.chat_v2_ask_progress({ done: answeredCount, total: sentQuestions.length + questions.length })}</span>
		{/if}
		{#if showCountdown}
			<span class="ask-deadline" role="timer">{m.chat_v2_ask_expires({ seconds: remainingSeconds ?? 0 })}</span>
		{/if}
		{#if onMinimize}
			<button
				type="button"
				class="ask-min"
				onclick={() => onMinimize()}
				title={m.chat_v2_ask_minimize()}
				aria-label={m.chat_v2_ask_minimize()}
			>
				<IconChevronDown />
			</button>
		{/if}
	</div>

	<!-- Stepper: risposte gia' partite (non cliccabili), domande, riepilogo -->
	{#if multiSteps}
		<nav class="ask-steps" aria-label={m.ask_stepper_aria()}>
			{#each sentQuestions as sent}
				<span
					class="ask-step sent"
					title={sent.question}
					aria-label={m.chat_v2_ask_step_aria({
						number: sent.number,
						total: askedTotal,
						label: sent.label,
						state: m.chat_v2_ask_step_sent()
					})}
				>
					<span class="ask-step-badge" aria-hidden="true"><IconCheck /></span>
					<span class="ask-step-label">{sent.label}</span>
				</span>
			{/each}
			{#each questions as q, idx}
				{@const done = isQuestionAnswered(q)}
				{@const cur = activeStep === idx && !isReviewStep}
				<button
					type="button"
					class="ask-step"
					class:cur
					class:done={done && !cur}
					onclick={() => void goToStep(idx)}
					title={q.question}
					aria-current={cur ? 'step' : undefined}
					aria-label={m.chat_v2_ask_step_aria({
						number: q.number,
						total: askedTotal,
						label: q.header || q.question,
						state: done ? m.chat_v2_ask_step_done() : m.chat_v2_ask_step_todo()
					})}
				>
					<span class="ask-step-badge" aria-hidden="true">
						{#if done && !cur}
							<IconCheck />
						{:else}
							{q.number}
						{/if}
					</span>
					<span class="ask-step-label">{q.header || `${m.chat_v2_ask_counter({ current: q.number, total: askedTotal })}`}</span>
				</button>
			{/each}
			{#if questions.length > 1}
				<button
					type="button"
					class="ask-step review"
					class:cur={isReviewStep}
					onclick={() => void goToStep(questions.length)}
					aria-current={isReviewStep ? 'step' : undefined}
				>
					<span class="ask-step-badge" aria-hidden="true">✓</span>
					<span class="ask-step-label">{m.chat_v2_ask_review_tab()}</span>
				</button>
			{/if}
		</nav>
	{/if}

	{#if pending.method === 'select'}
		{#if isReviewStep}
			<div class="ask-review">
				{#each questions as q, idx}
					<div class="ask-review-row">
						<span class="ask-review-q" title={q.question}>{q.header || q.question}</span>
						<span class="ask-review-a">
							{#if !isQuestionAnswered(q)}
								<span class="ask-missing">—</span>
							{:else if q.decideForMe}
								<span class="ask-decided">{m.chat_v2_ask_decide_active()}</span>
							{:else if q.isCustom && q.customInput.trim()}
								<span>“{q.customInput.trim()}”</span>
							{:else if q.selectedOptions.size > 0}
								{Array.from(q.selectedOptions).join(', ')}
							{:else}
								<span class="ask-missing">—</span>
							{/if}
						</span>
						<button
							type="button"
							class="ask-edit"
							onclick={() => void goToStep(idx)}
							aria-label={m.ask_edit_answer_btn()}
						>
							<IconRename />
						</button>
					</div>
				{/each}
			</div>
		{:else if currentQuestion}
			<div class="ask-q">
				{#if askedTotal > 1 && questions.length <= 1}
					<span class="ask-counter">{m.chat_v2_ask_counter({ current: askedNumber, total: askedTotal })}</span>
				{:else if parsedTitle.counter && questions.length <= 1}
					<span class="ask-counter">{parsedTitle.counter}</span>
				{/if}
				{#if currentQuestion.header && !multiSteps}
					<span class="ask-header">{currentQuestion.header}</span>
				{/if}
				<p class="ask-text">{currentQuestion.question}</p>
				{#if detailMessage}
					<p class="ask-detail">{detailMessage}</p>
				{/if}
				{#if currentQuestion.multi}
					<span class="ask-multi">{m.chat_v2_ask_multi()} · {m.chat_v2_ask_multi_hint()}</span>
				{/if}
			</div>

			<div class="ask-main" class:with-preview={hasPreview && !!previewOption?.preview}>
				<div
					class="ask-options"
					role="listbox"
					tabindex="-1"
					aria-labelledby={`${uid}-q`}
					aria-multiselectable={currentQuestion.multi}
					onmouseleave={() => (hoverIdx = null)}
				>
					<span id={`${uid}-q`} class="sr-only">{currentQuestion.question}</span>
					{#each visibleOptions as opt, i}
						{@const selected = currentQuestion.decideForMe
							? false
							: currentQuestion.isCustom
								? opt.isOther
								: currentQuestion.selectedOptions.has(opt.cleanLabel)}
						{@const focused = currentQuestion.cursorIndex === i}
						<div
							bind:this={optionEls[i]}
							class="ask-opt"
							class:selected
							class:focused
							role="option"
							aria-selected={selected}
							aria-label={optionAccessibleName(opt)}
							aria-describedby={opt.description ? `${uid}-opt-${i}-desc` : undefined}
							tabindex={focused ? 0 : -1}
							onclick={() => selectAt(i)}
							onmouseenter={() => {
								if (hasPreview) hoverIdx = i;
							}}
							onfocus={() => {
								if (currentQuestion) currentQuestion.cursorIndex = i;
							}}
							onkeydown={(e) => {
								if (e.key === ' ') {
									e.preventDefault();
									e.stopPropagation();
									selectAt(i);
								}
							}}
						>
							<span class="ask-box" class:multi={currentQuestion.multi} aria-hidden="true">
								{#if selected}
									{#if currentQuestion.multi}<IconCheck />{:else}<span class="ask-dot"></span>{/if}
								{/if}
							</span>
							<span class="ask-opt-body">
								<span class="ask-opt-label">
									{opt.cleanLabel}
									{#if opt.isRecommended}
										<span class="ask-rec">{m.chat_v2_ask_recommended()}</span>
									{/if}
								</span>
								{#if opt.description}
									<span class="ask-opt-desc" id={`${uid}-opt-${i}-desc`}>{opt.description}</span>
								{/if}
							</span>
							{#if i < 9}
								<kbd class="ask-kbd" aria-hidden="true">{i + 1}</kbd>
							{/if}
						</div>
					{/each}
				</div>

				{#if hasPreview && previewOption?.preview}
					<div class="ask-preview" aria-live="off">
						<div class="ask-preview-head">
							<span>{m.chat_v2_ask_preview()}</span>
							<span class="ask-preview-label">{previewOption.cleanLabel}</span>
						</div>
						<pre class="ask-preview-code"><code>{previewOption.preview}</code></pre>
					</div>
				{/if}
			</div>

			{#if currentQuestion.isCustom && !currentQuestion.decideForMe}
				<div class="ask-other">
					<label class="sr-only" for={`${uid}-custom`}>{m.chat_v2_ask_other()}</label>
					<textarea
						id={`${uid}-custom`}
						class="ask-other-input"
						placeholder={m.ask_custom_placeholder()}
						bind:value={currentQuestion.customInput}
						bind:this={customTextareaEl}
						rows="2"
					></textarea>
				</div>
			{/if}

			<!-- La nota vale anche con "Decidi tu": viaggia con la delega (buildQuestionSteps). -->
			{#if noteShown}
				<div class="ask-note">
					<IconNote aria-hidden="true" />
					<input
						type="text"
						class="ask-note-input"
						placeholder={m.ask_note_placeholder()}
						bind:value={currentQuestion.note}
						bind:this={noteInputEl}
						aria-label={m.ask_note_placeholder()}
					/>
				</div>
			{:else}
				<button type="button" class="ask-note-btn" onclick={() => toggleNoteInput()}>
					<IconPlus aria-hidden="true" /> {m.chat_v2_ask_add_note()} <kbd class="ask-kbd">N</kbd>
				</button>
			{/if}
		{/if}

		<!-- Piè: Decidi tu · suggerimenti · Indietro/Avanti/Invia -->
		<div class="ask-foot">
			{#if !isReviewStep && currentQuestion}
				<button
					type="button"
					class="ask-decide"
					class:on={currentQuestion.decideForMe}
					onclick={() => toggleDecide()}
					title={m.chat_v2_ask_decide_title()}
					aria-pressed={currentQuestion.decideForMe}
				>
					{currentQuestion.decideForMe ? `✓ ${m.chat_v2_ask_decide_active()}` : m.chat_v2_ask_decide()}
				</button>
			{/if}
			<span class="ask-hint" aria-hidden="true">
				{#if currentQuestion && !isReviewStep}
					<kbd class="ask-kbd">1</kbd>–<kbd class="ask-kbd">{Math.min(visibleOptions.length, 9)}</kbd>
					{m.chat_v2_ask_hint_choose()} ·
				{/if}
				<kbd class="ask-kbd">↵</kbd>
				{allAnswered ? m.chat_v2_ask_hint_send() : m.chat_v2_ask_hint_next()}
			</span>
			<span class="ask-actions">
				{#if questions.length > 1 && !isReviewStep && activeStep > 0}
					<button type="button" class="ask-btn" onclick={() => prevStep()}>
						<IconArrowLeft aria-hidden="true" /> {m.ask_prev_btn()}
					</button>
				{/if}
				{#if isReviewStep}
					<button type="button" class="ask-btn" onclick={() => prevStep()}>
						<IconArrowLeft aria-hidden="true" /> {m.ask_prev_btn()}
					</button>
				{/if}
				{#if allAnswered}
					<button
						type="button"
						class="ask-btn primary"
						disabled={submitting}
						onclick={() => void submitAllAnswers()}
					>
						<IconCheck aria-hidden="true" />
						{questions.length === 1 ? m.chat_v2_ask_submit_one() : m.chat_v2_ask_submit_many()}
					</button>
				{:else if nextExists}
					<button
						type="button"
						class="ask-btn primary"
						disabled={!currentAnswered}
						onclick={() => nextStep()}
					>
						{m.chat_v2_ask_next()} <IconArrowRight aria-hidden="true" />
					</button>
				{:else}
					<button type="button" class="ask-btn primary" disabled>
						{questions.length - answeredCount === 1
							? m.chat_v2_ask_missing_one()
							: m.chat_v2_ask_missing_many({ count: questions.length - answeredCount })}
					</button>
				{/if}
			</span>
		</div>
	{:else if pending.method === 'input'}
		<div class="ask-q">
			<p class="ask-text">{parsedTitle.text || pending.title}</p>
			{#if detailMessage}
				<p class="ask-detail">{detailMessage}</p>
			{/if}
		</div>
		<div class="ask-row">
			<input
				type="text"
				class="ask-text-input"
				placeholder={pending.placeholder ?? ''}
				bind:value={plainInputValue}
				bind:this={plainInputEl}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						void submitSelect(plainInputValue);
					} else if (e.key === 'Escape') {
						e.preventDefault();
						minimizeOrCancel();
					}
				}}
			/>
			<button
				type="button"
				class="ask-btn primary"
				disabled={submitting}
				onclick={() => void submitSelect(plainInputValue)}
			>
				{m.chat_v2_ask_send()} <kbd class="ask-kbd">↵</kbd>
			</button>
		</div>
	{:else if pending.method === 'editor'}
		<div class="ask-q">
			<p class="ask-text">{parsedTitle.text || pending.title}</p>
			{#if detailMessage}
				<p class="ask-detail">{detailMessage}</p>
			{/if}
		</div>
		<textarea
			class="ask-editor"
			placeholder={pending.placeholder ?? ''}
			bind:value={plainEditorValue}
			bind:this={plainEditorEl}
			rows="4"
			onkeydown={(e) => {
				if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
					e.preventDefault();
					void submitSelect(plainEditorValue);
				} else if (e.key === 'Escape') {
					e.preventDefault();
					minimizeOrCancel();
				}
			}}
		></textarea>
		<div class="ask-foot">
			<span></span>
			<span class="ask-actions">
				<button
					type="button"
					class="ask-btn primary"
					disabled={submitting}
					onclick={() => void submitSelect(plainEditorValue)}
				>
					{m.chat_v2_ask_send()} <kbd class="ask-kbd">Ctrl+↵</kbd>
				</button>
			</span>
		</div>
	{:else if pending.method === 'confirm'}
		<div class="ask-q">
			<p class="ask-text">{parsedTitle.text || pending.title}</p>
			{#if detailMessage}
				<p class="ask-detail">{detailMessage}</p>
			{/if}
		</div>
		<div class="ask-foot">
			<span></span>
			<span class="ask-actions">
				<button
					type="button"
					class="ask-btn"
					disabled={submitting}
					onclick={() => void submitConfirm(false)}
				>
					{m.chat_v2_ask_no()} <kbd class="ask-kbd">Esc</kbd>
				</button>
				<button
					type="button"
					class="ask-btn primary"
					disabled={submitting}
					onclick={() => void submitConfirm(true)}
				>
					{m.chat_v2_ask_yes()} <kbd class="ask-kbd">↵</kbd>
				</button>
			</span>
		</div>
	{/if}
</div>

<style>
	.ask-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		padding: var(--space-3) var(--space-4) 0;
		min-width: 0;
		/* Tante domande con anteprima non devono spingere la chat fuori schermo:
		   la scheda scorre e il pie' con Invia resta ancorato in fondo. */
		max-height: 58vh;
		overflow-y: auto;
		outline: none;
		box-shadow: 0 8px 30px -10px rgb(0 0 0 / 0.2);
	}
	/* Nella scheda che scorre i figli non devono comprimersi: con overflow
	   proprio (la barra delle schede) un figlio flex si schiaccerebbe a zero. */
	.ask-card > * {
		flex-shrink: 0;
	}
	/* Le varianti senza pie' (input) chiudono con lo stesso respiro in basso. */
	.ask-card > :last-child:not(.ask-foot) {
		margin-bottom: var(--space-3);
	}

	.ask-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.ask-icon {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--ink-muted);
		--icon-size: 16px;
	}

	.ask-title {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ask-progress {
		margin-left: auto;
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.ask-deadline {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--warn);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px 6px;
		white-space: nowrap;
	}

	.ask-min {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		cursor: pointer;
		padding: 2px;
	}
	.ask-progress + .ask-min,
	.ask-deadline + .ask-min {
		margin-left: 0;
	}
	.ask-min:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.ask-steps {
		display: flex;
		align-items: center;
		gap: 4px;
		overflow-x: auto;
		padding-bottom: 2px;
	}

	.ask-step {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		padding: 4px 10px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		cursor: pointer;
		white-space: nowrap;
	}
	.ask-step:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}
	/* Scheda corrente in negativo, come nel prototipo: si vede a colpo d'occhio
	   a che punto si e' anche con cinque domande in fila. */
	.ask-step.cur,
	.ask-step.cur:hover {
		background: var(--ink);
		color: var(--bg-base);
	}
	.ask-step.cur .ask-step-badge {
		opacity: 0.6;
	}
	.ask-step.done .ask-step-badge {
		color: var(--success);
	}
	.ask-step.sent {
		cursor: default;
		opacity: 0.6;
	}
	.ask-step.sent:hover {
		background: transparent;
		color: var(--ink-muted);
	}
	.ask-step.review {
		margin-left: auto;
	}
	.ask-step-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-mono);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		min-width: 14px;
	}
	.ask-step-label {
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 140px;
	}

	.ask-q {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.ask-counter,
	.ask-header {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--ink-faint);
	}
	.ask-text {
		margin: 0;
		font-size: 15px;
		font-weight: 500;
		color: var(--ink);
		line-height: 1.45;
	}
	.ask-detail {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink-muted);
		line-height: 1.4;
	}
	.ask-multi {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.ask-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.ask-main.with-preview {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		align-items: start;
	}

	.ask-options {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.ask-opt {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 9px 12px;
		cursor: pointer;
		user-select: none;
		transition: border-color 0.15s ease, background-color 0.15s ease;
	}
	.ask-opt:hover {
		background: color-mix(in oklab, var(--bg-hover) 60%, transparent);
		border-color: var(--line-strong);
	}
	.ask-opt.focused,
	.ask-opt:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}
	.ask-opt.selected {
		border-color: var(--brand);
		box-shadow: inset 0 0 0 1px var(--brand);
		background: color-mix(in oklab, var(--brand) 7%, transparent);
	}
	/* Indicatore disegnato: cerchio per la scelta singola, quadrato per la
	   multipla, pieno del colore del marchio quando e' scelto. */
	.ask-box {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		margin-top: 2px;
		flex-shrink: 0;
		border: 1px solid var(--line-strong);
		border-radius: 50%;
		color: var(--on-brand);
		--icon-size: 12px;
		transition: background-color 0.15s ease, border-color 0.15s ease;
	}
	.ask-box.multi {
		border-radius: 5px;
	}
	.ask-opt.selected .ask-box {
		background: var(--brand);
		border-color: var(--brand);
	}
	.ask-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--on-brand);
	}
	.ask-opt-body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}
	.ask-opt-label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
	}
	.ask-rec {
		background: color-mix(in oklab, var(--success) 14%, transparent);
		color: var(--success);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--success) 25%, transparent);
		border-radius: 6px;
		padding: 0 6px;
		font-size: 11px;
		font-weight: 500;
		line-height: 18px;
	}
	.ask-opt-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.45;
		margin-top: 2px;
	}

	.ask-kbd {
		font-family: var(--font-mono);
		font-size: 10.5px;
		line-height: 1.4;
		color: var(--ink-faint);
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 0 5px;
		white-space: nowrap;
	}

	.ask-preview {
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		position: sticky;
		top: 4px;
	}
	.ask-preview-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: 4px 10px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--ink-faint);
		border-bottom: 1px solid var(--line);
	}
	.ask-preview-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-transform: none;
		letter-spacing: normal;
	}
	.ask-preview-code {
		margin: 0;
		padding: var(--space-2) 10px;
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.5;
		color: var(--ink);
	}

	/* "Altro…" si scrive sotto la sua riga, allineato alle etichette. */
	.ask-other {
		display: flex;
		flex-direction: column;
		margin-top: calc(-1 * var(--space-2));
		padding-left: 40px;
	}
	.ask-other-input,
	.ask-editor {
		width: 100%;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		font-size: var(--text-sm);
		font-family: var(--font-ui);
		color: var(--ink);
		resize: vertical;
	}
	.ask-other-input:focus,
	.ask-editor:focus,
	.ask-text-input:focus,
	.ask-note-input:focus {
		border-color: var(--brand);
		outline: none;
	}

	.ask-note {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--ink-faint);
	}
	.ask-note-input {
		flex: 1;
		min-width: 0;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 5px 10px;
		font-size: var(--text-sm);
		font-family: var(--font-ui);
		color: var(--ink);
	}
	.ask-note-btn {
		align-self: flex-start;
		margin: calc(-1 * var(--space-1)) 0 0 -6px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		padding: 4px 6px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		cursor: pointer;
		white-space: nowrap;
	}
	.ask-note-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.ask-review {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.ask-review-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px 10px;
		font-size: var(--text-sm);
	}
	.ask-review-row + .ask-review-row {
		border-top: 1px solid var(--line);
	}
	.ask-review-q {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
	}
	.ask-review-a {
		color: var(--ink);
		text-align: right;
	}
	.ask-missing {
		color: var(--warn);
	}
	.ask-decided {
		color: var(--ink-muted);
		font-style: italic;
	}
	.ask-edit {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		cursor: pointer;
		padding: 2px;
		flex-shrink: 0;
	}
	.ask-edit:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	/* Pie' a tutta larghezza, ancorato in fondo quando la scheda scorre. */
	.ask-foot {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin: 0 calc(-1 * var(--space-4));
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--line);
		background: color-mix(in oklab, var(--bg-sunken) 45%, var(--bg-raised));
	}
	.ask-decide {
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		padding: 4px 8px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		cursor: pointer;
		white-space: nowrap;
	}
	.ask-decide:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}
	.ask-decide.on {
		font-weight: 600;
		color: var(--ink);
	}
	.ask-hint {
		font-size: 11px;
		color: var(--ink-faint);
	}
	.ask-actions {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.ask-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		padding: 5px 12px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		cursor: pointer;
		white-space: nowrap;
	}
	.ask-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}
	.ask-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.ask-btn.primary {
		background: var(--brand);
		border-color: var(--brand);
		color: var(--on-brand);
		font-weight: 600;
		padding: 5px 14px;
	}
	.ask-btn.primary:hover:not(:disabled) {
		background: var(--brand);
		filter: brightness(1.08);
	}
	.ask-btn.primary .ask-kbd {
		color: inherit;
		border-color: currentColor;
		opacity: 0.7;
	}

	.ask-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.ask-text-input {
		flex: 1;
		min-width: 0;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		padding: 7px 10px;
		font-size: var(--text-sm);
		font-family: var(--font-ui);
		color: var(--ink);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
