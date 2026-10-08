// Estensione OMP: diario di bordo e documenti di progetto (Gate R3X-diario).
//
// Fornisce:
// 1. Tool agente `project_docs` (list / read / search / update / sources / init):
//    l'agente consulta il diario e i documenti tematici quando servono e li
//    aggiorna da solo a fine task, citando la fonte (sessione o commit).
// 2. Slash command `/diario`:
//    `/diario init` inizializza il diario (legge la documentazione esistente,
//    il git log e lo storico delle sessioni; su un progetto vuoto fa
//    un'intervista), `/diario aggiorna` chiede un aggiornamento adesso,
//    `/diario locale` e `/diario repo` spostano i file fuori o dentro git,
//    `/diario <domanda>` interroga il diario.
// 3. Una riga nel prompt di sistema (hook `before_agent_start`), solo per i
//    progetti con il diario attivo: il resto si legge su richiesta.
//
// Dove vivono i file (default, versionati): `docs/diario/AAAA-MM.md` e
// `docs/progetto/{scopo,uso,decisioni,storia,domande-aperte}.md`. Il manifest
// `.omp/progetto.json` puo' mappare un ruolo su un documento gia' esistente
// (es. `decisioni -> docs/DECISIONS.md`) e scegliere `storage: "local"`, che
// sposta tutto in `.omp/progetto/` e lo esclude da git con `.omp/.gitignore`.
// Lo stato macchina (impronte delle sezioni scritte dall'agente) sta in
// `.omp/progetto-stato.json`, sempre fuori da git. Nulla in `~/.omp`: lo
// storico delle sessioni di omp si legge e basta.
//
// Le righe modificate a mano non si sovrascrivono: `update` con
// `replace_section` rifiuta se la sezione non e' piu' quella che l'agente
// aveva scritto (o non l'ha mai scritta lui) finche' l'utente non conferma.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	openSync,
	readSync,
	closeSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/* ------------------------------------------------------------------ tipi --- */

export const DOC_ROLES = ["scopo", "uso", "decisioni", "storia", "domande-aperte"] as const;
export type DocRole = (typeof DOC_ROLES)[number];

export type DocsStorage = "repo" | "local";

export interface ProjectDocsManifest {
	version: 1;
	storage: DocsStorage;
	/** Cartella del diario mensile, relativa alla radice del progetto. */
	diaryDir: string;
	/** Ruolo -> file relativo alla radice. */
	docs: Record<DocRole, string>;
	initializedAt?: string;
}

export interface ProjectDocsState {
	/** `<percorso>#<sezione>` -> impronta del corpo come l'ha lasciato l'agente. */
	fingerprints: Record<string, string>;
}

export const MANIFEST_REL = ".omp/progetto.json";
export const STATE_REL = ".omp/progetto-stato.json";

export const ROLE_TITLES: Record<DocRole, string> = {
	scopo: "Scopo",
	uso: "Uso",
	decisioni: "Decisioni",
	storia: "Storia",
	"domande-aperte": "Domande aperte"
};

const ROLE_HINTS: Record<DocRole, string> = {
	scopo: "A cosa serve il progetto, per chi, cosa non e'.",
	uso: "Come si usa, dal punto di vista di chi lo usa (non del codice).",
	decisioni: "Scelte fatte e perche': data, scelta, motivo, alternative scartate, fonte.",
	storia: "Tappe e svolte del progetto, comprese le strade abbandonate.",
	"domande-aperte": "Cio' che non e' deciso o non si e' trovato."
};

/** Riga aggiunta al prompt di sistema quando il diario e' attivo (circa 60 token). */
export const PROMPT_LINE =
	"Project journal active (project_docs tool: journal + docs on purpose, usage, decisions, history, open questions). Consult it when useful; when a task ends with durable content (decisions and why, what changed for users, milestones, open questions) update journal and docs yourself with project_docs update, citing the source, without asking.";

/* -------------------------------------------------------------- percorsi --- */

function toPosix(path: string): string {
	return path.replace(/\\/g, "/");
}

/**
 * Radice del diario: il checkout principale, anche quando l'agente lavora in
 * una corsia (worktree). Il diario e' uno per progetto; scriverlo nella
 * corsia lo spezzerebbe in rami che si scontrano al merge.
 */
export function resolveProjectRoot(cwd: string): string {
	try {
		const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			windowsHide: true
		}).trim();
		if (common && toPosix(common).endsWith("/.git")) {
			const root = dirname(common);
			if (existsSync(root)) return root;
		}
	} catch {
		// Non e' un repository git (o git manca): vale la cartella corrente.
	}
	return cwd;
}

/** Percorso relativo sicuro: niente assoluti, niente uscite dalla radice. */
export function safeRel(root: string, rel: string): string | null {
	const clean = toPosix(rel).trim();
	if (!clean || isAbsolute(clean) || /^[a-zA-Z]:/.test(clean)) return null;
	const full = resolve(root, clean);
	const back = relative(root, full);
	if (back.startsWith("..") || isAbsolute(back)) return null;
	return toPosix(back);
}

function writeAtomic(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmp, content, "utf8");
	try {
		renameSync(tmp, path);
	} catch (err) {
		try {
			unlinkSync(tmp);
		} catch {
			// gia' rimosso
		}
		throw err;
	}
}

function readText(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

/* -------------------------------------------------------------- manifest --- */

export function defaultManifest(storage: DocsStorage = "repo"): ProjectDocsManifest {
	const base = storage === "local" ? ".omp/progetto" : "docs/progetto";
	const docs = {} as Record<DocRole, string>;
	for (const role of DOC_ROLES) docs[role] = `${base}/${role}.md`;
	return {
		version: 1,
		storage,
		diaryDir: storage === "local" ? ".omp/progetto/diario" : "docs/diario",
		docs
	};
}

function normalizeManifest(raw: unknown): ProjectDocsManifest | null {
	if (!raw || typeof raw !== "object") return null;
	const rec = raw as Record<string, unknown>;
	const storage: DocsStorage = rec.storage === "local" ? "local" : "repo";
	const base = defaultManifest(storage);
	const docs = { ...base.docs };
	const rawDocs = rec.docs && typeof rec.docs === "object" ? (rec.docs as Record<string, unknown>) : {};
	for (const role of DOC_ROLES) {
		const value = rawDocs[role];
		if (typeof value === "string" && value.trim()) docs[role] = toPosix(value.trim());
	}
	return {
		version: 1,
		storage,
		diaryDir: typeof rec.diaryDir === "string" && rec.diaryDir.trim() ? toPosix(rec.diaryDir.trim()) : base.diaryDir,
		docs,
		initializedAt: typeof rec.initializedAt === "string" ? rec.initializedAt : undefined
	};
}

export type ManifestSource = "file" | "detected" | "none";

/**
 * Manifest del progetto. Senza `.omp/progetto.json` (per esempio quando
 * `.omp/` e' tutto ignorato da git e il clone e' nuovo) bastano le cartelle
 * di default per riconoscere un diario gia' avviato.
 */
export function loadManifest(root: string): { manifest: ProjectDocsManifest; source: ManifestSource } {
	const text = readText(join(root, MANIFEST_REL));
	if (text) {
		try {
			const parsed = normalizeManifest(JSON.parse(text));
			if (parsed) return { manifest: parsed, source: "file" };
		} catch {
			// manifest illeggibile: si ripiega sul rilevamento
		}
	}
	for (const storage of ["repo", "local"] as const) {
		const candidate = defaultManifest(storage);
		const base = dirname(candidate.docs.scopo);
		if (existsSync(join(root, candidate.diaryDir)) || existsSync(join(root, base, "scopo.md"))) {
			return { manifest: candidate, source: "detected" };
		}
	}
	return { manifest: defaultManifest("repo"), source: "none" };
}

export function isJournalActive(root: string): boolean {
	return loadManifest(root).source !== "none";
}

/**
 * Documenti gia' tenuti a mano che coprono un ruolo: si mappano invece di
 * duplicarli (per OMP Studio: `PRODUCT.md` -> scopo, `DECISIONS.md` -> decisioni).
 */
export function detectExistingMappings(root: string): Partial<Record<DocRole, string>> {
	const candidates: Record<DocRole, string[]> = {
		scopo: ["docs/PRODUCT.md", "PRODUCT.md", "docs/product.md", "docs/VISION.md", "VISION.md"],
		uso: ["docs/USAGE.md", "USAGE.md", "docs/usage.md", "docs/GUIDE.md"],
		decisioni: ["docs/DECISIONS.md", "DECISIONS.md", "docs/decisions.md", "docs/adr/README.md"],
		storia: ["docs/HISTORY.md", "HISTORY.md", "docs/history.md"],
		"domande-aperte": ["docs/OPEN-QUESTIONS.md", "docs/open-questions.md"]
	};
	const found: Partial<Record<DocRole, string>> = {};
	for (const role of DOC_ROLES) {
		const hit = candidates[role].find((rel) => existsSync(join(root, rel)));
		if (hit) found[role] = hit;
	}
	return found;
}

/* -------------------------------------------------------------- .gitignore */

/** Aggiunge le righe mancanti a `.omp/.gitignore` (stesso file usato per tasks.json). */
export function ensureOmpIgnore(root: string, entries: string[]): void {
	const path = join(root, ".omp", ".gitignore");
	const existing = readText(path) ?? "";
	const lines = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
	if (lines.has("*")) return;
	const missing = entries.filter((e) => !lines.has(e) && !lines.has(`/${e}`));
	if (missing.length === 0) return;
	const block = `${existing && !existing.endsWith("\n") ? "\n" : ""}\n# OMP Studio: diario di progetto (stato locale)\n${missing.join("\n")}\n`;
	writeAtomic(path, existing + block);
}

/** Vero se git ignora il percorso (es. `.omp/` tutto ignorato nel .gitignore di radice). */
export function isGitIgnored(root: string, rel: string): boolean {
	try {
		execFileSync("git", ["check-ignore", "-q", rel], { cwd: root, stdio: "ignore", windowsHide: true });
		return true;
	} catch {
		return false;
	}
}

/* ---------------------------------------------------------------- date --- */

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

export function isoDate(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function diaryRelFor(manifest: ProjectDocsManifest, date: Date): string {
	return `${manifest.diaryDir}/${date.getFullYear()}-${pad(date.getMonth() + 1)}.md`;
}

/* ------------------------------------------------------------- sezioni --- */

export interface MdSection {
	/** Testo del titolo senza i `#`; vuoto per il preambolo. */
	heading: string;
	level: number;
	/** Indice della riga del titolo (o 0 per il preambolo). */
	start: number;
	/** Indice esclusivo della fine della sezione. */
	end: number;
}

/** Sezioni di un markdown per titoli `#`..`######`, ignorando i blocchi di codice. */
export function splitSections(lines: string[]): MdSection[] {
	const sections: MdSection[] = [];
	let inFence = false;
	let current: MdSection = { heading: "", level: 0, start: 0, end: lines.length };
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
		if (inFence) continue;
		const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
		if (!match) continue;
		current.end = i;
		sections.push(current);
		current = { heading: match[2].trim(), level: match[1].length, start: i, end: lines.length };
	}
	sections.push(current);
	return sections.filter((s) => s.heading !== "" || s.end > s.start);
}

function sameHeading(a: string, b: string): boolean {
	const norm = (s: string) => s.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
	return norm(a) === norm(b);
}

/** Fine del sottoalbero di una sezione: fino al prossimo titolo di livello uguale o superiore. */
function sectionTreeEnd(sections: MdSection[], index: number, total: number): number {
	const own = sections[index];
	for (let j = index + 1; j < sections.length; j++) {
		if (sections[j].level > 0 && sections[j].level <= own.level) return sections[j].start;
	}
	return total;
}

function findSection(lines: string[], heading: string): { start: number; bodyStart: number; end: number; level: number } | null {
	const sections = splitSections(lines);
	const index = sections.findIndex((s) => s.level > 0 && sameHeading(s.heading, heading));
	if (index === -1) return null;
	const section = sections[index];
	return { start: section.start, bodyStart: section.start + 1, end: sectionTreeEnd(sections, index, lines.length), level: section.level };
}

export function fingerprint(body: string): string {
	const normalized = body
		.split(/\r?\n/)
		.map((l) => l.replace(/\s+$/, ""))
		.join("\n")
		.trim();
	return createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

/* --------------------------------------------------------------- fonti --- */

const SOURCE_TAG = /\[(?:sessione|session|commit)\s+[^\]]+\]/i;

/** Aggiunge la fonte in coda se la riga non ne cita gia' una. */
export function withSource(line: string, source: string): string {
	const trimmed = line.replace(/\s+$/, "");
	if (!source || SOURCE_TAG.test(trimmed)) return trimmed;
	return `${trimmed} [${source}]`;
}

/** Fonte normalizzata: `sessione <id8>` o `commit <sha7>`; testo libero lasciato com'e'. */
export function normalizeSource(raw: string | undefined, sessionId: string | undefined): string {
	const value = (raw ?? "").trim().replace(/^\[|\]$/g, "");
	if (/^(sessione|session|commit)\s+\S+/i.test(value)) {
		const [kind, id] = value.split(/\s+/, 2);
		const short = /^commit$/i.test(kind) ? id.slice(0, 7) : id.slice(0, 8);
		return `${/^commit$/i.test(kind) ? "commit" : "sessione"} ${short}`;
	}
	if (/^[0-9a-f]{7,40}$/i.test(value)) return `commit ${value.slice(0, 7)}`;
	if (value) return value;
	return sessionId ? `sessione ${sessionId.slice(0, 8)}` : "";
}

/* -------------------------------------------------------------- stato --- */

export function loadState(root: string): ProjectDocsState {
	const text = readText(join(root, STATE_REL));
	if (!text) return { fingerprints: {} };
	try {
		const parsed = JSON.parse(text) as Partial<ProjectDocsState>;
		return { fingerprints: parsed.fingerprints && typeof parsed.fingerprints === "object" ? { ...parsed.fingerprints } : {} };
	} catch {
		return { fingerprints: {} };
	}
}

export function saveState(root: string, state: ProjectDocsState): void {
	ensureOmpIgnore(root, ["progetto-stato.json"]);
	writeAtomic(join(root, STATE_REL), `${JSON.stringify(state, null, 2)}\n`);
}

function fpKey(rel: string, heading: string): string {
	return `${rel}#${heading.toLowerCase().trim()}`;
}

/* ---------------------------------------------------------------- init --- */

function skeleton(role: DocRole): string {
	return `# ${ROLE_TITLES[role]}\n\n_${ROLE_HINTS[role]}_\n`;
}

function diaryHeader(date: Date): string {
	return `# Diario ${date.getFullYear()}-${pad(date.getMonth() + 1)}\n`;
}

export interface InitResult {
	manifest: ProjectDocsManifest;
	created: string[];
	mapped: Partial<Record<DocRole, string>>;
	/** Il manifest e' ignorato da git: le mappature restano su questa macchina. */
	manifestIgnored: boolean;
}

/**
 * Crea manifest, scheletri dei documenti non mappati e il file del mese.
 * Idempotente: non tocca file gia' presenti.
 */
export function initProject(root: string, storage: DocsStorage, now = new Date()): InitResult {
	const previous = loadManifest(root);
	const manifest = previous.source === "file" ? { ...previous.manifest, docs: { ...previous.manifest.docs } } : defaultManifest(storage);
	const mapped: Partial<Record<DocRole, string>> = {};
	if (previous.source !== "file") {
		const existing = detectExistingMappings(root);
		for (const role of DOC_ROLES) {
			const hit = existing[role];
			if (hit) {
				manifest.docs[role] = hit;
				mapped[role] = hit;
			}
		}
	}
	manifest.initializedAt = manifest.initializedAt ?? isoDate(now);

	const created: string[] = [];
	writeAtomic(join(root, MANIFEST_REL), `${JSON.stringify(manifest, null, 2)}\n`);
	for (const role of DOC_ROLES) {
		const rel = manifest.docs[role];
		const full = join(root, rel);
		if (!existsSync(full)) {
			writeAtomic(full, skeleton(role));
			created.push(rel);
		}
	}
	const diaryRel = diaryRelFor(manifest, now);
	if (!existsSync(join(root, diaryRel))) {
		writeAtomic(join(root, diaryRel), diaryHeader(now));
		created.push(diaryRel);
	}
	const ignore = ["progetto-stato.json"];
	if (manifest.storage === "local") ignore.push("progetto/", "progetto.json");
	ensureOmpIgnore(root, ignore);
	return {
		manifest,
		created,
		mapped,
		manifestIgnored: manifest.storage === "repo" && isGitIgnored(root, MANIFEST_REL)
	};
}

/* --------------------------------------------------------------- diario --- */

/**
 * Aggiunge voci al diario del mese sotto il titolo del giorno. Ogni riga non
 * vuota diventa un punto elenco con la sua fonte.
 */
export function appendDiary(root: string, manifest: ProjectDocsManifest, text: string, source: string, now = new Date()): string {
	const rel = diaryRelFor(manifest, now);
	const full = join(root, rel);
	const existing = readText(full) ?? diaryHeader(now);
	const lines = existing.replace(/\s+$/, "").split(/\r?\n/);
	const day = `## ${isoDate(now)}`;
	const bullets = text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => withSource(`- ${l.replace(/^[-*•]\s+/, "")}`, source));
	if (bullets.length === 0) return rel;

	const dayIndex = lines.findIndex((l) => l.trim() === day);
	if (dayIndex === -1) {
		lines.push("", day, ...bullets);
	} else {
		// In fondo al giorno, prima del titolo successivo.
		let end = dayIndex + 1;
		while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
		while (end > dayIndex + 1 && lines[end - 1].trim() === "") end--;
		lines.splice(end, 0, ...bullets);
	}
	writeAtomic(full, `${lines.join("\n")}\n`);
	return rel;
}

/* ------------------------------------------------------------- documenti */

export type UpdateMode = "append" | "replace_section" | "add_section";

export interface UpdateInput {
	role: DocRole;
	mode: UpdateMode;
	section?: string;
	text: string;
	source: string;
	force?: boolean;
}

export interface UpdateOutcome {
	ok: boolean;
	rel: string;
	message: string;
	/** Corpo attuale della sezione quando la scrittura e' stata rifiutata. */
	current?: string;
}

function appendBlock(lines: string[], at: number, block: string[]): void {
	const before = at > 0 && lines[at - 1]?.trim() !== "" ? [""] : [];
	lines.splice(at, 0, ...before, ...block);
}

function blockWithSource(text: string, source: string): string[] {
	const out = text.replace(/\s+$/, "").split(/\r?\n/);
	for (let i = out.length - 1; i >= 0; i--) {
		if (out[i].trim()) {
			out[i] = withSource(out[i], source);
			break;
		}
	}
	return out;
}

/**
 * Aggiorna un documento tematico. `append` aggiunge in fondo (al documento o
 * alla sezione), `add_section` crea una sezione nuova, `replace_section`
 * riscrive una sezione solo se e' ancora quella lasciata dall'agente.
 */
export function updateDoc(root: string, manifest: ProjectDocsManifest, input: UpdateInput, state: ProjectDocsState): UpdateOutcome {
	const rel = manifest.docs[input.role];
	const full = join(root, rel);
	const original = readText(full) ?? skeleton(input.role);
	const lines = original.replace(/\s+$/, "").split(/\r?\n/);
	const text = input.text.trim();
	if (!text) return { ok: false, rel, message: "Errore: 'text' vuoto." };

	if (input.mode === "add_section") {
		const heading = (input.section ?? "").trim();
		if (!heading) return { ok: false, rel, message: "Errore: 'section' e' obbligatorio con add_section." };
		if (findSection(lines, heading)) {
			return { ok: false, rel, message: `La sezione «${heading}» esiste gia' in ${rel}: usa append o replace_section.` };
		}
		const body = blockWithSource(text, input.source);
		appendBlock(lines, lines.length, [`## ${heading}`, "", ...body]);
		state.fingerprints[fpKey(rel, heading)] = fingerprint(body.join("\n"));
		writeAtomic(full, `${lines.join("\n")}\n`);
		return { ok: true, rel, message: `Sezione «${heading}» aggiunta a ${rel}.` };
	}

	if (input.mode === "append") {
		const heading = (input.section ?? "").trim();
		const body = blockWithSource(text, input.source);
		if (!heading) {
			appendBlock(lines, lines.length, body);
			writeAtomic(full, `${lines.join("\n")}\n`);
			return { ok: true, rel, message: `Testo aggiunto in fondo a ${rel}.` };
		}
		const found = findSection(lines, heading);
		if (!found) {
			appendBlock(lines, lines.length, [`## ${heading}`, "", ...body]);
			state.fingerprints[fpKey(rel, heading)] = fingerprint(body.join("\n"));
			writeAtomic(full, `${lines.join("\n")}\n`);
			return { ok: true, rel, message: `Sezione «${heading}» creata in ${rel}.` };
		}
		const key = fpKey(rel, heading);
		const before = lines.slice(found.bodyStart, found.end).join("\n");
		const ownedByAgent = state.fingerprints[key] === fingerprint(before);
		let at = found.end;
		while (at > found.bodyStart && lines[at - 1].trim() === "") at--;
		appendBlock(lines, at, body);
		// L'impronta segue solo le sezioni che erano gia' dell'agente: un
		// append non deve far passare per suo il testo scritto a mano.
		if (ownedByAgent) {
			const after = findSection(lines, heading);
			if (after) state.fingerprints[key] = fingerprint(lines.slice(after.bodyStart, after.end).join("\n"));
		}
		writeAtomic(full, `${lines.join("\n")}\n`);
		return { ok: true, rel, message: `Aggiunto alla sezione «${heading}» di ${rel}.` };
	}

	// replace_section
	const heading = (input.section ?? "").trim();
	if (!heading) return { ok: false, rel, message: "Errore: 'section' e' obbligatorio con replace_section." };
	const found = findSection(lines, heading);
	const body = blockWithSource(text, input.source);
	if (!found) {
		appendBlock(lines, lines.length, [`## ${heading}`, "", ...body]);
		state.fingerprints[fpKey(rel, heading)] = fingerprint(body.join("\n"));
		writeAtomic(full, `${lines.join("\n")}\n`);
		return { ok: true, rel, message: `Sezione «${heading}» creata in ${rel}.` };
	}
	const key = fpKey(rel, heading);
	const currentBody = lines.slice(found.bodyStart, found.end).join("\n");
	const isEmpty = currentBody.trim() === "" || /^_[^_]+_$/.test(currentBody.trim());
	const ownedByAgent = state.fingerprints[key] === fingerprint(currentBody);
	if (!isEmpty && !ownedByAgent && !input.force) {
		return {
			ok: false,
			rel,
			current: currentBody.trim(),
			message:
				`La sezione «${heading}» di ${rel} contiene testo scritto o modificato a mano dall'utente dopo l'ultimo aggiornamento dell'agente: non la sovrascrivo. ` +
				"Dillo all'utente mostrando la modifica che vorresti fare; se conferma ripeti con force: true, altrimenti usa mode 'append'."
		};
	}
	lines.splice(found.bodyStart, found.end - found.bodyStart, "", ...body, "");
	state.fingerprints[key] = fingerprint(["", ...body, ""].join("\n"));
	writeAtomic(full, `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "")}\n`);
	return { ok: true, rel, message: `Sezione «${heading}» riscritta in ${rel}.` };
}

/* ------------------------------------------------------------- lettura --- */

export function listDiaryMonths(root: string, manifest: ProjectDocsManifest): string[] {
	try {
		return readdirSync(join(root, manifest.diaryDir))
			.filter((name) => /^\d{4}-\d{2}\.md$/.test(name))
			.sort()
			.reverse()
			.map((name) => `${manifest.diaryDir}/${name}`);
	} catch {
		return [];
	}
}

function lineCount(path: string): number {
	const text = readText(path);
	return text ? text.split(/\r?\n/).length : 0;
}

export interface SearchHit {
	rel: string;
	line: number;
	section: string;
	text: string;
}

/** Ricerca per parole (tutte presenti nella riga o nella sezione), senza regex dell'utente. */
export function searchDocs(root: string, manifest: ProjectDocsManifest, query: string, limit = 30): SearchHit[] {
	const words = query
		.toLowerCase()
		.split(/[^\p{L}\p{N}_-]+/u)
		.filter((w) => w.length >= 3);
	if (words.length === 0) return [];
	const files = [...new Set([...DOC_ROLES.map((r) => manifest.docs[r]), ...listDiaryMonths(root, manifest)])];
	const hits: { hit: SearchHit; score: number }[] = [];
	for (const rel of files) {
		const text = readText(join(root, rel));
		if (!text) continue;
		const lines = text.split(/\r?\n/);
		let section = "";
		lines.forEach((line, index) => {
			const heading = /^#{1,6}\s+(.*)$/.exec(line);
			if (heading) section = heading[1].trim();
			const lower = `${section} ${line}`.toLowerCase();
			const score = words.filter((w) => lower.includes(w)).length;
			if (score > 0 && line.trim() && !heading) {
				hits.push({ hit: { rel, line: index + 1, section, text: line.trim().slice(0, 300) }, score });
			}
		});
	}
	return hits
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((h) => h.hit);
}

/* --------------------------------------------------------------- fonti --- */

function agentDir(): string {
	const env = process.env.PI_CODING_AGENT_DIR;
	return env && env.trim() ? env : join(homedir(), ".omp", "agent");
}

function sameDir(a: string, b: string): boolean {
	const norm = (p: string) => toPosix(p).replace(/\/+$/, "").toLowerCase();
	return norm(a) === norm(b);
}

function firstLine(path: string): string {
	let fd: number | null = null;
	try {
		fd = openSync(path, "r");
		const buf = Buffer.alloc(4096);
		const read = readSync(fd, buf, 0, buf.length, 0);
		return buf.subarray(0, read).toString("utf8").split("\n")[0] ?? "";
	} catch {
		return "";
	} finally {
		if (fd !== null) closeSync(fd);
	}
}

export interface SessionFileInfo {
	path: string;
	id: string;
	date: string;
}

/** Transcript `.jsonl` di omp per questa cartella: sola lettura, dal piu' recente. */
export function sessionFilesFor(root: string, limit = 60): SessionFileInfo[] {
	const sessionsRoot = join(agentDir(), "sessions");
	const out: (SessionFileInfo & { mtime: number })[] = [];
	let folders: string[] = [];
	try {
		folders = readdirSync(sessionsRoot);
	} catch {
		return [];
	}
	for (const folder of folders) {
		const dir = join(sessionsRoot, folder);
		let files: string[] = [];
		try {
			files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
		} catch {
			continue;
		}
		for (const file of files) {
			const path = join(dir, file);
			const header = firstLine(path);
			if (!header.includes('"cwd"')) continue;
			try {
				const parsed = JSON.parse(header) as { id?: string; cwd?: string; timestamp?: string };
				if (!parsed.cwd || !sameDir(parsed.cwd, root)) continue;
				out.push({
					path: toPosix(path),
					id: parsed.id ?? file.replace(/\.jsonl$/, ""),
					date: (parsed.timestamp ?? "").slice(0, 10),
					mtime: statSync(path).mtimeMs
				});
			} catch {
				continue;
			}
		}
	}
	return out
		.sort((a, b) => b.mtime - a.mtime)
		.slice(0, limit)
		.map(({ path, id, date }) => ({ path, id, date }));
}

export interface HistoryPrompt {
	date: string;
	sessionId: string;
	prompt: string;
}

/**
 * Prompt dell'utente per questa cartella da `history.db` di omp, in sola
 * lettura. Usa `bun:sqlite` (omp gira su Bun); fuori da Bun non c'e' e si
 * restituisce un elenco vuoto.
 */
export async function historyPromptsFor(root: string, limit = 200): Promise<HistoryPrompt[]> {
	const dbPath = join(agentDir(), "history.db");
	if (!existsSync(dbPath)) return [];
	try {
		const mod = (await import("bun:sqlite" as string)) as {
			Database: new (path: string, opts: { readonly: boolean }) => {
				query: (sql: string) => { all: (...args: unknown[]) => unknown[] };
				close: () => void;
			};
		};
		const db = new mod.Database(dbPath, { readonly: true });
		try {
			const slash = toPosix(root);
			const back = slash.replace(/\//g, "\\");
			const rows = db
				.query(
					"SELECT prompt, created_at, session_id FROM history WHERE (cwd = ?1 OR cwd = ?2 OR replace(cwd, '\\', '/') = ?1) AND prompt NOT LIKE '/%' ORDER BY created_at ASC LIMIT ?3"
				)
				.all(slash, back, limit) as { prompt: string; created_at: number; session_id: string | null }[];
			return rows.map((r) => ({
				date: new Date((r.created_at > 1e12 ? r.created_at : r.created_at * 1000)).toISOString().slice(0, 10),
				sessionId: (r.session_id ?? "").slice(0, 8),
				prompt: String(r.prompt).replace(/\s+/g, " ").slice(0, 240)
			}));
		} finally {
			db.close();
		}
	} catch {
		return [];
	}
}

/** Documentazione gia' presente nel progetto (radice e docs/), esclusi i file del diario. */
export function existingDocFiles(root: string, manifest: ProjectDocsManifest): string[] {
	const own = new Set([...DOC_ROLES.map((r) => manifest.docs[r]), ...listDiaryMonths(root, manifest)].map((p) => p.toLowerCase()));
	const out: string[] = [];
	const push = (rel: string) => {
		if (!own.has(rel.toLowerCase()) && !out.includes(rel)) out.push(rel);
	};
	try {
		for (const name of readdirSync(root)) {
			if (/\.(md|markdown|txt)$/i.test(name) && statSync(join(root, name)).isFile()) push(name);
		}
	} catch {
		// radice illeggibile
	}
	const walk = (rel: string, depth: number) => {
		if (depth > 2 || out.length >= 60) return;
		let names: string[] = [];
		try {
			names = readdirSync(join(root, rel));
		} catch {
			return;
		}
		for (const name of names) {
			const child = `${rel}/${name}`;
			if (child === manifest.diaryDir) continue;
			let isDir = false;
			try {
				isDir = statSync(join(root, child)).isDirectory();
			} catch {
				continue;
			}
			if (isDir) walk(child, depth + 1);
			else if (/\.(md|markdown)$/i.test(name)) push(child);
		}
	};
	walk("docs", 0);
	return out;
}

export interface GitSummary {
	commits: number;
	first?: string;
	last?: string;
}

export function gitSummary(root: string): GitSummary | null {
	try {
		const count = execFileSync("git", ["rev-list", "--count", "HEAD"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			windowsHide: true
		}).trim();
		const dates = execFileSync("git", ["log", "--format=%cs", "--reverse"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			windowsHide: true,
			maxBuffer: 16 * 1024 * 1024
		})
			.trim()
			.split("\n")
			.filter(Boolean);
		return { commits: Number(count) || 0, first: dates[0], last: dates[dates.length - 1] };
	} catch {
		return null;
	}
}

/* -------------------------------------------------------- cambio storage */

/**
 * Sposta i file del diario fra `docs/` (versionati) e `.omp/progetto/`
 * (fuori da git). I documenti mappati su file gia' esistenti (es.
 * `docs/DECISIONS.md`) restano dove sono: sono dell'utente.
 */
export function switchStorage(root: string, target: DocsStorage): { moved: string[]; manifest: ProjectDocsManifest } {
	const { manifest: current } = loadManifest(root);
	const fromDefaults = defaultManifest(current.storage);
	const toDefaults = defaultManifest(target);
	const next: ProjectDocsManifest = { ...current, storage: target, docs: { ...current.docs } };
	const moved: string[] = [];
	const move = (fromRel: string, toRel: string) => {
		const from = join(root, fromRel);
		const to = join(root, toRel);
		if (!existsSync(from) || existsSync(to)) return;
		mkdirSync(dirname(to), { recursive: true });
		renameSync(from, to);
		moved.push(`${fromRel} -> ${toRel}`);
	};
	for (const role of DOC_ROLES) {
		if (current.docs[role] === fromDefaults.docs[role]) {
			move(current.docs[role], toDefaults.docs[role]);
			next.docs[role] = toDefaults.docs[role];
		}
	}
	if (current.diaryDir === fromDefaults.diaryDir) {
		for (const rel of listDiaryMonths(root, current)) {
			move(rel, `${toDefaults.diaryDir}/${rel.slice(rel.lastIndexOf("/") + 1)}`);
		}
		next.diaryDir = toDefaults.diaryDir;
	}
	writeAtomic(join(root, MANIFEST_REL), `${JSON.stringify(next, null, 2)}\n`);
	ensureOmpIgnore(root, target === "local" ? ["progetto-stato.json", "progetto/", "progetto.json"] : ["progetto-stato.json"]);
	if (target === "repo") removeOmpIgnoreEntries(root, ["progetto/", "progetto.json"]);
	return { moved, manifest: next };
}

function removeOmpIgnoreEntries(root: string, entries: string[]): void {
	const path = join(root, ".omp", ".gitignore");
	const existing = readText(path);
	if (!existing) return;
	const kept = existing.split(/\r?\n/).filter((l) => !entries.includes(l.trim()) && !entries.includes(l.trim().replace(/^\//, "")));
	writeAtomic(path, kept.join("\n"));
}

/* ------------------------------------------------------------- prompt --- */

export function initPrompt(info: {
	init: InitResult;
	docs: string[];
	git: GitSummary | null;
	sessions: number;
	prompts: number;
}): string {
	const hasMaterial = info.docs.length > 0 || (info.git?.commits ?? 0) > 3 || info.sessions > 0;
	const mapped = Object.entries(info.init.mapped)
		.map(([role, rel]) => `${role} -> ${rel}`)
		.join(", ");
	const lines = [
		"[Diario di progetto · inizializzazione]",
		`Ho creato la struttura del diario (${info.init.manifest.storage === "local" ? "fuori da git, in .omp/progetto/" : "versionata, in docs/diario e docs/progetto"}).` +
			(mapped ? ` Documenti esistenti usati al posto dei nuovi: ${mapped}.` : ""),
		""
	];
	if (hasMaterial) {
		lines.push(
			"Il progetto ha gia' materiale: ricava le informazioni da li', senza farmi domande se non per cio' che resta davvero ambiguo.",
			"1. Chiama project_docs con action 'sources' per l'elenco: documentazione esistente, riepilogo git, sessioni passate e prompt di history.db.",
			"2. Leggi README, AGENTS.md, docs/, CHANGELOG; usa `git log --stat` (a blocchi) per tappe e svolte; dai prompt di history.db e, solo dove servono dettagli, dai transcript .jsonl (cerca con grep, non leggerli interi) ricava decisioni e motivi.",
			"3. I file di omp (history.db, sessioni .jsonl, ~/.omp) sono in SOLA LETTURA: non modificarli mai.",
			"4. Compila con project_docs update i documenti scopo, uso, decisioni, storia, domande-aperte (sezioni brevi, linguaggio semplice, ogni affermazione con la fonte: [commit abc1234] o [sessione 1a2b3c4d]); cio' che non trovi o non e' chiaro va in domande-aperte.",
			"5. Nei documenti mappati su file gia' esistenti aggiungi solo cio' che manca (mode append), non riscrivere il testo dell'utente.",
			"6. Scrivi nel diario (doc 'diario') una voce per le tappe principali gia' avvenute e una per l'inizializzazione di oggi.",
			"7. Alla fine riassumi in poche righe cosa hai scritto e cosa e' rimasto in domande-aperte."
		);
	} else {
		lines.push(
			"Il progetto e' nuovo o quasi vuoto: fammi un'INTERVISTA breve per compilare i documenti.",
			"- Una domanda per messaggio, in linguaggio semplice; aspetta la mia risposta prima della successiva. Massimo 6-8 domande.",
			"- Copri: a cosa serve e per chi, cosa NON deve fare, come lo usera' chi lo usa, scelte gia' fatte (tecnologie, vincoli) e perche', dubbi aperti.",
			"- Dopo ogni risposta aggiorna subito il documento giusto con project_docs update (fonte: la sessione corrente).",
			"- Alla fine scrivi una voce nel diario (doc 'diario') e riassumi cosa hai registrato."
		);
	}
	if (info.init.manifestIgnored) {
		lines.push("", "Nota: .omp/progetto.json e' ignorato da git in questo repository, quindi le mappature restano solo su questa macchina; dimmelo in una riga.");
	}
	return lines.join("\n");
}

export function updatePrompt(): string {
	return [
		"[Diario di progetto · aggiornamento]",
		"Aggiorna adesso diario e documenti di progetto con project_docs update in base a questa sessione (e ai commit recenti se servono):",
		"- nel diario (doc 'diario') 1-5 righe: cosa e' cambiato, cosa si e' deciso e perche' (con le mie parole tra virgolette se ci sono), cosa resta aperto;",
		"- nei documenti solo cio' che e' durevole; ogni riga con la fonte; se nulla di durevole e' successo dillo e non scrivere niente."
	].join("\n");
}

export function askPrompt(question: string): string {
	return [
		"[Diario di progetto · domanda]",
		`Rispondi usando il diario e i documenti di progetto (project_docs search/read), citando le fonti: ${question}`,
		"Se la risposta non c'e', dillo e proponi di aggiungerla a domande-aperte."
	].join("\n");
}

/* ------------------------------------------------------------ superficie */

interface ZodType {
	optional(): ZodType;
	describe(text: string): ZodType;
}

interface ZodBuilder {
	object(shape: Record<string, ZodType>): ZodType;
	string(): ZodType;
	boolean(): ZodType;
	enum(values: readonly string[]): ZodType;
}

interface ToolContext {
	cwd?: string;
	sessionManager?: {
		getCwd?: () => string;
		getSessionId?: () => string;
	};
}

interface ToolResult {
	content: { type: "text"; text: string }[];
	details?: Record<string, unknown>;
	isError?: boolean;
}

interface ToolDefinition<TParams> {
	name: string;
	label: string;
	description: string;
	parameters: ZodType;
	approval: "read" | "write" | "exec";
	execute(
		toolCallId: string,
		params: TParams,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: ToolContext | undefined
	): Promise<ToolResult>;
}

interface CommandContext {
	cwd?: string;
	ui?: { notify?: (message: string, level: "info" | "error" | "warning") => void };
	sessionManager?: { getCwd?: () => string; getSessionId?: () => string };
}

export interface StudioDocsApi {
	zod: ZodBuilder;
	registerTool<TParams>(definition: ToolDefinition<TParams>): void;
	registerCommand?(name: string, command: { description: string; handler: (args: string, ctx: CommandContext) => Promise<void> }): void;
	on?(event: "before_agent_start", handler: (event: { systemPrompt: string[] }, ctx: { cwd?: string }) => unknown): void;
	sendUserMessage?(content: string): void;
	sendMessage?(message: string, options?: { triggerTurn?: boolean }): void;
}

export interface ProjectDocsParams {
	action: "list" | "read" | "search" | "update" | "sources" | "init";
	doc?: string;
	section?: string;
	query?: string;
	text?: string;
	mode?: UpdateMode;
	source?: string;
	force?: boolean;
	storage?: DocsStorage;
}

export const PROJECT_DOCS_DESCRIPTION =
	"Project journal and documents kept by OMP Studio: a monthly journal (doc 'diario') and thematic docs " +
	"'scopo' (purpose), 'uso' (usage), 'decisioni' (decisions and why), 'storia' (history), 'domande-aperte' (open questions). " +
	"Actions: list; read (doc, optional section; doc 'diario' or 'diario:YYYY-MM'); search (query); " +
	"update (doc, text, mode append|add_section|replace_section, section, source); sources (existing docs, git summary, past sessions, history.db prompts: read-only); init (create structure). " +
	"You maintain them yourself without asking: at the end of a task with durable content add 1-5 journal lines (what changed, what was decided and why, quoting the user's words when useful, what is still open) and update the relevant docs. " +
	"Skip trivial sessions. Every line must cite its source: 'sessione <id>' (default: current session) or 'commit <sha>'. " +
	"Prefer append; replace_section refuses sections edited by hand by the user: then show the user what you want to change and use force: true only after they agree or when they explicitly asked for that change. " +
	"Write in the user's language, plain words, short sections. Never write omp's own files (~/.omp, history.db, session .jsonl).";

function textResult(text: string, details?: Record<string, unknown>): ToolResult {
	return details ? { content: [{ type: "text", text }], details } : { content: [{ type: "text", text }] };
}

function errorResult(text: string): ToolResult {
	return { content: [{ type: "text", text }], isError: true };
}

function asRole(doc: string | undefined): DocRole | null {
	const value = (doc ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
	const aliases: Record<string, DocRole> = {
		purpose: "scopo",
		usage: "uso",
		decisions: "decisioni",
		history: "storia",
		"open-questions": "domande-aperte",
		domande: "domande-aperte"
	};
	if ((DOC_ROLES as readonly string[]).includes(value)) return value as DocRole;
	return aliases[value] ?? null;
}

function sectionText(text: string, section: string | undefined): string | null {
	if (!section) return text;
	const lines = text.split(/\r?\n/);
	const found = findSection(lines, section);
	return found ? lines.slice(found.start, found.end).join("\n") : null;
}

/** Esegue un'azione del tool. Esportata per i test. */
export async function runProjectDocs(cwd: string, params: ProjectDocsParams, sessionId?: string, now = new Date()): Promise<ToolResult> {
	const root = resolveProjectRoot(cwd);
	const action = params.action ?? "list";
	const { manifest, source } = loadManifest(root);

	if (action === "init") {
		const init = initProject(root, params.storage === "local" ? "local" : "repo", now);
		return textResult(
			`Diario inizializzato. Creati: ${init.created.join(", ") || "nessun file nuovo"}.` +
				(Object.keys(init.mapped).length ? ` Mappati: ${JSON.stringify(init.mapped)}.` : "") +
				(init.manifestIgnored ? " Attenzione: .omp/progetto.json e' ignorato da git." : ""),
			{ manifest: init.manifest, created: init.created }
		);
	}

	if (action === "sources") {
		const sessions = sessionFilesFor(root);
		const prompts = await historyPromptsFor(root);
		const docs = existingDocFiles(root, manifest);
		const git = gitSummary(root);
		const lines = [
			`Radice: ${toPosix(root)}`,
			`Documentazione esistente (${docs.length}): ${docs.join(", ") || "nessuna"}`,
			git ? `Git: ${git.commits} commit (${git.first ?? "?"} -> ${git.last ?? "?"})` : "Git: non disponibile",
			`Sessioni omp per questa cartella (${sessions.length}, sola lettura):`,
			...sessions.slice(0, 40).map((s) => `- ${s.date} ${s.id.slice(0, 8)} ${s.path}`),
			`Prompt dell'utente da history.db (${prompts.length}, sola lettura, dal piu' vecchio):`,
			...prompts.map((p) => `- ${p.date} [sessione ${p.sessionId}] ${p.prompt}`)
		];
		return textResult(lines.join("\n"), { docs, git, sessions: sessions.length, prompts: prompts.length });
	}

	if (source === "none") {
		return errorResult("Il diario di progetto non e' ancora attivo qui. L'utente puo' avviarlo con /diario init (o tu con action 'init' se te lo chiede).");
	}

	switch (action) {
		case "list": {
			const docs = DOC_ROLES.map((role) => {
				const rel = manifest.docs[role];
				return `- ${role}: ${rel} (${lineCount(join(root, rel))} righe)`;
			});
			const months = listDiaryMonths(root, manifest);
			return textResult(
				[
					`Diario di progetto (${manifest.storage === "local" ? "fuori da git" : "versionato"}):`,
					...docs,
					`- diario: ${months.length ? months.join(", ") : `${manifest.diaryDir} (vuoto)`}`
				].join("\n"),
				{ manifest, months }
			);
		}
		case "read": {
			const doc = (params.doc ?? "").trim();
			let rel: string | null = null;
			if (/^diario(:\d{4}-\d{2})?$/i.test(doc)) {
				const month = doc.split(":")[1];
				rel = month ? `${manifest.diaryDir}/${month}.md` : diaryRelFor(manifest, now);
			} else {
				const role = asRole(doc);
				if (!role) return errorResult(`Documento sconosciuto '${doc}'. Usa uno di: ${DOC_ROLES.join(", ")}, diario, diario:YYYY-MM.`);
				rel = manifest.docs[role];
			}
			const text = readText(join(root, rel));
			if (text === null) return errorResult(`${rel} non esiste ancora.`);
			const part = sectionText(text, params.section);
			if (part === null) return errorResult(`Sezione '${params.section}' non trovata in ${rel}.`);
			return textResult(`${rel}\n\n${part}`);
		}
		case "search": {
			const query = (params.query ?? "").trim();
			if (!query) return errorResult("Errore: 'query' e' obbligatorio.");
			const hits = searchDocs(root, manifest, query);
			if (hits.length === 0) return textResult(`Nessun risultato per «${query}».`, { hits: [] });
			return textResult(hits.map((h) => `${h.rel}:${h.line} [${h.section || "-"}] ${h.text}`).join("\n"), { hits });
		}
		case "update": {
			const text = (params.text ?? "").trim();
			if (!text) return errorResult("Errore: 'text' e' obbligatorio.");
			const src = normalizeSource(params.source, sessionId);
			const doc = (params.doc ?? "").trim().toLowerCase();
			if (doc === "diario" || doc === "journal") {
				const rel = appendDiary(root, manifest, text, src, now);
				return textResult(`Diario aggiornato: ${rel}.`, { rel });
			}
			const role = asRole(doc);
			if (!role) return errorResult(`Documento sconosciuto '${params.doc}'. Usa uno di: ${DOC_ROLES.join(", ")}, diario.`);
			const state = loadState(root);
			const outcome = updateDoc(root, manifest, { role, mode: params.mode ?? "append", section: params.section, text, source: src, force: params.force }, state);
			if (outcome.ok) saveState(root, state);
			return outcome.ok
				? textResult(outcome.message, { rel: outcome.rel })
				: { content: [{ type: "text", text: outcome.current ? `${outcome.message}\n\nTesto attuale:\n${outcome.current}` : outcome.message }], isError: true };
		}
		default:
			return errorResult(`Azione sconosciuta '${action}'.`);
	}
}

/**
 * Entrypoint dell'estensione OMP.
 */
export default function studioDocsExtension(pi: StudioDocsApi): void {
	const z = pi.zod;

	pi.registerTool<ProjectDocsParams>({
		name: "project_docs",
		label: "Project Docs",
		description: PROJECT_DOCS_DESCRIPTION,
		parameters: z.object({
			action: z.enum(["list", "read", "search", "update", "sources", "init"]).describe("Action to perform."),
			doc: z
				.string()
				.optional()
				.describe("Document: scopo, uso, decisioni, storia, domande-aperte, or diario (diario:YYYY-MM to read a past month)."),
			section: z.string().optional().describe("Section heading (without #) for read/update."),
			query: z.string().optional().describe("Words to search for (search)."),
			text: z.string().optional().describe("Text to write (update). For the journal, one line per entry."),
			mode: z.enum(["append", "add_section", "replace_section"]).optional().describe("Update mode (default append)."),
			source: z.string().optional().describe("Source to cite: 'sessione <id>' or 'commit <sha>'. Default: current session."),
			force: z.boolean().optional().describe("Overwrite a section edited by hand: only after the user agreed."),
			storage: z.enum(["repo", "local"]).optional().describe("init only: 'repo' (versioned, default) or 'local' (outside git).")
		}),
		approval: "read",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx?.sessionManager?.getCwd?.() ?? ctx?.cwd ?? process.cwd();
			const sessionId = ctx?.sessionManager?.getSessionId?.();
			try {
				return await runProjectDocs(cwd, params, sessionId);
			} catch (err) {
				return errorResult(`Errore del diario: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	});

	// Una riga nel prompt, solo dove il diario e' attivo: il resto si legge su richiesta.
	pi.on?.("before_agent_start", (event, ctx) => {
		try {
			const cwd = ctx?.cwd ?? process.cwd();
			if (!isJournalActive(resolveProjectRoot(cwd))) return undefined;
			if (event.systemPrompt.some((part) => part.includes(PROMPT_LINE))) return undefined;
			return { systemPrompt: [...event.systemPrompt, PROMPT_LINE] };
		} catch {
			return undefined;
		}
	});

	const send = (text: string) => {
		if (typeof pi.sendUserMessage === "function") pi.sendUserMessage(text);
		else pi.sendMessage?.(text, { triggerTurn: true });
	};

	pi.registerCommand?.("diario", {
		description: "Diario di progetto: init | aggiorna | locale | repo | <domanda>",
		handler: async (args: string, ctx: CommandContext) => {
			const cwd = ctx?.sessionManager?.getCwd?.() ?? ctx?.cwd ?? process.cwd();
			const root = resolveProjectRoot(cwd);
			const notify = (msg: string, level: "info" | "error" | "warning" = "info") => ctx?.ui?.notify?.(msg, level);
			const trimmed = (args ?? "").trim();
			const [head, ...rest] = trimmed.split(/\s+/);
			const sub = (head ?? "").toLowerCase();

			try {
				if (sub === "init" || sub === "inizializza") {
					const storage: DocsStorage = rest[0]?.toLowerCase() === "locale" || rest[0]?.toLowerCase() === "local" ? "local" : "repo";
					const init = initProject(root, storage);
					const sessions = sessionFilesFor(root).length;
					const prompts = (await historyPromptsFor(root, 50)).length;
					send(initPrompt({ init, docs: existingDocFiles(root, init.manifest), git: gitSummary(root), sessions, prompts }));
					return;
				}
				if (!isJournalActive(root)) {
					notify("Il diario non e' ancora attivo in questo progetto: avvialo con /diario init.", "warning");
					return;
				}
				if (sub === "aggiorna" || sub === "update") {
					send(updatePrompt());
					return;
				}
				if (sub === "locale" || sub === "local" || sub === "repo") {
					const { moved, manifest } = switchStorage(root, sub === "repo" ? "repo" : "local");
					notify(
						manifest.storage === "local"
							? `Diario spostato fuori da git (.omp/progetto/). ${moved.length} file spostati.`
							: `Diario riportato nel repo (docs/). ${moved.length} file spostati.`
					);
					return;
				}
				if (!trimmed) {
					const { manifest } = loadManifest(root);
					notify(
						`Diario attivo (${manifest.storage === "local" ? "fuori da git" : "versionato"}): ${manifest.diaryDir}, ${DOC_ROLES.map((r) => manifest.docs[r]).join(", ")}. ` +
							"Uso: /diario <domanda> · /diario aggiorna · /diario locale|repo"
					);
					return;
				}
				send(askPrompt(trimmed));
			} catch (err) {
				notify(`Diario: ${err instanceof Error ? err.message : String(err)}`, "error");
			}
		}
	});
}
