import { Channel } from '@tauri-apps/api/core';
import { invoke, isTauri, listen, updateLinkedMachines, LOCAL_MACHINE, type UnlistenFn } from './ipc.ts';
import type { RemoteCommand } from '$remote-protocol';
import { expandReducedSnapshot, isReducedHostSnapshot, type DesktopHostSnapshot } from './host.ts';
import { projectStore } from '#lib/stores/projects.svelte.ts';
import {
	NO_ACTIVITY,
	laneBusyRemotely as laneBusyIn,
	laneWorkingRemotely as laneWorkingIn,
	mergeActivity,
	type LaneActivitySnapshot
} from './laneActivity.ts';

export interface MachinePermissions {
	agents: boolean;
	files: boolean;
	terminal: boolean;
}
export interface LinkedMachine {
	id: string;
	name: string;
	permissions: MachinePermissions;
	online: boolean;
	compatible: boolean;
	version: string | null;
	route: 'direct' | 'relay' | null;
	latencyMs: number | null;
	lastSeen: number | null;
}
export interface LinkStatus {
	enabled: boolean;
	name: string;
	machineId: string;
	platform: string;
	relayUrl: string;
	hasRelayToken: boolean;
	relayReachable: boolean | null;
	peers: LinkedMachine[];
	/** La chiave della macchina non c'è più nel portachiavi (R-MI-43). */
	keyMissing: boolean;
}

/**
 * Corsie che questa macchina sta facendo lavorare per un'altra (R-MI-18).
 * Vivono nel backend, perché la sessione la apre il peer: senza questo
 * riepilogo la finestra locale le vedrebbe ferme e la coda potrebbe avviare
 * un secondo lavoro sopra il primo. Le regole stanno in `laneActivity.ts`.
 */
export type { LaneActivity, LaneActivitySnapshot } from './laneActivity.ts';

/** Macchina vista in rete locale mentre «Aggiungi dispositivo» è aperto (R-MI-54). */
export interface DiscoveredMachine {
	id: string;
	name: string;
	platform: string;
}

/** Richiesta di abbinamento in rete locale, da confermare con le 6 cifre (R-MI-54). */
export interface PairRequest {
	requestId: string;
	peerId: string;
	name: string;
	sas: string;
	direction: 'incoming' | 'outgoing';
}

/** Codice di abbinamento (R-MI-53, R-MI-55). `shortCode` null senza Studio Remote. */
export interface PairingCode {
	code: string;
	shortCode: string | null;
	expiresAt: number;
}

/** Risposta di `devices_set_server` (R-MI-56): il relay iroh può mancare. */
export interface DevicesServerInfo {
	remoteRelay: string;
	irohRelay: string | null;
}

interface PairResult {
	requestId: string;
	ok: boolean;
	error?: string;
}

class LinkStore {
	status = $state<LinkStatus>({ enabled: false, name: '', machineId: '', platform: '', relayUrl: '', hasRelayToken: false, relayReachable: null, peers: [], keyMissing: false });
	replacements = $state<LinkedMachine[]>([]);
	hosts = $state<Record<string, DesktopHostSnapshot>>({});
	/** Corsie occupate da sessioni remote; la revisione scarta i riepiloghi vecchi. */
	activity = $state<LaneActivitySnapshot>({ revision: NO_ACTIVITY.revision, lanes: [] });
	loading = $state(false);
	busy = $state(false);
	error = $state<string | null>(null);
	/** Macchine in rete locale: piene solo fra startDiscovery e stopDiscovery (R-MI-54). */
	discovery = $state<DiscoveredMachine[]>([]);
	/** Richieste di abbinamento da confermare con le 6 cifre (R-MI-54). */
	pairRequests = $state<PairRequest[]>([]);
	private initializing: Promise<void> | null = null;
	private unlisten: UnlistenFn | null = null;
	private unlistenHost: UnlistenFn | null = null;
	private unlistenActivity: UnlistenFn | null = null;
	private unlistenDiscovered: UnlistenFn | null = null;
	private unlistenPairRequest: UnlistenFn | null = null;
	private unlistenPairResult: UnlistenFn | null = null;

	private apply(status: LinkStatus): void {
		// Solo nuovi id dopo lo stato iniziale: funziona anche per chi genera
		// il codice, che apprende l'abbinamento dall'evento e non da link_pair.
		if (this.status.machineId) {
			const previous = new Set(this.status.peers.map((peer) => peer.id));
			for (const fresh of status.peers) {
				if (previous.has(fresh.id)) continue;
				for (const old of status.peers) {
					if (old.id !== fresh.id && previous.has(old.id) && !old.online && old.name === fresh.name &&
						!this.replacements.some((candidate) => candidate.id === old.id)) {
						this.replacements.push(old);
					}
				}
			}
		}
		this.status = status;
		updateLinkedMachines(status.peers);
		const known = new Set(status.peers.map((peer) => peer.id));
		for (const machine of Object.keys(this.hosts)) {
			if (known.has(machine)) continue;
			delete this.hosts[machine];
			projectStore.removeRemoteMachine(machine);
		}
		for (const peer of status.peers) {
			if (!peer.online) projectStore.markRemoteMachineOffline(peer.id);
		}
	}

	offlineReason(machineId: string): 'relay' | 'machine' | null {
		const peer = this.machineFor(machineId);
		return !peer || peer.online ? null : this.status.relayReachable === false ? 'relay' : 'machine';
	}

	dismissReplacement(): void {
		this.replacements.shift();
	}

	/**
	 * Un riepilogo arrivato in ritardo non deve riportare indietro la vista:
	 * vale solo se è più recente. Serve perché evento e lettura iniziale
	 * possono incrociarsi.
	 */
	private applyActivity(snapshot: LaneActivitySnapshot): void {
		this.activity = mergeActivity(this.activity, snapshot);
	}

	/** La corsia sta lavorando per un'altra macchina? */
	laneWorkingRemotely(projectId: string, laneId: string): boolean {
		return laneWorkingIn(this.activity, projectId, laneId);
	}

	/** La corsia è occupata da una sessione remota, in qualunque stato? */
	laneBusyRemotely(projectId: string, laneId: string): boolean {
		return laneBusyIn(this.activity, projectId, laneId);
	}

	private applyHost(machine: string, received: unknown): void {
		let state: DesktopHostSnapshot;
		if (isReducedHostSnapshot(received)) {
			// Versione incompatibile (R-MI-10): arriva solo l'elenco dei progetti.
			// L'ultimo snapshot completo, se c'e', descrive meglio le tessere: lo
			// si tiene; altrimenti le tessere si costruiscono dall'elenco, invece
			// di sparire dalla barra (M1).
			const previous = this.hosts[machine];
			if (previous && !previous.reduced) return;
			state = expandReducedSnapshot(received);
		} else {
			state = received as DesktopHostSnapshot;
		}
		if (!state || typeof state !== 'object' || state.version !== 1 || !Array.isArray(state.projects) || !Array.isArray(state.lanes) ||
			!Array.isArray(state.tasks) || typeof state.projectRoot !== 'string') {
			this.error = `Invalid host snapshot from ${machine}`;
			return;
		}
		this.hosts[machine] = state;
		projectStore.syncRemoteProjects(machine, this.status.peers.find((peer) => peer.id === machine)?.name ?? machine, state);
	}

	command<T>(machine: string, command: RemoteCommand): Promise<T> {
		return invoke<T>('link_host_action', { command }, { machine });
	}

	machineFor(machineId: string | undefined): LinkedMachine | undefined {
		if (!machineId || machineId === LOCAL_MACHINE) return undefined;
		return this.status.peers.find((peer) => peer.id === machineId);
	}

	initialize(): Promise<void> {
		if (!isTauri()) return Promise.resolve();
		return this.initializing ??= this.load();
	}

	private async load(): Promise<void> {
		this.loading = true;
		try {
			this.unlisten ??= await listen<LinkStatus>('link:status', (event) => this.apply(event.payload));
			const received = new Set<string>();
			this.unlistenHost ??= await listen<{ machine: string; state: DesktopHostSnapshot }>('link:host_state', (event) => {
				received.add(event.payload.machine);
				this.applyHost(event.payload.machine, event.payload.state);
			});
			this.unlistenActivity ??= await listen<LaneActivitySnapshot>('link:activity', (event) => {
				this.applyActivity(event.payload);
			});
			// Riepilogo corrente all'avvio: una sessione può essere già aperta da
			// un'altra macchina mentre questa finestra si carica.
			this.applyActivity(await invoke<LaneActivitySnapshot>('link_activity'));
			const cached = await invoke<Record<string, DesktopHostSnapshot>>('link_host_states');
			for (const [machine, state] of Object.entries(cached)) {
				if (!received.has(machine)) this.applyHost(machine, state);
			}
			await this.refresh();
		} catch (error) {
			this.error = String(error);
		} finally {
			this.loading = false;
		}
	}

	async refresh(): Promise<void> {
		this.apply(await invoke<LinkStatus>('link_status'));
		this.error = null;
	}

	private async action<T>(run: () => Promise<T>): Promise<T> {
		if (this.busy) throw new Error('An instance configuration change is already running');
		this.busy = true;
		this.error = null;
		try {
			return await run();
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
			throw error;
		} finally {
			this.busy = false;
		}
	}

	configure(config: { enabled: boolean; name: string; relayUrl: string; relayToken?: string }): Promise<void> {
		return this.action(async () => {
			this.apply(await invoke<LinkStatus>('link_configure', { ...config, relayToken: config.relayToken ?? null }));
		});
	}

	pairingCode(): Promise<PairingCode> {
		return this.action(() => invoke<PairingCode>('link_pairing_code'));
	}

	/**
	 * Incolla un codice (completo o corto). Su una macchina non configurata
	 * adotta relay e token del codice (R-MI-53); con un relay diverso rigetta
	 * `relay_mismatch:<url>` finché non si richiama con `adoptRelay`.
	 */
	pair(code: string, opts: { adoptRelay?: boolean; server?: string; onProgress?: (stage: 'server' | 'configuration' | 'peer') => void } = {}): Promise<void> {
		return this.action(async () => {
			const progress = new Channel(opts.onProgress);
			this.apply(await invoke<LinkStatus>('link_pair', { code, adoptRelay: opts.adoptRelay ?? null, server: opts.server ?? null, progress }));
		});
	}

	/** Annuncio e ascolto mDNS solo mentre «Aggiungi dispositivo» è aperto (R-MI-54). */
	async startDiscovery(): Promise<void> {
		this.unlistenDiscovered ??= await listen<DiscoveredMachine[]>('link:discovered', (event) => {
			this.discovery = event.payload;
		});
		this.unlistenPairRequest ??= await listen<PairRequest>('link:pair_request', (event) => {
			// Una richiesta per id: un doppione (evento e ritorno) non si somma.
			const fresh = event.payload;
			if (!this.pairRequests.some((request) => request.requestId === fresh.requestId)) {
				this.pairRequests = [...this.pairRequests, fresh];
			}
		});
		this.unlistenPairResult ??= await listen<PairResult>('link:pair_result', (event) => {
			// L'esito (accettato o no) chiude la conferma: l'errore, quando
			// c'è, arriva già come rigetto di `pairLan`.
			this.pairRequests = this.pairRequests.filter((request) => request.requestId !== event.payload.requestId);
		});
		await invoke('link_discovery_start');
	}

	/** Ferma annuncio e ascolto: fuori da qui la macchina non si annuncia. */
	async stopDiscovery(): Promise<void> {
		try {
			await invoke('link_discovery_stop');
		} finally {
			this.discovery = [];
			this.pairRequests = [];
		}
	}

	/**
	 * Sceglie una macchina in rete locale (R-MI-54). Si risolve solo quando
	 * l'altra macchina accetta; rifiuto o silenzio (2 min) rigettano, col
	 * messaggio che il backend ha prodotto.
	 */
	pairLan(id: string): Promise<void> {
		return this.action(async () => {
			try {
				this.apply(await invoke<LinkStatus>('link_pair_lan', { id }));
			} finally {
				// L'esito chiude la richiesta in uscita, accettata o no: la
				// finestra non deve mostrare una conferma già risolta.
				this.pairRequests = this.pairRequests.filter(
					(request) => !(request.direction === 'outgoing' && request.peerId === id)
				);
			}
		});
	}

	/** Risponde a una richiesta in arrivo: dopo la risposta sparisce dalla lista. */
	async answerPairRequest(requestId: string, accept: boolean): Promise<void> {
		await invoke('link_pair_lan_answer', { requestId, accept });
		this.pairRequests = this.pairRequests.filter((request) => request.requestId !== requestId);
		if (accept) await this.refresh();
	}

	/** Nome unico per computer e telefoni (R-MI-52). */
	async setName(name: string): Promise<void> {
		await invoke('devices_set_name', { name });
		await this.refresh();
	}

	/** Server di collegamento unico (R-MI-56). */
	setServer(url: string): Promise<DevicesServerInfo> {
		return this.action(() => invoke<DevicesServerInfo>('devices_set_server', { url }));
	}

	permissions(machine: string, permissions: MachinePermissions): Promise<void> {
		return this.action(async () => this.apply(await invoke<LinkStatus>('link_permissions', { machine, permissions })));
	}

	revoke(machine: string, everywhere = false): Promise<void> {
		return this.action(async () => this.apply(await invoke<LinkStatus>('link_revoke', { machine, everywhere })));
	}

	/** «Crea una nuova identità» dopo la perdita della chiave (R-MI-43). */
	resetIdentity(): Promise<void> {
		return this.action(async () => this.apply(await invoke<LinkStatus>('link_reset_identity')));
	}
}

export const linkStore = new LinkStore();

export function offlineReason(machineId: string): 'relay' | 'machine' | null {
	return linkStore.offlineReason(machineId);
}

/**
 * Nome unico di questo computer (R-MI-52): lo stesso valore vale per le
 * macchine abbinate e per Studio Remote, così non esistono due nomi.
 */
export function devicesSetName(name: string): Promise<void> {
	return linkStore.setName(name);
}

/**
 * «Server di collegamento» unico (R-MI-56): dal relay di Studio Remote si
 * ricava, se il server lo dichiara, anche quello dei computer.
 */
export function devicesSetServer(url: string): Promise<DevicesServerInfo> {
	return linkStore.setServer(url);
}
