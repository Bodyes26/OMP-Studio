import { untrack } from 'svelte';
import { invoke, isTauri, listen, LOCAL_MACHINE, routeErrorText, type MachineId } from './ipc.ts';
import { linkStore, type LinkedMachine } from './link.svelte.ts';
import { currentWaitReasons } from './peerUpdate.svelte.ts';
import { compareOmpVersions, ompAlignment, ompAskKey, updateFailureObsolete, type WaitReason } from './peerUpdateRules.ts';
import { ompPeersKey, PeerVersionCadence, PEER_VERSION_REFRESH_MS } from './peerVersionCadence.ts';
import { presenceStore } from '#lib/automations/presence.svelte.ts';
import { m } from '#lib/paraglide/messages.js';
import { ompVersionStore } from '#lib/stores/ompVersion.svelte.ts';
import { studioUpdaterStore } from '#lib/stores/studioUpdater.svelte.ts';

/**
 * omp allineato fra le macchine abbinate (R-MI-67…R-MI-70).
 *
 * La versione di omp delle altre macchine si legge con `get_omp_version`
 * instradato (nessun campo nuovo nel collegamento): al rientro di una
 * macchina, quando cambia la sua versione di Studio o l'omp di questa, e ogni
 * 10 minuti. Se una e' indietro la domanda compare qui, una volta per
 * (macchina, versione di la', versione di qui); «Aggiorna» lancia `omp update`
 * sulla macchina indietro, che poi si riavvia del tutto appena e' libera.
 */

export type OmpUpdatePhase = 'starting' | 'updating' | 'waiting' | 'restarting' | 'failed';

export interface OmpRemoteStatus {
	requestedBy: string;
	phase: OmpUpdatePhase;
	waitingFor: WaitReason[];
	error: string | null;
}

export interface OmpProposal {
	machine: LinkedMachine;
	/** `peer`: aggiornare l'altra macchina; `here`: aggiornare questa. */
	where: 'peer' | 'here';
	peerVersion: string;
	own: string;
}

const FOLLOW_INTERVAL_MS = 3000;
/** Oltre questo tempo si smette di seguire: la macchina e' rimasta spenta. */
const FOLLOW_LIMIT_MS = 2 * 60 * 60_000;

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

/** Un rifiuto di instradamento diventa una frase con il nome della macchina (C5). */
function errorText(reason: unknown): string {
	return routeErrorText(reason);
}

/**
 * Riavvio completo di Studio (R-MI-70): chiude ogni processo omp e riapre
 * l'app. L'uscita si autorizza come per l'aggiornamento di Studio, cosi'
 * lavori in corso e salvataggi passano dalla stessa conferma.
 */
export async function restartStudio(): Promise<boolean> {
	if (!await presenceStore.authorizeExit('omp_update')) return false;
	try {
		await invoke('studio_restart', {}, { machine: LOCAL_MACHINE });
		return true;
	} catch (reason) {
		await presenceStore.revokeExitAuthorization();
		throw reason;
	}
}

class OmpPeerUpdateStore {
	/** Versione di omp delle altre macchine in linea, per id. */
	peerVersions = $state<Record<MachineId, string>>({});
	/** Domande in coda: la prima e' quella mostrata. */
	proposals = $state<OmpProposal[]>([]);
	/** Aggiornamenti chiesti da qui alle altre macchine. */
	statuses = $state<Record<MachineId, OmpRemoteStatus>>({});
	/** Aggiornamento di omp su questa macchina, se in corso. */
	localPhase = $state<OmpUpdatePhase | null>(null);
	error = $state<string | null>(null);
	private asked = new Set<string>();
	private polling = new Set<MachineId>();
	/** Una sola richiesta `get_omp_version` in volo per macchina (R-MI-67). */
	private inFlight = new Map<MachineId, Promise<string | null>>();
	/** Cadenza condivisa con i test: rientro, cambio versione, dieci minuti. */
	private cadence = new PeerVersionCadence();
	private running: Promise<void> | null = null;
	private started = false;

	get proposal(): OmpProposal | null {
		return this.proposals[0] ?? null;
	}

	start(): void {
		if (this.started || !isTauri()) return;
		this.started = true;
		void listen('omp-update:remote-install', () => { void this.updateHereAndRestart(); });
		ompVersionStore.ensure();
		// R-MI-67: dieci minuti come ripiego, piu' il rientro e il cambio di
		// versione. Il giro era a ogni `link:status`, cioe' ogni ~5 s per
		// macchina: il 99% di `studio.log` (S3-link-front-02). La cadenza sta in
		// `peerVersionCadence.ts`, provata senza finestra.
		setInterval(() => this.readPeers(true), PEER_VERSION_REFRESH_MS);
		$effect.root(() => {
			// Chiave primitiva, non `status.peers`: leggere l'elenco faceva
			// dipendere l'effetto dal campo, che cambia a ogni battito. La
			// chiave cambia solo per un rientro o un cambio di versione.
			$effect(() => {
				void linkStore.onlinePeersKey;
				untrack(() => this.readPeers(false));
			});
			$effect(() => {
				void ompVersionStore.current;
				untrack(() => this.propose());
			});
		});
	}

	/**
	 * Rilegge omp sulle macchine in linea e compatibili (R-MI-67). `fallback`
	 * e' il giro da dieci minuti: senza, la chiave invariata non rilegge.
	 */
	private readPeers(fallback: boolean): void {
		const online = linkStore.status.peers.filter((peer) => peer.online && peer.compatible);
		const ids = new Set(online.map((peer) => peer.id));
		const kept = Object.fromEntries(Object.entries(this.peerVersions).filter(([id]) => ids.has(id)));
		if (Object.keys(kept).length !== Object.keys(this.peerVersions).length) this.peerVersions = kept;
		const due = this.cadence.due(online, ompPeersKey(online), Date.now(), fallback);
		for (const machineId of due) void this.readPeer(machineId);
	}

	private async readPeer(machineId: MachineId): Promise<string | null> {
		// Una richiesta in volo per macchina: il rientro e il giro da dieci
		// minuti possono incrociarsi, e due `get_omp_version` per lo stesso
		// peer non dicono niente di piu' (S3-link-front-02).
		const running = this.inFlight.get(machineId);
		if (running) return running;
		this.cadence.begin(machineId);
		const request = invoke<string>('get_omp_version', {}, { machine: machineId })
			.catch(() => null)
			.then((version) => {
				if (version && this.peerVersions[machineId] !== version) {
					this.peerVersions = { ...this.peerVersions, [machineId]: version };
				}
				this.dropObsoleteFailure(machineId, version);
				return version;
			})
			.finally(() => {
				this.inFlight.delete(machineId);
				this.cadence.end(machineId, Date.now());
			});
		this.inFlight.set(machineId, request);
		return request;
	}

	/**
	 * Un aggiornamento fallito smette di essere un errore quando la macchina
	 * risulta gia' allineata (si e' aggiornata da sola, o l'utente l'ha fatto
	 * altrove): la riga nella tessera direbbe il falso e non scadrebbe mai.
	 */
	private dropObsoleteFailure(machineId: MachineId, version: string | null): void {
		const status = this.statuses[machineId];
		if (!status || status.phase !== 'failed') return;
		if (!updateFailureObsolete(ompVersionStore.current, version, compareOmpVersions)) return;
		const { [machineId]: _done, ...rest } = this.statuses;
		this.statuses = rest;
	}

	/**
	 * Accoda le domande (R-MI-68): una per (macchina, versione di la', versione
	 * di qui); nessuna mentre un aggiornamento e' gia' in corso.
	 */
	private propose(): void {
		const own = ompVersionStore.current;
		if (!own || this.localPhase) return;
		const queued = untrack(() => this.proposals);
		const added: OmpProposal[] = [];
		for (const machine of linkStore.status.peers) {
			const peerVersion = this.peerVersions[machine.id];
			if (!machine.online || !peerVersion) continue;
			const where = ompAlignment(peerVersion, own);
			if (!where) continue;
			const status = this.statuses[machine.id];
			if (status && status.phase !== 'failed') continue;
			const key = ompAskKey(machine.id, peerVersion, own);
			if (this.asked.has(key)) continue;
			// Aggiornare questa macchina e' una domanda sola, anche con piu'
			// macchine avanti.
			if (where === 'here' && [...queued, ...added].some((proposal) => proposal.where === 'here')) continue;
			this.asked.add(key);
			added.push({ machine, where, peerVersion, own });
		}
		if (added.length) this.proposals = [...queued, ...added];
	}

	dismiss(): void {
		this.proposals = this.proposals.slice(1);
	}

	async confirm(): Promise<void> {
		const proposal = this.proposal;
		this.dismiss();
		if (!proposal) return;
		this.error = null;
		if (proposal.where === 'here') void this.updateHereAndRestart();
		else await this.startOn(proposal.machine.id, proposal.own);
	}

	statusFor(machineId: MachineId): OmpRemoteStatus | null {
		return this.statuses[machineId] ?? null;
	}

	/** «Aggiorna omp su M» dalla tessera: la domanda subito, anche se gia' chiesta. */
	request(machineId: MachineId): void {
		const machine = linkStore.machineFor(machineId);
		const own = ompVersionStore.current;
		const peerVersion = this.peerVersions[machineId];
		if (!machine || !own || !peerVersion || ompAlignment(peerVersion, own) !== 'peer') return;
		this.proposals = [{ machine, where: 'peer', peerVersion, own }, ...this.proposals];
	}

	/** R-MI-69: `omp update` e riavvio sull'altra macchina. */
	private async startOn(machineId: MachineId, target: string): Promise<void> {
		try {
			await invoke('omp_update_remote_start', {}, { machine: machineId });
			this.statuses = { ...this.statuses, [machineId]: {
				requestedBy: linkStore.status.machineId, phase: 'starting', waitingFor: [], error: null
			} };
			this.follow(machineId, target);
		} catch (reason) {
			this.error = errorText(reason);
			const name = linkStore.machineFor(machineId)?.name ?? machineId;
			studioUpdaterStore.setBadge(m.omp_peer_update_failed({ name, error: this.error }), 'error', 8000);
		}
	}

	/**
	 * Segue l'altra macchina finche' non torna in linea con omp almeno alla
	 * versione di qui. Dopo il riavvio lo stato remoto non c'e' piu' (processo
	 * nuovo): a quel punto decide la versione letta.
	 */
	private follow(machineId: MachineId, target: string): void {
		if (this.polling.has(machineId)) return;
		this.polling.add(machineId);
		const startedAt = Date.now();
		void (async () => {
			try {
				while (Date.now() - startedAt < FOLLOW_LIMIT_MS) {
					await sleep(FOLLOW_INTERVAL_MS);
					const machine = linkStore.machineFor(machineId);
					if (!machine) break;
					if (!machine.online) continue;
					const status = await invoke<OmpRemoteStatus | null>('omp_update_remote_status', {}, { machine: machineId }).catch(() => undefined);
					if (status === undefined) continue;
					if (status) {
						this.statuses = { ...this.statuses, [machineId]: status };
						if (status.phase === 'failed') {
							studioUpdaterStore.setBadge(m.omp_peer_update_failed({ name: machine.name, error: status.error ?? '' }), 'error', 8000);
							break;
						}
						continue;
					}
					const version = await this.readPeer(machineId);
					if (!version) continue;
					if (compareOmpVersions(version, target) >= 0) break;
					// Riavviata ma omp ancora indietro: l'aggiornamento non ha portato
					// alla versione di qui (canale diverso); lo dice la riga di stato.
					this.statuses = { ...this.statuses, [machineId]: {
						requestedBy: linkStore.status.machineId, phase: 'failed', waitingFor: [],
						error: m.omp_peer_update_still_behind({ version, own: target })
					} };
					break;
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

	/**
	 * `omp update` qui e riavvio completo appena la macchina e' libera
	 * (R-MI-69, R-MI-70). Una sola esecuzione per volta: una seconda richiesta
	 * si aggancia a quella in corso.
	 */
	updateHereAndRestart(): Promise<void> {
		this.running ??= this.runHere().finally(() => { this.running = null; });
		return this.running;
	}

	private async runHere(): Promise<void> {
		const phase = (value: OmpUpdatePhase, waitingFor: WaitReason[] = [], error: string | null = null) => {
			this.localPhase = value === 'failed' ? null : value;
			void invoke('omp_update_remote_report', { phase: value, waitingFor, error }, { machine: LOCAL_MACHINE }).catch(() => {});
		};
		// Chi e' davanti a questa macchina deve sapere perche' Studio si riavviera'.
		studioUpdaterStore.setRemoteNotice(m.omp_peer_update_incoming());
		try {
			phase('updating');
			await invoke('run_omp_update', {}, { machine: LOCAL_MACHINE });
			await ompVersionStore.refresh();
			let previous = '';
			for (;;) {
				const reasons = await currentWaitReasons();
				if (reasons.length === 0) break;
				const key = reasons.join(',');
				if (key !== previous) { phase('waiting', reasons); previous = key; }
				await sleep(5000);
			}
			phase('restarting');
			if (!await restartStudio()) {
				// Uscita rifiutata: l'avviso «si riavvia appena libera» non e' piu' vero.
				studioUpdaterStore.setRemoteNotice(null);
				phase('failed', [], m.omp_peer_update_restart_declined());
			} else {
				// Riavvio chiesto ma non avvenuto entro pochi secondi (uscita
				// bloccata da un altro percorso): l'avviso non e' piu' vero e
				// nessuno lo sostituirebbe. Si azzera anche la fase, altrimenti
				// `propose()` resterebbe zitto per sempre e nessuna macchina
				// potrebbe piu' chiedere l'allineamento di omp.
				setTimeout(() => {
					studioUpdaterStore.setRemoteNotice(null);
					if (this.localPhase === 'restarting') this.localPhase = null;
				}, 10_000);
			}
		} catch (reason) {
			const error = errorText(reason);
			this.error = error;
			studioUpdaterStore.setRemoteNotice(null);
			studioUpdaterStore.setBadge(m.omp_peer_update_failed_here({ error }), 'error', 8000);
			phase('failed', [], error);
		}
	}
}

export const ompPeerUpdate = new OmpPeerUpdateStore();
