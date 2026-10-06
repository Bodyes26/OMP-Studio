import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handOffPrewalk, isPrewalkHandOff, parsePrewalkNotice, reducePrewalkNotice, type PrewalkState } from '../src/lib/agent/prewalk.ts';

const target = 'google-antigravity/gemini-3.8-flash';
const off: PrewalkState = { state: 'off' };
const armed: PrewalkState = { state: 'armed', target };

function notice(current: PrewalkState, text: string, level = 'info', source = 'prewalk') {
	return reducePrewalkNotice(current, parsePrewalkNotice(source, level, text));
}

describe('Prewalk: notice e passaggio una tantum', () => {
	it('ricava il target effettivo dagli avvisi armed e already armed', () => {
		assert.deepEqual(notice(off, `Prewalk: armed for ${target} — will switch at the first edit/write once the todo list exists.`), armed);
		assert.deepEqual(notice(off, `Prewalk: already armed for ${target}, waiting for the first edit/write.`), armed);
	});

	it('disarma senza conservare un target precedente', () => {
		assert.deepEqual(notice(armed, `Prewalk: disarmed; staying on the active model instead of switching to ${target}.`), off);
	});

	it('usa il notice switched quando model_changed non contiene un payload', () => {
		assert.deepEqual(notice(armed, `Prewalk: switched to ${target} after first write call.`), {
			state: 'handedOff', target, handedOffTo: target
		});
		assert.deepEqual(notice(armed, `Prewalk: switched to ${target} after first edit call.`), {
			state: 'handedOff', target, handedOffTo: target
		});
	});

	it('un nuovo armo dopo il passaggio elimina il modello subentrato', () => {
		const handedOff = handOffPrewalk(armed, { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' });
		assert.deepEqual(handedOff, { state: 'handedOff', target, handedOffTo: 'Gemini 3.8 Flash' });
		assert.deepEqual(notice(handedOff, `Prewalk: armed for ${target} — will switch at the first edit/write once the todo list exists.`), armed);
	});

	it('non attribuisce a prewalk un cambio modello quando non e armato', () => {
		assert.strictEqual(handOffPrewalk(off, 'another-model'), off);
		const handedOff: PrewalkState = { state: 'handedOff', handedOffTo: target };
		assert.strictEqual(handOffPrewalk(handedOff, 'another-model'), handedOff);
	});

	it('accetta modello stringa, oggetto senza nome e frame senza payload', () => {
		assert.equal(handOffPrewalk(armed, 'Gemini 3.8 Flash').handedOffTo, 'Gemini 3.8 Flash');
		assert.equal(handOffPrewalk(armed, { id: 'gemini-3.8-flash' }).handedOffTo, 'gemini-3.8-flash');
		assert.equal(handOffPrewalk(armed, undefined).handedOffTo, target);
	});

	it('ignora testo sconosciuto o di altra sorgente senza confermare un armo', () => {
		assert.strictEqual(notice(armed, 'Prewalk configuration reloaded'), armed);
		assert.strictEqual(notice(off, `Prewalk: armed for ${target}`, 'info', 'config'), off);
		assert.deepEqual(parsePrewalkNotice('prewalk', 'info', 'Unrecognized future message'), { kind: 'unknown' });
	});

	it('usa source e level per gli errori senza inventare una transizione riuscita', () => {
		const text = 'No authenticated target for @smol';
		assert.deepEqual(parsePrewalkNotice('prewalk', 'error', text), { kind: 'error', message: text });
		assert.strictEqual(notice(off, text, 'error'), off);
		assert.strictEqual(notice(armed, 'Prewalk: armed for unavailable/model', 'warning'), armed);
	});

	it('rifiuta l armo senza passaggio quando modello e thinking coincidono gia con smol', () => {
		const text = `Prewalk: target ${target} already matches the active model and thinking level; nothing to switch.`;
		assert.deepEqual(parsePrewalkNotice('prewalk', 'info', text), { kind: 'error', message: text });
		assert.strictEqual(notice(off, text), off);
	});
});

describe('Prewalk: cambio modello manuale con prewalk armato', () => {
	it("e' un passaggio solo se il modello e' il bersaglio", () => {
		const smol = { provider: 'google-antigravity', id: 'gemini-3.8-flash', name: 'Gemini Flash' };
		const other = { provider: 'anthropic', id: 'claude-opus', name: 'Opus' };
		assert.equal(isPrewalkHandOff(armed, smol as never), true);
		assert.equal(isPrewalkHandOff(armed, other as never), false);
		assert.equal(isPrewalkHandOff({ state: 'armed', target: 'gemini-3.8-flash' }, smol as never), true);
		assert.equal(isPrewalkHandOff({ state: 'armed' }, smol as never), false, 'senza bersaglio noto non si indovina');
		assert.equal(isPrewalkHandOff(off, smol as never), false);
	});
});
