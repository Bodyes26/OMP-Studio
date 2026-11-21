import { invoke, isTauri, listen, LOCAL_MACHINE } from './ipc.ts';

/** Stato di un job di «Esegui su macchina» (R-MI-36), come `link/exec.rs`. */
export type RemoteJobState =
	| { state: 'queued' }
	| { state: 'preparing' }
	| { state: 'running' }
	| { state: 'exited'; code: number }
	| { state: 'failed'; error: string }
	| { state: 'cancelled' };

export type RemoteJob = RemoteJobState & {
	id: string;
	/** `outgoing`: chiesto da qui; `incoming`: un'altra macchina lo fa girare qui. */
	direction: 'outgoing' | 'incoming';
	machineId: string;
	machineName: string;
	project: string;
	command: string;
	commit: string;
	startedAt: number;
	endedAt: number | null;
};

export function jobActive(job: RemoteJobState): boolean {
	return job.state === 'queued' || job.state === 'preparing' || job.state === 'running';
}

/**
 * Elenco dei job delle due direzioni. Rust avvisa con `link:exec` a ogni
 * cambio di stato; l'elenco si rilegge allora, non a intervalli.
 */
class RemoteJobsStore {
	jobs = $state<RemoteJob[]>([]);
	private started = false;

	/** Job che altre macchine stanno facendo girare qui: vanno sempre in vista. */
	readonly incomingActive = $derived(this.jobs.filter((job) => job.direction === 'incoming' && jobActive(job)));

	start(): void {
		if (this.started || !isTauri()) return;
		this.started = true;
		void listen('link:exec', () => void this.refresh());
		void this.refresh();
	}

	async refresh(): Promise<void> {
		try {
			this.jobs = await invoke<RemoteJob[]>('exec_jobs', {}, { machine: LOCAL_MACHINE });
		} catch {
			// Collegamento spento: nessun job.
		}
	}

	forMachine(machineId: string): RemoteJob[] {
		return this.jobs.filter((job) => job.machineId === machineId);
	}

	async log(id: string, offset: number): Promise<{ logStart: number; log: string; next: number }> {
		return invoke('exec_job_log', { id, offset }, { machine: LOCAL_MACHINE });
	}

	async cancel(id: string): Promise<void> {
		await invoke('exec_job_cancel', { id }, { machine: LOCAL_MACHINE });
	}
}

export const remoteJobs = new RemoteJobsStore();
