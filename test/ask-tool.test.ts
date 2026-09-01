import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AskQuestion } from '../src/lib/agent/session.svelte.ts';
import {
	cleanOptionLabel,
	extractNoteFromLabel,
	firstUnansweredIndex,
	formatQuestionAnswer,
	formatWizardAnswers,
	isDoneOption,
	isOtherOption,
	isQuestionAnswered,
	matchQuestionIndex,
	optionSignature,
	type AnswerableOption,
	type AnswerableQuestion
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
			option('Other (type your own)'),
			option('✔ Done selecting')
		],
		multi: false,
		selectedOptions: new Set<string>(),
		note: '',
		customInput: '',
		isCustom: false,
		touched: false,
		// Il caso normale nei test e' una domanda che l'utente ha davanti agli
		// occhi: le prove sulla domanda mai aperta passano `visited: false`.
		visited: true,
		...overrides
	};
}

describe('Ask tool: etichette, note e formattazione risposte', () => {
	describe('Parsing delle etichette', () => {
		it('rimuove il suffisso (Recommended) per il matching pulito', () => {
			assert.equal(cleanOptionLabel('Modifica minima (Recommended)'), 'Modifica minima');
			assert.equal(cleanOptionLabel('Refactor completo'), 'Refactor completo');
		});

		it('riconosce sentinelle di completamento multi-select', () => {
			assert.equal(isDoneOption('✔ Done selecting'), true);
			assert.equal(isDoneOption('Fine selezione'), true);
			assert.equal(isDoneOption('Opzione normale'), false);
		});

		it('riconosce opzioni per risposta personalizzata', () => {
			assert.equal(isOtherOption('Other (type your own)'), true);
			assert.equal(isOtherOption('Altro (scrivi la tua risposta)'), true);
			assert.equal(isOtherOption('Other'), true);
			assert.equal(isOtherOption('OAuth2'), false);
		});
	});

	describe('Nessuna risposta inventata', () => {
		it('una domanda a scelta singola senza selezione non e risposta', () => {
			assert.equal(isQuestionAnswered(question()), false);
		});

		it('formattare una domanda senza risposta e un errore, non la prima opzione', () => {
			// La regressione da difendere: prima veniva restituita `SQLite`
			// anche quando l'utente non aveva scelto niente.
			assert.throws(() => formatQuestionAnswer(question()), /Risposta assente/);
		});

		it('"Altro" senza testo non e una risposta', () => {
			const q = question({ isCustom: true, touched: true, customInput: '   ' });
			assert.equal(isQuestionAnswered(q), false);
			assert.throws(() => formatQuestionAnswer(q), /Risposta assente/);
		});

		it('un wizard incompleto non produce righe da inviare', () => {
			const answered = question({ selectedOptions: new Set(['PostgreSQL']), touched: true });
			assert.equal(formatWizardAnswers([answered, question()]), null);
			assert.equal(firstUnansweredIndex([answered, question()]), 1);
			assert.equal(firstUnansweredIndex([answered]), -1);
		});

		it('la scelta multipla vuota vale "nessuna" solo se la domanda e stata toccata', () => {
			assert.equal(isQuestionAnswered(question({ multi: true })), false);
			assert.equal(isQuestionAnswered(question({ multi: true, touched: true })), true);
		});

		it('la pre-selezione consigliata di una domanda mai aperta non e una risposta', () => {
			// La regressione da difendere: il wizard pre-seleziona l'opzione
			// consigliata di **tutte** le domande. Con quella sola, ogni
			// domanda risultava completata prima di essere letta, il riepilogo
			// dichiarava tutto pronto e l'invio spediva scelte mai viste.
			const mai = question({ selectedOptions: new Set(['SQLite']), visited: false });
			assert.equal(isQuestionAnswered(mai), false);
			assert.throws(() => formatQuestionAnswer(mai), /Risposta assente/);
		});

		it('la stessa pre-selezione vale come risposta appena la domanda e mostrata', () => {
			const vista = question({ selectedOptions: new Set(['SQLite']), visited: true });
			assert.equal(isQuestionAnswered(vista), true);
			assert.deepEqual(formatQuestionAnswer(vista), ['SQLite (Recommended)']);
		});

		it('un wizard con domande mai aperte non parte, e indica la prima', () => {
			const vista = question({ selectedOptions: new Set(['PostgreSQL']) });
			const mai = question({ selectedOptions: new Set(['SQLite']), visited: false });
			assert.equal(formatWizardAnswers([vista, mai, mai]), null);
			assert.equal(firstUnansweredIndex([vista, mai, mai]), 1);
		});

		it('la scelta multipla mai aperta non vale "nessuna" nemmeno se toccata', () => {
			assert.equal(isQuestionAnswered(question({ multi: true, touched: true, visited: false })), false);
		});
	});

	describe('Formattazione delle risposte compilate', () => {
		it('rimanda l etichetta originale dell opzione scelta', () => {
			const q = question({ selectedOptions: new Set(['SQLite']), touched: true });
			assert.deepEqual(formatQuestionAnswer(q), ['SQLite (Recommended)']);
		});

		it('allega la nota alla scelta singola, senza il suffisso Recommended', () => {
			const q = question({
				selectedOptions: new Set(['SQLite']),
				note: '  solo per sviluppo locale  ',
				touched: true
			});
			assert.deepEqual(formatQuestionAnswer(q), ['SQLite (nota: solo per sviluppo locale)']);
		});

		it('chiude la scelta multipla con la sentinella Done', () => {
			const q = question({
				multi: true,
				selectedOptions: new Set(['PostgreSQL', 'SQLite']),
				note: 'vedi doc',
				touched: true
			});
			assert.deepEqual(formatQuestionAnswer(q), [
				'PostgreSQL',
				'SQLite (Recommended)',
				'(nota: vedi doc)',
				'✔ Done selecting'
			]);
		});

		it('invia il testo personalizzato quando l utente scrive in "Altro"', () => {
			const q = question({
				isCustom: true,
				touched: true,
				customInput: '  Soluzione ibrida  ',
				note: 'vedi doc'
			});
			assert.deepEqual(formatQuestionAnswer(q), ['Soluzione ibrida (nota: vedi doc)']);
		});

		it('concatena le righe di tutte le domande in ordine', () => {
			const first = question({ selectedOptions: new Set(['PostgreSQL']), touched: true });
			const second = question({
				multi: true,
				selectedOptions: new Set(['SQLite']),
				touched: true
			});
			assert.deepEqual(formatWizardAnswers([first, second]), [
				'PostgreSQL',
				'SQLite (Recommended)',
				'✔ Done selecting'
			]);
		});
	});

	describe('Round trip con il renderer delle risposte', () => {
		it('la nota formattata viene riletta separata dall opzione', () => {
			const q = question({
				selectedOptions: new Set(['PostgreSQL']),
				note: 'robusto per multi-utenza',
				touched: true
			});
			const [line] = formatQuestionAnswer(q);
			assert.deepEqual(extractNoteFromLabel(line), {
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

	describe('Struttura delle domande strutturate', () => {
		it('valida domande con raccomandazione e opzioni descritte', () => {
			const raw: AskQuestion = {
				id: 'storage_type',
				question: 'Quale storage backend utilizzare?',
				header: 'Storage',
				multi: false,
				recommended: 0,
				options: [
					{ label: 'SQLite (Recommended)', description: 'Leggero e zero configurazione' },
					{ label: 'PostgreSQL', description: 'Robusto per multi-utenza' }
				]
			};

			assert.equal(raw.options.length, 2);
			assert.equal(cleanOptionLabel(raw.options[0].label), 'SQLite');
		});
	});

	// Il protocollo di `ask` e' sequenziale: una richiesta per domanda. Gli
	// argomenti del tool arrivano da un'altra strada (l'entry del tool in
	// esecuzione) e possono riferirsi a un'altra domanda o a un'altra chiamata:
	// senza il riscontro sulle opzioni la risposta finisce nella casella
	// sbagliata.
	describe('Allineamento tra richiesta e domande dichiarate', () => {
		const questions: AskQuestion[] = [
			{
				id: 'storage_type',
				question: 'Quale storage backend?',
				options: [{ label: 'SQLite' }, { label: 'PostgreSQL' }]
			},
			{
				id: 'auth_method',
				question: 'Quale metodo di autenticazione?',
				options: [{ label: 'JWT' }, { label: 'Session cookies' }]
			}
		];

		it('la firma ignora suffisso consigliata e voci aggiunte dal runtime', () => {
			assert.equal(
				optionSignature(['SQLite (Recommended)', 'PostgreSQL', 'Other (type your own)']),
				optionSignature(['SQLite', 'PostgreSQL'])
			);
		});

		it('la firma non cambia quando compare la sentinella di fine selezione', () => {
			assert.equal(
				optionSignature(['JWT', 'Session cookies', '\u2714 Done selecting', 'Other (type your own)']),
				optionSignature(['JWT', 'Session cookies'])
			);
		});

		it('elenchi diversi hanno firme diverse', () => {
			assert.notEqual(optionSignature(['SQLite', 'PostgreSQL']), optionSignature(['JWT', 'Session cookies']));
		});

		it('conferma l indice dichiarato dal titolo quando le opzioni combaciano', () => {
			const signature = optionSignature(['JWT', 'Session cookies', 'Other (type your own)']);
			assert.equal(matchQuestionIndex(questions, signature, 1), 1);
		});

		it('riallinea l indice quando il titolo e le opzioni si contraddicono', () => {
			// Card comparsa alla seconda domanda con indice dichiarato 0: senza
			// riallineamento il wizard mostrerebbe la prima domanda e sposterebbe
			// tutte le risposte di una casella.
			const signature = optionSignature(['JWT', 'Session cookies', 'Other (type your own)']);
			assert.equal(matchQuestionIndex(questions, signature, 0), 1);
		});

		it('rifiuta la lista quando nessuna domanda corrisponde alla richiesta', () => {
			const signature = optionSignature(['Rust', 'Go', 'Other (type your own)']);
			assert.equal(matchQuestionIndex(questions, signature, 0), -1);
		});
	});
});
