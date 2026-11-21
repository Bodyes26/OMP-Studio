import { invoke, isTauri, listen, LOCAL_MACHINE, type MachineId } from './ipc.ts';
import { linkStore, type LinkedMachine } from './link.svelte.ts';
import { remoteJobs } from './remoteJobs.svelte.ts';
import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
import { getDirtyEditorPaths } from '#lib/editor/editorActivity.svelte.ts';
import {
	studioUpdaterStore,
	type StudioReleaseAsset,
	type StudioUpdateInfo
} from '#lib/stores/studioUpdater.svelte.ts';
import { channelOf, waitReasons, type WaitReason } from './peerUpdateRules.ts';

export { channelOf, needsUpdate, waitReasons, type WaitReason } from './peerUpdateRules.ts';

/**
 * Aggiornare Studio su un'altra macchina con un clic (R-MI-38).
 *
 * Chi chiede controlla gli aggiornamenti *sull'altra macchina* (il controllo
 * gira li': canale, asset e checksum sono i suoi), conferma la versione e la
 * avvia con `studio_update_remote_start`. L'altra macchina scarica subito,
 * aspetta di essere libera e installa; lo stato si legge con
 * `studio_update_remote_status` per mostrarlo sulla tessera.
 */

export interface RemoteUpdateStatus {
	version: string;
	requestedBy: string;
	phase: 'starting' | 'downloading' | 'waiting' | 'installing' | 'failed';
	waitingFor: WaitReason[];
	error: string | null;
}

export interface UpdateProposal {
	machine: LinkedMachine;
	/** Versione di chi chiede: quella a cui si vorrebbe portare l'altra. */
	own: string;
	info: StudioUpdateInfo;
}

async function currentWaitReasons(): Promise<WaitReason[]> {
	const local = sessionRegistry.getAllSessions().filter((session) => !session.machineId || session.machineId === LOCAL_MACHINE);
	const jobs = await invoke<{ totalJobs: number }>('desktop_presence_get_active_jobs', {}, { machine: LOCAL_MACHINE })
		.catch(() => ({ totalJobs: 0 }));
	return waitReasons({
		workingAgents: local.filter((session) => session.agentState === 'working' || session.isStreaming).length,
		pendingQuestions: local.filter((session) => session.pendingUi).length,
		activeJobs: jobs.totalJobs,
		incomingJobs: remoteJobs.incomingActive.length,
		unsavedProjects: getDirtyEditorPaths().length
	});
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class PeerUpdateStore {
	/** Stato dell'aggiornamento in corso su ogni altra macchina. */
	statuses = $state<Record<MachineId, RemoteUpdateStatus>>({});
	/** Proposta da confermare (versione diversa da quella di chi chiede compresa). */
	proposal = $state<UpdateProposal | null>(null);
	error = $state<string | null>(null);
	/** «Aggiorna entrambe» a fine Nightly distribuita (R-MI-37). */
	bothProposal = $state<{ version: string; machineIds: MachineId[] } | null>(null);
	private polling = new Set<MachineId>();
	private started = false;

	/** Ascolta le richieste che arrivano da fuori e quelle dello script Nightly. */
	start(): void {
		if (this.started || !isTauri()) return;
		this.started = true;
		void listen<{ version: string; asset: StudioReleaseAsset; requestedBy: string }>('studio-update:remote-install', (event) => {
			void installWhenIdle(event.payload.asset, report);
		});
		void listen<{ version: string; machines: MachineId[] }>('link:update-both', (event) => {
			this.bothProposal = { version: event.payload.version, machineIds: event.payload.machines };
		});
	}

	statusFor(machineId: MachineId): RemoteUpdateStatus | null {
		return this.statuses[machineId] ?? null;
	}

	/** Controlla sull'altra macchina e apre la conferma con la versione. */
	async request(machineId: MachineId): Promise<void> {
		this.error = null;
		const machine = linkStore.machineFor(machineId);
		const own = studioUpdaterStore.currentVersion;
		if (!machine || !own) return;
		try {
			const info = await invoke<StudioUpdateInfo>('check_studio_update', { channel: channelOf(own), preferredVersion: own }, { machine: machineId });
			this.proposal = { machine, own, info };
		} catch (reason) {
			this.error = reason instanceof Error ? reason.message : String(reason);
		}
	}

	async confirm(): Promise<void> {
		const proposal = this.proposal;
		this.proposal = null;
		if (!proposal?.info.asset) return;
		await this.startOn(proposal.machine.id, proposal.info);
	}

	private async startOn(machineId: MachineId, info: StudioUpdateInfo): Promise<void> {
		try {
			await invoke('studio_update_remote_start', { version: info.latest_version }, { machine: machineId });
			this.follow(machineId, info.latest_version);
		} catch (reason) {
			this.error = reason instanceof Error ? reason.message : String(reason);
		}
	}

	/**
	 * Entrambe alla versione appena pubblicata: l'altra macchina con il suo
	 * controllo, questa con il proprio; ognuna installa quando e' libera.
	 */
	async updateBoth(): Promise<void> {
		const proposal = this.bothProposal;
		this.bothProposal = null;
		if (!proposal) return;
		const channel = channelOf(proposal.version);
		for (const machineId of proposal.machineIds) {
			const info = await invoke<StudioUpdateInfo>('check_studio_update', { channel, preferredVersion: proposal.version }, { machine: machineId }).catch(() => null);
			if (info?.has_update && info.asset && info.latest_version === proposal.version) await this.startOn(machineId, info);
		}
		const local = await invoke<StudioUpdateInfo>('check_studio_update', { channel, preferredVersion: proposal.version }, { machine: LOCAL_MACHINE }).catch(() => null);
		if (local?.has_update && local.asset && local.latest_version === proposal.version) void installWhenIdle(local.asset, () => {});
	}

	/** Segue lo stato finche' l'altra macchina non si riavvia con la nuova versione. */
	private follow(machineId: MachineId, version: string): void {
		if (this.polling.has(machineId)) return;
		this.polling.add(machineId);
		void (async () => {
			try {
				for (;;) {
					const machine = linkStore.machineFor(machineId);
					if (!machine || (machine.online && machine.version === version)) break;
					if (machine?.online) {
						const status = await invoke<RemoteUpdateStatus | null>('studio_update_remote_status', {}, { machine: machineId }).catch(() => null);
						if (status) this.statuses = { ...this.statuses, [machineId]: status };
						if (status?.phase === 'failed') break;
					}
					await sleep(3000);
				}
			} finally {
				this.polling.delete(machineId);
				if (this.statuses[machineId]?.phase !== 'failed') {
					const { [machineId]: _done, ...rest } = this.statuses;
					this.statuses = rest;
				}
			}
		})();
	}
}

function report(phase: RemoteUpdateStatus['phase'], waitingFor: WaitReason[] = [], error: string | null = null): void {
	void invoke('studio_update_remote_report', { phase, waitingFor, error }, { machine: LOCAL_MACHINE }).catch(() => {});
}

/**
 * Scarica subito e installa appena la macchina e' libera (R-MI-38). Passa dal
 * negozio dell'updater, cosi' la finestra di questa macchina mostra
 * l'avanzamento come per un aggiornamento chiesto da qui.
 */
async function installWhenIdle(asset: StudioReleaseAsset, onPhase: typeof report): Promise<void> {
	onPhase('downloading');
	try {
		// In ascolto prima di avviare: l'esito non deve arrivare prima del listener.
		let complete!: () => void;
		let fail!: (reason: Error) => void;
		const downloaded = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
		void downloaded.catch(() => {});
		const off = await listen<{ status: string; error?: string | null }>('studio_update_progress', (event) => {
			const { status, error } = event.payload;
			if (status === 'finished') complete();
			else if (status === 'error' || status === 'cancelled') fail(new Error(error ?? status));
		});
		try {
			await invoke('start_studio_update_download', {
				downloadUrl: asset.download_url,
				filename: asset.name,
				expectedSha256: asset.sha256
			}, { machine: LOCAL_MACHINE });
			await downloaded;
		} finally { off(); }
		let previous = '';
		for (;;) {
			const reasons = await currentWaitReasons();
			if (reasons.length === 0) break;
			const key = reasons.join(',');
			if (key !== previous) { onPhase('waiting', reasons); previous = key; }
			await sleep(5000);
		}
		onPhase('installing');
		await studioUpdaterStore.installAndRestart();
		if (studioUpdaterStore.errorMessage) onPhase('failed', [], studioUpdaterStore.errorMessage);
	} catch (reason) {
		onPhase('failed', [], reason instanceof Error ? reason.message : String(reason));
	}
}


export const peerUpdate = new PeerUpdateStore();
