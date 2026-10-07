/**
 * Tool `corsia_*` guidati dall'agente (Gate R33).
 *
 * Contratti verificati:
 * 1. Permessi per chiamante: dentro una corsia solo `fatto` e `stato`, nel
 *    Laboratorio solo `fatto`; la Principale vede tutto tranne `fatto`.
 * 2. L'estensione parla con `/v1/corsie/<verbo>` col token del bridge e
 *    inoltra il `toolCallId` della proposta (la card lo usa come chiave).
 * 3. Nessun testo per l'agente contiene istruzioni git (`git add`, merge...).
 * 4. La corsia nominata dall'agente si risolve per id, prototipo o titolo;
 *    un titolo ambiguo non sceglie a caso.
 * 5. Il riassunto di `corsia_fatto` sopravvive al giro su `lanes.json`.
 * 6. L'hook fail-closed del Laboratorio ammette `corsia_fatto` e nient'altro.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import studioLanesExtension, {
	callBridge,
	corsiaToolsFor,
	type CorsieEnvironment
} from '../extensions/studio-lanes.ts';
import { createLabToolCallHook } from '../extensions/studio-lab.ts';
import {
	buildLabHandoffPackage,
	classifyAgentLane,
	computeDiffstat,
	corsiaVerboOf,
	formatStatoText,
	isCorsiaTool,
	proposalAgentText,
	resolveLaneRef,
	verboAllowedForCaller,
	CORSIA_VERBI,
	type LaneRefCandidate
} from '../src/lib/lanes/agentLaneRoutes.ts';
import {
	laneRecordFromAgentLane,
	parseLaneStoreDocument,
	serializeLaneStoreDocument
} from '../src/lib/stores/lanePersistence.ts';
import { createMainLane, laneId, projectId, workspacePath } from '../src/lib/types/lanes.ts';
import { categorizeTool } from '../src/lib/agent/tools/categories.ts';
import { useLocale } from './locale.ts';

const BRIDGE: CorsieEnvironment = { bridgeUrl: 'http://127.0.0.1:4321/', bridgeToken: 'tok' };

interface RegisteredTool {
	name: string;
	description: string;
	approval: string;
	execute: (id: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<{
		content: { text: string }[];
		isError?: boolean;
		details?: Record<string, unknown>;
	}>;
}

/** Zod finto: basta che le chiamate a catena non esplodano. */
function fakeZod() {
	const node: Record<string, unknown> = {};
	const self = () => node;
	Object.assign(node, { optional: self, describe: self });
	return { object: self, string: self, number: self, boolean: self, enum: self };
}

function register(env: CorsieEnvironment): Map<string, RegisteredTool> {
	const tools = new Map<string, RegisteredTool>();
	studioLanesExtension(
		{
			zod: fakeZod() as never,
			registerTool: (definition: unknown) => {
				const tool = definition as RegisteredTool;
				tools.set(tool.name, tool);
			}
		},
		env
	);
	return tools;
}

describe('Gate R33 — tool corsia_* guidati dall\'agente', () => {
	describe('1. Permessi per chiamante', () => {
		it('la Principale vede tutti i verbi tranne fatto', () => {
			const tools = corsiaToolsFor({ ...BRIDGE, laneId: 'main' });
			assert.deepEqual(
				[...tools].sort(),
				CORSIA_VERBI.filter((v) => v !== 'fatto').map((v) => `corsia_${v}`).sort()
			);
			assert.deepEqual(corsiaToolsFor({ ...BRIDGE }), tools, 'senza OMP_LANE_ID vale come Principale');
		});

		it('dentro un worktree solo fatto e stato, nel Laboratorio solo fatto', () => {
			assert.deepEqual(corsiaToolsFor({ ...BRIDGE, laneId: 'wt1' }), ['corsia_fatto', 'corsia_stato']);
			assert.deepEqual(corsiaToolsFor({ ...BRIDGE, laneId: 'lab-p-1', labSession: true }), ['corsia_fatto']);
		});

		it('senza bridge nessun tool', () => {
			assert.deepEqual(corsiaToolsFor({ laneId: 'main' }), []);
			assert.equal(register({}).size, 0);
		});

		it('il frontend rispecchia i permessi del bridge Rust', () => {
			for (const verbo of CORSIA_VERBI) {
				assert.equal(verboAllowedForCaller(verbo, 'main'), verbo !== 'fatto', `main/${verbo}`);
				assert.equal(verboAllowedForCaller(verbo, null), verbo !== 'fatto', `null/${verbo}`);
				assert.equal(
					verboAllowedForCaller(verbo, 'wt2'),
					verbo === 'fatto' || verbo === 'stato',
					`corsia/${verbo}`
				);
			}
		});

		it('ogni tool ha il suo livello di approvazione', () => {
			const main = register({ ...BRIDGE, laneId: 'main' });
			const approvals = Object.fromEntries([...main.values()].map((tool) => [tool.name, tool.approval]));
			assert.deepEqual(approvals, {
				corsia_avvia: 'write',
				corsia_stato: 'read',
				corsia_risultato: 'read',
				corsia_integra: 'write',
				corsia_chiudi: 'write',
				corsia_scarta: 'write',
				corsia_consegna: 'write',
				corsia_proponi: 'read'
			});
			assert.equal(register({ ...BRIDGE, laneId: 'wt1' }).get('corsia_fatto')?.approval, 'read');
		});
	});

	describe('2. Chiamate al bridge', () => {
		it('POST su /v1/corsie/<verbo> col token, esito ok come testo', async () => {
			const calls: Array<{ url: string; init: RequestInit }> = [];
			const fakeFetch = (async (url: string, init: RequestInit) => {
				calls.push({ url, init });
				return new Response(JSON.stringify({ ok: true, text: 'Corsia wt3 avviata', details: { corsia: 'wt3' } }));
			}) as unknown as typeof fetch;
			const result = await callBridge(BRIDGE, 'avvia', { obiettivo: 'x', tipo: 'worktree' }, undefined, fakeFetch);
			assert.equal(calls[0].url, 'http://127.0.0.1:4321/v1/corsie/avvia');
			assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer tok');
			assert.deepEqual(JSON.parse(String(calls[0].init.body)), { obiettivo: 'x', tipo: 'worktree' });
			assert.equal(result.isError, undefined);
			assert.equal(result.content[0].text, 'Corsia wt3 avviata');
			assert.equal(result.details?.corsia, 'wt3');
			assert.equal(result.details?.verbo, 'avvia');
		});

		it('un rifiuto del bridge diventa errore del tool, un JSON rotto pure', async () => {
			const denied = (async () =>
				new Response(JSON.stringify({ ok: false, text: 'Dentro una corsia sono ammessi solo corsia_fatto e corsia_stato' }), {
					status: 403
				})) as unknown as typeof fetch;
			const result = await callBridge(BRIDGE, 'integra', { messaggio: 'x' }, undefined, denied);
			assert.equal(result.isError, true);
			const broken = (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch;
			const brokenResult = await callBridge(BRIDGE, 'stato', {}, undefined, broken);
			assert.equal(brokenResult.isError, true);
			assert.match(brokenResult.content[0].text, /502/);
		});

		it('corsia_proponi inoltra il toolCallId e gli argomenti', async () => {
			const original = globalThis.fetch;
			let body: Record<string, unknown> = {};
			globalThis.fetch = (async (_url: string, init: RequestInit) => {
				body = JSON.parse(String(init.body));
				return new Response(JSON.stringify({ ok: true, text: 'resta su main', details: { scelta: 'main' } }));
			}) as unknown as typeof fetch;
			try {
				const tool = register({ ...BRIDGE, laneId: 'main' }).get('corsia_proponi')!;
				const result = await tool.execute('call-42', { motivo: 'Cancella dist e node_modules', obiettivo: 'Pulizia build' });
				assert.deepEqual(body, { motivo: 'Cancella dist e node_modules', obiettivo: 'Pulizia build', toolCallId: 'call-42' });
				assert.equal(result.isError, undefined);
				const missing = await tool.execute('call-43', { motivo: '  ' });
				assert.equal(missing.isError, true, 'motivo vuoto non arriva al bridge');
			} finally {
				globalThis.fetch = original;
			}
		});
	});

	describe('3. Nessuna istruzione git per l\'agente', () => {
		it('le descrizioni dei tool non chiedono mai di usare git', () => {
			const tools = [...register({ ...BRIDGE, laneId: 'main' }).values(), ...register({ ...BRIDGE, laneId: 'wt1' }).values()];
			for (const tool of tools) {
				assert.doesNotMatch(tool.description, /git (add|merge|rebase|commit|worktree)\b/i, tool.name);
			}
			const integra = register({ ...BRIDGE }).get('corsia_integra')!;
			assert.match(integra.description, /conflitti NON li risolvi tu/);
			const proponi = register({ ...BRIDGE }).get('corsia_proponi')!;
			assert.match(proponi.description, /Non creare mai corsie in silenzio/);
			const avvia = register({ ...BRIDGE }).get('corsia_avvia')!;
			assert.match(avvia.description, /mai di tua iniziativa e mai in silenzio/);
		});

		it('stato e consegna non mostrano comandi git', () => {
			const text = formatStatoText([
				{ laneId: 'wt1', title: 'Login', kind: 'git', state: 'finita', diffstat: computeDiffstat([{ path: 'a.ts', additions: 3, deletions: 1 }]), summary: 'Fatto' },
				{ laneId: 'coda-1', title: 'Report', kind: 'goal', state: 'in_coda' }
			]);
			assert.match(text, /wt1 \(worktree\) "Login": finita/);
			assert.match(text, /1 file, \+3 -1/);
			assert.match(text, /coda-1 \(obiettivo\) "Report": in coda/);
			assert.doesNotMatch(text, /git /);
			assert.match(proposalAgentText('main'), /resta su main/);
			assert.match(
				proposalAgentText('worktree', { laneId: 'wt4', title: 'Prova', dispatched: true }),
				/Non eseguire l'operazione sulla Principale/
			);
		});
	});

	describe('4. Risoluzione della corsia nominata', () => {
		const lanes: LaneRefCandidate[] = [
			{ laneId: 'main', title: 'Principale', kind: 'git', status: 'active' },
			{ laneId: 'wt1', title: 'Login', kind: 'git', status: 'active' },
			{ laneId: 'wt2', title: 'Report', kind: 'git', status: 'closed' },
			{ laneId: 'wt3', title: 'Report', kind: 'git', status: 'active' },
			{ laneId: 'wt9', title: 'Vecchia', kind: 'git', status: 'archived' },
			{ laneId: 'lab-p-20260101-abc123', title: 'Dashboard', kind: 'lab', status: 'active', labPrototypeId: 'p-20260101-abc123' }
		];

		it('per id, prototipo o titolo', () => {
			assert.equal(resolveLaneRef(lanes, 'wt1').kind, 'found');
			const proto = resolveLaneRef(lanes, 'p-20260101-abc123');
			assert.equal(proto.kind === 'found' && proto.lane.laneId, 'lab-p-20260101-abc123');
			const title = resolveLaneRef(lanes, 'login');
			assert.equal(title.kind === 'found' && title.lane.laneId, 'wt1');
		});

		it('titolo ambiguo, archiviate e Principale non si scelgono', () => {
			assert.equal(resolveLaneRef(lanes, 'Report').kind, 'ambiguous');
			assert.equal(resolveLaneRef(lanes, 'wt9').kind, 'missing');
			assert.equal(resolveLaneRef(lanes, 'main').kind, 'missing');
			assert.equal(resolveLaneRef(lanes, '').kind, 'missing');
		});

		it('riconosce i nomi dei tool corsia', () => {
			assert.equal(corsiaVerboOf('corsia_integra'), 'integra');
			assert.equal(isCorsiaTool('corsia_proponi'), true);
			assert.equal(isCorsiaTool('corsia_merge'), false);
			assert.equal(isCorsiaTool('studio_lane_integrate'), false);
		});
	});

	describe('5. Stato sintetico e riassunto persistito', () => {
		it('bloccata quando serve l\'utente, finita dopo corsia_fatto', () => {
			assert.equal(classifyAgentLane({ status: 'conflict', agentState: 'idle' }), 'bloccata');
			assert.equal(classifyAgentLane({ status: 'active', agentState: 'attention' }), 'bloccata');
			assert.equal(classifyAgentLane({ status: 'active', agentState: 'idle', recoveryState: 'cleanup_pending' }), 'bloccata');
			assert.equal(classifyAgentLane({ status: 'active', agentState: 'working', agentSummaryAt: 5 }), 'in_corso');
			assert.equal(classifyAgentLane({ status: 'active', agentState: 'idle', agentSummaryAt: 5 }), 'finita');
			assert.equal(classifyAgentLane({ status: 'review_ready', agentState: 'unknown' }), 'finita');
			assert.equal(classifyAgentLane({ status: 'closed', agentState: 'idle' }), 'chiusa');
		});

		it('agentSummary sopravvive a lanes.json e un registro vecchio resta valido', () => {
			const pid = projectId('p1');
			const lane = {
				...laneRecordFromAgentLane({
					...createMainLane(pid, null, 'gui'),
					laneId: laneId('wt1'),
					title: 'Login',
					workspacePath: workspacePath('/repo/.omp-wt-app-wt1')
				}),
				agentSummary: 'Login rifatto, test verdi',
				agentSummaryAt: 1234
			};
			const doc = serializeLaneStoreDocument([lane], [], 3);
			const parsed = parseLaneStoreDocument(doc);
			assert.equal(parsed?.lanes[0].agentSummary, 'Login rifatto, test verdi');
			assert.equal(parsed?.lanes[0].agentSummaryAt, 1234);

			const legacy = JSON.parse(JSON.stringify(doc));
			delete legacy.lanes[0].agentSummary;
			delete legacy.lanes[0].agentSummaryAt;
			const reread = parseLaneStoreDocument(legacy);
			assert.equal(reread?.lanes.length, 1);
			assert.equal(reread?.lanes[0].agentSummary, null);
		});
	});

	describe('6. Laboratorio e consegna', () => {
		it('l\'hook fail-closed ammette corsia_fatto e blocca gli altri verbi', async () => {
			const hook = createLabToolCallHook({ workspaceDir: '/tmp/lab-ws', projectDir: null });
			assert.equal(await hook({ toolName: 'corsia_fatto', input: { riassunto: 'ok' } }), undefined);
			for (const verbo of CORSIA_VERBI.filter((v) => v !== 'fatto')) {
				const result = await hook({ toolName: `corsia_${verbo}`, input: {} });
				assert.equal(result?.block, true, `corsia_${verbo} deve restare bloccato`);
			}
		});

		it('il pacchetto di consegna dichiara limiti e sorgenti senza i file interni', () => {
			const text = buildLabHandoffPackage({
				prototypeId: 'p-20260101-abc123',
				title: 'Dashboard',
				summary: 'Cruscotto ordini con filtri',
				workspacePath: 'C:/lab/p-20260101-abc123',
				revision: { sha: 'abcdef1234', message: 'Filtri per stato', date: '2026-10-01' },
				files: ['src/App.tsx', '.lab/meta.json', 'package.json'],
				previewUrl: 'http://127.0.0.1:5000/p',
				previewErrors: 1
			});
			assert.match(text, /abcdef1 "Filtri per stato"/);
			assert.match(text, /- src\/App\.tsx/);
			assert.doesNotMatch(text, /\.lab\/meta\.json/);
			assert.match(text, /Limiti delle simulazioni/);
			assert.match(text, /1 errori aperti/);
			assert.match(text, /stack nativo/);
		});
	});

	describe('7. Card in chat', () => {
		it('le chiamate corsia_* hanno etichette proprie', () => {
			useLocale('it');
			const summary = categorizeTool({ toolName: 'corsia_proponi', args: { motivo: 'rm -rf dist' } });
			assert.equal(summary.label, 'Operazione pericolosa, facciamo worktree?');
			assert.equal(summary.detail, 'rm -rf dist');
			const avvia = categorizeTool({ toolName: 'corsia_avvia', args: { obiettivo: 'Rifai il login' } });
			assert.equal(avvia.label, 'Corsia avviata');
		});
	});
});
