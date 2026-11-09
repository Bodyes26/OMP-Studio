#!/usr/bin/env node
/**
 * OMP Studio — Preflight unificato delle verifiche Nightly.
 *
 * Invarianti (NL1, NL5, NL6 / NLC-001, 002, 005, 006, 007, 009, 010):
 * 1. Lock esclusivo (`nightly.lock`) per l'intera durata della verifica o della pubblicazione.
 * 2. Allineamento versioni delegato a scripts/release.mjs (checkVersionAlignment con getVersions(root)).
 * 3. Preparazione frontend (Paraglide i18n + SvelteKit sync) una sola volta prima dei consumatori
 *    tramite import statico di scripts/prepare-frontend.mjs (nessun fallback silenzioso).
 * 4. Parallelismo controllato: un ramo frontend (icone, catalogo live, typecheck, smoke test JS)
 *    e un ramo Rust (Cargo no-run sempre eseguito per freschezza + riuso del runtime se identico) concorrenti.
 *    Nessuna contesa Cargo concorrente.
 * 5. Catalogo comandi live (`check-commands.mjs`) eseguito ad ogni run senza cache;
 *    può essere omesso solo con `--skip-command-check` (emergenza).
 * 6. Gate icone strict (`check-icons.mjs --strict`).
 * 6b. Lint Rust (`cargo clippy --all-targets -- -D warnings`) come nei job di build CI, senza cache.
 * 7. Riuso conservativo: Cargo compila sempre per determinare freschezza e artifact;
 *    se gli artifact compilati e le fonti runtime sono identici, il runtime nativo e doctest vengono riusati.
 * 8. Abort immediato di entrambi i rami: l'errore in un ramo scatena subito `abortController.abort()`
 *    sui processi compagni, e `Promise.allSettled` attende la chiusura completa prima di rilanciare l'errore.
 *    Incertezza (fingerprint null) => gate eseguito completamente senza cache, non fallimento.
 *    Mutazione accertata tra due fingerprint non-null => fallimento immediato del preflight.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	acquireNightlyLock,
	releaseNightlyLock,
	withNightlyLock
} from './nightly-lock.mjs';

import {
	canReuseGate,
	computeFrontendFingerprint,
	computeRustFingerprint,
	invalidateGates,
	readNightlyCache,
	writeNightlyCache
} from './nightly-cache.mjs';

import {
	compileRustTests,
	killProcessTree,
	runRustClippy,
	runRustTests
} from './nightly-rust.mjs';

import {
	checkVersionAlignment as checkVersionAlignmentFromRelease,
	getVersions
} from './release.mjs';

import { prepareFrontend } from './prepare-frontend.mjs';

export { acquireNightlyLock, releaseNightlyLock, withNightlyLock };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT = resolve(__dirname, '..');

/**
 * Esegue un processo figlio Node con supporto ad abort controllato e kill dell'albero di processi.
 *
 * @param {string[]} nodeArgs
 * @param {object} options
 * @param {string} options.cwd
 * @param {AbortSignal} [options.signal]
 * @param {'inherit' | 'pipe' | 'ignore'} [options.stdio]
 * @returns {Promise<void>}
 */
function spawnNodeStep(nodeArgs, options) {
	const { cwd, signal, stdio = 'inherit' } = options;

	return new Promise((resolvePromise, rejectPromise) => {
		if (signal?.aborted) {
			const err = new Error('Operazione interrotta prima dell\'avvio del processo');
			err.name = 'AbortError';
			return rejectPromise(err);
		}

		const child = spawn(process.execPath, nodeArgs, {
			cwd,
			stdio,
			windowsHide: true,
			detached: process.platform !== 'win32'
		});

		let aborted = false;
		const onAbort = () => {
			aborted = true;
			killProcessTree(child);
		};

		if (signal) {
			signal.addEventListener('abort', onAbort, { once: true });
		}
		if (signal?.aborted) onAbort();

		child.on('error', (err) => {
			if (signal) signal.removeEventListener('abort', onAbort);
			rejectPromise(err);
		});

		child.on('close', (code) => {
			if (signal) signal.removeEventListener('abort', onAbort);

			if (aborted || signal?.aborted) {
				const err = new Error('Processo interrotto da segnale');
				err.name = 'AbortError';
				return rejectPromise(err);
			}

			if (code !== 0) {
				return rejectPromise(new Error(`Processo '${nodeArgs.join(' ')}' fallito con codice di uscita ${code}`));
			}

			resolvePromise();
		});
	});
}

/**
 * Valida che tutti i 4 file di versione siano allineati, delegando al modulo canonico release.mjs.
 *
 * @param {string} root
 * @returns {{ ok: boolean, version?: string, versions: Record<string, string | null>, error?: string }}
 */
export function checkVersionAlignment(root) {
	const versions = getVersions(root);
	return checkVersionAlignmentFromRelease({ silent: true, versions });
}

/**
 * Esegue le verifiche preflight per la Nightly.
 *
 * @param {object} [options]
 * @param {string} [options.root] Radice del workspace
 * @param {boolean} [options.full=false] Se true, forza riesecuzione ignorando la cache
 * @param {AbortSignal} [options.signal] Segnale per annullare le verifiche in corso
 * @param {boolean} [options.lockHeld=false] Se true, indica che il chiamante detiene già il lock
 * @param {boolean} [options.skipCommandCheck=false] Salta la verifica del catalogo comandi omp (emergenza)
 * @param {'inherit' | 'pipe' | 'ignore'} [options.stdio='inherit']
 * @returns {Promise<{
 *   ok: boolean,
 *   totalDurationMs: number,
 *   gates: Record<string, { status: 'passed' | 'reused' | 'failed' | 'skipped', durationMs?: number, [key: string]: any }>,
 *   fingerprints: { rust?: string | null, frontend?: string | null }
 * }>}
 */
export async function verifyNightly(options = {}) {
	const root = resolve(options.root || DEFAULT_ROOT);
	const full = Boolean(options.full);
	const lockHeld = Boolean(options.lockHeld);
	const skipCommandCheck = Boolean(options.skipCommandCheck);
	const stdio = options.stdio || 'inherit';
	const externalSignal = options.signal;

	// Se il chiamante non detiene già il lock, acquisizione tramite withNightlyLock con inoltro del segnale
	if (!lockHeld) {
		return withNightlyLock(
			root,
			() =>
				verifyNightly({
					...options,
					root,
					lockHeld: true
				}),
			{ signal: externalSignal }
		);
	}

	const overallStart = performance.now();
	const cache = readNightlyCache(root);

	/** @type {Record<string, { status: 'passed' | 'reused' | 'failed' | 'skipped', durationMs?: number, [key: string]: any }>} */
	const gates = {};

	const abortController = new AbortController();
	const localSignal = abortController.signal;

	if (externalSignal) {
		if (externalSignal.aborted) {
			abortController.abort();
		} else {
			externalSignal.addEventListener('abort', () => abortController.abort(), { once: true });
		}
	}

	// =========================================================================
	// Gate 1: Allineamento versioni (veloce e fail-fast)
	// =========================================================================
	const versionStart = performance.now();
	const versionCheck = checkVersionAlignment(root);
	if (!versionCheck.ok) {
		gates.versions = {
			status: 'failed',
			durationMs: performance.now() - versionStart,
			error: versionCheck.error
		};
		throw new Error(`Verifica allineamento versioni fallita:\n${versionCheck.error}`);
	}
	gates.versions = {
		status: 'passed',
		durationMs: performance.now() - versionStart,
		version: versionCheck.version
	};

	// Calcolo preliminare del fingerprint Frontend
	const frontendFingerprintBefore = computeFrontendFingerprint(root);
	const canReuseFrontend = !full && frontendFingerprintBefore !== null && canReuseGate('frontend', frontendFingerprintBefore, cache);

	/** @type {Record<string, { fingerprint: string, details?: object }>} */
	const gatesToCache = {};

	let compiledRustArtifacts = null;
	let compiledRustToolchain = null;
	let rustFingerprintBefore = null;

	// =========================================================================
	// Esecuzione rami paralleli: Ramo Frontend + Ramo Rust
	// =========================================================================

	const runFrontendBranch = async () => {
		// 1. Gate Icone (strict)
		const iconStart = performance.now();
		const iconScript = join(root, 'scripts', 'check-icons.mjs');
		await spawnNodeStep([iconScript, '--strict'], { cwd: root, signal: localSignal, stdio });
		gates.icons = {
			status: 'passed',
			durationMs: performance.now() - iconStart
		};

		// 2. Gate Catalogo Comandi live (MAI cache tra run)
		if (skipCommandCheck) {
			gates.commands = { status: 'skipped' };
		} else {
			const cmdStart = performance.now();
			const cmdScript = join(root, 'scripts', 'check-commands.mjs');
			await spawnNodeStep(
				['--no-warnings', '--experimental-strip-types', cmdScript],
				{ cwd: root, signal: localSignal, stdio }
			);
			gates.commands = {
				status: 'passed',
				durationMs: performance.now() - cmdStart
			};
		}

		// 3. Gate JS (Typecheck + Smoke test JS)
		const jsStart = performance.now();
		if (canReuseFrontend) {
			gates.frontend = {
				status: 'reused',
				durationMs: 0,
				savedDurationMs: cache.gates.frontend.durationMs,
				fingerprint: frontendFingerprintBefore
			};
		} else {
			// Preparazione frontend condivisa (Paraglide + SvelteKit sync) una sola volta
			const prepareStart = performance.now();
			await prepareFrontend(root, { signal: localSignal, stdio });
			gates.preparation = { status: 'passed', durationMs: performance.now() - prepareStart };

			// Typecheck diretto (svelte-check)
			const typesStart = performance.now();
			const svelteCheckBin = join(root, 'node_modules', 'svelte-check', 'bin', 'svelte-check');
			await spawnNodeStep(
				[svelteCheckBin, '--tsconfig', join(root, 'tsconfig.json')],
				{ cwd: root, signal: localSignal, stdio }
			);
			gates.types = { status: 'passed', durationMs: performance.now() - typesStart };

			// Test JS via runner preparato
			const testsStart = performance.now();
			const testRunnerScript = join(root, 'scripts', 'run-smoke-tests.mjs');
			await spawnNodeStep(
				[testRunnerScript, '--prepared'],
				{ cwd: root, signal: localSignal, stdio }
			);
			gates.tests = { status: 'passed', durationMs: performance.now() - testsStart };

			const jsDuration = performance.now() - jsStart;
			const frontendFingerprintAfter = computeFrontendFingerprint(root);

			// Mutazione accertata tra fingerprint validi: fallimento immediato
			if (
				frontendFingerprintBefore !== null &&
				frontendFingerprintBefore !== frontendFingerprintAfter
			) {
				throw new Error('Mutazione concorrente dei sorgenti rilevata durante l\'esecuzione del gate Frontend.');
			}

			// Salva in cache solo se il fingerprint è certificato
			if (frontendFingerprintBefore !== null && frontendFingerprintAfter !== null) {
				gatesToCache.frontend = {
					fingerprint: frontendFingerprintBefore,
					details: { durationMs: jsDuration }
				};
			}

			gates.frontend = {
				status: 'passed',
				durationMs: jsDuration
			};
		}
	};

	const runRustBranch = async () => {
		// Compilazione Cargo no-run SEMPRE eseguita: Cargo determina freschezza e artifact
		const compiled = await compileRustTests(root, { signal: localSignal, stdio });
		compiledRustArtifacts = compiled.executables;
		compiledRustToolchain = compiled.toolchain;

		const clippy = await runRustClippy(root, { signal: localSignal, stdio });
		gates.clippy = { status: 'passed', durationMs: clippy.durationMs };

		// Fingerprint calcolato includendo gli artifact compilati effettivi e la toolchain
		rustFingerprintBefore = computeRustFingerprint(root, {
			artifacts: compiled.executables,
			toolchain: compiled.toolchain
		});

		const canReuseRust = !full && rustFingerprintBefore !== null && canReuseGate('rust', rustFingerprintBefore, cache);

		if (canReuseRust) {
			const cachedRuntimeMs = cache.gates.rust.runtimeDurationMs ?? 0;
			gates.rust = {
				status: 'reused',
				durationMs: compiled.compileDurationMs,
				compileDurationMs: compiled.compileDurationMs,
				runtimeDurationMs: 0,
				savedDurationMs: cachedRuntimeMs,
				totalDurationMs: compiled.compileDurationMs,
				harnessCount: compiled.executables.length,
				fingerprint: rustFingerprintBefore
			};
		} else {
			// Esecuzione runtime degli harness e dei doctest
			const rustResult = await runRustTests(root, compiled, { signal: localSignal, stdio });
			const rustFingerprintAfter = computeRustFingerprint(root, {
				artifacts: compiled.executables,
				toolchain: compiled.toolchain
			});

			// Mutazione accertata tra fingerprint validi: fallimento immediato
			if (
				rustFingerprintBefore !== null &&
				rustFingerprintBefore !== rustFingerprintAfter
			) {
				throw new Error('Mutazione concorrente dei sorgenti rilevata durante l\'esecuzione del gate Rust.');
			}

			const totalRustDuration = compiled.compileDurationMs + rustResult.runtimeDurationMs;

			// Salva in cache solo se il fingerprint è certificato
			if (rustFingerprintBefore !== null && rustFingerprintAfter !== null) {
				gatesToCache.rust = {
					fingerprint: rustFingerprintBefore,
					details: {
						compileDurationMs: compiled.compileDurationMs,
						runtimeDurationMs: rustResult.runtimeDurationMs,
						totalDurationMs: totalRustDuration,
						harnessCount: rustResult.harnessCount
					}
				};
			}

			gates.rust = {
				status: 'passed',
				durationMs: totalRustDuration,
				compileDurationMs: compiled.compileDurationMs,
				runtimeDurationMs: rustResult.runtimeDurationMs,
				totalDurationMs: totalRustDuration,
				harnessCount: rustResult.harnessCount
			};
		}
	};

	// Aggancio del catch a ciascun ramo per invocare immediatamente abort sui compagni in volo,
	// e successivo Promise.allSettled per garantire drain/chiusura completa di entrambi.
	const branchesWithAbort = [
		runFrontendBranch().catch((err) => {
			abortController.abort();
			throw err;
		}),
		runRustBranch().catch((err) => {
			abortController.abort();
			throw err;
		})
	];

	const results = await Promise.allSettled(branchesWithAbort);

	const failedResult = results.find((r) => r.status === 'rejected');
	if (failedResult) {
		abortController.abort();
		invalidateGates(root, ['rust', 'frontend']);
		failedResult.reason.verification = { ok: false, totalDurationMs: performance.now() - overallStart, gates };
		throw failedResult.reason;
	}

	// =========================================================================
	// Verifica finale di coerenza di tutti i fingerprint (inclusi gate riusati)
	// =========================================================================
	const finalRustFingerprint = computeRustFingerprint(root, {
		artifacts: compiledRustArtifacts || [],
		toolchain: compiledRustToolchain
	});
	const finalFrontendFingerprint = computeFrontendFingerprint(root);

	if (
		rustFingerprintBefore !== null &&
		finalRustFingerprint !== rustFingerprintBefore
	) {
		invalidateGates(root, ['rust']);
		throw new Error('Stato sorgenti Rust mutato dopo la decisione di esecuzione/riuso.');
	}

	if (
		frontendFingerprintBefore !== null &&
		finalFrontendFingerprint !== frontendFingerprintBefore
	) {
		invalidateGates(root, ['frontend']);
		throw new Error('Stato sorgenti Frontend mutato dopo la decisione di esecuzione/riuso.');
	}

	// Salvataggio atomico delle nuove prove solo ad intero preflight verde
	if (Object.keys(gatesToCache).length > 0) {
		localSignal.throwIfAborted();
		writeNightlyCache(root, gatesToCache);
	}

	const totalDurationMs = performance.now() - overallStart;

	return {
		ok: true,
		totalDurationMs,
		gates,
		fingerprints: {
			rust: finalRustFingerprint,
			frontend: finalFrontendFingerprint
		}
	};
}

/**
 * Stampa il riepilogo formattato degli esiti per console o publisher.
 *
 * @param {{
 *   ok: boolean,
 *   totalDurationMs: number,
 *   gates: Record<string, { status: string, durationMs?: number, [key: string]: any }>
 * }} result
 */
export function printSummary(result) {
	console.log('\n========================================');
	console.log('  Riepilogo Esiti Preflight Nightly');
	console.log('========================================');
	for (const [gateName, gate] of Object.entries(result.gates)) {
		const duration = gate.durationMs ? `${(gate.durationMs / 1000).toFixed(2)}s` : '-';
		let statusLabel = gate.status;
		if (gate.status === 'passed') statusLabel = 'PASSATO';
		else if (gate.status === 'reused') statusLabel = 'RIUSATO (prova valida)';
		else if (gate.status === 'skipped') statusLabel = 'SALTATO';

		let extraInfo = '';
		if (gateName === 'rust' && gate.compileDurationMs !== undefined) {
			const compSec = (gate.compileDurationMs / 1000).toFixed(2);
			const runSec = (gate.runtimeDurationMs / 1000).toFixed(2);
			extraInfo = ` [compilazione Cargo: ${compSec}s, runtime: ${runSec}s]`;
		}

		console.log(`  - [${gateName}]: ${statusLabel} (${duration})${extraInfo}`);
	}
	console.log('----------------------------------------');
	console.log(`  Tempo totale: ${(result.totalDurationMs / 1000).toFixed(2)}s`);
	console.log('========================================\n');
}

// =============================================================================
// CLI Entry Point
// =============================================================================

function printCliHelp() {
	console.log(`
Uso: node scripts/verify-nightly.mjs [opzioni]

Opzioni:
  --full                Forza riesecuzione completa ignorando le prove in cache
  --skip-command-check  Salta la verifica live del catalogo comandi omp (emergenza)
  -h, --help            Mostra questo messaggio di aiuto
`);
}

async function cliMain() {
	const args = process.argv.slice(2);
	const opts = {
		full: false,
		skipCommandCheck: false,
		help: false
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--full') {
			opts.full = true;
		} else if (arg === '--skip-command-check') {
			opts.skipCommandCheck = true;
		} else if (arg === '--help' || arg === '-h') {
			opts.help = true;
		} else {
			console.error(`Opzione sconosciuta: ${arg}`);
			process.exit(1);
		}
	}

	if (opts.help) {
		printCliHelp();
		return;
	}

	console.log('\n========================================');
	console.log('  Verifica Preflight Nightly Locale');
	console.log('========================================');
	console.log(`  Modalità:    ${opts.full ? 'FULL (cache disattivata)' : 'INCREMENTALE (riuso runtime sicuro con cache)'}`);
	console.log(`  Comandi omp: ${opts.skipCommandCheck ? 'OMESSO (--skip-command-check)' : 'Verifica live catalogo'}`);
	console.log('========================================\n');

	const abortController = new AbortController();
	for (const sig of ['SIGINT', 'SIGTERM']) {
		process.once(sig, () => {
			console.error(`\nRicevuto segnale ${sig}: arresto in corso dei processi figli...`);
			abortController.abort();
		});
	}

	try {
		const result = await verifyNightly({
			full: opts.full,
			skipCommandCheck: opts.skipCommandCheck,
			signal: abortController.signal,
			stdio: 'inherit'
		});

		printSummary(result);
		process.exit(0);
	} catch (err) {
		if (err.verification) printSummary(err.verification);
		if (abortController.signal.aborted) {
			process.exit(130);
		}
		console.error(`\nERRORE durante la verifica Nightly: ${err?.message || err}\n`);
		process.exit(1);
	}
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectExecution) {
	cliMain();
}
