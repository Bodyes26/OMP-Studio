/**
 * R-MI-44: la risposta a «è lo stesso progetto?» vale su tutte le macchine.
 * Le copie hanno nomi diversi sulle due finestre (ognuna chiama sé `local`),
 * e vince la decisione piu' recente.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decide, isConfirmed, isRefused, mergeDecisions, pairId, toLocal, toPortable } from '../src/lib/stores/linkDecisions.ts';

const MAC = 'mac-id';
const PC = 'pc-id';

describe('Decisioni condivise su fork e copie (R-MI-44)', () => {
	it('la stessa copia ha lo stesso nome su entrambe le macchine', () => {
		const onMac = toPortable('local::/users/m/sito', MAC);
		assert.equal(onMac, 'mac-id::/users/m/sito');
		assert.equal(toPortable('pc-id::c:/sito', MAC), 'pc-id::c:/sito', 'le copie altrui restano come sono');
		assert.equal(toLocal(onMac, MAC), 'local::/users/m/sito');
		assert.equal(toLocal(onMac, PC), onMac, 'sul PC la copia del Mac resta del Mac');
	});

	it('«non unire» sul Mac arriva al PC e non si chiede di nuovo', () => {
		const mac = toPortable('local::/users/m/sito', MAC);
		const pc = 'pc-id::c:/sito';
		const fromMac = decide(mac, pc, 'ROOT', false, 100);
		const onPc = mergeDecisions({}, [fromMac]);
		assert.ok(onPc);
		// Sul PC la propria copia si chiama local::c:/sito, ma va confrontata in forma portabile.
		assert.equal(isRefused(onPc, toPortable('local::c:/sito', PC), mac), true);
	});

	it('vince la decisione piu\' recente; a pari istante prevale «diversi»', () => {
		const a = 'mac-id::/x';
		const b = 'pc-id::/y';
		const same = decide(a, b, 'root', true, 200);
		const apart = decide(a, b, 'root', false, 100);
		const current = { [pairId(a, b)]: same };
		assert.equal(mergeDecisions(current, [apart]), null, 'una decisione vecchia non cambia nulla');
		const later = mergeDecisions(current, [decide(a, b, 'root', false, 300)]);
		assert.equal(later?.[pairId(a, b)].same, false);
		const tie = mergeDecisions(current, [decide(a, b, 'root', false, 200)]);
		assert.equal(tie?.[pairId(a, b)].same, false);
	});

	it('una copia unita conta come confermata per il suo primo commit, finche\' non la si separa', () => {
		const a = 'mac-id::/x';
		const b = 'pc-id::/y';
		const linked = mergeDecisions({}, [decide(a, b, 'ABC', true, 10)])!;
		assert.equal(isConfirmed(linked, 'abc', a), true);
		assert.equal(isConfirmed(linked, 'abc', 'other::/z'), false);
		const separated = mergeDecisions(linked, [decide(a, b, 'ABC', false, 11)])!;
		assert.equal(isConfirmed(separated, 'abc', a), false);
	});
});
