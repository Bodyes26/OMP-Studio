/**
 * Le estensioni di Studio vivono in `extensions/` e finiscono nel binario con
 * `include_str!`: se una sparisce dal cablaggio il tool non e' piu' disponibile
 * nella GUI (o il comando IPC non e' registrato) senza che nulla fallisca in
 * compilazione. Questi controlli difendono quel collegamento senza fissare il
 * testo esatto delle righe: verificano che il sorgente sia incluso nel binario e
 * che il percorso prodotto da `write_extension` arrivi davvero a `omp` con `-e`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as planMod from '../extensions/studio-plan.ts';
import * as labMod from '../extensions/studio-lab.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function rust(rel: string): string {
	return readFileSync(join(ROOT, rel), 'utf8');
}

const PTY = rust('src-tauri/src/pty/mod.rs');
const RPC = rust('src-tauri/src/rpc/mod.rs');

/** Il file compare in un `include_str!` del binario. */
function assertIncluded(fileName: string): void {
	const needle = `extensions/${fileName}"`;
	assert.ok(
		PTY.includes(needle) || RPC.includes(needle),
		`${fileName} non e' incluso nel binario con include_str!: il tool sparirebbe dalla GUI`
	);
}

/**
 * Il file viene scritto da `write_extension` e la variabile che ne porta il
 * percorso finisce nella riga di comando (`-e`). Senza il secondo passo il file
 * esiste su disco ma omp non lo carica. Il legame e' `let <var> = ...write_extension("<file>"` :
 * l'assegnazione puo' stare su piu' righe o dentro un `if`, ma la variabile
 * deve poi comparire fra gli argomenti.
 */
function assertLaunched(source: string, fileName: string, where: string): void {
	const escaped = fileName.replace(/\./g, '\\.');
	const binding = new RegExp(
		`let\\s+(\\w+)\\s*=\\s*(?:if[\\s\\S]{0,160}?)?(?:crate::pty::)?write_extension\\(\\s*"${escaped}"`
	).exec(source);
	assert.ok(binding, `${where}: ${fileName} non viene preparato da write_extension`);
	const variable = binding[1];
	assert.ok(
		source.includes(`&${variable}`),
		`${where}: il percorso di ${fileName} (${variable}) non finisce nella riga di comando`
	);
}

describe('Estensioni incluse nel binario e avviate con -e', () => {
	it('studio-headsup e studio-docs sono caricate sia dal PTY sia da rpc_open', () => {
		for (const fileName of ['studio-headsup.ts', 'studio-docs.ts']) {
			assertIncluded(fileName);
			assertLaunched(PTY, fileName, 'pty/mod.rs');
			assertLaunched(RPC, fileName, 'rpc/mod.rs');
		}
	});

	it('la sessione del Laboratorio carica studio-lab e studio-plan, che condivide gli helper', () => {
		assertIncluded('studio-lab.ts');
		assertIncluded('studio-plan.ts');
		assertLaunched(PTY, 'studio-plan.ts', 'pty/mod.rs');

		// `rpc_open_lab` compone la propria riga di comando: servono entrambe le
		// estensioni, perche' la guardia del Piano vale anche durante il brief e
		// `studio-lab` importa da `studio-plan` gli helper condivisi.
		const labStart = RPC.indexOf('pub const LAB_EXTENSION_TS');
		assert.notEqual(labStart, -1, 'rpc/mod.rs: LAB_EXTENSION_TS non trovata');
		const labSection = RPC.slice(labStart);
		assert.ok(
			labSection.includes('"studio-lab.ts"') && labSection.includes('"studio-plan.ts"'),
			'rpc/mod.rs: la sessione del Laboratorio non prepara entrambe le estensioni'
		);
	});
});

describe('Comandi IPC del diario esposti alla GUI', () => {
	it('project_docs_ask e\' registrato in generate_handler', () => {
		const lib = rust('src-tauri/src/lib.rs');
		const start = lib.indexOf('generate_handler![');
		assert.notEqual(start, -1, 'lib.rs: macro generate_handler! non trovata');
		const block = lib.slice(start, lib.indexOf(']', start));
		assert.ok(block.includes('project_docs_ask'), 'lib.rs: project_docs_ask non e\' registrato');
	});
});

describe('Helper condivisi fra studio-plan e studio-lab', () => {
	const lab = readFileSync(join(ROOT, 'extensions', 'studio-lab.ts'), 'utf8');

	it('le due estensioni espongono le stesse funzioni di binding', () => {
		// Sotto Node i due moduli condividono un registro, quindi l'identita'
		// dell'oggetto funzione dimostra che in `studio-lab` non c'e' una seconda
		// copia del corpo: se divergesse, qui sarebbero due funzioni diverse.
		// Dentro omp il caricatore valuta ogni file `-e` come modulo separato
		// (verificato su 19.2.1), quindi conta che il corpo sia uno solo e che
		// l'import sia relativo letterale (test qui sotto).
		assert.equal(typeof planMod.normalizePathForBinding, 'function');
		assert.equal(typeof planMod.isLabBriefApprovedOnDisk, 'function');
		assert.equal(labMod.normalizePathForBinding, planMod.normalizePathForBinding);
		assert.equal(labMod.isLabBriefApprovedOnDisk, planMod.isLabBriefApprovedOnDisk);
	});

	it('studio-lab importa da studio-plan con uno specificatore relativo letterale', () => {
		// Questo e' l'unico controllo sul testo, e ha un motivo che il test di
		// identita' qui sopra non puo' coprire: il caricatore di omp risolve solo
		// specificatori letterali. Un import costruito a runtime (o un alias
		// risolto da `package.json`) darebbe le stesse funzioni sotto Node e
		// farebbe sparire l'estensione dentro omp.
		assert.match(
			lab,
			/import\s*\{[^}]*\}\s*from\s*["']\.\/studio-plan\.ts["']/,
			'studio-lab deve importare gli helper con `from "./studio-plan.ts"`'
		);
	});
});
