#!/usr/bin/env node
/**
 * OMP Studio — Rilevamento comandi nuovi e spariti di omp.
 *
 * Confronta i comandi builtin esposti dal binario `omp` a runtime tramite RPC
 * (`get_available_commands`) con il catalogo curato in `src/lib/agent/commandCatalog/manifest/`.
 *
 * Se vengono rilevati comandi nuovi (esposti da omp ma privi di voce con origin 'omp')
 * o spariti (dichiarati con origin 'omp' ma non piu' esposti da omp), lo script termina
 * con codice 1, stampa un riepilogo in italiano e scrive `ricerca/commands-pending.json`
 * con i dati grezzi e le istruzioni per l'aggiornamento (vedi docs/COMMANDS.md).
 *
 * Opzioni:
 *   --json          Emette il risultato strutturato su stdout
 *   --bin <path>    Specifica il percorso del binario omp (o usa OMP_BIN)
 *   -h, --help      Mostra l'aiuto
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const PENDING_FILE = join(ROOT, 'ricerca', 'commands-pending.json');

function parseArgs(args) {
	const opts = {
		json: false,
		bin: null,
		help: false
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--json') {
			opts.json = true;
		} else if (arg === '--bin') {
			opts.bin = args[++i];
		} else if (arg.startsWith('--bin=')) {
			opts.bin = arg.slice(6);
		} else if (arg === '--help' || arg === '-h') {
			opts.help = true;
		} else {
			console.error(`Opzione sconosciuta: ${arg}`);
			process.exit(1);
		}
	}

	return opts;
}

function printHelp() {
	console.log(`
Uso: node scripts/check-commands.mjs [opzioni]

Opzioni:
  --bin <path>    Percorso del binario omp (prevale su OMP_BIN e PATH)
  --json          Stampa l'esito in formato JSON per integrazioni automatiche
  -h, --help      Mostra questo messaggio di aiuto

Variabili d'ambiente:
  OMP_BIN         Percorso alternativo del binario omp
`);
}

/**
 * Risolve il binario omp seguendo la stessa logica di lookup di Studio
 * (cfr. src-tauri/src/omp_ops.rs:64-96).
 */
export function resolveOmpBinary(customBin = null) {
	if (customBin) {
		if (existsSync(customBin)) return customBin;
		try {
			const res = spawnSync(process.platform === 'win32' ? 'where' : 'which', [customBin], {
				encoding: 'utf8'
			});
			if (res.status === 0 && res.stdout.trim()) {
				return res.stdout.trim().split(/\r?\n/)[0];
			}
		} catch {}
		return customBin;
	}

	if (process.env.OMP_BIN) {
		if (existsSync(process.env.OMP_BIN)) return process.env.OMP_BIN;
	}

	if (process.platform === 'win32') {
		const localAppData = process.env.LOCALAPPDATA;
		if (localAppData) {
			const candidate = join(localAppData, 'omp', 'omp.exe');
			if (existsSync(candidate)) return candidate;
		}
		try {
			const res = spawnSync('where', ['omp'], { encoding: 'utf8' });
			if (res.status === 0 && res.stdout.trim()) {
				return res.stdout.trim().split(/\r?\n/)[0];
			}
		} catch {}
		return 'omp.exe';
	}

	const home = process.env.HOME || '';
	const candidates = [
		join(home, '.bun', 'bin', 'omp'),
		join(home, '.omp', 'bin', 'omp'),
		join(home, '.local', 'bin', 'omp'),
		join(home, '.cargo', 'bin', 'omp'),
		'/usr/local/bin/omp',
		'/opt/homebrew/bin/omp'
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	try {
		const res = spawnSync('which', ['omp'], { encoding: 'utf8' });
		if (res.status === 0 && res.stdout.trim()) {
			return res.stdout.trim().split(/\r?\n/)[0];
		}
	} catch {}

	return null;
}

/**
 * Legge la versione del binario omp con `omp --version`.
 */
export function getOmpVersion(ompBin) {
	try {
		const res = spawnSync(ompBin, ['--version'], { encoding: 'utf8' });
		if (res.status === 0 && res.stdout.trim()) {
			return res.stdout.trim();
		}
	} catch {}
	return 'sconosciuta';
}

/**
 * Interroga omp in modalita' RPC ed estrae l'elenco dei comandi disponibili.
 */
export async function queryOmpAvailableCommands(ompBin, timeoutMs = 20000) {
	return new Promise((resolve, reject) => {
		let proc;
		try {
			proc = spawn(ompBin, ['--mode', 'rpc', '--no-session'], {
				stdio: ['pipe', 'pipe', 'pipe']
			});
		} catch (err) {
			return reject(new Error(`Impossibile avviare il processo omp (${ompBin}): ${err.message}`));
		}

		let settled = false;
		let timer = null;
		let buffer = '';
		let stderrBuffer = '';

		function cleanup() {
			clearTimeout(timer);
			if (proc && !proc.killed) {
				try {
					proc.stdin?.end();
					proc.kill('SIGTERM');
					setTimeout(() => {
						try {
							if (!proc.killed) proc.kill('SIGKILL');
						} catch {}
					}, 1000).unref();
				} catch {}
			}
		}

		timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(
				new Error(
					`Timeout (${timeoutMs / 1000}s) durante l'interrogazione RPC di omp (${ompBin}). Nessuna risposta a get_available_commands.`
				)
			);
		}, timeoutMs);

		proc.on('error', (err) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(new Error(`Errore di esecuzione del binario omp (${ompBin}): ${err.message}`));
		});

		proc.stderr?.on('data', (chunk) => {
			stderrBuffer += chunk.toString('utf8');
		});

		proc.stdout?.on('data', (chunk) => {
			if (settled) return;
			buffer += chunk.toString('utf8');
			const lines = buffer.split('\n');
			buffer = lines.pop();

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const msg = JSON.parse(trimmed);
					if (msg.id === '1' && msg.type === 'response') {
						settled = true;
						cleanup();
						if (msg.success === false) {
							return reject(
								new Error(
									`omp ha restituito un errore per get_available_commands: ${msg.error || 'errore sconosciuto'}`
								)
							);
						}
						const commands = Array.isArray(msg.data?.commands) ? msg.data.commands : [];
						return resolve(commands);
					}
				} catch {
					// Ignora righe non JSON
				}
			}
		});

		proc.on('exit', (code, signal) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(
				new Error(
					`omp e' terminato inaspettatamente prima di rispondere (codice ${code}, segnale ${signal}): ${stderrBuffer.trim() || '(nessun messaggio su stderr)'}`
				)
			);
		});

		try {
			proc.stdin.write(JSON.stringify({ type: 'get_available_commands', id: '1' }) + '\n');
		} catch (err) {
			if (settled) return;
			settled = true;
			cleanup();
			reject(new Error(`Impossibile inviare la richiesta a omp su stdin: ${err.message}`));
		}
	});
}

/**
 * Carica tutte le voci con origin 'omp' dal catalogo curato di Studio.
 * Se index.ts o alcuni moduli non sono ancora pronti, carica graziosamente
 * le voci dei file parziali gia' presenti.
 */
export async function loadManifestOmpEntries(rootDir = ROOT) {
	try {
		const { register } = await import('node:module');
		register(pathToFileURL(join(rootDir, 'test', 'alias-hooks.mjs')).href, import.meta.url);
	} catch {
		// Hook gia' registrato o non supportato
	}

	const manifestIndex = join(
		rootDir,
		'src',
		'lib',
		'agent',
		'commandCatalog',
		'manifest',
		'index.ts'
	);

	if (existsSync(manifestIndex)) {
		try {
			const mod = await import(pathToFileURL(manifestIndex).href);
			if (Array.isArray(mod.COMMAND_MANIFEST)) {
				return mod.COMMAND_MANIFEST.filter((e) => e.origin === 'omp');
			}
		} catch {
			// Fallback sui singoli file se index.ts importa file non ancora esistenti
		}
	}

	const entries = [];
	const parts = [
		{ file: 'omp-modes.ts', exp: 'OMP_ENTRIES_MODES' },
		{ file: 'omp-session.ts', exp: 'OMP_ENTRIES_SESSION' }
	];

	for (const part of parts) {
		const partPath = join(
			rootDir,
			'src',
			'lib',
			'agent',
			'commandCatalog',
			'manifest',
			part.file
		);
		if (existsSync(partPath)) {
			try {
				const mod = await import(pathToFileURL(partPath).href);
				if (Array.isArray(mod[part.exp])) {
					entries.push(...mod[part.exp].filter((e) => e.origin === 'omp'));
				}
			} catch {}
		}
	}

	return entries;
}

/**
 * Esegue il confronto tra i comandi builtin di omp e le voci del catalogo.
 */
export async function checkCommands(options = {}) {
	const ompBin = resolveOmpBinary(options.bin);
	if (!ompBin) {
		throw new Error(
			"Binario 'omp' non trovato nel sistema.\nVerifica che 'omp' sia nel PATH o in ~/.bun/bin/omp, oppure specifica --bin <path> o la variabile OMP_BIN."
		);
	}

	const ompVersion = getOmpVersion(ompBin);
	const rawCommands = await queryOmpAvailableCommands(ompBin);
	const builtinCommands = rawCommands.filter((cmd) => cmd.source === 'builtin');

	const manifestEntries = await loadManifestOmpEntries(ROOT);
	const manifestMap = new Map(manifestEntries.map((e) => [e.id, e]));
	const builtinMap = new Map(builtinCommands.map((c) => [c.name, c]));

	// Comandi esposti da omp come builtin ma non presenti nel manifesto
	const newCommands = builtinCommands
		.filter((c) => !manifestMap.has(c.name))
		.map((c) => ({
			name: c.name,
			description: c.description || '',
			input: c.input || {},
			subcommands: Array.isArray(c.subcommands) ? c.subcommands : []
		}));

	// Voci con origin 'omp' nel manifesto ma non piu' esposte come builtin da omp
	const missingCommands = manifestEntries
		.filter((e) => !builtinMap.has(e.id))
		.map((e) => ({
			id: e.id,
			entry: e
		}));

	const isAligned = newCommands.length === 0 && missingCommands.length === 0;

	return {
		ok: isAligned,
		ompBin,
		ompVersion,
		totalBuiltins: builtinCommands.length,
		totalManifestOmp: manifestEntries.length,
		newCommands,
		missingCommands
	};
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printHelp();
		process.exit(0);
	}

	let result;
	try {
		result = await checkCommands({ bin: opts.bin });
	} catch (err) {
		if (opts.json) {
			console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
		} else {
			console.error(`\n[ERRORE] ${err.message}\n`);
		}
		process.exit(1);
	}

	if (result.ok) {
		// Se c'era un file di report precedente, rimuovilo
		if (existsSync(PENDING_FILE)) {
			try {
				rmSync(PENDING_FILE, { force: true });
			} catch {}
		}

		if (opts.json) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			console.log(
				`\n[PASS] Catalogo comandi allineato a omp (${result.ompVersion}): ${result.totalBuiltins} comandi builtin verificati.\n`
			);
		}
		process.exit(0);
	}

	// Scrivi ricerca/commands-pending.json
	const pendingDir = dirname(PENDING_FILE);
	if (!existsSync(pendingDir)) {
		mkdirSync(pendingDir, { recursive: true });
	}

	const reportPayload = {
		ompVersion: result.ompVersion,
		checkedAt: new Date().toISOString(),
		summary: {
			totalBuiltins: result.totalBuiltins,
			totalManifestOmp: result.totalManifestOmp,
			newCount: result.newCommands.length,
			missingCount: result.missingCommands.length
		},
		newCommands: result.newCommands,
		missingCommands: result.missingCommands
	};

	writeFileSync(PENDING_FILE, JSON.stringify(reportPayload, null, 2) + '\n', 'utf8');

	if (opts.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.error('\n=============================================================');
		console.error(' [FAIL] DISALLINEAMENTO CATALOGO COMANDI OMP RILEVATO');
		console.error('=============================================================');
		console.error(`Versione omp rilevata: ${result.ompVersion} (${result.ompBin})`);
		console.error(`Comandi builtin omp:   ${result.totalBuiltins}`);
		console.error(`Voci 'omp' manifesto:  ${result.totalManifestOmp}`);

		if (result.newCommands.length > 0) {
			console.error(`\nNuovi comandi omp non presenti nel manifesto (${result.newCommands.length}):`);
			for (const cmd of result.newCommands) {
				const hint = cmd.input?.hint ? ` ${cmd.input.hint}` : '';
				console.error(`  - /${cmd.name}${hint}`);
				if (cmd.description) {
					console.error(`      Descrizione: ${cmd.description}`);
				}
			}
		}

		if (result.missingCommands.length > 0) {
			console.error(
				`\nComandi del manifesto non piu' esposti da omp (${result.missingCommands.length}):`
			);
			for (const cmd of result.missingCommands) {
				console.error(`  - /${cmd.id}`);
			}
		}

		console.error(`\nDettagli scritti in: ricerca/commands-pending.json`);
		console.error('Consulta docs/COMMANDS.md per la procedura di aggiornamento.');
		console.error('=============================================================\n');
	}

	process.exit(1);
}

// Esegui main solo se chiamato direttamente da riga di comando
const isDirectExecution =
	Boolean(process.argv[1]) &&
	fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]).href);

if (isDirectExecution) {
	main().catch((err) => {
		console.error('Errore imprevisto durante il controllo comandi:', err);
		process.exit(1);
	});
}
