import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	LAB_CATALOG_PACKAGES,
	LAB_ALLOWED_IMPORT_SPECIFIERS,
	isCatalogPackage,
	getCatalogPackageVersion,
	isAllowedImportSpecifier,
	validatePrototypeDependencies,
	validatePrototypePackageJson
} from '../src/lib/lab/catalog.ts';
import {
	compileLabPrototype,
	compileLabPrototypeInWorker,
	resolveVirtualImportPath,
	normalizeVfsPath
} from '../src/lib/lab/compiler.ts';

describe('Laboratorio prototipi — Step 8: Catalogo dipendenze', () => {
	it('censice tutti i pacchetti approvati con versioni fissate esatte', () => {
		const expectedPackages: Record<string, string> = {
			react: '19.2.8',
			'react-dom': '19.2.8',
			'@tailwindcss/browser': '4.3.3',
			'@radix-ui/react-dialog': '1.1.23',
			recharts: '3.10.1',
			motion: '13.2.0',
			'lucide-react': '1.42.0'
		};

		for (const [pkg, version] of Object.entries(expectedPackages)) {
			assert.equal(
				isCatalogPackage(pkg),
				true,
				`Il pacchetto '${pkg}' deve essere presente nel catalogo`
			);
			assert.equal(
				getCatalogPackageVersion(pkg),
				version,
				`La versione di '${pkg}' deve essere fissata esattamente a '${version}'`
			);
		}
	});

	it('rifiuta versioni con intervalli, wildcard o prefisso latest', () => {
		const invalidDeps = {
			react: '^19.2.8',
			'lucide-react': 'latest',
			recharts: '~3.10.1',
			motion: '*'
		};

		const result = validatePrototypeDependencies(invalidDeps);
		assert.equal(result.ok, false);
		assert.equal(result.errors.length >= 4, true);
		for (const err of result.errors) {
			assert.match(err, /Versione non valida o non fissata/);
		}
	});

	it('rifiuta pacchetti estranei al catalogo', () => {
		const uncataloged = {
			axios: '1.6.0',
			lodash: '4.17.21',
			'left-pad': '1.3.0'
		};

		const result = validatePrototypeDependencies(uncataloged);
		assert.equal(result.ok, false);
		assert.equal(result.errors.length, 3);
		assert.match(result.errors[0], /Pacchetto non autorizzato nel catalogo del Laboratorio/);
	});

	it('rifiuta categoricamente script di ciclo di vita in package.json', () => {
		const badManifest = {
			name: 'prototipo-avversario',
			version: '1.0.0',
			scripts: {
				postinstall: 'node exploit.js',
				prepare: 'sh setup.sh',
				build: 'malicious'
			},
			dependencies: {
				react: '19.2.8'
			}
		};

		const result = validatePrototypePackageJson(badManifest);
		assert.equal(result.ok, false);
		assert.equal(
			result.errors.some((e) => e.includes("Script di ciclo di vita vietato")),
			true
		);
		assert.equal(
			result.errors.some((e) => e.includes("postinstall")),
			true
		);
	});

	it('riconosce gli specifier di import consentiti inclusi i sottopercorsi', () => {
		const allowed = [
			'react',
			'react-dom',
			'react-dom/client',
			'@radix-ui/react-dialog',
			'recharts',
			'motion',
			'motion/react',
			'lucide-react'
		];

		for (const specifier of allowed) {
			assert.equal(
				isAllowedImportSpecifier(specifier),
				true,
				`Specifier '${specifier}' deve essere autorizzato`
			);
		}

		assert.equal(isAllowedImportSpecifier('node:fs'), false);
		assert.equal(isAllowedImportSpecifier('axios'), false);
		assert.equal(isAllowedImportSpecifier('react/compiler-runtime'), false);
	});
});

describe('Laboratorio prototipi — Step 8: Resolver VFS e Confinamento', () => {
	it('normalizza i percorsi VFS con forward slash e prefisso radice', () => {
		assert.equal(normalizeVfsPath('src\\main.tsx'), '/src/main.tsx');
		assert.equal(normalizeVfsPath('/src/App.tsx'), '/src/App.tsx');
		assert.equal(normalizeVfsPath('assets\\logo.svg'), '/assets/logo.svg');
	});

	it('risolve correttamente import relativi interni al perimetro VFS', () => {
		assert.equal(resolveVirtualImportPath('./App', '/src/main.tsx'), '/src/App');
		assert.equal(resolveVirtualImportPath('./components/Card', '/src/App.tsx'), '/src/components/Card');
		assert.equal(resolveVirtualImportPath('../assets/logo.svg', '/src/App.tsx'), '/assets/logo.svg');
	});

	it('blocca directory traversal e tentativi di evasione dal VFS', () => {
		// Tentativo di uscire dal prototipo verso la root
		assert.equal(resolveVirtualImportPath('../../secrets.txt', '/src/main.tsx'), null);
		// Tentativo di uscire verso un altro prototipo
		assert.equal(resolveVirtualImportPath('../other-proto/src/index.tsx', '/src/main.tsx'), null);
		// Percorso assoluto fuori dal VFS consentito (/src/ e /assets/)
		assert.equal(resolveVirtualImportPath('/etc/passwd', '/src/main.tsx'), null);
		assert.equal(resolveVirtualImportPath('/proto/other/file.ts', '/src/main.tsx'), null);
	});
});

describe('Laboratorio prototipi — Step 8: Compilazione multifile con esbuild-wasm', () => {
	const sampleFiles: Record<string, string> = {
		'/src/main.tsx': `
			import React from 'react';
			import { createRoot } from 'react-dom/client';
			import App from './App';
			import './style.css';

			const rootEl = document.getElementById('root');
			if (rootEl) {
				createRoot(rootEl).render(<App />);
			}
		`,
		'/src/App.tsx': `
			import React, { useState } from 'react';
			import * as Dialog from '@radix-ui/react-dialog';
			import { motion } from 'motion/react';
			import { Check, Layers, ArrowRight } from 'lucide-react';
			import Variant from './Variant';
			import Trend from './Trend';
			import data from './data.json';
			import logo from '../assets/logo.svg';

			export default function App() {
				const [active, setActive] = useState('B');
				return (
					<main className="p-6">
						<header className="flex items-center gap-2">
							<img src={logo} alt="Logo" width="24" height="24" />
							<h1 className="text-xl font-bold">Titolo Prototipo</h1>
						</header>
						<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
							<p>Variante attiva: {active}</p>
							<Variant items={data} selected={active} onSelect={setActive} />
							<Trend />
						</motion.div>
						<Dialog.Root>
							<Dialog.Trigger>Apri Modale</Dialog.Trigger>
							<Dialog.Portal>
								<Dialog.Overlay />
								<Dialog.Content>
									<Dialog.Title>Dettaglio</Dialog.Title>
									<Dialog.Description>Contenuto accessibile</Dialog.Description>
									<Dialog.Close>Chiudi</Dialog.Close>
								</Dialog.Content>
							</Dialog.Portal>
						</Dialog.Root>
					</main>
				);
			}
		`,
		'/src/Variant.tsx': `
			import React from 'react';
			import { Check } from 'lucide-react';

			interface VariantItem {
				id: string;
				name: string;
			}

			interface VariantProps {
				items: VariantItem[];
				selected: string;
				onSelect: (id: string) => void;
			}

			export default function Variant({ items, selected, onSelect }: VariantProps) {
				return (
					<div>
						{items.map((it) => (
							<button key={it.id} onClick={() => onSelect(it.id)}>
								{selected === it.id && <Check size={16} />}
								{it.name}
							</button>
						))}
					</div>
				);
			}
		`,
		'/src/Trend.tsx': `
			import React from 'react';
			import { BarChart, Bar, XAxis, Tooltip } from 'recharts';

			export default function Trend() {
				const chartData = [{ name: 'A', n: 10 }, { name: 'B', n: 25 }];
				return (
					<BarChart width={300} height={150} data={chartData}>
						<XAxis dataKey="name" />
						<Tooltip />
						<Bar dataKey="n" fill="#4f46e5" />
					</BarChart>
				);
			}
		`,
		'/src/data.json': JSON.stringify([
			{ id: 'A', name: 'Opzione compatta' },
			{ id: 'B', name: 'Opzione estesa' }
		]),
		'/src/style.css': `
			button { cursor: pointer; border-radius: 4px; }
			main { font-family: system-ui, sans-serif; }
		`,
		'/assets/logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#4f46e5"/></svg>`
	};

	it('compila con successo un prototipo multifile completo con TSX, JSON, CSS e Asset', async () => {
		const result = await compileLabPrototype({
			entryPoint: '/src/main.tsx',
			files: sampleFiles
		});

		assert.equal(result.ok, true, `Compilazione fallita: ${result.errors?.join('; ')}`);
		assert.equal(typeof result.js, 'string');
		assert.equal((result.js?.length ?? 0) > 500, true);
		assert.equal(typeof result.css, 'string');
		assert.equal((result.css?.length ?? 0) > 20, true);
		assert.match(result.css!, /border-radius: 4px/);
		// L'asset SVG deve essere stato incorporato come dataurl
		assert.match(result.js!, /data:image\/svg\+xml/);
		// L'output deve contenere il codice CJS bridge per i catalog targets
		assert.match(result.js!, /LabVendor/);
	});

	it('rifiuta la compilazione se viene importato un pacchetto non censito', async () => {
		const hostileFiles = {
			'/src/main.tsx': `
				import React from 'react';
				import axios from 'axios';
				console.log(axios);
			`
		};

		const result = await compileLabPrototype({
			entryPoint: '/src/main.tsx',
			files: hostileFiles
		});

		assert.equal(result.ok, false);
		assert.equal(result.errors !== undefined && result.errors.length > 0, true);
		assert.match(
			result.errors![0],
			/Pacchetto non autorizzato nel catalogo del Laboratorio: 'axios'/
		);
	});

	it('rifiuta la compilazione se viene importato un modulo nativo Node', async () => {
		const hostileFiles = {
			'/src/main.tsx': `
				import React from 'react';
				import fs from 'node:fs';
				console.log(fs);
			`
		};

		const result = await compileLabPrototype({
			entryPoint: '/src/main.tsx',
			files: hostileFiles
		});

		assert.equal(result.ok, false);
		assert.match(
			result.errors![0],
			/Pacchetto non autorizzato nel catalogo del Laboratorio: 'node:fs'/
		);
	});

	it('rifiuta la compilazione su import relativo che tenta traversal fuori dal VFS', async () => {
		const hostileFiles = {
			'/src/main.tsx': `
				import React from 'react';
				import secret from '../../secrets.env';
				console.log(secret);
			`
		};

		const result = await compileLabPrototype({
			entryPoint: '/src/main.tsx',
			files: hostileFiles
		});

		assert.equal(result.ok, false);
		assert.match(
			result.errors![0],
			/Import fuori dal VFS del prototipo non consentito: '\.\.\/\.\.\/secrets\.env'/
		);
	});

	it('rifiuta la compilazione se il file importato non esiste nel VFS', async () => {
		const missingFiles = {
			'/src/main.tsx': `
				import React from 'react';
				import Inesistente from './Inesistente';
				console.log(Inesistente);
			`
		};

		const result = await compileLabPrototype({
			entryPoint: '/src/main.tsx',
			files: missingFiles
		});

		assert.equal(result.ok, false);
		assert.match(
			result.errors![0],
			/File non trovato nel VFS del prototipo: '\.\/Inesistente'/
		);
	});

	it('compila con successo in un worker isolato offloading CPU dal thread principale', async () => {
		const result = await compileLabPrototypeInWorker({
			entryPoint: '/src/main.tsx',
			files: sampleFiles
		});

		assert.equal(result.ok, true, `Compilazione worker fallita: ${result.errors?.join('; ')}`);
		assert.equal((result.js?.length ?? 0) > 500, true);
	});
});

describe('Laboratorio prototipi — Step 8: Artefatti locali riusabili (senza CDN)', () => {
	it('garantisce la presenza di tutti gli artefatti precompilati in static/lab/', () => {
		const requiredArtifacts = [
			'vendor.js',
			'tailwind.js',
			'esbuild.js',
			'esbuild.wasm',
			'catalog-manifest.json'
		];

		const staticLabDir = join(process.cwd(), 'static', 'lab');

		for (const filename of requiredArtifacts) {
			const fullPath = join(staticLabDir, filename);
			assert.equal(existsSync(fullPath), true, `Artefatto mancante: '${filename}' in ${staticLabDir}`);
			const content = readFileSync(fullPath);
			assert.equal(content.length > 0, true, `Artefatto vuoto: '${filename}'`);
		}
	});

	it('verifica la coerenza del manifest degli artefatti con le versioni del catalogo', () => {
		const manifestPath = join(process.cwd(), 'static', 'lab', 'catalog-manifest.json');
		assert.equal(existsSync(manifestPath), true);

		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		assert.equal(manifest.version, 1);
		assert.equal(manifest.catalog['react'], '19.2.8');
		assert.equal(manifest.catalog['@tailwindcss/browser'], '4.3.3');
		assert.equal(manifest.catalog['esbuild-wasm'], '0.28.2');

		assert.equal(typeof manifest.artifacts['vendor.js'].sha256, 'string');
		assert.equal(manifest.artifacts['vendor.js'].size > 500000, true);
	});
});
