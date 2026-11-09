import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildHostState } from '../src/lib/remote/projection.ts';
import { REMOTE_ATTENTION_MAX_BYTES, REMOTE_FRAME_TOO_LARGE } from '$remote-protocol';
import { remoteFrameMessage, setLanguage } from '../relay/web/src/i18n.ts';
import type { AskFormDraft, AskFormRequest } from '../src/lib/agent/askForm.ts';
import type { AttentionRequest } from '../src/lib/stores/companion.svelte.ts';

function request(src: string, draft?: AskFormDraft): AskFormRequest {
	return {
		version: 1,
		toolCallId: 'tool-1',
		title: 'Scelta',
		html: '',
		form: {
			sections: [{ title: [{ text: 'Sezione' }], blocks: [{ kind: 'image', src, alt: 'figura' }] }],
			fields: [],
			hidden: [],
			questions: {}
		},
		defaults: {},
		draft
	};
}

function attention(form: AskFormRequest, draft: AskFormDraft | null): AttentionRequest {
	return {
		projectId: 'p1',
		projectName: 'Progetto',
		projectHue: 10,
		laneId: 'main',
		laneTitle: 'Principale',
		recentMessages: [],
		pendingUi: {
			kind: 'ask',
			requestId: 'req-1',
			title: 'Scelta',
			method: 'form',
			form,
			formDraft: draft
		}
	};
}

function project(item: AttentionRequest) {
	const state = buildHostState({
		projects: [{ id: 'p1', name: 'Progetto' }],
		attentionRequests: [item]
	});
	return state.projects[0].attention[0];
}

describe('proiezione del modulo ask verso Remote', () => {
	it('consegna form e bozza quando stanno sotto il tetto', () => {
		const draft: AskFormDraft = {
			data: { nome: 'ada' },
			annotations: [],
			other: {}
		};
		const form = request('data:image/png;base64,QQ==', draft);
		const projected = project(attention(form, draft));
		assert.equal(projected.frameError, null);
		assert.equal(projected.formDraft?.data.nome, 'ada');
		assert.equal(projected.form?.form.sections[0].blocks[0].kind, 'image');
	});

	it('non invia il modulo quando le immagini stanno solo nella bozza del form', () => {
		const payload = 'A'.repeat(REMOTE_ATTENTION_MAX_BYTES + 64);
		const draft: AskFormDraft = {
			data: {},
			annotations: [{ field: 'nota', note: '', images: [{ type: 'image', data: payload, mimeType: 'image/png' }] }],
			other: {}
		};
		const form = request('data:image/png;base64,QQ==', draft);
		const projected = project(attention(form, null));
		assert.equal(projected.form, null);
		assert.equal(projected.formDraft, null);
		assert.equal(projected.frameError, REMOTE_FRAME_TOO_LARGE);
		assert.equal(draft.annotations[0].images[0].data, payload);
		assert.equal(JSON.stringify(projected).includes('bozza'), false);
		assert.equal(JSON.stringify(projected).includes('allegati'), false);
		assert.equal(JSON.stringify(projected).includes('Domanda'), false);
	});

	it('non invia il modulo quando il modello da solo supera il tetto', () => {
		const src = `data:image/png;base64,${'A'.repeat(REMOTE_ATTENTION_MAX_BYTES + 64)}`;
		const projected = project(attention(request(src), null));
		assert.equal(projected.form, null);
		assert.equal(projected.formDraft, null);
		assert.equal(projected.frameError, REMOTE_FRAME_TOO_LARGE);
	});

	it('traduce il codice in inglese e lascia una frase gia pronta', () => {
		setLanguage('en');
		const english = remoteFrameMessage(REMOTE_FRAME_TOO_LARGE);
		assert.match(english, /Attachments exceed the remote frame limit/);
		assert.equal(english.includes('allegati'), false);
		setLanguage('it');
		assert.match(remoteFrameMessage(REMOTE_FRAME_TOO_LARGE), /Gli allegati superano/);
		assert.equal(remoteFrameMessage('frase gia pronta'), 'frase gia pronta');
	});
});
