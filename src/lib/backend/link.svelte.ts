import { Channel } from '@tauri-apps/api/core';
import { invoke, isTauri, listen, updateLinkedMachines, routeErrorText, LOCAL_MACHINE, type UnlistenFn } from './ipc.ts';
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

/**
 * Fonde i peer nell'elenco esistente: un campo cambiato avvisa solo chi lo
 * legge, e l'elenco stesso cambia solo se cambiano gli id. Con il battito che
 * arriva ogni pochi secondi, sostituire gli oggetti rimetteva in coda ogni
 * effetto che li attraversa (S3-link-front-01).
 */
function mergePeer(previous: LinkedMachine, next: LinkedMachine): void {
	if (previous.name !== next.name) previous.name = next.name;
	if (previous.online !== next.online) previous.online = next.online;
	if (previous.compatible !== next.compatible) previous.compatible = next.compatible;
	if (previous.version !== next.version) previous.version = next.version;
	if (previous.route !== next.route) previous.route = next.route;
	if (previous.latencyMs !== next.latencyMs) previous.latencyMs = next.latencyMs;
	if (previous.lastSeen !== next.lastSeen) previous.lastSeen = next.lastSeen;
	if (previous.permissions.agents !== next.permissions.agents) previous.permissions.agents = next.permissions.agents;
	if (previous.permissions.files !== next.permissions.files) previous.permissions.files = next.permissions.files;
	if (previous.permissions.terminal !== next.permissions.terminal) previous.permissions.terminal = next.permissions.terminal;
}

/**
 * Aggiorna `status.peers` senza sostituirlo quando gli id non cambiano: chi
 * legge l'elenco (o un suo campo) viene avvisato solo per una modifica vera.
 */
function applyPeers(status: LinkStatus, peers: LinkedMachine[]): void {
	const sameIds = status.peers.length === peers.length && status.peers.every((peer, index) => peer.id === peers[index].id);
	if (!sameIds) {
		status.peers = peers;
		return;
	}
	for (let index = 0; index < peers.length; index++) mergePeer(status.peers[index], peers[index]);
}

class LinkStore {
	status = $state<LinkStatus>({ enabled: false, name: '', machineId: '', platform: '', relayUrl: '', hasRelayToken: false, relayReachable: null, peers: [], keyMissing: false });
	replacements = $state<LinkedMachine[]>([]);
	hosts = $state<Record<string, DesktopHostSnapshot>>({});
	/** Corsie occupate da sessioni remote; la revisione scarta i riepiloghi vecchi. */
	activity = $state<LaneActivitySnapshot>({ revision: NO_ACTIVITY.revision, lanes: [] });
	/**
	 * Macchine che hanno gia' risposto dopo la connessione (D8, R-MI-49).
	 * `online` dice solo che il canale QUIC e' aperto: prima del primo
	 * riepilogo dell'host la macchina e' «in attesa di risposta», non «in
	 * linea». Le attese di D6 si sciolgono qui.
	 */
	responded = $state<Record<string, boolean>>({});
	/**
	 * Chiavi primitive per gli effetti: leggere `status.peers` fa dipendere
	 * l'effetto da quel campo (e prima dall'intero oggetto), quindi un
	 * `link:status` senza novita' ne faceva ripartire una mezza finestra
	 * (S3-link-front-01). Chi non ha bisogno dei peer interi legge queste.
	 */
	onlinePeersKey = $derived(this.status.peers
		.filter((peer) => peer.online && peer.compatible)
		.map((peer) => `${peer.id}@${peer.version ?? ''}`)
		.join('|'));
	/** Versione di Studio di ogni macchina in linea: le domande d'aggiornamento (R-MI-38). */
	peerVersionsKey = $derived(this.status.peers
		.map((peer) => `${peer.id}@${peer.version ?? ''}@${peer.online}`)
		.join('|'));
	loading = $state(false);
	busy = $state(false);
	error = $state<string | null>(null);
	private respondWaiters: Array<{ machine: string; resolve: () => void }> = [];
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
		const current = this.status;
		// Solo nuovi id dopo lo stato iniziale: funziona anche per chi genera
		// il codice, che apprende l'abbinamento dall'evento e non da link_pair.
		if (current.machineId) {
			const previous = new Set(current.peers.map((peer) => peer.id));
			for (const fresh of status.peers) {
				if (previous.has(fresh.id)) continue;
				for (const old of current.peers) {
					if (old.id !== fresh.id && previous.has(old.id) && !old.online && old.name === fresh.name &&
						!this.replacements.some((candidate) => candidate.id === old.id)) {
						this.replacements.push(old);
					}
				}
			}
		}
		// Campo per campo, non un oggetto nuovo: il backend emette `link:status`
		// anche quando nulla e' cambiato, e sostituire `status` faceva ripartire
		// ogni effetto che legge il collegamento (S3-link-front-01, S2-link-rust-03).
		if (current.enabled !== status.enabled) current.enabled = status.enabled;
		if (current.name !== status.name) current.name = status.name;
		if (current.machineId !== status.machineId) current.machineId = status.machineId;
		if (current.platform !== status.platform) current.platform = status.platform;
		if (current.relayUrl !== status.relayUrl) current.relayUrl = status.relayUrl;
		if (current.hasRelayToken !== status.hasRelayToken) current.hasRelayToken = status.hasRelayToken;
		if (current.relayReachable !== status.relayReachable) current.relayReachable = status.relayReachable;
		if (current.keyMissing !== status.keyMissing) current.keyMissing = status.keyMissing;
		applyPeers(current, status.peers);
		updateLinkedMachines(status.peers.map((peer) => ({
			id: peer.id, name: peer.name, online: peer.online, compatible: peer.compatible
		})));
		const known = new Set(status.peers.map((peer) => peer.id));
		for (const machine of Object.keys(this.hosts)) {
			if (known.has(machine)) continue;
			delete this.hosts[machine];
			projectStore.removeRemoteMachine(machine);
		}
		for (const peer of status.peers) {
			if (!peer.online) {
				projectStore.markRemoteMachineOffline(peer.id);
				// Una connessione nuova riparte da «in attesa di risposta» (D8):
				// senza questo il punto resterebbe verde prima del primo
				// riepilogo anche dopo una riconnessione.
				if (this.responded[peer.id]) {
					const { [peer.id]: _reset, ...rest } = this.responded;
					this.responded = rest;
				}
			}
		}
	}

	/** L'altra macchina ha risposto almeno una volta da quando e' in linea (D8). */
	hasResponded(machineId: string): boolean {
		return this.responded[machineId] === true;
	}

	/**
	 * Attende che una macchina risponda (D6): all'avvio le sessioni dei progetti
	 * remoti si aprivano prima del collegamento e fallivano con
	 * `machine_unreachable`. Si risolve anche se la macchina e' spenta o il
	 * collegamento e' spento: chi aspetta riprova al primo riepilogo, non resta
	 * appeso per sempre.
	 */
	whenResponded(machineId: string, timeoutMs = 60_000): Promise<void> {
		if (this.hasResponded(machineId)) return Promise.resolve();
		const peer = this.machineFor(machineId);
		// Spenta: si risolve subito, l'apertura fallisce e la sessione riparte
		// al ritorno in linea (D6). Aspettare qui lascerebbe appesa la chat.
		if (!peer?.online || !this.status.enabled) return Promise.resolve();
		const { promise, resolve } = Promise.withResolvers<void>();
		const waiter = {
			machine: machineId,
			resolve: () => {
				window.clearTimeout(timer);
				resolve();
			}
		};
		// Un tetto esiste perche' chi aspetta non resti appeso per sempre: al
		// ritorno in linea si riprova comunque (D6).
		const timer = window.setTimeout(() => {
			this.respondWaiters = this.respondWaiters.filter((candidate) => candidate !== waiter);
			resolve();
		}, timeoutMs);
		this.respondWaiters.push(waiter);
		return promise;
	}

	private markResponded(machine: string): void {
		if (this.responded[machine]) return;
		this.responded = { ...this.responded, [machine]: true };
		const ready = this.respondWaiters.filter((waiter) => waiter.machine === machine);
		this.respondWaiters = this.respondWaiters.filter((waiter) => waiter.machine !== machine);
		for (const waiter of ready) waiter.resolve();
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
		// Il primo riepilogo e' la risposta dell'host: da qui la macchina e'
		// «in linea» (D8) e le aperture in attesa partono (D6). Vale pero' solo
		// se il collegamento la vede in linea: un riepilogo applicato dalla
		// cache all'avvio, con la macchina spenta, non e' una risposta (S3-link-front-03).
		if (this.machineFor(machine)?.online) this.markResponded(machine);
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
			// Prima lo stato del collegamento, poi la cache: con la cache davanti
			// `ipc.ts` non conosceva ancora le macchine in linea e ogni apertura
			// partiva con `machine_unreachable` (S3-link-front-03).
			await this.refresh();
			const cached = await invoke<Record<string, DesktopHostSnapshot>>('link_host_states');
			for (const [machine, state] of Object.entries(cached)) {
				if (!received.has(machine)) this.applyHost(machine, state);
			}
		} catch (error) {
			// Un rifiuto di instradamento nomina la macchina (C5); il resto
			// resta il suo messaggio.
			this.error = routeErrorText(error);
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
			// Rifiuto di instradamento o guasto: la frase e' quella comune (C5).
			this.error = routeErrorText(error);
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
