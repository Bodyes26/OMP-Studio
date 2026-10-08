// Logica pura dei tool `corsia_*` (bridge `/v1/corsie/<verbo>`).
//
// Niente rune ne' Tauri: permessi, risoluzione della corsia nominata
// dall'agente, stato sintetico, diffstat e pacchetto di consegna del
// Laboratorio devono poter essere verificati dagli smoke test con il solo
// type-stripping di Node. Il servizio reattivo (`agentLanes.svelte.ts`) usa
// queste funzioni e si occupa solo di I/O.
//
// Invarianti difese qui:
// 1. Dentro una corsia (worktree o Laboratorio) si possono chiamare solo
//    `fatto` e `stato`: lo stesso controllo vive in Rust, questo e' la difesa
//    in profondita' del frontend.
// 2. L'agente nomina una corsia per id, id del prototipo o titolo: un nome
//    ambiguo non sceglie a caso, restituisce l'elenco.
// 3. Il testo per l'agente non contiene mai istruzioni git: il "come" e' di Studio.

import { MAIN_LANE_ID } from '../types/lanes.ts';

export const CORSIA_VERBI = [
	'avvia',
	'stato',
	'risultato',
	'integra',
	'chiudi',
	'scarta',
	'consegna',
	'fatto',
	'proponi'
] as const;

export type CorsiaVerbo = (typeof CORSIA_VERBI)[number];

const VERBI: Record<string, true> = Object.fromEntries(CORSIA_VERBI.map((v) => [v, true]));

/** `corsia_integra` -> `integra`; qualunque altro nome -> null. */
export function corsiaVerboOf(toolName: string | null | undefined): CorsiaVerbo | null {
	const match = /^corsia_([a-z]+)$/.exec((toolName ?? '').trim().toLowerCase());
	if (!match || !VERBI[match[1]]) return null;
	return match[1] as CorsiaVerbo;
}

export function isCorsiaTool(toolName: string | null | undefined): boolean {
	return corsiaVerboOf(toolName) !== null;
}

/** Il verbo del bridge: il percorso arriva da Rust gia' validato, qui si rilegge difensivamente. */
export function parseCorsiaVerbo(route: unknown): CorsiaVerbo | null {
	return typeof route === 'string' && VERBI[route] ? (route as CorsiaVerbo) : null;
}

/** Una sessione senza corsia, o sulla Principale, e' la Principale. */
export function callerIsMain(callerLaneId: string | null | undefined): boolean {
	const lane = (callerLaneId ?? '').trim();
	return lane === '' || lane === MAIN_LANE_ID;
}

export function verboAllowedForCaller(verbo: CorsiaVerbo, callerLaneId: string | null | undefined): boolean {
	if (callerIsMain(callerLaneId)) return verbo !== 'fatto';
	return verbo === 'fatto' || verbo === 'stato';
}

/* ------------------------------------------------ risoluzione corsia --- */

export interface LaneRefCandidate {
	laneId: string;
	title: string;
	kind: 'git' | 'lab';
	status: string;
	labPrototypeId?: string | null;
}

export type LaneRefResolution<T extends LaneRefCandidate> =
	| { kind: 'found'; lane: T }
	| { kind: 'missing' }
	| { kind: 'ambiguous'; matches: T[] };

function isOpenLane(lane: LaneRefCandidate): boolean {
	return lane.laneId !== MAIN_LANE_ID && lane.status !== 'archived';
}

/**
 * Trova la corsia nominata dall'agente. Ordine: id esatto, id del prototipo,
 * titolo senza distinzione di maiuscole. Le archiviate non esistono piu' per
 * l'agente; le chiuse si', perche' si possono ancora scartare o leggere.
 */
export function resolveLaneRef<T extends LaneRefCandidate>(
	lanes: readonly T[],
	ref: string | null | undefined
): LaneRefResolution<T> {
	const wanted = (ref ?? '').trim();
	if (!wanted) return { kind: 'missing' };
	const candidates = lanes.filter(isOpenLane);
	const byId = candidates.find((lane) => lane.laneId === wanted);
	if (byId) return { kind: 'found', lane: byId };
	const byPrototype = candidates.find(
		(lane) => lane.kind === 'lab' && (lane.labPrototypeId === wanted || `lab-${lane.labPrototypeId}` === wanted)
	);
	if (byPrototype) return { kind: 'found', lane: byPrototype };
	const lower = wanted.toLowerCase();
	const byTitle = candidates.filter((lane) => lane.title.trim().toLowerCase() === lower);
	if (byTitle.length === 1) return { kind: 'found', lane: byTitle[0] };
	if (byTitle.length > 1) return { kind: 'ambiguous', matches: byTitle };
	return { kind: 'missing' };
}

/** Elenco leggibile delle corsie tra cui scegliere, per i messaggi d'errore all'agente. */
export function describeLaneChoices(lanes: readonly LaneRefCandidate[]): string {
	const open = lanes.filter((lane) => isOpenLane(lane) && lane.status !== 'closed');
	if (open.length === 0) return 'Nessuna corsia aperta nel progetto.';
	return `Corsie aperte:\n${open.map((lane) => `- ${lane.laneId}: ${lane.title}`).join('\n')}`;
}

/* -------------------------------------------------- stato sintetico --- */

/** Stato di una corsia come lo legge l'agente della Principale. */
export type AgentLaneState = 'in_corso' | 'finita' | 'bloccata' | 'in_coda' | 'chiusa';

export const AGENT_LANE_STATE_LABEL: Record<AgentLaneState, string> = {
	in_corso: 'in corso',
	finita: 'finita',
	bloccata: 'bloccata',
	in_coda: 'in coda',
	chiusa: 'chiusa'
};

export interface AgentLaneStateInput {
	status: string;
	/** Stato proprio della corsia (`laneOrchestrator.laneAgentState`). */
	agentState: string;
	agentSummaryAt?: number | null;
	recoveryState?: string;
}

/**
 * `bloccata` vuol dire "serve l'utente": conflitti, una domanda aperta, una
 * pulizia rimasta a meta'. `finita` arriva da `corsia_fatto` o dalla
 * revisione pronta; il lavoro ripartito dopo il `fatto` torna `in corso`.
 */
export function classifyAgentLane(input: AgentLaneStateInput): AgentLaneState {
	if (input.status === 'closed' || input.status === 'archived') return 'chiusa';
	if (input.status === 'conflict' || input.recoveryState === 'cleanup_pending') return 'bloccata';
	if (input.agentState === 'attention') return 'bloccata';
	if (input.agentState === 'working' || input.status === 'integrating') return 'in_corso';
	if (input.agentSummaryAt || input.status === 'review_ready' || input.agentState === 'finished') {
		return 'finita';
	}
	return 'in_corso';
}

/* -------------------------------------------------------- diffstat --- */

export interface DiffFile {
	path: string;
	additions: number;
	deletions: number;
}

export interface Diffstat {
	files: number;
	additions: number;
	deletions: number;
	paths: string[];
}

export function computeDiffstat(files: readonly DiffFile[]): Diffstat {
	let additions = 0;
	let deletions = 0;
	for (const file of files) {
		additions += Number.isFinite(file.additions) ? file.additions : 0;
		deletions += Number.isFinite(file.deletions) ? file.deletions : 0;
	}
	return { files: files.length, additions, deletions, paths: files.map((file) => file.path) };
}

export function formatDiffstat(stat: Diffstat | null | undefined): string {
	if (!stat || stat.files === 0) return 'nessun file modificato';
	return `${stat.files} file, +${stat.additions} -${stat.deletions}`;
}

/** Al massimo `limit` percorsi, con il conto di quelli taciuti. */
export function listPaths(paths: readonly string[], limit = 12): string {
	if (paths.length === 0) return '';
	const shown = paths.slice(0, limit).join(', ');
	return paths.length > limit ? `${shown} (+${paths.length - limit})` : shown;
}

/* ------------------------------------------------------- testi stato --- */

export interface AgentLaneRow {
	laneId: string;
	title: string;
	kind: 'git' | 'lab' | 'goal';
	state: AgentLaneState;
	diffstat?: Diffstat | null;
	/** Per i prototipi: messaggio dell'ultima revisione. */
	revision?: string | null;
	summary?: string | null;
}

export function formatStatoText(rows: readonly AgentLaneRow[]): string {
	if (rows.length === 0) return 'Nessuna corsia aperta o in coda nel progetto.';
	const lines = rows.map((row) => {
		const kind = row.kind === 'lab' ? 'prototipo' : row.kind === 'goal' ? 'obiettivo' : 'worktree';
		const parts = [`- ${row.laneId} (${kind}) "${row.title}": ${AGENT_LANE_STATE_LABEL[row.state]}`];
		if (row.kind === 'git') {
			parts.push(`  diff: ${formatDiffstat(row.diffstat)}`);
			const paths = listPaths(row.diffstat?.paths ?? []);
			if (paths) parts.push(`  file: ${paths}`);
		}
		if (row.kind === 'lab' && row.revision) parts.push(`  ultima revisione: ${row.revision}`);
		if (row.summary) parts.push(`  riassunto: ${firstLine(row.summary)}`);
		return parts.join('\n');
	});
	return `Corsie del progetto:\n${lines.join('\n')}`;
}

function firstLine(text: string): string {
	const line = text.trim().split('\n', 1)[0] ?? '';
	return line.length > 160 ? `${line.slice(0, 159)}\u2026` : line;
}

/* ------------------------------------------------ consegna (handoff) --- */

export interface LabHandoffInput {
	prototypeId: string;
	title: string;
	summary: string;
	workspacePath: string;
	revision: { sha: string; message: string; date: string } | null;
	files: readonly string[];
	previewUrl?: string | null;
	previewErrors?: number;
}

/**
 * Limiti che il prototipo non dimostra: il pacchetto li rende espliciti
 * perche' la Principale non li scambi per comportamento reale (Gate R24 §7).
 */
export const LAB_SIMULATION_LIMITS: readonly string[] = [
	'I dati sono simulati: nessuna chiamata a backend, database o API reali.',
	"Autenticazione, permessi e gestione degli errori di rete non sono implementati.",
	"Le prestazioni con dati reali non sono state misurate.",
	"Il runtime e' React 19 + Tailwind v4 dell'anteprima: non va importato nel progetto."
];

/** Pacchetto di consegna di un prototipo del Laboratorio alla Principale. */
export function buildLabHandoffPackage(input: LabHandoffInput): string {
	const revision = input.revision
		? `${input.revision.sha.slice(0, 7)} "${input.revision.message}" (${input.revision.date})`
		: 'nessuna revisione registrata';
	const sources = input.files.filter((path) => !path.startsWith('.lab/'));
	const lines = [
		`# Consegna prototipo Laboratorio: ${input.title}`,
		'',
		`- Prototipo: ${input.prototypeId}`,
		`- Revisione: ${revision}`,
		`- Sorgenti (sola lettura): ${input.workspacePath}`
	];
	if (input.previewUrl) {
		const errors = input.previewErrors ?? 0;
		lines.push(`- Anteprima: ${input.previewUrl}${errors > 0 ? ` (${errors} errori aperti)` : ''}`);
	}
	lines.push('', '## Cosa fa', input.summary.trim() || '(nessun riepilogo lasciato dall\'agente del Laboratorio)');
	lines.push('', '## File del prototipo');
	lines.push(...(sources.length > 0 ? sources.map((path) => `- ${path}`) : ['- (nessun file)']));
	lines.push('', '## Limiti delle simulazioni');
	lines.push(...LAB_SIMULATION_LIMITS.map((limit) => `- ${limit}`));
	lines.push(
		'',
		'## Come procedere',
		"Leggi i sorgenti indicati e reimplementa l'interfaccia nello stack nativo di questo progetto " +
			'(componenti, stili e convenzioni esistenti). Non copiare il runtime del prototipo e non ' +
			'modificare la cartella del prototipo. Se il lavoro e\' rischioso o lungo, proponi una corsia con corsia_proponi.'
	);
	return lines.join('\n');
}

/* ---------------------------------------------------------- proposta --- */

export type ProposalChoice = 'main' | 'worktree';

/** Testo restituito all'agente dopo il clic sulla card di proposta. */
export function proposalAgentText(
	choice: ProposalChoice,
	outcome?: { laneId: string; title: string; dispatched: boolean } | { error: string }
): string {
	if (choice === 'main') {
		return "L'utente ha scelto: resta su main. Prosegui sulla Principale con cautela.";
	}
	if (!outcome) return "L'utente ha scelto il worktree ma la corsia non e' stata creata.";
	if ('error' in outcome) {
		return `L'utente ha scelto il worktree ma Studio non ha potuto crearlo: ${outcome.error}. Non eseguire l'operazione sulla Principale: riferisci all'utente.`;
	}
	return outcome.dispatched
		? `L'utente ha scelto il worktree: corsia ${outcome.laneId} ("${outcome.title}") creata e il compito e' gia' stato affidato al suo agente. Non eseguire l'operazione sulla Principale; segui l'avanzamento con corsia_stato e corsia_risultato.`
		: `L'utente ha scelto il worktree: corsia ${outcome.laneId} ("${outcome.title}") creata e aperta all'utente. Non eseguire l'operazione sulla Principale: il lavoro prosegue nella nuova corsia.`;
}
