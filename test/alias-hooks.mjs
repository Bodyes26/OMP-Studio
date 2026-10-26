// Node risolve #lib tramite package.json; l'hook serve solo all'alias del
// protocollo condiviso e agli import relativi TypeScript senza estensione.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function resolve(specifier, context, nextResolve) {
	if (specifier === '$remote-protocol') {
		const target = join(ROOT, 'relay', 'src', 'protocol.ts');
		return nextResolve(pathToFileURL(target).href, context);
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
