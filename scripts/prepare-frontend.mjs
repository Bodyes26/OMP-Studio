#!/usr/bin/env node
/**
 * Preparazione condivisa del frontend (Gate NL4 / NLC-002 / NLC-005):
 * Compila i messaggi Paraglide e sincronizza SvelteKit (.svelte-kit/tsconfig.json,
 * ambient.d.ts) in sequenza una sola volta prima di verifiche o test.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { killProcessTree } from './nightly-rust.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function execStep(executable, args, { cwd, signal, label, stdio }) {
	signal?.throwIfAborted();
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(executable, args, {
			cwd, stdio, windowsHide: true,
			detached: process.platform !== 'win32',
			env: { ...process.env, FORCE_COLOR: '1' }
		});
		const abort = () => killProcessTree(child);
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) abort();
		child.once('error', (error) => {
			signal?.removeEventListener('abort', abort);
			rejectPromise(error);
		});
		child.once('close', (code, sig) => {
			signal?.removeEventListener('abort', abort);
			if (signal?.aborted) rejectPromise(signal.reason || new Error(`${label} interrotto`));
			else if (code === 0 && !sig) resolvePromise();
			else rejectPromise(new Error(`[prepare-frontend] ${label} fallito (${code ?? sig})`));
		});
	});
}

/**
 * Compila Paraglide e sincronizza SvelteKit in sequenza.
 * @param {string} [root] Radice del progetto.
 * @param {{ signal?: AbortSignal }} [options] Opzioni con eventuale AbortSignal.
 */
export async function prepareFrontend(root, { signal, stdio = 'inherit' } = {}) {
	const targetRoot = root ? resolve(root) : ROOT;

	const paraglideBin = join(targetRoot, 'node_modules', '@inlang', 'paraglide-js', 'bin', 'run.js');
	if (!existsSync(paraglideBin)) {
		throw new Error(`[prepare-frontend] Paraglide non trovato in ${paraglideBin}`);
	}

	const svelteKitBin = join(targetRoot, 'node_modules', '@sveltejs/kit', 'svelte-kit.js');
	if (!existsSync(svelteKitBin)) {
		throw new Error(`[prepare-frontend] svelte-kit non trovato in ${svelteKitBin}`);
	}

	// 1. Paraglide compile
	// Nei controlli ogni processo Node importa i messaggi: migliaia di moduli
	// piccoli moltiplicano l'I/O sotto antivirus. Il bundle produzione resta
	// al plugin Vite, con la sua struttura per messaggio e il tree-shaking.
	await execStep(
		process.execPath,
		[
			paraglideBin,
			'compile',
			'--project', './project.inlang',
			'--outdir', './src/lib/paraglide',
			'--strategy', 'baseLocale',
			'--emit-ts-declarations',
			'--output-structure', 'locale-modules',
			'--disable-async-local-storage'
		],
		{ cwd: targetRoot, signal, stdio, label: 'Paraglide compile' }
	);

	// 2. SvelteKit sync
	await execStep(
		process.execPath,
		[svelteKitBin, 'sync'],
		{ cwd: targetRoot, signal, stdio, label: 'SvelteKit sync' }
	);
}


const isDirectCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectCli) {
	const projectRoot = ROOT;
	try {
		console.log(`[prepare-frontend] Preparazione frontend in ${projectRoot}...`);
		await prepareFrontend(projectRoot);
		console.log('[prepare-frontend] Frontend preparato con successo.');
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
