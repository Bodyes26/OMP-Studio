/**
 * W12 Contract Test: Superficie Review & Integrate, evidenze transcript e gate di sicurezza.
 *
 * Difende le invarianti del Gate R27 / PLAN W12:
 * 1. Evidenze dal transcript rigorosamente reali: comandi, exit code, durata misurata.
 *    Nessun "passed" inventato ne' assunzioni arbitrarie.
 * 2. Integrazione disabilitata con motivazioni esplicite (target dirty, processi vivi,
 *    stato non finalizzato o conflitti irrisolti).
 * 3. Segnalazione del drift (ahead/behind) e raccomandazione di aggiornamento dal target.
 * 4. Mappatura accurata del linguaggio per Monaco diff.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	extractCommandEvidence,
	type CommandEvidence
} from '../src/lib/lanes/commandEvidence.ts';
import {
	evaluateIntegrationGate,
	type IntegrationGateInput
} from '../src/lib/lanes/integrationGate.ts';
import { languageForFile } from '../src/lib/editor/languages.ts';
import type { TranscriptEntry } from '../src/lib/agent/session.svelte.ts';

describe('W12 — Evidenze di verifica dal transcript (commandEvidence)', () => {
	it('estrae comandi bash ed eval con exit code e durata reali senza inventare passed', () => {
		const entries: TranscriptEntry[] = [
			{
				id: 1,
				kind: 'tool',
				toolCallId: 'tc_1',
				toolName: 'bash',
				args: { command: 'npm test' },
				result: {
					content: [{ type: 'text', text: 'All 12 tests passed\n' }],
					details: { exitCode: 0, wallTimeMs: 1420 },
					isError: false
				},
				running: false,
				startedAt: 1000,
				endedAt: 2420
			},
			{
				id: 2,
				kind: 'tool',
				toolCallId: 'tc_2',
				toolName: 'read',
				args: { path: 'src/lib/app.ts' },
				result: { content: [{ type: 'text', text: 'const x = 1;' }] },
				running: false,
				startedAt: 2500,
				endedAt: 2510
			},
			{
				id: 3,
				kind: 'tool',
				toolCallId: 'tc_3',
				toolName: 'bash',
				args: { command: 'cargo test --bin verify' },
				result: {
					content: [{ type: 'text', text: 'test failed: assertion failed\n' }],
					details: { exitCode: 101, wallTimeMs: 3800 },
					isError: true
				},
				running: false,
				startedAt: 3000,
				endedAt: 6800
			}
		];

		const evidence = extractCommandEvidence(entries);

		assert.equal(evidence.length, 2, 'Deve estrarre solo i 2 comandi bash, ignorando read');

		// Primo comando: npm test (exit 0)
		assert.equal(evidence[0].command, 'npm test');
		assert.equal(evidence[0].exitCode, 0);
		assert.equal(evidence[0].durationMs, 1420);
		assert.equal(evidence[0].isError, false);
		assert.ok(evidence[0].outputSnippet?.includes('All 12 tests passed'));
		// Nessun campo "passed" inventato
		assert.equal('passed' in (evidence[0] as unknown as Record<string, unknown>), false);

		// Secondo comando: cargo test (exit 101, errore)
		assert.equal(evidence[1].command, 'cargo test --bin verify');
		assert.equal(evidence[1].exitCode, 101);
		assert.equal(evidence[1].durationMs, 3800);
		assert.equal(evidence[1].isError, true);
		assert.ok(evidence[1].outputSnippet?.includes('test failed'));
	});

	it('gestisce transcript vuoti o privi di esecuzioni shell senza fallire', () => {
		const emptyEvidence = extractCommandEvidence([]);
		assert.deepEqual(emptyEvidence, []);

		const nonToolEntries: TranscriptEntry[] = [
			{
				id: 1,
				kind: 'assistant' as const,
				blocks: [{ type: 'text', text: 'Ho terminato le modifiche richieste.' }]
			}
		];
		assert.deepEqual(extractCommandEvidence(nonToolEntries), []);
	});
});

describe('W12 — Valutazione gate di sicurezza integrazione (integrationGate)', () => {
	const messages = {
		checkoutMismatch: () => 'Checkout diverso dal target',
		processCheckFailed: () => 'Impossibile verificare i processi',
		notReady: (status: string) => `Corsia non pronta per la revisione (${status})`,
		conflicts: () => 'Conflitti Git non risolti'
	};

	const ready: IntegrationGateInput = {
		laneStatus: 'review_ready',
		isTargetCheckedOut: true,
		processCheckFailed: false,
		hasUnresolvedConflicts: false
	};

	it('consente integrazione quando target e checked out, nessun conflitto e stato valido', () => {
		const input: IntegrationGateInput = { ...ready };

		const res = evaluateIntegrationGate(input, messages);
		assert.equal(res.canIntegrate, true);
		assert.equal(res.reasons.length, 0);
	});

	it('consente integrazione anche se la corsia e sporca o il target e avanzato (gestiti dalla pipeline)', () => {
		const input: IntegrationGateInput = {
			...ready,
			isLaneDirty: true,
			laneDirtyFilesCount: 2,
			driftAhead: 5
		};

		const res = evaluateIntegrationGate(input, messages);
		assert.equal(res.canIntegrate, true);
		assert.equal(res.reasons.length, 0);
	});

	it('blocca integrazione se lo stato della corsia e archived o integrating', () => {
		const blocked = ['archived', 'integrating'] as const;

		for (const st of blocked) {
			const input: IntegrationGateInput = {
				...ready,
				laneStatus: st
			};
			const res = evaluateIntegrationGate(input, messages);
			assert.equal(res.canIntegrate, false, `Stato ${st} deve bloccare integrazione`);
			assert.ok(res.reasons.some((r) => r.includes(st)));
		}
	});

	it('blocca integrazione in caso di conflitti non risolti o stato conflict', () => {
		const withConflicts = evaluateIntegrationGate(
			{ ...ready, hasUnresolvedConflicts: true },
			messages
		);
		assert.equal(withConflicts.canIntegrate, false);
		assert.ok(withConflicts.reasons.some((r) => r.includes('Conflitti')));

		const statusConflict = evaluateIntegrationGate(
			{ ...ready, laneStatus: 'conflict' },
			messages
		);
		assert.equal(statusConflict.canIntegrate, false);
		assert.ok(statusConflict.reasons.some((r) => r.includes('Conflitti')));
	});

	it('blocca checkout diverso e verifica processi fallita', () => {
		assert.equal(
			evaluateIntegrationGate({ ...ready, isTargetCheckedOut: false }, messages).canIntegrate,
			false
		);
		const failed = evaluateIntegrationGate({ ...ready, processCheckFailed: true }, messages);
		assert.equal(failed.canIntegrate, false);
		assert.ok(failed.reasons.some((r) => r.includes('processi')));
	});
});

describe('W12 — Mappatura estensioni linguaggio per Monaco diff (languageForFile)', () => {
	it('riconosce linguaggi tipici dello stack .NET e frontend', () => {
		assert.equal(languageForFile('app.ts'), 'typescript');
		assert.equal(languageForFile('Component.tsx'), 'typescript');
		assert.equal(languageForFile('server.js'), 'javascript');
		assert.equal(languageForFile('Model.cs'), 'csharp');
		assert.equal(languageForFile('Module.vb'), 'vb');
		assert.equal(languageForFile('query.sql'), 'sql');
		assert.equal(languageForFile('schema.json'), 'json');
		assert.equal(languageForFile('styles.css'), 'css');
		assert.equal(languageForFile('app.rs'), 'rust');
		assert.equal(languageForFile('script.py'), 'python');
		assert.equal(languageForFile('unknown.xyz'), 'plaintext');
	});
});
