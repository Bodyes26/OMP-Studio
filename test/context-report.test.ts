import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	applyDraftToContextReserve,
	categoryTokenSum,
	isContextReportText,
	parseContextReport,
	reportMatchesUsage
} from '../src/lib/agent/contextReport.ts';

/** Stessa riga di `buildContextReportText`: etichetta a 16 colonne, barra, token. */
function ompLine(label: string, tokens: number, fraction: number): string {
	const width = 24;
	const clamped = Math.min(Math.max(fraction, 0), 1);
	const filled = Math.round(clamped * width);
	const bar = `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
	const pct = Math.round(clamped * 100);
	return `  ${label.padEnd(16)} [${bar}] ${pct}%  ${tokens} tokens`;
}

const REPORT = [
	'Context window: 100000 tokens (25% used)',
	ompLine('System prompt', 10000, 0.1),
	ompLine('System tools', 5000, 0.05),
	ompLine('System context', 2000, 0.02),
	ompLine('Skills', 1000, 0.01),
	ompLine('Messages', 7000, 0.07),
	ompLine('Auto-compact buf', 20000, 0.2),
	ompLine('Free', 55000, 0.55),
	'Snapcompact: inactive (model has no image input)'
].join('\n');

describe('rapporto /context', () => {
	it('legge le categorie, la riserva e lo spazio libero', () => {
		const report = parseContextReport(REPORT);
		assert.ok(report);
		assert.equal(report.contextWindow, 100_000);
		assert.equal(report.usedPercent, 25);
		assert.deepEqual(
			report.categories.map((row) => [row.id, row.tokens]),
			[
				['systemPrompt', 10000],
				['systemTools', 5000],
				['systemContext', 2000],
				['skills', 1000],
				['messages', 7000]
			]
		);
		assert.equal(categoryTokenSum(report), 25_000);
		assert.equal(report.autoCompactBufferTokens, 20_000);
		assert.equal(report.freeTokens, 55_000);
		assert.deepEqual(report.notes, ['Snapcompact: inactive (model has no image input)']);
		assert.equal(categoryTokenSum(report) + report.autoCompactBufferTokens + report.freeTokens, report.contextWindow);
	});

	it('ignora i codici ANSI dentro la barra', () => {
		const colored = REPORT.replace('[', '[\x1b[38;5;110m').replace(']', '\x1b[39m]');
		const report = parseContextReport(colored);
		assert.equal(report?.categories[0]?.tokens, 10_000);
		assert.equal(report?.autoCompactBufferTokens, 20_000);
	});

	it('riconosce il testo di /context anche quando non c\'e\' la tabella', () => {
		assert.equal(isContextReportText('Context usage is unavailable.'), true);
		assert.equal(isContextReportText('Context\nWindow: 200000\nUsed: 10'), true);
		assert.equal(parseContextReport('Context\nWindow: 200000\nUsed: 10'), null);
		assert.equal(isContextReportText('Context is large'), false);
		assert.equal(parseContextReport('niente'), null);
	});

	it('considera aggiornato solo il rapporto con gli stessi token di get_state', () => {
		const report = parseContextReport(REPORT);
		assert.equal(reportMatchesUsage(report, { tokens: 25_000, contextWindow: 100_000 }), true);
		assert.equal(reportMatchesUsage(report, { tokens: 26_000, contextWindow: 100_000 }), false);
		assert.equal(reportMatchesUsage(report, { tokens: 25_000, contextWindow: 200_000 }), false);
		assert.equal(reportMatchesUsage(null, { tokens: 0 }), false);
	});

	it('scala la bozza prima dal libero e poi dalla riserva', () => {
		assert.deepEqual(applyDraftToContextReserve(40, 80, 10), { free: 30, buffer: 80 });
		assert.deepEqual(applyDraftToContextReserve(40, 80, 100), { free: 0, buffer: 20 });
		assert.deepEqual(applyDraftToContextReserve(40, 80, 200), { free: 0, buffer: 0 });
	});
});
