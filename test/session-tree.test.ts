import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	OmpEntryCache,
	activePath,
	branchTipEntryId,
	buildBranchTree,
	previousMessageEntryId,
	requestBranch,
	requestFork,
	resolveTurnEndEntryId,
	resolveUserEntryId,
	type OmpEntriesPage,
	type OmpSessionEntry,
	type OmpTreeSnapshot,
	type TranscriptRef
} from '../src/lib/agent/sessionTree.ts';
import { parseSlash, routeSessionSlash } from '../src/lib/agent/slashRouter.ts';

// Fixture nel formato di omp 18.8: append-history con due rewind fatti dalla
// TUI (rami abbandonati), una label, una compattazione e un custom_message sul
// ramo attivo. `get_tree.json` e' la stessa storia vista da `get_tree`.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'session-tree');
const ENTRIES = JSON.parse(readFileSync(join(FIXTURES, 'get_entries.json'), 'utf8')) as OmpEntriesPage;
const TREE = JSON.parse(readFileSync(join(FIXTURES, 'get_tree.json'), 'utf8')) as OmpTreeSnapshot;

const byId = new Map(ENTRIES.entries.map((entry) => [entry.id, entry]));
const lookup = (id: string) => byId.get(id);
const PATH = activePath(lookup, ENTRIES.leafId);
const tsOf = (id: string) => byId.get(id)!.message!.timestamp as number;

/** Transcript come lo ricostruisce Studio dal ramo attivo (con timestamp). */
function transcriptWithTs(): TranscriptRef[] {
	return [
		{ id: 1, kind: 'user', content: 'Analizza src/parser.ts e dimmi dove si perde tempo', messageTs: tsOf('c0a1e5f3') },
		{ id: 2, kind: 'assistant', messageTs: tsOf('9d2b7e44') },
		{ id: 3, kind: 'tool' },
		{ id: 4, kind: 'assistant', messageTs: tsOf('e6c4d2b1') },
		{ id: 5, kind: 'user', content: 'Riscrivi tokenize con una regex sticky', messageTs: tsOf('a9f01c3d') },
		{ id: 6, kind: 'tool' },
		{ id: 7, kind: 'assistant', messageTs: tsOf('8e5a6c7d') },
		{ id: 8, kind: 'user', content: 'Prima esegui i benchmark\ne poi dimmi i numeri', messageTs: tsOf('6f5e4d3c') },
		{ id: 9, kind: 'tool' },
		{ id: 10, kind: 'assistant', messageTs: tsOf('9a8b7c6d') },
		{ id: 11, kind: 'compaction' },
		{ id: 12, kind: 'system-chip' },
		{ id: 13, kind: 'user', content: 'Perfetto, procedi con i test', messageTs: tsOf('34ab56cd') },
		{ id: 14, kind: 'assistant', messageTs: tsOf('78ef90ab') }
	];
}

test('sessionTree: percorso attivo dalla radice alla foglia, rami abbandonati esclusi', () => {
	const ids = PATH.map((entry) => entry.id);
	assert.equal(ids[0], '3f1c9a02');
	assert.equal(ids.at(-1), '78ef90ab');
	assert.ok(ids.includes('a9f01c3d') && ids.includes('6f5e4d3c'));
	assert.ok(!ids.includes('41aa07c9'), 'il ramo «senza regex» non e\' attivo');
	assert.ok(!ids.includes('d1e2f3a4'), 'il ramo «aggiungi i test» non e\' attivo');
});

test('sessionTree: un ciclo nei genitori non blocca la risalita', () => {
	const loop = new Map<string, OmpSessionEntry>([
		['a', { type: 'custom', id: 'a', parentId: 'b' }],
		['b', { type: 'custom', id: 'b', parentId: 'a' }]
	]);
	assert.deepEqual(activePath((id) => loop.get(id), 'a').map((e) => e.id), ['b', 'a']);
	assert.deepEqual(activePath((id) => loop.get(id), null), []);
});

test('sessionTree: mappatura messaggio utente -> entry per timestamp', () => {
	const transcript = transcriptWithTs();
	assert.equal(resolveUserEntryId(transcript, 1, PATH), 'c0a1e5f3');
	assert.equal(resolveUserEntryId(transcript, 5, PATH), 'a9f01c3d');
	assert.equal(resolveUserEntryId(transcript, 8, PATH), '6f5e4d3c');
	assert.equal(resolveUserEntryId(transcript, 13, PATH), '34ab56cd');
	assert.equal(resolveUserEntryId(transcript, 4, PATH), null, 'un messaggio assistente non e\' un punto utente');
	assert.equal(resolveUserEntryId(transcript, 999, PATH), null);
});

test('sessionTree: senza timestamp si allinea dalla coda anche dopo la compattazione', () => {
	// Dopo la compattazione `get_messages_page` riparte dal riassunto: il
	// transcript ha solo gli ultimi due messaggi utente, senza timestamp.
	const transcript: TranscriptRef[] = [
		{ id: 50, kind: 'compaction' },
		{ id: 51, kind: 'user', content: 'Prima esegui i benchmark e poi dimmi i numeri' },
		{ id: 52, kind: 'assistant' },
		{ id: 53, kind: 'user', content: 'Perfetto, procedi con i test' }
	];
	assert.equal(resolveUserEntryId(transcript, 51, PATH), '6f5e4d3c', 'gli a capo non contano nel confronto');
	assert.equal(resolveUserEntryId(transcript, 53, PATH), '34ab56cd');
});

test('sessionTree: allineamento con un messaggio in piu\' nel transcript', () => {
	// L'eco ottimistica di un prompt non ancora scritto da omp sposta la coda di uno:
	// si cerca il vicino con lo stesso testo invece di prendere quello sbagliato.
	const transcript: TranscriptRef[] = [
		{ id: 1, kind: 'user', content: 'Riscrivi tokenize con una regex sticky' },
		{ id: 2, kind: 'user', content: 'Prima esegui i benchmark e poi dimmi i numeri' },
		{ id: 3, kind: 'user', content: 'Perfetto, procedi con i test' },
		{ id: 4, kind: 'user', content: 'messaggio appena spedito' }
	];
	assert.equal(resolveUserEntryId(transcript, 2, PATH), '6f5e4d3c');
	assert.equal(resolveUserEntryId(transcript, 4, PATH), null, 'un testo che omp non ha non si inventa');
});

test('sessionTree: punto precedente a un messaggio utente', () => {
	assert.equal(previousMessageEntryId(lookup, 'a9f01c3d'), 'e6c4d2b1');
	// label, compattazione e custom_message non sono messaggi: si salta al risultato assistente.
	assert.equal(previousMessageEntryId(lookup, '34ab56cd'), '9a8b7c6d');
	// Il primo messaggio ha solo cambi di modello sopra: nessun punto da cui ripartire.
	assert.equal(previousMessageEntryId(lookup, 'c0a1e5f3'), null);
});

test('sessionTree: fine turno per «Dirama da qui» sotto una risposta', () => {
	const transcript = transcriptWithTs();
	// Turno con tool: l'ultima risposta testuale chiude il turno.
	assert.equal(
		resolveTurnEndEntryId(transcript, { userTranscriptId: 5, assistantTs: tsOf('8e5a6c7d') }, PATH),
		'8e5a6c7d'
	);
	// Senza timestamp assistente si parte dal messaggio utente del turno.
	assert.equal(resolveTurnEndEntryId(transcript, { userTranscriptId: 8, assistantTs: null }, PATH), '9a8b7c6d');
	// Un turno chiuso da un tool (nessun testo finale) termina sul risultato del tool.
	const toolTurnPath = activePath(lookup, '5e7f1a90');
	assert.equal(resolveTurnEndEntryId(transcript, { userTranscriptId: 1, assistantTs: null }, toolTurnPath), '5e7f1a90');
	assert.equal(resolveTurnEndEntryId(transcript, { userTranscriptId: null, assistantTs: null }, PATH), null);
});

test('sessionTree: cache get_entries incrementale con since', async () => {
	const cache = new OmpEntryCache();
	const calls: Array<string | undefined> = [];
	let available = ENTRIES.entries.slice(0, 10);
	let leaf = available.at(-1)!.id;
	const fetch = async (since?: string): Promise<OmpEntriesPage> => {
		calls.push(since);
		if (since === undefined) return { entries: available, leafId: leaf };
		const index = available.findIndex((entry) => entry.id === since);
		if (index < 0) throw Object.assign(new Error(`Unknown entries cursor: ${since}`), { code: 'unknown_since' });
		return { entries: available.slice(index + 1), leafId: leaf };
	};

	await cache.sync(fetch, 'sess-1');
	assert.equal(cache.size, 10);
	available = ENTRIES.entries;
	leaf = ENTRIES.leafId!;
	await cache.sync(fetch, 'sess-1');
	assert.equal(cache.size, ENTRIES.entries.length);
	assert.equal(cache.leafId, '78ef90ab');
	assert.deepEqual(calls, [undefined, ENTRIES.entries[9].id], 'la seconda richiesta chiede solo la coda');

	// Riscrittura che conserva l'ultima entry: il cursore vale ancora, niente ricarica.
	available = ENTRIES.entries.slice(0, 5).concat(ENTRIES.entries.slice(12));
	calls.length = 0;
	await cache.sync(fetch, 'sess-1');
	assert.deepEqual(calls, ['78ef90ab']);
	assert.equal(cache.size, ENTRIES.entries.length);

	// Cambio sessione (fork): la copia vecchia non vale.
	calls.length = 0;
	available = ENTRIES.entries.slice(0, 3);
	leaf = available.at(-1)!.id;
	await cache.sync(fetch, 'sess-2');
	assert.deepEqual(calls, [undefined]);
	assert.equal(cache.size, 3);

	// Cursore sconosciuto: unknown_since -> ricarica completa.
	calls.length = 0;
	available = ENTRIES.entries.slice(5, 9);
	leaf = available.at(-1)!.id;
	await cache.sync(fetch, 'sess-2');
	assert.deepEqual(calls, [ENTRIES.entries[2].id, undefined]);
	assert.equal(cache.size, 4);
});

test('sessionTree: foglia fuori dalla copia -> ricarica completa', async () => {
	const cache = new OmpEntryCache();
	let mode: 'first' | 'moved' = 'first';
	const fetch = async (since?: string): Promise<OmpEntriesPage> => {
		if (mode === 'first') return { entries: ENTRIES.entries.slice(0, 6), leafId: ENTRIES.entries[5].id };
		if (since !== undefined) return { entries: [], leafId: 'sconosciuta' };
		return { entries: ENTRIES.entries, leafId: ENTRIES.leafId };
	};
	await cache.sync(fetch, 's');
	mode = 'moved';
	const requests = await cache.sync(fetch, 's');
	assert.equal(requests, 2);
	assert.equal(cache.size, ENTRIES.entries.length);
});

test('sessionTree: righe del pannello Rami da get_tree', () => {
	const tree = buildBranchTree(TREE);
	const rows = tree.rows.map((row) => `${'  '.repeat(row.depth)}${row.active ? '*' : '-'} ${row.text}`);
	assert.deepEqual(rows, [
		'* Analizza src/parser.ts e dimmi dove si perde tempo',
		'  - Riscrivi tokenize senza regex',
		'* Riscrivi tokenize con una regex sticky',
		'  - Ora aggiungi i test',
		'* Prima esegui i benchmark',
		'* Perfetto, procedi con i test'
	]);
	assert.equal(tree.branchPoints, 2);
	const current = tree.rows.filter((row) => row.current);
	assert.deepEqual(current.map((row) => row.entryId), ['34ab56cd']);
	// Le biforcazioni stanno sotto le risposte: il messaggio utente che le
	// precede vede due rami utente.
	const forked = tree.rows.filter((row) => row.forks > 0).map((row) => [row.entryId, row.forks]);
	assert.deepEqual(forked, [['c0a1e5f3', 2], ['a9f01c3d', 2]]);
	const analyse = tree.rows.find((row) => row.entryId === 'c0a1e5f3')!;
	assert.equal(analyse.time, tsOf('c0a1e5f3'));
	const bench = tree.rows.find((row) => row.entryId === '6f5e4d3c')!;
	assert.equal(bench.label, 'benchmark');
	const alt = tree.rows.find((row) => row.entryId === '41aa07c9')!;
	assert.equal(alt.branchStart, true);
	assert.equal(alt.active, false);
});

test('sessionTree: punta del ramo per «Passa a questo ramo»', () => {
	const tree = buildBranchTree(TREE);
	assert.equal(branchTipEntryId(tree, '41aa07c9'), '7b3e9f20');
	assert.equal(branchTipEntryId(tree, 'd1e2f3a4'), '0b9c8d7e');
	// Sul ramo attivo si scende lungo il ramo attivo fino alla foglia.
	assert.equal(branchTipEntryId(tree, 'c0a1e5f3'), '78ef90ab');
	assert.equal(branchTipEntryId(tree, 'non-esiste'), null);
});

test('sessionTree: albero vuoto e sessione lineare lunga senza ricorsione', () => {
	assert.deepEqual(buildBranchTree({ tree: [], leafId: null }).rows, []);
	// 6000 entry in fila: una ricorsione per livello sfonderebbe lo stack.
	const chain: OmpSessionEntry[] = [];
	for (let i = 0; i < 6000; i++) {
		const role = i % 2 === 0 ? 'user' : 'assistant';
		chain.push({
			type: 'message',
			id: `e${i}`,
			parentId: i === 0 ? null : `e${i - 1}`,
			message: { role, content: [{ type: 'text', text: `msg ${i}` }], timestamp: 1_000 + i }
		});
	}
	let root: { entry: OmpSessionEntry; children: unknown[] } | null = null;
	let prev: { entry: OmpSessionEntry; children: unknown[] } | null = null;
	for (const entry of chain) {
		const node = { entry, children: [] as unknown[] };
		if (prev) prev.children.push(node);
		else root = node;
		prev = node;
	}
	const tree = buildBranchTree({ tree: [root as never], leafId: 'e5999' });
	assert.equal(tree.rows.length, 3000);
	assert.ok(tree.rows.every((row) => row.depth === 0 && row.active));
	assert.equal(tree.rows.at(-1)!.current, true);
	assert.equal(tree.branchPoints, 0);
});

test('sessionTree: esiti di fork e branch', async () => {
	const sent: unknown[] = [];
	const ok = async (command: unknown) => {
		sent.push(command);
		return { cancelled: false };
	};
	assert.deepEqual(await requestFork(ok), { kind: 'done' });
	assert.deepEqual(await requestFork(ok, '9a8b7c6d'), { kind: 'done' });
	assert.deepEqual(sent, [{ type: 'fork' }, { type: 'fork', entryId: '9a8b7c6d' }]);

	assert.deepEqual(await requestFork(async () => ({ cancelled: true })), { kind: 'cancelled' });
	const busy = Object.assign(new Error('Cannot fork the session while it is busy'), { code: 'session_busy' });
	assert.deepEqual(await requestFork(async () => { throw busy; }), { kind: 'busy' });
	assert.deepEqual(
		await requestFork(async () => { throw new Error('Invalid entry ID for forking: x'); }, 'x'),
		{ kind: 'error', message: 'Invalid entry ID for forking: x' }
	);

	assert.deepEqual(
		await requestBranch(async () => ({ text: 'Ora aggiungi i test', cancelled: false }), 'd1e2f3a4'),
		{ kind: 'done', text: 'Ora aggiungi i test' }
	);
	assert.deepEqual(await requestBranch(async () => ({ text: '', cancelled: true }), 'd1e2f3a4'), { kind: 'cancelled' });
	assert.deepEqual(await requestBranch(async () => { throw busy; }, 'd1e2f3a4'), { kind: 'busy' });
});

test('slashRouter: /resume e /sessions elenco, /tree rami, /fork fork', () => {
	assert.deepEqual(routeSessionSlash('/resume'), { kind: 'sessions' });
	assert.deepEqual(routeSessionSlash('  /Resume   0199abcd-ef  '), { kind: 'resume', sessionId: '0199abcd-ef' });
	assert.deepEqual(routeSessionSlash('/sessions'), { kind: 'sessions' });
	assert.deepEqual(routeSessionSlash('/sessions extra'), { kind: 'sessions' });
	assert.deepEqual(routeSessionSlash('/tree'), { kind: 'branches' });
	assert.deepEqual(routeSessionSlash('/TREE'), { kind: 'branches' });
	assert.deepEqual(routeSessionSlash('/fork'), { kind: 'fork' });
	assert.equal(routeSessionSlash('/branch'), null, '/branch resta l\'alias del pannello Git');
	assert.equal(routeSessionSlash('/compact'), null);
	assert.deepEqual(parseSlash('  /name   Nuovo   titolo '), { command: '/name', lower: '/name', argument: 'Nuovo titolo' });
	assert.deepEqual(parseSlash(''), { command: '', lower: '', argument: '' });
});
