import type { AskQuestion, PromptAnswer } from './askAnswers.ts';
import { normalizePromptAnswer } from './askAnswers.ts';
import type { AskFormRequest, AskFormDraft } from './askForm.ts';
import { copyAskFormDraft } from './askForm.ts';
import {
	broadcastToWindows,
	listenFromWindows,
	windowBridgeAvailable,
	PROMPT_BUS_EVENTS,
	windowLabel
} from '#lib/stores/windowBridge.ts';

export type PromptMethod = 'select' | 'confirm' | 'input' | 'editor' | 'ask' | 'form';

/**
 * `expired`: richiesta persistita da un'esecuzione precedente. Il processo omp
 * che l'aveva aperta non esiste piu', quindi nessuno puo' riceverne la risposta.
 */
export type PromptStatus = 'pending' | 'resolved' | 'cancelled' | 'expired';

export interface PromptOptionDetail {
	description?: string;
}

export interface PromptTargetFilter {
	projectId?: string;
	laneId?: string | null;
	sessionId?: string | null;
}

export interface PromptRequestPayload {
	requestId: string;
	projectId: string;
	laneId?: string | null;
	sessionId?: string | null;
	toolCallId?: string | null;
	/** Processo omp che ha aperto la richiesta (id RPC): solo lui puo' riceverne la risposta. */
	owner?: string | null;
	kind?: string;
	method?: PromptMethod;
	title: string;
	message?: string;
	options?: string[];
	optionDetails?: PromptOptionDetail[];
	placeholder?: string;
	prefill?: string;
	deadline?: number;
	questions?: AskQuestion[] | unknown[];
	questionIndex?: number;
	totalQuestions?: number;
	createdAt?: number;
	form?: AskFormRequest;
	formDraft?: AskFormDraft;
	responder?: (answer: PromptAnswer) => Promise<boolean>;
}

export interface PromptRequest {
	readonly requestId: string;
	readonly projectId: string;
	readonly laneId?: string | null;
	readonly sessionId?: string | null;
	readonly toolCallId?: string | null;
	readonly owner?: string | null;
	readonly kind: string;
	readonly method: PromptMethod;
	readonly title: string;
	readonly message?: string;
	readonly options: string[];
	readonly optionDetails: PromptOptionDetail[];
	readonly placeholder?: string;
	readonly prefill?: string;
	readonly deadline?: number;
	readonly questions?: AskQuestion[] | unknown[];
	readonly questionIndex?: number;
	readonly totalQuestions?: number;
	readonly createdAt: number;
	readonly form?: AskFormRequest;
	formDraft?: AskFormDraft;
	status: PromptStatus;
	resolvedAt?: number;
	answer?: PromptAnswer;
	responder?: (answer: PromptAnswer) => Promise<boolean>;
}

export type SerializedPromptRequest = Omit<PromptRequest, 'responder'>;

export interface PromptBusStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface PromptBusOptions {
	storageKey?: string;
	storage?: PromptBusStorage;
	broadcast?: <T>(event: string, payload: T) => Promise<void>;
	listen?: <T>(event: string, handler: (payload: T) => void) => Promise<(() => void) | null>;
	autoInit?: boolean;
	/**
	 * Le voci pendenti trovate nello storage all'avvio diventano `expired`.
	 * Vale per la finestra principale: all'avvio nessun processo omp nuovo puo'
	 * avere richieste aperte prima di emetterle, quindi quelle persistite sono
	 * fantasmi dell'esecuzione precedente. La Companion non lo fa: si apre
	 * mentre la principale e' viva e le sue pendenti sono vere.
	 */
	expireRestored?: boolean;
}

const DEFAULT_STORAGE_KEY = 'omp-studio-pending-prompts';
const MAX_PROMPT_AGE_MS = 24 * 60 * 60 * 1000; // 24 ore: pulizia richieste stantie

/**
 * Storage predefinito basato su window.localStorage con fallback in memoria.
 */
function createDefaultStorage(): PromptBusStorage {
	if (typeof window !== 'undefined' && 'localStorage' in window) {
		try {
			const testKey = '__prompt_bus_test__';
			window.localStorage.setItem(testKey, '1');
			window.localStorage.removeItem(testKey);
			return window.localStorage;
		} catch {
			// localStorage non accessibile o bloccato
		}
	}
	const mem = new Map<string, string>();
	return {
		getItem: (k) => mem.get(k) ?? null,
		setItem: (k, v) => mem.set(k, v),
		removeItem: (k) => mem.delete(k)
	};
}

/**
 * PromptBus: bus unificato e resiliente per tutte le interazioni utente pendenti.
 *
 * Governa:
 * 1. Resilienza ai reload della WebView e crash: i prompt pendenti sono persistiti
 *    nello storage locale e restaurati immediatamente all'avvio o al riconnettersi.
 * 2. Sincronizzazione atomica tra Finestra Principale e Companion tramite windowBridge:
 *    la semantica e' 'first-response-wins' (solo la prima risposta per requestId viene accolta).
 * 3. Apertura tardiva: la Companion recupera e renderizza lo stato corretto istantaneamente.
 */
const PROMPT_BUS_DRAFT_EVENT = 'studio-prompt-draft-updated';
const PROMPT_BUS_RESOLVE_REQUEST_EVENT = 'studio-prompt-resolve-request';
const PROMPT_BUS_RESOLVE_ACK_EVENT = 'studio-prompt-resolve-ack';
const PROMPT_BUS_CANCEL_REQUEST_EVENT = 'studio-prompt-cancel-request';
const PROMPT_BUS_CANCEL_ACK_EVENT = 'studio-prompt-cancel-ack';

export class PromptBus {
	private requests = new Map<string, PromptRequest>();
	private resolvingRequests = new Set<string>();
	private formDrafts = new Map<string, AskFormDraft>();
	private pendingAcks = new Map<string, (result: { ok: boolean; error?: string }) => void>();
	private subscribers = new Set<(pendings: PromptRequest[]) => void>();
	private unlistenBridge: Array<() => void> = [];
	private storageKey: string;
	private storage: PromptBusStorage;
	private broadcastFn: <T>(event: string, payload: T) => Promise<void>;
	private listenFn: <T>(event: string, handler: (payload: T) => void) => Promise<(() => void) | null>;
	private initialized = false;
	constructor(options?: PromptBusOptions) {
		this.storageKey = options?.storageKey ?? DEFAULT_STORAGE_KEY;
		this.storage = options?.storage ?? createDefaultStorage();
		this.broadcastFn = options?.broadcast ?? broadcastToWindows;
		this.listenFn = options?.listen ?? listenFromWindows;

		// Ripristino sincrono immediato dallo storage
		this.restoreFromStorage();
		if (options?.expireRestored) this.expireRestored();

		if (options?.autoInit !== false && typeof window !== 'undefined') {
			void this.init();
		}
	}

	/**
	 * Inizializza il bus inter-finestra ascoltando i canali di sincronizzazione.
	 */
	async init(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		// Rilettura dallo storage per sicurezza
		this.restoreFromStorage();

		try {
			// 1. Nuova richiesta registrata da un'altra finestra
			const uReg = await this.listenFn<SerializedPromptRequest>(
				PROMPT_BUS_EVENTS.REGISTERED,
				(serialized) => {
					this.handleRemoteRegistration(serialized);
				}
			);
			if (uReg) this.unlistenBridge.push(uReg);

			// 2. Risoluzione completata da un'altra finestra (first-response-wins)
			const uRes = await this.listenFn<{ requestId: string; answer: PromptAnswer }>(
				PROMPT_BUS_EVENTS.RESOLVED,
				async (payload) => {
					await this.handleRemoteResolution(payload.requestId, payload.answer);
				}
			);
			if (uRes) this.unlistenBridge.push(uRes);

			// 3. Annullamento inviato da un'altra finestra
			const uCan = await this.listenFn<{ requestId: string }>(
				PROMPT_BUS_EVENTS.CANCELLED,
				async (payload) => {
					await this.handleRemoteCancellation(payload.requestId);
				}
			);
			if (uCan) this.unlistenBridge.push(uCan);

			// 4. Richiesta di sincronizzazione arrivata da una finestra aperta tardivamente
			const uSyncReq = await this.listenFn<unknown>(
				PROMPT_BUS_EVENTS.SYNC_REQUEST,
				() => {
					this.broadcastSync();
				}
			);
			if (uSyncReq) this.unlistenBridge.push(uSyncReq);

			// 5. Risposta di sincronizzazione con l'elenco delle richieste pendenti
			const uSyncRes = await this.listenFn<SerializedPromptRequest[]>(
				PROMPT_BUS_EVENTS.SYNC_RESPONSE,
				(pendings) => {
					this.handleRemoteSync(pendings);
				}
			);
			if (uSyncRes) this.unlistenBridge.push(uSyncRes);

			// 6. Aggiornamento bozza form interattivo tra finestre
			const uDraft = await this.listenFn<{ requestId: string; draft: AskFormDraft; owner?: string | null }>(
				PROMPT_BUS_DRAFT_EVENT,
				(payload) => {
					this.handleRemoteDraftUpdate(payload.requestId, payload.draft, payload.owner);
				}
			);
			if (uDraft) this.unlistenBridge.push(uDraft);

			// 7. Richiesta di risoluzione da secondaria (Companion) verso owner
			const uResolveReq = await this.listenFn<{
				nonce: string;
				requestId: string;
				answer: PromptAnswer;
				target?: PromptTargetFilter;
			}>(PROMPT_BUS_RESOLVE_REQUEST_EVENT, (payload) => {
				void this.handleRemoteResolveRequest(payload);
			});
			if (uResolveReq) this.unlistenBridge.push(uResolveReq);

			// 8. Risposta ack di risoluzione da owner verso secondaria
			const uResolveAck = await this.listenFn<{
				nonce: string;
				requestId: string;
				ok: boolean;
				error?: string;
			}>(PROMPT_BUS_RESOLVE_ACK_EVENT, (payload) => {
				this.handleRemoteResolveAck(payload);
			});
			if (uResolveAck) this.unlistenBridge.push(uResolveAck);

			// 9. Richiesta di annullamento da secondaria (Companion) verso owner
			const uCancelReq = await this.listenFn<{
				nonce: string;
				requestId: string;
				target?: PromptTargetFilter;
			}>(PROMPT_BUS_CANCEL_REQUEST_EVENT, (payload) => {
				void this.handleRemoteCancelRequest(payload);
			});
			if (uCancelReq) this.unlistenBridge.push(uCancelReq);

			// 10. Risposta ack di annullamento da owner verso secondaria
			const uCancelAck = await this.listenFn<{
				nonce: string;
				requestId: string;
				ok: boolean;
				error?: string;
			}>(PROMPT_BUS_CANCEL_ACK_EVENT, (payload) => {
				this.handleRemoteCancelAck(payload);
			});
			if (uCancelAck) this.unlistenBridge.push(uCancelAck);

			// Notifica alle altre finestre l'apertura per richiedere l'allineamento
			if (windowBridgeAvailable) {
				void this.broadcastFn(PROMPT_BUS_EVENTS.SYNC_REQUEST, {});
			}
		} catch (err) {
			console.warn('PromptBus: registrazione listener fallita', err);
		}
	}

	destroy(): void {
		for (const u of this.unlistenBridge) {
			try {
				u();
			} catch {
				// Ignora errori di disiscrizione
			}
		}
		this.unlistenBridge = [];
		this.subscribers.clear();
		this.pendingAcks.clear();
		this.resolvingRequests.clear();
		this.initialized = false;
	}

	/**
	 * Registra una richiesta interattiva sul bus.
	 *
	 * Se la richiesta esiste gia' ed e' pendente, la arricchisce (es. arrivo tardivo
	 * degli argomenti del tool `ask`).
	 * Se la richiesta esiste gia' ma e' gia' risolta o cancellata, non la sovrascrive.
	 */
	registerRequest(payload: PromptRequestPayload): PromptRequest {
		const { requestId, projectId } = payload;
		if (!requestId || !projectId) {
			throw new Error('PromptBus.registerRequest richiede requestId e projectId');
		}

		const existing = this.requests.get(requestId);
		if (existing) {
			if (existing.status !== 'pending') {
				return existing;
			}
			// Arricchimento della richiesta esistente
			const enriched: PromptRequest = {
				...existing,
				laneId: payload.laneId !== undefined ? payload.laneId : existing.laneId,
				toolCallId: payload.toolCallId ?? existing.toolCallId,
				method: payload.method ?? existing.method,
				questions: payload.questions ?? existing.questions,
				questionIndex: payload.questionIndex ?? existing.questionIndex,
				totalQuestions: payload.totalQuestions ?? existing.totalQuestions,
				optionDetails: payload.optionDetails ?? existing.optionDetails,
				options: payload.options ?? existing.options,
				placeholder: payload.placeholder ?? existing.placeholder,
				prefill: payload.prefill ?? existing.prefill,
				deadline: payload.deadline ?? existing.deadline,
				message: payload.message ?? existing.message,
				title: payload.title || existing.title,
				form: payload.form ?? existing.form,
				formDraft: payload.formDraft ?? existing.formDraft,
				responder: payload.responder ?? existing.responder
			};
			if (payload.formDraft) {
				this.formDrafts.set(requestId, copyAskFormDraft(payload.formDraft));
			}
			this.requests.set(requestId, enriched);
			this.broadcastRegistration(enriched);
			this.notifySubscribers();
			return enriched;
		}

		const request: PromptRequest = {
			requestId,
			projectId,
			laneId: payload.laneId ?? null,
			sessionId: payload.sessionId ?? null,
			toolCallId: payload.toolCallId ?? null,
			owner: payload.owner ?? null,
			kind: payload.kind ?? 'ask',
			method: payload.method ?? 'select',
			title: payload.title,
			message: payload.message,
			options: payload.options ?? [],
			optionDetails: payload.optionDetails ?? [],
			placeholder: payload.placeholder,
			prefill: payload.prefill,
			deadline: payload.deadline,
			questions: payload.questions,
			questionIndex: payload.questionIndex,
			totalQuestions: payload.totalQuestions,
			createdAt: payload.createdAt ?? Date.now(),
			form: payload.form,
			formDraft: payload.formDraft,
			status: 'pending',
			responder: payload.responder
		};

		if (payload.formDraft) {
			this.formDrafts.set(requestId, copyAskFormDraft(payload.formDraft));
		}
		this.requests.set(requestId, request);
		this.saveToStorage();
		this.broadcastRegistration(request);
		this.notifySubscribers();
		return request;
	}

	/**
	 * Risolve una richiesta con la risposta dell'utente.
	 *
	 * Semantica 'first-response-wins': se la richiesta e' gia' risolta o non esiste,
	 * l'invocazione ritorna `false` senza eseguire azioni.
	 */
	async resolveRequest(
		requestId: string,
		answer: PromptAnswer,
		target?: PromptTargetFilter,
		fromResponder = false
	): Promise<boolean> {
		const request = this.requests.get(requestId);
		if (!request || request.status !== 'pending') {
			return false;
		}

		if (this.resolvingRequests.has(requestId)) {
			return false;
		}

		if (!this.matchesTarget(request, target)) {
			return false;
		}

		// Se possiede il responder locale (authoritative owner): esegue e diffonde solo se ok
		if (request.responder || fromResponder) {
			this.resolvingRequests.add(requestId);
			try {
				if (request.responder && !fromResponder) {
					let responderSuccess = false;
					try {
						responderSuccess = await request.responder(answer);
					} catch (err) {
						console.error(`PromptBus: responder fallito per richiesta ${requestId}`, err);
						responderSuccess = false;
					}
					if (!responderSuccess) {
						// Consegna fallita: la richiesta e la bozza rimangono integre e pendenti
						return false;
					}
				}

				request.status = 'resolved';
				request.resolvedAt = Date.now();
				request.answer = answer;

				// Rimuove immediatamente dallo storage delle pendenti
				this.saveToStorage();

				// Notifica le altre finestre dell'avvenuta risoluzione
				void this.broadcastFn(PROMPT_BUS_EVENTS.RESOLVED, {
					requestId,
					answer: normalizePromptAnswer(answer)
				});

				this.notifySubscribers();
				return true;
			} finally {
				this.resolvingRequests.delete(requestId);
			}
		}

		// Secondaria senza responder locale (Companion): protocollo request/ack verso l'owner
		this.resolvingRequests.add(requestId);
		const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		try {
			const { promise: ackPromise, resolve } = Promise.withResolvers<{ ok: boolean; error?: string }>();
			const timer = setTimeout(() => {
				this.pendingAcks.delete(nonce);
				resolve({ ok: false, error: 'timeout' });
			}, 10_000);
			this.pendingAcks.set(nonce, (result) => {
				clearTimeout(timer);
				this.pendingAcks.delete(nonce);
				resolve(result);
			});

			await this.broadcastFn(PROMPT_BUS_RESOLVE_REQUEST_EVENT, {
				nonce,
				requestId,
				answer: normalizePromptAnswer(answer),
				target
			});

			const ack = await ackPromise;
			if (!ack.ok) {
				// Fallimento owner o timeout: la richiesta e la bozza rimangono pendenti
				return false;
			}

			request.status = 'resolved';
			request.resolvedAt = Date.now();
			request.answer = answer;
			this.saveToStorage();
			this.notifySubscribers();
			return true;
		} finally {
			this.resolvingRequests.delete(requestId);
		}
	}

	/**
	 * Annulla una richiesta pendente.
	 *
	 * Semantica atomica identica a `resolveRequest`: restituisce `false` se gia'
	 * chiusa o inesistente.
	 */
	async cancelRequest(requestId: string, target?: PromptTargetFilter, fromResponder = false): Promise<boolean> {
		const request = this.requests.get(requestId);
		if (!request || request.status !== 'pending') {
			return false;
		}

		if (this.resolvingRequests.has(requestId)) {
			return false;
		}

		if (!this.matchesTarget(request, target)) {
			return false;
		}

		if (request.responder || fromResponder) {
			this.resolvingRequests.add(requestId);
			try {
				if (request.responder && !fromResponder) {
					let cancelSuccess = false;
					try {
						cancelSuccess = await request.responder({ action: 'cancel' });
					} catch (err) {
						console.error(`PromptBus: responder cancel fallito per richiesta ${requestId}`, err);
						cancelSuccess = false;
					}
					if (!cancelSuccess) {
						return false;
					}
				}

				request.status = 'cancelled';
				request.resolvedAt = Date.now();

				this.saveToStorage();
				void this.broadcastFn(PROMPT_BUS_EVENTS.CANCELLED, { requestId });
				this.notifySubscribers();
				return true;
			} finally {
				this.resolvingRequests.delete(requestId);
			}
		}

		// Secondaria senza responder locale: request/ack verso l'owner
		this.resolvingRequests.add(requestId);
		const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		try {
			const { promise: ackPromise, resolve } = Promise.withResolvers<{ ok: boolean; error?: string }>();
			const timer = setTimeout(() => {
				this.pendingAcks.delete(nonce);
				resolve({ ok: false, error: 'timeout' });
			}, 10_000);
			this.pendingAcks.set(nonce, (result) => {
				clearTimeout(timer);
				this.pendingAcks.delete(nonce);
				resolve(result);
			});

			await this.broadcastFn(PROMPT_BUS_CANCEL_REQUEST_EVENT, {
				nonce,
				requestId,
				target
			});

			const ack = await ackPromise;
			if (!ack.ok) {
				return false;
			}

			request.status = 'cancelled';
			request.resolvedAt = Date.now();
			this.saveToStorage();
			this.notifySubscribers();
			return true;
		} finally {
			this.resolvingRequests.delete(requestId);
		}
	}

	/**
	 * Restituisce l'elenco di tutte le richieste attualmente pendenti.
	 */
	getPendings(): PromptRequest[] {
		const list: PromptRequest[] = [];
		for (const req of this.requests.values()) {
			if (req.status === 'pending') {
				list.push(req);
			}
		}
		return list;
	}

	/**
	 * Restituisce le richieste pendenti associate a un determinato progetto.
	 */
	getPendingsForProject(projectId: string): PromptRequest[] {
		const pKey = projectId.trim().toLowerCase();
		return this.getPendings().filter(
			(r) => r.projectId.trim().toLowerCase() === pKey
		);
	}

	/**
	 * Restituisce le richieste pendenti associate a una determinata corsia di un progetto.
	 */
	getPendingsForLane(projectId: string, laneId: string): PromptRequest[] {
		const pKey = projectId.trim().toLowerCase();
		const lKey = laneId.trim().toLowerCase();
		return this.getPendings().filter(
			(r) =>
				r.projectId.trim().toLowerCase() === pKey &&
				(r.laneId ?? 'main').trim().toLowerCase() === lKey
		);
	}

	/**
	 * Restituisce la richiesta identificata da `requestId`, se presente.
	 */
	getRequest(requestId: string): PromptRequest | undefined {
		return this.requests.get(requestId);
	}

	/**
	 * Controlla se una determinata richiesta e' attualmente pendente.
	 */
	hasPending(requestId: string): boolean {
		return this.requests.get(requestId)?.status === 'pending';
	}

	/**
	 * Riaggancia o aggiorna il responder locale su una richiesta (es. dopo reload o riapertura).
	 */
	attachResponder(
		requestId: string,
		responder: (answer: PromptAnswer) => Promise<boolean>
	): boolean {
		const request = this.requests.get(requestId);
		if (!request || request.status !== 'pending') return false;
		request.responder = responder;
		return true;
	}

	/**
	 * Aggiorna la bozza di compilazione di un modulo `ask`.
	 * Mantiene la bozza in memoria e la diffonde live alle finestre senza salvare
	 * i payload base64 pesanti nello storage locale.
	 */
	updateFormDraft(requestId: string, draft: AskFormDraft): void {
		if (!requestId || !draft) return;
		const copied = copyAskFormDraft(draft);
		this.formDrafts.set(requestId, copied);

		const req = this.requests.get(requestId);
		if (req) {
			req.formDraft = copied;
		}

		this.saveToStorage();

		void this.broadcastFn(PROMPT_BUS_DRAFT_EVENT, {
			requestId,
			draft: copied,
			owner: req?.owner ?? null
		});

		this.notifySubscribers();
	}

	/**
	 * Recupera la bozza di compilazione corrente per una richiesta form.
	 */
	getFormDraft(requestId: string): AskFormDraft | undefined {
		if (!requestId) return undefined;
		const memDraft = this.formDrafts.get(requestId);
		if (memDraft) return copyAskFormDraft(memDraft);
		const reqDraft = this.requests.get(requestId)?.formDraft;
		if (reqDraft) return copyAskFormDraft(reqDraft);
		const formDraft = this.requests.get(requestId)?.form?.draft;
		if (formDraft) return copyAskFormDraft(formDraft);
		return undefined;
	}

	private handleRemoteDraftUpdate(
		requestId: string,
		draft: AskFormDraft,
		owner?: string | null
	): void {
		if (!requestId || !draft) return;
		const req = this.requests.get(requestId);
		if (req) {
			if (owner && req.owner && req.owner !== owner) return;
			req.formDraft = copyAskFormDraft(draft);
		}
		this.formDrafts.set(requestId, copyAskFormDraft(draft));
		this.notifySubscribers();
	}

	/**
	 * Annulla e ripulisce le richieste pendenti, facoltativamente per un singolo progetto.
	 */
	clearPendings(projectId?: string): void {
		const targetProject = projectId?.trim().toLowerCase();
		let changed = false;

		for (const req of this.requests.values()) {
			if (req.status === 'pending') {
				if (!targetProject || req.projectId.trim().toLowerCase() === targetProject) {
					req.status = 'cancelled';
					req.resolvedAt = Date.now();
					changed = true;
				}
			}
		}

		if (changed) {
			this.saveToStorage();
			this.notifySubscribers();
		}
	}

	/**
	 * Marca `expired` le pendenti ripristinate dallo storage e lo annuncia alle
	 * altre finestre, che le hanno lette dallo stesso storage.
	 */
	private expireRestored(): void {
		const expired: string[] = [];
		for (const req of this.requests.values()) {
			if (req.status !== 'pending') continue;
			req.status = 'expired';
			req.resolvedAt = Date.now();
			expired.push(req.requestId);
		}
		if (expired.length === 0) return;
		this.saveToStorage();
		for (const requestId of expired) {
			void this.broadcastFn(PROMPT_BUS_EVENTS.CANCELLED, { requestId }).catch(() => {});
		}
		this.notifySubscribers();
	}

	/**
	 * Sottoscrizione alle modifiche delle richieste pendenti.
	 * Compatibile con il contratto Store di Svelte.
	 */
	subscribe(fn: (pendings: PromptRequest[]) => void): () => void {
		this.subscribers.add(fn);
		fn(this.getPendings());
		return () => {
			this.subscribers.delete(fn);
		};
	}

	/**
	 * Diffonde lo snapshot corrente delle richieste pendenti alle altre finestre.
	 */
	broadcastSync(): void {
		const pendings = this.getPendings().map((r) => this.serialize(r));
		void this.broadcastFn(PROMPT_BUS_EVENTS.SYNC_RESPONSE, pendings);
	}

	/* ---------------------------------------------------------------- Interni */

	private notifySubscribers(): void {
		const current = this.getPendings();
		for (const sub of this.subscribers) {
			try {
				sub(current);
			} catch (err) {
				console.error('PromptBus: errore subscriber', err);
			}
		}
	}

	private serialize(request: PromptRequest, forStorage = false): SerializedPromptRequest {
		const { responder: _, ...rest } = request;
		if (forStorage) {
			let serializedFormDraft = rest.formDraft;
			if (serializedFormDraft) {
				serializedFormDraft = {
					...serializedFormDraft,
					annotations: serializedFormDraft.annotations.map((ann) => ({
						...ann,
						images: []
					}))
				};
			}
			let serializedForm = rest.form;
			if (serializedForm?.draft) {
				serializedForm = {
					...serializedForm,
					draft: {
						...serializedForm.draft,
						annotations: serializedForm.draft.annotations.map((ann) => ({
							...ann,
							images: []
						}))
					}
				};
			}
			return {
				...rest,
				form: serializedForm,
				formDraft: serializedFormDraft
			};
		}
		return rest;
	}

	private broadcastRegistration(request: PromptRequest): void {
		void this.broadcastFn(PROMPT_BUS_EVENTS.REGISTERED, this.serialize(request));
	}

	private handleRemoteRegistration(serialized: SerializedPromptRequest): void {
		if (!serialized?.requestId || !serialized?.projectId) return;

		const existing = this.requests.get(serialized.requestId);
		if (existing) {
			if (existing.status !== 'pending') return;
			const enriched: PromptRequest = {
				...existing,
				laneId: serialized.laneId !== undefined ? serialized.laneId : existing.laneId,
				toolCallId: serialized.toolCallId ?? existing.toolCallId,
				method: serialized.method ?? existing.method,
				questions: serialized.questions ?? existing.questions,
				questionIndex: serialized.questionIndex ?? existing.questionIndex,
				totalQuestions: serialized.totalQuestions ?? existing.totalQuestions,
				optionDetails: serialized.optionDetails ?? existing.optionDetails,
				options: serialized.options ?? existing.options,
				placeholder: serialized.placeholder ?? existing.placeholder,
				prefill: serialized.prefill ?? existing.prefill,
				deadline: serialized.deadline ?? existing.deadline,
				message: serialized.message ?? existing.message,
				title: serialized.title || existing.title,
				form: serialized.form ?? existing.form,
				formDraft: serialized.formDraft ?? existing.formDraft
			};
			if (serialized.formDraft) {
				this.formDrafts.set(serialized.requestId, copyAskFormDraft(serialized.formDraft));
			}
			this.requests.set(serialized.requestId, enriched);
			this.notifySubscribers();
			return;
		}

		const request: PromptRequest = {
			...serialized,
			status: 'pending'
		};
		if (serialized.formDraft) {
			this.formDrafts.set(serialized.requestId, copyAskFormDraft(serialized.formDraft));
		}
		this.requests.set(serialized.requestId, request);
		this.saveToStorage();
		this.notifySubscribers();
	}

	private handleRemoteResolution(requestId: string, answer: PromptAnswer): void {
		const request = this.requests.get(requestId);
		if (!request || request.status !== 'pending') {
			return;
		}
		request.status = 'resolved';
		request.resolvedAt = Date.now();
		request.answer = answer;
		this.saveToStorage();
		this.notifySubscribers();
	}

	private handleRemoteCancellation(requestId: string): void {
		const request = this.requests.get(requestId);
		if (!request || request.status !== 'pending') {
			return;
		}
		request.status = 'cancelled';
		request.resolvedAt = Date.now();
		this.saveToStorage();
		this.notifySubscribers();
	}

	private async handleRemoteResolveRequest(payload: {
		nonce: string;
		requestId: string;
		answer: PromptAnswer;
		target?: PromptTargetFilter;
	}): Promise<void> {
		if (!payload?.nonce || !payload?.requestId) return;
		const { nonce, requestId, answer, target } = payload;
		const request = this.requests.get(requestId);
		if (!request || !request.responder) return;
		if (request.status !== 'pending' || this.resolvingRequests.has(requestId) || !this.matchesTarget(request, target)) {
			void this.broadcastFn(PROMPT_BUS_RESOLVE_ACK_EVENT, { nonce, requestId, ok: false });
			return;
		}

		this.resolvingRequests.add(requestId);
		let success = false;
		try {
			success = await request.responder(answer);
		} catch (err) {
			console.error(`PromptBus: responder fallito su resolve-request ${requestId}`, err);
			success = false;
		} finally {
			this.resolvingRequests.delete(requestId);
		}

		if (success) {
			request.status = 'resolved';
			request.resolvedAt = Date.now();
			request.answer = answer;
			this.saveToStorage();
			void this.broadcastFn(PROMPT_BUS_RESOLVE_ACK_EVENT, { nonce, requestId, ok: true });
			void this.broadcastFn(PROMPT_BUS_EVENTS.RESOLVED, {
				requestId,
				answer: normalizePromptAnswer(answer)
			});
			this.notifySubscribers();
		} else {
			void this.broadcastFn(PROMPT_BUS_RESOLVE_ACK_EVENT, { nonce, requestId, ok: false });
		}
	}

	private handleRemoteResolveAck(payload: { nonce: string; requestId: string; ok: boolean; error?: string }): void {
		if (!payload?.nonce) return;
		const cb = this.pendingAcks.get(payload.nonce);
		if (cb) {
			cb(payload);
		}
	}

	private async handleRemoteCancelRequest(payload: {
		nonce: string;
		requestId: string;
		target?: PromptTargetFilter;
	}): Promise<void> {
		if (!payload?.nonce || !payload?.requestId) return;
		const { nonce, requestId, target } = payload;
		const request = this.requests.get(requestId);
		if (!request || !request.responder) return;
		if (request.status !== 'pending' || this.resolvingRequests.has(requestId) || !this.matchesTarget(request, target)) {
			void this.broadcastFn(PROMPT_BUS_CANCEL_ACK_EVENT, { nonce, requestId, ok: false });
			return;
		}

		this.resolvingRequests.add(requestId);
		let success = false;
		try {
			success = await request.responder({ action: 'cancel' });
		} catch (err) {
			console.error(`PromptBus: responder cancel fallito su cancel-request ${requestId}`, err);
			success = false;
		} finally {
			this.resolvingRequests.delete(requestId);
		}

		if (success) {
			request.status = 'cancelled';
			request.resolvedAt = Date.now();
			this.saveToStorage();
			void this.broadcastFn(PROMPT_BUS_CANCEL_ACK_EVENT, { nonce, requestId, ok: true });
			void this.broadcastFn(PROMPT_BUS_EVENTS.CANCELLED, { requestId });
			this.notifySubscribers();
		} else {
			void this.broadcastFn(PROMPT_BUS_CANCEL_ACK_EVENT, { nonce, requestId, ok: false });
		}
	}

	private handleRemoteCancelAck(payload: { nonce: string; requestId: string; ok: boolean; error?: string }): void {
		if (!payload?.nonce) return;
		const cb = this.pendingAcks.get(payload.nonce);
		if (cb) {
			cb(payload);
		}
	}

	private matchesTarget(request: PromptRequest, target?: PromptTargetFilter): boolean {
		if (!target) return true;
		if (target.projectId && request.projectId.trim().toLowerCase() !== target.projectId.trim().toLowerCase()) {
			return false;
		}
		if (target.laneId && (request.laneId ?? 'main').trim().toLowerCase() !== target.laneId.trim().toLowerCase()) {
			return false;
		}
		if (target.sessionId && request.sessionId && request.sessionId !== target.sessionId) {
			return false;
		}
		return true;
	}

	private handleRemoteSync(pendings: SerializedPromptRequest[]): void {
		if (!Array.isArray(pendings)) return;
		let changed = false;

		for (const item of pendings) {
			if (!item?.requestId || !item?.projectId) continue;
			const existing = this.requests.get(item.requestId);
			if (!existing) {
				this.requests.set(item.requestId, { ...item, status: 'pending' });
				changed = true;
			} else if (existing.status === 'pending') {
				let updated: PromptRequest = { ...existing };
				let itemChanged = false;
				if (item.questions && (!existing.questions || existing.questions.length === 0)) {
					updated = {
						...updated,
						laneId: item.laneId !== undefined ? item.laneId : existing.laneId,
						questions: item.questions,
						questionIndex: item.questionIndex ?? existing.questionIndex,
						totalQuestions: item.totalQuestions ?? existing.totalQuestions,
						toolCallId: item.toolCallId ?? existing.toolCallId
					};
					itemChanged = true;
				}
				if (item.form && !existing.form) {
					updated = {
						...updated,
						method: item.method ?? updated.method,
						form: item.form,
						formDraft: item.formDraft ?? updated.formDraft
					};
					itemChanged = true;
				}
				if (item.formDraft && !this.formDrafts.has(item.requestId)) {
					this.formDrafts.set(item.requestId, copyAskFormDraft(item.formDraft));
					updated.formDraft = copyAskFormDraft(item.formDraft);
					itemChanged = true;
				}
				if (itemChanged) {
					this.requests.set(item.requestId, updated);
					changed = true;
				}
			}
		}
		if (changed) {
			this.saveToStorage();
			this.notifySubscribers();
		}
	}

	private saveToStorage(): void {
		try {
			const pendings = this.getPendings().map((r) => this.serialize(r, true));
			if (pendings.length === 0) {
				this.storage.removeItem(this.storageKey);
			} else {
				this.storage.setItem(this.storageKey, JSON.stringify(pendings));
			}
		} catch (err) {
			console.warn('PromptBus: salvataggio su storage fallito', err);
		}
	}

	private restoreFromStorage(): void {
		try {
			const raw = this.storage.getItem(this.storageKey);
			if (!raw) return;
			const list = JSON.parse(raw);
			if (!Array.isArray(list)) return;

			const now = Date.now();
			for (const item of list) {
				if (!item?.requestId || !item?.projectId) continue;
				// Scarta elementi troppo vecchi o con deadline superata
				if (item.createdAt && now - item.createdAt > MAX_PROMPT_AGE_MS) continue;
				if (item.deadline && now > item.deadline + 60_000) continue;

				if (!this.requests.has(item.requestId)) {
					const req: PromptRequest = {
						...item,
						status: 'pending'
					};
					this.requests.set(item.requestId, req);
					if (item.formDraft) {
						this.formDrafts.set(item.requestId, copyAskFormDraft(item.formDraft));
					}
				}
			}
		} catch (err) {
			console.warn('PromptBus: recupero da storage fallito', err);
		}
	}
}

/**
 * Una risposta arrivata dal bus (Companion, altra superficie) puo' riaprire
 * la richiesta nella sessione solo se e' ancora aperta e appartiene davvero a
 * lei. Senza questi controlli un `cancel` partito dalla sessione stessa
 * tornava indietro dal bus, riapriva la domanda appena chiusa e la
 * rispediva a omp come eco; e una voce di un'altra chat della stessa corsia
 * prendeva il posto della domanda viva.
 */
export function canRestorePrompt(
	stored: Pick<PromptRequest, 'status' | 'projectId' | 'laneId' | 'sessionId' | 'requestId'>,
	session: { projectKey: string; laneId: string | null; sessionId: string | null; livePendingId: string | null }
): boolean {
	if (stored.status !== 'pending') return false;
	if (stored.projectId.trim().toLowerCase() !== session.projectKey.trim().toLowerCase()) return false;
	if ((stored.laneId ?? 'main').toLowerCase() !== (session.laneId ?? 'main').toLowerCase()) return false;
	if (stored.sessionId && session.sessionId && stored.sessionId !== session.sessionId) return false;
	if (session.livePendingId !== null && session.livePendingId !== stored.requestId) return false;
	return true;
}

/** Istanza globale condivisa di PromptBus per il runtime corrente */
export const promptBus = new PromptBus({ expireRestored: windowLabel === 'main' });
