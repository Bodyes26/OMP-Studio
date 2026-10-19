/**
 * Registro di Studio (`studio.log`): formato delle righe e soglie che
 * decidono quando un gesto dell'utente o un errore ripetuto finisce nel file.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	ClickBurstDetector,
	MessageThrottle,
	describeElement,
	formatLogLine
} from '../src/lib/diagnostics/logCore.ts';

test('studio-log: una voce su piu righe resta una riga, con istante UTC', () => {
	const line = formatLogLine(Date.UTC(2026, 9, 19, 10, 6, 42, 123), 'web:main', 'ERROR', 'js', 'Errore\n    at a\r\n    at b');
	assert.equal(line, '2026-10-19T10:06:42.123Z web:main ERROR js Errore |     at a |     at b');
});

test('studio-log: le classi di scope di Svelte non finiscono nella descrizione', () => {
	const el = {
		tagName: 'DIV',
		id: 'root',
		className: 'svelte-1x2y3z overlay drag-veil svelte-abc open extra',
		getAttribute: (name: string) => (name === 'role' ? 'dialog' : null)
	};
	assert.equal(describeElement(el), 'div#root.overlay.drag-veil.open[role=dialog]');
	assert.equal(describeElement(null), '-');
});

test('studio-log: clic ripetuti vicini fanno scattare la soglia una volta sola', () => {
	const detector = new ClickBurstDetector(4, 2500, 40);
	assert.equal(detector.add(100, 100, 0), false);
	assert.equal(detector.add(110, 105, 300), false);
	assert.equal(detector.add(95, 98, 600), false);
	assert.equal(detector.add(102, 101, 900), true);
	// Dopo la segnalazione si riparte da zero: il quinto clic non riscatta.
	assert.equal(detector.add(100, 100, 1000), false);
});

test('studio-log: clic lontani o troppo distanziati nel tempo non sono una raffica', () => {
	const spread = new ClickBurstDetector(4, 2500, 40);
	assert.equal(spread.add(0, 0, 0), false);
	assert.equal(spread.add(200, 0, 100), false);
	assert.equal(spread.add(0, 200, 200), false);
	assert.equal(spread.add(200, 200, 300), false);

	const slow = new ClickBurstDetector(4, 2500, 40);
	for (const at of [0, 1000, 2000]) assert.equal(slow.add(50, 50, at), false);
	// Il primo clic e' fuori finestra: restano tre clic, sotto soglia.
	assert.equal(slow.add(50, 50, 2600), false);
});

test('studio-log: un messaggio ripetuto passa una volta per finestra e dichiara le ripetizioni', () => {
	const throttle = new MessageThrottle(10_000, 60);
	assert.deepEqual(throttle.admit('boom', 0), { admit: true, suppressed: 0 });
	assert.equal(throttle.admit('boom', 1000).admit, false);
	assert.equal(throttle.admit('boom', 2000).admit, false);
	assert.deepEqual(throttle.admit('altro', 2500), { admit: true, suppressed: 0 });
	assert.deepEqual(throttle.admit('boom', 10_000), { admit: true, suppressed: 2 });
});

test('studio-log: oltre il tetto al minuto passano solo i conteggi', () => {
	const throttle = new MessageThrottle(10_000, 2);
	assert.equal(throttle.admit('a', 0).admit, true);
	assert.equal(throttle.admit('b', 1).admit, true);
	assert.equal(throttle.admit('c', 2).admit, false);
	// Nuovo minuto: 'c' passa e porta con se' il tentativo scartato.
	assert.deepEqual(throttle.admit('c', 60_001), { admit: true, suppressed: 1 });
});
