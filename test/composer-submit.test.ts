/**
 * Instradamento dell'invio dal composer: i comandi `/` passano prima dal
 * guscio di Studio (catalogo reale STUDIO_SLASH_COMMANDS), il resto va a omp.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_SLASH_COMMANDS } from '../src/lib/agent/commands.ts';
import { choosePasteContent, findSlashCommand, remainingAfterSend, routeComposerSubmit } from '../src/lib/agent/composerSubmit.ts';
import { segmentsToWireText } from '../src/lib/agent/composerDoc.ts';

describe('Composer: instradamento dei comandi /', () => {
	it('ogni comando e alias del catalogo di Studio passa dal guscio', () => {
		for (const command of STUDIO_SLASH_COMMANDS) {
			for (const name of [command.name, ...(command.aliases ?? [])]) {
				const route = routeComposerSubmit(`/${name} argomento`);
				assert.deepEqual(route, { kind: 'studio', raw: `/${name} argomento` }, name);
				assert.equal(findSlashCommand(`/${name}`, STUDIO_SLASH_COMMANDS), command, name);
			}
		}
	});

	it('il testo di un badge comando seguito da argomenti arriva intero al guscio', () => {
		const wire = segmentsToWireText([
			{ t: 'cmd', name: 'compact' },
			{ t: 'text', s: ' tieni le decisioni' }
		]);
		assert.deepEqual(routeComposerSubmit(wire), { kind: 'studio', raw: '/compact tieni le decisioni' });
	});

	it('skill, testo normale e slash non iniziali vanno a omp', () => {
		assert.deepEqual(routeComposerSubmit('/skill:review controlla'), { kind: 'omp' });
		assert.deepEqual(
			routeComposerSubmit(segmentsToWireText([{ t: 'cmd', name: 'review' }], () => true)),
			{ kind: 'omp' }
		);
		assert.deepEqual(routeComposerSubmit('ciao /new'), { kind: 'omp' });
		assert.deepEqual(routeComposerSubmit('/'), { kind: 'omp' });
		assert.deepEqual(routeComposerSubmit('// commento'), { kind: 'omp' });
		assert.deepEqual(routeComposerSubmit(''), { kind: 'omp' });
	});

	it('un comando sconosciuto al catalogo resta candidato: decide il guscio, poi omp', () => {
		assert.deepEqual(routeComposerSubmit('/estensione-x'), { kind: 'studio', raw: '/estensione-x' });
		assert.equal(findSlashCommand('/estensione-x', STUDIO_SLASH_COMMANDS), null);
	});
});

describe('Composer: incolla da Office', () => {
	it('con testo negli appunti vince il testo anche se c\'e\' un\'immagine', () => {
		assert.equal(choosePasteContent('Paragrafo da Word', 1), 'text');
		assert.equal(choosePasteContent('', 1), 'files');
		assert.equal(choosePasteContent('   ', 2), 'files');
		assert.equal(choosePasteContent('', 0), 'none');
		assert.equal(choosePasteContent('  ', 0), 'text');
	});
});

describe('Composer: allegati dopo l\'invio', () => {
	it('toglie solo gli allegati inviati', () => {
		const a = { id: 'a' };
		const b = { id: 'b' };
		const late = { id: 'c' };
		assert.deepEqual(remainingAfterSend([a, b, late], [a, b]), [late]);
		assert.deepEqual(remainingAfterSend([a], []), [a]);
	});
});
