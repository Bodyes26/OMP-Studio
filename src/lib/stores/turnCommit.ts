/**
 * Commit di fine turno dell'agente (R-MI-73).
 *
 * Nei progetti che vivono su piu' macchine collegate il lavoro dell'agente
 * deve viaggiare da solo verso l'altra copia: a fine turno Studio committa i
 * soli file che l'agente ha cambiato in quel turno, con un messaggio fisso e
 * senza costo. Le modifiche fatte a mano restano non committate.
 *
 * «Cambiato in quel turno» si misura confrontando lo stato del working tree
 * all'inizio del turno (`git_turn_snapshot`, preso su `agent_start`) con quello
 * alla fine: un file gia' sporco prima e non toccato dall'agente resta fuori,
 * mentre uno gia' sporco e cambiato di nuovo entra.
 *
 * Non si committa quando il turno e' finito per un errore di omp o per
 * l'uscita del processo a meta' lavoro: li' il working tree puo' essere in uno
 * stato che l'agente non ha finito di sistemare. Dopo lo Stop dell'utente
 * invece si committa, perche' il lavoro fatto fino a quel punto e' comunque
 * lavoro del turno.
 *
 * La logica sta in un oggetto con dipendenze iniettate: i test la esercitano
 * con un `invoke` finto, senza aprire store ne' collegamenti. L'aggancio agli
 * store veri sta in `turnCommitLive.ts`, cosi' questo modulo resta caricabile
 * da Node senza la catena di `githubStore` e dei suoi comandi Tauri.
 */

import type { MachineId } from '#lib/backend/ipc.ts';
import { m } from '#lib/paraglide/messages.js';
import type { Project } from './projects.svelte';

/** Voce dell'istantanea dei file sporchi: percorso e impronta del contenuto. */
export interface SnapshotEntry {
	path: string;
	hash: string;
}

/** Esito del comando Rust `git_turn_commit`. */
export interface TurnCommitResult {
	committed: string[];
	commit: string | null;
	skipped: string | null;
}

/**
 * Come e' finito il turno:
 * - `normal`: l'agente ha concluso;
 * - `stop`: fermato dall'utente (il lavoro fatto resta lavoro del turno);
 * - `error`: errore di omp o del provider, il working tree puo' essere a meta';
 * - `exit`: processo uscito o crash prima della fine del turno.
 */
export type TurnOutcome = 'normal' | 'stop' | 'error' | 'exit';

/** Dati della sessione che servono al commit di fine turno. */
export interface TurnContext {
	/** Chiave della sessione (corsia), per accoppiare inizio e fine turno. */
	sessionKey: string;
	/** Progetto della sessione; `null` per sessioni senza progetto. */
	project: Project | null;
	/** Cartella in cui lavora la sessione (radice o worktree della corsia). */
	cwd: string | null;
	/** Macchina che esegue la sessione: e' lei che deve committare. */
	machine: MachineId;
	/** Titolo della chat; assente finche' non ne ha uno. */
	title: string | null;
}

/** Dipendenze del commit di fine turno: i test le sostituiscono. */
export interface TurnCommitDeps {
	/** Vero quando il progetto vive su piu' macchine collegate. */
	active(context: TurnContext): boolean | Promise<boolean>;
	/** Istantanea dei file sporchi della cartella. */
	snapshot(context: TurnContext): Promise<SnapshotEntry[]>;
	/** Commit dei soli file cambiati dalla baseline. */
	commit(context: TurnContext, baseline: SnapshotEntry[], message: string): Promise<TurnCommitResult>;
	/** Nome leggibile della macchina per il messaggio fisso. */
	machineName(machine: MachineId): string | Promise<string>;
	/** Dopo un commit riuscito: la sincronizzazione delle copie deve ripartire. */
	afterCommit(context: TurnContext): void;
	log(level: 'info' | 'warn', message: string): void;
}

/**
 * Messaggio fisso del commit: macchina e titolo della chat. Senza titolo si
 * usa un ripiego localizzato, mai una stringa vuota.
 */
export function turnCommitMessage(machine: string, title: string | null): string {
	const name = title?.trim() ? title.trim() : m.turn_commit_untitled();
	return m.turn_commit_message({ machine, title: name });
}

/**
 * R-MI-73 vale solo per i progetti che hanno almeno un'altra copia su
 * un'altra macchina: su un progetto che vive qui e basta il commit di fine
 * turno non serve e non si fa (nessuna istantanea, nessun commit).
 *
 * `machines` sono le macchine delle copie del gruppo del progetto, questa
 * compresa; `localMachine` e' l'identificativo di questa. Basta che una copia
 * nomini un'altra macchina, accesa o spenta: il commit e' proprio quello che
 * la gemella trova al suo ritorno (R-MI-26).
 */
export function isSharedProject(
	project: Project | null,
	machines: readonly (string | undefined)[],
	localMachine: string
): boolean {
	if (!project) return false;
	// I prototipi del Laboratorio hanno le revisioni del Laboratorio, non
	// commit sul repository dell'utente.
	if (project.labDraft || !project.canonicalProjectPath) return false;
	return machines.some((machine) => Boolean(machine) && machine !== localMachine);
}

/** Il turno merita il commit solo se e' finito per davvero (R-MI-73). */
export function commitsOnOutcome(outcome: TurnOutcome): boolean {
	return outcome === 'normal' || outcome === 'stop';
}

/** Il confine IPC per il commit di fine turno: i test ne mettono uno finto. */
export interface TurnCommitIpc {
	invoke<T>(
		command: 'git_turn_snapshot' | 'git_turn_commit',
		args: Record<string, unknown>,
		machine: MachineId
	): Promise<T>;
	/** Vero per i progetti con un'altra copia su un'altra macchina. */
	isShared(project: Project): boolean;
	machineName(machine: MachineId): string;
	/** Dopo un commit riuscito: la sincronizzazione delle copie deve ripartire. */
	afterCommit(project: Project): void;
	log(level: 'info' | 'warn', message: string): void;
}

/**
 * Le dipendenze reali, costruite sopra il confine IPC. Sta qui e non nel modulo
 * che le collega agli store veri perche' cosi' i test possono sostituire
 * `invoke` e controllare che comando e argomenti siano quelli che il backend
 * Rust si aspetta (`projectPath`, `baseline`, `message`, macchina della
 * sessione) senza caricare la finestra.
 */
export function createTurnCommitDeps(ipc: TurnCommitIpc): TurnCommitDeps {
	return {
		active: (context) => (context.project ? ipc.isShared(context.project) : false),
		snapshot: (context) =>
			ipc.invoke<SnapshotEntry[]>('git_turn_snapshot', { projectPath: context.cwd }, context.machine),
		commit: (context, baseline, message) =>
			ipc.invoke<TurnCommitResult>('git_turn_commit', { projectPath: context.cwd, baseline, message }, context.machine),
		machineName: (machine) => ipc.machineName(machine),
		afterCommit: (context) => {
			if (context.project) ipc.afterCommit(context.project);
		},
		log: (level, message) => ipc.log(level, message)
	};
}

export interface TurnTracker {
	/** Baseline del turno; la chiama `agent_start`. */
	onTurnStart(context: TurnContext): Promise<void>;
	/** Commit dei soli file cambiati; la chiama `agent_end`. */
	onTurnEnd(context: TurnContext, outcome: TurnOutcome): Promise<void>;
	/** Baseline ancora in attesa di fine turno, per i test e il log. */
	baselineFor(sessionKey: string): SnapshotEntry[] | null;
}

export function createTurnTracker(deps: TurnCommitDeps): TurnTracker {
	/** Baseline per sessione: presa all'inizio del turno, consumata alla fine. */
	const baselines = new Map<string, SnapshotEntry[]>();
	/**
	 * Generazione del turno aperto per sessione. L'istantanea e' una chiamata
	 * che puo' tornare dopo la fine del turno (o dopo l'inizio del successivo):
	 * senza questo numero la sua risposta registrerebbe una baseline vecchia
	 * che il turno dopo userebbe come se fosse la propria.
	 */
	const openTurn = new Map<string, number>();
	let turnSeq = 0;

	function baselineFor(sessionKey: string): SnapshotEntry[] | null {
		return baselines.get(sessionKey) ?? null;
	}

	async function onTurnStart(context: TurnContext): Promise<void> {
		// Una baseline vecchia rimasta appesa (turno chiuso senza `agent_end`)
		// non deve essere usata dal turno nuovo.
		baselines.delete(context.sessionKey);
		const turn = ++turnSeq;
		openTurn.set(context.sessionKey, turn);
		if (!context.cwd || !context.project) return;
		if (!(await deps.active(context))) return;
		try {
			const entries = await deps.snapshot(context);
			// Nel frattempo il turno puo' essere finito o riaperto: in entrambi
			// i casi questa istantanea non descrive il turno in corso.
			if (openTurn.get(context.sessionKey) !== turn) return;
			baselines.set(context.sessionKey, entries);
		} catch (error) {
			deps.log('warn', `istantanea del turno non letta: ${String(error)}`);
		}
	}

	async function onTurnEnd(context: TurnContext, outcome: TurnOutcome): Promise<void> {
		const baseline = baselines.get(context.sessionKey) ?? null;
		baselines.delete(context.sessionKey);
		openTurn.delete(context.sessionKey);
		if (!commitsOnOutcome(outcome)) return;
		if (!context.cwd || !context.project) return;
		// Senza baseline il turno e' partito prima che questa funzione fosse
		// ascoltata: non si sa cosa ha toccato l'agente, e un commit «di tutto»
		// prenderebbe anche il lavoro a mano (R-MI-73 lo vieta).
		if (baseline === null) return;
		if (!(await deps.active(context))) return;
		try {
			const message = turnCommitMessage(await deps.machineName(context.machine), context.title);
			const result = await deps.commit(context, baseline, message);
			if (result.commit) {
				deps.log('info', `commit di fine turno ${result.commit.slice(0, 8)} (${result.committed.length} file)`);
				deps.afterCommit(context);
			} else if (result.skipped) {
				deps.log('info', `commit di fine turno saltato: ${result.skipped}`);
			}
		} catch (error) {
			// Un commit mancato non e' un errore da mostrare in chat: il lavoro
			// resta nel working tree e il giro delle copie lo segnala.
			deps.log('warn', `commit di fine turno non riuscito: ${String(error)}`);
		}
	}

	return { onTurnStart, onTurnEnd, baselineFor };
}
