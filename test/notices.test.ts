/**
 * Test di unita' per il modulo pure notices.ts:
 * - Parsing envelope <task-result>
 * - Parsing e segmentazione async-result
 * - Classificazione avvisi di sistema (IRC, todo reminder, hidden, chip)
 * - Titoli e deduplicazione
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	classifySystemMessage,
	noticeDedupKey,
	parseAsyncResult,
	parseTaskResultEnvelope,
	stripNoticeWrapper,
	systemNoticeTitle
} from '../src/lib/agent/notices.ts';
import { useLocale } from './locale.ts';

describe('Gestione avvisi di sistema (notices.ts)', () => {
	// Caso 1: envelope con <preview full-output="agent://X">
	it('1. analizza envelope con <preview full-output="agent://X"> valorizzando fullOutputUri, lines, size e statusKind', () => {
		const xml = `<task-result id="agent_123" agent="ScoutAgent" status="completed" duration="1m50s">
<meta lines="26" size="7.4KB" />
<preview full-output="agent://agent_123">
Contenuto anteprima troncata
</preview>
</task-result>`;

		const env = parseTaskResultEnvelope(xml);
		assert.ok(env !== null);
		assert.equal(env.id, 'agent_123');
		assert.equal(env.agent, 'ScoutAgent');
		assert.equal(env.status, 'completed');
		assert.equal(env.statusKind, 'completed');
		assert.equal(env.duration, '1m50s');
		assert.equal(env.lines, 26);
		assert.equal(env.size, '7.4KB');
		assert.equal(env.fullOutputUri, 'agent://agent_123');
		assert.equal(env.body, 'Contenuto anteprima troncata');
	});

	// Caso 2: envelope con <output>
	it('2. analizza envelope con <output> lasciando fullOutputUri indefinito', () => {
		const xml = `<task-result id="task_456" status="completed" duration="431ms">
<output>
Output completo del task
</output>
</task-result>`;

		const env = parseTaskResultEnvelope(xml);
		assert.ok(env !== null);
		assert.equal(env.id, 'task_456');
		assert.equal(env.statusKind, 'completed');
		assert.equal(env.fullOutputUri, undefined);
		assert.equal(env.body, 'Output completo del task');
	});

	// Caso 3: status="failed (exit 1)"
	it('3. preserva lo status grezzo "failed (exit 1)" e imposta statusKind su failed', () => {
		const xml = `<task-result id="task_fail" status="failed (exit 1)">
<output>
Errore fatale di esecuzione
</output>
</task-result>`;

		const env = parseTaskResultEnvelope(xml);
		assert.ok(env !== null);
		assert.equal(env.status, 'failed (exit 1)');
		assert.equal(env.statusKind, 'failed');
	});

	// Caso 4: batch multi-job con separatore ── Job X (etichetta) ──
	it('4. analizza batch multi-job preservando ordine posizionale dichiarato nei details', () => {
		const content = `<system-notice>
2 background jobs have completed. Resume your work using the results below.

── Job SubagentViewScout (etichetta) ──
<task-result id="job_sub_1" status="completed">
<output>
Risultato subagent uno
</output>
</task-result>
── Job MsgRenderScout ──
<task-result id="job_sub_2" status="completed">
<output>
Risultato subagent due
</output>
</task-result>
</system-notice>`;

		const details = {
			jobs: [
				{ jobId: 'job_sub_1', type: 'task' as const, label: 'etichetta' },
				{ jobId: 'job_sub_2', type: 'task' as const }
			]
		};

		const jobs = parseAsyncResult(content, details);
		assert.equal(jobs.length, 2);
		assert.equal(jobs[0].jobId, 'job_sub_1');
		assert.equal(jobs[0].jobType, 'task');
		assert.equal(jobs[0].label, 'etichetta');
		assert.equal(jobs[0].envelope?.body, 'Risultato subagent uno');

		assert.equal(jobs[1].jobId, 'job_sub_2');
		assert.equal(jobs[1].jobType, 'task');
		assert.equal(jobs[1].envelope?.body, 'Risultato subagent due');
	});

	// Caso 5: job type: 'bash'
	it('5. gestisce job bash senza envelope valorizzando il testo grezzo in raw', () => {
		const content = `<system-notice>
Background job bash_cmd has completed. Resume your work using the result below.
file1.ts
file2.ts
</system-notice>`;

		const details = {
			jobs: [{ jobId: 'bash_cmd', type: 'bash' as const, durationMs: 150 }]
		};

		const jobs = parseAsyncResult(content, details);
		assert.equal(jobs.length, 1);
		assert.equal(jobs[0].jobId, 'bash_cmd');
		assert.equal(jobs[0].jobType, 'bash');
		assert.equal(jobs[0].durationMs, 150);
		assert.equal(jobs[0].envelope, undefined);
		assert.match(jobs[0].raw, /file1\.ts\s+file2\.ts/);
	});

	// Caso 6: <abort-reason> e <merge-summary>
	it('6. estrae abort-reason e merge-summary dall\'envelope del task', () => {
		const xml = `<task-result id="task_aborted" status="aborted">
<abort-reason>Timeout superato durante l'attesa del processo</abort-reason>
<output>Log parziale</output>
<merge-summary>Modifiche isolate scartate</merge-summary>
</task-result>`;

		const env = parseTaskResultEnvelope(xml);
		assert.ok(env !== null);
		assert.equal(env.statusKind, 'aborted');
		assert.equal(env.abortReason, "Timeout superato durante l'attesa del processo");
		assert.equal(env.mergeSummary, 'Modifiche isolate scartate');
	});

	// Caso 7: summaryLine da JSON con campo summary e da testo non-JSON
	it('7. ricava summaryLine da JSON.summary oppure dalla prima riga non vuota', () => {
		const jsonXml = `<task-result id="t_json" status="completed">
<output>
{"summary": "Sintesi strutturata del lavoro svolto", "files": 3}
</output>
</task-result>`;
		const envJson = parseTaskResultEnvelope(jsonXml);
		assert.ok(envJson !== null);
		assert.equal(envJson.summaryLine, 'Sintesi strutturata del lavoro svolto');

		const textXml = `<task-result id="t_text" status="completed">
<output>

Prima riga significativa con spazi multipli    e a capo
Seconda riga ignorata
</output>
</task-result>`;
		const envText = parseTaskResultEnvelope(textXml);
		assert.ok(envText !== null);
		assert.equal(envText.summaryLine, 'Prima riga significativa con spazi multipli e a capo');
	});

	// Caso 7b: l'anteprima e' troncata a meta' JSON, il caso piu' frequente.
	// La sintesi non deve degradare nella graffa di apertura.
	it('7b. ricava summaryLine anche da un JSON troncato dall anteprima', () => {
		const troncato = `<task-result id="Scout" agent="scout" status="completed" duration="1m50s">
<meta lines="67" size="15.9KB" />
<preview full-output="agent://Scout">
{
  "architecture": "Tre colonne con splitter ridimensionabili",
  "summary": "Mappatura completa della vista subagenti",
  "files": [
    {
      "path": "src/lib/agent/comp`;
		const env = parseTaskResultEnvelope(troncato);
		assert.ok(env !== null);
		assert.equal(env.summaryLine, 'Mappatura completa della vista subagenti');

		// Senza il campo `summary` nella porzione sopravvissuta si usa il primo
		// valore stringa, che informa comunque piu' della struttura JSON.
		const senzaSummary = `<task-result id="Scout2" status="completed">
<preview full-output="agent://Scout2">
{
  "architecture": "Pipeline unidirezionale reattiva con rune",
  "files": [`;
		const env2 = parseTaskResultEnvelope(senzaSummary);
		assert.ok(env2 !== null);
		assert.equal(env2.summaryLine, 'Pipeline unidirezionale reattiva con rune');

		// Stesso payload spezzato ma con i tag regolarmente chiusi: e' la forma
		// che arriva davvero quando `omp` tronca l'anteprima a 4.000 caratteri.
		const chiuso = `<task-result id="Scout3" agent="scout" status="completed" duration="2m">
<preview full-output="agent://Scout3">
{
  "architecture": "Pipeline unidirezionale reattiva con rune",
  "files": [
    {
      "path": "src/lib/agent/comp
</preview>
</task-result>`;
		const env3 = parseTaskResultEnvelope(chiuso);
		assert.ok(env3 !== null);
		assert.equal(env3.summaryLine, 'Pipeline unidirezionale reattiva con rune');
	});

	// Caso 8: righe di coda dopo </task-result> ignorate
	it('8. ignora le righe di coda aggiunte dopo la chiusura di </task-result>', () => {
		const xml = `<task-result id="worker_sub" status="completed">
<output>Output pulito</output>
</task-result>
worker_sub is now idle — message it via \`hub\` to follow up; transcript at history://worker_sub
Structured output: schema valid; full payload at agent://worker_sub`;

		const env = parseTaskResultEnvelope(xml);
		assert.ok(env !== null);
		assert.equal(env.body, 'Output pulito');
		assert.equal(env.summaryLine, 'Output pulito');
	});

	// Caso 9: irc:incoming da details senza boilerplate
	it('9. costruisce irc:incoming da details escludendo boilerplate o wrapper', () => {
		const classified = classifySystemMessage({
			role: 'custom',
			customType: 'irc:incoming',
			display: true,
			details: {
				id: 'msg_1',
				from: 'CoordinatorAgent',
				message: 'Ciao dal coordinatore, procedi con lo step 2.',
				replyTo: 'init_call'
			},
			text: '<irc>\nIncoming IRC message from agent `CoordinatorAgent`:\nCiao dal coordinatore, procedi con lo step 2.\nSent while waiting for response\n</irc>'
		});

		assert.ok(classified !== null);
		assert.equal(classified.kind, 'irc');
		if (classified.kind === 'irc') {
			assert.equal(classified.direction, 'in');
			assert.equal(classified.peer, 'CoordinatorAgent');
			assert.equal(classified.body, 'Ciao dal coordinatore, procedi con lo step 2.');
			assert.equal(classified.replyTo, 'init_call');
		}
	});

	// Caso 10: irc:incoming con details mancante ricava peer e body dal testo
	it('10. ricava peer e pulisce il body dal testo quando details e\' mancante', () => {
		const rawText = `<irc>
Incoming IRC message from agent \`WorkerBot\`
Sent while waiting/working on the plan.
Active interruptible wait detected.
Hai finito la compilazione del modulo?
If response expected, reply via \`hub\` send.
No one replies on your behalf.
</irc>`;

		const classified = classifySystemMessage({
			role: 'custom',
			customType: 'irc:incoming',
			display: true,
			text: rawText
		});

		assert.ok(classified !== null);
		assert.equal(classified.kind, 'irc');
		if (classified.kind === 'irc') {
			assert.equal(classified.direction, 'in');
			assert.equal(classified.peer, 'WorkerBot');
			assert.equal(classified.body, 'Hai finito la compilazione del modulo?');
		}
	});

	// Caso 11: display: false -> kind: 'hidden'
	it('11. classifica i messaggi con display: false come hidden', () => {
		useLocale('it');
		const classified = classifySystemMessage({
			role: 'custom',
			customType: 'plan-mode-context',
			display: false,
			text: '<system-notice>\nIstruzioni contestuali per la modalita piano\n</system-notice>'
		});

		assert.ok(classified !== null);
		assert.equal(classified.kind, 'hidden');
		if (classified.kind === 'hidden') {
			assert.equal(classified.customType, 'plan-mode-context');
			assert.equal(classified.title, 'Vincoli della modalità piano');
			assert.equal(classified.body, 'Istruzioni contestuali per la modalita piano');
		}
	});

	// Caso 12: promemoria todo multifase
	it('12. analizza promemoria todo multifase estraendo conteggio e tentativi', () => {
		const reminderText = `<system-reminder>
You stopped with 6 incomplete todo item(s):
- NomeFase
  - Task uno
  - Task due

Please continue working on these tasks or mark them complete if finished.
(Reminder 1/3)
</system-reminder>`;

		const classified = classifySystemMessage({
			role: 'developer',
			text: reminderText
		});

		assert.ok(classified !== null);
		assert.equal(classified.kind, 'todo-reminder');
		if (classified.kind === 'todo-reminder') {
			assert.equal(classified.incomplete, 6);
			assert.equal(classified.attempt, 1);
			assert.equal(classified.maxAttempts, 3);
		}
	});

	// Caso 13: variante mid-run todo
	it('13. analizza variante mid-run dei todo senza tentativi', () => {
		const midRunText = '5 todo items still open. If you finished a task since last `todo` update, mark it done now so progress stays visible; otherwise keep working.';

		const classified = classifySystemMessage({
			role: 'developer',
			text: midRunText
		});

		assert.ok(classified !== null);
		assert.equal(classified.kind, 'todo-reminder');
		if (classified.kind === 'todo-reminder') {
			assert.equal(classified.incomplete, 5);
			assert.equal(classified.attempt, undefined);
			assert.equal(classified.maxAttempts, undefined);
		}
	});

	// Caso 14: regressione su tutti i customType noti
	it('14. regressione: tutti i customType noti vengono classificati correttamente', () => {
		const displayTrueTypes = [
			'async-result',
			'irc:incoming',
			'irc:autoreply',
			'advisor',
			'skill-prompt'
		];

		const displayFalseTypes = [
			'plan-mode-context',
			'plan-mode-reference',
			'goal-mode-context',
			'vibe-mode-context',
			'ttsr-injection',
			'eager-todo-prelude',
			'eager-task-prelude',
			'mid-run-todo-nudge',
			'todo-error-reminder',
			'resolve-reminder',
			'autolearn-nudge',
			'session-stop-continuation',
			'interrupted-thinking',
			'ultrathink-notice',
			'orchestrate-notice',
			'workflow-notice',
			'goal-continuation',
			'prewalk-plan',
			'prewalk-continue',
			'prewalk-checklist',
			'plan-yolo-handoff',
			'autoresearch-resume',
			'goal-budget-limit',
			'live-delegation',
			'background-tan-dispatch'
		];

		const variableVisibilityTypes = [
			'xdev-mount-notice',
			'launch-completion',
			'lsp-late-diagnostic',
			'checkpoint-active-reminder',
			'custom-message'
		];

		// Verifica tipi display: true
		for (const type of displayTrueTypes) {
			const res = classifySystemMessage({
				role: 'custom',
				customType: type,
				display: true,
				text: type === 'async-result'
					? '<system-notice>\nBackground job test has completed.\n<task-result id="test" status="completed"><output>ok</output></task-result>\n</system-notice>'
					: 'Messaggio di avviso per ' + type,
				details: type === 'irc:incoming'
					? { id: '1', from: 'Agent1', message: 'test' }
					: type === 'irc:autoreply'
						? { to: 'Agent1', body: 'test' }
						: undefined
			});

			assert.ok(res !== null, `Tipo ${type} non deve restituire null`);
			assert.notEqual(res.kind, 'hidden', `Tipo ${type} con display: true non deve essere hidden`);
		}

		// Verifica tipi display: false
		for (const type of displayFalseTypes) {
			const res = classifySystemMessage({
				role: 'custom',
				customType: type,
				display: false,
				text: 'Contesto interno per ' + type
			});

			assert.ok(res !== null, `Tipo ${type} non deve restituire null`);
			assert.equal(res.kind, 'hidden', `Tipo ${type} con display: false deve essere hidden`);
		}

		// Verifica tipi a visibilita variabile
		for (const type of variableVisibilityTypes) {
			const res = classifySystemMessage({
				role: 'custom',
				customType: type,
				display: true,
				text: 'Informazione di stato per ' + type
			});

			assert.ok(res !== null, `Tipo ${type} non deve restituire null`);
			assert.notEqual(res.kind, 'hidden', `Tipo ${type} non deve essere hidden`);
			assert.equal(res.kind, 'chip', `Tipo ${type} deve essere un chip`);
		}
	});

	// Caso 15: systemNoticeTitle su tipo ignoto -> Title Case
	it('15. genera titolo in Title Case per tipi sconosciuti rimuovendo notice/reminder finale se ridondante', () => {
		assert.equal(systemNoticeTitle('lsp-late-diagnostic'), 'Diagnostica LSP tardiva');
		assert.equal(systemNoticeTitle('my-custom-event'), 'My Custom Event');
		assert.equal(systemNoticeTitle('special_alert_notice'), 'Special Alert');
		assert.equal(systemNoticeTitle('lone-reminder'), 'Lone');
		assert.equal(systemNoticeTitle('notice'), 'Notice');
	});

	// Caso 16: noticeDedupKey
	it('16. calcola chiave di deduplicazione stabile e restituisce null se mancano dati', () => {
		const keyWithTimestamp = noticeDedupKey({
			role: 'custom',
			customType: 'advisor',
			timestamp: 1718000000000
		});
		assert.equal(keyWithTimestamp, 'custom:advisor:1718000000000');

		const keyNoTimestamp = noticeDedupKey({
			role: 'custom',
			customType: 'advisor'
		});
		assert.equal(keyNoTimestamp, null);

		const keyNoCustomType = noticeDedupKey({
			role: 'custom',
			timestamp: 1718000000000
		});
		assert.equal(keyNoCustomType, null);
	});
	// Caso 17: un messaggio developer che non e' un <system-reminder> porta
	// informazione all'utente e non deve finire tra i nascosti.
	it('17. mostra le note developer che non sono promemoria interni', () => {
		const planApproved = classifySystemMessage({
			role: 'developer',
			text: 'Plan approved.\n- Context preserved. Use conversation history when useful.\n\n<instruction>\nYou MUST execute this plan step by step\n</instruction>'
		});
		assert.ok(planApproved !== null);
		assert.equal(planApproved.kind, 'chip');
		assert.equal(planApproved.customType, 'plan-approved');
		assert.equal(planApproved.title, 'Piano approvato');

		const dateReminder = classifySystemMessage({
			role: 'developer',
			text: "<system-reminder>\nToday: 2026-09-10; current working directory: 'C:/tmp'. Do not repeat this information in your reply.\n</system-reminder>"
		});
		assert.ok(dateReminder !== null);
		assert.equal(dateReminder.kind, 'hidden');
	});

	// Caso 18: `type` fuori dai tre valori noti non deve propagarsi come tipo di job.
	it('18. ignora un tipo di job non riconosciuto e lo deduce dal contenuto', () => {
		const content = `<system-notice>
Background job Alpha has completed. Resume your work using the result below.
<task-result id="Alpha" agent="scout" status="completed" duration="2.5s">
<output>
esito
</output>
</task-result>
</system-notice>`;
		const jobs = parseAsyncResult(content, { jobs: [{ jobId: 'Alpha', type: 'quantum' }] });
		assert.equal(jobs.length, 1);
		assert.equal(jobs[0].jobType, 'task');
		assert.ok(jobs[0].envelope !== undefined);
		assert.equal(jobs[0].envelope.id, 'Alpha');
	});
});
