/**
 * Heads-up di fine turno (Gate R3X-heads-up).
 *
 * Una sola frase, solo quando nel turno e' successo qualcosa che l'utente
 * rischia di perdere perche' sta a meta' del racconto. Tre fonti, in ordine
 * di autorita':
 *
 * 1. **agente**: il tool `studio_headsup` (estensione `studio-headsup.ts`).
 *    Solo chi ha lavorato sa cosa non ha verificato o cosa ha deciso da solo.
 * 2. **smol**: la chiamata post-turno gia' esistente (`suggestions_ops.rs`)
 *    sintetizza fatti e testo del turno in una frase, solo se l'agente tace e
 *    il turno e' abbastanza grande da nascondere qualcosa.
 * 3. **fatti**: cio' che Studio sa per certo dagli eventi del turno (comando
 *    di verifica fallito e mai rieseguito con successo, domanda scaduta senza
 *    risposta, comando rischioso, file delicato modificato). Costo zero; e'
 *    anche la frase di ripiego se smol non c'e' o non risponde.
 *
 * Qui stanno solo funzioni pure (nessuna rune, nessun I/O) per poterle
 * provare in Node. La composizione della frase dai fatti riceve i testi
 * localizzati dall'esterno, cosi' il modulo non dipende da Paraglide.
 */

import type { TranscriptEntry, ToolEntry } from './session.svelte';

/** Nome del tool registrato dall'estensione `studio-headsup.ts`. */
export const HEADS_UP_TOOL = 'studio_headsup';

/** Lunghezza massima della frase mostrata (caratteri). */
export const HEADS_UP_MAX_CHARS = 220;

export type HeadsUpFactKind = 'failed-command' | 'expired-question' | 'risky-command' | 'sensitive-file';

/** Un fatto certo del turno, con la voce del transcript a cui rimanda. */
export interface HeadsUpFact {
	kind: HeadsUpFactKind;
	/** Id della voce del transcript dove e' successo. */
	entryId: number;
	/** Comando (troncato) o percorso del file. */
	subject: string;
}

export type HeadsUpSource = 'agent' | 'smol' | 'facts';

export interface TurnHeadsUp {
	text: string;
	source: HeadsUpSource;
	/** Voce del transcript a cui porta il clic sulla card. */
	targetEntryId: number | null;
}

/** Ordine di gravita': il primo fatto e' quello che apre la frase. */
const FACT_ORDER: Record<HeadsUpFactKind, number> = {
	'failed-command': 0,
	'expired-question': 1,
	'risky-command': 2,
	'sensitive-file': 3
};

/* ---------------------------------------------------------------- turno --- */

/**
 * Voci dell'ultimo turno: tutto cio' che segue l'ultimo messaggio dell'utente.
 * Senza messaggi utente (sessione ripresa a meta') vale l'intero transcript.
 */
export function lastTurnEntries(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i].kind === 'user') return entries.slice(i + 1);
	}
	return entries.slice();
}

/** Chiave stabile del turno per idempotenza: l'id dell'ultima risposta. */
export function turnKeyOf(turn: readonly TranscriptEntry[]): string | null {
	for (let i = turn.length - 1; i >= 0; i--) {
		if (turn[i].kind === 'assistant') return `turn_${turn[i].id}`;
	}
	return null;
}

/* ----------------------------------------------------------- normalizzazione */

/**
 * Riduce un testo a una frase mostrabile: spazi e a capo compressi, niente
 * markdown di contorno, al massimo `HEADS_UP_MAX_CHARS` caratteri.
 */
export function clampSentence(raw: string, max = HEADS_UP_MAX_CHARS): string {
	let text = raw.replace(/\s+/g, ' ').trim();
	// Elenchi o grassetti incollati dal modello: la card e' una riga di prosa.
	text = text.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '').replace(/`/g, '');
	if (text.length <= max) return text;
	const cut = text.slice(0, max - 1);
	const lastSpace = cut.lastIndexOf(' ');
	return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function rec(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function canonical(toolName: string): string {
	return (toolName || '').toLowerCase().trim();
}

/* ------------------------------------------------------------- comandi --- */

/** Comando shell di una chiamata `bash`, se c'e'. */
export function commandOf(entry: ToolEntry): string | undefined {
	return str(entry.args?.command) ?? str(entry.args?.cmd);
}

/**
 * Esito di una chiamata `bash` conclusa: `null` se ancora in corso.
 * omp mette `details.exitCode` solo quando e' diverso da zero e chiude con
 * `isError` timeout e interruzioni.
 */
function bashFailed(entry: ToolEntry): boolean | null {
	if (entry.running || !entry.result) return null;
	if (entry.result.isError) return true;
	const details = rec(entry.result.details);
	const exit = details?.exitCode ?? details?.code;
	return typeof exit === 'number' && exit !== 0;
}

/**
 * Comandi di verifica: test, build, typecheck, lint. Sono gli unici il cui
 * fallimento interessa all'utente; un `grep` senza risultati esce con 1 ed e'
 * normale esplorazione.
 */
const VERIFY_PATTERNS: RegExp[] = [
	/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|tests|check|lint|build|typecheck|type-check|verify|ci)(?::[\w-]+)?\b/i,
	/\b(?:npx|bunx|pnpm\s+exec)\s+(?:svelte-check|tsc|vitest|jest|eslint|playwright|mocha)\b/i,
	/(?:^|[\s;&|(])(?:tsc|svelte-check|vitest|jest|pytest|mocha|eslint|ruff|mypy|phpunit|rspec)\b/i,
	/\bcargo\s+(?:test|check|build|clippy|nextest)\b/i,
	/\bgo\s+(?:test|build|vet)\b/i,
	/\bdotnet\s+(?:build|test)\b/i,
	/\b(?:msbuild|mvn|gradlew?|make)\b/i,
	/\bnode\s+(?:--test\b|scripts\/run-[\w-]*test)/i,
	/\bpython3?\s+-m\s+(?:pytest|unittest)\b/i
];

/** Chiave del comando di verifica (es. «npm test», «cargo check»), o null. */
export function verifyKey(command: string): string | null {
	const flat = command.replace(/\s+/g, ' ').trim();
	for (const pattern of VERIFY_PATTERNS) {
		const match = pattern.exec(flat);
		if (match) return match[0].trim().replace(/^[;&|(]\s*/, '').toLowerCase();
	}
	return null;
}

/** Comandi che cambiano lo stato fuori dal working tree o cancellano lavoro. */
const RISKY_PATTERNS: RegExp[] = [
	/\bgit\s+push\b/i,
	/\bgit\s+reset\s+--hard\b/i,
	/\bgit\s+clean\s+-[a-z]*f/i,
	/\bgit\s+checkout\s+--\s/i,
	/\bgit\s+branch\s+-D\b/,
	/\b(?:drop|truncate)\s+(?:table|database|schema)\b/i,
	/\b(?:npm|cargo|pnpm|yarn)\s+publish\b/i,
	/\bgh\s+release\s+(?:create|delete)\b/i
];

/** Cartelle di lavoro che si ricreano: cancellarle non e' un rischio. */
const DISPOSABLE_TARGET = /^(?:\/tmp\/|\$TMPDIR|%TEMP%|(?:\.\/)?(?:node_modules|dist|build|target|out|coverage|\.svelte-kit|\.cache|__pycache__)(?:\/|$))/i;

/** `rm -r` su qualcosa che non sia una cartella usa e getta. */
function isRiskyRemove(command: string): boolean {
	for (const segment of command.split(/&&|\|\||;|\|/)) {
		const match = /^\s*(?:sudo\s+)?rm\s+((?:-[a-zA-Z]+\s+)+)(.*)$/.exec(segment);
		if (!match || !/r/i.test(match[1])) continue;
		const targets = match[2].trim().split(/\s+/).filter(Boolean);
		if (targets.length === 0) continue;
		if (targets.some((t) => !DISPOSABLE_TARGET.test(t.replace(/^["']|["']$/g, '')))) return true;
	}
	return false;
}

export function isRiskyCommand(command: string): boolean {
	return RISKY_PATTERNS.some((pattern) => pattern.test(command)) || isRiskyRemove(command);
}

/** Comando abbreviato per la frase: una riga, al massimo 60 caratteri. */
export function shortCommand(command: string): string {
	const flat = command.replace(/\s+/g, ' ').trim();
	// Il prefisso `cd <dir> &&` non dice nulla all'utente.
	const withoutCd = flat.replace(/^cd\s+\S+\s*&&\s*/, '');
	return withoutCd.length > 60 ? `${withoutCd.slice(0, 59).trimEnd()}…` : withoutCd;
}

/* ---------------------------------------------------------------- file --- */

const EDIT_TOOLS = new Set(['edit', 'write', 'ast_edit', 'astedit', 'ast-edit']);

/** Percorsi toccati da una chiamata di modifica. */
export function editedPaths(entry: ToolEntry): string[] {
	if (!EDIT_TOOLS.has(canonical(entry.toolName))) return [];
	const args = entry.args ?? {};
	const details = rec(entry.result?.details);
	const out: string[] = [];
	const push = (value: unknown) => {
		const path = str(value);
		if (path && !out.includes(path)) out.push(path);
	};
	push(details?.path);
	push(details?.resolvedPath);
	push(args.path);
	push(args.file);
	push(args.file_path);
	if (Array.isArray(args.paths)) for (const p of args.paths) push(p);
	const input = str(args.input);
	if (input) {
		// Formato hashline di omp: ogni blocco apre con `[percorso#...]`.
		for (const match of input.matchAll(/^\[([^#\]\n]+)/gm)) push(match[1]);
	}
	return out;
}

/**
 * File delicati di default: manifest delle dipendenze, migrazioni e schemi
 * del database, CI, variabili d'ambiente, regole per gli agenti, permessi
 * dell'app. I lockfile da soli non contano: cambiano come conseguenza del
 * manifest.
 */
const SENSITIVE_BASENAMES = new Set([
	'package.json',
	'cargo.toml',
	'go.mod',
	'pyproject.toml',
	'requirements.txt',
	'composer.json',
	'gemfile',
	'agents.md',
	'claude.md',
	'tauri.conf.json',
	'schema.prisma',
	'dockerfile',
	'docker-compose.yml',
	'docker-compose.yaml'
]);

export function isSensitivePath(path: string): boolean {
	const normalized = path.replace(/\\/g, '/').toLowerCase();
	const base = normalized.slice(normalized.lastIndexOf('/') + 1);
	if (SENSITIVE_BASENAMES.has(base)) return true;
	if (base === '.env' || base.startsWith('.env.')) return true;
	if (/(^|\/)\.github\/workflows\//.test(normalized)) return true;
	if (/(^|\/)(migrations?|db\/migrate)\//.test(normalized)) return true;
	if (base.endsWith('.sql')) return true;
	if (/(^|\/)src-tauri\/capabilities\//.test(normalized)) return true;
	return false;
}

/** Nome breve di un file per la frase: l'ultimo segmento. */
export function shortPath(path: string): string {
	const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
	return normalized.slice(normalized.lastIndexOf('/') + 1) || normalized;
}

/* -------------------------------------------------------------- domande --- */

/** Vero se una chiamata `ask` e' scaduta e omp ha risposto da se' al default. */
function askTimedOut(entry: ToolEntry): boolean {
	if (canonical(entry.toolName) !== 'ask' || !entry.result) return false;
	const details = rec(entry.result.details);
	if (details?.timedOut === true) return true;
	if (Array.isArray(details?.results)) {
		return details.results.some((r) => rec(r)?.timedOut === true);
	}
	return false;
}

/* ---------------------------------------------------------------- fatti --- */

/**
 * Fatti certi del turno, ordinati per gravita'. Ogni categoria compare al
 * massimo con le sue prime voci: la frase ne usa due.
 */
export function collectTurnFacts(turn: readonly TranscriptEntry[]): HeadsUpFact[] {
	const facts: HeadsUpFact[] = [];
	const tools = turn.filter((e): e is ToolEntry => e.kind === 'tool');

	// Comandi di verifica falliti e mai riusciti dopo: l'esito che conta e'
	// l'ultimo per ciascuna chiave («npm test» rieseguito e verde = risolto).
	const lastByKey = new Map<string, { entry: ToolEntry; failed: boolean; command: string }>();
	for (const entry of tools) {
		if (canonical(entry.toolName) !== 'bash') continue;
		const command = commandOf(entry);
		if (!command) continue;
		const failed = bashFailed(entry);
		if (failed === null) continue;
		const key = verifyKey(command);
		if (key) lastByKey.set(key, { entry, failed, command });
		if (!failed && isRiskyCommand(command)) {
			facts.push({ kind: 'risky-command', entryId: entry.id, subject: shortCommand(command) });
		}
	}
	for (const { entry, failed, command } of lastByKey.values()) {
		if (failed) facts.push({ kind: 'failed-command', entryId: entry.id, subject: shortCommand(command) });
	}

	for (const entry of tools) {
		if (askTimedOut(entry)) {
			facts.push({ kind: 'expired-question', entryId: entry.id, subject: '' });
		}
	}

	const seenPaths = new Set<string>();
	for (const entry of tools) {
		if (entry.result?.isError) continue;
		for (const path of editedPaths(entry)) {
			const key = path.replace(/\\/g, '/').toLowerCase();
			if (seenPaths.has(key) || !isSensitivePath(path)) continue;
			seenPaths.add(key);
			facts.push({ kind: 'sensitive-file', entryId: entry.id, subject: shortPath(path) });
		}
	}

	// Ordinamento stabile: gravita', poi ordine di comparsa nel turno.
	return facts
		.map((fact, index) => ({ fact, index }))
		.sort((a, b) => FACT_ORDER[a.fact.kind] - FACT_ORDER[b.fact.kind] || a.index - b.index)
		.map(({ fact }) => fact);
}

/* --------------------------------------------------------------- agente --- */

/** Frase dichiarata dall'agente con `studio_headsup` (l'ultima del turno). */
export function agentHeadsUp(turn: readonly TranscriptEntry[]): { text: string; entryId: number } | null {
	for (let i = turn.length - 1; i >= 0; i--) {
		const entry = turn[i];
		if (entry.kind !== 'tool' || canonical(entry.toolName) !== HEADS_UP_TOOL) continue;
		if (entry.result?.isError) continue;
		const text = str(entry.args?.text) ?? str(entry.args?.message);
		if (text) return { text: clampSentence(text), entryId: entry.id };
	}
	return null;
}

/** Vero se l'entry e' una chiamata di `studio_headsup` (nascosta nel transcript). */
export function isHeadsUpToolEntry(entry: TranscriptEntry): boolean {
	return entry.kind === 'tool' && canonical(entry.toolName) === HEADS_UP_TOOL;
}

/* ------------------------------------------------------------ frase fatti */

/** Testi localizzati per comporre la frase dai fatti. */
export interface HeadsUpPhrases {
	failed(command: string): string;
	failedTwo(first: string, second: string): string;
	/** `others` vale sempre almeno 2. */
	failedMany(command: string, others: number): string;
	expiredQuestion(): string;
	risky(command: string): string;
	sensitive(files: string): string;
	/** `others` vale sempre almeno 2. */
	sensitiveMany(files: string, others: number): string;
	/** Congiunzione fra due nomi di file («e» / «and»). */
	and: string;
}

function capitalize(text: string): string {
	return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * Una frase dai fatti: al massimo due clausole (le due categorie piu' gravi)
 * unite da «;», con il punto finale.
 */
export function factsSentence(facts: readonly HeadsUpFact[], phrases: HeadsUpPhrases): string | null {
	if (facts.length === 0) return null;
	const clauses: string[] = [];
	const kinds: HeadsUpFactKind[] = [];
	for (const fact of facts) if (!kinds.includes(fact.kind)) kinds.push(fact.kind);

	for (const kind of kinds.slice(0, 2)) {
		const ofKind = facts.filter((f) => f.kind === kind);
		switch (kind) {
			case 'failed-command':
				clauses.push(
					ofKind.length === 1
						? phrases.failed(ofKind[0].subject)
						: ofKind.length === 2
							? phrases.failedTwo(ofKind[0].subject, ofKind[1].subject)
							: phrases.failedMany(ofKind[0].subject, ofKind.length - 1)
				);
				break;
			case 'expired-question':
				clauses.push(phrases.expiredQuestion());
				break;
			case 'risky-command':
				clauses.push(phrases.risky(ofKind[0].subject));
				break;
			case 'sensitive-file': {
				// Fino a tre nomi si elencano tutti; oltre, i primi due e «altri N».
				const names = ofKind.map((f) => f.subject);
				if (names.length <= 3) {
					const list =
						names.length === 1
							? names[0]
							: `${names.slice(0, -1).join(', ')} ${phrases.and} ${names[names.length - 1]}`;
					clauses.push(phrases.sensitive(list));
				} else {
					clauses.push(phrases.sensitiveMany(names.slice(0, 2).join(', '), names.length - 2));
				}
				break;
			}
		}
	}
	return clampSentence(`${capitalize(clauses.join('; '))}.`);
}

/* ------------------------------------------------------------ decisione --- */

/**
 * Sceglie la frase del turno. L'agente vince sempre; smol sostituisce la
 * frase dei fatti perche' la riceve in ingresso e la fonde col racconto;
 * i fatti da soli restano il ripiego deterministico.
 */
export function resolveHeadsUp(input: {
	agent: { text: string; entryId: number } | null;
	smol: string | null;
	facts: readonly HeadsUpFact[];
	factsText: string | null;
	fallbackEntryId: number | null;
}): TurnHeadsUp | null {
	const target = input.facts[0]?.entryId ?? input.fallbackEntryId;
	if (input.agent) return { text: input.agent.text, source: 'agent', targetEntryId: target };
	const smol = input.smol ? clampSentence(input.smol) : '';
	if (smol) return { text: smol, source: 'smol', targetEntryId: target };
	if (input.factsText) return { text: input.factsText, source: 'facts', targetEntryId: target };
	return null;
}

/** Ultima risposta testuale del turno: il punto di arrivo del clic se non ci sono fatti. */
export function lastAssistantId(turn: readonly TranscriptEntry[]): number | null {
	for (let i = turn.length - 1; i >= 0; i--) {
		const entry = turn[i];
		if (entry.kind === 'assistant' && entry.blocks.some((b) => b.type === 'text' && b.text.trim())) return entry.id;
	}
	return null;
}

/* --------------------------------------------------------- ripiego smol --- */

/**
 * Il ripiego smol si chiede solo per turni che possono nascondere qualcosa:
 * con fatti certi, molte chiamate o un racconto lungo. Un turno di due righe
 * l'utente lo legge tutto.
 */
export function wantsSmolHeadsUp(turn: readonly TranscriptEntry[], facts: readonly HeadsUpFact[]): boolean {
	if (facts.length > 0) return true;
	let toolCalls = 0;
	let textChars = 0;
	for (const entry of turn) {
		if (entry.kind === 'tool') toolCalls += 1;
		else if (entry.kind === 'assistant') {
			for (const block of entry.blocks) if (block.type === 'text') textChars += block.text.length;
		}
	}
	return toolCalls >= 8 || textChars >= 1500;
}

/**
 * Digest del turno per smol: fatti in elenco e tutto il testo dell'agente
 * (non solo l'ultimo messaggio), tagliato in mezzo se troppo lungo. E' il
 * testo «a meta' chat» che l'utente rischia di perdere.
 */
export function buildTurnDigest(turn: readonly TranscriptEntry[], facts: readonly HeadsUpFact[], maxChars = 6000): string {
	const lines: string[] = [];
	if (facts.length > 0) {
		lines.push('# Fatti certi del turno (calcolati da Studio)');
		for (const fact of facts.slice(0, 6)) lines.push(`- ${fact.kind}: ${fact.subject || '-'}`);
		lines.push('');
	}
	const texts: string[] = [];
	for (const entry of turn) {
		if (entry.kind !== 'assistant') continue;
		for (const block of entry.blocks) if (block.type === 'text' && block.text.trim()) texts.push(block.text.trim());
	}
	let body = texts.join('\n\n');
	if (body.length > maxChars) {
		const half = Math.floor((maxChars - 20) / 2);
		body = `${body.slice(0, half)}\n\n[…]\n\n${body.slice(body.length - half)}`;
	}
	lines.push('# Testo completo del turno dell\'agente');
	lines.push(body);
	return lines.join('\n');
}

/* ------------------------------------------------------------ visto/chiuso */

/** Hash corto e stabile (djb2) per la chiave «visto» di una frase. */
export function hashText(text: string): string {
	let hash = 5381;
	for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
	return (hash >>> 0).toString(36);
}

/** Chiave «visto»: sessione + frase. Regge alla ricostruzione del transcript. */
export function headsUpSeenKey(sessionId: string | null | undefined, text: string): string {
	return `${sessionId ?? 'nosession'}|${hashText(text)}`;
}
