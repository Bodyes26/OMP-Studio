import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isAskFormImage, isAskImageData } from '../src/lib/agent/askForm.ts';

describe('dati immagine del modulo ask', () => {
	it('accetta il base64 con a capo e rifiuta vuoto, caratteri estranei e padding lungo', () => {
		assert.equal(isAskImageData('QQ=='), true);
		assert.equal(isAskImageData('QQ==\r\n'), true);
		assert.equal(isAskImageData(' QQ== '), true);
		assert.equal(isAskImageData(''), false);
		assert.equal(isAskImageData('   '), false);
		assert.equal(isAskImageData('QQ==!'), false);
		assert.equal(isAskImageData('QQ==='), false);
	});

	it('riconosce un allegato solo se anche il tipo e il MIME sono di un immagine', () => {
		assert.equal(
			isAskFormImage({ type: 'image', data: 'QQ==\n', mimeType: 'image/png' }),
			true
		);
		assert.equal(
			isAskFormImage({ type: 'image', data: 'QQ==', mimeType: 'text/plain' }),
			false
		);
		assert.equal(isAskFormImage({ type: 'image', data: '', mimeType: 'image/png' }), false);
	});
});
