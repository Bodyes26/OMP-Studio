/**
 * R-MI-31: con più macchine collegate notifica solo quella usata per ultima.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EVERYONE_IDLE_SECONDS, notifiesHere } from '../src/lib/stores/notificationPresence.ts';

describe('Quale macchina notifica (R-MI-31)', () => {
	it('notifica la macchina toccata più di recente, non le altre', () => {
		const pc = { machineId: 'pc', idleSeconds: 5 };
		const mac = { machineId: 'mac', idleSeconds: 900 };
		assert.equal(notifiesHere(pc, [mac]), true);
		assert.equal(notifiesHere(mac, [pc]), false, 'il Mac tace mentre l utente è al PC');
	});

	it('con l utente lontano da tutte notificano tutte', () => {
		const idle = EVERYONE_IDLE_SECONDS + 1;
		assert.equal(notifiesHere({ machineId: 'mac', idleSeconds: idle + 100 }, [{ machineId: 'pc', idleSeconds: idle }]), true);
	});

	it('a parità sceglie una macchina sola, la stessa vista da entrambe', () => {
		const a = { machineId: 'a', idleSeconds: 30 };
		const b = { machineId: 'b', idleSeconds: 30 };
		assert.notEqual(notifiesHere(a, [b]), notifiesHere(b, [a]));
	});

	it('nel dubbio notifica: misura assente qui o nessuna risposta dalle altre', () => {
		assert.equal(notifiesHere({ machineId: 'mac', idleSeconds: null }, [{ machineId: 'pc', idleSeconds: 1 }]), true);
		assert.equal(notifiesHere({ machineId: 'mac', idleSeconds: 900 }, [{ machineId: 'pc', idleSeconds: null }]), true);
	});
});
