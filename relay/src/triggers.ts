/**
 * Rilevatore di eventi trigger per le notifiche Web Push a partire da istantanee consecutive degli host.
 * - Nuova richiesta di attenzione (domanda / conferma; non quota): "<machine> · <project>: domanda"
 * - Blocco di quota apparso: notifica quota con nome macchina
 * - Agente corsia da working/background a idle: "<lane.title>: ha finito" (con debounce di qualche secondo)
 * - Nessuna notifica al riavvio del relay (confronto con l'ultimo stato persistito in SQLite)
 * - Deduplicazione per requestId
 */

import type { HostState, PushNotificationPayload, RemoteAttention, RemoteLane, RemoteProject } from './protocol.ts';
import type { RelayStore } from './store.ts';

export interface TriggerDetectorOptions {
	debounceMs?: number;
	onNotification: (payload: PushNotificationPayload) => void;
}

export const DEFAULT_LANE_IDLE_DEBOUNCE_MS = 3_000;

export class HostSnapshotTriggerDetector {
	private readonly hostStates = new Map<string, HostState>();
	private readonly seenRequestIds = new Set<string>();
	private readonly idleDebounceTimers = new Map<string, Timer>();
	private readonly debounceMs: number;
	private readonly onNotification: (payload: PushNotificationPayload) => void;

	constructor(
		private readonly store: RelayStore,
		options: TriggerDetectorOptions
	) {
		this.debounceMs = options.debounceMs ?? DEFAULT_LANE_IDLE_DEBOUNCE_MS;
		this.onNotification = options.onNotification;
	}

	/**
	 * Elabora una nuova istantanea di stato per una macchina.
	 * Confronta lo stato con quello precedente (o con l'ultimo stato salvato al riavvio)
	 * per rilevare transizioni ed emettere le notifiche necessarie.
	 */
	processSnapshot(hostId: string, hostName: string, newState: HostState): void {
		let prevState = this.hostStates.get(hostId);

		// Al riavvio del relay, carica lo stato persistito per evitare notifiche spurie
		if (!prevState) {
			const persistedHost = this.store.getHost(hostId);
			if (persistedHost?.lastState) {
				prevState = persistedHost.lastState;
				// Pre-popola le richieste gia' pendenti nello stato persistito per non ri-notificarle
				for (const p of prevState.projects) {
					for (const att of p.attention) {
						this.seenRequestIds.add(att.requestId);
					}
				}
			}
		}

		// Se non c'e' stato precedente (nuovo host o primo snapshot mai visto), inizializza senza sparare eventi passati
		if (!prevState) {
			this.hostStates.set(hostId, newState);
			for (const p of newState.projects) {
				for (const att of p.attention) {
					this.seenRequestIds.add(att.requestId);
				}
			}
			return;
		}

		// Confronto transizioni tra prevState e newState
		this.checkAttentionRequests(hostId, hostName, prevState, newState);
		this.checkQuotaBlocks(hostId, hostName, prevState, newState);
		this.checkLaneIdleTransitions(hostId, hostName, prevState, newState);

		// Aggiorna stato corrente in memoria
		this.hostStates.set(hostId, newState);
	}

	/**
	 * Rileva nuove richieste di attenzione (domanda o conferma, escluse quelle di quota).
	 */
	private checkAttentionRequests(
		hostId: string,
		hostName: string,
		prevState: HostState,
		newState: HostState
	): void {
		const prevAttentionIds = new Set<string>();
		for (const p of prevState.projects) {
			for (const att of p.attention) {
				prevAttentionIds.add(att.requestId);
			}
		}

		for (const project of newState.projects) {
			for (const att of project.attention) {
				// Ignora blocchi di quota (hanno un gestore dedicato)
				if (att.quotaBlocked) continue;

				// Transizione: deve essere una richiesta non presente nello snapshot precedente e non ancora notificata
				if (!prevAttentionIds.has(att.requestId) && !this.seenRequestIds.has(att.requestId)) {
					this.seenRequestIds.add(att.requestId);

					const questionText = att.title || att.message || 'domanda';
					const payload: PushNotificationPayload = {
						title: `${hostName} · ${project.name}`,
						body: `${questionText}: domanda`,
						tag: `att-${att.requestId}`,
						data: {
							hostId,
							projectId: project.id,
							laneId: att.laneId ?? undefined,
							requestId: att.requestId,
							type: 'attention'
						}
					};

					this.onNotification(payload);
				}
			}
		}
	}

	/**
	 * Rileva la comparsa di un blocco di quota (da att.quotaBlocked o stato fornitore 'exhausted').
	 */
	private checkQuotaBlocks(
		hostId: string,
		hostName: string,
		prevState: HostState,
		newState: HostState
	): void {
		const prevHadQuotaBlock = new Set<string>();
		for (const p of prevState.projects) {
			for (const att of p.attention) {
				if (att.quotaBlocked) {
					prevHadQuotaBlock.add(att.requestId);
				}
			}
		}

		for (const project of newState.projects) {
			for (const att of project.attention) {
				if (att.quotaBlocked) {
					if (!prevHadQuotaBlock.has(att.requestId) && !this.seenRequestIds.has(att.requestId)) {
						this.seenRequestIds.add(att.requestId);

						const reason = att.quotaBlocked.reason === 'quota_exhausted' ? 'Quota esaurita' : 'Errore fornitore';
						const providerInfo = att.quotaBlocked.provider ? ` (${att.quotaBlocked.provider})` : '';

						const payload: PushNotificationPayload = {
							title: `${hostName} · ${project.name}`,
							body: `${reason}${providerInfo}: blocco di quota`,
							tag: `quota-${att.requestId}`,
							data: {
								hostId,
								projectId: project.id,
								laneId: att.laneId ?? undefined,
								requestId: att.requestId,
								type: 'quota'
							}
						};

						this.onNotification(payload);
					}
				}
			}
		}

		// Rilascia le richieste di attenzione risolte cosi' che nuove richieste future possano notificare
		const currentAttIds = new Set<string>();
		for (const p of newState.projects) {
			for (const att of p.attention) {
				currentAttIds.add(att.requestId);
			}
		}
		for (const p of prevState.projects) {
			for (const att of p.attention) {
				if (!currentAttIds.has(att.requestId)) {
					this.seenRequestIds.delete(att.requestId);
				}
			}
		}

		// Verifica anche fornitori quota passati da stato non exhausted a exhausted
		const prevExhausted = new Set<string>();
		if (prevState.quota?.providers) {
			for (const prov of prevState.quota.providers) {
				if (prov.status === 'exhausted') {
					prevExhausted.add(prov.account ? `${prov.provider}:${prov.account}` : prov.provider);
				}
			}
		}

		if (newState.quota?.providers) {
			for (const prov of newState.quota.providers) {
				const provKey = prov.account ? `${prov.provider}:${prov.account}` : prov.provider;
				if (prov.status === 'exhausted' && !prevExhausted.has(provKey)) {
					const quotaKey = `quota-prov-${hostId}-${provKey}`;
					if (!this.seenRequestIds.has(quotaKey)) {
						this.seenRequestIds.add(quotaKey);

						const payload: PushNotificationPayload = {
							title: `${hostName}`,
							body: `Quota esaurita per ${prov.provider}${prov.account ? ` (${prov.account})` : ''}`,
							tag: quotaKey,
							data: {
								hostId,
								type: 'quota'
							}
						};

						this.onNotification(payload);
					}
				}
			}
		}

		// Rilascia i fornitori quota tornati disponibili (exhausted -> ok/warning -> exhausted puo' notificare di nuovo)
		if (newState.quota?.providers) {
			for (const prov of newState.quota.providers) {
				const provKey = prov.account ? `${prov.provider}:${prov.account}` : prov.provider;
				if (prov.status !== 'exhausted') {
					const quotaKey = `quota-prov-${hostId}-${provKey}`;
					this.seenRequestIds.delete(quotaKey);
				}
			}
		}
	}

	/**
	 * Rileva il passaggio di un agente corsia da working/background a idle con debounce anti-flapping.
	 */
	private checkLaneIdleTransitions(
		hostId: string,
		hostName: string,
		prevState: HostState,
		newState: HostState
	): void {
		// Mappa delle corsie precedenti
		const prevLanes = new Map<string, { lane: RemoteLane; projectName: string }>();
		for (const p of prevState.projects) {
			for (const lane of p.lanes) {
				const key = `${hostId}:${p.id}:${lane.id}`;
				prevLanes.set(key, { lane, projectName: p.name });
			}
		}

		for (const project of newState.projects) {
			for (const currentLane of project.lanes) {
				const key = `${hostId}:${project.id}:${currentLane.id}`;
				const prevEntry = prevLanes.get(key);

				if (!prevEntry) continue;

				const prevState = prevEntry.lane.agent.state;
				const currentState = currentLane.agent.state;

				// Transizione da working o background a idle
				if ((prevState === 'working' || prevState === 'background') && currentState === 'idle') {
					// Cancella eventuale timer pendente
					clearTimeout(this.idleDebounceTimers.get(key));

					// Avvia il debounce
					const timer = setTimeout(() => {
						this.idleDebounceTimers.delete(key);

						const laneTitle = currentLane.title || 'Corsia';
						const payload: PushNotificationPayload = {
							title: `${hostName} · ${project.name}`,
							body: `${laneTitle}: ha finito`,
							tag: `idle-${key}`,
							data: {
								hostId,
								projectId: project.id,
								laneId: currentLane.id,
								type: 'idle'
							}
						};

						this.onNotification(payload);
					}, this.debounceMs);

					timer.unref?.();
					this.idleDebounceTimers.set(key, timer);
				} else if (currentState === 'working' || currentState === 'background') {
					// Se l'agente e' tornato al lavoro prima della scadenza del debounce, annulla la notifica
					clearTimeout(this.idleDebounceTimers.get(key));
					this.idleDebounceTimers.delete(key);
				}
			}
		}
	}

	/**
	 * Pulisce i timer pendenti alla chiusura.
	 */
	destroy(): void {
		for (const timer of this.idleDebounceTimers.values()) {
			clearTimeout(timer);
		}
		this.idleDebounceTimers.clear();
		this.hostStates.clear();
	}
}
