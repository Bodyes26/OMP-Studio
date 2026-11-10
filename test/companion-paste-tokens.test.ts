/**
 * Incolla nel Companion: i token gia' completi diventano gli stessi badge
 * della palette, non solo quello sotto il cursore.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentsToWireText } from '../src/lib/agent/composerDoc.ts';
import { parseQuickTaskLocal } from '../src/lib/companion/quickTaskLocal.ts';
import { resolvePastedTokens, type PasteTokenSources } from '../src/lib/companion/pasteTokens.ts';

const SOURCES: PasteTokenSources = {
	projects: [
		{ name: 'Cruscotto PSR', label: 'Cruscotto PSR', hue: 12, path: 'c:/repos/cruscotto-psr' },
		{ name: 'GestioneFlotta', label: 'Flotta', hue: 40, path: 'c:/repos/gestioneflotta' },
		{ name: 'AmbraUno', label: 'AmbraUno', hue: 80, path: 'c:/repos/ambrauno' },
		{ name: 'AmbraDue', label: 'AmbraDue', hue: 90, path: 'c:/repos/ambradue' },
		{ name: 'Studio OMP', label: 'Studio OMP', hue: 200, path: 'c:/repos/omp-studio-app' }
	],
	directives: [
		{ id: 'd-piano', name: 'Modalità Piano', tag: '/plan' },
		{ id: 'd-ricerca', name: 'Ricerca Online', tag: 'Web' },
		{ id: 'd-grill', name: 'Discussione', tag: '/grill-me' }
	],
	roles: [
		{ value: 'smol', label: 'Veloce', hue: 20 },
		{ value: 'default', label: 'Predefinito' }
	],
	models: [{ value: 'openai-codex/gpt-5.6', label: 'GPT-5.6' }],
	commands: [
		{ name: 'compact', aliases: ['cmp'] },
		{ name: 'review', source: 'skill' }
	]
};

const PARSE_INPUT = {
	projects: SOURCES.projects.map((project) => ({
		id: project.path ?? project.name,
		name: project.name,
		label: project.label,
		path: project.path ?? ''
	})),
	directives: SOURCES.directives.map((directive) => ({
		id: directive.id,
		name: directive.name,
		tag: directive.tag
	})),
	roles: SOURCES.roles.map((role) => role.value),
	modelSelectors: SOURCES.models.map((model) => model.value)
};

const QUEUE = { triggers: ['@', '#', '/', '!'] as const, liftDirectives: true };

function pasted(text: string) {
	return resolvePastedTokens(text, SOURCES, QUEUE);
}

test('Incolla: #progetto, /direttiva e !ruolo escono dal testo come in palette', () => {
	const resolved = pasted('#cruscotto /plan !smol sistema il bottone');

	assert.equal(resolved.changed, true);
	assert.equal(resolved.project?.name, 'Cruscotto PSR');
	assert.equal(resolved.project?.path, 'c:/repos/cruscotto-psr');
	assert.equal(resolved.project?.hue, 12);
	assert.deepEqual(resolved.directives.map((d) => d.id), ['d-piano']);
	assert.equal(resolved.directives[0]?.tag, '/plan');
	assert.equal(resolved.role?.kind, 'role');
	assert.equal(resolved.role?.value, 'smol');
	assert.equal(resolved.role?.label, 'Veloce');
	assert.equal(segmentsToWireText(resolved.segments), 'sistema il bottone');
});

test('Incolla: un nome progetto su piu parole non lascia il resto nel prompt', () => {
	const resolved = pasted('#Studio OMP perché il badge non prende il nome completo');

	assert.equal(resolved.project?.name, 'Studio OMP');
	assert.equal(segmentsToWireText(resolved.segments), 'perché il badge non prende il nome completo');
});

test('Incolla: progetto ambiguo o token sconosciuto restano testo', () => {
	const ambiguous = pasted('#ambra aggiorna le dipendenze');
	assert.equal(ambiguous.changed, false);
	assert.equal(ambiguous.project, null);
	assert.equal(segmentsToWireText(ambiguous.segments), '#ambra aggiorna le dipendenze');

	const unknown = pasted('#flotta !turbo aggiorna il changelog');
	assert.equal(unknown.project?.name, 'GestioneFlotta');
	assert.equal(unknown.role, null);
	assert.equal(segmentsToWireText(unknown.segments), '!turbo aggiorna il changelog');
});

test('Incolla: l ultimo ! vince e un modello con slash e un ruolo', () => {
	const model = pasted('#flotta !openai-codex/gpt-5.6 analizza lo screenshot');
	assert.equal(model.role?.kind, 'model');
	assert.equal(model.role?.value, 'openai-codex/gpt-5.6');
	assert.equal(model.role?.label, 'GPT-5.6');
	assert.equal(segmentsToWireText(model.segments), 'analizza lo screenshot');

	const last = pasted('#flotta !smol !openai-codex/gpt-5.6 esegui il task');
	assert.equal(last.role?.kind, 'model');
	assert.equal(segmentsToWireText(last.segments), 'esegui il task');
});

test('Incolla: direttive multiple, tag con trattino e tag senza slash', () => {
	const resolved = pasted('#flotta /plan /grill-me /web rivedi la home');

	assert.deepEqual(resolved.directives.map((d) => d.id), ['d-piano', 'd-grill', 'd-ricerca']);
	assert.equal(segmentsToWireText(resolved.segments), 'rivedi la home');
});

test('Incolla: @file e /comando diventano badge anche in mezzo al messaggio', () => {
	const resolved = pasted('rivedi @src/routes/home.svelte e poi /compact il contesto');

	assert.deepEqual(resolved.segments, [
		{ t: 'text', s: 'rivedi ' },
		{ t: 'file', path: 'src/routes/home.svelte' },
		{ t: 'text', s: ' e poi ' },
		{ t: 'cmd', name: 'compact' },
		{ t: 'text', s: ' il contesto' }
	]);
	assert.equal(segmentsToWireText(resolved.segments), 'rivedi @src/routes/home.svelte e poi /compact il contesto');
});

test('Incolla: percorso fra virgolette, alias e skill:nome', () => {
	const quoted = pasted('apri @"Cruscotto PSR/Pagina.aspx"');
	assert.deepEqual(quoted.segments, [
		{ t: 'text', s: 'apri ' },
		{ t: 'file', path: 'Cruscotto PSR/Pagina.aspx' }
	]);

	const alias = pasted('/cmp adesso');
	assert.deepEqual(alias.segments, [
		{ t: 'cmd', name: 'compact' },
		{ t: 'text', s: ' adesso' }
	]);

	const skill = pasted('/skill:review il modulo');
	assert.equal(segmentsToWireText(skill.segments), '/skill:review il modulo');
});

test('Incolla: email, C# e titolo markdown non sono token', () => {
	for (const text of ['scrivi a foo@bar.it', 'chiudi issue#12 e il fix C#', '# Titolo del task']) {
		const resolved = pasted(text);
		assert.equal(resolved.changed, false, text);
		assert.equal(segmentsToWireText(resolved.segments), text);
	}
});

test('Incolla: le righe restano e i fine riga Windows non spezzano il token', () => {
	const lines = pasted('#flotta Prima riga\nSeconda riga');
	assert.equal(segmentsToWireText(lines.segments), 'Prima riga\nSeconda riga');

	const crlf = pasted('#flotta\r\nSeconda riga');
	assert.equal(segmentsToWireText(crlf.segments), 'Seconda riga');
});

test('Incolla: un messaggio fatto solo di token non lascia testo', () => {
	const resolved = pasted('#flotta /plan !smol');
	assert.equal(resolved.changed, true);
	assert.deepEqual(resolved.segments, []);
	assert.equal(resolved.project?.name, 'GestioneFlotta');
	assert.equal(resolved.role?.value, 'smol');
});

test('Incolla nella risposta: /direttiva resta un badge nel testo, # e ! no', () => {
	const resolved = resolvePastedTokens('guarda /plan e #flotta !smol', SOURCES, {
		triggers: ['@', '/'],
		liftDirectives: false
	});

	assert.equal(resolved.project, null);
	assert.deepEqual(resolved.directives, []);
	assert.equal(resolved.role, null);
	assert.deepEqual(resolved.segments, [
		{ t: 'text', s: 'guarda ' },
		{ t: 'cmd', name: 'plan' },
		{ t: 'text', s: ' e #flotta !smol' }
	]);
});

test('Incolla: il testo che resta coincide con cio che il salvataggio terrebbe', () => {
	const samples = [
		'#cruscotto sistema il bottone',
		'#Studio OMP perché il badge non prende il nome completo',
		'#flotta !smol aggiorna il changelog',
		'#flotta /plan /web rivedi @src/lib/api.ts al volo',
		'#flotta Prima riga\nSeconda riga'
	];
	for (const text of samples) {
		const resolved = pasted(text);
		const parsed = parseQuickTaskLocal(text, PARSE_INPUT);
		assert.equal(segmentsToWireText(resolved.segments), parsed.taskPrompt, text);
		assert.equal(resolved.project?.name ?? null, parsed.projectName);
	}
});
