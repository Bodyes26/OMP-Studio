// Modalita' Piano della chat GUI (Gate R3X-plan): parser della revisione,
// sezioni, decisione, ordine del passaggio, guardia dell'estensione e
// orchestrazione del controller su una sessione finta.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
	PLAN_EXEC_MODES,
	PLAN_REVIEW_TITLE_PREFIX,
	availableExecRoles,
	buildApprovedPrompt,
	buildCompactInstructions,
	buildPlanOutline,
	buildRefineFeedback,
	composePlan,
	encodePlanDecision,
	execModeForKey,
	headingsFromToolArgs,
	isPlanWriteTool,
	parseApprovedPlanMessage,
	parsePlanReviewRequest,
	parsePlanStatus,
	planHandoffSteps,
	planSaveFileName,
	planWasEdited,
	reanchorEntries,
	splitPlanSections
} from '../src/lib/agent/planMode.ts';
import { routePlanSlash, routeSessionSlash } from '../src/lib/agent/slashRouter.ts';
import { isPlanToggleChord } from '../src/lib/agent/composerShortcuts.ts';
import { STUDIO_SLASH_COMMANDS, mergeCommands } from '../src/lib/agent/commands.ts';
import studioPlanExtension, {
	PLAN_MODE_ACTIVE_PROMPT,
	PLAN_STATE_ENTRY,
	PLAN_STATUS_KEY,
	PLAN_SUBMIT_TOOL,
	decisionResultText,
	evaluatePlanToolCall,
	isGuiHost,
	isPlanWritablePath,
	normalizePlanSlug,
	parseDecision,
	planSaveFileName as extensionPlanSaveFileName,
	planState,
	resetPlanState,
	resolveLocalRoot,
	restoreFromEntries,
	savePlanCopy
} from '../extensions/studio-plan.ts';
import { PlanController, planCards, setPlanHost, setPlanRoleSource } from '../src/lib/agent/planController.svelte.ts';

// Ruoli finti: `plan` e `smol` configurati, come nelle impostazioni modelli.
setPlanRoleSource({
	ensureLoaded: async () => {},
	roles: () => ({ plan: 'p/opus:high', smol: 'p/flash', default: 'p/sonnet' }),
	knownSelectors: () => undefined
});

const PLAN = `# Esportazione CSV delle sessioni

## Contesto

Serve esportare lo storico.

## Approccio

1. Aggiungi \`export_session_csv\`.
2. Registra il comando.

\`\`\`md
## non e' un titolo
\`\`\`

## File critici

- \`src-tauri/src/session_export.rs\`

## Verifica

\`npm test\`

## Assunzioni

Separatore virgola.
`;

describe('Piano: richiesta di revisione e stato', () => {
	it('riconosce il titolo studio-plan-review e legge il piano precompilato', () => {
		const meta = { v: 1, slug: 'export-csv', title: 'Export CSV', planFilePath: 'local://export-csv-plan.md', localPath: '/tmp/x/export-csv-plan.md' };
		const parsed = parsePlanReviewRequest(`${PLAN_REVIEW_TITLE_PREFIX}${JSON.stringify(meta)}`, PLAN);
		assert.deepEqual(parsed, {
			slug: 'export-csv',
			title: 'Export CSV',
			planFilePath: 'local://export-csv-plan.md',
			localPath: '/tmp/x/export-csv-plan.md',
			content: PLAN
		});
	});

	it('ignora gli editor qualunque e i meta rotti', () => {
		assert.equal(parsePlanReviewRequest('Modifica il messaggio', 'ciao'), null);
		assert.equal(parsePlanReviewRequest(`${PLAN_REVIEW_TITLE_PREFIX}{rotto`, PLAN), null);
		assert.equal(parsePlanReviewRequest(undefined, PLAN), null);
	});

	it('legge lo stato pubblicato con setStatus', () => {
		assert.deepEqual(parsePlanStatus('{"enabled":true,"planFilePath":"local://a-plan.md","title":"A"}'), {
			enabled: true,
			planFilePath: 'local://a-plan.md',
			title: 'A'
		});
		assert.equal(parsePlanStatus(undefined), null);
		assert.equal(parsePlanStatus('non json'), null);
	});
});

describe('Piano: sezioni, modifiche e commenti', () => {
	it('divide sui ## e non sui titoli dentro i blocchi di codice', () => {
		const doc = splitPlanSections(PLAN);
		assert.deepEqual(
			doc.sections.map((section) => section.heading),
			['Contesto', 'Approccio', 'File critici', 'Verifica', 'Assunzioni']
		);
		assert.match(doc.preamble, /^# Esportazione CSV/);
		assert.match(doc.sections[1].body, /## non e' un titolo/);
	});

	it('senza titoli il piano resta un blocco unico', () => {
		const doc = splitPlanSections('solo testo\nsenza titoli');
		assert.equal(doc.sections.length, 0);
		assert.equal(doc.preamble, 'solo testo\nsenza titoli');
	});

	it('ricompone il piano con eliminazioni e corpi riscritti', () => {
		const doc = splitPlanSections(PLAN);
		const edits = { deleted: new Set([doc.sections[4].id]), bodies: { [doc.sections[0].id]: 'Nuovo contesto.' } };
		assert.equal(planWasEdited(edits, doc), true);
		const out = composePlan(doc, edits);
		assert.match(out, /## Contesto\n\nNuovo contesto\./);
		assert.doesNotMatch(out, /## Assunzioni/);
		assert.match(out, /## Verifica/);
		assert.equal(planWasEdited({ deleted: new Set(), bodies: {} }, doc), false);
		// Senza modifiche la ricomposizione e' fedele (a meno degli a capo finali).
		assert.equal(composePlan(doc, { deleted: new Set(), bodies: {} }).trim(), PLAN.trim());
	});

	it('i commenti diventano il testo di «Chiedi modifiche»', () => {
		const doc = splitPlanSections(PLAN);
		const feedback = buildRefineFeedback(
			doc,
			{ [doc.sections[1].id]: ['usa il punto e virgola', '  '] },
			new Set([doc.sections[4].id]),
			{ intro: 'Modifica il piano:', deleted: 'sezione da togliere' }
		);
		assert.equal(
			feedback,
			'Modifica il piano:\n· Approccio: usa il punto e virgola\n· Assunzioni: sezione da togliere'
		);
		assert.equal(buildRefineFeedback(doc, {}, new Set(), { intro: 'x', deleted: 'y' }), '');
	});
});

describe('Piano: strade, tasti e passaggio', () => {
	it('la prima strada (tasto 1, preselezionata) e\' la nuova sessione pulita', () => {
		assert.deepEqual([...PLAN_EXEC_MODES], ['fresh', 'lane', 'compact', 'keep']);
		assert.equal(execModeForKey('1'), 'fresh');
		assert.equal(execModeForKey('2'), 'lane');
		assert.equal(execModeForKey('4'), 'keep');
		assert.equal(execModeForKey('5'), null);
		assert.equal(execModeForKey('a'), null);
	});

	it('propone solo i ruoli configurati, default sempre', () => {
		assert.deepEqual(availableExecRoles({ smol: 'p/flash', task: '' }), ['smol', 'default']);
		assert.deepEqual(availableExecRoles({}), ['default']);
	});

	it('i passi seguono la strada scelta', () => {
		assert.deepEqual(planHandoffSteps('fresh', true), ['save', 'exit', 'new-session', 'role', 'deliver']);
		assert.deepEqual(planHandoffSteps('lane', true), ['save', 'exit', 'create-lane', 'start-lane', 'role', 'deliver']);
		assert.deepEqual(planHandoffSteps('compact', false), ['exit', 'compact', 'role', 'deliver']);
		assert.deepEqual(planHandoffSteps('keep', false), ['exit', 'role', 'deliver']);
	});

	it('la decisione viaggia come JSON compatto e l\'estensione la rilegge', () => {
		const raw = encodePlanDecision({ action: 'approve', mode: 'lane', role: 'smol', autosave: true });
		assert.equal(raw, '{"action":"approve","mode":"lane","role":"smol","autosave":true}');
		assert.deepEqual(parseDecision(raw), {
			action: 'approve',
			mode: 'lane',
			role: 'smol',
			autosave: true,
			feedback: undefined,
			content: undefined
		});
		assert.equal(parseDecision(undefined).action, 'cancel');
		assert.deepEqual(parseDecision('testo libero'), { action: 'refine', feedback: 'testo libero' });
	});

	it('il nome della copia in .omp/plans e\' lo stesso nel frontend e nell\'estensione (regola di omp)', () => {
		for (const title of ['Esportazione CSV delle sessioni', 'plan', 'PyO3 methods', 'a-very-long-title-that-goes-on-and-on-forever']) {
			assert.equal(planSaveFileName(title), extensionPlanSaveFileName(title));
		}
		assert.equal(planSaveFileName('Esportazione CSV'), 'ESPORTAZIONE_CSV_PLAN.md');
		assert.equal(planSaveFileName('plan'), 'PLAN.md');
	});

	it('il primo messaggio dell\'esecuzione incolla il piano e torna card «Piano approvato»', () => {
		const prompt = buildApprovedPrompt({ planFilePath: '.omp/plans/X_PLAN.md', planContent: PLAN, contextPreserved: false });
		assert.match(prompt, /^Plan approved\.\n/);
		assert.doesNotMatch(prompt, /History usable/);
		const parsed = parseApprovedPlanMessage(prompt);
		assert.ok(parsed);
		assert.equal(parsed.planFilePath, '.omp/plans/X_PLAN.md');
		assert.equal(parsed.title, 'Esportazione CSV delle sessioni');
		assert.equal(parsed.sectionCount, 5);
		assert.match(buildApprovedPrompt({ planFilePath: 'p', planContent: 'x', contextPreserved: true }), /History usable/);
		assert.equal(parseApprovedPlanMessage('Plan approved, grazie'), null);
		assert.match(buildCompactInstructions('local://x-plan.md'), /local:\/\/x-plan\.md/);
	});
});

describe('Piano: vassoio e voci del client', () => {
	it('legge i titoli dalle scritture del piano, anche in formato hashline', () => {
		assert.equal(isPlanWriteTool('write', { path: 'local://export-csv-plan.md', content: PLAN }), true);
		assert.equal(isPlanWriteTool('write', { path: 'src/app.ts', content: '## x' }), false);
		assert.equal(isPlanWriteTool('read', { path: 'local://export-csv-plan.md' }), false);
		assert.deepEqual(headingsFromToolArgs({ content: PLAN }), ['Contesto', 'Approccio', 'File critici', 'Verifica', 'Assunzioni']);
		assert.deepEqual(headingsFromToolArgs({ edits: [{ content: '+## Verifica\n+testo' }] }), ['Verifica']);
	});

	it('contorno: cinque sezioni attese, extra in coda, una in scrittura', () => {
		const outline = buildPlanOutline(['Context', 'Approccio', 'Rollout'], ['Verification']);
		assert.deepEqual(
			outline.map((item) => [item.expected, item.heading, item.state]),
			[
				['context', 'Context', 'done'],
				['approach', 'Approccio', 'done'],
				['files', null, 'pending'],
				['verification', 'Verification', 'writing'],
				['assumptions', null, 'pending'],
				[null, 'Rollout', 'done']
			]
		);
	});

	it('le card tornano dopo il loro messaggio quando il transcript si ricostruisce', () => {
		type E = { id: string; messageTs?: number; anchorTs?: number | null };
		const rebuilt: E[] = [
			{ id: 'u1', messageTs: 10 },
			{ id: 'a1', messageTs: 20 },
			{ id: 'a1b', messageTs: 20 },
			{ id: 'u2', messageTs: 30 }
		];
		const client = [
			{ id: 'enter', anchorTs: null },
			{ id: 'doc', anchorTs: 20 },
			{ id: 'lost', anchorTs: 999 }
		];
		assert.deepEqual(
			reanchorEntries<E, E & { anchorTs: number | null }>(rebuilt, client).map((entry) => entry.id),
			['enter', 'u1', 'a1', 'a1b', 'doc', 'u2', 'lost']
		);
	});
});

describe('Piano: comandi e tasti', () => {
	it('/plan e /plan-review passano dal router di Studio', () => {
		assert.deepEqual(routePlanSlash('/plan'), { kind: 'plan', argument: '' });
		assert.deepEqual(routePlanSlash('/Plan aggiungi export'), { kind: 'plan', argument: 'aggiungi export' });
		assert.deepEqual(routePlanSlash('/plan-review'), { kind: 'plan-review' });
		assert.equal(routePlanSlash('/planner'), null);
		assert.equal(routeSessionSlash('/plan'), null);
	});

	it('/plan e /plan-review sono comandi del guscio; /studio-plan resta nascosto', () => {
		const merged = mergeCommands(STUDIO_SLASH_COMMANDS, [
			{ name: 'studio-plan', description: 'interno' },
			{ name: 'tasks', description: 'task' }
		]);
		const names = merged.map((command) => command.name);
		assert.ok(names.includes('plan'));
		assert.ok(names.includes('plan-review'));
		assert.ok(names.includes('tasks'));
		assert.ok(!names.includes('studio-plan'));
	});

	it('Alt+Maiusc+P (Ctrl+Opzione+Maiusc+P su Mac) come app.plan.toggle di omp', () => {
		const base = { altKey: true, ctrlKey: false, metaKey: false, shiftKey: true, code: 'KeyP' };
		assert.equal(isPlanToggleChord(base, false), true);
		assert.equal(isPlanToggleChord({ ...base, shiftKey: false }, false), false);
		assert.equal(isPlanToggleChord({ ...base, ctrlKey: true }, false), false);
		assert.equal(isPlanToggleChord({ ...base, ctrlKey: true }, true), true);
		assert.equal(isPlanToggleChord({ ...base, code: 'KeyO' }, false), false);
	});
});

describe('Estensione studio-plan: guardia di scrittura', () => {
	const cwd = join(tmpdir(), 'progetto-piano');

	it('spenta non blocca nulla', () => {
		assert.equal(evaluatePlanToolCall({ toolName: 'write', input: { path: 'src/a.ts' } }, cwd, false), undefined);
	});

	it('lascia scrivere il piano in local:// e in .omp/plans/', () => {
		assert.equal(evaluatePlanToolCall({ toolName: 'write', input: { path: 'local://x-plan.md' } }, cwd, true), undefined);
		assert.equal(evaluatePlanToolCall({ toolName: 'edit', input: { path: '[local://x-plan.md#AB12]' } }, cwd, true), undefined);
		assert.equal(evaluatePlanToolCall({ toolName: 'write', input: { path: '.omp/plans/X_PLAN.md' } }, cwd, true), undefined);
		assert.equal(isPlanWritablePath(join(cwd, '.omp', 'plans', 'A.md'), cwd), true);
	});

	it('blocca il progetto, gli altri schemi, rinomina ed eliminazione', () => {
		const blocked = (event: { toolName: string; input: Record<string, unknown> }) =>
			evaluatePlanToolCall(event, cwd, true)?.block === true;
		assert.ok(blocked({ toolName: 'write', input: { path: 'src/app.ts' } }));
		assert.ok(blocked({ toolName: 'write', input: { path: '.omp/plans/../../src/app.ts' } }));
		assert.ok(blocked({ toolName: 'write', input: { path: 'skill://x' } }));
		assert.ok(blocked({ toolName: 'ast_edit', input: {} }));
		assert.ok(blocked({ toolName: 'edit', input: { path: 'local://x-plan.md', edits: [{ op: 'update', rename: 'local://y.md' }] } }));
		assert.ok(blocked({ toolName: 'edit', input: { path: 'local://x-plan.md', edits: [{ op: 'delete' }] } }));
		assert.ok(blocked({ toolName: 'edit', input: { input: '*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch' } }));
		assert.match(
			evaluatePlanToolCall({ toolName: 'write', input: { path: 'src/app.ts' } }, cwd, true)?.reason ?? '',
			/read-only/
		);
	});

	it('non tocca bash, read e gli strumenti di sola lettura', () => {
		for (const toolName of ['bash', 'read', 'grep', 'task', PLAN_SUBMIT_TOOL]) {
			assert.equal(evaluatePlanToolCall({ toolName, input: { path: 'src/a.ts' } }, cwd, true), undefined, toolName);
		}
	});
});

describe('Estensione studio-plan: utilita\'', () => {
	it('normalizza lo slug come omp', () => {
		assert.equal(normalizePlanSlug('local://export-csv-plan.md'), 'export-csv');
		assert.equal(normalizePlanSlug('Export CSV!'), 'Export-CSV');
		assert.equal(normalizePlanSlug('../'), null);
	});

	it('si accende solo nel processo GUI', () => {
		assert.equal(isGuiHost(['omp'], { OMP_STUDIO_PLAN: 'gui' }), true);
		assert.equal(isGuiHost(['omp', '--mode', 'rpc-ui'], {}), true);
		assert.equal(isGuiHost(['omp'], {}), false);
		assert.equal(isGuiHost(['omp', '--mode', 'rpc-ui'], { OMP_STUDIO_PLAN: 'off' }), false);
	});

	it('ripristina lo stato dall\'ultima voce di sessione', () => {
		assert.deepEqual(
			restoreFromEntries([
				{ type: 'custom', customType: PLAN_STATE_ENTRY, data: { enabled: true, planFilePath: 'local://a-plan.md', title: 'A' } },
				{ type: 'message' },
				{ type: 'custom', customType: PLAN_STATE_ENTRY, data: { enabled: false, planFilePath: 'local://a-plan.md', title: 'A' } }
			]),
			{ enabled: false, planFilePath: 'local://a-plan.md', title: 'A' }
		);
		assert.equal(restoreFromEntries(undefined).enabled, false);
	});

	it('radice di local:// come omp, corta su Windows con percorsi lunghi', () => {
		assert.equal(resolveLocalRoot('/a/b', 's1', 'linux'), join('/a/b', 'local'));
		const long = `C:/${'x'.repeat(200)}`;
		assert.equal(resolveLocalRoot(long, 'sess:1', 'win32'), join(tmpdir(), 'omp-local', 'sess_1'));
	});

	it('i testi per l\'agente dicono cosa fare dopo', () => {
		assert.match(decisionResultText({ action: 'refine', feedback: 'x' }, 'local://a-plan.md', null), /submit it again/);
		assert.match(decisionResultText({ action: 'approve' }, 'local://a-plan.md', '.omp/plans/A_PLAN.md'), /STOP NOW/);
		assert.match(decisionResultText({ action: 'cancel' }, 'local://a-plan.md', null), /still active/);
		assert.match(PLAN_MODE_ACTIVE_PROMPT, new RegExp(PLAN_SUBMIT_TOOL));
	});
});

describe('Estensione studio-plan: flusso con omp finto', () => {
	let root: string;
	before(() => {
		root = mkdtempSync(join(tmpdir(), 'studio-plan-'));
	});
	after(() => {
		rmSync(root, { recursive: true, force: true });
		resetPlanState();
	});

	it('savePlanCopy non sovrascrive', () => {
		const first = savePlanCopy(root, 'Export CSV', 'uno');
		const second = savePlanCopy(root, 'Export CSV', 'due');
		assert.equal(first, '.omp/plans/EXPORT_CSV_PLAN.md');
		assert.equal(second, '.omp/plans/EXPORT_CSV_PLAN-1.md');
		assert.equal(readFileSync(join(root, '.omp', 'plans', 'EXPORT_CSV_PLAN-1.md'), 'utf8'), 'due');
	});

	it('on → prompt di piano → proposta → modifiche → approvazione', async () => {
		const previous = process.env.OMP_STUDIO_PLAN;
		process.env.OMP_STUDIO_PLAN = 'gui';
		resetPlanState();
		const handlers = new Map<string, (event: Record<string, unknown>, ctx: unknown) => unknown>();
		const commands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
		let tool: { execute: (...args: unknown[]) => Promise<{ content: { text: string }[]; details?: Record<string, unknown>; isError?: boolean }> } | null = null;
		const appended: unknown[] = [];
		let active = ['read', 'write', 'edit', PLAN_SUBMIT_TOOL];
		const zod = {
			object: () => zod,
			string: () => zod,
			optional: () => zod,
			describe: () => zod
		};
		studioPlanExtension({
			zod: zod as never,
			registerTool: (definition: never) => {
				tool = definition;
			},
			registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
				commands.set(name, command.handler);
			},
			on: (event: string, handler: (event: Record<string, unknown>, ctx: unknown) => unknown) => {
				handlers.set(event, handler);
			},
			appendEntry: (_type: string, data: unknown) => appended.push(data),
			getActiveTools: () => active,
			setActiveTools: async (names: string[]) => {
				active = names;
			}
		} as never);

		const statuses: string[] = [];
		const answers: string[] = [];
		const requests: { title: string; prefill?: string }[] = [];
		const artifacts = join(root, 'artifacts');
		mkdirSync(join(artifacts, 'local'), { recursive: true });
		writeFileSync(join(artifacts, 'local', 'export-csv-plan.md'), PLAN);
		const ctx = {
			cwd: root,
			agent: { kind: 'main' },
			sessionManager: { getCwd: () => root, getArtifactsDir: () => artifacts, getSessionId: () => 's1' },
			ui: {
				setStatus: (key: string, text: string | undefined) => {
					if (key === PLAN_STATUS_KEY && text) statuses.push(text);
				},
				notify: () => {},
				editor: async (title: string, prefill?: string) => {
					requests.push({ title, prefill });
					return answers.shift();
				}
			}
		};

		// Spento: niente prompt, lo strumento rifiuta, la guardia non blocca.
		assert.equal(handlers.get('before_agent_start')!({ systemPrompt: ['base'] }, ctx), undefined);
		assert.equal((await tool!.execute('t0', { slug: 'export-csv' }, undefined, undefined, ctx)).isError, true);

		await commands.get('studio-plan')!('on', ctx);
		assert.equal(planState().enabled, true);
		assert.deepEqual(JSON.parse(statuses.at(-1)!).enabled, true);
		assert.deepEqual(
			(handlers.get('before_agent_start')!({ systemPrompt: ['base'] }, ctx) as { systemPrompt: string[] }).systemPrompt,
			['base', PLAN_MODE_ACTIVE_PROMPT]
		);
		assert.equal(
			(handlers.get('tool_call')!({ toolName: 'write', input: { path: 'src/a.ts' } }, ctx) as { block?: boolean })?.block,
			true
		);

		// Primo giro: l'utente chiede modifiche e cancella una sezione.
		const edited = PLAN.replace(/## Assunzioni[\s\S]*$/, '');
		answers.push(encodePlanDecision({ action: 'refine', feedback: 'Modifica il piano:\n· Approccio: x', content: edited }));
		const refine = await tool!.execute('t1', { slug: 'export-csv', title: 'Export CSV' }, undefined, undefined, ctx);
		assert.match(requests[0].title, /^studio-plan-review:/);
		assert.equal(JSON.parse(requests[0].title.slice('studio-plan-review:'.length)).planFilePath, 'local://export-csv-plan.md');
		assert.equal(requests[0].prefill, PLAN);
		assert.match(refine.content[0].text, /requested changes/);
		assert.equal(readFileSync(join(artifacts, 'local', 'export-csv-plan.md'), 'utf8'), edited);
		assert.equal(planState().enabled, true);

		// Secondo giro: approvazione con copia in .omp/plans/.
		answers.push(encodePlanDecision({ action: 'approve', mode: 'fresh', role: 'default', autosave: true }));
		const approve = await tool!.execute('t2', { slug: 'export-csv', title: 'Export CSV' }, undefined, undefined, ctx);
		assert.match(approve.content[0].text, /STOP NOW/);
		assert.equal(approve.details?.action, 'approve');
		assert.equal(approve.details?.planContent, edited);
		const saved = approve.details?.savedPath as string;
		assert.ok(saved.startsWith('.omp/plans/EXPORT_CSV_PLAN'));
		assert.ok(readdirSync(join(root, '.omp', 'plans')).length >= 1);
		assert.equal(planState().enabled, false);
		assert.ok(!active.includes(PLAN_SUBMIT_TOOL));
		assert.deepEqual(appended.at(-1), { enabled: false, planFilePath: 'local://export-csv-plan.md', title: 'Export CSV' });

		if (previous === undefined) delete process.env.OMP_STUDIO_PLAN;
		else process.env.OMP_STUDIO_PLAN = previous;
	});
});

describe('Piano: orchestrazione del controller', () => {
	function fakeSession(overrides: Record<string, unknown> = {}) {
		const calls: string[] = [];
		const entries: Record<string, unknown>[] = [];
		const session: Record<string, unknown> = {
			entries,
			sessionId: 'plan-session',
			model: { provider: 'p', id: 'opus', name: 'opus' },
			thinkingLevel: 'high',
			contextUsage: { tokens: 42000, percent: 20 },
			isStreaming: false,
			labConfig: undefined,
			lastPickedRole: null,
			client: {
				send: async (command: { type: string; message?: string }) => {
					calls.push(command.type === 'prompt' ? `send:${command.message}` : `send:${command.type}`);
					return {};
				},
				respondUi: async (response: { value: string }) => {
					calls.push(`respond:${JSON.parse(response.value).action}`);
				}
			},
			prompt: async (text: string) => {
				calls.push(`prompt:${text.split('\n')[0]}`);
				return 'sent';
			},
			newSession: async () => {
				calls.push('newSession');
				entries.length = 0;
				session.sessionId = 'exec-session';
				return 'exec-session';
			},
			compact: async () => {
				calls.push('compact');
				return true;
			},
			refreshState: async () => {},
			waitForIdle: async () => {
				calls.push('waitForIdle');
				return true;
			},
			pushNotice: (level: string, message: string) => calls.push(`notice:${level}:${message}`),
			flashNotice: (level: string, message: string) => calls.push(`flash:${level}:${message}`),
			settleAttention: () => {},
			pushPlanEntry: (variant: string, refId: string) => {
				entries.push({ kind: 'plan', variant, refId });
				calls.push(`entry:${variant}`);
			},
			...overrides
		};
		session.plan = new PlanController(session as never);
		return { session, calls, plan: session.plan as PlanController };
	}

	const review = { slug: 'export-csv', title: 'Export CSV', planFilePath: 'local://export-csv-plan.md', localPath: null, content: PLAN };

	it('entrata: comando dell\'estensione, riga nel transcript, badge sulla bolla', async () => {
		const { calls, plan } = fakeSession();
		await plan.enter('aggiungi export');
		assert.equal(plan.active, true);
		assert.deepEqual(calls.slice(0, 2), ['send:/studio-plan on', 'entry:enter']);
		assert.ok(calls.includes('prompt:aggiungi export'));
		assert.equal(plan.isPlanPrompt({ id: 1, kind: 'user', content: 'aggiungi export', images: [] }), true);
		assert.equal(plan.isPlanPrompt({ id: 2, kind: 'user', content: 'altro', images: [] }), false);
	});

	it('revisione: card del piano, «Chiedi modifiche» rimanda i commenti', async () => {
		const { calls, plan } = fakeSession({ isStreaming: true });
		plan.openReview('req-1', review);
		assert.equal(plan.approvalOpen, true);
		const doc = plan.openDoc!;
		assert.equal(doc.doc.sections.length, 5);
		assert.equal(await plan.refine(), false, 'senza commenti non parte nulla');
		plan.addComment(doc.id, doc.doc.sections[1].id, 'usa il punto e virgola');
		assert.equal(plan.commentCount(doc.id), 1);
		assert.equal(await plan.refine(), true);
		assert.ok(calls.includes('respond:refine'));
		assert.equal(planCards.docs[doc.id].status, 'refining');
		assert.equal(plan.review, null);
	});

	it('approvazione sulla strada predefinita: risposta, fine turno, nuova sessione, ruolo, piano consegnato', async () => {
		setPlanHost({});
		const { calls, plan, session } = fakeSession({ isStreaming: true });
		plan.openReview('req-2', review);
		assert.equal(plan.execMode, 'fresh');
		await plan.approve();
		const order = calls.filter((call) => /^(respond|waitForIdle|newSession|prompt|entry:handoff)/.test(call));
		assert.deepEqual(order, [
			'entry:handoff',
			'respond:approve',
			'waitForIdle',
			'newSession',
			'entry:handoff',
			'prompt:Plan approved.'
		]);
		const card = Object.values(planCards.handoffs).at(-1)!;
		assert.equal(card.status, 'done');
		assert.equal(card.planningSessionId, 'plan-session');
		assert.equal(session.sessionId, 'exec-session');
		assert.ok(card.steps.every((step) => step.state === 'done'));
	});

	it('«compatta e continua» compatta nella stessa sessione con le istruzioni del piano', async () => {
		const { calls, plan } = fakeSession();
		plan.openReview('req-3', review);
		plan.execMode = 'compact';
		await plan.approve();
		const order = calls.filter((call) => /^(respond|waitForIdle|newSession|compact|prompt)/.test(call));
		assert.deepEqual(order, ['respond:approve', 'compact', 'prompt:Plan approved.']);
	});

	it('«nuova corsia» usa il guscio e consegna il piano alla sessione della corsia', async () => {
		const lane = fakeSession();
		setPlanHost({
			createLane: async () => ({ session: lane.session as never, title: 'Export CSV', branch: 'omp/lane-wt-1' })
		});
		const { calls, plan } = fakeSession();
		plan.openReview('req-4', review);
		plan.execMode = 'lane';
		await plan.approve();
		assert.ok(calls.includes('respond:approve'));
		assert.ok(!calls.some((call) => call.startsWith('prompt:')), 'il piano non resta nella sessione di pianificazione');
		assert.ok(lane.calls.includes('prompt:Plan approved.'));
		assert.ok(lane.calls.includes('entry:handoff'));
		const card = Object.values(planCards.handoffs).at(-1)!;
		assert.equal(card.steps.find((step) => step.id === 'create-lane')?.detail, 'omp/lane-wt-1');
		setPlanHost({});
	});

	it('corsia non disponibile: passaggio segnato come non riuscito, nessun prompt', async () => {
		setPlanHost({});
		const { calls, plan } = fakeSession();
		plan.openReview('req-5', review);
		plan.execMode = 'lane';
		await plan.approve();
		const card = Object.values(planCards.handoffs).at(-1)!;
		assert.equal(card.status, 'failed');
		assert.ok(!calls.some((call) => call.startsWith('prompt:')));
		assert.ok(calls.some((call) => call.startsWith('notice:error')));
	});

	it('uscita: revisione chiusa senza decisione e guardia spenta', async () => {
		const { calls, plan } = fakeSession();
		await plan.enter();
		plan.openReview('req-6', review);
		await plan.exit();
		assert.equal(plan.active, false);
		assert.ok(calls.includes('respond:cancel'));
		assert.ok(calls.includes('send:/studio-plan off'));
		assert.ok(calls.includes('entry:exit'));
	});
});
