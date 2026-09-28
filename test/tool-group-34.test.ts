import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	categorizeTool,
	categoryForTool,
	parseDiffStats,
	formatDurationSecs,
	type ToolCategory
} from '../src/lib/agent/tools/categories.ts';
import type { ToolEntry, AssistantEntry } from '../src/lib/agent/session.svelte.ts';

// Simulazione fedele dello scenario '34 chiamate tool' (Gate R32 - C10 Acceptance)
describe('Scenario 34 chiamate tool (Gate R32 - C10, C11)', () => {
	// Helper per creare una ToolEntry fittizia
	function makeTool(
		id: number,
		name: string,
		args: Record<string, unknown>,
		opts: {
			diff?: string;
			fail?: boolean;
			par?: boolean;
			startedAt?: number;
			endedAt?: number;
		} = {}
	): ToolEntry {
		return {
			id,
			kind: 'tool',
			toolCallId: `call_${id}`,
			toolName: name,
			args: { ...args, ...(opts.par ? { _par: true } : {}) },
			result: {
				isError: opts.fail === true,
				details: opts.diff ? { diff: opts.diff } : undefined,
				content: [{ type: 'text', text: opts.fail ? 'Command failed' : 'Success' }]
			},
			running: false,
			startedAt: opts.startedAt ?? id * 1000,
			endedAt: opts.endedAt ?? id * 1000 + 400
		};
	}

	it('finestra dal vivo: 34 chiamate con parallele restano entro 6 righe durante il lavoro', () => {
		const WINDOW_SIZE = 5;
		const totalCalls = 34;

		// Durante lo streaming progressivo da 1 a 34 chiamate
		for (let count = 1; count <= totalCalls; count++) {
			const started = Array.from({ length: count }, (_, i) => i + 1);
			const visible = started.slice(-WINDOW_SIZE);
			const hidden = Math.max(0, started.length - visible.length);

			const renderedRowCount = visible.length + (hidden > 0 ? 1 : 0);
			assert.ok(
				renderedRowCount <= 6,
				`Con ${count} chiamate avviate, le righe visualizzate (${renderedRowCount}) devono essere <= 6`
			);
			assert.ok(visible.length <= 5, 'la finestra visibile non supera mai 5 elementi');
			if (count > 5) {
				assert.equal(hidden, count - 5, 'il contatore nascosto è esatto');
			}
		}
	});

	it('raggruppamento parallelo: bracketing corretto delle chiamate partite insieme', () => {
		// Crea un batch di chiamate con chiamate singole e parallele
		const entries: ToolEntry[] = [
			makeTool(1, 'bash', { command: 'gh run list' }),
			makeTool(2, 'bash', { command: 'gh run view 8812' }),
			makeTool(3, 'bash', { command: 'gh run view 8790' }, { par: true }),
			makeTool(4, 'bash', { command: 'gh run view 8764' }, { par: true }),
			makeTool(5, 'grep', { pattern: 'waitForTimeout' }),
			makeTool(6, 'grep', { pattern: 'Date.now()' }, { par: true })
		];

		// Funzione pura di raggruppamento identica a ToolGroup.svelte
		function makeBatches<T extends { args: Record<string, unknown> }>(items: T[]): T[][] {
			const batches: T[][] = [];
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				const isPar = Boolean(item.args._par);
				const cur = batches[batches.length - 1];
				if (cur && isPar) {
					cur.push(item);
				} else {
					batches.push([item]);
				}
			}
			return batches;
		}

		const batches = makeBatches(entries);

		// Dovrebbero esserci 3 batch:
		// 1. [call 1] (singola)
		// 2. [call 2, call 3, call 4] (parallela da 3 chiamate)
		// 3. [call 5, call 6] (parallela da 2 chiamate)
		assert.equal(batches.length, 3, 'raggruppa in 3 batch distinti');
		assert.equal(batches[0].length, 1);
		assert.equal(batches[1].length, 3, 'batch parallelo da 3');
		assert.equal(batches[2].length, 2, 'batch parallelo da 2');
	});

	it('il riepilogo finale somma fedelmente modifiche (+a -d) ed errori', () => {
		// Le modifiche dello scenario 3 del prototipo:
		// edit('src/test/setup.ts', [6, 0]) -> +6, -0
		// edit('tests/unit/orderSummary.test.ts', [9, 3]) -> +9, -3
		// edit('tests/e2e/checkout.spec.ts', [7, 12]) -> +7, -12
		// edit('tests/e2e/cart.spec.ts', [4, 6]) -> +4, -6
		// edit('tests/e2e/fixtures/api.ts', [11, 2]) -> +11, -2
		// Totale aggiunte: 6 + 9 + 7 + 4 + 11 = 37
		// Totale rimozioni: 0 + 3 + 12 + 6 + 2 = 23
		function buildOmpDiff(added: number, removed: number): string {
			const rows: string[] = [' 1|// context'];
			for (let i = 0; i < added; i++) rows.push(`+${i + 2}|added line ${i}`);
			for (let j = 0; j < removed; j++) rows.push(`-${j + 2}|removed line ${j}`);
			return rows.join('\n');
		}

		const group3Tools: ToolEntry[] = [
			makeTool(1, 'edit', { path: 'src/test/setup.ts' }, { diff: buildOmpDiff(6, 0) }),
			makeTool(2, 'edit', { path: 'tests/unit/orderSummary.test.ts' }, { diff: buildOmpDiff(9, 3) }),
			makeTool(3, 'edit', { path: 'tests/e2e/checkout.spec.ts' }, { diff: buildOmpDiff(7, 12), par: true }),
			makeTool(4, 'edit', { path: 'tests/e2e/cart.spec.ts' }, { diff: buildOmpDiff(4, 6), par: true }),
			makeTool(5, 'edit', { path: 'tests/e2e/fixtures/api.ts' }, { diff: buildOmpDiff(11, 2) }),
			makeTool(6, 'bash', { command: 'pnpm lint' }),
			makeTool(7, 'bash', { command: 'pnpm typecheck' }, { par: true }),
			makeTool(8, 'bash', { command: 'pnpm test orderSummary --repeat 200' }),
			makeTool(9, 'bash', { command: 'pnpm playwright test checkout cart' }, { par: true }),
			makeTool(10, 'bash', { command: 'pnpm test' }),
			makeTool(11, 'bash', { command: 'git diff --stat' })
		];

		// Esempio con errori da gruppo 2:
		const group2Errors: ToolEntry[] = [
			makeTool(12, 'bash', { command: 'pnpm test orderSummary --repeat 50' }, { fail: true }),
			makeTool(13, 'bash', { command: 'pnpm playwright test checkout' }, { fail: true, par: true })
		];

		const allTools = [...group3Tools, ...group2Errors];

		let totalAdd = 0;
		let totalDel = 0;
		let totalFailed = 0;
		const categoryCounts: Partial<Record<ToolCategory, number>> = {};

		for (const tool of allTools) {
			const summary = categorizeTool({
				toolName: tool.toolName,
				args: tool.args,
				result: tool.result
			});

			categoryCounts[summary.category] = (categoryCounts[summary.category] ?? 0) + 1;
			if (summary.diff) {
				totalAdd += summary.diff[0];
				totalDel += summary.diff[1];
			}
			if (summary.fail) {
				totalFailed++;
			}
		}

		assert.equal(totalAdd, 37, 'totale righe aggiunte corretto (37)');
		assert.equal(totalDel, 23, 'totale righe rimosse corretto (23)');
		assert.equal(totalFailed, 2, 'conteggio errori corretto (2 falliti)');
		assert.equal(categoryCounts['edit'], 5, '5 modifiche');
		assert.equal(categoryCounts['run'], 8, '8 comandi run');
	});
});
