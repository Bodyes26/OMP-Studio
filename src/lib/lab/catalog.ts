// Gestione e risoluzione delle dipendenze per l'anteprima del Laboratorio prototipi.
//
// Invarianti:
//  1. React 19 e React-DOM sono serviti localmente sotto `/_vendor/`;
//  2. Qualsiasi altra dipendenza bare DEVE essere dichiarata in `package.json`
//     nelle "dependencies" con versione esatta (nessun intervallo ^, ~, >, < o latest);
//  3. L'anteprima risolve le dipendenze esterne tramite import map su esm.sh con ?external=react,react-dom.

export const LOCAL_VENDOR_SPECIFIERS: Readonly<Record<string, string>> = Object.freeze({
	react: '/_vendor/react.js',
	'react/jsx-runtime': '/_vendor/react-jsx-runtime.js',
	'react/jsx-dev-runtime': '/_vendor/react-jsx-dev-runtime.js',
	'react-dom': '/_vendor/react-dom.js',
	'react-dom/client': '/_vendor/react-dom-client.js'
});

const EXACT_SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Verifica se una stringa di versione e' esatta (semver puro senza ^, ~, wildcard o tag). */
export function isExactVersion(version: string): boolean {
	const trimmed = version.trim();
	return EXACT_SEMVER_REGEX.test(trimmed);
}

export interface ParsedPackageSpecifier {
	pkg: string;
	subpath: string;
}

/** Estrae il nome pacchetto npm (anche scoped @scope/pkg) e l'eventuale subpath. */
export function parsePackageSpecifier(specifier: string): ParsedPackageSpecifier {
	if (specifier.startsWith('@')) {
		const parts = specifier.split('/');
		if (parts.length >= 2) {
			const pkg = `${parts[0]}/${parts[1]}`;
			const subpath = parts.length > 2 ? `/${parts.slice(2).join('/')}` : '';
			return { pkg, subpath };
		}
	}
	const slashIndex = specifier.indexOf('/');
	if (slashIndex !== -1) {
		return {
			pkg: specifier.slice(0, slashIndex),
			subpath: specifier.slice(slashIndex)
		};
	}
	return { pkg: specifier, subpath: '' };
}

/** Costruisce l'URL di esm.sh per una dipendenza esterna con versione fissata e target es2022. */
export function buildEsmShUrl(pkg: string, version: string, subpath: string): string {
	return `https://esm.sh/${pkg}@${version}${subpath}?external=react,react-dom&target=es2022`;
}
