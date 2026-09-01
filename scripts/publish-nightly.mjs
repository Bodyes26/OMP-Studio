#!/usr/bin/env node
// Compila in locale l'installer per il sistema operativo corrente, genera il
// manifest nightly.json con checksum esatti per asset e aggiorna la prerelease
// `nightly` su GitHub tramite `gh` in modo fail-safe.
//
// Uso:
//   node scripts/publish-nightly.mjs                # build locale e pubblicazione completa
//   node scripts/publish-nightly.mjs --dry-run      # build locale senza pubblicazione su GitHub
//   node scripts/publish-nightly.mjs --skip-build   # pubblica l'ultimo installer gia' compilato
//   node scripts/publish-nightly.mjs --build-id 123 # specifica un ID build numerico

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
	ROOT,
	VERSION_FILES,
	computeVersionBumps,
	getNightlyVersion,
	normalizeBuildId,
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
  --build-id <id>     ID build numerico o timestamp per SemVer (default: ora corrente)
  --dry-run           Compila e genera manifest senza pubblicare su GitHub
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

function findInstallers(platformConfig, version, buildStartTime) {
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

	// 1. Cerca i file che contengono esattamente la versione nel nome
	const exactMatches = candidates.filter((c) => c.name.includes(version));
	if (exactMatches.length > 0) {
		return exactMatches;
	}

	// 2. Se non c'e' match per nome esatto, raggruppa per estensione e prendi il piu' recente
	candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
	const byExt = new Map();
	for (const cand of candidates) {
		const ext = cand.name.substring(cand.name.lastIndexOf('.')).toLowerCase();
		if (!byExt.has(ext)) {
			byExt.set(ext, cand);
		}
	}
	const selected = Array.from(byExt.values());
	for (const cand of selected) {
		if (buildStartTime && cand.mtimeMs < buildStartTime - 10000) {
			console.warn(
				`Attenzione: l'installer trovato (${cand.name}) e' anteriore all'avvio della build.`
			);
		}
	}
	return selected;
}

async function main() {
	const opts = parseArgs();
	if (opts.help) {
		printHelp();
		return;
	}

	const commitSha = getCommitSha();
	const platform = getPlatformConfig();
	const buildId = normalizeBuildId(opts.buildId);
	const version = getNightlyVersion(buildId);

	console.log(`\n========================================`);
	console.log(`  Pubblicazione Nightly Locale`);
	console.log(`========================================`);
	console.log(`  Piattaforma:  ${platform.name}`);
	console.log(`  Build ID:     ${buildId}`);
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
	const stagingDir = join(ROOT, 'staging-nightly');

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

		// 3. Individuazione installer e preparazione staging piatto con nomi normalizzati a punti
		const rawInstallers = findInstallers(platform, version, buildStartTime);
		if (existsSync(stagingDir)) {
			rmSync(stagingDir, { recursive: true, force: true });
		}
		mkdirSync(stagingDir, { recursive: true });

		console.log(`\nPreparazione staging piatto (${rawInstallers.length} file)...`);
		const stagedInstallers = [];
		const checksums = {};
		const sha256Lines = [];

		for (const raw of rawInstallers) {
			// Normalizza a punti PRIMA di calcolare checksum e caricare
			const targetName = raw.name.replace(/ /g, '.');
			const targetPath = join(stagingDir, targetName);
			copyFileSync(raw.path, targetPath);

			const fileBuffer = readFileSync(targetPath);
			const fileSha = createHash('sha256').update(fileBuffer).digest('hex');
			const stats = statSync(targetPath);

			checksums[targetName] = fileSha;
			sha256Lines.push(`${fileSha}  ${targetName}`);
			stagedInstallers.push({
				name: targetName,
				path: targetPath,
				size: stats.size,
				sha256: fileSha
			});

			const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
			console.log(`  - ${targetName} (${sizeMb} MB) -> SHA256: ${fileSha}`);
		}

		// Scrivi file SHA256SUMS.txt nello staging
		const sumsPath = join(stagingDir, 'SHA256SUMS.txt');
		writeFileSync(sumsPath, sha256Lines.join('\n') + '\n', 'utf8');

		// 4. Generazione manifest e note
		// Il campo legacy `sha256` si riferisce esplicitamente all'installer Windows .exe se presente
		const exeInstaller = stagedInstallers.find((i) => i.name.toLowerCase().endsWith('.exe'));
		const legacySha256 = exeInstaller ? exeInstaller.sha256 : (stagedInstallers[0] ? stagedInstallers[0].sha256 : undefined);

		const manifest = {
			version,
			commit: commitSha,
			published_at: new Date().toISOString(),
			checksums,
			sha256: legacySha256
		};
		const manifestPath = join(stagingDir, 'nightly.json');
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

		const notesContent = [
			`Build locale del commit \`${commitSha}\` (${platform.name}).`,
			'',
			`Versione prerelease: \`${version}\``,
			'',
			'Questa versione può contenere modifiche sperimentali non ancora verificate per il canale stabile.'
		].join('\n');
		const notesPath = join(stagingDir, 'nightly-notes.md');
		writeFileSync(notesPath, notesContent + '\n', 'utf8');

		// 5. Upload GitHub fail-safe (upload/clobber prima, poi pulizia obsoleti, poi spostamento tag)
		if (!opts.dryRun) {
			const uploadFiles = [
				...stagedInstallers.map((i) => i.path),
				sumsPath,
				manifestPath
			];

			const releaseCheck = runCommand('gh', ['release', 'view', 'nightly'], {
				stdio: 'ignore',
				allowFailure: true
			});
			const releaseExists = releaseCheck.status === 0;

			if (releaseExists) {
				console.log(`Caricamento nuovi asset nella prerelease 'nightly'...`);
				runCommand('gh', [
					'release',
					'upload',
					'nightly',
					...uploadFiles,
					'--clobber'
				]);

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

				// Rimuove solo gli asset obsoleti non appartenenti al set appena caricato
				console.log(`Pulizia asset obsoleti dalla prerelease 'nightly'...`);
				const currentNames = new Set(
					[...stagedInstallers.map((i) => i.name), 'SHA256SUMS.txt', 'nightly.json'].map((n) =>
						n.replace(/ /g, '.')
					)
				);
				const assetsOutput = runCommand(
					'gh',
					['release', 'view', 'nightly', '--json', 'assets', '--jq', '.assets[].name'],
					{ stdio: 'pipe', allowFailure: true }
				);
				if (assetsOutput.status === 0 && assetsOutput.stdout) {
					const remoteAssets = String(assetsOutput.stdout)
						.split('\n')
						.map((n) => n.trim())
						.filter(Boolean);
					for (const assetName of remoteAssets) {
						const norm = assetName.replace(/ /g, '.');
						if (!currentNames.has(norm) && !norm.includes(version)) {
							console.log(`Eliminazione asset obsoleto: ${assetName}`);
							runCommand('gh', ['release', 'delete-asset', 'nightly', assetName, '--yes'], {
								allowFailure: true
							});
						}
					}
				}
			} else {
				console.log(`Creazione nuova prerelease 'nightly'...`);
				runCommand('gh', [
					'release',
					'create',
					'nightly',
					...uploadFiles,
					'--prerelease',
					'--title',
					`Nightly ${version}`,
					'--notes-file',
					notesPath
				]);
			}

			// Spostamento del tag git mobile 'nightly' solo a valle del completamento dell'upload
			console.log(`\nAggiorno il tag git 'nightly' sul commit ${commitSha}...`);
			runCommand('git', ['tag', '-f', 'nightly', commitSha]);
			runCommand('git', ['push', 'origin', 'refs/tags/nightly', '--force']);

			console.log(`\nPrerelease Nightly pubblicata con successo!`);
			runCommand('gh', ['release', 'view', 'nightly', '--json', 'url,assets'], {
				allowFailure: true
			});
		} else {
			console.log(`\n[DRY-RUN] File di staging generati in ${stagingDir}`);
			console.log(`[DRY-RUN] Manifest:\n${JSON.stringify(manifest, null, 2)}`);
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

		if (!opts.dryRun && existsSync(stagingDir)) {
			rmSync(stagingDir, { recursive: true, force: true });
		}
	}
}

main().catch((err) => {
	console.error(`\nErrore durante la pubblicazione nightly:`, err.message || err);
	process.exit(1);
});
