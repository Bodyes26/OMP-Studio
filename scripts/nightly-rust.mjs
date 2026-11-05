#!/usr/bin/env node
/**
 * OMP Studio — Compilazione ed esecuzione controllata del gate Rust per Nightly.
 *
 * Invarianti (NL5 / NLC-001, 005, 007):
 * 1. Cargo decide la freschezza: la fase di compilazione (`compileRustTests`) viene sempre
 *    eseguita per sfruttare la gestione nativa delle dipendenze e configurazioni esterne di Cargo.
 * 2. Streaming della diagnostica compiler: i messaggi di compilazione vengono inviati in tempo reale
 *    su stderr; in caso di errore, i messaggi renderizzati vengono allegati all'eccezione.
 * 3. Selezione rigorosa degli artifact test harness:
 *    - `msg.profile?.test === true`
 *    - `msg.target?.harness !== false`
 *    - eseguibile situato nella cartella `deps/`.
 *    MAI avviare l'eseguibile desktop dell'app.
 * 4. Runtime (`runRustTests`) separato: esegue gli harness e i doctest con `cwd: src-tauri` e
 *    `CARGO_MANIFEST_DIR: src-tauri`, garantendo piena fedeltà al contesto nativo di cargo test.
 * 5. Terminazione robusta su Windows: `killProcessTree` termina l'intero albero di processi via taskkill.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Termina l'intero albero di processi associato a un ChildProcess.
 * @param {import('node:child_process').ChildProcess} child
 */
export function killProcessTree(child) {
	if (!child || !child.pid) return;
	if (process.platform === 'win32') {
		try {
			const result = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
			if (result.error || result.status !== 0) child.kill('SIGKILL');
		} catch {}
	} else {
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch {}
	}
}

/**
 * Esegue un comando figlio con supporto ad abort, gestione del tree di processi e cattura stdio.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {Record<string, string>} [options.env]
 * @param {AbortSignal} [options.signal]
 * @param {'inherit' | 'pipe' | 'ignore'} [options.stdio]
 * @param {(line: string) => void} [options.onStdoutLine]
 * @returns {Promise<{ code: number }>}
 */
function runSubprocess(cmd, args, options = {}) {
	return new Promise((resolvePromise, rejectPromise) => {
		const { cwd, env, signal, stdio = 'inherit', onStdoutLine } = options;

		if (signal?.aborted) {
			const err = new Error(`Comando '${cmd}' interrotto prima dell'avvio`);
			err.name = 'AbortError';
			return rejectPromise(err);
		}

		const childStdio = onStdoutLine ? ['ignore', 'pipe', 'inherit'] : stdio;

		const child = spawn(cmd, args, {
			cwd,
			env: env ? { ...process.env, ...env } : process.env,
			stdio: childStdio,
			windowsHide: true,
			detached: process.platform !== 'win32'
		});

		let lineBuffer = '';
		if (onStdoutLine && child.stdout) {
			child.stdout.setEncoding('utf8');
			child.stdout.on('data', (chunk) => {
				lineBuffer += chunk.toString('utf8');
				const lines = lineBuffer.split('\n');
				lineBuffer = lines.pop() || '';
				for (const line of lines) {
					const trimmed = line.trim();
					if (trimmed) onStdoutLine(trimmed);
				}
			});
		}

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

			if (lineBuffer.trim() && onStdoutLine) {
				onStdoutLine(lineBuffer.trim());
			}

			if (aborted || signal?.aborted) {
				const err = new Error(`Comando '${cmd}' interrotto da segnale`);
				err.name = 'AbortError';
				return rejectPromise(err);
			}

			if (code !== 0) {
				const formatted = [cmd, ...args].map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ');
				return rejectPromise(new Error(`Comando '${formatted}' fallito con codice di uscita ${code}`));
			}

			resolvePromise({ code });
		});
	});
}

/**
 * Cattura la firma della toolchain nativa (rustc -vV, rustdoc -V, cargo -V, env).
 * Fallimento => null => runtime eseguito full senza salvataggio cache.
 *
 * @param {string} manifestDir
 * @returns {string | null}
 */
function getToolchainSignature(manifestDir) {
	try {
		const rustc = spawnSync('rustc', ['-vV'], { cwd: manifestDir, encoding: 'utf8' });
		if (rustc.status !== 0 || !rustc.stdout) return null;

		const rustdoc = spawnSync('rustdoc', ['--version'], { cwd: manifestDir, encoding: 'utf8' });
		if (rustdoc.status !== 0 || !rustdoc.stdout) return null;

		const cargo = spawnSync('cargo', ['--version'], { cwd: manifestDir, encoding: 'utf8' });
		if (cargo.status !== 0 || !cargo.stdout) return null;

		const relevantEnv = [
			`RUSTFLAGS=${process.env.RUSTFLAGS || ''}`,
			`RUST_TEST_THREADS=${process.env.RUST_TEST_THREADS || ''}`,
			`CARGO_TARGET_DIR=${process.env.CARGO_TARGET_DIR || ''}`,
			`RUSTUP_TOOLCHAIN=${process.env.RUSTUP_TOOLCHAIN || ''}`,
			`LIB=${process.env.LIB || ''}`,
			`INCLUDE=${process.env.INCLUDE || ''}`
		].join(';');

		return [rustc.stdout.trim(), rustdoc.stdout.trim(), cargo.stdout.trim(), relevantEnv].join('\n');
	} catch {
		return null;
	}
}

/** Compila gli harness senza avviare il binario desktop. */
export async function compileRustTests(root, options = {}) {
	const signal = options.signal;
	const stdio = options.stdio || 'inherit';

	const manifestDir = join(root, 'src-tauri');
	const manifestPath = join(manifestDir, 'Cargo.toml');
	if (!existsSync(manifestPath)) {
		throw new Error(`Manifest Cargo non trovato: ${manifestPath}`);
	}
	if (/^\s*harness\s*=\s*false\b/m.test(readFileSync(manifestPath, 'utf8'))) {
		throw new Error('Harness Cargo personalizzato non supportato: esecuzione automatica bloccata per non avviare il programma desktop.');
	}

	const rustEnv = {
		CARGO_MANIFEST_DIR: manifestDir
	};

	const compileStartTime = performance.now();
	const harnessExecutables = new Set();
	const compileErrors = [];

	try {
		await runSubprocess(
			'cargo',
			['test', '--manifest-path', 'Cargo.toml', '--no-run', '--message-format=json'],
			{
				cwd: manifestDir,
				env: rustEnv,
				signal,
				onStdoutLine: (line) => {
					try {
						const msg = JSON.parse(line);
						if (msg.reason === 'compiler-message' && msg.message?.rendered) {
							if (stdio !== 'ignore') {
								process.stderr.write(msg.message.rendered);
							}
							if (msg.message.level === 'error') {
								compileErrors.push(msg.message.rendered);
							}
						} else if (msg.reason === 'compiler-artifact') {
							const isTestProfile = msg.profile?.test === true;
							const hasHarness = msg.target?.harness !== false;
							const hasExecutable = typeof msg.executable === 'string' && msg.executable.length > 0;

							if (isTestProfile && hasHarness && hasExecutable) {
								const normalizedExe = msg.executable.replace(/\\/g, '/');
								if (normalizedExe.includes('/deps/')) {
									harnessExecutables.add(msg.executable);
								}
							}
						}
					} catch {}
				}
			}
		);
	} catch (err) {
		const cause = compileErrors.length > 0 ? `\n${compileErrors.join('\n')}` : `\n${err?.message || err}`;
		throw new Error(`Compilazione test Rust fallita:${cause}`);
	}

	const compileDurationMs = performance.now() - compileStartTime;

	if (harnessExecutables.size === 0) {
		throw new Error(
			'Nessun artefatto test harness valido rilevato in `target/debug/deps/`. ' +
			'Verifica la configurazione del manifest src-tauri/Cargo.toml.'
		);
	}

	const toolchain = getToolchainSignature(manifestDir);

	return {
		executables: Array.from(harnessExecutables),
		compileDurationMs,
		toolchain
	};
}

/**
 * @param {string} root Radice del workspace
 * @param {{ executables: string[] }} compiled Risultato di compileRustTests
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {'inherit' | 'pipe' | 'ignore'} [options.stdio]
 * @returns {Promise<{ runtimeDurationMs: number, harnessCount: number, doctestsExecuted: boolean }>}
 */
export async function runRustTests(root, compiled, options = {}) {
	const signal = options.signal;
	const stdio = options.stdio || 'inherit';

	const manifestDir = join(root, 'src-tauri');
	const rustEnv = {
		CARGO_MANIFEST_DIR: manifestDir
	};

	const runtimeStartTime = performance.now();

	for (const harnessExe of compiled.executables) {
		if (signal?.aborted) {
			const err = new Error('Esecuzione test Rust interrotta prima di completare tutti gli harness');
			err.name = 'AbortError';
			throw err;
		}

		await runSubprocess(harnessExe, [], {
			cwd: manifestDir,
			env: rustEnv,
			signal,
			stdio
		});
	}

	if (signal?.aborted) {
		const err = new Error('Esecuzione doctest Rust interrotta');
		err.name = 'AbortError';
		throw err;
	}

	await runSubprocess(
		'cargo',
		['test', '--manifest-path', 'Cargo.toml', '--doc'],
		{
			cwd: manifestDir,
			env: rustEnv,
			signal,
			stdio
		}
	);

	const runtimeDurationMs = performance.now() - runtimeStartTime;

	return {
		runtimeDurationMs,
		harnessCount: compiled.executables.length,
		doctestsExecuted: true
	};
}

/**
 * Helper unificato che compila ed esegue il gate Rust completo.
 *
 * @param {string} root
 * @param {object} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   compileDurationMs: number,
 *   runtimeDurationMs: number,
 *   totalDurationMs: number,
 *   harnessCount: number,
 *   doctestsExecuted: boolean
 * }>}
 */
export async function runRustGate(root, options = {}) {
	const compiled = await compileRustTests(root, options);
	const runtimeRes = await runRustTests(root, compiled, options);

	return {
		ok: true,
		compileDurationMs: compiled.compileDurationMs,
		runtimeDurationMs: runtimeRes.runtimeDurationMs,
		totalDurationMs: compiled.compileDurationMs + runtimeRes.runtimeDurationMs,
		harnessCount: runtimeRes.harnessCount,
		doctestsExecuted: runtimeRes.doctestsExecuted
	};
}
