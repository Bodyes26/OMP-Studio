/**
 * Heads-up di fine turno (Gate R40): fatti certi, priorita' delle
 * fonti, frase unica, estensione `studio_headsup` e caricamento con `-e`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	agentHeadsUp,
	buildTurnDigest,
	clampSentence,
	collectTurnFacts,
	factsSentence,
	headsUpSeenKey,
	isHeadsUpToolEntry,
	isRiskyCommand,
	isSensitivePath,
	lastTurnEntries,
	resolveHeadsUp,
	verifyKey,
	wantsSmolHeadsUp,
	HEADS_UP_MAX_CHARS,
	type HeadsUpPhrases
} from '../src/lib/agent/turnHeadsUp.ts';
import studioHeadsUpExtension, { normalizeHeadsUpText } from '../extensions/studio-headsup.ts';
import type { TranscriptEntry } from '../src/lib/agent/session.svelte.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let nextId = 1;
function user(content = 'fai il lavoro'): TranscriptEntry {
	return { id: nextId++, kind: 'user', content, images: [] };
}
function assistant(text: string): TranscriptEntry {
	return { id: nextId++, kind: 'assistant', blocks: [{ type: 'text', text }] };
}
function bash(command: string, exitCode = 0, isError = false): TranscriptEntry {
	return {
		id: nextId++,
		kind: 'tool',
		toolCallId: `c${nextId}`,
		toolName: 'bash',
		args: { command },
		result: { content: [], details: exitCode !== 0 ? { exitCode } : {}, isError },
		running: false,
		startedAt: 0
	};
}
function tool(toolName: string, args: Record<string, unknown>, details: unknown = {}, isError = false): TranscriptEntry {
	return {
		id: nextId++,
		kind: 'tool',
		toolCallId: `c${nextId}`,
		toolName,
		args,
		result: { content: [], details, isError },
		running: false,
		startedAt: 0
	};
}

const phrases: HeadsUpPhrases = {
	failed: (c) => `«${c}» è fallito e non è stato rieseguito con successo`,
	failedTwo: (a, b) => `«${a}» e «${b}» sono falliti e non sono stati rieseguiti con successo`,
	failedMany: (c, n) => `«${c}» e altri ${n} comandi di verifica sono falliti senza essere risolti`,
	expiredQuestion: () => "una domanda è scaduta senza risposta e l'agente ha proseguito con la scelta predefinita",
	risky: (c) => `ha eseguito «${c}»`,
	sensitive: (f) => `ha modificato ${f}`,
	sensitiveMany: (f, n) => `ha modificato ${f} e altri ${n} file delicati`,
	and: 'e'
};

describe('Heads-up: fatti certi del turno', () => {
	it('considera solo i comandi di verifica, non grep o ls che escono con 1', () => {
		assert.equal(verifyKey('npm test'), 'npm test');
		assert.equal(verifyKey('cd src-tauri && cargo check --all'), 'cargo check');
		assert.equal(verifyKey('npx svelte-check --tsconfig x'), 'npx svelte-check');
		assert.equal(verifyKey('npm run check:commands'), 'npm run check:commands');
		assert.equal(verifyKey('grep -rn foo src'), null);
		assert.equal(verifyKey('ls missing'), null);
		const facts = collectTurnFacts([bash('grep -rn foo src', 1), bash('ls missing', 2)]);
		assert.deepEqual(facts, []);
	});

	it('un test fallito e poi riuscito non e\' un fatto; uno fallito per ultimo si', () => {
		assert.deepEqual(collectTurnFacts([bash('npm test', 1), bash('npm test')]), []);
		const failed = bash('npm test', 1);
		const facts = collectTurnFacts([bash('npm test'), failed]);
		assert.equal(facts.length, 1);
		assert.equal(facts[0].kind, 'failed-command');
		assert.equal(facts[0].entryId, failed.id);
		assert.equal(facts[0].subject, 'npm test');
	});

	it('un timeout del comando (isError) conta come fallimento', () => {
		const facts = collectTurnFacts([bash('cargo test', 0, true)]);
		assert.equal(facts[0]?.kind, 'failed-command');
	});

	it('riconosce comandi rischiosi riusciti, ma non la pulizia di cartelle usa e getta', () => {
		assert.ok(isRiskyCommand('git push origin main'));
		assert.ok(isRiskyCommand('git reset --hard HEAD~1'));
		assert.ok(isRiskyCommand('rm -rf src/lib/old'));
		assert.ok(!isRiskyCommand('rm -rf node_modules'));
		assert.ok(!isRiskyCommand('rm -rf /tmp/scratch && npm install'));
		assert.ok(!isRiskyCommand('git status'));
		const facts = collectTurnFacts([bash('git push origin main')]);
		assert.equal(facts[0]?.kind, 'risky-command');
	});

	it('segnala i file delicati modificati, non i lockfile da soli', () => {
		assert.ok(isSensitivePath('package.json'));
		assert.ok(isSensitivePath('C:\\repo\\db\\migrations\\0003_add.sql'));
		assert.ok(isSensitivePath('.github/workflows/ci.yml'));
		assert.ok(isSensitivePath('.env.local'));
		assert.ok(isSensitivePath('prisma/schema.prisma'));
		assert.ok(!isSensitivePath('bun.lock'));
		assert.ok(!isSensitivePath('src/lib/agent/session.svelte.ts'));
		const facts = collectTurnFacts([
			tool('edit', { path: 'package.json' }),
			tool('write', { path: 'src/a.ts' }),
			tool('edit', { input: '[db/migrations/0004.sql#1]\n+x' }),
			tool('edit', { path: 'package.json' })
		]);
		assert.deepEqual(
			facts.map((f) => [f.kind, f.subject]),
			[
				['sensitive-file', 'package.json'],
				['sensitive-file', '0004.sql']
			]
		);
	});

	it('una modifica fallita non conta', () => {
		assert.deepEqual(collectTurnFacts([tool('edit', { path: 'package.json' }, {}, true)]), []);
	});

	it('riconosce una domanda ask scaduta (singola e multipla)', () => {
		const single = tool('ask', { question: 'A o B?' }, { timedOut: true, selectedOptions: ['A'] });
		const multi = tool('ask', { questions: [] }, { results: [{ timedOut: false }, { timedOut: true }] });
		const facts = collectTurnFacts([single, multi]);
		assert.deepEqual(
			facts.map((f) => f.kind),
			['expired-question', 'expired-question']
		);
	});

	it('ordina per gravita\': comando fallito prima di tutto', () => {
		const facts = collectTurnFacts([tool('edit', { path: 'Cargo.toml' }), bash('git push'), bash('npm test', 1)]);
		assert.deepEqual(
			facts.map((f) => f.kind),
			['failed-command', 'risky-command', 'sensitive-file']
		);
	});
});

describe('Heads-up: una frase sola', () => {
	it('compone al massimo due clausole dai fatti, con maiuscola e punto', () => {
		const facts = collectTurnFacts([tool('edit', { path: 'Cargo.toml' }), bash('npm test', 1), bash('git push')]);
		assert.equal(
			factsSentence(facts, phrases),
			'«npm test» è fallito e non è stato rieseguito con successo; ha eseguito «git push».'
		);
		assert.equal(factsSentence([], phrases), null);
	});

	it('raggruppa piu\' file e piu\' comandi falliti', () => {
		const facts = collectTurnFacts([
			tool('edit', { path: 'package.json' }),
			tool('edit', { path: 'Cargo.toml' }),
			tool('edit', { path: '.env' })
		]);
		assert.equal(factsSentence(facts, phrases), 'Ha modificato package.json, Cargo.toml e .env.');
		const four = collectTurnFacts(
			['package.json', 'Cargo.toml', '.env', 'AGENTS.md'].map((path) => tool('edit', { path }))
		);
		assert.equal(factsSentence(four, phrases), 'Ha modificato package.json, Cargo.toml e altri 2 file delicati.');
		const two = collectTurnFacts([bash('npm test', 1), bash('cargo check', 101)]);
		assert.equal(
			factsSentence(two, phrases),
			'«npm test» e «cargo check» sono falliti e non sono stati rieseguiti con successo.'
		);
		const three = collectTurnFacts([bash('npm test', 1), bash('cargo check', 101), bash('npm run lint', 1)]);
		assert.match(factsSentence(three, phrases) ?? '', /^«npm test» e altri 2 comandi/);
	});

	it('clampSentence comprime righe e markdown e taglia a 220 caratteri', () => {
		assert.equal(clampSentence('  - **Ha cambiato**\n lo `schema`  '), 'Ha cambiato lo schema');
		const long = clampSentence('parola '.repeat(80));
		assert.ok(long.length <= HEADS_UP_MAX_CHARS);
		assert.ok(long.endsWith('…'));
	});
});

describe('Heads-up: fonti e priorita\'', () => {
	it('la frase dell\'agente vince su smol e fatti; smol vince sui fatti', () => {
		const facts = collectTurnFacts([bash('npm test', 1)]);
		const base = { facts, factsText: factsSentence(facts, phrases), fallbackEntryId: 99 };
		const agent = resolveHeadsUp({ ...base, agent: { text: 'Non ho compilato il Rust.', entryId: 5 }, smol: 'x' });
		assert.equal(agent?.source, 'agent');
		assert.equal(agent?.targetEntryId, facts[0].entryId);
		const smol = resolveHeadsUp({ ...base, agent: null, smol: 'Ha rotto i test; chiede se tenere la vecchia API.' });
		assert.equal(smol?.source, 'smol');
		const onlyFacts = resolveHeadsUp({ ...base, agent: null, smol: '   ' });
		assert.equal(onlyFacts?.source, 'facts');
		assert.equal(resolveHeadsUp({ facts: [], factsText: null, fallbackEntryId: 1, agent: null, smol: null }), null);
	});

	it('senza fatti il clic porta all\'ultima risposta', () => {
		const hu = resolveHeadsUp({ facts: [], factsText: null, fallbackEntryId: 42, agent: { text: 'x', entryId: 1 }, smol: null });
		assert.equal(hu?.targetEntryId, 42);
	});

	it('legge l\'ultima chiamata studio_headsup del turno e ignora quelle in errore', () => {
		const turn = [
			tool('studio_headsup', { text: 'prima' }),
			tool('studio_headsup', { text: 'seconda\nriga' }),
			tool('studio_headsup', { text: 'sbagliata' }, {}, true)
		];
		assert.equal(agentHeadsUp(turn)?.text, 'seconda riga');
		assert.ok(isHeadsUpToolEntry(turn[0]));
		assert.equal(agentHeadsUp([assistant('ciao')]), null);
	});

	it('lastTurnEntries parte dall\'ultimo messaggio utente', () => {
		const a = assistant('vecchio');
		const u = user();
		const b = assistant('nuovo');
		assert.deepEqual(lastTurnEntries([a, u, b]), [b]);
		assert.deepEqual(lastTurnEntries([a]), [a]);
	});

	it('chiede il ripiego smol solo per turni che possono nascondere qualcosa', () => {
		assert.equal(wantsSmolHeadsUp([assistant('Fatto.')], []), false);
		assert.equal(wantsSmolHeadsUp([assistant('x'.repeat(1600))], []), true);
		const tools = Array.from({ length: 8 }, () => bash('ls'));
		assert.equal(wantsSmolHeadsUp(tools, []), true);
		const facts = collectTurnFacts([bash('npm test', 1)]);
		assert.equal(wantsSmolHeadsUp([assistant('ok')], facts), true);
	});

	it('il digest contiene i fatti e tutto il testo, tagliato in mezzo', () => {
		const facts = collectTurnFacts([bash('npm test', 1)]);
		const turn = [assistant('INIZIO ' + 'a'.repeat(5000)), assistant('b'.repeat(5000) + ' FINE')];
		const digest = buildTurnDigest(turn, facts, 2000);
		assert.match(digest, /failed-command: npm test/);
		assert.match(digest, /INIZIO/);
		assert.match(digest, /FINE/);
		assert.match(digest, /\[…\]/);
		assert.ok(digest.length < 2300);
	});

	it('la chiave «visto» dipende da sessione e frase, non dagli id del transcript', () => {
		assert.equal(headsUpSeenKey('s1', 'abc'), headsUpSeenKey('s1', 'abc'));
		assert.notEqual(headsUpSeenKey('s1', 'abc'), headsUpSeenKey('s2', 'abc'));
		assert.notEqual(headsUpSeenKey('s1', 'abc'), headsUpSeenKey('s1', 'abd'));
		assert.match(headsUpSeenKey(null, 'x'), /^nosession\|/);
	});
});

describe('Estensione studio-headsup', () => {
	type Registered = {
		name: string;
		approval: string;
		description: string;
		execute: (id: string, params: unknown) => Promise<{ content: { text: string }[]; isError?: boolean; details?: Record<string, unknown> }>;
	};
	const registered = new Map<string, Registered>();
	const fakeZod = {
		object: () => fakeZod,
		string: () => fakeZod,
		optional: () => fakeZod,
		describe: () => fakeZod
	};
	studioHeadsUpExtension({
		zod: fakeZod as never,
		registerTool: (def: unknown) => {
			const tool = def as Registered;
			registered.set(tool.name, tool);
		}
	});

	it('registra studio_headsup in sola lettura con la regola d\'uso nella descrizione', () => {
		const tool = registered.get('studio_headsup');
		assert.ok(tool);
		assert.equal(tool.approval, 'read');
		assert.match(tool.description, /UNA sola frase/);
		assert.match(tool.description, /NON chiamarlo per riassumere/);
	});

	it('risponde subito ok e rifiuta una frase vuota', async () => {
		const tool = registered.get('studio_headsup')!;
		const ok = await tool.execute('1', { text: '  Ha cambiato lo schema\n del DB. ' });
		assert.equal(ok.content[0].text, 'ok');
		assert.equal(ok.details?.text, 'Ha cambiato lo schema del DB.');
		const empty = await tool.execute('2', { text: '   ' });
		assert.equal(empty.isError, true);
		assert.equal(normalizeHeadsUpText(42), '');
		assert.ok(normalizeHeadsUpText('x'.repeat(500)).length <= 220);
	});

	it('Studio carica l\'estensione con -e sia nel PTY sia in RPC', () => {
		const pty = readFileSync(join(ROOT, 'src-tauri/src/pty/mod.rs'), 'utf8');
		const rpc = readFileSync(join(ROOT, 'src-tauri/src/rpc/mod.rs'), 'utf8');
		assert.match(pty, /include_str!\("\.\.\/\.\.\/\.\.\/extensions\/studio-headsup\.ts"\)/);
		assert.equal((pty.match(/&headsup_extension_arg/g) ?? []).length, 2, 'Windows e Unix');
		assert.match(rpc, /write_extension\("studio-headsup\.ts", crate::pty::HEADSUP_EXTENSION_TS\)/);
		assert.match(rpc, /&headsup_extension \{\s*command\.arg\("-e"\)/);
	});
});
