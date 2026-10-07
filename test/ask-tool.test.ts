import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildAskDialogAnswers,
	cleanOptionLabel,
	decideForMeText,
	extractNoteFromLabel,
	firstUnansweredIndex,
	isDoneOption,
	isOtherOption,
	isQuestionAnswered,
	OTHER_LABEL,
	parseAskQuestions,
	type AnswerableOption,
	type AnswerableQuestion
} from '../src/lib/agent/askAnswers.ts';
import { parseAskToolCall, summarizeAskAnswer } from '../src/lib/agent/askResult.ts';

function option(label: string): AnswerableOption {
	return {
		label,
		cleanLabel: cleanOptionLabel(label),
		isOther: isOtherOption(label),
		isDoneSentinel: isDoneOption(label)
	};
}

function question(overrides: Partial<AnswerableQuestion> = {}): AnswerableQuestion {
	return {
		id: 'q1',
		options: [
			option('SQLite (Recommended)'),
			option('PostgreSQL'),
			option('MySQL'),
			option('Other (type your own)')
		],
		multi: false,
		selectedOptions: new Set<string>(),
		note: '',
		customInput: '',
		decideForMe: false,
		isCustom: false,
		touched: false,
		visited: true,
		...overrides
	};
}

describe('Ask tool: parsing etichette e validazione risposte', () => {
	describe('Parsing delle etichette', () => {
		it('rimuove il suffisso (Recommended)', () => {
			assert.equal(cleanOptionLabel('SQLite (Recommended)'), 'SQLite');
			assert.equal(cleanOptionLabel('PostgreSQL'), 'PostgreSQL');
		});

		it('riconosce le varianti della voce "Altro"', () => {
			assert.equal(isOtherOption('Other (type your own)'), true);
			assert.equal(isOtherOption('other (custom)'), true);
			assert.equal(isOtherOption('Altro (scrivi la tua risposta)'), true);
			assert.equal(isOtherOption('Altro'), true);
			assert.equal(isOtherOption('Opzione normale'), false);
		});

		it('riconosce sentinelle di completamento multi-select', () => {
			assert.equal(isDoneOption('✔ Done selecting'), true);
			assert.equal(isDoneOption('Fine selezione'), true);
			assert.equal(isDoneOption('Opzione normale'), false);
		});
	});

	describe('Nessuna risposta inventata', () => {
		it('una domanda a scelta singola senza selezione non e risposta', () => {
			assert.equal(isQuestionAnswered(question()), false);
		});

		it('"Altro" senza testo non e una risposta', () => {
			const q = question({ isCustom: true, touched: true, customInput: '   ' });
			assert.equal(isQuestionAnswered(q), false);
		});

		it('un wizard incompleto non produce risposte (ritorna null)', () => {
			const answered = question({ id: 'q1', selectedOptions: new Set(['PostgreSQL']), touched: true });
			const unanswered = question({ id: 'q2' });
			assert.equal(buildAskDialogAnswers([answered, unanswered]), null);
			assert.equal(firstUnansweredIndex([answered, unanswered]), 1);
			assert.equal(firstUnansweredIndex([answered]), -1);
		});

		it('la scelta multipla vuota vale "nessuna" solo se la domanda e stata toccata', () => {
			assert.equal(isQuestionAnswered(question({ multi: true })), false);
			assert.equal(isQuestionAnswered(question({ multi: true, touched: true })), true);
		});

		it('la pre-selezione consigliata di una domanda mai aperta non e una risposta', () => {
			const mai = question({ selectedOptions: new Set(['SQLite']), visited: false });
			assert.equal(isQuestionAnswered(mai), false);
		});

		it('la stessa pre-selezione vale come risposta appena la domanda e mostrata', () => {
			const vista = question({ selectedOptions: new Set(['SQLite']), visited: true });
			assert.equal(isQuestionAnswered(vista), true);
		});

		it('la scelta multipla mai aperta non vale "nessuna" nemmeno se toccata', () => {
			assert.equal(isQuestionAnswered(question({ multi: true, touched: true, visited: false })), false);
		});
	});

	describe('Costruzione risposte native AskDialogAnswer', () => {
		it('rimanda l etichetta originale verbatim a scelta singola', () => {
			const q = question({
				id: 'db',
				selectedOptions: new Set(['SQLite']),
				touched: true
			});
			const answers = buildAskDialogAnswers([q]);
			assert.ok(answers);
			assert.equal(answers.length, 1);
			assert.deepEqual(answers[0], {
				id: 'db',
				selectedOptions: ['SQLite (Recommended)'],
				customInput: undefined
			});
		});

		it('unisce etichetta e nota in customInput a scelta singola per rispettare il vincolo omp', () => {
			const q = question({
				id: 'db',
				selectedOptions: new Set(['PostgreSQL']),
				note: 'usare pool dedicato',
				touched: true
			});
			const answers = buildAskDialogAnswers([q]);
			assert.ok(answers);
			assert.equal(answers.length, 1);
			assert.deepEqual(answers[0], {
				id: 'db',
				selectedOptions: [],
				customInput: 'PostgreSQL (nota: usare pool dedicato)'
			});
		});

		it('invia customInput per opzione personalizzata (Altro)', () => {
			const q = question({
				id: 'db',
				isCustom: true,
				customInput: 'CockroachDB',
				touched: true
			});
			const answers = buildAskDialogAnswers([q]);
			assert.ok(answers);
			assert.deepEqual(answers[0], {
				id: 'db',
				selectedOptions: [],
				customInput: 'CockroachDB'
			});
		});

		it('unisce customInput e nota per opzione personalizzata', () => {
			const q = question({
				id: 'db',
				isCustom: true,
				customInput: 'CockroachDB',
				note: 'versione serverless',
				touched: true
			});
			const answers = buildAskDialogAnswers([q]);
			assert.ok(answers);
			assert.deepEqual(answers[0], {
				id: 'db',
				selectedOptions: [],
				customInput: 'CockroachDB (nota: versione serverless)'
			});
		});

		it('invia testo convenzionale per "Decidi tu"', () => {
			const q = question({
				id: 'db',
				decideForMe: true,
				touched: true
			});
			const answers = buildAskDialogAnswers([q]);
			assert.ok(answers);
			assert.deepEqual(answers[0], {
				id: 'db',
				selectedOptions: [],
				customInput: decideForMeText()
			});
		});

		it('unisce "Decidi tu" e nota', () => {
			const q = question({
				id: 'db',
				decideForMe: true,
				note: 'preferisci soluzioni senza dipendenze native',
				touched: true
			});
			const answers = buildAskDialogAnswers([q]);
			assert.ok(answers);
			assert.deepEqual(answers[0], {
				id: 'db',
				selectedOptions: [],
				customInput: `${decideForMeText()} (nota: preferisci soluzioni senza dipendenze native)`
			});
		});

		it('invia opzioni multiple verbatim a scelta multipla', () => {
			const q = question({
				id: 'features',
				multi: true,
				selectedOptions: new Set(['PostgreSQL', 'MySQL']),
				touched: true
			});
			const answers = buildAskDialogAnswers([q]);
			assert.ok(answers);
			assert.deepEqual(answers[0], {
				id: 'features',
				selectedOptions: ['PostgreSQL', 'MySQL'],
				customInput: undefined
			});
		});

		it('invia opzioni multiple con nota in customInput', () => {
			const q = question({
				id: 'features',
				multi: true,
				selectedOptions: new Set(['PostgreSQL', 'MySQL']),
				note: 'entrambi con replica',
				touched: true
			});
			const answers = buildAskDialogAnswers([q]);
			assert.ok(answers);
			assert.deepEqual(answers[0], {
				id: 'features',
				selectedOptions: ['PostgreSQL', 'MySQL'],
				customInput: 'nota: entrambi con replica'
			});
		});

		it('preserva ordine e id delle domande in un wizard con piu domande', () => {
			const q1 = question({
				id: 'q_storage',
				selectedOptions: new Set(['PostgreSQL']),
				touched: true
			});
			const q2 = question({
				id: 'q_auth',
				options: [option('JWT'), option('Session')],
				selectedOptions: new Set(['JWT']),
				touched: true
			});
			const answers = buildAskDialogAnswers([q1, q2]);
			assert.ok(answers);
			assert.equal(answers.length, 2);
			assert.equal(answers[0].id, 'q_storage');
			assert.deepEqual(answers[0].selectedOptions, ['PostgreSQL']);
			assert.equal(answers[1].id, 'q_auth');
			assert.deepEqual(answers[1].selectedOptions, ['JWT']);
		});
	});

	describe('Parsing degli argomenti del tool (parseAskQuestions)', () => {
		it('estrae la lista delle domande con tutte le proprieta', () => {
			const args = {
				questions: [
					{
						id: 'storage_type',
						question: 'Quale storage backend?',
						header: 'Storage',
						multi: false,
						recommended: 0,
						options: [
							{ label: 'SQLite', description: 'Zero config' },
							{ label: 'PostgreSQL', description: 'Robusto' }
						]
					}
				]
			};
			const parsed = parseAskQuestions(args);
			assert.ok(parsed);
			assert.equal(parsed.length, 1);
			assert.equal(parsed[0].id, 'storage_type');
			assert.equal(parsed[0].options.length, 2);
			assert.equal(parsed[0].options[0].description, 'Zero config');
		});

		it('restituisce undefined per argomenti privi di questions', () => {
			assert.equal(parseAskQuestions(null), undefined);
			assert.equal(parseAskQuestions({}), undefined);
			assert.equal(parseAskQuestions({ questions: [] }), undefined);
		});
	});

	describe('Round trip con il renderer delle risposte', () => {
		it('preserva etichette prive di nota', () => {
			assert.deepEqual(extractNoteFromLabel('PostgreSQL'), { clean: 'PostgreSQL' });
		});

		it('estrae nota in italiano (nota: ...)', () => {
			assert.deepEqual(extractNoteFromLabel('PostgreSQL (nota: multi-utenza)'), {
				clean: 'PostgreSQL',
				note: 'multi-utenza'
			});
		});

		it('legge anche la forma inglese (note: ...)', () => {
			assert.deepEqual(extractNoteFromLabel('JWT (note: include refresh token)'), {
				clean: 'JWT',
				note: 'include refresh token'
			});
		});
	});
});

describe('Ask tool: riepilogo delle risposte inviate', () => {
	const args = {
		questions: [
			{ id: 'fruit', header: 'Frutta', question: 'Frutta preferita?', options: [{ label: 'Apple' }, { label: 'Banana' }] },
			{ id: 'toppings', header: 'Guarnizioni', question: 'Guarnizioni?', multi: true, options: [{ label: 'Chocolate' }] }
		]
	};

	it('unisce scelte e testo libero e scarta la sentinella Other', () => {
		const [fruit, toppings] = parseAskToolCall(args, {
			results: [
				{ id: 'fruit', question: 'Frutta preferita?', options: ['Apple', 'Banana'], multi: false, selectedOptions: ['Apple (Recommended)'] },
				{ id: 'toppings', question: 'Guarnizioni?', options: ['Chocolate'], multi: true, selectedOptions: ['Chocolate', OTHER_LABEL], customInput: 'Sprinkles & Nuts' }
			]
		});
		assert.equal(fruit.header, 'Frutta');
		assert.deepEqual(summarizeAskAnswer(fruit), { kind: 'answered', labels: ['Apple'], note: undefined });
		assert.deepEqual(summarizeAskAnswer(toppings), { kind: 'answered', labels: ['Chocolate', '“Sprinkles & Nuts”'], note: undefined });
	});

	it('riconosce "Decidi tu" anche con la nota attaccata al testo', () => {
		const [fruit] = parseAskToolCall(args, {
			results: [{ id: 'fruit', question: 'Frutta preferita?', options: ['Apple'], selectedOptions: [], customInput: `${decideForMeText()} (nota: niente agrumi)` }]
		});
		assert.deepEqual(summarizeAskAnswer(fruit), { kind: 'decided', labels: [], note: 'niente agrumi' });
	});

	it('senza scelte ne testo non inventa una risposta', () => {
		const [fruit] = parseAskToolCall(args, { results: [{ id: 'fruit', question: 'Frutta preferita?', options: ['Apple'], selectedOptions: [] }] });
		assert.equal(summarizeAskAnswer(fruit).kind, 'none');
	});
});
