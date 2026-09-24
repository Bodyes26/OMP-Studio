// Compiler del Laboratorio prototipi.
//
// Compila sorgenti multifile React/TSX in bundle ESM eseguibile nell'anteprima.
// Invarianti:
//  1. Ingresso: src/main.tsx con fallback (src/main.ts, src/index.tsx, src/index.ts, src/App.tsx);
//  2. Output ESM con JSX automatico (react/jsx-runtime);
//  3. File locali risolti dal VFS dello snapshot, dipendenze bare esterne con import map;
//  4. Dipendenze verificate rispetto a package.json (devono essere presenti e con versione esatta);
//  5. CSS aggregato in tag <style type="text/tailwindcss"> con rimozione di @import "tailwindcss".

import * as esbuild from 'esbuild-wasm';
import {
	buildEsmShUrl,
	isExactVersion,
	LOCAL_VENDOR_SPECIFIERS,
	parsePackageSpecifier
} from './catalog.ts';
import type { LabFile, LabPreviewError } from './types.ts';

export interface LabCompileResult {
	ok: boolean;
	errors: LabPreviewError[];
	compiledJs: string;
	compiledCss: string;
	importMap: Record<string, string>;
}

export function normalizeVfsPath(rawPath: string): string {
	const forward = rawPath.replace(/\\/g, '/');
	return forward.startsWith('/') ? forward : '/' + forward;
}

const ENTRY_CANDIDATES = [
	'/src/main.tsx',
	'/src/main.ts',
	'/src/index.tsx',
	'/src/index.ts',
	'/src/App.tsx'
];

const EXTENSION_CANDIDATES = ['.tsx', '.ts', '.jsx', '.js', '.json', '.css'] as const;

let esbuildInitPromise: Promise<void> | null = null;

export async function ensureEsbuildInitialized(wasmUrl = '/lab/esbuild.wasm'): Promise<void> {
	if (esbuildInitPromise) return esbuildInitPromise;

	esbuildInitPromise = (async () => {
		try {
			const maybeGlobal: Record<string, unknown> = globalThis;
			const hasNodeProcess = 'process' in maybeGlobal && typeof maybeGlobal.process === 'object' && maybeGlobal.process !== null;
			if (typeof window === 'undefined' && hasNodeProcess) {
				// In ambiente Node.js esbuild-wasm si inizializza senza opzioni
				await esbuild.initialize({});
			} else {
				// In ambiente browser / Web Worker serve wasmURL
				await esbuild.initialize({
					wasmURL: wasmUrl
				});
			}
		} catch (err: unknown) {
			// Se gia' inizializzato (chiamate parallele o ricarica), non e' un errore bloccante
			if (err instanceof Error && err.message.includes('initialize')) {
				return;
			}
			throw err;
		}
	})();

	return esbuildInitPromise;
}
function stripTailwindImports(css: string): string {
	return css.replace(/@import\s+["']tailwindcss(?:\/[^"']*)?["']\s*;?/g, '').trim();
}

/**
 * Compila il prototipo memorizzato nello snapshot VFS in un bundle ESM
 * e genera l'import map associata.
 */
export async function compileLabPrototype(files: LabFile[]): Promise<LabCompileResult> {
	const errors: LabPreviewError[] = [];
	const importMap: Record<string, string> = { ...LOCAL_VENDOR_SPECIFIERS };
	const vfsMap = new Map<string, string>();

	for (const file of files) {
		vfsMap.set(normalizeVfsPath(file.path), file.content);
	}

	// 1. Parsing package.json
	let dependencies: Record<string, string> = {};
	const packageJsonRaw = vfsMap.get('/package.json');
	if (packageJsonRaw) {
		try {
			const parsed = JSON.parse(packageJsonRaw);
			if (parsed && typeof parsed.dependencies === 'object' && parsed.dependencies !== null) {
				dependencies = parsed.dependencies as Record<string, string>;
			}
		} catch {
			errors.push({
				kind: 'compile',
				message: 'Il file package.json contiene sintassi JSON non valida.'
			});
		}
	}

	// 2. Ricerca entry point
	let entryPath: string | null = null;
	for (const candidate of ENTRY_CANDIDATES) {
		if (vfsMap.has(candidate)) {
			entryPath = candidate;
			break;
		}
	}

	if (!entryPath) {
		errors.push({
			kind: 'compile',
			message:
				'Nessun file di ingresso trovato nel prototipo. Cercati: ' +
				ENTRY_CANDIDATES.map((c) => c.slice(1)).join(', ')
		});
		return {
			ok: false,
			errors,
			compiledJs: '',
			compiledCss: '',
			importMap
		};
	}

	// 3. Raccoglie CSS iniziale
	const cssParts: string[] = [];
	for (const [path, content] of vfsMap.entries()) {
		if (path.endsWith('.css')) {
			const stripped = stripTailwindImports(content);
			if (stripped) cssParts.push(stripped);
		}
	}

	// 4. Plugin VFS per esbuild
	const vfsPlugin: esbuild.Plugin = {
		name: 'lab-vfs-resolver',
		setup(build) {
			// Risolve file locali
			build.onResolve({ filter: /^\.{1,2}\/|^\// }, (args) => {
				const importer = args.importer || '/';
				const importerDir = importer.slice(0, importer.lastIndexOf('/') + 1) || '/';
				let targetPath = args.path.startsWith('/')
					? args.path
					: normalizeVfsPath(importerDir + args.path);

				// Normalizza segmenti ./ e ../
				const segments = targetPath.split('/').filter(Boolean);
				const resolvedSegments: string[] = [];
				for (const seg of segments) {
					if (seg === '.') continue;
					if (seg === '..') {
						resolvedSegments.pop();
					} else {
						resolvedSegments.push(seg);
					}
				}
				targetPath = '/' + resolvedSegments.join('/');

				// Controlla corrispondenza esatta
				if (vfsMap.has(targetPath)) {
					return { path: targetPath, namespace: 'vfs' };
				}

				// Controlla estensioni candidate
				for (const ext of EXTENSION_CANDIDATES) {
					if (vfsMap.has(targetPath + ext)) {
						return { path: targetPath + ext, namespace: 'vfs' };
					}
				}

				// Controlla directory con index
				for (const ext of EXTENSION_CANDIDATES) {
					const indexCandidate = targetPath + '/index' + ext;
					if (vfsMap.has(indexCandidate)) {
						return { path: indexCandidate, namespace: 'vfs' };
					}
				}

				return {
					errors: [
						{
							text: `Modulo non trovato nel prototipo: ${args.path}`,
							location: {
								file: args.importer,
								line: 1,
								column: 0,
								length: 0,
								lineText: '',
								namespace: 'vfs',
								suggestion: ''
							}
						}
					]
				};
			});

			// Risolve bare specifiers
			build.onResolve({ filter: /^[^./]/ }, (args) => {
				const specifier = args.path;

				// Vendor React locale
				if (Object.prototype.hasOwnProperty.call(LOCAL_VENDOR_SPECIFIERS, specifier)) {
					importMap[specifier] = LOCAL_VENDOR_SPECIFIERS[specifier];
					return { path: specifier, external: true };
				}

				const { pkg, subpath } = parsePackageSpecifier(specifier);
				const declaredVersion = dependencies[pkg];

				if (!declaredVersion) {
					errors.push({
						kind: 'compile',
						message: `Il pacchetto "${pkg}" non e' presente in package.json "dependencies". Aggiungilo con una versione esatta.`,
						file: args.importer || 'src/main.tsx'
					});
					return { path: specifier, external: true };
				}

				if (!isExactVersion(declaredVersion)) {
					errors.push({
						kind: 'compile',
						message: `Il pacchetto "${pkg}" ha una versione non esatta ("${declaredVersion}"). Fissa una versione esatta (es. "1.2.3") senza ^, ~ o intervalli.`,
						file: args.importer || 'src/main.tsx'
					});
					return { path: specifier, external: true };
				}

				importMap[specifier] = buildEsmShUrl(pkg, declaredVersion, subpath);
				return { path: specifier, external: true };
			});

			// Carica il contenuto dei file dal VFS
			build.onLoad({ filter: /.*/, namespace: 'vfs' }, (args) => {
				const content = vfsMap.get(args.path);
				if (content === undefined) {
					return { errors: [{ text: `Contenuto mancante per ${args.path}` }] };
				}

				if (args.path.endsWith('.css')) {
					const stripped = stripTailwindImports(content);
					if (stripped && !cssParts.includes(stripped)) {
						cssParts.push(stripped);
					}
					return { contents: '', loader: 'js' };
				}

				if (args.path.endsWith('.json')) {
					return { contents: content, loader: 'json' };
				}

				if (args.path.endsWith('.tsx')) {
					return { contents: content, loader: 'tsx' };
				}

				if (args.path.endsWith('.ts')) {
					return { contents: content, loader: 'ts' };
				}

				if (args.path.endsWith('.jsx')) {
					return { contents: content, loader: 'jsx' };
				}

				if (args.path.endsWith('.js')) {
					return { contents: content, loader: 'js' };
				}

				if (args.path.endsWith('.svg')) {
					const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(content)}`;
					return { contents: `export default ${JSON.stringify(dataUrl)};`, loader: 'js' };
				}

				return { contents: content, loader: 'text' };
			});
		}
	};

	try {
		await ensureEsbuildInitialized();
		const result = await esbuild.build({
			entryPoints: [entryPath],
			bundle: true,
			format: 'esm',
			jsx: 'automatic',
			target: 'es2022',
			write: false,
			plugins: [vfsPlugin]
		});

		if (result.errors.length > 0) {
			for (const err of result.errors) {
				errors.push({
					kind: 'compile',
					message: err.text,
					file: err.location?.file ?? null,
					line: err.location?.line ?? null,
					column: err.location?.column ?? null
				});
			}
		}

		if (errors.length > 0) {
			return {
				ok: false,
				errors,
				compiledJs: '',
				compiledCss: cssParts.join('\n\n'),
				importMap
			};
		}

		const compiledJs = result.outputFiles?.[0]?.text ?? '';
		return {
			ok: true,
			errors: [],
			compiledJs,
			compiledCss: cssParts.join('\n\n'),
			importMap
		};
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		errors.push({
			kind: 'compile',
			message
		});
		return {
			ok: false,
			errors,
			compiledJs: '',
			compiledCss: cssParts.join('\n\n'),
			importMap
		};
	}
}

/**
 * Esegue la compilazione nel Web Worker dedicato per non bloccare il thread UI.
 * Se l'ambiente non supporta Worker, ripiega sulla compilazione diretta.
 */
export async function compileLabPrototypeInWorker(
	files: LabFile[],
	options?: { timeoutMs?: number }
): Promise<LabCompileResult> {
	if (typeof Worker === 'undefined') {
		return compileLabPrototype(files);
	}

	const timeoutMs = options?.timeoutMs ?? 15_000;

	const { promise, resolve } = Promise.withResolvers<LabCompileResult>();
	let finished = false;
	let worker: Worker | null = null;
	let timer: number | null = null;

	const cleanup = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		if (worker) {
			worker.terminate();
			worker = null;
		}
	};

	try {
		worker = new Worker(new URL('./compiler-worker.ts', import.meta.url), {
			type: 'module'
		});

		timer = window.setTimeout(() => {
			if (finished) return;
			finished = true;
			cleanup();
			resolve({
				ok: false,
				errors: [
					{
						kind: 'compile',
						message: `Compilazione scaduta dopo ${timeoutMs}ms.`
					}
				],
				compiledJs: '',
				compiledCss: '',
				importMap: { ...LOCAL_VENDOR_SPECIFIERS }
			});
		}, timeoutMs);

		worker.onmessage = (event: MessageEvent<LabCompileResult>) => {
			if (finished) return;
			finished = true;
			cleanup();
			resolve(event.data);
		};

		worker.onerror = (err) => {
			if (finished) return;
			finished = true;
			cleanup();
			resolve({
				ok: false,
				errors: [
					{
						kind: 'compile',
						message: err.message || 'Errore nel Web Worker di compilazione.'
					}
				],
				compiledJs: '',
				compiledCss: '',
				importMap: { ...LOCAL_VENDOR_SPECIFIERS }
			});
		};

		worker.postMessage(files);
	} catch {
		cleanup();
		return compileLabPrototype(files);
	}

	return promise;
}
