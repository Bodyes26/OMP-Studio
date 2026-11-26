import { invoke, isTauri, listen, LOCAL_MACHINE, type MachineId } from './ipc.ts';
import { linkStore, type LinkedMachine } from './link.svelte.ts';
import { remoteJobs } from './remoteJobs.svelte.ts';
import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
import { getDirtyEditorPaths } from '#lib/editor/editorActivity.svelte.ts';
import { m } from '#lib/paraglide/messages.js';
import {
	studioUpdaterStore,
	type StudioReleaseAsset,
	type StudioUpdateInfo
} from '#lib/stores/studioUpdater.svelte.ts';
import {
	autoUpdateKey,
	channelOf,
	compareStudioVersions,
	shouldRequestAutoUpdate,
	updateFailureObsolete,
	waitReasons,
	type WaitReason
} from './peerUpdateRules.ts';

export {
	channelOf,
	compareStudioVersions,
	machineUpdateState,
	needsUpdate,
	peerBehind,
	parseStudioVersion,
	shouldRequestAutoUpdate,
	waitReasons,
	type MachineUpdateState,
	type WaitReason
} from './peerUpdateRules.ts';

/**
 * Aggiornare Studio su un'altra macchina (R-MI-38, R-MI-64).
 *
 * Chi chiede controlla gli aggiornamenti *sull'altra macchina* (il controllo
 * gira li': canale, asset e checksum sono i suoi), conferma la versione e la
 * avvia con `studio_update_remote_start`. L'altra macchina scarica subito,
 * aspetta di essere libera e installa; lo stato si legge con
 * `studio_update_remote_status` per mostrarlo sulla tessera.
 *
 * Da R-MI-64 una macchina con una versione piu' vecchia viene aggiornata da
 * sola, una volta per (macchina, versione di questa): un rifiuto o un errore
 * non si ripetono finche' l'app resta aperta.
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

export async function currentWaitReasons(): Promise<WaitReason[]> {
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
/** Oltre questo tempo si smette di seguire: la riga non resta «in corso» per sempre. */
const FOLLOW_LIMIT_MS = 30 * 60_000;

class PeerUpdateStore {
	/** Stato dell'aggiornamento in corso su ogni altra macchina. */
	statuses = $state<Record<MachineId, RemoteUpdateStatus>>({});
	/** Proposta da confermare (versione diversa da quella di chi chiede compresa). */
	proposal = $state<UpdateProposal | null>(null);
	error = $state<string | null>(null);
	/** «Aggiorna entrambe» a fine Nightly distribuita (R-MI-37). */
	bothProposal = $state<{ version: string; machineIds: MachineId[] } | null>(null);
	private polling = new Set<MachineId>();
	/** Gia' chieste da sole, per (macchina, versione di questa) (R-MI-64). */
	private asked = new Set<string>();
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
		this.followOwnVersion();
	}

	/**
	 * Chiede da sola l'aggiornamento delle macchine piu' vecchie (R-MI-64).
	 * Dipende dalla versione di questa macchina e dallo stato dei peer, non dai
	 * singoli eventi: anche una macchina che torna in linea dopo un riavvio
	 * riceve la richiesta senza che nessuno apra il modale.
	 */
	private followOwnVersion(): void {
		$effect.root(() => {
			$effect(() => {
				const own = studioUpdaterStore.currentVersion;
				if (!own) return;
				this.dropObsoleteFailures();
				for (const peer of linkStore.status.peers) {
					if (!shouldRequestAutoUpdate({
						peer: { id: peer.id, online: peer.online, version: peer.version },
						own,
						asked: this.asked,
						// Una build di sviluppo non comanda aggiornamenti.
						dev: import.meta.env?.DEV === true
					})) continue;
					this.asked.add(autoUpdateKey(peer.id, own));
					void this.autoUpdate(peer.id, own);
				}
			});
		});
	}

	/**
	 * Porta l'altra macchina alla versione di questa senza chiedere conferma:
	 * la riga nel modale di aggiornamento dice a che punto e'. Un errore non si
	 * ripete in questa esecuzione (R-MI-64): la prossima apertura di Studio ci
	 * riprova.
	 */
	private async autoUpdate(machineId: MachineId, own: string): Promise<void> {
		try {
			const info = await invoke<StudioUpdateInfo>('check_studio_update',
				{ channel: channelOf(own), preferredVersion: own }, { machine: machineId });
			if (info.has_update && info.asset && info.latest_version === own) await this.startOn(machineId, info);
		} catch {
			// Macchina che si e' spenta fra il controllo e l'avvio: resta com'e'.
		}
	}

	/**
	 * Un errore resta nell'elenco finche' qualcuno non lo sostituisce: se nel
	 * frattempo l'altra macchina e' arrivata alla versione chiesta (aggiornata
	 * da sola o dall'altro lato), la riga direbbe il falso e non si chiuderebbe
	 * mai. Si toglie quando la versione letta ha raggiunto quella dell'errore.
	 */
	private dropObsoleteFailures(): void {
		let next: Record<MachineId, RemoteUpdateStatus> | null = null;
		for (const [machineId, status] of Object.entries(this.statuses)) {
			if (status.phase !== 'failed') continue;
			const peer = linkStore.machineFor(machineId);
			if (!updateFailureObsolete(status.version, peer?.version, compareStudioVersions)) continue;
			next ??= { ...this.statuses };
			delete next[machineId];
		}
		if (next) this.statuses = next;
	}

	statusFor(machineId: MachineId): RemoteUpdateStatus | null {
		return this.statuses[machineId] ?? null;
	}

	/** Controlla sull'altra macchina e apre la conferma con la versione. */
	async request(machineId: MachineId, targetVersion?: string): Promise<void> {
		this.error = null;
		const machine = linkStore.machineFor(machineId);
		const own = studioUpdaterStore.currentVersion;
		if (!machine || !own) return;
		try {
			const preferredVersion = targetVersion ?? own;
			const info = await invoke<StudioUpdateInfo>('check_studio_update', { channel: channelOf(preferredVersion), preferredVersion }, { machine: machineId });
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
			this.statuses = { ...this.statuses, [machineId]: {
				version: info.latest_version, requestedBy: linkStore.status.machineId,
				phase: 'starting', waitingFor: [], error: null
			} };
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

	/**
	 * Segue lo stato finche' l'altra macchina non si riavvia con la nuova
	 * versione, con un tetto: senza, una macchina che torna in linea senza
	 * essersi aggiornata lasciava la riga «in corso» per sempre (nessuno la
	 * sostituiva e il ciclo non usciva mai).
	 */
	private follow(machineId: MachineId, version: string): void {
		if (this.polling.has(machineId)) return;
		this.polling.add(machineId);
		const startedAt = Date.now();
		void (async () => {
			try {
				while (Date.now() - startedAt < FOLLOW_LIMIT_MS) {
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
 * Scarica subito e installa appena la macchina e' libera (R-MI-38, R-MI-64).
 * Passa dal negozio dell'updater, cosi' la finestra di questa macchina mostra
 * l'avanzamento come per un aggiornamento chiesto da qui. Non chiede conferma:
 * la richiesta arriva da un'altra macchina che ha gia' deciso, e lo stato
 * (`studio_update_remote_report`) e' il riscontro che quella finestra mostra.
 */
async function installWhenIdle(asset: StudioReleaseAsset, onPhase: typeof report): Promise<void> {
	onPhase('downloading');
	// Avviso locale: chi e' davanti a questa macchina deve sapere perche' Studio
	// si riavviera' da solo appena e' libero.
	studioUpdaterStore.setBadge(m.peer_update_remote_incoming(), 'info');
	try {
		// In ascolto prima di avviare: l'esito non deve arrivare prima del listener.
		const { promise: downloaded, resolve: complete, reject: fail } = Promise.withResolvers<void>();
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
		// L'avviso «installa e riavvia appena libera» vale finche' l'installazione
		// non ha un esito: se Studio resta aperto (pacchetto .deb, errore) non e'
		// piu' vero e resterebbe nella barra per sempre, perche' nessuno lo
		// sostituisce. Se il riavvio parte davvero l'avviso sparisce con l'app.
		studioUpdaterStore.setBadge(null);
		if (studioUpdaterStore.errorMessage) onPhase('failed', [], studioUpdaterStore.errorMessage);
	} catch (reason) {
		studioUpdaterStore.setBadge(null);
		onPhase('failed', [], reason instanceof Error ? reason.message : String(reason));
	}
}


export const peerUpdate = new PeerUpdateStore();
