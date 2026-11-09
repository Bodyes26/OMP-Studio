// Solo la regressione del riduttore importa l'intera sessione: usa la
// compilazione SSR reale, con derived differiti invece dello shim identita'.
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, compileModule } from 'svelte/compiler';
import ts from 'typescript';

export async function resolve(specifier, context, nextResolve) {
	if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
		const target = new URL(specifier, context.parentURL);
		const path = fileURLToPath(target);
		if (existsSync(path) && statSync(path).isDirectory() && existsSync(`${path}.ts`)) {
			return nextResolve(`${target.href}.ts`, context);
		}
	}
	return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
	if (url.endsWith('.svelte.ts') || url.endsWith('.svelte')) {
		const filename = fileURLToPath(url);
		const source = await readFile(filename, 'utf8');
		const code = url.endsWith('.svelte.ts')
			? compileModule(ts.transpileModule(source, { compilerOptions: {
				target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
				verbatimModuleSyntax: true
			} }).outputText, { filename, generate: 'server' }).js.code
			: compile(source, { filename, generate: 'server' }).js.code;
		return { format: 'module', shortCircuit: true, source: code };
	}
	return nextLoad(url, context);
}
