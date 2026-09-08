import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	mkdtempSync,
	rmSync,
	existsSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	symlinkSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
	LAB_TOOL_ALLOWLIST,
	isAllowedLabTool,
	formatToolDeniedReason,
	isConfinedPrototypeRelativePath,
	resolveCanonicalPrototypeDirectory,
	validateLabPrototypePath,
	validateLabReadPath,
	executeLabWriteFile,
	executeLabReadFile,
	executeLabListFiles,
	executeLabDeleteFile,
	createLabToolCallHook
} from '../extensions/studio-lab.ts';

describe('Laboratorio prototipi — Step 4: Broker di scrittura confinata e allowlist tool', () => {
	let tempProjectDir: string;
	let tempOutsideDir: string;

	before(() => {
		tempProjectDir = mkdtempSync(join(tmpdir(), 'omp-lab-project-'));
		tempOutsideDir = mkdtempSync(join(tmpdir(), 'omp-lab-outside-'));

		// Struttura base del progetto di test
		mkdirSync(join(tempProjectDir, 'src', 'components'), { recursive: true });
		mkdirSync(join(tempProjectDir, '.git'), { recursive: true });
		mkdirSync(join(tempProjectDir, '.omp'), { recursive: true });
		mkdirSync(join(tempProjectDir, 'proto'), { recursive: true });

		writeFileSync(join(tempProjectDir, 'package.json'), '{"name":"test-project"}', 'utf8');
		writeFileSync(join(tempProjectDir, '.env'), 'SECRET_KEY=supersecret', 'utf8');
		writeFileSync(join(tempProjectDir, '.git', 'config'), '[core]\nrepositoryformatversion = 0', 'utf8');
		writeFileSync(join(tempProjectDir, 'src', 'components', 'ExistingTable.tsx'), 'export function ExistingTable() {}', 'utf8');

		writeFileSync(join(tempOutsideDir, 'host-secrets.txt'), 'TOP_SECRET_HOST_DATA', 'utf8');
	});

	after(() => {
		try {
			rmSync(tempProjectDir, { recursive: true, force: true });
		} catch {}
		try {
			rmSync(tempOutsideDir, { recursive: true, force: true });
		} catch {}
	});

	/* ------------------------------------------------------------- 1. Allowlist */

	describe('1. Allowlist tool e rifiuto per difetto (deny-by-default)', () => {
		it('riconosce esattamente gli 8 tool autorizzati nel Laboratorio', () => {
			assert.equal(LAB_TOOL_ALLOWLIST.length, 8);
			assert.deepEqual(Array.from(LAB_TOOL_ALLOWLIST), [
				'lab_write_file',
				'lab_read_file',
				'lab_list_files',
				'lab_delete_file',
				'task',
				'hub',
				'todo',
				'ask'
			]);

			for (const tool of LAB_TOOL_ALLOWLIST) {
				assert.equal(isAllowedLabTool(tool), true, `Il tool '${tool}' deve essere consentito`);
			}
		});

		it('rifiuta per difetto tutti i tool pericolosi o generici', () => {
			const dangerousTools = [
				'bash',
				'exec',
				'eval',
				'write',
				'edit',
				'ast_edit',
				'read',
				'glob',
				'grep',
				'browser',
				'debug',
				'lsp',
				'mcp__github_issue',
				'unknown_tool_xyz'
			];

			for (const tool of dangerousTools) {
				assert.equal(isAllowedLabTool(tool), false, `Il tool '${tool}' DEVE essere bloccato`);
				const reason = formatToolDeniedReason(tool);
				assert.ok(reason.length > 20, `Messaggio di rifiuto esplicito per '${tool}'`);
			}
		});

		it('hook tool_call blocca i tool non in allowlist con motivazione chiara', async () => {
			const hook = createLabToolCallHook({
				getAssignedPrototypeId: () => 'my-card-proto',
				getCwd: () => tempProjectDir
			});

			const blockedBash = await hook({ toolName: 'bash', input: { command: 'rm -rf /' } });
			assert.deepEqual(blockedBash, {
				block: true,
				reason: "Tool 'bash' non consentito nel Laboratorio: l'esecuzione di comandi shell e' vietata per isolamento del runtime."
			});

			const blockedWrite = await hook({ toolName: 'write', input: { path: 'src/App.tsx' } });
			assert.equal(blockedWrite?.block, true);
			assert.ok(blockedWrite?.reason?.includes("Tool 'write' non consentito"));

			const blockedEval = await hook({ toolName: 'eval', input: { code: 'process.exit(1)' } });
			assert.equal(blockedEval?.block, true);

			const blockedMcp = await hook({ toolName: 'mcp__filesystem_write', input: {} });
			assert.equal(blockedMcp?.block, true);
		});

		it('hook tool_call lascia passare task, hub, todo e ask senza bloccare subagenti', async () => {
			const hook = createLabToolCallHook({
				getAssignedPrototypeId: () => 'my-card-proto',
				getCwd: () => tempProjectDir
			});

			assert.equal(await hook({ toolName: 'task', input: { tasks: [] } }), undefined);
			assert.equal(await hook({ toolName: 'hub', input: { op: 'jobs' } }), undefined);
			assert.equal(await hook({ toolName: 'todo', input: { op: 'view' } }), undefined);
			assert.equal(await hook({ toolName: 'ask', input: { questions: [] } }), undefined);
		});
	});

	/* ----------------------------------------------- 2. Validazione sintattica */

	describe('2. Validazione sintattica percorsi relativi', () => {
		it('accetta percorsi validi dentro il prototipo', () => {
			const validPaths = [
				'src/App.tsx',
				'src/components/Card.tsx',
				'assets/icon.svg',
				'styles/main.css',
				'package.json',
				'README.md'
			];

			for (const p of validPaths) {
				const res = isConfinedPrototypeRelativePath(p);
				assert.equal(res.ok, true, `Percorso valido '${p}' rifiutato erroneamente`);
				if (res.ok) {
					assert.equal(res.normalized, p);
				}
			}
		});

		it('normalizza backslash Windows in forward slash', () => {
			const res = isConfinedPrototypeRelativePath('src\\components\\Button.tsx');
			assert.equal(res.ok, true);
			if (res.ok) {
				assert.equal(res.normalized, 'src/components/Button.tsx');
			}
		});

		it('rifiuta directory traversal sintattico', () => {
			const traversalPaths = [
				'../outside.txt',
				'../../outside.txt',
				'src/../../outside.txt',
				'src/../outside.txt',
				'src/./../../outside.txt',
				'..',
				'.'
			];

			for (const p of traversalPaths) {
				const res = isConfinedPrototypeRelativePath(p);
				assert.equal(res.ok, false, `Traversal '${p}' non e stato rifiutato`);
				if (!res.ok) {
					assert.ok(res.error.includes('traversal') || res.error.includes('Directory'));
				}
			}
		});

		it('rifiuta percorsi assoluti POSIX, Windows e UNC', () => {
			const absolutePaths = [
				'/etc/passwd',
				'/root/secret.txt',
				'\\Windows\\win.ini',
				'C:\\Windows\\system32',
				'D:/data/file.txt',
				'\\\\server\\share\\evil.txt'
			];

			for (const p of absolutePaths) {
				const res = isConfinedPrototypeRelativePath(p);
				assert.equal(res.ok, false, `Percorso assoluto '${p}' non e stato rifiutato`);
				if (!res.ok) {
					assert.ok(res.error.includes('assoluto') || res.error.includes('unita Windows') || res.error.includes('UNC'));
				}
			}
		});

		it('rifiuta caratteri NUL e stringhe vuote', () => {
			assert.equal(isConfinedPrototypeRelativePath('').ok, false);
			assert.equal(isConfinedPrototypeRelativePath('   ').ok, false);
			assert.equal(isConfinedPrototypeRelativePath('src/App.tsx\u0000.evil').ok, false);
		});

		it('rifiuta file nascosti, .git, .env e .omp', () => {
			const forbidden = [
				'.git',
				'.git/config',
				'.env',
				'.env.local',
				'.omp/tasks.json',
				'src/.hidden.tsx'
			];

			for (const p of forbidden) {
				const res = isConfinedPrototypeRelativePath(p);
				assert.equal(res.ok, false, `File nascosto '${p}' non e stato rifiutato`);
			}
		});

		it('rifiuta nomi riservati Windows', () => {
			const reserved = ['con.tsx', 'prn.json', 'aux.txt', 'nul', 'com1.js', 'lpt2.css'];
			for (const p of reserved) {
				const res = isConfinedPrototypeRelativePath(p);
				assert.equal(res.ok, false, `Nome riservato '${p}' non e stato rifiutato`);
			}
		});
	});

	/* ------------------------------------- 3. Risoluzione directory prototipo */

	describe('3. Risoluzione canonica cartella prototipo e root di progetto', () => {
		it('rifiuta prototypeId non validi', () => {
			const invalidIds = ['CON', 'PRN', '-invalid', 'Invalid_Caps', 'has spaces', '', 'a'];
			for (const id of invalidIds) {
				const res = resolveCanonicalPrototypeDirectory({
					cwd: tempProjectDir,
					prototypeId: id
				});
				assert.equal(res.ok, false, `Id non valido '${id}' non rifiutato`);
			}
		});

		it('risolve correttamente proto/<id> dentro la root del progetto', () => {
			const res = resolveCanonicalPrototypeDirectory({
				cwd: tempProjectDir,
				prototypeId: 'variant-alpha'
			});
			assert.equal(res.ok, true);
			assert.ok(res.canonicalPrototypeDir?.includes('variant-alpha'));
			assert.ok(res.canonicalPrototypeDir?.includes('proto'));
			assert.notEqual(res.canonicalPrototypeDir, res.canonicalProjectRoot);
		});

		it('rifiuta se proto/ e un symlink/junction che punta all esterno', () => {
			const rogueProject = mkdtempSync(join(tmpdir(), 'omp-rogue-proto-'));
			const rogueOutside = mkdtempSync(join(tmpdir(), 'omp-rogue-outside-'));

			try {
				// Crea un symlink/junction da proto -> rogueOutside
				const protoLink = join(rogueProject, 'proto');
				symlinkSync(rogueOutside, protoLink, 'junction');

				const res = resolveCanonicalPrototypeDirectory({
					cwd: rogueProject,
					prototypeId: 'test-proto'
				});
				assert.equal(res.ok, false);
				assert.ok(res.error?.includes('symlink') || res.error?.includes('all\'esterno'));
			} finally {
				try {
					rmSync(rogueProject, { recursive: true, force: true });
				} catch {}
				try {
					rmSync(rogueOutside, { recursive: true, force: true });
				} catch {}
			}
		});
	});

	/* --------------------------- 4. Validazione percorsi e casi ostili symlink */

	describe('4. Casi ostili di validazione percorso: traversal, root, symlink/junction', () => {
		it('rifiuta qualsiasi scrittura alla root del progetto', () => {
			const res = validateLabPrototypePath({
				cwd: tempProjectDir,
				prototypeId: 'card-proto',
				relativePath: '../../package.json'
			});
			assert.equal(res.ok, false);
			assert.ok(res.error?.includes('traversal') || res.error?.includes('fuoriesce'));
		});

		it('rifiuta scrittura in un altro prototipo (confini fra prototipi)', () => {
			// Prova a evadere da card-proto a other-proto via traversal relativo
			const res = validateLabPrototypePath({
				cwd: tempProjectDir,
				prototypeId: 'card-proto',
				relativePath: '../other-proto/src/App.tsx'
			});
			assert.equal(res.ok, false);
			assert.ok(res.error?.includes('traversal') || res.error?.includes('fuoriesce'));
		});

		it('CASO OSTILE SYMLINK 1: cartella intermedia e un symlink/junction che punta fuori dal prototipo', () => {
			const protoDir = join(tempProjectDir, 'proto', 'symlink-victim-proto');
			mkdirSync(join(protoDir, 'src'), { recursive: true });

			const symlinkTarget = join(tempOutsideDir, 'leaked-folder');
			mkdirSync(symlinkTarget, { recursive: true });

			const junctionPath = join(protoDir, 'src', 'symlink-dir');
			symlinkSync(symlinkTarget, junctionPath, 'junction');

			// Tentativo di scrivere un file attraverso la cartella symlink/junction
			const res = validateLabPrototypePath({
				cwd: tempProjectDir,
				prototypeId: 'symlink-victim-proto',
				relativePath: 'src/symlink-dir/evil.txt'
			});

			assert.equal(res.ok, false, 'La scrittura attraverso un symlink/junction intermedio DEVE essere bloccata');
			assert.ok(
				res.error?.includes('symlink') ||
				res.error?.includes('junction') ||
				res.error?.includes('fuoriesce'),
				`Messaggio atteso sul symlink: ${res.error}`
			);
		});

		it('CASO OSTILE SYMLINK 2: il file foglia preesistente e un symlink verso l esterno', () => {
			const protoDir = join(tempProjectDir, 'proto', 'leaf-symlink-proto');
			mkdirSync(join(protoDir, 'src'), { recursive: true });

			const outsideSecretFile = join(tempOutsideDir, 'host-secrets.txt');
			const targetInProto = join(protoDir, 'src', 'App.tsx');

			// Creiamo junction o symlink se consentito dalla piattaforma
			let linked = false;
			try {
				symlinkSync(outsideSecretFile, targetInProto, 'file');
				linked = true;
			} catch {
				// Su Windows senza developer mode il file symlink fallisce: proviamo junction su directory
				try {
					symlinkSync(tempOutsideDir, targetInProto, 'junction');
					linked = true;
				} catch {}
			}

			if (linked) {
				const res = validateLabPrototypePath({
					cwd: tempProjectDir,
					prototypeId: 'leaf-symlink-proto',
					relativePath: 'src/App.tsx'
				});

				assert.equal(res.ok, false, 'La sovrascrittura di un symlink foglia DEVE essere bloccata');
				assert.ok(
					res.error?.includes('symlink') ||
					res.error?.includes('junction') ||
					res.error?.includes('fuoriesce')
				);
			}
		});

		it('CASO OSTILE SYMLINK 3: symlink dentro un prototipo che punta a un ALTRO prototipo', () => {
			const protoA = join(tempProjectDir, 'proto', 'proto-alpha');
			const protoB = join(tempProjectDir, 'proto', 'proto-beta');
			mkdirSync(join(protoA, 'src'), { recursive: true });
			mkdirSync(join(protoB, 'src'), { recursive: true });

			const linkInA = join(protoA, 'src', 'link-to-b');
			symlinkSync(protoB, linkInA, 'junction');

			// proto-alpha prova a scrivere dentro proto-beta usando il symlink
			const res = validateLabPrototypePath({
				cwd: tempProjectDir,
				prototypeId: 'proto-alpha',
				relativePath: 'src/link-to-b/Hacked.tsx'
			});

			assert.equal(res.ok, false, 'Scrittura cross-prototipo tramite symlink DEVE essere bloccata');
			assert.ok(res.error?.includes('symlink') || res.error?.includes('fuoriesce'));
		});
	});

	/* ------------------------------------- 5. Scritture ed esecuzioni atomiche */

	describe('5. Esecuzione scritture atomiche (executeLabWriteFile)', () => {
		it('scrive con successo file dentro il prototipo assegnato creando le cartelle mancanti', () => {
			const res = executeLabWriteFile({
				cwd: tempProjectDir,
				prototypeId: 'write-test-proto',
				relativePath: 'src/components/MyButton.tsx',
				content: 'export const MyButton = () => <button>Click</button>;'
			});

			assert.equal(res.ok, true, `Scrittura fallita: ${res.error}`);
			assert.ok(typeof res.bytesWritten === 'number' && res.bytesWritten > 0);

			const writtenFile = join(tempProjectDir, 'proto', 'write-test-proto', 'src', 'components', 'MyButton.tsx');
			assert.equal(existsSync(writtenFile), true);
			assert.equal(readFileSync(writtenFile, 'utf8'), 'export const MyButton = () => <button>Click</button>;');
		});

		it('rifiuta atomicamente e fail-closed scritture con traversal o percorsi assoluti', () => {
			const res = executeLabWriteFile({
				cwd: tempProjectDir,
				prototypeId: 'write-test-proto',
				relativePath: '../../package.json',
				content: '{"hacked":true}'
			});

			assert.equal(res.ok, false);
			// Verifica che package.json alla root del progetto sia intatto
			assert.equal(readFileSync(join(tempProjectDir, 'package.json'), 'utf8'), '{"name":"test-project"}');
		});

		it('elimina file in modo controllato dentro il solo prototipo assegnato', () => {
			const writeRes = executeLabWriteFile({
				cwd: tempProjectDir,
				prototypeId: 'delete-test-proto',
				relativePath: 'src/TempComponent.tsx',
				content: 'export const Temp = () => null;'
			});
			assert.equal(writeRes.ok, true);

			const delRes = executeLabDeleteFile({
				cwd: tempProjectDir,
				prototypeId: 'delete-test-proto',
				relativePath: 'src/TempComponent.tsx'
			});
			assert.equal(delRes.ok, true);
			assert.equal(existsSync(join(tempProjectDir, 'proto', 'delete-test-proto', 'src', 'TempComponent.tsx')), false);
		});
	});

	/* ---------------------------------------- 6. Lettura contesto consentito */

	describe('6. Lettura del contesto consentito (executeLabReadFile)', () => {
		it('legge un file del prototipo', () => {
			executeLabWriteFile({
				cwd: tempProjectDir,
				prototypeId: 'read-test-proto',
				relativePath: 'src/App.tsx',
				content: 'export default function App() { return <div>Hello</div>; }'
			});

			const res = executeLabReadFile({
				cwd: tempProjectDir,
				prototypeId: 'read-test-proto',
				relativePath: 'src/App.tsx',
				scope: 'prototype'
			});

			assert.equal(res.ok, true);
			assert.ok(res.content?.includes('Hello'));
		});

		it('legge un componente del progetto come contesto in sola lettura', () => {
			const res = executeLabReadFile({
				cwd: tempProjectDir,
				relativePath: 'src/components/ExistingTable.tsx',
				scope: 'project'
			});

			assert.equal(res.ok, true);
			assert.ok(res.content?.includes('ExistingTable'));
		});

		it('blocca categoricamente la lettura di .git/config e .env', () => {
			const gitRes = executeLabReadFile({
				cwd: tempProjectDir,
				relativePath: '.git/config',
				scope: 'project'
			});
			assert.equal(gitRes.ok, false);
			assert.ok(gitRes.error?.includes('Accesso negato') || gitRes.error?.includes('segreti'));

			const envRes = executeLabReadFile({
				cwd: tempProjectDir,
				relativePath: '.env',
				scope: 'project'
			});
			assert.equal(envRes.ok, false);
			assert.ok(envRes.error?.includes('Accesso negato') || envRes.error?.includes('segreti'));
		});

		it('blocca la lettura di file di altri prototipi nel progetto', () => {
			executeLabWriteFile({
				cwd: tempProjectDir,
				prototypeId: 'other-proto-x',
				relativePath: 'src/OtherComponent.tsx',
				content: 'export const Other = 42;'
			});

			// Tentativo di leggere other-proto-x spacciandosi per proto-y
			const res = validateLabReadPath({
				cwd: tempProjectDir,
				prototypeId: 'proto-y',
				relativePath: 'proto/other-proto-x/src/OtherComponent.tsx',
				scope: 'project'
			});

			assert.equal(res.ok, false);
			assert.ok(res.error?.includes('altri prototipi'));
		});
	});

	/* --------------------------------- 7. Hook tool_call con isolamento ID */

	describe('7. Hook tool_call con isolamento prototypeId e fail-closed', () => {
		it('blocca chiamate a lab_write_file che richiedono un id diverso da quello assegnato', async () => {
			const hook = createLabToolCallHook({
				getAssignedPrototypeId: () => 'proto-assigned-1',
				getCwd: () => tempProjectDir
			});

			const res = await hook({
				toolName: 'lab_write_file',
				input: {
					prototypeId: 'proto-different-2',
					path: 'src/App.tsx',
					content: 'test'
				}
			});

			assert.equal(res?.block, true);
			assert.ok(res?.reason?.includes('Conflitto di prototipo'));
		});

		it('pre-valida il percorso in tool_call e blocca traversal prima dell esecuzione', async () => {
			const hook = createLabToolCallHook({
				getAssignedPrototypeId: () => 'proto-assigned-1',
				getCwd: () => tempProjectDir
			});

			const res = await hook({
				toolName: 'lab_write_file',
				input: {
					path: '../../etc/passwd',
					content: 'evil'
				}
			});

			assert.equal(res?.block, true);
			assert.ok(res?.reason?.includes('traversal') || res?.reason?.includes('non valido'));
		});

		it('si comporta in modo fail-closed se l environment lancia un errore imprevisto', async () => {
			const faultyHook = createLabToolCallHook({
				getAssignedPrototypeId: () => {
					throw new Error('Crash simulato del getter');
				},
				getCwd: () => tempProjectDir
			});

			const res = await faultyHook({
				toolName: 'lab_write_file',
				input: { path: 'src/App.tsx' }
			});

			assert.equal(res?.block, true);
			assert.ok(res?.reason?.includes('Fail-closed'));
		});
	});
});
