import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildFlushPlan,
	buildQuestionSteps,
	cleanOptionLabel,
	DONE_SENTINEL,
	extractNoteFromLabel,
	firstUnansweredIndex,
	isDoneOption,
	isOtherOption,
	isQuestionAnswered,
	matchQuestionIndex,
	optionSignature,
	OTHER_LABEL,
	parseAskQuestions,
	stepAcceptsRequest,
	type AnswerableOption,
	type AnswerableQuestion,
	type AskFlushStep,
	type AskQuestion
} from '../src/lib/agent/askAnswers.ts';

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
		options: [
			option('SQLite (Recommended)'),
			option('PostgreSQL'),
			option('MySQL'),
			option('Other (type your own)'),
			option('✔ Done selecting')
		],
		multi: false,
		selectedOptions: new Set<string>(),
		note: '',
		customInput: '',
		isCustom: false,
		touched: false,
		visited: true,
		...overrides
	};
}

describe('Ask tool: etichette, note e piano di consegna', () => {
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

		it('costruire passi per una domanda senza risposta e un errore, non la prima opzione', () => {
			assert.throws(() => buildQuestionSteps(question()), /Risposta assente/);
		});

		it('"Altro" senza testo non e una risposta', () => {
			const q = question({ isCustom: true, touched: true, customInput: '   ' });
			assert.equal(isQuestionAnswered(q), false);
			assert.throws(() => buildQuestionSteps(q), /Risposta assente/);
		});

		it('un wizard incompleto non produce un piano da consegnare', () => {
			const answered = question({ selectedOptions: new Set(['PostgreSQL']), touched: true });
			assert.equal(buildFlushPlan([answered, question()]), null);
			assert.equal(firstUnansweredIndex([answered, question()]), 1);
			assert.equal(firstUnansweredIndex([answered]), -1);
		});

		it('la scelta multipla vuota vale "nessuna" solo se la domanda e stata toccata', () => {
			assert.equal(isQuestionAnswered(question({ multi: true })), false);
			assert.equal(isQuestionAnswered(question({ multi: true, touched: true })), true);
		});

		it('la pre-selezione consigliata di una domanda mai aperta non e una risposta', () => {
			const mai = question({ selectedOptions: new Set(['SQLite']), visited: false });
			assert.equal(isQuestionAnswered(mai), false);
			assert.throws(() => buildQuestionSteps(mai), /Risposta assente/);
		});

		it('la stessa pre-selezione vale come risposta appena la domanda e mostrata', () => {
			const vista = question({ selectedOptions: new Set(['SQLite']), visited: true });
			assert.equal(isQuestionAnswered(vista), true);
			const steps = buildQuestionSteps(vista);
			assert.equal(steps.length, 1);
			assert.equal(steps[0].method, 'select');
			if (steps[0].method === 'select') {
				assert.equal(steps[0].value, 'SQLite (Recommended)');
			}
		});

		it('un wizard con domande mai aperte non parte, e indica la prima', () => {
			const vista = question({ selectedOptions: new Set(['PostgreSQL']) });
			const mai = question({ selectedOptions: new Set(['SQLite']), visited: false });
			assert.equal(buildFlushPlan([vista, mai, mai]), null);
			assert.equal(firstUnansweredIndex([vista, mai, mai]), 1);
		});

		it('la scelta multipla mai aperta non vale "nessuna" nemmeno se toccata', () => {
			assert.equal(isQuestionAnswered(question({ multi: true, touched: true, visited: false })), false);
		});
	});

	describe('Costruzione del piano di consegna', () => {
		it('rimanda l etichetta originale dell opzione scelta', () => {
			const q = question({ selectedOptions: new Set(['SQLite']), touched: true });
			const steps = buildQuestionSteps(q);
			assert.deepEqual(steps, [
				{
					method: 'select',
					value: 'SQLite (Recommended)',
					signature: optionSignature(['SQLite', 'PostgreSQL', 'MySQL'])
				}
			]);
		});

		it('allega la nota alla scelta singola, senza il suffisso Recommended', () => {
			const q = question({
				selectedOptions: new Set(['SQLite']),
				note: '  solo per sviluppo locale  ',
				touched: true
			});
			const steps = buildQuestionSteps(q);
			assert.deepEqual(steps, [
				{
					method: 'select',
					value: 'SQLite (nota: solo per sviluppo locale)',
					signature: optionSignature(['SQLite', 'PostgreSQL', 'MySQL'])
				}
			]);
		});

		it('chiude la scelta multipla senza nota con la sentinella Done e recovery', () => {
			const q = question({
				multi: true,
				selectedOptions: new Set(['PostgreSQL', 'SQLite']),
				touched: true
			});
			const signature = optionSignature(['SQLite', 'PostgreSQL', 'MySQL']);
			const steps = buildQuestionSteps(q);
			assert.equal(steps.length, 3);
			assert.equal(steps[0].value, 'PostgreSQL');
			assert.equal(steps[1].value, 'SQLite (Recommended)');
			assert.equal(steps[2].value, DONE_SENTINEL);
			if (steps[2].method === 'select' && steps[2].recovery) {
				assert.equal(steps[2].recovery.length, 3);
				assert.equal(steps[2].recovery[0].value, DONE_SENTINEL);
				assert.equal(steps[2].recovery[1].value, OTHER_LABEL);
				assert.equal(steps[2].recovery[2].method, 'editor');
			} else {
				assert.fail('Manca il recovery sul passo di chiusura');
			}
		});

		it('chiude la scelta multipla con nota via Other + editor per preservarla', () => {
			const q = question({
				multi: true,
				selectedOptions: new Set(['PostgreSQL']),
				note: 'vedi doc',
				touched: true
			});
			const steps = buildQuestionSteps(q);
			assert.deepEqual(steps, [
				{
					method: 'select',
					value: 'PostgreSQL',
					signature: optionSignature(['SQLite', 'PostgreSQL', 'MySQL'])
				},
				{
					method: 'select',
					value: OTHER_LABEL,
					signature: optionSignature(['SQLite', 'PostgreSQL', 'MySQL'])
				},
				{
					method: 'editor',
					value: 'vedi doc'
				}
			]);
		});

		it('invia il testo personalizzato quando l utente scrive in "Altro"', () => {
			const q = question({
				isCustom: true,
				touched: true,
				customInput: '  Soluzione ibrida  ',
				note: 'vedi doc'
			});
			const steps = buildQuestionSteps(q);
			assert.deepEqual(steps, [
				{
					method: 'select',
					value: 'Soluzione ibrida (nota: vedi doc)',
					signature: optionSignature(['SQLite', 'PostgreSQL', 'MySQL'])
				}
			]);
		});

		it('concatena i passi di tutte le domande nel piano del wizard', () => {
			const first = question({ selectedOptions: new Set(['PostgreSQL']), touched: true });
			const second = question({
				multi: true,
				selectedOptions: new Set(['SQLite']),
				touched: true
			});
			const plan = buildFlushPlan([first, second]);
			assert.ok(plan);
			assert.equal(plan.length, 3);
			assert.equal(plan[0].value, 'PostgreSQL');
			assert.equal(plan[1].value, 'SQLite (Recommended)');
			assert.equal(plan[2].value, DONE_SENTINEL);
		});
	});

	describe('Verifica di corrispondenza delle richieste (stepAcceptsRequest)', () => {
		const sig1 = optionSignature(['SQLite', 'PostgreSQL']);
		const sig2 = optionSignature(['JWT', 'Session cookies']);

		it('accetta una select solo se la firma combacia', () => {
			const step: AskFlushStep = { method: 'select', value: 'SQLite', signature: sig1 };
			assert.equal(stepAcceptsRequest(step, { method: 'select', signature: sig1 }), true);
			assert.equal(stepAcceptsRequest(step, { method: 'select', signature: sig2 }), false);
			assert.equal(stepAcceptsRequest(step, { method: 'editor', signature: sig1 }), false);
		});

		it('accetta editor o input per passi editor', () => {
			const step: AskFlushStep = { method: 'editor', value: 'testo nota' };
			assert.equal(stepAcceptsRequest(step, { method: 'editor', signature: '' }), true);
			assert.equal(stepAcceptsRequest(step, { method: 'input', signature: '' }), true);
			assert.equal(stepAcceptsRequest(step, { method: 'select', signature: sig1 }), false);
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
		it('la nota formattata viene riletta separata dall opzione', () => {
			const [step] = buildQuestionSteps(
				question({
					selectedOptions: new Set(['PostgreSQL']),
					note: 'robusto per multi-utenza',
					touched: true
				})
			);
			assert.equal(step.method, 'select');
			assert.deepEqual(extractNoteFromLabel(step.value), {
				clean: 'PostgreSQL',
				note: 'robusto per multi-utenza'
			});
		});

		it('preserva etichette prive di nota', () => {
			assert.deepEqual(extractNoteFromLabel('PostgreSQL'), { clean: 'PostgreSQL' });
		});

		it('legge anche la forma inglese (note: ...)', () => {
			assert.deepEqual(extractNoteFromLabel('JWT (note: include refresh token)'), {
				clean: 'JWT',
				note: 'include refresh token'
			});
		});
	});

	describe('Simulazione ordine invertito (richiesta prima degli argomenti)', () => {
		const toolArgs = {
			questions: [
				{
					id: 'storage_type',
					question: 'Quale storage backend?',
					options: [{ label: 'SQLite (Recommended)' }, { label: 'PostgreSQL' }]
				},
				{
					id: 'auth_method',
					question: 'Quale autenticazione?',
					options: [{ label: 'JWT' }, { label: 'Session cookies' }]
				}
			]
		};

		it('arricchisce la richiesta nuda e consegna il piano a entrambi i round', () => {
			// 1. OMP invia extension_ui_request PRIMA di tool_execution_start
			const bareRequest = {
				id: 'req_1',
				options: ['SQLite (Recommended)', 'PostgreSQL', 'Other (type your own)'],
				method: 'select'
			};
			const bareSig = optionSignature(bareRequest.options);

			// 2. tool_execution_start arriva subito dopo
			const parsedQuestions = parseAskQuestions(toolArgs);
			assert.ok(parsedQuestions);

			// 3. Arricchimento bidirezionale
			const matched = matchQuestionIndex(parsedQuestions, bareSig, 0);
			assert.equal(matched, 0);

			// 4. L'utente compila entrambe le domande nel modulo completo
			const q1: AnswerableQuestion = {
				options: parsedQuestions[0].options.map((o) => option(o.label)),
				multi: false,
				selectedOptions: new Set(['SQLite']),
				note: '',
				customInput: '',
				isCustom: false,
				touched: true,
				visited: true
			};
			const q2: AnswerableQuestion = {
				options: parsedQuestions[1].options.map((o) => option(o.label)),
				multi: false,
				selectedOptions: new Set(['JWT']),
				note: 'senza refresh',
				customInput: '',
				isCustom: false,
				touched: true,
				visited: true
			};

			const plan = buildFlushPlan([q1, q2]);
			assert.ok(plan);
			assert.equal(plan.length, 2);

			// 5. La prima risposta viene spedita a req_1
			const [firstStep, ...rest] = plan;
			assert.equal(firstStep.value, 'SQLite (Recommended)');
			assert.equal(stepAcceptsRequest(firstStep, { method: 'select', signature: bareSig }), true);

			// 6. La seconda richiesta arriva da OMP
			const secondReq = {
				id: 'req_2',
				options: ['JWT', 'Session cookies', 'Other (type your own)'],
				method: 'select'
			};
			const secondSig = optionSignature(secondReq.options);
			const secondStep = rest[0];
			assert.equal(secondStep.value, 'JWT (nota: senza refresh)');
			assert.equal(stepAcceptsRequest(secondStep, { method: 'select', signature: secondSig }), true);
		});
	});
});
