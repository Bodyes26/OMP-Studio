/**
 * Step 11 — Contesto stabile dal progetto: acquisizione, impronte, esclusione segreti,
 * coerenza durante scritture concorrenti, lettura stabile e rilevamento deriva con aggiornamento
 * su richiesta esplicita.
 *
 * Verifica in modo deterministico e rigoroso:
 * 1. Selezione mirata dei file utili e lettura dal working tree effettivo (incluse modifiche non committate);
 * 2. Esclusione rigorosa di credenziali, chiavi private, file segreti (.env), .git, .omp e altri prototipi;
 * 3. Versione stabile: i tool di contesto del Laboratorio leggono la versione congelata anche
 *    se i file nel progetto vengono modificati o rimossi su disco;
 * 4. Verifica della coerenza a più passaggi: se il principale sta modificando concorrentemente i file
 *    e non si ottiene un insieme coerente, segnala coherent: false senza fingere una fotografia atomica;
 * 5. Rilevamento della deriva (drift): segnala i file modificati o rimossi nel working tree senza rigenerare il prototipo;
 * 6. Aggiornamento su richiesta esplicita: crea una nuova fotografia distinta con diff dettagliato
 *    e storico tracciato, lasciando intatti i sorgenti del prototipo;
 * 7. Prova completa in Studio: simula il ciclo reale con modifica file di progetto, segnalazione e aggiornamento.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	acquireContextSnapshot,
	computeFingerprint,
	containsForbiddenSecret,
	detectContextDrift,
	isForbiddenContextPath,
	labContextArchive,
	readContextHistory,
	readContextSnapshot,
	readContextSnapshotFile,
	selectContextFiles,
	updateContextSnapshot,
	LabContextError,
	type LabContextArchive
} from '../src/lib/lab/context.ts';
import {
	changedContextPaths,
	parseLabContextSnapshot,
	type LabContextSnapshot
} from '../src/lib/lab/contracts.ts';
import {
	createLabPrototype,
	labProjectStore,
	readLabPrototypeFile,
	type LabStorageHost,
	type LabStore
} from '../src/lib/lab/storage.ts';
import {
	executeLabReadFile,
	executeLabContextStatus
} from '../extensions/studio-lab.ts';
import { nodeHost } from './lab-host.ts';

const SCOPE = 'project-alpha-1234';
const PROTO_ID = 'tabella-ordini';

describe('Laboratorio prototipi — Step 11: Contesto stabile dal progetto', () => {
	let baseDir: string;
	let projectDir: string;
	let studioDataDir: string;
	let projectHost: LabStorageHost;
	let dataHost: LabStorageHost;
	let contextArchive: LabContextArchive;
	let store: LabStore;

	before(async () => {
		baseDir = mkdtempSync(join(tmpdir(), 'omp-lab-step11-'));
		projectDir = join(baseDir, 'progetto-target');
		studioDataDir = join(baseDir, 'studio-data');

		mkdirSync(projectDir, { recursive: true });
		mkdirSync(studioDataDir, { recursive: true });

		projectHost = nodeHost(projectDir);
		dataHost = nodeHost(studioDataDir);
		contextArchive = labContextArchive(dataHost, SCOPE);
		store = labProjectStore(projectDir, projectHost);

		// Crea struttura del progetto target con file legittimi e file segreti/interni
		mkdirSync(join(projectDir, 'src', 'components'), { recursive: true });
		mkdirSync(join(projectDir, 'src', 'types'), { recursive: true });
		mkdirSync(join(projectDir, 'node_modules', 'dummy'), { recursive: true });
		mkdirSync(join(projectDir, '.git'), { recursive: true });
		mkdirSync(join(projectDir, '.omp'), { recursive: true });
		mkdirSync(join(projectDir, 'secrets'), { recursive: true });

		// File utili sorgente (working tree con modifiche non committate dell'utente)
		writeFileSync(
			join(projectDir, 'src', 'components', 'OrderTable.tsx'),
			'export function OrderTable() { return <table><tr><td>Ordine #101 (uncommitted)</td></tr></table>; }\n',
			'utf8'
		);
		writeFileSync(
			join(projectDir, 'src', 'types', 'order.ts'),
			'export interface Order { id: number; customer: string; amount: number; }\n',
			'utf8'
		);
		writeFileSync(
			join(projectDir, 'src', 'components', 'Badge.tsx'),
			'export function Badge({ label }: { label: string }) { return <span>{label}</span>; }\n',
			'utf8'
		);

		// File che devono essere categoricamente ESCLUSI
		writeFileSync(join(projectDir, '.env'), 'API_SECRET=super-secret-production-token-12345\n', 'utf8');
		writeFileSync(join(projectDir, '.git', 'config'), '[core]\nrepositoryformatversion = 0\n', 'utf8');
		writeFileSync(join(projectDir, 'secrets', 'id_rsa.key'), '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgk...\n-----END PRIVATE KEY-----\n', 'utf8');
		writeFileSync(join(projectDir, 'credentials.json'), '{"password": "secret-password"}\n', 'utf8');
		writeFileSync(join(projectDir, 'node_modules', 'dummy', 'index.js'), 'module.exports = {};\n', 'utf8');

		// Crea il prototipo assegnato
		await createLabPrototype(store, {
			id: PROTO_ID,
			title: 'Tabella Ordini',
			brief: 'Prototipo con tre varianti di densita per tabella ordini.',
			templateVersion: '1.0.0',
			dependencies: [{ name: 'react', version: '19.2.8' }]
		});
	});

	after(() => {
		try {
			rmSync(baseDir, { recursive: true, force: true });
		} catch {}
	});

	// --------------------------------------------------------------------------
	// 1. Selezione mirata e lettura dal working tree effettivo
	// --------------------------------------------------------------------------
	describe('1. Selezione mirata e lettura dal working tree effettivo', () => {
		it('seleziona in modo mirato solo i file utili ignorando cartelle di rumore', async () => {
			const selected = await selectContextFiles(projectHost, {
				targets: ['src/components/OrderTable.tsx', 'src/types/order.ts']
			});

			assert.equal(selected.paths.length, 2);
			assert.deepEqual(selected.paths, ['src/components/OrderTable.tsx', 'src/types/order.ts']);
			assert.equal(selected.excluded.length, 0);
		});

		it('acquisisce il working tree leggendo le modifiche non committate dell utente', async () => {
			const result = await acquireContextSnapshot(contextArchive, projectHost, PROTO_ID, {
				targets: ['src/components/OrderTable.tsx', 'src/types/order.ts']
			});

			assert.equal(result.ok, true);
			assert.equal(result.coherent, true);
			assert.equal(result.snapshot.files.length, 2);

			const tableEntry = result.snapshot.files.find((f) => f.path === 'src/components/OrderTable.tsx');
			assert.ok(tableEntry, 'OrderTable.tsx deve essere presente nello snapshot');
			assert.equal(tableEntry.origin, 'working-tree');
			assert.match(tableEntry.fingerprint, /^sha256:[0-9a-f]{64}$/);

			// Verifica che il contenuto catturato corrisponda esattamente alla modifica non committata
			const capturedContent = await readContextSnapshotFile(contextArchive, PROTO_ID, 'src/components/OrderTable.tsx');
			assert.ok(capturedContent);
			assert.match(capturedContent, /Ordine #101 \(uncommitted\)/);
		});

		it('salva lo snapshot in snapshot.json conforme ai contratti tipizzati', async () => {
			const snapshot = await readContextSnapshot(contextArchive, PROTO_ID);
			assert.ok(snapshot);
			assert.equal(snapshot.prototypeId, PROTO_ID);
			assert.equal(snapshot.coherent, true);
			assert.equal(snapshot.files.length, 2);

			// Valida con la funzione contrattuale ufficiale di Step 1
			const parsed = parseLabContextSnapshot(snapshot);
			assert.ok(parsed, 'Lo snapshot serializzato deve essere valido secondo parseLabContextSnapshot');
		});
	});

	// --------------------------------------------------------------------------
	// 2. Esclusione rigorosa di credenziali e file di segreti
	// --------------------------------------------------------------------------
	describe('2. Esclusione rigorosa di credenziali e file di segreti', () => {
		it('rifiuta categoricamente percorsi riservati: .env, .git, chiavi private e credenziali', () => {
			assert.equal(isForbiddenContextPath('.env').forbidden, true);
			assert.equal(isForbiddenContextPath('.env.production').forbidden, true);
			assert.equal(isForbiddenContextPath('.git/config').forbidden, true);
			assert.equal(isForbiddenContextPath('.omp/tasks.json').forbidden, true);
			assert.equal(isForbiddenContextPath('secrets/id_rsa.key').forbidden, true);
			assert.equal(isForbiddenContextPath('cert.pem').forbidden, true);
			assert.equal(isForbiddenContextPath('credentials.json').forbidden, true);
			assert.equal(isForbiddenContextPath('auth_credentials.ini').forbidden, true);
			assert.equal(isForbiddenContextPath('database.sqlite').forbidden, true);
			assert.equal(isForbiddenContextPath('proto/other/App.tsx').forbidden, true);
			assert.equal(isForbiddenContextPath('../outside.txt').forbidden, true);

			// Percorsi leciti
			assert.equal(isForbiddenContextPath('src/App.tsx').forbidden, false);
			assert.equal(isForbiddenContextPath('src/types/index.ts').forbidden, false);
		});

		it('identifica e blocca contenuti con credenziali o chiavi private', () => {
			const keyContent = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
			assert.equal(containsForbiddenSecret(keyContent).forbidden, true);

			const bearerContent = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz1234567890abcdefgh';
			assert.equal(containsForbiddenSecret(bearerContent).forbidden, true);

			const cleanContent = 'export function clean() { return 42; }';
			assert.equal(containsForbiddenSecret(cleanContent).forbidden, false);
		});

		it('esclude automaticamente file segreti se tentata l acquisizione esplicita', async () => {
			const result = await acquireContextSnapshot(contextArchive, projectHost, PROTO_ID, {
				targets: [
					'src/components/Badge.tsx',
					'.env',
					'.git/config',
					'secrets/id_rsa.key',
					'credentials.json'
				]
			});

			assert.equal(result.ok, true);
			// Solo Badge.tsx e' stato acquisito
			assert.equal(result.snapshot.files.length, 1);
			assert.equal(result.snapshot.files[0]!.path, 'src/components/Badge.tsx');

			// Tutti i file riservati compaiono in result.excluded con motivazione
			assert.ok(result.excluded.some((e) => e.path === '.env'));
			assert.ok(result.excluded.some((e) => e.path === '.git/config'));
			assert.ok(result.excluded.some((e) => e.path === 'secrets/id_rsa.key'));
			assert.ok(result.excluded.some((e) => e.path === 'credentials.json'));
		});
	});

	// --------------------------------------------------------------------------
	// 3. Versione stabile: i tool leggono la versione congelata anche dopo modifiche su disco
	// --------------------------------------------------------------------------
	describe('3. Versione stabile del contesto (lettura congelata nei blob)', () => {
		before(async () => {
			// Acquisiamo una baseline pulita con OrderTable e Badge
			await acquireContextSnapshot(contextArchive, projectHost, PROTO_ID, {
				targets: ['src/components/OrderTable.tsx', 'src/components/Badge.tsx']
			});
		});

		it('i tool leggono la versione congelata anche se il file su disco viene modificato dal principale', async () => {
			// 1. Contenuto catturato nello snapshot
			const frozenContent = await readContextSnapshotFile(contextArchive, PROTO_ID, 'src/components/OrderTable.tsx');
			assert.ok(frozenContent);
			assert.match(frozenContent, /Ordine #101 \(uncommitted\)/);

			// 2. Modifichiamo il file su disco nel progetto (simula principale o utente che scrive)
			writeFileSync(
				join(projectDir, 'src', 'components', 'OrderTable.tsx'),
				'export function OrderTable() { return <h1>MODIFICATO DAL PRINCIPALE IN CORSA</h1>; }\n',
				'utf8'
			);

			// 3. Il tool `executeLabReadFile` con scope "project" continua a restituire la versione congelata!
			const readRes = executeLabReadFile({
				cwd: projectDir,
				prototypeId: PROTO_ID,
				relativePath: 'src/components/OrderTable.tsx',
				scope: 'project',
				customContextDir: studioDataDir
			});

			assert.equal(readRes.ok, true);
			assert.equal(readRes.fromSnapshot, true);
			assert.match(readRes.content ?? '', /Ordine #101 \(uncommitted\)/);
			assert.doesNotMatch(readRes.content ?? '', /MODIFICATO DAL PRINCIPALE/);
		});

		it('il tool legge la versione congelata anche se il file su disco viene eliminato dal progetto', async () => {
			// 1. Eliminiamo Badge.tsx dal disco nel progetto
			rmSync(join(projectDir, 'src', 'components', 'Badge.tsx'), { force: true });
			assert.equal(existsSync(join(projectDir, 'src', 'components', 'Badge.tsx')), false);

			// 2. Il tool di contesto continua a restituire la versione stabile dal blob!
			const readRes = executeLabReadFile({
				cwd: projectDir,
				prototypeId: PROTO_ID,
				relativePath: 'src/components/Badge.tsx',
				scope: 'project',
				customContextDir: studioDataDir
			});

			assert.equal(readRes.ok, true);
			assert.equal(readRes.fromSnapshot, true);
			assert.match(readRes.content ?? '', /export function Badge/);
		});
	});

	// --------------------------------------------------------------------------
	// 4. Verifica della coerenza durante scritture concorrenti
	// --------------------------------------------------------------------------
	describe('4. Verifica della coerenza durante scritture concorrenti', () => {
		it('segnala coherent: false se il file continua a cambiare durante l acquisizione', async () => {
			// Creiamo un host simulato dove il file cambia ad ogni lettura (scrittura concorrente attiva)
			let readCounter = 0;
			const unstableHost = {
				...projectHost,
				async readTextFile(path: string) {
					if (path === 'src/components/OrderTable.tsx') {
						readCounter++;
						return `export function OrderTable() { return <div>Versione ${readCounter} in corsa</div>; }`;
					}
					return projectHost.readTextFile(path);
				}
			};

			const result = await acquireContextSnapshot(contextArchive, unstableHost, PROTO_ID, {
				targets: ['src/components/OrderTable.tsx'],
				maxRetries: 2,
				retryDelayMs: 1
			});

			assert.equal(result.ok, true);
			assert.equal(result.coherent, false, 'Deve dichiarare coherent: false se non e stato possibile stabilizzare');
			assert.ok(result.incoherentPaths.includes('src/components/OrderTable.tsx'));
			assert.equal(result.retriesPerformed, 2);

			// Anche lo snapshot salvato registra la non coerenza
			const saved = await readContextSnapshot(contextArchive, PROTO_ID);
			assert.ok(saved);
			assert.equal(saved.coherent, false);
		});
	});

	// --------------------------------------------------------------------------
	// 5. Rilevamento della deriva (drift) nel progetto
	// --------------------------------------------------------------------------
	describe('5. Rilevamento della deriva (drift) e mancata rigenerazione automatica', () => {
		before(async () => {
			// Ripristiniamo OrderTable e Badge su disco con contenuti noti e catturiamo baseline coerente
			writeFileSync(
				join(projectDir, 'src', 'components', 'OrderTable.tsx'),
				'export function OrderTable() { return <div>Versione Stabile Baseline</div>; }\n',
				'utf8'
			);
			writeFileSync(
				join(projectDir, 'src', 'components', 'Badge.tsx'),
				'export function Badge() { return <span>Baseline</span>; }\n',
				'utf8'
			);

			await acquireContextSnapshot(contextArchive, projectHost, PROTO_ID, {
				targets: ['src/components/OrderTable.tsx', 'src/components/Badge.tsx']
			});
		});

		it('rileva con precisione file modificati e rimossi nel progetto senza alterare lo snapshot', async () => {
			const snapshotBefore = await readContextSnapshot(contextArchive, PROTO_ID);
			assert.ok(snapshotBefore);

			// 1. Modifichiamo OrderTable.tsx
			writeFileSync(
				join(projectDir, 'src', 'components', 'OrderTable.tsx'),
				'export function OrderTable() { return <div>NUOVA IMPLEMENTAZIONE PROGETTO</div>; }\n',
				'utf8'
			);

			// 2. Rimuoviamo Badge.tsx
			rmSync(join(projectDir, 'src', 'components', 'Badge.tsx'), { force: true });

			// 3. Eseguiamo il rilevamento deriva
			const drift = await detectContextDrift(projectHost, snapshotBefore);
			assert.equal(drift.hasChanges, true);
			assert.deepEqual(drift.modifiedPaths, ['src/components/OrderTable.tsx']);
			assert.deepEqual(drift.deletedPaths, ['src/components/Badge.tsx']);
			assert.equal(drift.changedPaths.length, 2);

			// 4. Verifichiamo che lo snapshot attivo non sia stato modificato tacitamente!
			const snapshotAfter = await readContextSnapshot(contextArchive, PROTO_ID);
			assert.ok(snapshotAfter);
			assert.equal(snapshotAfter.id, snapshotBefore.id, 'Lo snapshot non deve cambiare per la sola verifica di deriva');

			// 5. Verifichiamo con changedContextPaths di contracts.ts
			const currentFps = new Map<string, string>();
			const currentContent = await projectHost.readTextFile('src/components/OrderTable.tsx');
			assert.ok(currentContent);
			currentFps.set('src/components/OrderTable.tsx', await computeFingerprint(currentContent));
			const contractChanged = changedContextPaths(snapshotBefore, currentFps);
			assert.deepEqual(contractChanged, ['src/components/OrderTable.tsx']);
		});

		it('la query di stato .lab/context/status restituisce il report di deriva coerente', () => {
			const statusRes = executeLabReadFile({
				cwd: projectDir,
				prototypeId: PROTO_ID,
				relativePath: '.lab/context/status',
				scope: 'project',
				customContextDir: studioDataDir
			});

			assert.equal(statusRes.ok, true);
			assert.ok(statusRes.content);
			const parsed = JSON.parse(statusRes.content);
			assert.equal(parsed.hasChanges, true);
			assert.ok(parsed.modifiedPaths.includes('src/components/OrderTable.tsx'));
			assert.ok(parsed.deletedPaths.includes('src/components/Badge.tsx'));
		});
	});

	// --------------------------------------------------------------------------
	// 6. Aggiornamento su richiesta esplicita senza toccare il prototipo
	// --------------------------------------------------------------------------
	describe('6. Aggiornamento solo su richiesta esplicita', () => {
		it('aggiorna solo su chiamata esplicita, preservando storico e senza toccare i file del prototipo', async () => {
			// Scriviamo un file nel prototipo assegnato per verificare che non venga alterato
			const protoFilePath = 'src/App.tsx';
			const protoFileContent = 'export default function App() { return <h1>Mio Prototipo Intatto</h1>; }\n';
			await store.host.createFile(`proto/${PROTO_ID}/${protoFilePath}`, protoFileContent);

			const beforeApp = await readLabPrototypeFile(store, PROTO_ID, protoFilePath);
			assert.equal(beforeApp, protoFileContent);

			// Aggiornamento esplicito del contesto per OrderTable (ora che e modificato su disco)
			const updateRes = await updateContextSnapshot(contextArchive, projectHost, PROTO_ID, {
				paths: ['src/components/OrderTable.tsx']
			});

			assert.equal(updateRes.ok, true);
			assert.notEqual(updateRes.newSnapshot.id, updateRes.previousSnapshot.id);
			assert.deepEqual(updateRes.diff.modified, ['src/components/OrderTable.tsx']);

			// I sorgenti del prototipo rimangono intatti e non rigenerati
			const afterApp = await readLabPrototypeFile(store, PROTO_ID, protoFilePath);
			assert.equal(afterApp, protoFileContent, 'Il codice del prototipo non deve essere toccato ne rigenerato');

			// La cronologia traccia entrambi gli snapshot collegati
			const history = await readContextHistory(contextArchive, PROTO_ID);
			assert.ok(history.length >= 2);
			const latest = history[history.length - 1]!;
			assert.equal(latest.snapshotId, updateRes.newSnapshot.id);
			assert.equal(latest.previousSnapshotId, updateRes.previousSnapshot.id);

			// Ora il tool di lettura restituisce la nuova versione stabile
			const readRes = executeLabReadFile({
				cwd: projectDir,
				prototypeId: PROTO_ID,
				relativePath: 'src/components/OrderTable.tsx',
				scope: 'project',
				customContextDir: studioDataDir
			});
			assert.equal(readRes.ok, true);
			assert.match(readRes.content ?? '', /NUOVA IMPLEMENTAZIONE PROGETTO/);
		});
	});

	// --------------------------------------------------------------------------
	// 7. Prova Studio completa: modifica file, segnalazione e aggiornamento su richiesta
	// --------------------------------------------------------------------------
	describe('7. Prova Studio: ciclo end-to-end con modifica, segnalazione e aggiornamento su richiesta', () => {
		const TRIAL_PROTO_ID = 'prova-studio-contesto';

		before(async () => {
			await createLabPrototype(store, {
				id: TRIAL_PROTO_ID,
				title: 'Prova Studio Contesto',
				brief: 'Test di accettazione per modifica file progetto e aggiornamento contestuale.',
				templateVersion: '1.0.0',
				dependencies: [{ name: 'react', version: '19.2.8' }]
			});

			writeFileSync(
				join(projectDir, 'src', 'components', 'Card.tsx'),
				'export function Card() { return <div className="card">Card v1 iniziale</div>; }\n',
				'utf8'
			);
		});

		it('esegue la prova di accettazione richiesta: acquisizione iniziale -> modifica nel progetto -> segnalazione deriva -> aggiornamento su richiesta', async () => {
			// 1. Acquisizione iniziale del contesto
			const acq = await acquireContextSnapshot(contextArchive, projectHost, TRIAL_PROTO_ID, {
				targets: ['src/components/Card.tsx']
			});
			assert.equal(acq.ok, true);
			assert.equal(acq.snapshot.files.length, 1);
			const initialFp = acq.snapshot.files[0]!.fingerprint;

			// 2. Lettura stabile iniziale dal tool
			const readV1 = executeLabReadFile({
				cwd: projectDir,
				prototypeId: TRIAL_PROTO_ID,
				relativePath: 'src/components/Card.tsx',
				scope: 'project',
				customContextDir: studioDataDir
			});
			assert.match(readV1.content ?? '', /Card v1 iniziale/);

			// 3. Modifichiamo il file acquisito nel progetto (simulando lavoro concorrente dell'utente/principale)
			writeFileSync(
				join(projectDir, 'src', 'components', 'Card.tsx'),
				'export function Card() { return <div className="card-v2">Card v2 con nuove modifiche</div>; }\n',
				'utf8'
			);

			// 4. Verifichiamo che il tool continui a leggere la versione v1 stabile congelata
			const readStillV1 = executeLabReadFile({
				cwd: projectDir,
				prototypeId: TRIAL_PROTO_ID,
				relativePath: 'src/components/Card.tsx',
				scope: 'project',
				customContextDir: studioDataDir
			});
			assert.match(readStillV1.content ?? '', /Card v1 iniziale/);
			assert.doesNotMatch(readStillV1.content ?? '', /Card v2/);

			// 5. Il Laboratorio SEGNALA che il file e' cambiato nel progetto
			const statusReport = executeLabContextStatus({
				cwd: projectDir,
				prototypeId: TRIAL_PROTO_ID,
				customContextDir: studioDataDir
			});
			assert.equal(statusReport.hasChanges, true);
			assert.deepEqual(statusReport.changedPaths, ['src/components/Card.tsx']);
			assert.deepEqual(statusReport.modifiedPaths, ['src/components/Card.tsx']);
			assert.notEqual(statusReport.details?.[0]?.currentFingerprint, initialFp);

			// 6. Aggiornamento ESPLICITO su richiesta dell'utente
			const updateResult = await updateContextSnapshot(contextArchive, projectHost, TRIAL_PROTO_ID, {
				paths: ['src/components/Card.tsx']
			});
			assert.equal(updateResult.ok, true);
			assert.deepEqual(updateResult.diff.modified, ['src/components/Card.tsx']);

			// 7. Dopo l'aggiornamento, la segnalazione rientra (invariato) e il tool legge la nuova versione stabile
			const statusAfterUpdate = executeLabContextStatus({
				cwd: projectDir,
				prototypeId: TRIAL_PROTO_ID,
				customContextDir: studioDataDir
			});
			assert.equal(statusAfterUpdate.hasChanges, false);
			assert.deepEqual(statusAfterUpdate.changedPaths, []);

			const readV2 = executeLabReadFile({
				cwd: projectDir,
				prototypeId: TRIAL_PROTO_ID,
				relativePath: 'src/components/Card.tsx',
				scope: 'project',
				customContextDir: studioDataDir
			});
			assert.match(readV2.content ?? '', /Card v2 con nuove modifiche/);
		});
	});
});
