/**
 * Obiettivo guidato nella chat GUI: intervista deterministica, controlli della
 * bozza (criterio vago, tetto mancante), markdown per `goal create`, tetto di
 * tentativi, proposte dell'agente via estensione `studio-goal`, routing di
 * `/guided-goal` e `/goal` e cancello della coda con un obiettivo attivo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { useLocale } from './locale.ts';
import {
	GOAL_FIELDS,
	answerCurrent,
	canLaunch,
	currentQuestion,
	defaultGoalQuestions,
	draftIssues,
	emptyDraft,
	fieldStates,
	goalMarkdown,
	goalSection,
	goalTitle,
	isVagueCriterion,
	mergeAgentSuggestions,
	parseAgentSuggestions,
	parseAttemptCap,
	parseBoundaries,
	parseCap,
	parseFreeAnswer,
	parseStudioGoalStatus,
	setIdea,
	shouldPauseForCap,
	skipCurrent,
	startInterview,
	suggestCommand,
	type GoalDraft
} from '../src/lib/agent/guidedGoal.ts';
import { routeGoalSlash } from '../src/lib/agent/slashRouter.ts';
import { routeComposerSubmit } from '../src/lib/agent/composerSubmit.ts';
import { resolveAutomationGate, type GuiGateSnapshot } from '../src/lib/agent/automationGate.ts';
import studioGoalExtension, {
	buildSuggestPrompt,
	detectProjectHints,
	extractJson,
	parseSuggestArgs,
	runSuggest
} from '../extensions/studio-goal.ts';

useLocale('it');

function fullDraft(overrides: Partial<GoalDraft> = {}): GoalDraft {
	return {
		objective: 'Avvio a freddo di Studio sotto 800 ms',
		criteria: ['Mediana di 5 avvii a freddo sotto 800 ms con `npm run bench:startup`'],
		verification: ['npm run bench:startup -- --runs 5', 'npm test'],
		attempts: 5,
		tokenBudget: 400_000,
		allowed: ['src/lib/**'],
		forbidden: ['nuove dipendenze'],
		stop: ['Dopo 2 tentativi senza miglioramento, fermati e chiedimi'],
		...overrides
	};
}

describe('Obiettivo guidato: criteri vaghi', () => {
	it('segnala «più veloce» senza soglia e accetta numeri, test ed exit code', () => {
		assert.equal(isVagueCriterion("L'avvio è più veloce"), true);
		assert.equal(isVagueCriterion('Rendi il codice più pulito'), true);
		assert.equal(isVagueCriterion('Make startup faster'), true);
		assert.equal(isVagueCriterion('Avvio più veloce: sotto 800 ms'), false);
		assert.equal(isVagueCriterion('Ottimizza finché `npm test` è verde'), false);
		assert.equal(isVagueCriterion('Il comando termina con exit 0'), false);
		assert.equal(isVagueCriterion('Nessun test rotto'), false);
		assert.equal(isVagueCriterion(''), false);
	});
});

describe('Obiettivo guidato: risposte libere', () => {
	it('legge tentativi e token in tutte le forme comuni', () => {
		assert.deepEqual(parseCap('5 tentativi · 400k token'), { attempts: 5, tokenBudget: 400_000 });
		assert.deepEqual(parseCap('10 attempts / 1M tokens'), { attempts: 10, tokenBudget: 1_000_000 });
		assert.deepEqual(parseCap('3, 200k'), { attempts: 3, tokenBudget: 200_000 });
		assert.deepEqual(parseCap('budget 250.000 token, 4 giri'), { attempts: 4, tokenBudget: 250_000 });
		assert.deepEqual(parseCap('quando vuoi'), { attempts: null, tokenBudget: null });
	});

	it('separa confini consentiti e vietati', () => {
		assert.deepEqual(parseBoundaries('Solo src/lib e startup.rs, niente nuove dipendenze'), {
			allowed: ['src/lib e startup.rs'],
			forbidden: ['nuove dipendenze']
		});
		assert.deepEqual(parseBoundaries('Consentito: src/**\nVietato: Cargo.toml'), {
			allowed: ['src/**'],
			forbidden: ['Cargo.toml']
		});
		assert.deepEqual(parseBoundaries('Only the frontend; never touch Rust'), {
			allowed: ['the frontend'],
			forbidden: ['touch Rust']
		});
	});

	it('trasforma il testo libero nel valore del campo', () => {
		assert.deepEqual(parseFreeAnswer('verification', 'npm test\nnpm run check'), {
			field: 'verification',
			items: ['npm test', 'npm run check']
		});
		assert.deepEqual(parseFreeAnswer('stop', '- dopo 3 fallimenti; se tocchi il protocollo'), {
			field: 'stop',
			items: ['dopo 3 fallimenti', 'se tocchi il protocollo']
		});
		assert.equal(parseFreeAnswer('criteria', '   '), null);
	});
});

describe('Obiettivo guidato: intervista deterministica', () => {
	it('cinque domande nell’ordine della striscia, ognuna con una consigliata', () => {
		const questions = defaultGoalQuestions();
		assert.deepEqual(
			questions.map((q) => q.field),
			[...GOAL_FIELDS]
		);
		for (const question of questions) {
			assert.ok(question.question.length > 0);
			assert.equal(question.options.filter((o) => o.recommended).length, 1, question.field);
		}
	});

	it('usa i comandi del progetto quando li conosce', () => {
		const [, verification] = defaultGoalQuestions({ testCommand: 'npm test', checkCommand: 'npm run check' });
		assert.deepEqual(verification.options[0].value, { field: 'verification', items: ['npm test', 'npm run check'] });
	});

	it('senza idea chiede prima cosa ottenere, poi parte dai criteri', () => {
		let interview = startInterview('gg-1', '');
		assert.equal(interview.phase, 'idea');
		assert.equal(currentQuestion(interview), null);
		interview = setIdea(interview, 'Rendi più veloce l’avvio');
		assert.equal(interview.phase, 'asking');
		assert.equal(interview.draft.objective, 'Rendi più veloce l’avvio');
		assert.equal(currentQuestion(interview)?.field, 'criteria');
	});

	it('le proposte consigliate portano a una bozza avviabile', () => {
		let interview = startInterview('gg-2', 'Rendi più veloce l’avvio');
		for (let i = 0; i < GOAL_FIELDS.length; i++) {
			const question = currentQuestion(interview)!;
			const option = question.options.find((o) => o.recommended)!;
			interview = answerCurrent(interview, option.value);
		}
		assert.equal(interview.phase, 'draft');
		assert.equal(interview.draft.attempts, 5);
		assert.equal(interview.draft.tokenBudget, 400_000);
		assert.equal(canLaunch(interview.draft), true);
		assert.ok(Object.values(fieldStates(interview)).every((state) => state === 'done'));
	});

	it('un criterio vago o un tetto saltato bloccano l’avvio e restano gialli nella striscia', () => {
		let interview = startInterview('gg-3', 'Rendi più veloce l’avvio');
		interview = answerCurrent(interview, { field: 'criteria', items: ["L'avvio è più veloce"] });
		assert.equal(fieldStates(interview).criteria, 'warn', 'criterio vago: giallo gia\' durante l\'intervista');
		interview = answerCurrent(interview, { field: 'verification', items: ['npm test'] });
		interview = skipCurrent(interview);
		assert.equal(currentQuestion(interview)?.field, 'boundaries');
		interview = skipCurrent(interview);
		interview = skipCurrent(interview);
		assert.equal(interview.phase, 'draft');
		const issues = draftIssues(interview.draft);
		assert.ok(issues.some((i) => i.field === 'criteria' && i.blocking && i.message.includes('più veloce')));
		assert.ok(issues.some((i) => i.field === 'cap' && i.blocking));
		assert.ok(issues.some((i) => i.field === 'boundaries' && !i.blocking));
		assert.equal(canLaunch(interview.draft), false);
		const states = fieldStates(interview);
		assert.equal(states.criteria, 'warn');
		assert.equal(states.cap, 'warn');
		assert.equal(states.verification, 'done');
	});

	it('la bozza vuota elenca tutti i problemi bloccanti', () => {
		const fields = draftIssues(emptyDraft()).filter((i) => i.blocking).map((i) => i.field);
		assert.deepEqual(fields, ['objective', 'criteria', 'verification', 'cap']);
		assert.equal(canLaunch(fullDraft()), true);
	});
});

describe('Obiettivo guidato: markdown per goal create', () => {
	it('sezioni fisse come il prompt di omp, tetto di tentativi nelle condizioni di stop', () => {
		const md = goalMarkdown(fullDraft());
		assert.match(md, /^## Objective\nAvvio a freddo di Studio sotto 800 ms\n/);
		assert.ok(md.includes('## Success criteria\n- Mediana di 5 avvii'));
		assert.ok(md.includes('## Verification\n- npm run bench:startup -- --runs 5\n- npm test'));
		assert.ok(md.includes('## Boundaries\n- Allowed: src/lib/**\n- Forbidden: nuove dipendenze'));
		assert.ok(md.includes('## Stop conditions\n- Dopo 2 tentativi'));
		assert.equal(parseAttemptCap(md), 5);
		assert.equal(goalTitle(md), 'Avvio a freddo di Studio sotto 800 ms');
		assert.deepEqual(goalSection(md, 'verification'), ['npm run bench:startup -- --runs 5', 'npm test']);
	});

	it('senza confini la sezione non c’e’; un obiettivo libero usa la prima riga come titolo', () => {
		const md = goalMarkdown(fullDraft({ allowed: [], forbidden: [] }));
		assert.ok(!md.includes('## Boundaries'));
		assert.equal(goalTitle('Sistema i test rotti\naltre note'), 'Sistema i test rotti');
		assert.equal(parseAttemptCap('Sistema i test rotti'), null);
	});

	it('pausa al tetto solo con obiettivo attivo e tentativi esauriti', () => {
		assert.equal(shouldPauseForCap(5, 5, 'active'), true);
		assert.equal(shouldPauseForCap(4, 5, 'active'), false);
		assert.equal(shouldPauseForCap(5, 5, 'paused'), false);
		assert.equal(shouldPauseForCap(9, null, 'active'), false);
	});
});

describe('Obiettivo guidato: proposte dell’agente', () => {
	const agentJson = {
		objective: 'Avvio a freddo sotto 800 ms',
		questions: [
			{
				field: 'criteria',
				question: 'Come capiamo che l’avvio è più veloce?',
				options: [
					{ label: 'Mediana di 5 avvii sotto 800 ms', recommended: true },
					{ label: 'Primo frame sotto 1 s' }
				]
			},
			{
				field: 'cap',
				question: 'Quanti tentativi?',
				options: [{ label: '4 tentativi · 300k token', attempts: 4, tokenBudget: 300000 }]
			},
			{ field: 'inventato', question: 'x', options: [{ label: 'y' }] },
			{ field: 'stop', question: 'senza opzioni', options: [] }
		]
	};

	it('scarta campi sconosciuti e domande senza opzioni', () => {
		const parsed = parseAgentSuggestions(agentJson)!;
		assert.deepEqual(
			parsed.questions.map((q) => q.field),
			['criteria', 'cap']
		);
		assert.deepEqual(parsed.questions[1].options[0].value, { field: 'cap', attempts: 4, tokenBudget: 300_000 });
		assert.equal(parseAgentSuggestions({ questions: 'no' }), null);
	});

	it('sostituisce solo le domande non ancora risposte e affina l’obiettivo', () => {
		let interview = startInterview('gg-4', 'Rendi più veloce l’avvio');
		interview = answerCurrent(interview, currentQuestion(interview)!.options[0].value);
		const merged = mergeAgentSuggestions(interview, parseAgentSuggestions(agentJson)!);
		assert.equal(merged.agent, 'ready');
		assert.equal(merged.questions[0].fromAgent, undefined, 'criteri gia\' risposti: restano quelli fissi');
		assert.equal(merged.questions[2].fromAgent, true);
		assert.equal(merged.draft.objective, 'Avvio a freddo sotto 800 ms');
	});

	it('legge la risposta dell’estensione solo per la richiesta giusta', () => {
		const text = JSON.stringify({ type: 'suggestions', requestId: 'gg-4', suggestions: agentJson });
		const status = parseStudioGoalStatus(text);
		assert.equal(status?.type, 'suggestions');
		assert.equal(status?.requestId, 'gg-4');
		assert.equal(parseStudioGoalStatus('{"type":"error","requestId":"gg-9","message":"x"}')?.type, 'error');
		assert.equal(parseStudioGoalStatus('non json'), null);
		assert.equal(parseStudioGoalStatus(undefined), null);
	});

	it('il comando verso l’estensione e il suo parser si capiscono', () => {
		const command = suggestCommand('gg-5', 'Rendi "più" veloce', 'it');
		assert.ok(command.startsWith('/studio-goal suggest '));
		const args = command.slice('/studio-goal '.length);
		assert.deepEqual(parseSuggestArgs(args), { requestId: 'gg-5', idea: 'Rendi "più" veloce', locale: 'it' });
		assert.equal(parseSuggestArgs('suggest {rotto'), null);
		assert.equal(parseSuggestArgs('altro'), null);
	});
});

describe('Estensione studio-goal', () => {
	it('rileva i comandi del progetto senza eseguirli', () => {
		const dir = mkdtempSync(join(tmpdir(), 'studio-goal-'));
		try {
			writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node t.mjs', check: 'svelte-check', lint: 'eslint .' } }));
			assert.deepEqual(detectProjectHints(dir), {
				testCommand: 'npm test',
				checkCommand: 'npm run check',
				lintCommand: 'npm run lint'
			});
			rmSync(join(dir, 'package.json'));
			writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x"\n');
			assert.deepEqual(detectProjectHints(dir), { testCommand: 'cargo test' });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('il prompt chiede solo JSON con i cinque campi e la lingua dell’utente', () => {
		const prompt = buildSuggestPrompt({ requestId: 'r', idea: 'Avvio rapido', locale: 'it' }, { testCommand: 'npm test' });
		for (const field of GOAL_FIELDS) assert.ok(prompt.includes(`"field":"${field}"`), field);
		assert.ok(prompt.includes('Italian'));
		assert.ok(prompt.includes('npm test'));
	});

	it('estrae il JSON anche con recinti e testo attorno', () => {
		assert.deepEqual(extractJson('Ecco:\n```json\n{"a":1}\n```'), { a: 1 });
		assert.equal(extractJson('niente'), null);
	});

	it('turno a margine: risposta valida, errore e omp senza side turn', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'studio-goal-'));
		try {
			const request = { requestId: 'gg-7', idea: 'Avvio rapido', locale: 'it' };
			const ok = await runSuggest(request, {
				cwd: dir,
				runEphemeralTurn: async () => ({ replyText: '{"questions":[{"field":"stop","question":"Quando?","options":[{"label":"Dopo 2"}]}]}' })
			});
			assert.equal(ok.type, 'suggestions');
			const parsed = parseStudioGoalStatus(JSON.stringify(ok));
			assert.equal(parsed?.type, 'suggestions');
			const failed = await runSuggest(request, {
				cwd: dir,
				runEphemeralTurn: async () => {
					throw new Error('provider giu\'');
				}
			});
			assert.deepEqual(failed, { type: 'error', requestId: 'gg-7', message: "provider giu'" });
			const unavailable = await runSuggest(request, { cwd: dir });
			assert.equal(unavailable.type, 'error');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('registra il comando studio-goal e risponde su setStatus', async () => {
		const commands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
		studioGoalExtension({ registerCommand: (name, command) => commands.set(name, command.handler) });
		const handler = commands.get('studio-goal');
		assert.ok(handler);
		const statuses: Array<[string, string | undefined]> = [];
		await handler!('suggest {"requestId":"gg-8","idea":"x","locale":"en"}', {
			cwd: tmpdir(),
			ui: { setStatus: (key: string, text: string | undefined) => statuses.push([key, text]) },
			runEphemeralTurn: async () => ({ replyText: '{"questions":[]}' })
		});
		await new Promise((resolve) => setTimeout(resolve, 120));
		assert.equal(statuses[0]?.[0], 'studio.goal');
		assert.equal(JSON.parse(statuses[0][1]!).requestId, 'gg-8');
		assert.deepEqual(statuses[1], ['studio.goal', undefined], 'lo stato si azzera subito dopo');
	});
});

describe('Obiettivo guidato: slash e coda', () => {
	it('/guided-goal e /goal non arrivano mai al modello', () => {
		assert.deepEqual(routeGoalSlash('/guided-goal rendi veloce l’avvio'), { kind: 'interview', idea: 'rendi veloce l’avvio' });
		assert.deepEqual(routeGoalSlash('/Guided-Goal'), { kind: 'interview', idea: '' });
		assert.deepEqual(routeGoalSlash('/goal'), { kind: 'default' });
		assert.deepEqual(routeGoalSlash('/goal pause'), { kind: 'pause' });
		assert.deepEqual(routeGoalSlash('/goal stop'), { kind: 'drop' });
		assert.deepEqual(routeGoalSlash('/goal set sistema i test'), { kind: 'create', objective: 'sistema i test' });
		assert.deepEqual(routeGoalSlash('/goal sistema i test'), { kind: 'create', objective: 'sistema i test' });
		assert.deepEqual(routeGoalSlash('/goal budget 200k'), { kind: 'budget', argument: '200k' });
		assert.equal(routeGoalSlash('/goals'), null);
		assert.equal(routeComposerSubmit('/guided-goal rendi veloce l’avvio').kind, 'studio');
		assert.equal(routeComposerSubmit('/goal sistema i test').kind, 'studio');
	});

	it('con un obiettivo attivo la sessione è occupata anche fra un turno e l’altro', () => {
		const session: GuiGateSnapshot = {
			ready: true,
			attached: true,
			streaming: false,
			compacting: false,
			blockingQuestion: null,
			quotaBlock: null,
			inferencePending: false,
			inferredQuestion: null
		};
		assert.equal(resolveAutomationGate({ surface: 'gui', busy: false, session }).ready, true);
		const held = resolveAutomationGate({ surface: 'gui', busy: false, session: { ...session, goalHold: true } });
		assert.equal(held.ready, false);
		assert.equal(held.autoDispatchReady, false);
		assert.equal(held.block, 'working');
		assert.equal(held.label, 'Obiettivo attivo');
	});
});
