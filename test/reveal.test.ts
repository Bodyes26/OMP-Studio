import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	splitSentences,
	isInsideCodeOrBold,
	isOpenCodeFence,
	isTailComplete,
	parseReveal,
	computeGhostLines
} from '../src/lib/agent/reveal.ts';

describe('reveal: motore puro di rivelazione del testo (Gate R32 - C05)', () => {
	describe('splitSentences', () => {
		it('spezza correttamente le frasi standard', () => {
			const res = splitSentences('Ecco la prima frase. Seconda frase.');
			assert.deepEqual(res, ['Ecco la prima frase.', 'Seconda frase.']);
		});

		it('spezza su fine frase con marcatore di grassetto (sentence ends with bold)', () => {
			const res = splitSentences('Hai ragione, **molto bene!** Possiamo procedere.');
			assert.deepEqual(res, ['Hai ragione, **molto bene!**', 'Possiamo procedere.']);
		});

		it('spezza su fine frase con codice inline (sentence ends with inline code)', () => {
			const res = splitSentences('Hai ragione, vedi `foo.bar()`. Possiamo procedere.');
			assert.deepEqual(res, ['Hai ragione, vedi `foo.bar()`.', 'Possiamo procedere.']);
		});

		it('NON spezza dentro codice inline (no split inside inline code)', () => {
			const res = splitSentences('Esegui `echo "Hello! World"` per iniziare.');
			assert.deepEqual(res, ['Esegui `echo "Hello! World"` per iniziare.']);
		});

		it('NON spezza dentro marcatori di grassetto (no split inside bold)', () => {
			const res = splitSentences("Questo e' **un testo con punto. Ma continua** qui.");
			assert.deepEqual(res, ["Questo e' **un testo con punto. Ma continua** qui."]);
		});

		it('NON spezza su abbreviazioni seguite da minuscola (abbreviation followed by lowercase)', () => {
			const res1 = splitSentences('Ad es. questo non deve dividere.');
			assert.deepEqual(res1, ['Ad es. questo non deve dividere.']);

			const res2 = splitSentences("Il dott. rossi e' arrivato.");
			assert.deepEqual(res2, ["Il dott. rossi e' arrivato."]);
		});
	});

	describe('isOpenCodeFence', () => {
		it('rileva un blocco di codice non chiuso', () => {
			const text = 'Ecco il codice:\n```ts\nconst x = 1;\n';
			assert.equal(isOpenCodeFence(text), true);
		});

		it('rileva un blocco di codice chiuso', () => {
			const text = 'Ecco il codice:\n```ts\nconst x = 1;\n```\n';
			assert.equal(isOpenCodeFence(text), false);
		});
	});

	describe('tail completeness', () => {
		it('incompleto se non termina con newline durante lo streaming', () => {
			const text = 'Prima frase. Seconda fra';
			assert.equal(isTailComplete(text, false), false);
			const parsed = parseReveal(text, false);
			assert.equal(parsed.tailComplete, false);
			assert.equal(parsed.totalUnits, 2);
			assert.equal(parsed.completeUnits, 1);
		});

		it('completo se termina con newline fuori da code fence durante lo streaming', () => {
			const text = 'Prima frase. Seconda frase.\n';
			assert.equal(isTailComplete(text, false), true);
			const parsed = parseReveal(text, false);
			assert.equal(parsed.tailComplete, true);
			assert.equal(parsed.totalUnits, 2);
			assert.equal(parsed.completeUnits, 2);
		});

		it('incompleto se termina con newline ma c’è un code fence aperto', () => {
			const text = 'Ecco:\n```ts\nconst a = 1;\n';
			assert.equal(isTailComplete(text, false), false);
			const parsed = parseReveal(text, false);
			assert.equal(parsed.tailComplete, false);
			assert.equal(parsed.totalUnits, 2);
			assert.equal(parsed.completeUnits, 1); // solo il paragrafo precedente è completo
		});

		it('tutte le unità sono complete a stream finito (done = true)', () => {
			const text = 'Prima frase. Seconda fra';
			assert.equal(isTailComplete(text, true), true);
			const parsed = parseReveal(text, true);
			assert.equal(parsed.tailComplete, true);
			assert.equal(parsed.totalUnits, 2);
			assert.equal(parsed.completeUnits, 2);
		});
	});

	describe('elenchi numerati (numbered lists)', () => {
		it('suddivide gli elenchi numerati in unità con numerazione preservata', () => {
			const text = '1. Primo elemento\n2. Secondo elemento\n3. Terzo elemento';
			const parsed = parseReveal(text, true);
			assert.equal(parsed.totalUnits, 3);
			assert.equal(parsed.blocks.length, 3);
			assert.equal(parsed.blocks[0].kind, 'oli');
			assert.equal(parsed.blocks[0].num, '1');
			assert.equal(parsed.blocks[1].num, '2');
			assert.equal(parsed.blocks[2].num, '3');
			assert.equal(parsed.units[0].text, 'Primo elemento');
			assert.equal(parsed.units[1].text, 'Secondo elemento');
			assert.equal(parsed.units[2].text, 'Terzo elemento');
		});
	});

	describe('ghost lines', () => {
		it('calcola le linee ghost in base ai caratteri in attesa', () => {
			const linesZero = computeGhostLines(0);
			assert.equal(linesZero.length, 1);
			assert.equal(linesZero[0].width >= 5, true);

			const linesShort = computeGhostLines(50);
			assert.equal(linesShort.length, 1);
			assert.equal(linesShort[0].width > 50 && linesShort[0].width <= 100, true);

			const linesMulti = computeGhostLines(220);
			assert.equal(linesMulti.length, 3);
			assert.equal(linesMulti[0].width, 100);
			assert.equal(linesMulti[1].width, 100);
			assert.equal(linesMulti[2].width > 0 && linesMulti[2].width <= 100, true);
		});
	});
});
