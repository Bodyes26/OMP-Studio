import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	compactCommandLine,
	needsCompactChoice,
	parseCompactArgs,
	parseCompactOutput
} from '../src/lib/agent/compactMode.ts';

describe('/compact: modalita', () => {
	it('il primo token e modalita solo se la nomina, anche in maiuscolo', () => {
		assert.deepEqual(parseCompactArgs(''), {});
		assert.deepEqual(parseCompactArgs('Soft mantieni auth'), { mode: 'soft', instructions: 'mantieni auth' });
		assert.deepEqual(parseCompactArgs('soft'), { mode: 'soft', instructions: undefined });
		assert.deepEqual(parseCompactArgs('softly tieni auth'), { instructions: 'softly tieni auth' });
	});

	it('snapcompact rifiuta il focus', () => {
		assert.ok('error' in parseCompactArgs('snapcompact tieni auth'));
		assert.deepEqual(parseCompactArgs('snapcompact'), { mode: 'snapcompact', instructions: undefined });
	});

	it('la scelta si propone solo con immagini, senza modalita e senza focus', () => {
		assert.equal(needsCompactChoice({}, true), true);
		assert.equal(needsCompactChoice({}, false), false);
		assert.equal(needsCompactChoice({ mode: 'soft' }, true), false);
		assert.equal(needsCompactChoice({ instructions: 'x' }, true), false);
	});

	it('la riga slash rispecchia la TUI', () => {
		assert.equal(compactCommandLine('snapcompact'), '/compact snapcompact');
		assert.equal(compactCommandLine('remote', 'tieni auth'), '/compact remote tieni auth');
	});

	it('legge token ed errore dall esito testuale di omp', () => {
		assert.deepEqual(parseCompactOutput('Compaction complete. Tokens: 120000 -> 8000 (saved 112000).'), {
			tokensBefore: 120000,
			tokensAfter: 8000
		});
		assert.deepEqual(parseCompactOutput('Compaction complete.'), {});
		assert.deepEqual(parseCompactOutput('Compaction failed: Nothing to compact (session too small)'), {
			failed: 'Nothing to compact (session too small)'
		});
	});
});
