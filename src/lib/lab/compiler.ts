// Compiler del Laboratorio prototipi.
//
// Compila sorgenti multifile React/TSX in bundle isolato eseguibile nel renderer.
// Implementa il resolver a VFS chiuso verificato nella prova tecnica (Step 8):
//  1. Allowlist del catalogo: pacchetti non in catalogo o moduli node:* respinti;
//  2. Confinamento VFS: import relativi o assoluti che escono dal prototipo respinti;
//  3. Gestione multifile: TSX, TS, JSX, JS, CSS, JSON e asset (SVG/immagini dataurl);
//  4. Esecuzione su worker per non bloccare il thread UI principale.

import * as esbuild from 'esbuild-wasm';
import {
	getCatalogGlobalTarget,
	isAllowedImportSpecifier,
	validatePrototypeDependencies
} from './catalog.ts';

export interface LabCompileRequest {
	/** Punto di ingresso virtuale. Predefinito: '/src/main.tsx' */
	readonly entryPoint?: string;
	/**
	 * Mappa dei file virtuali del prototipo (es. {'/src/App.tsx': '...', '/assets/logo.svg': '...'}).
	 * Accetta percorsi con o senza slash iniziale.
	 */
	readonly files: Readonly<Record<string, string>> | ReadonlyMap<string, string>;
	/** Minificazione del codice generato. Predefinito: false */
	readonly minify?: boolean;
	/** Inclusione di sourcemap inline. Predefinito: false */
	readonly sourceMap?: boolean;
	/** Eventuali dipendenze dichiarate da validare preventivamente */
	readonly declaredDependencies?: Readonly<Record<string, string>>;
}

export interface LabCompileResult {
	readonly ok: boolean;
	readonly js?: string;
	readonly css?: string;
	readonly errors?: readonly string[];
	readonly warnings?: readonly string[];
	readonly elapsedMs: number;
	readonly outputBytes?: number;
}

/**
 * Normalizza un percorso all'interno del VFS del prototipo.
 * Sostituisce i backslash Windows e assicura il prefisso '/'.
 */
export function normalizeVfsPath(rawPath: string): string {
	const forward = rawPath.replace(/\\/g, '/').trim();
	if (forward.startsWith('/')) {
		return forward;
	}
	return '/' + forward;
}

/**
 * Risolve un import relativo o assoluto rispetto al file che importa.
 * Ritorna null se l'import tenta di evadere dal perimetro VFS (/src/ o /assets/).
 */
export function resolveVirtualImportPath(specifier: string, importerPath: string): string | null {
	const base = importerPath.startsWith('/') ? importerPath : '/' + importerPath;
	// Usiamo l'URL parser come barriera di normalizzazione deterministica
	const resolved = new URL(specifier, 'https://lab.virtual' + base).pathname;

	// Invariante di sicurezza: consentiti solo /src/ e /assets/ del prototipo
	if (!resolved.startsWith('/src/') && !resolved.startsWith('/assets/')) {
		return null;
	}

	return resolved;
}

const EXTENSION_CANDIDATES = [
	'',
	'.tsx',
	'.ts',
	'.jsx',
	'.js',
	'/index.tsx',
	'/index.ts',
	'/index.jsx',
	'/index.js'
] as const;

/**
 * Crea il plugin esbuild con resolver a VFS chiuso e shims del catalogo fidato.
 */
export function createClosedVfsPlugin(
	vfsFiles: ReadonlyMap<string, string>
): esbuild.Plugin {
	return {
		name: 'closed-vfs',
		setup(build) {
			// 1. Risoluzione moduli (onResolve)
			build.onResolve({ filter: /.*/ }, (args) => {
				// Pacchetti autorizzati dal catalogo
				if (isAllowedImportSpecifier(args.path)) {
					return { path: args.path, namespace: 'catalog' };
				}

				// Punto di ingresso
				if (args.kind === 'entry-point') {
					const entry = normalizeVfsPath(args.path);
					if (!vfsFiles.has(entry)) {
						return {
							errors: [
								{
									text: `Punto di ingresso non trovato nel VFS del prototipo: '${args.path}'`
								}
							]
						};
					}
					return { path: entry, namespace: 'vfs' };
				}

				// Pacchetti npm o builtin (specifier non relativi e non assoluti)
				if (!args.path.startsWith('.') && !args.path.startsWith('/')) {
					return {
						errors: [
							{
								text: `Pacchetto non autorizzato nel catalogo del Laboratorio: '${args.path}'`
							}
						]
					};
				}

				// Import relativo o assoluto nel prototipo: verifica confinamento VFS
				const resolved = resolveVirtualImportPath(args.path, args.importer);
				if (!resolved) {
					return {
						errors: [
							{
								text: `Import fuori dal VFS del prototipo non consentito: '${args.path}'`
							}
						]
					};
				}

				// Ricerca file con estensioni candidate
				for (const ext of EXTENSION_CANDIDATES) {
					const candidate = resolved + ext;
					if (vfsFiles.has(candidate)) {
						return { path: candidate, namespace: 'vfs' };
					}
				}

				return {
					errors: [
						{
							text: `File non trovato nel VFS del prototipo: '${args.path}' (risolto in: '${resolved}')`
						}
					]
				};
			});

			// 2. Caricamento moduli di catalogo (namespace: 'catalog')
			build.onLoad({ filter: /.*/, namespace: 'catalog' }, (args) => {
				const globalTarget = getCatalogGlobalTarget(args.path);
				if (!globalTarget) {
					return {
						errors: [{ text: `Target globale mancante per il modulo di catalogo: '${args.path}'` }]
					};
				}

				// Esposizione CommonJS compatibile con __toESM per import sia named che default
				const contents = `module.exports = ${globalTarget};`;
				return {
					contents,
					loader: 'js'
				};
			});

			// 3. Caricamento file del prototipo (namespace: 'vfs')
			build.onLoad({ filter: /.*/, namespace: 'vfs' }, (args) => {
				const content = vfsFiles.get(args.path);
				if (content === undefined) {
					return {
						errors: [{ text: `Contenuto non disponibile nel VFS per '${args.path}'` }]
					};
				}

				const ext = args.path.split('.').pop()?.toLowerCase() ?? '';

				let loader: esbuild.Loader = 'text';
				if (ext === 'tsx') loader = 'tsx';
				else if (ext === 'ts') loader = 'ts';
				else if (ext === 'jsx') loader = 'jsx';
				else if (ext === 'js') loader = 'js';
				else if (ext === 'css') loader = 'css';
				else if (ext === 'json') loader = 'json';
				else if (
					ext === 'svg' ||
					ext === 'png' ||
					ext === 'jpg' ||
					ext === 'jpeg' ||
					ext === 'gif' ||
					ext === 'webp' ||
					ext === 'avif' ||
					ext === 'ico'
				) {
					loader = 'dataurl';
				}

				return {
					contents: content,
					loader
				};
			});
		}
	};
}

/**
 * Converte il dizionario dei file in ingresso in una Map normalizzata con chiavi '/...'.
 */
function normalizeFilesMap(
	input: Readonly<Record<string, string>> | ReadonlyMap<string, string>
): Map<string, string> {
	const map = new Map<string, string>();
	if (input instanceof Map) {
		for (const [path, content] of input.entries()) {
			map.set(normalizeVfsPath(path), content);
		}
	} else {
		for (const [path, content] of Object.entries(input)) {
			map.set(normalizeVfsPath(path), content);
		}
	}
	return map;
}

let esbuildInitialized = false;

/**
 * Assicura l'inizializzazione di esbuild-wasm se richiesto (es. ambiente browser).
 */
export async function ensureEsbuildInitialized(wasmUrl?: string): Promise<void> {
	if (esbuildInitialized) return;

	// In ambiente Node esbuild si inizializza da solo all'import;
	// in ambiente browser richiede initialize() con wasmURL o wasmModule
	const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
	if (!isNode && typeof window !== 'undefined') {
		await esbuild.initialize({
			wasmURL: wasmUrl ?? '/lab/esbuild.wasm'
		});
	}
	esbuildInitialized = true;
}

/**
 * Compila il prototipo React con esbuild-wasm e resolver a VFS chiuso.
 */
export async function compileLabPrototype(
	request: LabCompileRequest
): Promise<LabCompileResult> {
	const started = performance.now();
	await ensureEsbuildInitialized();
	// Validazione preventiva delle dipendenze dichiarate se fornite
	if (request.declaredDependencies) {
		const validation = validatePrototypeDependencies(request.declaredDependencies);
		if (!validation.ok) {
			return {
				ok: false,
				errors: validation.errors,
				elapsedMs: Math.round(performance.now() - started)
			};
		}
	}

	const vfsMap = normalizeFilesMap(request.files);
	const entryPoint = normalizeVfsPath(request.entryPoint ?? '/src/main.tsx');

	const plugin = createClosedVfsPlugin(vfsMap);

	try {
		const result = await esbuild.build({
			entryPoints: [entryPoint],
			bundle: true,
			write: false,
			outdir: '/out',
			format: 'iife',
			platform: 'browser',
			jsx: 'transform',
			minify: request.minify ?? false,
			sourcemap: request.sourceMap ? 'inline' : false,
			plugins: [plugin],
			logLevel: 'silent',
			define: {
				'process.env.NODE_ENV': '"production"'
			}
		});

		const jsFile = result.outputFiles.find((f) => f.path.endsWith('.js'));
		const cssFile = result.outputFiles.find((f) => f.path.endsWith('.css'));

		const js = jsFile?.text ?? '';
		const css = cssFile?.text ?? '';

		const warnings = result.warnings.map((w) => w.text);

		return {
			ok: true,
			js,
			css,
			warnings: warnings.length > 0 ? warnings : undefined,
			elapsedMs: Math.round(performance.now() - started),
			outputBytes: js.length + css.length
		};
	} catch (error) {
		const err = error as esbuild.BuildFailure;
		const errors = err.errors?.length
			? err.errors.map((e) => e.text)
			: [String(error)];

		return {
			ok: false,
			errors,
			elapsedMs: Math.round(performance.now() - started)
		};
	}
}

interface NodeWorkerInstance {
	on(event: 'message', cb: (msg: unknown) => void): void;
	on(event: 'error', cb: (err: Error) => void): void;
	terminate(): Promise<number>;
}

interface NodeWorkerConstructor {
	new (
		scriptOrPath: string,
		options: { eval?: boolean; workerData?: unknown }
	): NodeWorkerInstance;
}

/**
 * Esegue la compilazione all'interno di un worker isolato (worker thread in Node
 * o Web Worker nel browser) per garantire la responsivita' del thread UI di Studio.
 */
export async function compileLabPrototypeInWorker(
	request: LabCompileRequest,
	options?: { timeoutMs?: number }
): Promise<LabCompileResult> {
	const timeout = options?.timeoutMs ?? 20000;

	// Ispezione sicura per Node.js compatibile sia con browser che server
	const g = typeof globalThis !== 'undefined' ? (globalThis as Record<string, unknown>) : {};
	const proc = g['process'] as { versions?: { node?: unknown } } | undefined;
	const isNodeRuntime = typeof proc?.versions?.node === 'string';

	// In ambiente Node.js / test usiamo node:worker_threads
	if (isNodeRuntime) {
		const workerModuleName = 'node:worker_threads';
		const workerModule = (await import(/* @vite-ignore */ workerModuleName)) as {
			Worker: NodeWorkerConstructor;
		};
		const WorkerConstructor = workerModule.Worker;
		const { promise, resolve } = Promise.withResolvers<LabCompileResult>();

		let settled = false;

		const workerCode = `
			const { parentPort, workerData } = require('node:worker_threads');
			const { compileLabPrototype } = require('./src/lib/lab/compiler.ts');

			(async () => {
				try {
					const result = await compileLabPrototype(workerData);
					parentPort.postMessage({ ok: true, result });
				} catch (err) {
					parentPort.postMessage({ ok: false, error: String(err) });
				}
			})();
		`;

		const plainFiles: Record<string, string> = {};
		if (request.files instanceof Map) {
			for (const [k, v] of request.files.entries()) {
				plainFiles[k] = v;
			}
		} else {
			Object.assign(plainFiles, request.files);
		}

		const worker = new WorkerConstructor(workerCode, {
			eval: true,
			workerData: {
				...request,
				files: plainFiles
			}
		});

		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				worker.terminate().catch(() => {});
				resolve({
					ok: false,
					errors: [`Compilazione nel worker interrotta per timeout (${timeout} ms)`],
					elapsedMs: timeout
				});
			}
		}, timeout);

		worker.on('message', (rawMsg: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			worker.terminate().catch(() => {});
			const msg = rawMsg as { ok: boolean; result?: LabCompileResult; error?: string };
			if (msg.ok && msg.result) {
				resolve(msg.result);
			} else {
				resolve({
					ok: false,
					errors: [msg.error ?? 'Errore sconosciuto nel worker'],
					elapsedMs: 0
				});
			}
		});

		worker.on('error', (err: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			worker.terminate().catch(() => {});
			resolve({
				ok: false,
				errors: [`Guasto nel worker di compilazione: ${err.message}`],
				elapsedMs: 0
			});
		});

		return promise;
	}

	// In ambiente Webview/browser
	if (typeof Worker !== 'undefined') {
		const { promise, resolve } = Promise.withResolvers<LabCompileResult>();
		let settled = false;

		const worker = new Worker(new URL('./compiler-worker.ts', import.meta.url), {
			type: 'module'
		});

		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				worker.terminate();
				resolve({
					ok: false,
					errors: [`Compilazione nel Web Worker interrotta per timeout (${timeout} ms)`],
					elapsedMs: timeout
				});
			}
		}, timeout);

		worker.onmessage = (e: MessageEvent<LabCompileResult>) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			worker.terminate();
			resolve(e.data);
		};

		worker.onerror = (e) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			worker.terminate();
			resolve({
				ok: false,
				errors: [`Errore nel Web Worker: ${e.message}`],
				elapsedMs: 0
			});
		};

		worker.postMessage(request);
		return promise;
	}

	// Fallback se nessun worker e' disponibile
	return compileLabPrototype(request);
}
