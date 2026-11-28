/**
 * «Allinea tutto» (R-MI-74): committare le modifiche in sospeso di tutte le
 * copie, scambiarle, e se l'unione non riesce da sola affidarla all'agente.
 *
 * Il giro ha tre passi, e nessuno dei tre perde modifiche:
 *
 * 1. per ogni copia in linea dello stesso progetto con qualcosa in sospeso si
 *    committa quello che c'e' (`copy_commit_pending`, messaggio fisso). Una
 *    copia occupata da un agente o spenta viene nominata e attesa, mai toccata
 *    a forza: nessun reset, nessun checkout forzato, nessuno stash.
 * 2. giro di sincronizzazione delle copie (R-MI-26, R-MI-61): quello che git
 *    sa unire si unisce da solo.
 * 3. se resta un conflitto vero, il compito gia' scritto passa a un agente DI
 *    QUESTA MACCHINA (`copyConflictTask.ts`): unire tutte le versioni,
 *    risolvere, eseguire le verifiche del progetto, committare.
 *
 * Lo stato e' osservabile (fase, macchine in attesa, errore) perche' la
 * striscia delle copie lo mostra mentre il giro va avanti.
 *
 * Solo regole e orchestrazione: l'aggancio agli store veri sta in
 * `copyAlignLive.svelte.ts`, cosi' questo modulo si carica in Node senza la
 * catena di `githubStore` e dei comandi Tauri.
 */

import { m } from '#lib/paraglide/messages.js';
import type { Project } from './projects.svelte';
import type { CopyAlignConflict } from './copyConflictTask.ts';

export type AlignPhase = 'idle' | 'committing' | 'syncing' | 'agent' | 'done' | 'error';

/** Una copia del progetto vista da questa finestra. */
export interface AlignCopy {
	machine: string;
	name: string;
	/** Radice canonica della copia su quella macchina. */
	path: string;
	online: boolean;
	local: boolean;
}

/** Branch di un giro di sincronizzazione, quanto basta per decidere. */
export interface SyncBranchLike {
	name: string;
	state: string;
	reason: string | null;
}

export interface SyncReportLike {
	machine: string;
	branches: SyncBranchLike[];
}

export interface AlignDeps {
	copies(project: Project): AlignCopy[] | Promise<AlignCopy[]>;
	/** Quanti file in sospeso ha la copia (0 = niente da committare). */
	pendingFiles(copy: AlignCopy): Promise<number>;
	commitPending(copy: AlignCopy, message: string): Promise<{ commit: string | null; skipped: string | null }>;
	/** Giro di sincronizzazione: un rapporto per gemella raggiungibile. */
	sync(project: Project): Promise<SyncReportLike[]>;
	startAgent(project: Project, conflicts: CopyAlignConflict[]): Promise<unknown>;
	/** Nome leggibile della macchina, per il messaggio fisso del commit. */
	machineName(machine: string): string | Promise<string>;
	sleep(ms: number): Promise<void>;
	log(level: 'info' | 'warn', message: string): void;
	/**
	 * Testo di un errore per la striscia (C5). Lo fornisce la finestra con
	 * `routeErrorText`, cosi' un rifiuto di instradamento nomina la macchina;
	 * qui il modulo resta caricabile in Node, senza la catena di `ipc.ts`.
	 */
	errorText?(error: unknown): string;
}

/** Quante volte si riprova una copia occupata, e con che attesa. */
const BUSY_ATTEMPTS = 3;
const BUSY_WAIT_MS = 2_000;

/**
 * Il confine IPC del giro, con le letture che non sono comandi propri. I test
 * ne mettono uno finto per controllare quali comandi partono e con che
 * argomenti; la finestra collega gli store veri in `copyAlignLive`.
 */
export interface AlignIpc {
	invoke<T>(command: 'copy_wip_estimate' | 'copy_commit_pending', args: Record<string, unknown>, machine: string): Promise<T>;
	copies(project: Project): AlignCopy[];
	/** Giro di sincronizzazione della copia locale: un rapporto per gemella. */
	sync(project: Project): Promise<SyncReportLike[]>;
	/** Il compito all'agente di questa macchina. */
	startAgent(project: Project, conflicts: CopyAlignConflict[]): Promise<unknown>;
	machineName(machine: string): string;
	/** Testo d'errore per la striscia (C5). */
	errorText(error: unknown): string;
	log(level: 'info' | 'warn', message: string): void;
}

/**
 * Le dipendenze del giro sopra il confine IPC: la stessa costruzione che usa la
 * finestra, cosi' i test difendono i nomi dei comandi (`copy_wip_estimate`,
 * `copy_commit_pending`) e il fatto che ogni copia si committi SULLA SUA
 * macchina, non qui.
 */
export function createAlignDeps(ipc: AlignIpc): AlignDeps {
	return {
		copies: (project) => ipc.copies(project),
		pendingFiles: (copy) =>
			ipc.invoke<{ files: number }>('copy_wip_estimate', { projectPath: copy.path }, copy.machine)
				.then((estimate) => estimate.files),
		commitPending: (copy, message) =>
			ipc.invoke<{ commit: string | null; skipped: string | null }>(
				'copy_commit_pending',
				{ projectPath: copy.path, message },
				copy.machine
			),
		sync: (project) => ipc.sync(project),
		startAgent: (project, conflicts) => ipc.startAgent(project, conflicts),
		machineName: (machine) => ipc.machineName(machine),
		sleep(ms) {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, ms);
			return promise;
		},
		log: (level, message) => ipc.log(level, message),
		errorText: (error) => ipc.errorText(error)
	};
}

/**
 * Riga da mostrare nella striscia per la fase corrente: dice a che punto e'
 * il giro e, quando serve, quali macchine si stanno aspettando.
 */
export function alignPhaseText(state: { phase: AlignPhase; waiting: readonly string[]; error: string | null }): string | null {
	switch (state.phase) {
		case 'committing': return m.copies_align_phase_committing();
		case 'syncing': return m.copies_align_phase_syncing();
		case 'agent': return m.copies_align_phase_agent();
		case 'done': return m.copies_align_phase_done();
		case 'error': return m.copies_align_failed({ error: state.error ?? '' });
		default: return null;
	}
}

/** «In attesa di Windows, Mac»: le copie nominate e non ancora raggiunte. */
export function alignWaitingText(waiting: readonly string[]): string | null {
	if (waiting.length === 0) return null;
	return m.copies_align_waiting({ machines: waiting.join(', ') });
}

/**
 * File nominati in un motivo di conflitto (`conflict:a.ts,b.ts`): sono quelli
 * che l'agente deve aprire. `[]` quando il motivo non e' un conflitto.
 */
export function conflictFilesIn(reason: string | null): string[] {
	if (!reason?.startsWith('conflict:')) return [];
	return reason.slice('conflict:'.length).split(',').map((file) => file.trim()).filter(Boolean);
}

/**
 * Conflitti veri da consegnare all'agente: le branch divergenti che git non
 * unisce e quelle ferme perche' le modifiche locali non si riapplicano. Una
 * branch solo indietro o avanti non e' un conflitto e non serve un agente.
 */
export function conflictsFrom(reports: readonly SyncReportLike[]): CopyAlignConflict[] {
	const result: CopyAlignConflict[] = [];
	const seen = new Set<string>();
	for (const report of reports) {
		for (const branch of report.branches) {
			if (branch.state !== 'diverged' && branch.state !== 'pending') continue;
			const files = conflictFilesIn(branch.reason);
			if (files.length === 0) continue;
			const key = `${report.machine}|${branch.name}`;
			if (seen.has(key)) continue;
			seen.add(key);
			result.push({ branch: branch.name, machine: report.machine, files });
		}
	}
	return result;
}

/**
 * Quale azione la striscia delle copie mostra (R-MI-61, R-MI-74).
 *
 * «Allinea tutto» si offre quando c'e' qualcosa che il giro automatico non
 * risolve da solo: copie divergenti, commit in arrivo bloccati da modifiche non
 * committate, oppure modifiche non committate su altre copie. Con un conflitto
 * solo e nient'altro da committare resta «Risolvi» (R-MI-61): quel compito
 * unisce una gemella sola, ed e' piu' stretto di un allineamento che committa
 * ogni copia. `null` quando non c'e' niente da fare.
 */
export type CopyStripAction = 'resolve' | 'align' | null;

export function copyStripAction(input: {
	conflicts: number;
	pending: readonly string[];
	otherCopiesDirty: boolean;
}): CopyStripAction {
	if (input.conflicts === 0 && input.pending.length === 0 && !input.otherCopiesDirty) return null;
	const narrow = input.conflicts === 1 && input.pending.length === 0 && !input.otherCopiesDirty;
	return narrow ? 'resolve' : 'align';
}

export class CopyAlign {
	running = $state(false);
	phase = $state<AlignPhase>('idle');
	waiting = $state<string[]>([]);
	error = $state<string | null>(null);
	/** Progetto del giro in corso: la striscia di un'altra tessera non lo mostra. */
	projectId = $state<string | null>(null);
	private readonly deps: AlignDeps;

	constructor(deps: AlignDeps) {
		this.deps = deps;
	}

	/** Toglie lo stato dell'ultimo giro: la striscia torna pulita. */
	reset(): void {
		if (this.running) return;
		this.phase = 'idle';
		this.waiting = [];
		this.error = null;
		this.projectId = null;
	}

	/** Un giro completo. Un secondo clic durante il giro non ne avvia un altro. */
	async allinea(project: Project): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.error = null;
		this.waiting = [];
		this.projectId = project.id;
		try {
			const copies = (await this.deps.copies(project)).filter((copy) => Boolean(copy.path));
			this.phase = 'committing';
			this.waiting = await this.commitPendingCopies(copies);

			this.phase = 'syncing';
			const reports = await this.deps.sync(project);
			const conflicts = conflictsFrom(reports);
			if (conflicts.length > 0) {
				this.phase = 'agent';
				await this.deps.startAgent(project, conflicts);
			}
			this.phase = 'done';
		} catch (error) {
			// La frase e' quella della superficie d'errore (C5): un rifiuto di
			// instradamento nomina la macchina, non l'id ne' il comando.
			this.error = this.deps.errorText?.(error) ?? (error instanceof Error ? error.message : String(error));
			this.phase = 'error';
			this.deps.log('warn', `allineamento non riuscito: ${this.error}`);
		} finally {
			this.running = false;
		}
	}

	/**
	 * Committa le copie con qualcosa in sospeso, riprovando quelle occupate.
	 * Restituisce i nomi delle macchine che restano in attesa: una copia con
	 * un agente al lavoro non si forza, si nomina.
	 */
	private async commitPendingCopies(copies: readonly AlignCopy[]): Promise<string[]> {
		const pending = new Map<string, number>();
		for (const copy of copies) {
			if (!copy.online) continue;
			pending.set(copy.path, await this.pendingFiles(copy));
		}
		// Solo le copie in linea con qualcosa in sospeso: le spente restano
		// fuori e chi le nomina e' il riepilogo in fondo.
		const remaining = new Set(
			copies.filter((copy) => copy.online && (pending.get(copy.path) ?? 0) > 0).map((copy) => copy.path)
		);
		for (let attempt = 0; attempt < BUSY_ATTEMPTS && remaining.size > 0; attempt++) {
			if (attempt > 0) {
				// L'attesa e' breve e ha un tetto (BUSY_ATTEMPTS): le copie ancora
				// occupate alla fine si nominano e il giro va avanti lo stesso.
				await this.deps.sleep(BUSY_WAIT_MS);
			}
			for (const copy of copies) {
				if (!remaining.has(copy.path)) continue;
				const message = m.copies_align_commit_message({ machine: await this.deps.machineName(copy.machine) });
				try {
					const result = await this.deps.commitPending(copy, message);
					// Occupata: un agente sta lavorando li', si riprova fra poco.
					if (result.skipped === 'busy') continue;
					remaining.delete(copy.path);
					if (result.commit) {
						this.deps.log('info', `allineamento: commit ${result.commit.slice(0, 8)} sulla copia di ${copy.name}`);
					}
				} catch (error) {
					// Un errore su una copia non ferma le altre: il giro di
					// sincronizzazione dira' se quella copia blocca qualcosa.
					remaining.delete(copy.path);
					this.deps.log('warn', `allineamento: commit non riuscito sulla copia di ${copy.name}: ${String(error)}`);
				}
			}
		}
		// Copie spente e copie rimaste occupate: nominate, mai toccate.
		const waiting = copies
			.filter((copy) => (!copy.online && !copy.local) || remaining.has(copy.path))
			.map((copy) => copy.name);
		return [...new Set(waiting)];
	}

	private async pendingFiles(copy: AlignCopy): Promise<number> {
		try {
			return await this.deps.pendingFiles(copy);
		} catch (error) {
			// Uno stato illeggibile non deve fermare il giro ne' far credere
			// che la copia sia pulita: si prova a committare comunque.
			this.deps.log('warn', `allineamento: stato di ${copy.name} non letto: ${String(error)}`);
			return 1;
		}
	}
}
