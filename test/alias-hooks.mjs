// Node risolve #lib tramite package.json; l'hook serve solo all'alias del
// protocollo condiviso e agli import relativi TypeScript senza estensione.
import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function resolve(specifier, context, nextResolve) {
	if (specifier === '$remote-protocol') {
		const target = join(ROOT, 'relay', 'src', 'protocol.ts');
		return nextResolve(pathToFileURL(target).href, context);
	}
	// Vite alias `#lib` -> src/lib. Sotto relay/ Node usa relay/package.json,
	// che non dichiara l'import, e i moduli della PWA non si caricano nei test.
	if (specifier.startsWith('#lib/') && context.parentURL?.startsWith('file:')) {
		try {
			const parent = fileURLToPath(context.parentURL);
			const relayRoot = join(ROOT, 'relay') + sep;
			if (parent.startsWith(relayRoot)) {
				const rel = specifier.slice('#lib/'.length);
				const base = join(ROOT, 'src', 'lib', rel);
				const stripped = base.replace(/\.js$/, '');
				const candidate = existsSync(base)
					? base
					: existsSync(`${base}.ts`)
						? `${base}.ts`
						: existsSync(`${stripped}.ts`)
							? `${stripped}.ts`
							: existsSync(`${stripped}.js`)
								? `${stripped}.js`
								: null;
				if (candidate) return nextResolve(pathToFileURL(candidate).href, context);
			}
		} catch {
			// Gli URL non-file restano al resolver nativo.
		}
	}
	if (specifier.startsWith('.') && context.parentURL) {
		try {
			const parentDir = dirname(fileURLToPath(context.parentURL));
			const target = join(parentDir, specifier);
			if (!existsSync(target) && existsSync(target + '.ts')) {
				return nextResolve(pathToFileURL(target + '.ts').href, context);
			}
		} catch {
			// Gli URL non-file restano al resolver nativo.
		}
	}
	return nextResolve(specifier, context);
}
