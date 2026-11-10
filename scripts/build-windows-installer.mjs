#!/usr/bin/env node
// Avvolge il setup NSIS di Tauri nell'installer grafico (src-tauri/installer,
// docs/requisiti/installer-windows.md). Il setup NSIS esce dalla cartella del bundle
// e finisce incorporato nell'installer grafico, che prende il suo posto con lo stesso
// nome: release, nightly.json, SHA256SUMS.txt, updater e install-windows.cmd non
// cambiano. Va eseguito dopo `tauri build --bundles nsis` (e dopo la firma del setup).
//
// Uso:
//   node scripts/build-windows-installer.mjs --bundle-dir <cartella nsis> [--profile release|nightly]
//   node scripts/build-windows-installer.mjs --setup <file -setup.exe> [--profile ...]

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'src-tauri', 'Cargo.toml');
const PACKAGE = 'omp-studio-setup';
// Stessa stringa di MARKER in src-tauri/installer/src/main.rs.
const MARKER = 'OMP-STUDIO-GRAPHICAL-SETUP';

function mb(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Sostituisce `setupPath` con l'installer grafico che lo contiene.
 * Idempotente: un file che e' gia' l'installer grafico resta com'e'.
 */
export function wrapWindowsInstaller({ setupPath, profile = 'release' }) {
	if (!readFileSync(setupPath).includes(MARKER)) {
		const targetDir = join(ROOT, 'src-tauri', 'target', profile === 'dev' ? 'debug' : profile);
		// Fuori dalla cartella del bundle: chi pubblica raccoglie tutti gli .exe che ci trova.
		const payloadDir = join(targetDir, 'installer-payload');
		mkdirSync(payloadDir, { recursive: true });
		const payload = join(payloadDir, basename(setupPath));
		copyFileSync(setupPath, payload);

		console.log(`Installer grafico: incorporo ${basename(setupPath)} (${mb(statSync(payload).size)})...`);
		const res = spawnSync(
			'cargo',
			['build', '--manifest-path', MANIFEST, '-p', PACKAGE, '--profile', profile],
			{ cwd: ROOT, stdio: 'inherit', env: { ...process.env, OMP_INSTALLER_PAYLOAD: payload } }
		);
		if (res.error || res.status !== 0) {
			// Il setup NSIS e' ancora al suo posto: niente da ripristinare.
			throw new Error(`Compilazione dell'installer grafico fallita (${res.error?.message ?? `codice ${res.status}`})`);
		}
		const built = join(targetDir, `${PACKAGE}.exe`);
		const wrapped = readFileSync(built);
		if (!wrapped.includes(MARKER)) {
			throw new Error(`${built} non contiene la firma dell'installer grafico`);
		}
		copyFileSync(built, setupPath);
		console.log(`Installer grafico pronto: ${basename(setupPath)} (${mb(wrapped.length)})`);
	} else {
		console.log(`Installer grafico gia' presente: ${basename(setupPath)}`);
	}
	return setupPath;
}

function parseArgs(argv) {
	const opts = { bundleDir: null, setup: null, profile: 'release' };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--bundle-dir') opts.bundleDir = argv[++i];
		else if (arg === '--setup') opts.setup = argv[++i];
		else if (arg === '--profile') opts.profile = argv[++i];
		else throw new Error(`Argomento sconosciuto: ${arg}`);
	}
	if (!opts.bundleDir === !opts.setup) throw new Error('Serve --bundle-dir oppure --setup');
	if (!opts.profile) throw new Error('--profile senza valore');
	return opts;
}

function findSetup(bundleDir) {
	if (!existsSync(bundleDir)) throw new Error(`Cartella del bundle inesistente: ${bundleDir}`);
	const setups = readdirSync(bundleDir).filter((name) => name.toLowerCase().endsWith('-setup.exe'));
	// In CI la cartella e' nuova: piu' di un setup vuol dire che non si sa quale pubblicare.
	if (setups.length !== 1) {
		throw new Error(`Atteso un solo *-setup.exe in ${bundleDir}, trovati ${setups.length}: usa --setup`);
	}
	return join(bundleDir, setups[0]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const opts = parseArgs(process.argv.slice(2));
		const setupPath = resolve(opts.setup ?? findSetup(resolve(opts.bundleDir)));
		wrapWindowsInstaller({ setupPath, profile: opts.profile });
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
}
