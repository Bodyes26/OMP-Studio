/**
 * Step 15 — Migrazione del preesistente e compatibilità legacy
 *
 * Verifica in modo deterministico e rigoroso:
 * 1. I vecchi prototipi `proto/<slug>.html` generati da studio_preview restano
 *    leggibili e apribili senza perdita;
 * 2. Nessuna ricostruzione viene spacciata per conversione fedele:
 *    l'invariante `isFaithfulConversion: false` è garantito e viene generato
 *    un avviso esplicito e vincolante nel brief;
 * 3. La regola `proto/` inserita automaticamente in .gitignore da studio_preview
 *    viene distinta rigorosamente dalle scelte dell'utente;
 * 4. I nuovi prototipi in `proto/<id>/` diventano versionabili con un'operazione
 *    esplicita e reversibile (`proto/*.html`), senza rimuovere alla cieca righe dell'utente;
 * 5. Il diff risultante mostra modifiche al SOLO file .gitignore;
 * 6. Il tool confinato del Laboratorio non può modificare file esterni a `proto/<id>/`
 *    (incluso `.gitignore` del progetto).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	extractTitleFromHtml,
	generateGitignoreDiff,
	inspectGitignoreContent,
	inspectProjectGitignore,
	listLegacyPrototypes,
	migrateGitignoreContent,
	migrateProjectGitignore,
	readLegacyPrototype,
	reconstructLegacyPrototypeBrief,
	rollbackGitignoreContent,
	rollbackProjectGitignore,
	STUDIO_GITIGNORE_HEADER,
	STUDIO_LEGACY_GITIGNORE_RULE,
	STUDIO_MIGRATED_GITIGNORE_RULE,
	STUDIO_MIGRATED_GITIGNORE_HEADER,
	labLegacyReconstructionNotice
} from '../src/lib/lab/migration.ts';
import {
	createLabPrototype,
	labProjectStore,
	writeLabPrototypeFile,
	type LabStorageHost,
	type LabStore
} from '../src/lib/lab/storage.ts';
import { nodeHost } from './lab-host.ts';
import { useLocale } from './locale.ts';

describe('Laboratorio prototipi — Step 15: Migrazione del preesistente e compatibilità legacy', () => {
	let baseDir: string;
	let host: LabStorageHost;
	let store: LabStore;
	const projectKey = 'proj-step15-test-key';

	before(() => {
		baseDir = mkdtempSync(join(tmpdir(), 'omp-lab-step15-'));
		host = nodeHost(baseDir);
		store = labProjectStore(projectKey, host);
	});

	after(() => {
		try {
			rmSync(baseDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup error
		}
	});

	/* --------------------------------------------------- Sezione A: .gitignore */

	it('1. Distingue la regola automatica di Studio dalle regole scritte dall\'utente', () => {
		// A. Regola automatica inserita da studio_preview
		const automatedGi = [
			'node_modules/',
			'dist/',
			'',
			'# OMP Studio prototypes',
			'proto/',
			'',
			'.env'
		].join('\n');
		const inspAutomated = inspectGitignoreContent(automatedGi);
		assert.equal(inspAutomated.status, 'automated_legacy');
		assert.equal(inspAutomated.matchedRule, 'proto/');
		assert.ok(inspAutomated.userLinesCount >= 4, 'Le righe dell\'utente devono essere conteggiate');

		// B. Regola personalizzata scritta dall'utente (senza marcatore Studio)
		const userGi = [
			'# Regole progetto utente',
			'node_modules/',
			'proto/',
			'*.log'
		].join('\n');
		const inspUser = inspectGitignoreContent(userGi);
		assert.equal(inspUser.status, 'user_defined');
		assert.equal(inspUser.matchedRule, 'proto/');

		// C. Regola già migrata
		const migratedGi = [
			'node_modules/',
			'# OMP Studio prototypes (legacy HTML files only; proto/<id> is versioned)',
			'proto/*.html'
		].join('\n');
		const inspMigrated = inspectGitignoreContent(migratedGi);
		assert.equal(inspMigrated.status, 'migrated_versionable');
		assert.equal(inspMigrated.matchedRule, 'proto/*.html');

		// D. Nessuna regola relativa a proto
		const emptyGi = 'node_modules/\ndist/\n';
		const inspEmpty = inspectGitignoreContent(emptyGi);
		assert.equal(inspEmpty.status, 'none');
	});

	it('2. Migra la regola automatica preservando tutte le righe dell\'utente e genera il diff del solo .gitignore', () => {
		const originalGi = [
			'# Configurazione Git di Coldiretti Cuneo',
			'node_modules/',
			'dist/',
			'*.log',
			'',
			'# OMP Studio prototypes',
			'proto/',
			'',
			'.env',
			'secret.key'
		].join('\n');

		const res = migrateGitignoreContent(originalGi);
		assert.equal(res.success, true);
		assert.equal(res.migrated, true);
		assert.equal(res.status, 'automated_legacy');

		// Verifica che le righe utente siano integre e presenti
		assert.ok(res.content.includes('# Configurazione Git di Coldiretti Cuneo'));
		assert.ok(res.content.includes('node_modules/'));
		assert.ok(res.content.includes('dist/'));
		assert.ok(res.content.includes('*.log'));
		assert.ok(res.content.includes('.env'));
		assert.ok(res.content.includes('secret.key'));

		// Verifica che la vecchia regola 'proto/' sia sostituita da 'proto/*.html'
		assert.ok(res.content.includes('proto/*.html'));
		assert.ok(!res.content.includes('\nproto/\n'));

		// Verifica il diff generato
		assert.ok(res.diff.includes('--- a/.gitignore'));
		assert.ok(res.diff.includes('+++ b/.gitignore'));
		assert.ok(res.diff.includes('-# OMP Studio prototypes'));
		assert.ok(res.diff.includes('-proto/'));
		assert.ok(res.diff.includes('+# OMP Studio prototypes (legacy HTML files only; proto/<id> is versioned)'));
		assert.ok(res.diff.includes('+proto/*.html'));
	});

	it('3. Non modifica alla cieca le righe scritte dall\'utente', () => {
		useLocale('it');
		const userGi = [
			'# Gitignore personale dello sviluppatore',
			'node_modules/',
			'proto/',
			'*.tmp'
		].join('\n');

		// Senza override esplicito: operazione categoricamente rifiutata
		const failRes = migrateGitignoreContent(userGi);
		assert.equal(failRes.success, false);
		assert.equal(failRes.migrated, false);
		assert.equal(failRes.status, 'user_defined');
		assert.ok(failRes.error?.includes('scritte dall\'utente non vengono rimosse né modificate alla cieca'));
		assert.equal(failRes.content, userGi, 'Il contenuto deve restare identico');

		// Con override esplicito dell'utente
		const okRes = migrateGitignoreContent(userGi, { forceUserOverride: true });
		assert.equal(okRes.success, true);
		assert.equal(okRes.migrated, true);
		assert.ok(okRes.content.includes('proto/*.html'));
		assert.ok(okRes.content.includes('# Gitignore personale dello sviluppatore'));
	});

	it('4. L\'operazione di migrazione è reversibile (rollback ripristina la vecchia regola)', () => {
		const originalGi = [
			'node_modules/',
			'# OMP Studio prototypes',
			'proto/',
			'dist/'
		].join('\n');

		// Step 1: migrazione
		const migRes = migrateGitignoreContent(originalGi);
		assert.equal(migRes.success, true);
		assert.ok(migRes.content.includes('proto/*.html'));

		// Step 2: rollback
		const rollRes = rollbackGitignoreContent(migRes.content);
		assert.equal(rollRes.success, true);
		assert.equal(rollRes.reverted, true);
		assert.ok(rollRes.content.includes('proto/'));
		assert.ok(rollRes.content.includes('# OMP Studio prototypes'));
		assert.ok(!rollRes.content.includes('proto/*.html'));

		// Il diff di rollback deve mostrare il ripristino
		assert.ok(rollRes.diff.includes('-proto/*.html'));
		assert.ok(rollRes.diff.includes('+proto/'));
	});

	/* ------------------------------------------- Sezione B: prototipi legacy HTML */

	it('5. I vecchi prototipi proto/<slug>.html restano leggibili e apribili senza perdita', async () => {
		// Scrive un prototipo HTML legacy rappresentativo di quelli generati da studio_preview
		const legacyHtml = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <title>Dashboard Quote Vitivinicole</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-white p-6">
  <h1 class="text-2xl font-bold">Coldiretti Cuneo — Quote</h1>
  <div id="root">
    <p>Componente interattivo legacy UMD</p>
  </div>
</body>
</html>`;

		// Scrittura diretta nella cartella proto/
		const protoDir = join(baseDir, 'proto');
		if (!existsSync(protoDir)) {
			await host.createDirectory('proto');
		}
		await host.createFile('proto/dashboard-quote.html', legacyHtml);

		// A. Verifica elenco prototipi legacy
		const legacyList = await listLegacyPrototypes(host, store);
		assert.ok(legacyList.length >= 1, 'Deve rilevare il prototipo legacy HTML');
		const found = legacyList.find((p) => p.id === 'dashboard-quote');
		assert.ok(found, 'Deve trovare dashboard-quote');
		assert.equal(found.title, 'Dashboard Quote Vitivinicole');
		assert.equal(found.relativePath, 'proto/dashboard-quote.html');
		assert.equal(found.kind, 'legacy-html');
		assert.equal(found.isFaithfulConversion, false, 'isFaithfulConversion deve essere categoricamente false');

		// B. Verifica lettura completa del prototipo legacy
		const content = await readLegacyPrototype(host, 'dashboard-quote', store);
		assert.ok(content, 'Deve poter leggere il prototipo legacy');
		assert.equal(content.rawHtml, legacyHtml);
		assert.equal(content.isFaithfulConversion, false);

		// C. Verifica che sia apribile (il contenuto è un documento HTML valido eseguibile in sandbox)
		assert.ok(content.rawHtml.includes('<!DOCTYPE html>'));
		assert.ok(content.rawHtml.includes('Dashboard Quote Vitivinicole'));
	});

	it('6. Non presenta mai una ricostruzione come conversione fedele', () => {
		useLocale('it');
		const legacyProto = {
			id: 'quota-widget',
			fileName: 'quota-widget.html',
			relativePath: 'proto/quota-widget.html',
			title: 'Widget Quote',
			kind: 'legacy-html' as const,
			isFaithfulConversion: false as const
		};

		const recon = reconstructLegacyPrototypeBrief(legacyProto);
		assert.equal(recon.isFaithfulConversion, false, 'La ricostruzione non può essere fedele');
		assert.ok(recon.notice.includes('AVVISO VINCOLANTE'));
		assert.ok(recon.notice.includes('NON è una conversione fedele'));
		assert.ok(recon.brief.includes(labLegacyReconstructionNotice()));
		assert.ok(recon.suggestedPrototypeTitle.includes('Ricostruzione React'));
	});

	/* ------------------------------------- Sezione C: Confinamento del Laboratorio */

	it('7. Il tool confinato del Laboratorio non può modificare file esterni a proto/<id>/ (es. .gitignore)', async () => {
		// Crea un prototipo di progetto con id valido
		await createLabPrototype(store, {
			id: 'safe-proto-step15',
			title: 'Prototipo Confinato',
			brief: 'Test confinamento scritture',
			templateVersion: '1.0.0'
		});

		// Tentativo 1: scrittura con directory traversal per colpire .gitignore del progetto
		await assert.rejects(
			async () => {
				await writeLabPrototypeFile(store, 'safe-proto-step15', '../../.gitignore', 'corrupted');
			},
			{ name: 'LabStorageError' },
			'La scrittura con traversal fuori dal prototipo deve essere categoricamente bloccata'
		);

		// Tentativo 2: scrittura di file che inizia con punto (es. .gitignore)
		await assert.rejects(
			async () => {
				await writeLabPrototypeFile(store, 'safe-proto-step15', '.gitignore', 'local-ignore');
			},
			{ name: 'LabStorageError' },
			'I file nascosti o speciali come .gitignore non sono percorsi relativi ammessi nel prototipo'
		);
	});

	/* --------------------------- Sezione D: Criterio di Accettazione osservabile */

	it('8. Esegui la migrazione su progetto di prova con .gitignore contenente la vecchia regola, mostra il diff del solo .gitignore e verifica che il prototipo HTML resti apribile', async () => {
		const testDir = mkdtempSync(join(tmpdir(), 'omp-acceptance-step15-'));
		const testHost = nodeHost(testDir);
		const testStore = labProjectStore('acceptance-proj-key', testHost);

		try {
			// 1. Predisposizione .gitignore con la vecchia regola automatica e righe utente
			const initialGitignore = [
				'# Repository Coldiretti',
				'node_modules/',
				'dist/',
				'',
				'# OMP Studio prototypes',
				'proto/',
				'',
				'build/'
			].join('\n');
			writeFileSync(join(testDir, '.gitignore'), initialGitignore, 'utf8');

			// 2. Predisposizione di un vecchio prototipo HTML in proto/
			await testHost.createDirectory('proto');
			const legacyHtml = `<!DOCTYPE html>
<html>
<head><title>Tabella Pratiche PSR Legacy</title></head>
<body><h1>Pratiche PSR 2026</h1></body>
</html>`;
			await testHost.createFile('proto/pratiche-psr.html', legacyHtml);

			// 3. Verifica stato pre-migrazione
			const preInspection = await inspectProjectGitignore(testHost);
			assert.equal(preInspection.status, 'automated_legacy');

			// 4. Esecuzione della migrazione
			const migResult = await migrateProjectGitignore(testHost);
			assert.equal(migResult.success, true);
			assert.equal(migResult.migrated, true);

			// 5. Mostra il diff risultante del solo .gitignore
			console.log('\n--- DIFF RISULTANTE DEL SOLO .gitignore ---');
			console.log(migResult.diff);
			console.log('-------------------------------------------\n');

			assert.ok(migResult.diff.includes('--- a/.gitignore'));
			assert.ok(migResult.diff.includes('+++ b/.gitignore'));
			assert.ok(migResult.diff.includes('-proto/'));
			assert.ok(migResult.diff.includes('+proto/*.html'));

			// Verifica che sul filesystem .gitignore sia stato aggiornato atomicamente
			const diskGitignore = readFileSync(join(testDir, '.gitignore'), 'utf8');
			assert.ok(diskGitignore.includes('proto/*.html'));
			assert.ok(!diskGitignore.includes('\nproto/\n'));
			assert.ok(diskGitignore.includes('node_modules/'));
			assert.ok(diskGitignore.includes('build/'));

			// 6. Verifica che il vecchio prototipo HTML resti perfettamente leggibile e apribile
			const legacyProtos = await listLegacyPrototypes(testHost, testStore);
			assert.equal(legacyProtos.length, 1);
			assert.equal(legacyProtos[0].id, 'pratiche-psr');
			assert.equal(legacyProtos[0].title, 'Tabella Pratiche PSR Legacy');

			const readContent = await readLegacyPrototype(testHost, 'pratiche-psr', testStore);
			assert.ok(readContent);
			assert.equal(readContent.rawHtml, legacyHtml);
			assert.equal(readContent.isFaithfulConversion, false);

			// 7. Verifica che i nuovi prototipi in proto/<id> siano ora versionabili in Git
			// In Git: proto/*.html ignora solo i file .html diretti, mentre le sottocartelle proto/<id>/
			// sono tracciate e versionabili!
			await createLabPrototype(testStore, {
				id: 'nuovo-prototipo-psr',
				title: 'Nuovo Prototipo PSR',
				brief: 'Prototipo moderno React',
				templateVersion: '1.0.0'
			});
			assert.ok(existsSync(join(testDir, 'proto', 'nuovo-prototipo-psr', 'prototype.json')));

			// 8. Verifica reversibilità dell'operazione
			const rollbackResult = await rollbackProjectGitignore(testHost);
			assert.equal(rollbackResult.success, true);
			assert.equal(rollbackResult.reverted, true);

			const revertedDiskGi = readFileSync(join(testDir, '.gitignore'), 'utf8');
			assert.ok(revertedDiskGi.includes('proto/'));
			assert.ok(!revertedDiskGi.includes('proto/*.html'));
		} finally {
			try {
				rmSync(testDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});
});
