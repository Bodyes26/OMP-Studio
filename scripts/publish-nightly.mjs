#!/usr/bin/env node
// Compila in locale l'installer per il sistema operativo corrente, genera il
// manifest nightly.json e aggiorna la prerelease `nightly` su GitHub tramite `gh`.
//
// Uso:
//   node scripts/publish-nightly.mjs                # build locale e pubblicazione completa
//   node scripts/publish-nightly.mjs --dry-run      # build locale senza pubblicazione su GitHub
//   node scripts/publish-nightly.mjs --skip-build   # pubblica l'ultimo installer gia' compilato
//   node scripts/publish-nightly.mjs --build-id 123 # specifica un ID build numerico

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
	ROOT,
	VERSION_FILES,
	computeVersionBumps,
	getNightlyVersion,
	read,
	write
} from './nightly-version.mjs';

function parseArgs() {
	const args = process.argv.slice(2);
	const opts = {
		buildId: null,
		dryRun: false,
		skipBuild: false,
		help: false
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--help' || arg === '-h') {
			opts.help = true;
		} else if (arg === '--dry-run' || arg === '--no-upload') {
			opts.dryRun = true;
		} else if (arg === '--skip-build') {
			opts.skipBuild = true;
		} else if (arg === '--build-id') {
			opts.buildId = args[++i];
		} else if (/^[1-9]\d*$/.test(arg)) {
			opts.buildId = arg;
		} else {
			console.error(`Opzione sconosciuta: ${arg}`);
			process.exit(1);
		}
	}

	return opts;
}

function printHelp() {
	console.log(`
Uso: node scripts/publish-nightly.mjs [opzioni]

Opzioni:
  --build-id <id>     ID build numerico per SemVer (default: timestamp in secondi)
  --dry-run           Compila e genera nightly.json senza pubblicare su GitHub
  --no-upload         Alias di --dry-run
  --skip-build        Salta la compilazione e usa l'installer piu' recente
  -h, --help          Mostra questo messaggio di aiuto
`);
}

function runCommand(cmd, args, options = {}) {
	const res = spawnSync(cmd, args, {
		cwd: ROOT,
		stdio: options.stdio || 'inherit',
		encoding: 'utf8',
		...options
	});
	if (res.error) {
		throw res.error;
	}
	if (res.status !== 0 && !options.allowFailure) {
		const formatted = [cmd, ...args].map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ');
		throw new Error(`Comando '${formatted}' fallito con codice di uscita ${res.status}`);
	}
	return res;
}

function getCommitSha() {
	const res = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
	if (res.error) {
		throw new Error(`Impossibile determinare il commit git corrente: ${res.error.message}`);
	}
	if (res.status !== 0 || !res.stdout) {
		throw new Error(
			`Impossibile determinare il commit git corrente: git rev-parse HEAD e' terminato con codice ${res.status}`
		);
	}
	return res.stdout.trim();
}

function verifyGhAuth() {
	const res = spawnSync('gh', ['auth', 'status'], { cwd: ROOT, stdio: 'ignore' });
	if (res.error || res.status !== 0) {
		throw new Error(
			'GitHub CLI (gh) non risulta autenticata. Esegui `gh auth login` prima di pubblicare.'
		);
	}
}

function getPlatformConfig() {
	switch (process.platform) {
		case 'win32':
			return {
				name: 'Windows x64',
				bundleArgs: ['--bundles', 'nsis'],
				bundleDir: join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis'),
				extensions: ['.exe']
			};
		case 'darwin':
			return {
				name: 'macOS',
				bundleArgs: ['--bundles', 'dmg'],
				bundleDir: join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'dmg'),
				extensions: ['.dmg']
			};
		case 'linux':
			return {
				name: 'Linux',
				bundleArgs: ['--bundles', 'deb,appimage'],
				bundleDir: join(ROOT, 'src-tauri', 'target', 'release', 'bundle'),
				extensions: ['.deb', '.AppImage', '.appimage']
			};
		default:
			throw new Error(`Piattaforma non supportata per build locale: ${process.platform}`);
	}
}

function findInstaller(platformConfig, version, buildStartTime) {
	const dir = platformConfig.bundleDir;
	if (!existsSync(dir)) {
		throw new Error(`Directory bundle non trovata: ${dir}`);
	}

	function scanDir(currentDir) {
		let results = [];
		const entries = readdirSync(currentDir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(currentDir, entry.name);
			if (entry.isDirectory()) {
				results = results.concat(scanDir(fullPath));
			} else if (entry.isFile()) {
				const matchesExt = platformConfig.extensions.some((ext) =>
					entry.name.toLowerCase().endsWith(ext.toLowerCase())
				);
				if (matchesExt) {
					const stats = statSync(fullPath);
					results.push({
						path: fullPath,
						name: entry.name,
						size: stats.size,
						mtimeMs: stats.mtimeMs
					});
				}
			}
		}
		return results;
	}

	const candidates = scanDir(dir);
	if (candidates.length === 0) {
		throw new Error(`Nessun installer trovato in ${dir}`);
	}

	// 1. Cerca il file che contiene esattamente la versione nel nome
	const exactMatch = candidates.find((c) => c.name.includes(version));
	if (exactMatch) {
		return exactMatch;
	}

	// 2. Se non c'e' match per nome esatto, prendi il piu' recente dopo l'avvio della build
	candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
	const newest = candidates[0];
	if (buildStartTime && newest.mtimeMs < buildStartTime - 10000) {
		console.warn(
			`Attenzione: l'installer trovato (${newest.name}) e' anteriore all'avvio della build.`
		);
	}
	return newest;
}

async function main() {
	const opts = parseArgs();
	if (opts.help) {
		printHelp();
		return;
	}

	const commitSha = getCommitSha();
	const platform = getPlatformConfig();
	const buildId = opts.buildId || String(Date.now());
	const version = getNightlyVersion(buildId);

	console.log(`\n========================================`);
	console.log(`  Pubblicazione Nightly Locale`);
	console.log(`========================================`);
	console.log(`  Piattaforma:  ${platform.name}`);
	console.log(`  Versione:     ${version}`);
	console.log(`  Commit:       ${commitSha}`);
	console.log(`  Modalita':    ${opts.dryRun ? 'DRY-RUN (nessun upload)' : 'Pubblicazione GitHub'}`);
	console.log(`========================================\n`);

	if (!opts.dryRun) {
		verifyGhAuth();
	}

	// Salva copie di backup in memoria per il ripristino
	const backups = new Map(VERSION_FILES.map((rel) => [rel, read(rel)]));
	let versionApplied = false;

	const buildStartTime = Date.now();

	try {
		// 1. Applica versione temporanea
		console.log(`Imposto la versione temporanea ${version}...`);
		const edits = computeVersionBumps(version);
		for (const [rel, content] of edits) {
			write(rel, content);
		}
		versionApplied = true;

		// 2. Compilazione
		if (!opts.skipBuild) {
			console.log(`\nAvvio compilazione Tauri (${platform.name})...`);
			const tauriCmd = 'bun';
			const tauriArgs = ['run', 'tauri', 'build', ...platform.bundleArgs];

			runCommand(tauriCmd, tauriArgs);
		} else {
			console.log(`\nSalto la compilazione (--skip-build).`);
		}

		// 3. Individuazione installer
		const installer = findInstaller(platform, version, buildStartTime);
		const sizeMb = (installer.size / (1024 * 1024)).toFixed(2);
		console.log(`\nInstaller individuato:`);
		console.log(`  File:       ${installer.name}`);
		console.log(`  Percorso:   ${installer.path}`);
		console.log(`  Dimensione: ${sizeMb} MB`);

		// Calcolo hash SHA256 dell'installer per il manifest
		const installerBuffer = readFileSync(installer.path);
		const installerSha256 = createHash('sha256').update(installerBuffer).digest('hex');
		console.log(`  SHA256:     ${installerSha256}`);

		// 4. Generazione manifest e note
		const manifest = {
			version,
			commit: commitSha,
			published_at: new Date().toISOString(),
			sha256: installerSha256
		};
		const manifestPath = join(ROOT, 'nightly.json');
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
		const notesContent = [
			`Build locale del commit \`${commitSha}\` (${platform.name}).`,
			'',
			`Versione prerelease: \`${version}\``,
			'',
			'Questa versione può contenere modifiche sperimentali non ancora verificate per il canale stabile.'
		].join('\n');
		const notesPath = join(ROOT, 'nightly-notes.md');
		writeFileSync(notesPath, notesContent + '\n', 'utf8');

		// 5. Upload GitHub
		if (!opts.dryRun) {
			console.log(`\nAggiorno il tag git 'nightly' sul commit ${commitSha}...`);
			runCommand('git', ['tag', '-f', 'nightly', commitSha]);
			runCommand('git', ['push', 'origin', 'refs/tags/nightly', '--force']);

			// Se la release 'nightly' esiste gia', la aggiorniamo con clobbering degli asset
			const releaseCheck = runCommand('gh', ['release', 'view', 'nightly'], {
				stdio: 'ignore',
				allowFailure: true
			});
			const releaseExists = releaseCheck.status === 0;

			if (releaseExists) {
				console.log(`Aggiornamento metadati prerelease 'nightly'...`);
				runCommand('gh', [
					'release',
					'edit',
					'nightly',
					'--title',
					`Nightly ${version}`,
					'--notes-file',
					notesPath,
					'--prerelease'
				]);

				console.log(`Caricamento asset (con sovrascrittura / clobber)...`);
				runCommand('gh', [
					'release',
					'upload',
					'nightly',
					installer.path,
					manifestPath,
					'--clobber'
				]);
			} else {
				console.log(`Creazione nuova prerelease 'nightly'...`);
				runCommand('gh', [
					'release',
					'create',
					'nightly',
					installer.path,
					manifestPath,
					'--verify-tag',
					'--prerelease',
					'--title',
					`Nightly ${version}`,
					'--notes-file',
					notesPath
				]);
			}

			// Il tag 'nightly' e' mobile e `--clobber` sovrascrive solo gli asset con lo
			// stesso nome: cambiando il build-id gli installer delle build precedenti
			// resterebbero pubblicati. GitHub restituisce gli asset in ordine
			// alfabetico, quindi il piu' vecchio verrebbe scelto per primo dall'updater.
			// GitHub sostituisce gli spazi con punti nei nomi degli asset caricati.
			const normalizza = (nome) => nome.replace(/ /g, '.');
			const nomiDaConservare = new Set(
				[basename(installer.path), basename(manifestPath)].map(normalizza)
			);
			const elenco = runCommand(
				'gh',
				['release', 'view', 'nightly', '--json', 'assets', '--jq', '.assets[].name'],
				{ stdio: 'pipe', allowFailure: true }
			);
			if (elenco.status === 0) {
				const obsoleti = String(elenco.stdout || '')
					.split('\n')
					.map((n) => n.trim())
					.filter(
						(n) => n && !nomiDaConservare.has(normalizza(n)) && !n.includes(version)
					);
				for (const nome of obsoleti) {
					console.log(`Rimozione asset obsoleto: ${nome}`);
					runCommand('gh', ['release', 'delete-asset', 'nightly', nome, '--yes'], {
						allowFailure: true
					});
				}
			}

			console.log(`\nPrerelease Nightly pubblicata con successo!`);
			runCommand('gh', ['release', 'view', 'nightly', '--json', 'url,assets'], {
				allowFailure: true
			});
		} else {
			console.log(`\n[DRY-RUN] Manifest generato in ${manifestPath}`);
			console.log(`[DRY-RUN] Nessun upload effettuato su GitHub.`);
		}
	} finally {
		// Ripristino garantito dei file di versione allo stato stabile pulito
		if (versionApplied) {
			console.log(`\nRipristino file di versione allo stato stabile...`);
			for (const [rel, originalContent] of backups) {
				write(rel, originalContent);
			}
			console.log(`File di versione ripristinati.`);
		}

		// Pulizia file temporanei
		const tempNotes = join(ROOT, 'nightly-notes.md');
		if (existsSync(tempNotes)) {
			unlinkSync(tempNotes);
		}
		if (opts.dryRun) {
			// In dry-run possiamo conservare nightly.json per ispezione
		} else {
			const tempManifest = join(ROOT, 'nightly.json');
			if (existsSync(tempManifest)) {
				unlinkSync(tempManifest);
			}
		}
	}
}

main().catch((err) => {
	console.error(`\nErrore durante la pubblicazione nightly:`, err.message || err);
	process.exit(1);
});
