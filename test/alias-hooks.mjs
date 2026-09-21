// Risoluzione dell'alias `$lib` per gli smoke test eseguiti da Node.
//
// I moduli di produzione importano i messaggi Paraglide con `$lib/paraglide/messages.js`:
// l'alias lo risolve Vite, non Node. Senza questo hook ogni test che importa un modulo
// localizzato fallirebbe con ERR_MODULE_NOT_FOUND, e la suite smeterebbe di coprire
// proprio il codice che l'utente vede tradotto.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = '$lib/';

export async function resolve(specifier, context, nextResolve) {
	if (specifier.startsWith(PREFIX)) {
		let target = join(ROOT, 'src', 'lib', specifier.slice(PREFIX.length));
		if (!existsSync(target) && existsSync(target + '.ts')) {
			target += '.ts';
		}
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
			// fallback
		}
	}
	return nextResolve(specifier, context);
}
