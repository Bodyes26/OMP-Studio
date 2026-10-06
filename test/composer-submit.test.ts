/**
 * Instradamento dell'invio dal composer: i comandi `/` passano prima dal
 * guscio di Studio (catalogo reale STUDIO_SLASH_COMMANDS), il resto va a omp.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_SLASH_COMMANDS } from '../src/lib/agent/commands.ts';
import { choosePasteContent, findSlashCommand, remainingAfterSend, routeComposerSubmit } from '../src/lib/agent/composerSubmit.ts';
import { segmentsToWireText } from '../src/lib/agent/composerDoc.ts';
import { composerChord, letterChordLabel, yieldsToShellShortcut } from '../src/lib/agent/composerShortcuts.ts';

describe('Composer: instradamento dei comandi /', () => {
	it('ogni comando e alias del catalogo di Studio passa dal guscio', () => {
		for (const command of STUDIO_SLASH_COMMANDS) {
			for (const name of [command.name, ...(command.aliases ?? [])]) {
				assert.deepEqual(routeComposerSubmit(`/${name}`), { kind: 'studio', raw: `/${name}` }, name);
				const withArgument = `/${name} argomento`;
				const expected =
					command.input || command.subcommands ? { kind: 'studio', raw: withArgument } : { kind: 'omp' };
				assert.deepEqual(routeComposerSubmit(withArgument), expected, name);
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

	it('un comando senza argomenti seguito da una frase va a omp intero', () => {
		assert.deepEqual(routeComposerSubmit('/help non funziona il login'), { kind: 'omp' });
		assert.deepEqual(routeComposerSubmit('/help'), { kind: 'studio', raw: '/help' });
		assert.deepEqual(routeComposerSubmit('/role plan'), { kind: 'studio', raw: '/role plan' });
	});

	it('un comando sconosciuto al catalogo resta candidato: decide il guscio, poi omp', () => {
		assert.deepEqual(routeComposerSubmit('/estensione-x'), { kind: 'studio', raw: '/estensione-x' });
		assert.equal(findSlashCommand('/estensione-x', STUDIO_SLASH_COMMANDS), null);
	});
});

describe('Composer: modificatori delle scorciatoie', () => {
	const keys = (mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) => ({
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		...mods
	});

	it('Windows/Linux: Alt+lettera, AltGr (Ctrl+Alt) escluso', () => {
		assert.equal(composerChord(keys({ altKey: true }), false), 'letter');
		assert.equal(composerChord(keys({ altKey: true, ctrlKey: true }), false), null);
		assert.equal(composerChord(keys({ ctrlKey: true }), false), 'command');
		assert.equal(composerChord(keys({ altKey: true, shiftKey: true }), false), null);
		assert.equal(letterChordLabel(false), 'Alt');
	});

	it('macOS: Opzione da sola resta ai caratteri (€ ç ñ), le scorciatoie sono Ctrl+Opzione', () => {
		assert.equal(composerChord(keys({ altKey: true }), true), null);
		assert.equal(composerChord(keys({ altKey: true, ctrlKey: true }), true), 'letter');
		assert.equal(composerChord(keys({ altKey: true, ctrlKey: true, metaKey: true }), true), null);
		assert.equal(composerChord(keys({ metaKey: true }), true), 'command');
		assert.equal(letterChordLabel(true), '⌃+⌥');
	});
});

describe('Composer: scorciatoie del guscio su Mac', () => {
	it('fuori dal composer Ctrl+Opzione+N resta al guscio (nuovo progetto)', () => {
		assert.equal(yieldsToShellShortcut('n', true, false), true);
		assert.equal(yieldsToShellShortcut('n', true, true), false);
	});
	it('le lettere senza scorciatoia globale restano al composer', () => {
		assert.equal(yieldsToShellShortcut('e', true, false), false);
	});
	it('su Windows e Linux non ci sono sovrapposizioni', () => {
		assert.equal(yieldsToShellShortcut('n', false, false), false);
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
