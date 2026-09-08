// Estensione OMP: Laboratorio prototipi — Broker di scrittura confinata e allowlist tool.
//
// Questo modulo realizza il perimetro di sicurezza insuperabile del Laboratorio
// concordato con l'utente (ricerca/laboratorio-prototipi-piano.md §§ 2, 6, 16.3):
//
//  1. Solo GUI in Studio, sempre React + Tailwind v4, dati simulati;
//  2. Sessione Laboratorio e agente principale concorrenti nello stesso progetto;
//  3. Scrittura ESCLUSIVAMENTE dentro il prototipo assegnato (`proto/<id>/` o
//     archivio bozze locale di Studio);
//  4. Il resto del progetto e' contesto in sola lettura;
//  5. Subagenti anche autori: i subagenti restano disponibili (nessun blocco di
//     `task` o di `task.maxRecursionDepth`) ed ereditano questa estensione e il
//     suo hook `tool_call`, garantendo che i confini valgano per tutta la discendenza;
//  6. Validazione su percorsi risolti realmente: traversal (`..`), percorsi
//     assoluti, symlink/junction, confini fra prototipi, root del progetto,
//     `.git`, `.omp` e aree di configurazione;
//  7. Allowlist rigida con rifiuto per difetto (deny-by-default) su `tool_call`:
//     blocco immediato di shell (`bash`), interpreti (`eval`), scritture generiche
//     (`write`, `edit`), browser host, debugger, LSP mutanti e tool MCP;
//  8. Comportamento fail-closed su qualsiasi errore o eccezione.
//
// ============================================================================
// DOCUMENTAZIONE TOOL CONSENTITI E MOTIVAZIONI
// ============================================================================
//
// Nel Laboratorio sono ammessi ESCLUSIVAMENTE i seguenti 8 tool:
//
// 1. `lab_write_file` (tool controllato registrato da questa estensione):
//    - Perché consentito: consente all'orchestratore e ai subagenti autori di
//      creare e modificare sorgenti, stili e asset ESCLUSIVAMENTE dentro la
//      cartella del prototipo assegnato (`proto/<id>/` o bozza locale).
//      Ogni percorso viene validato sia sintatticamente sia tramite `realpathSync`
//      e `lstatSync` per prevenire traversal, percorsi assoluti, scritture alla root
//      e symlink/junction verso l'esterno. La scrittura e' sempre atomica.
//
// 2. `lab_read_file` (tool controllato registrato da questa estensione):
//    - Perché consentito: consente di leggere file dentro il prototipo assegnato
//      oppure file di contesto del progetto in sola lettura (es. componenti
//      esistenti da ridisegnare). Protegge esplicitamente da traversal, symlink
//      esterni e blocca l'accesso a `.git`, file `.env*`, chiavi private (`*.pem`,
//      `*.key`, `id_rsa`), credenziali e altri prototipi.
//
// 3. `lab_list_files` (tool controllato registrato da questa estensione):
//    - Perché consentito: consente di esplorare l'albero dei file dentro il
//      prototipo o nel contesto consentito del progetto senza esporre shell o glob
//      liberi, nascondendo aree riservate (`.git`, `.env*`, `.omp`).
//
// 4. `lab_delete_file` (tool controllato registrato da questa estensione):
//    - Perché consentito: consente la rimozione controllata di file all'interno
//      del solo prototipo assegnato (es. componenti obsoleti durante un refactor),
//      verificando che il file non sia un symlink verso l'esterno.
//
// 5. `task` (tool nativo OMP per subagenti):
//    - Perché consentito: il piano stabilisce che i subagenti sono sia ricercatori
//      sia autori quando il lavoro e' separabile. Non si usa `task.maxRecursionDepth: 0`
//      perché eliminerebbe i subagenti richiesti dall'utente. I figli ereditano
//      l'estensione e il suo hook `tool_call`, quindi i limiti si applicano
//      invariati a tutta la discendenza.
//
// 6. `hub` (tool nativo OMP per coordinamento peer):
//    - Perché consentito: consente la messaggistica peer e l'attesa dei job
//      asincroni (`wait`, `send`, `inbox`, `jobs`) indispensabili per coordinare
//      i subagenti autori e ricercatori senza toccare file o processi host.
//
// 7. `todo` (tool nativo OMP per tracciamento task):
//    - Perché consentito: gestisce l'elenco dei passaggi in memoria/sessione per
//      l'agente, non interagisce con il filesystem ne' con processi esterni.
//
// 8. `ask` (tool nativo OMP per interazione con l'utente):
//    - Perché consentito: consente di proporre scelte o chiarimenti all'utente
//      tramite l'interfaccia interattiva della GUI di Studio.
//
// ============================================================================
// DOCUMENTAZIONE TOOL RIFIUTATI E MOTIVAZIONI DI SICUREZZA
// ============================================================================
//
// Tutti gli altri tool sono RIFIUTATI PER DIFETTO dall'hook `tool_call`:
//
// - `bash` / shell: RIFIUTATO. Una shell libera permette di invocare comandi
//   arbitrari, scrivere in qualsiasi percorso dell'utente, accedere alla rete
//   o invocare compiler/script non controllati.
// - `eval` / interpreti host: RIFIUTATO. Consente l'esecuzione arbitraria di
//   codice Node/Bun o Python con i privilegi completi del processo host.
// - `write` / `edit` / `ast_edit`: RIFIUTATI. I tool standard di scrittura non
//   conoscono il perimetro `proto/<id>` del Laboratorio e potrebbero modificare
//   i sorgenti dell'agente principale, la root, `.git` o file di configurazione.
// - `read` / `glob` / `grep`: RIFIUTATI a favore dei tool controllati `lab_read_file`
//   e `lab_list_files`. I tool generici non escludono segreti, chiavi private,
//   `.git` o altri prototipi e permettono letture arbitrarie sull'intero disco.
// - `browser` / runner web host: RIFIUTATO. Impedisce l'uso del browser reale
//   dell'utente con sessioni autenticate, cookie o download arbitrari.
// - `debug` / `lsp`: RIFIUTATI. Strumenti avanzati di modifica o ispezione non
//   necessari per la prototipazione e potenzialmente mutanti.
// - `mcp__*`: RIFIUTATI. Server MCP e plugin esterni potrebbero esporre canali
//   di scrittura, shell o servizi di rete incontrollati.
// - Qualsiasi tool sconosciuto o futuro: RIFIUTATO (fail-closed).
//
// Caricamento: Studio lancia omp per la sessione Laboratorio con `-e <questo file>`.
// Nessuna scrittura in ~/.omp; l'estensione e' self-contained.

import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";

/* ------------------------------------------------------------- allowlist */

/**
 * Allowlist rigida dei soli tool autorizzati nel Laboratorio.
 * Qualsiasi tool non presente in questo array viene bloccato dall'hook `tool_call`.
 */
export const LAB_TOOL_ALLOWLIST = [
	"lab_write_file",
	"lab_read_file",
	"lab_list_files",
	"lab_delete_file",
	"task",
	"hub",
	"todo",
	"ask"
] as const;

export type LabToolName = (typeof LAB_TOOL_ALLOWLIST)[number];

const LAB_TOOL_ALLOWLIST_SET: ReadonlySet<string> = new Set<string>(LAB_TOOL_ALLOWLIST);

/** Verifica immediata se un tool e' nell'allowlist del Laboratorio. */
export function isAllowedLabTool(toolName: string): boolean {
	return LAB_TOOL_ALLOWLIST_SET.has(toolName);
}

/** Messaggio esplicito e motivato di rifiuto per ciascuna categoria di tool. */
export function formatToolDeniedReason(toolName: string): string {
	switch (toolName) {
		case "bash":
		case "exec":
			return "Tool 'bash' non consentito nel Laboratorio: l'esecuzione di comandi shell e' vietata per isolamento del runtime.";
		case "eval":
			return "Tool 'eval' non consentito nel Laboratorio: l'esecuzione di codice host arbitrario e' vietata.";
		case "write":
			return "Tool 'write' non consentito nel Laboratorio: le scritture generiche sul progetto sono bloccate. Usa 'lab_write_file' per scrivere esclusivamente nel prototipo assegnato.";
		case "edit":
		case "ast_edit":
			return `Tool '${toolName}' non consentito nel Laboratorio: le modifiche al codice del progetto principale sono bloccate. Usa 'lab_write_file' per il prototipo assegnato.`;
		case "read":
		case "glob":
		case "grep":
			return `Tool '${toolName}' non consentito nel Laboratorio: usa i tool controllati 'lab_read_file' e 'lab_list_files' per consultare il contesto consentito escludendo file riservati.`;
		case "browser":
			return "Tool 'browser' non consentito nel Laboratorio: l'uso del browser generico host e' vietato.";
		case "debug":
		case "lsp":
			return `Tool '${toolName}' non consentito nella sessione Laboratorio.`;
		default:
			if (toolName.startsWith("mcp__")) {
				return `Tool MCP '${toolName}' non consentito nel Laboratorio: le integrazioni e i server esterni sono disattivati.`;
			}
			return `Tool '${toolName}' non autorizzato nel Laboratorio (politica fail-closed: sono ammessi solo i tool dell'allowlist controllata).`;
	}
}

/* ----------------------------------------------------------- costanti ID */

const PROTOTYPE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

const RESERVED_DIRECTORY_NAMES: Record<string, true> = {
	con: true,
	prn: true,
	aux: true,
	nul: true,
	com1: true,
	com2: true,
	com3: true,
	com4: true,
	com5: true,
	com6: true,
	com7: true,
	com8: true,
	com9: true,
	lpt1: true,
	lpt2: true,
	lpt3: true,
	lpt4: true,
	lpt5: true,
	lpt6: true,
	lpt7: true,
	lpt8: true,
	lpt9: true
};

export function isReservedFileSystemName(value: string): boolean {
	const base = value.split(".", 1)[0] ?? "";
	return RESERVED_DIRECTORY_NAMES[base.toLowerCase()] === true;
}

export function isLabPrototypeId(value: unknown): value is string {
	if (typeof value !== "string") return false;
	if (!PROTOTYPE_ID_PATTERN.test(value)) return false;
	if (value.endsWith("-")) return false;
	return !isReservedFileSystemName(value);
}

/* ---------------------------------------------------- percorsi e confini */

/**
 * Verifica se `child` e' un discendente di `parent` (o coincide con `parent`).
 */
export function isSubpath(parent: string, child: string): boolean {
	const rel = relative(parent, child);
	return !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Verifica se `child` e' un discendente STRETTO di `parent` (`child !== parent`).
 */
export function isStrictSubpath(parent: string, child: string): boolean {
	const rel = relative(parent, child);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Normalizza e valida sintatticamente un percorso relativo all'interno del prototipo.
 * Rifiuta traversal (`..`), percorsi assoluti, caratteri NUL, cartelle nascoste/configurazione,
 * nomi riservati Windows e segmenti vuoti.
 */
export function isConfinedPrototypeRelativePath(
	relPath: unknown
): { ok: true; normalized: string } | { ok: false; error: string } {
	if (typeof relPath !== "string") {
		return { ok: false, error: "Il percorso deve essere una stringa non vuota." };
	}
	const trimmed = relPath.trim();
	if (trimmed.length === 0) {
		return { ok: false, error: "Il percorso non puo essere vuoto." };
	}
	if (trimmed.length > 260) {
		return { ok: false, error: `Percorso troppo lungo (${trimmed.length} caratteri, max 260).` };
	}
	if (trimmed.includes("\u0000")) {
		return { ok: false, error: "Carattere NUL rilevato nel percorso: tentativo ostile bloccato." };
	}

	// Percorsi assoluti (POSIX '/', Windows 'C:\', o UNC '\\')
	if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
		return { ok: false, error: "Percorso assoluto non consentito; indicare un percorso relativo al prototipo." };
	}
	if (/^[a-zA-Z]:/.test(trimmed)) {
		return { ok: false, error: "Percorso con unita Windows assoluta non consentito." };
	}
	if (/^\\\\[^\\]+/.test(trimmed) || /^\/\/[^\/]+/.test(trimmed)) {
		return { ok: false, error: "Percorso di rete UNC non consentito." };
	}

	// Normalizzazione separatori a '/'
	const normalized = trimmed.replace(/\\/g, "/");
	const segments = normalized.split("/");

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i]!;
		if (seg.length === 0) {
			return { ok: false, error: "Segmento di percorso vuoto (separatori consecutivi o barra finale)." };
		}
		if (seg === "." || seg === "..") {
			return { ok: false, error: "Directory traversal ('.' o '..') non consentito." };
		}
		// Protezione file nascosti, `.git`, `.env`, `.omp`, ecc.
		if (seg.startsWith(".")) {
			return { ok: false, error: `File o cartelle nascosti ('${seg}') non consentiti nel prototipo.` };
		}
		if (seg.endsWith(".")) {
			return { ok: false, error: `Segmento con punto finale ('${seg}') non valido su filesystem Windows.` };
		}
		if (isReservedFileSystemName(seg)) {
			return { ok: false, error: `Nome riservato dal filesystem ('${seg}') non consentito.` };
		}
		if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(seg)) {
			return { ok: false, error: `Caratteri non validi nel segmento '${seg}'.` };
		}
	}

	return { ok: true, normalized: segments.join("/") };
}

/* ------------------------------------------- risoluzione directory prototipo */

export interface ResolvePrototypeDirOptions {
	cwd: string;
	prototypeId: string;
	scope?: "project" | "draft";
	customDraftsDir?: string;
}

export interface ResolvePrototypeDirResult {
	ok: boolean;
	error?: string;
	canonicalPrototypeDir?: string;
	canonicalProjectRoot?: string;
	isDraft?: boolean;
}

/**
 * Risolve e valida in modo reale e canonico la cartella del prototipo assegnato.
 * Verifica che la root del progetto esista, che `proto/` (o drafts) sia confinata,
 * che non sia un symlink verso l'esterno e che il prototipo non sia la root del progetto.
 */
export function resolveCanonicalPrototypeDirectory(
	opts: ResolvePrototypeDirOptions
): ResolvePrototypeDirResult {
	try {
		const { cwd, prototypeId, scope, customDraftsDir } = opts;

		if (!isLabPrototypeId(prototypeId)) {
			return { ok: false, error: `Id di prototipo non valido: ${JSON.stringify(prototypeId)}` };
		}

		let canonicalProjectRoot: string;
		try {
			canonicalProjectRoot = realpathSync(resolve(cwd));
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return { ok: false, error: `Impossibile risolvere la directory di lavoro (${cwd}): ${msg}` };
		}

		const isDraft = scope === "draft";

		if (isDraft) {
			// Modalita bozza locale: radicata in %LOCALAPPDATA%/omp-studio/lab/drafts o custom
			let draftsBase: string;
			if (customDraftsDir) {
				draftsBase = resolve(customDraftsDir);
			} else if (process.platform === "win32" && process.env.LOCALAPPDATA) {
				draftsBase = join(process.env.LOCALAPPDATA, "omp-studio", "lab", "drafts");
			} else if (process.env.HOME) {
				draftsBase = join(process.env.HOME, ".omp-studio", "lab", "drafts");
			} else {
				return { ok: false, error: "Impossibile risolvere la directory per l'archivio delle bozze locali." };
			}

			if (!existsSync(draftsBase)) {
				mkdirSync(draftsBase, { recursive: true });
			}
			const canonicalDraftsBase = realpathSync(draftsBase);
			const targetDir = join(canonicalDraftsBase, prototypeId);

			if (existsSync(targetDir)) {
				const stat = lstatSync(targetDir);
				if (stat.isSymbolicLink()) {
					return { ok: false, error: `La cartella della bozza '${prototypeId}' e un symlink o junction: accesso negato.` };
				}
				const canon = realpathSync(targetDir);
				if (!isStrictSubpath(canonicalDraftsBase, canon)) {
					return { ok: false, error: `La cartella della bozza '${prototypeId}' risolve fuori dall'archivio bozze consentito.` };
				}
				return { ok: true, canonicalPrototypeDir: canon, canonicalProjectRoot, isDraft: true };
			}

			return { ok: true, canonicalPrototypeDir: targetDir, canonicalProjectRoot, isDraft: true };
		}

		// Modalita progetto: confinata in <projectRoot>/proto/<prototypeId>
		const protoDir = join(canonicalProjectRoot, "proto");
		if (existsSync(protoDir)) {
			const statProto = lstatSync(protoDir);
			if (statProto.isSymbolicLink()) {
				return { ok: false, error: "La cartella 'proto/' del progetto e un symlink o junction: operazione bloccata." };
			}
			const canonProto = realpathSync(protoDir);
			if (!isStrictSubpath(canonicalProjectRoot, canonProto)) {
				return { ok: false, error: "La cartella 'proto/' risolve all'esterno della root del progetto: operazione bloccata." };
			}
		}

		const prototypeDir = join(protoDir, prototypeId);

		// Non puo coincidere con la root del progetto
		if (prototypeDir === canonicalProjectRoot) {
			return { ok: false, error: "La cartella del prototipo non puo coincidere con la root del progetto." };
		}

		if (existsSync(prototypeDir)) {
			const statProtoDir = lstatSync(prototypeDir);
			if (statProtoDir.isSymbolicLink()) {
				return { ok: false, error: `La cartella del prototipo '${prototypeId}' e un symlink o junction: operazione bloccata.` };
			}
			const canon = realpathSync(prototypeDir);
			if (!isStrictSubpath(canonicalProjectRoot, canon)) {
				return { ok: false, error: `La cartella del prototipo '${prototypeId}' risolve all'esterno della root del progetto.` };
			}
			if (canon === canonicalProjectRoot) {
				return { ok: false, error: "La cartella del prototipo non puo risolvere alla root del progetto." };
			}
			// Verifica che non sia dentro .git o .omp
			if (canon.includes("/.git") || canon.includes("\\.git") || canon.includes("/.omp") || canon.includes("\\.omp")) {
				return { ok: false, error: "La cartella del prototipo non puo trovarsi dentro .git o .omp." };
			}
			return { ok: true, canonicalPrototypeDir: canon, canonicalProjectRoot, isDraft: false };
		}

		return { ok: true, canonicalPrototypeDir: prototypeDir, canonicalProjectRoot, isDraft: false };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Errore durante la risoluzione del prototipo: ${msg}` };
	}
}

/* ------------------------------------------- validazione percorsi scrittura */

export interface ValidateLabPathOptions {
	cwd: string;
	prototypeId: string;
	relativePath: string;
	scope?: "project" | "draft";
	customDraftsDir?: string;
}

export interface LabPathValidationResult {
	ok: boolean;
	error?: string;
	targetPath?: string;
	canonicalPrototypeDir?: string;
	normalizedRelativePath?: string;
}

/**
 * Valida un percorso di scrittura dentro il prototipo assegnato con risoluzione reale.
 *
 * Requisiti coperti:
 * - Traversal sintattico (`..`) e percorsi assoluti
 * - Ispezione reale segment-by-segment: se un segmento esistente e' un symlink o junction, o
 *   se il realpath esce dal prototipo -> RIFIUTO IMMEDIATO
 * - Se il file foglia esiste ed e' un symlink o junction -> RIFIUTO IMMEDIATO
 * - Divieto di toccare la root del progetto, `.git`, `.omp` o altri prototipi
 * - Fail-closed su qualsiasi eccezione
 */
export function validateLabPrototypePath(opts: ValidateLabPathOptions): LabPathValidationResult {
	try {
		const { cwd, prototypeId, relativePath, scope, customDraftsDir } = opts;

		// 1. Validazione sintattica del percorso relativo
		const relValidation = isConfinedPrototypeRelativePath(relativePath);
		if (!relValidation.ok) {
			return { ok: false, error: relValidation.error };
		}
		const normalizedRel = relValidation.normalized;

		// 2. Risoluzione canonica della directory del prototipo
		const dirRes = resolveCanonicalPrototypeDirectory({
			cwd,
			prototypeId,
			scope,
			customDraftsDir
		});
		if (!dirRes.ok || !dirRes.canonicalPrototypeDir) {
			return { ok: false, error: dirRes.error ?? "Risoluzione directory prototipo fallita." };
		}
		const canonicalProtoDir = dirRes.canonicalPrototypeDir;

		// 3. Verifica contenimento lessicale
		const targetPath = join(canonicalProtoDir, normalizedRel);
		if (!isStrictSubpath(canonicalProtoDir, targetPath)) {
			return {
				ok: false,
				error: `Il percorso '${normalizedRel}' fuoriesce dai confini del prototipo '${prototypeId}'.`
			};
		}

		// 4. Ispezione segmento per segmento sul filesystem reale per intercettare symlink/junction
		const segments = normalizedRel.split("/");
		let currentPath = canonicalProtoDir;

		// Se la directory del prototipo esiste gia', controlliamo ogni suo segmento discendente
		if (existsSync(canonicalProtoDir)) {
			for (let i = 0; i < segments.length; i++) {
				currentPath = join(currentPath, segments[i]!);

				if (existsSync(currentPath)) {
					const stat = lstatSync(currentPath);
					if (stat.isSymbolicLink()) {
						return {
							ok: false,
							error: `Rilevato symlink o junction nel percorso del prototipo ('${segments[i]}'): operazione bloccata per sicurezza.`
						};
					}
					const realSegment = realpathSync(currentPath);
					if (!isSubpath(canonicalProtoDir, realSegment)) {
						return {
							ok: false,
							error: `Il percorso reale ('${realSegment}') fuoriesce dai confini del prototipo assegnato.`
						};
					}
				}
			}
		}

		// 5. Se il file foglia esiste gia', controlla che non sia un symlink
		if (existsSync(targetPath)) {
			const statLeaf = lstatSync(targetPath);
			if (statLeaf.isSymbolicLink()) {
				return {
					ok: false,
					error: `Il file di destinazione '${normalizedRel}' e' un symlink o junction: sovrascrittura vietata.`
				};
			}
			const realLeaf = realpathSync(targetPath);
			if (!isStrictSubpath(canonicalProtoDir, realLeaf)) {
				return {
					ok: false,
					error: `Il file di destinazione reale ('${realLeaf}') fuoriesce dai confini del prototipo.`
				};
			}
		}

		return {
			ok: true,
			targetPath,
			canonicalPrototypeDir: canonicalProtoDir,
			normalizedRelativePath: normalizedRel
		};
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Errore fail-closed durante la validazione del percorso: ${msg}` };
	}
}

/* --------------------------------------------- validazione percorsi lettura */

export interface ValidateLabReadPathOptions {
	cwd: string;
	prototypeId?: string;
	relativePath: string;
	scope?: "prototype" | "project";
	customDraftsDir?: string;
	customContextDir?: string;
}

export interface LabReadPathValidationResult {
	ok: boolean;
	error?: string;
	targetPath?: string;
	isProjectScope?: boolean;
}

const FORBIDDEN_PROJECT_READ_PATTERNS = [
	/(^|\/|\/)\.git(\/|\\|$)/i,
	/(^|\/|\/)\.env(\..+)?$/i,
	/(^|\/|\/)\.omp(-studio)?(\/|\\|$)/i,
	/\.(pem|key|pfx|pkcs12)$/i,
	/(^|\/|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
	/(^|\/|\/)(credentials|secret|token|password|auth_credentials)(\..+)?$/i
];

/**
 * Valida un percorso di lettura per il contesto consentito.
 * Se scope e' 'prototype', delega al perimetro del prototipo.
 * Se scope e' 'project', permette la lettura in sola lettura di file di contesto del progetto,
 * bloccando categoricamente file `.git`, segreti, chiavi, `.env*` e altri prototipi.
 */
export function validateLabReadPath(opts: ValidateLabReadPathOptions): LabReadPathValidationResult {
	try {
		const { cwd, prototypeId, relativePath, scope = "prototype", customDraftsDir } = opts;

		if (typeof relativePath !== "string" || relativePath.trim().length === 0) {
			return { ok: false, error: "Percorso di lettura non valido o vuoto." };
		}
		if (relativePath.includes("\u0000")) {
			return { ok: false, error: "Carattere NUL rilevato nel percorso di lettura." };
		}

		const normalizedRel = relativePath.trim().replace(/\\/g, "/");

		// Lettura nel prototipo
		if (scope === "prototype") {
			if (!prototypeId) {
				return { ok: false, error: "prototypeId obbligatorio per lettura in ambito 'prototype'." };
			}
			const writeVal = validateLabPrototypePath({
				cwd,
				prototypeId,
				relativePath: normalizedRel,
				customDraftsDir
			});
			if (!writeVal.ok || !writeVal.targetPath) {
				return { ok: false, error: writeVal.error ?? "Validazione percorso prototipo fallita." };
			}
			return { ok: true, targetPath: writeVal.targetPath, isProjectScope: false };
		}

		// Lettura in ambito 'project' (contesto di sola lettura)
		if (normalizedRel.startsWith("/") || /^[a-zA-Z]:/.test(normalizedRel)) {
			return { ok: false, error: "Percorso assoluto non consentito per la lettura del contesto di progetto." };
		}

		// Traversal check
		const segments = normalizedRel.split("/");
		if (segments.some((s) => s === ".." || s === ".")) {
			return { ok: false, error: "Directory traversal ('..' o '.') non consentito nella lettura del contesto." };
		}

		// Protezione segreti e cartelle riservate
		for (const pattern of FORBIDDEN_PROJECT_READ_PATTERNS) {
			if (pattern.test(normalizedRel)) {
				return {
					ok: false,
					error: `Accesso negato: il file '${normalizedRel}' rientra nei file riservati/segreti esclusi dal contesto.`
				};
			}
		}

		// Se il percorso punta dentro 'proto/', non puo accedere ad altri prototipi
		if (segments[0] === "proto") {
			if (segments.length > 1) {
				const targetProto = segments[1];
				if (prototypeId && targetProto !== prototypeId) {
					return {
						ok: false,
						error: `Accesso negato: non e' consentito leggere dati di altri prototipi ('proto/${targetProto}').`
					};
				}
			}
		}

		let canonicalProjectRoot: string;
		try {
			canonicalProjectRoot = realpathSync(resolve(cwd));
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return { ok: false, error: `Impossibile risolvere la directory di lavoro: ${msg}` };
		}

		const targetPath = join(canonicalProjectRoot, normalizedRel);
		if (!isSubpath(canonicalProjectRoot, targetPath)) {
			return { ok: false, error: "Il percorso di lettura fuoriesce dalla root del progetto." };
		}

		if (existsSync(targetPath)) {
			const stat = lstatSync(targetPath);
			if (stat.isSymbolicLink()) {
				return { ok: false, error: "Il file di contesto richiesto e' un symlink o junction: lettura vietata." };
			}
			const real = realpathSync(targetPath);
			if (!isSubpath(canonicalProjectRoot, real)) {
				return { ok: false, error: "Il file di contesto risolve al di fuori del progetto: lettura vietata." };
			}
			for (const pattern of FORBIDDEN_PROJECT_READ_PATTERNS) {
				if (pattern.test(real)) {
					return { ok: false, error: "Il percorso reale punta a un file riservato o segreto." };
				}
			}
		}

		return { ok: true, targetPath, isProjectScope: true };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Errore fail-closed durante la validazione di lettura: ${msg}` };
	}
}

/* --------------------------------------------- esecutori tool controllati */

export interface ExecuteLabWriteOptions {
	cwd: string;
	prototypeId: string;
	relativePath: string;
	content: string;
	scope?: "project" | "draft";
	customDraftsDir?: string;
}

/**
 * Scrive un file dentro il prototipo in modo atomico e confinato.
 */
export function executeLabWriteFile(opts: ExecuteLabWriteOptions): {
	ok: boolean;
	error?: string;
	bytesWritten?: number;
	resolvedPath?: string;
} {
	const val = validateLabPrototypePath({
		cwd: opts.cwd,
		prototypeId: opts.prototypeId,
		relativePath: opts.relativePath,
		scope: opts.scope,
		customDraftsDir: opts.customDraftsDir
	});

	if (!val.ok || !val.targetPath || !val.canonicalPrototypeDir) {
		return { ok: false, error: val.error ?? "Validazione percorso fallita." };
	}

	const targetPath = val.targetPath;
	const parentDir = dirname(targetPath);

	try {
		// Creazione sicura della directory del prototipo e delle cartelle padre
		if (!existsSync(parentDir)) {
			mkdirSync(parentDir, { recursive: true });
		}

		// Creazione file temporaneo nella stessa cartella per rename atomico
		const tmpSlug = `.${basename(targetPath)}.tmp.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`;
		const tmpFile = join(parentDir, tmpSlug);

		writeFileSync(tmpFile, opts.content, "utf8");

		// Verifica che il temporaneo non sia stato dirottato
		const tmpStat = lstatSync(tmpFile);
		if (tmpStat.isSymbolicLink()) {
			try {
				unlinkSync(tmpFile);
			} catch {}
			return { ok: false, error: "Il file temporaneo creato risulta essere un symlink: operazione abortita." };
		}

		// Se il target esiste gia', riverifica che non sia un symlink prima di sovrascriverlo
		if (existsSync(targetPath)) {
			const targetStat = lstatSync(targetPath);
			if (targetStat.isSymbolicLink()) {
				try {
					unlinkSync(tmpFile);
				} catch {}
				return { ok: false, error: "Il file di destinazione e' un symlink o junction: operazione bloccata." };
			}
		}

		// Sostituzione atomica
		try {
			renameSync(tmpFile, targetPath);
		} catch {
			// Su Windows rename puo fallire se il target esiste gia'
			try {
				unlinkSync(targetPath);
			} catch {}
			renameSync(tmpFile, targetPath);
		}

		const bytesWritten = Buffer.byteLength(opts.content, "utf8");
		return { ok: true, bytesWritten, resolvedPath: targetPath };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Errore I/O durante la scrittura atomica: ${msg}` };
	}
}

export interface ExecuteLabReadOptions {
	cwd: string;
	prototypeId?: string;
	relativePath: string;
	scope?: "prototype" | "project";
	customDraftsDir?: string;
	customContextDir?: string;
}

export interface ExecuteLabReadResult {
	ok: boolean;
	error?: string;
	content?: string;
	resolvedPath?: string;
	fromSnapshot?: boolean;
	snapshotId?: string;
	fingerprint?: string;
}

export function resolveContextBaseDir(customContextDir?: string): string {
	if (customContextDir) {
		return resolve(customContextDir);
	}
	if (process.platform === "win32" && process.env.LOCALAPPDATA) {
		return join(process.env.LOCALAPPDATA, "omp-studio", "lab", "context");
	}
	if (process.env.HOME) {
		return join(process.env.HOME, ".omp-studio", "lab", "context");
	}
	return resolve(".omp-studio-lab-context");
}

export function findPrototypeSnapshotDir(baseDir: string, prototypeId: string, maxDepth = 4): string | null {
	if (!existsSync(baseDir)) return null;
	const direct = join(baseDir, prototypeId);
	if (existsSync(join(direct, "snapshot.json"))) return direct;

	if (maxDepth <= 0) return null;

	try {
		const entries = readdirSync(baseDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory() && !entry.name.startsWith(".")) {
				const nested = findPrototypeSnapshotDir(join(baseDir, entry.name), prototypeId, maxDepth - 1);
				if (nested) return nested;
			}
		}
	} catch {
		// directory non leggibile
	}

	return null;
}

export function findContextSnapshotFile(
	contextBase: string,
	prototypeId: string,
	normalizedRelPath: string
): { content: string; fingerprint: string; snapshotId: string } | null {
	if (!existsSync(contextBase)) return null;

	const snapshotDir = findPrototypeSnapshotDir(contextBase, prototypeId);
	if (!snapshotDir) return null;

	const snapPath = join(snapshotDir, "snapshot.json");
	if (!existsSync(snapPath)) return null;

	try {
		const raw = readFileSync(snapPath, "utf8");
		const snapshot = JSON.parse(raw);
		if (snapshot && Array.isArray(snapshot.files)) {
			const fileEntry = snapshot.files.find(
				(f: { path?: string }) => f.path === normalizedRelPath
			);
			if (fileEntry && typeof fileEntry.fingerprint === "string") {
				const fp = fileEntry.fingerprint;
				const hex = fp.startsWith("sha256:") ? fp.slice("sha256:".length) : fp;
				const localBlob = join(snapshotDir, "blobs", `${hex}.blob`);
				const parentBlob = join(dirname(snapshotDir), "blobs", `${hex}.blob`);
				const sharedBlob = join(contextBase, "blobs", `${hex}.blob`);
				const blobPath = existsSync(localBlob) ? localBlob : existsSync(parentBlob) ? parentBlob : existsSync(sharedBlob) ? sharedBlob : null;
				if (blobPath) {
					const content = readFileSync(blobPath, "utf8");
					return {
						content,
						fingerprint: fp,
						snapshotId: typeof snapshot.id === "string" ? snapshot.id : "unknown"
					};
				}
			}
		}
	} catch {
		// json non valido, ignora
	}

	return null;
}

export interface ExecuteLabContextStatusOptions {
	cwd: string;
	prototypeId: string;
	customContextDir?: string;
}

export function executeLabContextStatus(opts: ExecuteLabContextStatusOptions): {
	ok: boolean;
	error?: string;
	snapshot?: {
		id: string;
		prototypeId: string;
		capturedAt: number;
		coherent: boolean;
		fileCount: number;
	};
	hasChanges?: boolean;
	changedPaths?: string[];
	modifiedPaths?: string[];
	deletedPaths?: string[];
	details?: Array<{
		path: string;
		status: "unchanged" | "modified" | "deleted";
		snapshotFingerprint: string;
		currentFingerprint?: string;
	}>;
} {
	try {
		const contextBase = resolveContextBaseDir(opts.customContextDir);
		let canonicalProjectRoot: string;
		try {
			canonicalProjectRoot = realpathSync(resolve(opts.cwd));
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return { ok: false, error: `Impossibile risolvere la directory di lavoro: ${msg}` };
		}

		if (!existsSync(contextBase)) {
			return { ok: false, error: "Nessun archivio contesto trovato." };
		}

		const snapshotDir = findPrototypeSnapshotDir(contextBase, opts.prototypeId);
		if (!snapshotDir) {
			return { ok: false, error: `Nessuno snapshot di contesto trovato per '${opts.prototypeId}'.` };
		}

		const raw = readFileSync(join(snapshotDir, "snapshot.json"), "utf8");
		const snapshot = JSON.parse(raw);
		if (!snapshot || !Array.isArray(snapshot.files)) {
			return { ok: false, error: "Snapshot di contesto corrotto o non valido." };
		}

		const details: Array<{
			path: string;
			status: "unchanged" | "modified" | "deleted";
			snapshotFingerprint: string;
			currentFingerprint?: string;
		}> = [];
		const changedPaths: string[] = [];
		const modifiedPaths: string[] = [];
		const deletedPaths: string[] = [];

		for (const file of snapshot.files) {
			const relPath = file.path;
			const targetPath = join(canonicalProjectRoot, relPath);
			if (!existsSync(targetPath)) {
				details.push({
					path: relPath,
					status: "deleted",
					snapshotFingerprint: file.fingerprint
				});
				changedPaths.push(relPath);
				deletedPaths.push(relPath);
			} else {
				const currentBytes = readFileSync(targetPath);
				const hex = createHash("sha256").update(currentBytes).digest("hex");
				const currentFp = `sha256:${hex}`;
				if (currentFp !== file.fingerprint) {
					details.push({
						path: relPath,
						status: "modified",
						snapshotFingerprint: file.fingerprint,
						currentFingerprint: currentFp
					});
					changedPaths.push(relPath);
					modifiedPaths.push(relPath);
				} else {
					details.push({
						path: relPath,
						status: "unchanged",
						snapshotFingerprint: file.fingerprint,
						currentFingerprint: currentFp
					});
				}
			}
		}

		return {
			ok: true,
			snapshot: {
				id: snapshot.id,
				prototypeId: snapshot.prototypeId,
				capturedAt: snapshot.capturedAt,
				coherent: snapshot.coherent,
				fileCount: snapshot.files.length
			},
			hasChanges: changedPaths.length > 0,
			changedPaths: changedPaths.sort(),
			modifiedPaths: modifiedPaths.sort(),
			deletedPaths: deletedPaths.sort(),
			details
		};
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Errore durante la verifica della deriva di contesto: ${msg}` };
	}
}

/**
 * Legge un file all'interno del contesto consentito (prototipo o progetto).
 * Se per un prototipo e' stato acquisito un contesto stabile e il file vi appartiene,
 * restituisce la versione congelata nello snapshot anche se il file su disco e' cambiato.
 */
export function executeLabReadFile(opts: ExecuteLabReadOptions): ExecuteLabReadResult {
	const val = validateLabReadPath({
		cwd: opts.cwd,
		prototypeId: opts.prototypeId,
		relativePath: opts.relativePath,
		scope: opts.scope,
		customDraftsDir: opts.customDraftsDir,
		customContextDir: opts.customContextDir
	});

	if (!val.ok || !val.targetPath) {
		return { ok: false, error: val.error ?? "Validazione lettura fallita." };
	}

	const normalizedRel = opts.relativePath.trim().replace(/\\/g, "/");

	// 1. Stato del contesto virtuale
	if (opts.scope === "project" && opts.prototypeId && (normalizedRel === ".lab/context/status" || normalizedRel === ".lab/context/snapshot.json")) {
		const status = executeLabContextStatus({
			cwd: opts.cwd,
			prototypeId: opts.prototypeId,
			customContextDir: opts.customContextDir
		});
		return {
			ok: true,
			content: JSON.stringify(status, null, 2),
			resolvedPath: val.targetPath,
			fromSnapshot: true
		};
	}

	// 2. Se e' una lettura di contesto di progetto, verifica se il file e' presente nello snapshot stabile
	if (opts.scope === "project" && opts.prototypeId) {
		const contextBase = resolveContextBaseDir(opts.customContextDir);
		const snapFile = findContextSnapshotFile(contextBase, opts.prototypeId, normalizedRel);
		if (snapFile) {
			return {
				ok: true,
				content: snapFile.content,
				resolvedPath: val.targetPath,
				fromSnapshot: true,
				snapshotId: snapFile.snapshotId,
				fingerprint: snapFile.fingerprint
			};
		}
	}

	try {
		if (!existsSync(val.targetPath)) {
			return { ok: false, error: `File non trovato: '${opts.relativePath}'.` };
		}
		const stat = lstatSync(val.targetPath);
		if (!stat.isFile()) {
			return { ok: false, error: `Il percorso '${opts.relativePath}' non e' un file regolare.` };
		}
		const content = readFileSync(val.targetPath, "utf8");
		return { ok: true, content, resolvedPath: val.targetPath };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Errore durante la lettura del file: ${msg}` };
	}
}

export interface ExecuteLabListOptions {
	cwd: string;
	prototypeId?: string;
	relativePath?: string;
	scope?: "prototype" | "project";
	customDraftsDir?: string;
}

export interface LabListEntry {
	name: string;
	kind: "file" | "directory" | "other";
}

/**
 * Elenca i file in una cartella consentita del prototipo o del progetto.
 */
export function executeLabListFiles(opts: ExecuteLabListOptions): {
	ok: boolean;
	error?: string;
	entries?: LabListEntry[];
} {
	const rel = opts.relativePath ?? "";
	const val = validateLabReadPath({
		cwd: opts.cwd,
		prototypeId: opts.prototypeId,
		relativePath: rel.length === 0 ? (opts.scope === "project" ? "." : "src") : rel,
		scope: opts.scope,
		customDraftsDir: opts.customDraftsDir
	});

	if (!val.ok || !val.targetPath) {
		return { ok: false, error: val.error ?? "Validazione cartella fallita." };
	}

	try {
		if (!existsSync(val.targetPath)) {
			return { ok: false, error: `Cartella non trovata: '${rel}'.` };
		}
		const dirStat = lstatSync(val.targetPath);
		if (!dirStat.isDirectory()) {
			return { ok: false, error: `Il percorso '${rel}' non e' una cartella.` };
		}

		const rawEntries = readdirSync(val.targetPath, { withFileTypes: true });
		const entries: LabListEntry[] = [];

		for (const dirent of rawEntries) {
			const name = dirent.name;
			// Se scope e' project, nascondi elementi riservati
			if (opts.scope === "project") {
				if (name.startsWith(".") || name === "proto" || isReservedFileSystemName(name)) {
					continue;
				}
			}
			if (dirent.isSymbolicLink()) {
				// Segnala symlink come other per prevenire navigazione accidentale
				entries.push({ name, kind: "other" });
			} else if (dirent.isDirectory()) {
				entries.push({ name, kind: "directory" });
			} else if (dirent.isFile()) {
				entries.push({ name, kind: "file" });
			}
		}

		return { ok: true, entries };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Errore durante l'elenco dei file: ${msg}` };
	}
}

export interface ExecuteLabDeleteOptions {
	cwd: string;
	prototypeId: string;
	relativePath: string;
	scope?: "project" | "draft";
	customDraftsDir?: string;
}

/**
 * Elimina un file dentro il prototipo assegnato.
 */
export function executeLabDeleteFile(opts: ExecuteLabDeleteOptions): {
	ok: boolean;
	error?: string;
	deletedPath?: string;
} {
	const val = validateLabPrototypePath({
		cwd: opts.cwd,
		prototypeId: opts.prototypeId,
		relativePath: opts.relativePath,
		scope: opts.scope,
		customDraftsDir: opts.customDraftsDir
	});

	if (!val.ok || !val.targetPath) {
		return { ok: false, error: val.error ?? "Validazione percorso fallita." };
	}

	try {
		if (!existsSync(val.targetPath)) {
			return { ok: true, deletedPath: val.targetPath }; // Idempotente
		}
		const stat = lstatSync(val.targetPath);
		if (stat.isSymbolicLink()) {
			return { ok: false, error: "Impossibile eliminare un symlink o junction: operazione bloccata." };
		}
		if (stat.isDirectory()) {
			rmSync(val.targetPath, { recursive: true, force: true });
		} else {
			unlinkSync(val.targetPath);
		}
		return { ok: true, deletedPath: val.targetPath };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Errore durante l'eliminazione: ${msg}` };
	}
}

/* -------------------------------------------------- hook tool_call gate */

export interface LabHookEnvironment {
	getAssignedPrototypeId: () => string | undefined;
	getCwd: () => string;
	getScope?: () => "project" | "draft";
	customDraftsDir?: string;
	customContextDir?: string;
}

export interface ToolCallEventResult {
	block?: boolean;
	reason?: string;
}

/**
 * Crea l'intercettore per l'hook `tool_call` di OMP.
 * Applica:
 * 1. Allowlist rigida dei soli tool consentiti (blocco per difetto).
 * 2. Pre-validazione degli argomenti per `lab_write_file` e `lab_delete_file`.
 * 3. Isolamento del prototipo: rifiuta richieste che indicano un id diverso
 *    da quello assegnato alla sessione.
 * 4. Fail-closed: qualsiasi errore non gestito ritorna `{ block: true }`.
 */
export function createLabToolCallHook(env: LabHookEnvironment) {
	return async function handleLabToolCall(event: {
		toolName: string;
		input?: Record<string, unknown>;
	}): Promise<ToolCallEventResult | undefined> {
		try {
			const toolName = event.toolName;

			// 1. Verifica allowlist
			if (!isAllowedLabTool(toolName)) {
				return {
					block: true,
					reason: formatToolDeniedReason(toolName)
				};
			}

			const assignedProtoId = env.getAssignedPrototypeId() || process.env.OMP_LAB_PROTOTYPE_ID;
			const input = event.input || {};

			// 2. Controllo coerenza prototypeId se specificato
			const requestedProtoId = typeof input.prototypeId === "string" ? input.prototypeId : undefined;
			if (assignedProtoId && requestedProtoId && requestedProtoId !== assignedProtoId) {
				return {
					block: true,
					reason: `Conflitto di prototipo: la sessione e' vincolata a '${assignedProtoId}', accesso a '${requestedProtoId}' negato.`
				};
			}

			// 3. Pre-validazione percorso per operazioni di scrittura/cancellazione
			if (toolName === "lab_write_file" || toolName === "lab_delete_file") {
				const effectiveProtoId = requestedProtoId || assignedProtoId;
				if (!effectiveProtoId) {
					return {
						block: true,
						reason: "Nessun prototipo assegnato alla sessione corrente per l'operazione di scrittura."
					};
				}

				const relPath = typeof input.path === "string" ? input.path : "";
				const relCheck = isConfinedPrototypeRelativePath(relPath);
				if (!relCheck.ok) {
					return {
						block: true,
						reason: `Percorso non valido per '${toolName}': ${relCheck.error}`
					};
				}

				// Esegue la verifica reale
				const cwd = env.getCwd();
				const pathVal = validateLabPrototypePath({
					cwd,
					prototypeId: effectiveProtoId,
					relativePath: relCheck.normalized,
					scope: env.getScope ? env.getScope() : undefined,
					customDraftsDir: env.customDraftsDir
				});

				if (!pathVal.ok) {
					return {
						block: true,
						reason: `Blocco di sicurezza nel perimetro prototipo: ${pathVal.error}`
					};
				}
			}

			// Tool autorizzato e verificato
			return undefined;
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				block: true,
				reason: `Fail-closed di sicurezza nel Laboratorio: errore inatteso durante l'ispezione del tool call: ${msg}`
			};
		}
	};
}

/* ---------------------------------------------------- estensione OMP API */

// Tipi minimi per l'interfaccia dell'estensione OMP
interface ExtensionToolContext {
	sessionManager?: {
		getCwd?: () => string;
		getSessionId?: () => string;
	};
}

interface ExtensionZodObject {
	describe: (desc: string) => ExtensionZodObject;
	optional: () => ExtensionZodObject;
}

interface ExtensionZodBuilder {
	object: (shape: Record<string, unknown>) => ExtensionZodObject;
	string: () => ExtensionZodObject;
}

interface ExtensionApi {
	zod?: ExtensionZodBuilder;
	registerTool: (toolDef: {
		name: string;
		label: string;
		description: string;
		parameters: unknown;
		approval?: "none" | "read" | "write";
		execute: (
			toolCallId: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
			onUpdate?: unknown,
			ctx?: ExtensionToolContext
		) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
	}) => void;
	on?: (
		eventName: "tool_call",
		handler: (
			event: { toolName: string; input?: Record<string, unknown> },
			ctx?: unknown
		) => Promise<ToolCallEventResult | undefined> | ToolCallEventResult | undefined
	) => void;
}

function textResult(text: string): { content: { type: "text"; text: string }[]; isError?: boolean } {
	return { content: [{ type: "text", text }] };
}

function errorResult(text: string): { content: { type: "text"; text: string }[]; isError: true } {
	return { content: [{ type: "text", text }], isError: true };
}

/**
 * Entry point predefinito dell'estensione OMP per il Laboratorio.
 * Registra i 4 tool controllati e l'hook `tool_call` con allowlist e rifiuto per difetto.
 */
export default function studioLabExtension(pi: ExtensionApi): void {
	// Gestione runtime dell'id prototipo associato alla sessione
	let sessionPrototypeId: string | undefined = process.env.OMP_LAB_PROTOTYPE_ID;
	const sessionScope: "project" | "draft" = process.env.OMP_LAB_SCOPE === "draft" ? "draft" : "project";

	const env: LabHookEnvironment = {
		getAssignedPrototypeId: () => sessionPrototypeId,
		getCwd: () => process.cwd(),
		getScope: () => sessionScope
	};

	// 1. Registrazione hook `tool_call`
	if (typeof pi.on === "function") {
		const hook = createLabToolCallHook(env);
		pi.on("tool_call", async (event, _ctx) => {
			return await hook(event);
		});
	}

	// Helper per creare i parametri Zod se disponibile
	const z = pi.zod;
	const writeParams = z
		? z.object({
				path: z.string().describe("Percorso relativo del file dentro il prototipo assegnato (es. 'src/App.tsx')"),
				content: z.string().describe("Contenuto testuale completo da scrivere nel file"),
				prototypeId: z.string().optional().describe("Id del prototipo assegnato (predefinito quello della sessione)")
			})
		: undefined;

	const readParams = z
		? z.object({
				path: z.string().describe("Percorso relativo del file da leggere"),
				scope: z.string().optional().describe("Ambito di lettura: 'prototype' (predefinito) o 'project' (contesto in sola lettura)"),
				prototypeId: z.string().optional().describe("Id del prototipo assegnato")
			})
		: undefined;

	const listParams = z
		? z.object({
				path: z.string().optional().describe("Sottocartella relativa da esplorare (predefinita radice del prototipo o del progetto)"),
				scope: z.string().optional().describe("Ambito: 'prototype' (predefinito) o 'project'"),
				prototypeId: z.string().optional().describe("Id del prototipo assegnato")
			})
		: undefined;

	const deleteParams = z
		? z.object({
				path: z.string().describe("Percorso relativo del file da eliminare dentro il prototipo assegnato"),
				prototypeId: z.string().optional().describe("Id del prototipo assegnato")
			})
		: undefined;

	// 2. Registrazione tool controllato: `lab_write_file`
	pi.registerTool({
		name: "lab_write_file",
		label: "Scrittura confinata prototipo",
		description:
			"Scrive in modo atomico e confinato un file all'interno del prototipo assegnato. Rifiuta categoricamente qualsiasi percorso al di fuori del prototipo, traversal, symlink o scritture alla root del progetto.",
		parameters: writeParams,
		approval: "write",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx?.sessionManager?.getCwd?.() || process.cwd();
			const relPath = typeof params.path === "string" ? params.path : "";
			const content = typeof params.content === "string" ? params.content : "";
			const protoId = typeof params.prototypeId === "string" ? params.prototypeId : sessionPrototypeId;

			if (!protoId) {
				return errorResult("Errore: nessun prototipo assegnato alla sessione corrente per la scrittura.");
			}
			if (sessionPrototypeId && protoId !== sessionPrototypeId) {
				return errorResult(`Errore di sicurezza: la sessione e vincolata a '${sessionPrototypeId}', accesso a '${protoId}' negato.`);
			}

			// Aggiorna sessionPrototypeId se era assente
			if (!sessionPrototypeId) {
				sessionPrototypeId = protoId;
			}

			const res = executeLabWriteFile({
				cwd,
				prototypeId: protoId,
				relativePath: relPath,
				content,
				scope: sessionScope
			});

			if (!res.ok) {
				return errorResult(`Errore scrittura file: ${res.error}`);
			}

			return textResult(`File '${relPath}' scritto con successo nel prototipo '${protoId}' (${res.bytesWritten} byte).`);
		}
	});

	// 3. Registrazione tool controllato: `lab_read_file`
	pi.registerTool({
		name: "lab_read_file",
		label: "Lettura contesto prototipo/progetto",
		description:
			"Legge un file nel prototipo assegnato o nel contesto consentito del progetto in sola lettura. Esclude categoricamente .git, file di configurazione, credenziali e file segreti.",
		parameters: readParams,
		approval: "read",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx?.sessionManager?.getCwd?.() || process.cwd();
			const relPath = typeof params.path === "string" ? params.path : "";
			const scope = params.scope === "project" ? "project" : "prototype";
			const protoId = typeof params.prototypeId === "string" ? params.prototypeId : sessionPrototypeId;

			if (scope === "prototype" && !protoId) {
				return errorResult("Errore: nessun prototipo specificato o associato per la lettura del prototipo.");
			}

			const res = executeLabReadFile({
				cwd,
				prototypeId: protoId,
				relativePath: relPath,
				scope
			});

			if (!res.ok) {
				return errorResult(`Errore lettura file: ${res.error}`);
			}

			return textResult(res.content ?? "");
		}
	});

	// 4. Registrazione tool controllato: `lab_list_files`
	pi.registerTool({
		name: "lab_list_files",
		label: "Elenco file prototipo/progetto",
		description:
			"Elenca in sicurezza i file presenti nel prototipo assegnato o in una cartella di contesto del progetto, escludendo elementi riservati.",
		parameters: listParams,
		approval: "read",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx?.sessionManager?.getCwd?.() || process.cwd();
			const relPath = typeof params.path === "string" ? params.path : "";
			const scope = params.scope === "project" ? "project" : "prototype";
			const protoId = typeof params.prototypeId === "string" ? params.prototypeId : sessionPrototypeId;

			const res = executeLabListFiles({
				cwd,
				prototypeId: protoId,
				relativePath: relPath,
				scope
			});

			if (!res.ok) {
				return errorResult(`Errore elenco file: ${res.error}`);
			}

			const formatted = (res.entries ?? [])
				.map((e) => `[${e.kind === "directory" ? "DIR " : "FILE"}] ${e.name}`)
				.join("\n");
			return textResult(formatted || "(cartella vuota)");
		}
	});

	// 5. Registrazione tool controllato: `lab_delete_file`
	pi.registerTool({
		name: "lab_delete_file",
		label: "Eliminazione file prototipo",
		description: "Elimina in modo sicuro un file dentro il solo prototipo assegnato.",
		parameters: deleteParams,
		approval: "write",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx?.sessionManager?.getCwd?.() || process.cwd();
			const relPath = typeof params.path === "string" ? params.path : "";
			const protoId = typeof params.prototypeId === "string" ? params.prototypeId : sessionPrototypeId;

			if (!protoId) {
				return errorResult("Errore: nessun prototipo specificato o associato per l'eliminazione.");
			}
			if (sessionPrototypeId && protoId !== sessionPrototypeId) {
				return errorResult(`Errore di sicurezza: la sessione e vincolata a '${sessionPrototypeId}', accesso a '${protoId}' negato.`);
			}

			const res = executeLabDeleteFile({
				cwd,
				prototypeId: protoId,
				relativePath: relPath,
				scope: sessionScope
			});

			if (!res.ok) {
				return errorResult(`Errore eliminazione file: ${res.error}`);
			}

			return textResult(`File '${relPath}' eliminato dal prototipo '${protoId}'.`);
		}
	});
}
