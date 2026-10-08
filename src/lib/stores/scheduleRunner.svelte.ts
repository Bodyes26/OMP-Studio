/**
 * Avvio dei task programmati (Gate R3X-coda-reset), solo nella finestra
 * principale.
 *
 * Vive fuori da `+page.svelte` per non intrecciarsi con l'auto-avvio: la
 * pagina chiede qui il candidato programmato e lo passa all'arbitro
 * dell'auto-avvio, cosi' un task programmato entra nello **stesso** percorso
 * (Gate R12, slot unico di R27, stabilita' e lock) senza duplicarlo. Le
 * regole stanno nei moduli puri `scheduleQueue` e `scheduleTarget`.
 *
 * Differenze dall'auto-avvio, volute:
 * - parte anche con l'auto-avvio del progetto spento: la programmazione e'
 *   gia' il gesto esplicito;
 * - prima di avviare un task «al reset» chiede a omp uno snapshot forzato,
 *   per non partire su un dato di usage vecchio;
 * - un reset passato a Studio chiuso non fa partire nulla: il task va nel
 *   banner «Avvia ora / Lasciali in coda».
 */

import { m } from '$lib/paraglide/messages.js';
import { MAIN_LANE_ID } from '$lib/types/lanes';
import type { Project } from './projects.svelte';
import { quotaStore } from './quota.svelte';
import { taskStore, type StudioTask, type TaskSchedule } from './tasks.svelte';
import { scheduleStore } from './schedule.svelte';
import { detectMissedSchedules, nextDueScheduledTask } from '$lib/quota/scheduleQueue';
import { canConfirmNow } from '$lib/quota/scheduleClock';
import type { AgentSession } from '$lib/agent/session.svelte';

export interface ScheduledCandidate {
	taskId: string;
	/** Il task va in una corsia worktree nuova (Principale occupata, R27). */
	newLane: boolean;
}

export interface ScheduleRouteDeps {
	/** Routing dell'auto-avvio (`decideAutoDispatch`) per il progetto. */
	route: (project: Project) => 'wait' | 'main' | 'new-lane';
	/** `automationGate(...).autoDispatchReady` della corsia. */
	laneReady: (projectId: string, laneId: string) => boolean;
}

/**
 * Regia dei task programmati. L'arbitro dell'auto-avvio
 * (`autoDispatchArbiter.ts`) resta l'unico che spedisce: qui si decide solo
 * *quale* task programmato e' candidato (`candidateFor`) e si conferma il
 * reset su dato fresco appena prima della spedizione (`verify`). Il resto
 * (stabilita', ri-verifica della sessione, lock per progetto, pausa dopo un
 * fallimento) e' lo stesso percorso dell'auto-avvio.
 */
class ScheduleRunner {
	/** Task gia' giudicati per il banner in questo avvio di Studio. */
	private readonly seen = new Set<string>();
	/** Riprese fallite: non si ritentano da sole, l'errore resta a vista. */
	private readonly failed = new Set<string>();
	private readonly lastConfirm = new Map<string, number>();
	private readonly completing = new Set<string>();
	/** Cambia quando `seen` cresce: rilancia il calcolo dei candidati. */
	private judged = $state(0);

	private stateOf = (task: StudioTask) =>
		// «Al reset» scritto dal tool o dalla TUI arriva senza provider: finche'
		// non e' completato non si giudica.
		task.schedule?.kind === 'reset' && !task.schedule.provider
			? ('unknown' as const)
			: scheduleStore.targetFor(task).state;

	/**
	 * Giudizio dei reset passati a Studio chiuso e completamento delle
	 * programmazioni senza provider. Solo effetti collaterali, fuori dal
	 * calcolo dei candidati: le scritture vanno in microtask perche' la coda
	 * e' proprio cio' che l'effetto legge.
	 */
	start(projects: () => Project[]): () => void {
		scheduleStore.init();
		return $effect.root(() => {
			$effect(() => {
				void scheduleStore.now;
				const marks: string[] = [];
				const completions: Array<{ id: string; schedule: TaskSchedule }> = [];
				const before = this.seen.size;
				for (const project of projects()) {
					if (!project.canonicalProjectPath) continue;
					const tasks = taskStore.tasksFor(project.canonicalProjectPath);
					if (!tasks.some((task) => task.schedule)) continue;
					for (const task of tasks) {
						const schedule = task.schedule;
						if (task.status !== 'queued' || schedule?.kind !== 'reset' || schedule.provider) continue;
						if (this.completing.has(task.id)) continue;
						const built = scheduleStore.buildReset(task, schedule.origin);
						if (built) {
							completions.push({
								id: task.id,
								schedule: { ...built, setAt: schedule.setAt, missed: schedule.missed }
							});
						}
					}
					marks.push(...detectMissedSchedules(tasks, this.stateOf, this.seen, scheduleStore.appStartedAt));
				}
				const grew = this.seen.size !== before;
				if (marks.length === 0 && completions.length === 0 && !grew) return;
				queueMicrotask(() => {
					if (marks.length > 0) taskStore.setScheduleMissed(marks, true);
					for (const completion of completions) {
						this.completing.add(completion.id);
						taskStore.setSchedule(completion.id, completion.schedule);
						this.completing.delete(completion.id);
					}
					if (grew) this.judged += 1;
				});
			});
		});
	}

	/**
	 * Il task programmato che puo' partire adesso nel progetto, o `null`.
	 * Parte anche con l'auto-avvio spento. Una ripresa torna nella sua
	 * corsia, mai in una nuova; gli altri seguono il routing dell'auto-avvio.
	 */
	candidateFor(project: Project, deps: ScheduleRouteDeps): ScheduledCandidate | null {
		if (!project.canonicalProjectPath) return null;
		void this.judged;
		const tasks = taskStore.tasksFor(project.canonicalProjectPath);
		if (!tasks.some((task) => task.schedule)) return null;
		// Solo task gia' giudicati per il banner: un reset perso non deve
		// partire nel giro prima di essere marcato.
		const judgedTasks = tasks.filter((task) => this.seen.has(task.id));
		const next = nextDueScheduledTask(judgedTasks, this.stateOf, this.failed);
		if (!next) return null;
		if (next.resume) {
			const laneId = next.resume.laneId ?? MAIN_LANE_ID;
			return deps.laneReady(project.id, laneId) ? { taskId: next.id, newLane: false } : null;
		}
		const route = deps.route(project);
		if (route === 'wait') return null;
		if (route === 'main' && !deps.laneReady(project.id, MAIN_LANE_ID)) return null;
		return { taskId: next.id, newLane: route === 'new-lane' };
	}

	isScheduled(taskId: string): boolean {
		return Boolean(taskStore.taskById(taskId)?.schedule);
	}

	/** Corsia di una voce di ripresa (`undefined` per i task normali). */
	resumeLaneOf(taskId: string): string | undefined {
		const resume = taskStore.taskById(taskId)?.resume;
		return resume ? (resume.laneId ?? MAIN_LANE_ID) : undefined;
	}

	/**
	 * Conferma appena prima della spedizione. Per «al reset» chiede a omp uno
	 * snapshot forzato: il verdetto puo' venire da un dato di 90 s fa. Una
	 * conferma al minuto per task, perche' un reset non ancora visto dal
	 * provider non diventi un `omp usage` a ogni tentativo.
	 */
	async verify(taskId: string): Promise<boolean> {
		const task = taskStore.taskById(taskId);
		if (!task?.schedule) return true;
		if (task.status !== 'queued' || task.schedule.missed) return false;
		if (task.schedule.kind !== 'reset') return this.stateOf(task) === 'due';
		const now = Date.now();
		if (!canConfirmNow(this.lastConfirm.get(taskId), now)) return false;
		this.lastConfirm.set(taskId, now);
		await quotaStore.refresh(true);
		const current = taskStore.taskById(taskId);
		if (!current?.schedule || current.status !== 'queued' || current.schedule.missed) return false;
		return scheduleStore.targetFor(current, Date.now()).state === 'due';
	}

	markFailed(taskId: string): void {
		this.failed.add(taskId);
	}
}

export const scheduleRunner = new ScheduleRunner();

/**
 * «Aspetta il prossimo reset» dal blocco di quota: mette in testa alla coda
 * una voce di ripresa (`/retry` nella stessa sessione) programmata al reset
 * del provider che ha fermato la sessione, poi archivia l'avviso.
 * Restituisce l'orario mostrato nella notifica, o `null` se non si e' potuto.
 */
export function parkSessionUntilReset(
	session: AgentSession,
	queuePath: string,
	laneId: string
): StudioTask | null {
	const sessionId = session.sessionId;
	const blocked = session.blockedQuotaState;
	if (!sessionId) return null;
	const selector =
		blocked?.failedSelector ||
		(session.model?.provider && session.model?.id ? `${session.model.provider}/${session.model.id}` : '');
	const options = selector ? { modelSelector: selector } : undefined;
	let schedule = scheduleStore.buildReset({ options }, 'recovery');
	if (!schedule) return null;
	// Senza dati di usage vale l'orario che omp ha dato alla sessione bloccata.
	const resetsAtSec = session.usageLimit?.resetsAtSec;
	if (schedule.notBefore === undefined && typeof resetsAtSec === 'number' && resetsAtSec > 0) {
		schedule = { ...schedule, notBefore: resetsAtSec * 1000 };
	}
	const origin = taskStore.originsFor(queuePath).find((entry) => entry.sessionId === sessionId);
	const name = session.sessionName?.trim() || origin?.title?.trim() || sessionId.slice(0, 8);
	const task = taskStore.createResumeTask(
		queuePath,
		{ sessionId, laneId: laneId === MAIN_LANE_ID ? undefined : laneId },
		schedule,
		m.schedule_resume_title({ title: name }),
		options
	);
	session.dismissBlockedQuota();
	const label = scheduleStore.labelFor(task);
	session.pushNotice('info', m.schedule_parked_notice({ when: label?.when || label?.text || '' }));
	return task;
}
