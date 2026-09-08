// Catalogo ufficiale delle dipendenze del Laboratorio prototipi.
//
// Questo modulo definisce le librerie consentite per i prototipi React,
// le loro versioni fissate (pinned) e la mappatura verso il bundle fidato
// precompilato (`LabVendor`).
//
// Invarianti garantiti:
//  1. Nessun URL 'latest', intervallo o wildcard: ogni versione e' esatta;
//  2. Allowlist chiusa: qualunque pacchetto o import non censito e' respinto per difetto;
//  3. Nessuna esecuzione di script di ciclo di vita (preinstall, postinstall, ecc.) forniti dall'agente;
//  4. Nessuna CDN esterna a runtime: gli artefatti vivono in locale (`/static/lab/`).

import { isPinnedVersion } from './contracts.ts';

export interface LabCatalogPackage {
	readonly name: string;
	readonly version: string;
	readonly description: string;
	/** Percorso o espressione dell'oggetto globale esposto da vendor.js (es. LabVendor.React) */
	readonly globalTarget: string;
	/** Sottopercorsi consentiti (es. 'react-dom/client' -> 'LabVendor.ReactDOM') */
	readonly subpaths?: Readonly<Record<string, string>>;
	readonly hasDefaultExport?: boolean;
}

/**
 * Catalogo iniziale delle dipendenze supportate nel Laboratorio.
 * Versioni fissate verificate nella prova tecnica (2026-09-07).
 */
export const LAB_CATALOG_PACKAGES: Readonly<Record<string, LabCatalogPackage>> = Object.freeze({
	react: {
		name: 'react',
		version: '19.2.8',
		description: 'Libreria UI fondamentale per tutti i prototipi del Laboratorio',
		globalTarget: 'LabVendor.React',
		hasDefaultExport: true
	},
	'react-dom': {
		name: 'react-dom',
		version: '19.2.8',
		description: 'Punto di montaggio DOM e createRoot per React',
		globalTarget: 'LabVendor.ReactDOM',
		subpaths: {
			client: 'LabVendor.ReactDOM'
		},
		hasDefaultExport: false
	},
	'@tailwindcss/browser': {
		name: '@tailwindcss/browser',
		version: '4.3.3',
		description: 'Motore di compilazione Tailwind CSS v4 in-browser',
		globalTarget: 'tailwindcss',
		hasDefaultExport: false
	},
	'@radix-ui/react-dialog': {
		name: '@radix-ui/react-dialog',
		version: '1.1.23',
		description: 'Primitive per finestre modali accessibili e dialoghi WAI-ARIA',
		globalTarget: 'LabVendor.Dialog',
		hasDefaultExport: false
	},
	recharts: {
		name: 'recharts',
		version: '3.10.1',
		description: 'Grafici e visualizzazione dati simulati',
		globalTarget: 'LabVendor',
		hasDefaultExport: false
	},
	motion: {
		name: 'motion',
		version: '13.2.0',
		description: 'Animazioni dichiarative e transizioni fluide',
		globalTarget: 'LabVendor',
		subpaths: {
			react: 'LabVendor'
		},
		hasDefaultExport: false
	},
	'lucide-react': {
		name: 'lucide-react',
		version: '1.42.0',
		description: 'Icone vettoriali per interfaccia utente',
		globalTarget: 'LabVendor',
		hasDefaultExport: false
	}
});

/**
 * Elenco degli specifier di import consentiti a livello di codice ES.
 */
export const LAB_ALLOWED_IMPORT_SPECIFIERS: ReadonlySet<string> = new Set([
	'react',
	'react-dom',
	'react-dom/client',
	'@radix-ui/react-dialog',
	'recharts',
	'motion',
	'motion/react',
	'lucide-react'
]);

/**
 * Script di ciclo di vita npm categoricamente vietati nei manifest o configurazioni dei prototipi.
 */
export const FORBIDDEN_LIFECYCLE_SCRIPTS: ReadonlySet<string> = new Set([
	'preinstall',
	'install',
	'postinstall',
	'prepublish',
	'prepublishOnly',
	'prepare',
	'prepack',
	'postpack',
	'pretest',
	'test',
	'posttest',
	'prestop',
	'stop',
	'poststop',
	'prerestart',
	'restart',
	'postrestart'
]);

/**
 * Verifica se un nome di pacchetto e' censito nel catalogo fidato.
 */
export function isCatalogPackage(name: string): boolean {
	return Object.prototype.hasOwnProperty.call(LAB_CATALOG_PACKAGES, name);
}

/**
 * Ritorna la versione fissata nel catalogo per il pacchetto specificato, o null se non autorizzato.
 */
export function getCatalogPackageVersion(name: string): string | null {
	return LAB_CATALOG_PACKAGES[name]?.version ?? null;
}

/**
 * Verifica se uno specifier di importazione modulo appartiene al catalogo autorizzato.
 */
export function isAllowedImportSpecifier(specifier: string): boolean {
	return LAB_ALLOWED_IMPORT_SPECIFIERS.has(specifier);
}

/**
 * Restituisce l'espressione target globale di LabVendor per uno specifier di importazione autorizzato.
 */
export function getCatalogGlobalTarget(specifier: string): string | null {
	if (!isAllowedImportSpecifier(specifier)) {
		return null;
	}

	if (specifier === 'react') return 'LabVendor.React';
	if (specifier === 'react-dom' || specifier === 'react-dom/client') return 'LabVendor.ReactDOM';
	if (specifier === '@radix-ui/react-dialog') return 'LabVendor.Dialog';
	if (specifier === 'recharts') return 'LabVendor';
	if (specifier === 'motion' || specifier === 'motion/react') return 'LabVendor';
	if (specifier === 'lucide-react') return 'LabVendor';

	return null;
}

export interface LabValidationResult {
	readonly ok: boolean;
	readonly errors: readonly string[];
}

/**
 * Valida un insieme di dipendenze dichiarate (es. da package.json o prototype.json).
 * Rifiuta pacchetti fuori catalogo o con versioni diverse da quelle fissate.
 */
export function validatePrototypeDependencies(
	dependencies: Readonly<Record<string, unknown>>
): LabValidationResult {
	const errors: string[] = [];

	for (const [pkg, version] of Object.entries(dependencies)) {
		if (!isCatalogPackage(pkg)) {
			errors.push(`Pacchetto non autorizzato nel catalogo del Laboratorio: '${pkg}'`);
			continue;
		}

		if (typeof version !== 'string' || !isPinnedVersion(version)) {
			errors.push(
				`Versione non valida o non fissata per '${pkg}': attesa versione esatta '${LAB_CATALOG_PACKAGES[pkg].version}', ricevuta '${String(version)}'`
			);
			continue;
		}

		const expectedVersion = LAB_CATALOG_PACKAGES[pkg].version;
		if (version !== expectedVersion) {
			errors.push(
				`Versione difforme dal catalogo per '${pkg}': consentita solo '${expectedVersion}', richiesta '${version}'`
			);
		}
	}

	return {
		ok: errors.length === 0,
		errors
	};
}

/**
 * Valida il contenuto di un eventuale package.json presente nel prototipo.
 * Rifiuta categoricamente script di ciclo di vita o dipendenze fuori catalogo.
 */
export function validatePrototypePackageJson(content: unknown): LabValidationResult {
	const errors: string[] = [];

	if (!content || typeof content !== 'object' || Array.isArray(content)) {
		return { ok: false, errors: ['Contenuto package.json non valido: deve essere un oggetto JSON'] };
	}

	const pkg = content as Record<string, unknown>;

	// Rifiuto categorico di lifecycle scripts
	if (pkg.scripts && typeof pkg.scripts === 'object') {
		const scripts = pkg.scripts as Record<string, unknown>;
		for (const scriptName of Object.keys(scripts)) {
			if (FORBIDDEN_LIFECYCLE_SCRIPTS.has(scriptName)) {
				errors.push(`Script di ciclo di vita vietato rilevato in package.json: '${scriptName}'`);
			} else {
				// Anche qualsiasi altro script arbitrario viene rigettato per policy di confinamento
				errors.push(`Script eseguibile non consentito nel Laboratorio: '${scriptName}'`);
			}
		}
	}

	// Validazione dipendenze se presenti
	if (pkg.dependencies && typeof pkg.dependencies === 'object') {
		const depRes = validatePrototypeDependencies(pkg.dependencies as Record<string, unknown>);
		errors.push(...depRes.errors);
	}

	// Validazione devDependencies se presenti
	if (pkg.devDependencies && typeof pkg.devDependencies === 'object') {
		const devRes = validatePrototypeDependencies(pkg.devDependencies as Record<string, unknown>);
		errors.push(...devRes.errors);
	}

	return {
		ok: errors.length === 0,
		errors
	};
}
