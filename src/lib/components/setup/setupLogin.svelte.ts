/**
 * Login dei provider nel passo Provider del setup (SET-011, SET-040).
 *
 * Perché un processo a parte: il setup gira spesso prima che Studio abbia una
 * sessione, quindi non c'è un client RPC a cui appoggiarsi. Se ne apre uno
 * dedicato e senza sessione (`open('', null)` → `--no-session`), si usa solo
 * per `get_login_providers` e `login`, e si chiude quando il passo sparisce.
 *
 * Due vie, una per tipo di provider:
 * - RPC: omp manda `open_url` (si apre il browser con la verifica dei protocolli
 *   di `session.svelte.ts`) e `input` (campo «Incolla il codice»). Questo copre
 *   OAuth con codice e i provider a chiave che chiedono un solo valore.
 * - Terminale: quando omp risponde «requires secret input» o «requires
 *   interactive prompts» in RPC non c'è modo di andare avanti, e serve
 *   `omp login <id>` in un vero PTY (KeyLoginTerminal.svelte).
 *
 * Un solo login per volta: il processo è uno, gli eventi non portano il
 * provider con sé, quindi due flussi aperti insieme si confonderebbero. Chi
 * avvia il secondo annulla il primo, che è anche quello che l'utente si aspetta
 * cliccando un'altra tessera.
 */
import { OmpRpcClient } from '#lib/agent/client.ts';
import type { AgentSessionEvent, LoginProviderInfo } from '#lib/agent/wire.ts';
import { isAllowedExternalUrl } from '#lib/utils/externalUrl.ts';
import { openExternalUrl } from '#lib/utils/openExternal.ts';
import {
	modelSettingsStore,
	OAUTH_PROVIDER_ALIASES,
	type AuthAccount
} from '#lib/stores/modelSettings.svelte.ts';

export type LoginStatus = 'idle' | 'waiting' | 'linking' | 'terminal' | 'connected' | 'error' | 'cancelled';

export interface LoginState {
	status: LoginStatus;
	/** Id con cui si è avviato il flusso: dopo un errore la tessera si riprova con questo. */
	id: string | null;
	/** Indirizzo aperto nel browser, mostrato sotto la riga di attesa. */
	url: string | null;
	/** Codice dispositivo da copiare (GitHub Copilot, Kimi Code). */
	deviceCode: string | null;
	/** Domanda di omp in attesa di risposta (`input`): titolo e segnaposto. */
	promptTitle: string | null;
	promptPlaceholder: string | null;
	/** Messaggio d'errore vero, quando il runtime lo dice. */
	error: string | null;
}

const IDLE: LoginState = {
	status: 'idle',
	id: null,
	url: null,
	deviceCode: null,
	promptTitle: null,
	promptPlaceholder: null,
	error: null
};

/** Stato di una tessera già collegata prima che il passo si aprisse. */
const CONNECTED_STATE: LoginState = {
	status: 'connected',
	id: null,
	url: null,
	deviceCode: null,
	promptTitle: null,
	promptPlaceholder: null,
	error: null
};

/** Codice dispositivo `XXXX-XXXX` dentro il testo che manda omp. */
const DEVICE_CODE = /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/;

/** Lunghezza minima perché il codice incollato abbia senso; sotto si è solo
 *  a metà di un incolla e confermare manderebbe a omp una stringa monca. */
export const MIN_CODE_LENGTH = 6;

export class SetupLoginStore {
	/** Provati dal processo: chiave id, valore info di omp. */
	providers = $state<LoginProviderInfo[]>([]);
	providersLoading = $state(true);
	/** Stato per provider, per id di omp. */
	states = $state<Record<string, LoginState>>({});
	/** Ultimo errore d'apertura del processo: senza client il login RPC non parte. */
	openError = $state<string | null>(null);

	private client: OmpRpcClient | null = null;
	private opening: Promise<void> | null = null;
	/** Id del flusso attivo: gli eventi arrivano senza provider, si attribuiscono qui. */
	private activeId: string | null = null;
	/** Richiesta `input` ancora senza risposta: è lì che va il codice incollato. */
	private pendingInputId: string | null = null;
	/** Contatore per scartare le promise di tentativi abbandonati. */
	private attempt = 0;
	private disposed = false;

	/** Id dei provider collegati: account reali più quelli che omp dichiara autenticati. */
	connected = $derived.by(() => {
		const ids = new Set<string>();
		for (const account of modelSettingsStore.authAccounts) {
			ids.add(OAUTH_PROVIDER_ALIASES[account.provider] ?? account.provider);
		}
		for (const provider of this.providers) {
			if (provider.authenticated) ids.add(OAUTH_PROVIDER_ALIASES[provider.id] ?? provider.id);
		}
		// Un login appena riuscito non è ancora nel DB: lo stato locale vale subito.
		for (const [id, state] of Object.entries(this.states)) {
			if (state.status === 'connected') ids.add(id);
		}
		return [...ids];
	});

	/** Account da mostrare sotto il nome della tessera collegata. Gli alias di
	 *  login (`zai-coding-plan`, `openai-codex-device`) salvano sotto il nome
	 *  canonico, ma una tessera può chiedere quello di partenza. */
	accountFor(providerId: string): AuthAccount | null {
		const canonical = OAUTH_PROVIDER_ALIASES[providerId] ?? providerId;
		return (
			modelSettingsStore.authAccounts.find(
				(a) => a.provider === canonical || a.provider === providerId
			) ?? null
		);
	}

	/** Rilegge l'elenco di omp: è lui a dire chi risulta autenticato, e dopo uno
	 *  scollegamento la lista vecchia direbbe ancora di sì. */
	async refreshProviders(): Promise<void> {
		const client = this.client;
		if (!client || !client.isOpen) return;
		this.providers = await client.getLoginProviders().catch(() => this.providers);
	}

	/**
	 * Stato da disegnare per una tessera. Un provider già collegato non ha mai
	 * fatto un login in questa finestra: lo stato locale resta `idle`, ma la
	 * verità è negli account, quindi la tessera deve partire da «Collegato».
	 */
	stateOf(providerId: string): LoginState {
		const local = this.states[providerId];
		if (local && local.status !== 'idle') return local;
		const canonical = OAUTH_PROVIDER_ALIASES[providerId] ?? providerId;
		if (this.connected.includes(canonical) || this.connected.includes(providerId)) {
			return CONNECTED_STATE;
		}
		return local ?? IDLE;
	}

	get hasClient(): boolean {
		return this.client !== null && this.client.isOpen;
	}

	/** Apre il processo e ne legge l'elenco dei provider. Idempotente. */
	ensureOpen(): Promise<void> {
		if (this.opening) return this.opening;
		this.opening = (async () => {
			try {
				const client = new OmpRpcClient();
				this.client = client;
				client.onEvent((event) => this.onEvent(event));
				await client.open('', null);
				if (this.disposed) {
					await client.close().catch(() => {});
					return;
				}
				this.providers = await client.getLoginProviders().catch(() => []);
			} catch (error) {
				this.openError = error instanceof Error ? error.message : String(error);
			} finally {
				this.providersLoading = false;
			}
		})();
		return this.opening;
	}

	/** Rilegge gli account: è l'unica verità su «collegato», perché Studio non
	 *  scrive né legge credenziali da sé. */
	async reloadAccounts(): Promise<void> {
		await modelSettingsStore.loadAccounts();
	}

	/** Chiusura del passo: ferma il flusso in volo e spegne il processo. */
	async close(): Promise<void> {
		this.disposed = true;
		const client = this.client;
		this.client = null;
		this.activeId = null;
		this.pendingInputId = null;
		if (client) await client.close().catch(() => {});
	}

	private set(id: string, patch: Partial<LoginState>): void {
		this.states = { ...this.states, [id]: { ...IDLE, ...this.states[id], ...patch } };
	}

	private onEvent(event: AgentSessionEvent): void {
		if (event.type !== 'extension_ui_request') return;
		const id = this.activeId;
		if (!id) return;
		const method = typeof event.method === 'string' ? event.method : '';
		const requestId = typeof event.id === 'string' ? event.id : null;

		if (method === 'open_url') {
			const target =
				typeof event.launchUrl === 'string'
					? event.launchUrl
					: typeof event.url === 'string'
						? event.url
						: null;
			if (target === null) return;
			this.set(id, { url: target, deviceCode: extractDeviceCode(event, target) });
			if (isAllowedExternalUrl(target)) void openExternalUrl(target);
			return;
		}

		if (method === 'notify') {
			// omp segnala l'avanzamento con un testo libero: si usa solo per il
			// codice dispositivo e per i messaggi d'attesa, non per cambiare stato.
			const text = typeof event.message === 'string' ? event.message : '';
			const code = text.match(DEVICE_CODE)?.[0] ?? null;
			if (code) this.set(id, { deviceCode: code });
			return;
		}

		if (method === 'input' && requestId) {
			const title = typeof event.title === 'string' ? event.title : '';
			const placeholder = typeof event.placeholder === 'string' ? event.placeholder : null;
			if (looksLikeSecretPrompt(title, placeholder)) {
				// Una chiave non passa da un campo della GUI (SET-040): si annulla la
				// richiesta e si continua in un vero `omp login <id>`, dove la chiave
				// resta nascosta e la salva omp.
				void this.client
					?.respondUi({ type: 'extension_ui_response', id: requestId, cancelled: true })
					.catch(() => {});
				this.pendingInputId = null;
				this.set(id, { status: 'terminal', promptTitle: null, promptPlaceholder: null });
				return;
			}
			this.pendingInputId = requestId;
			this.set(id, { status: 'waiting', promptTitle: title || null, promptPlaceholder: placeholder });
		}
	}

	/**
	 * Avvia il flusso per `providerId`. `fallback` è la via da usare quando il
	 * login RPC non è possibile per costruzione (chiave, server locale) o quando
	 * omp lo rifiuta perché vuole un terminale: la decide il chiamante, che sa
	 * quale tessera ha davanti.
	 */
	async start(providerId: string, fallback: 'terminal' | null): Promise<void> {
		// Un flusso alla volta: il precedente viene annullato, non lasciato appeso.
		if (this.activeId && this.activeId !== providerId) this.cancel(this.activeId);
		const attempt = ++this.attempt;
		this.activeId = providerId;
		this.pendingInputId = null;
		this.set(providerId, { ...IDLE, status: 'waiting', id: providerId });

		await this.ensureOpen();
		if (attempt !== this.attempt) return;

		if (fallback === 'terminal') {
			// Provider a chiave o server locale: in RPC omp non li gestisce.
			this.set(providerId, { status: 'terminal' });
			return;
		}
		const client = this.client;
		if (!client || !client.isOpen) {
			this.set(providerId, {
				status: 'error',
				error: this.openError ?? 'runtime'
			});
			return;
		}

		try {
			await client.login(providerId);
			if (attempt !== this.attempt) return;
			if (this.states[providerId]?.status === 'terminal') return;
			await this.markConnected(providerId);
		} catch (error) {
			if (attempt !== this.attempt) return;
			// Il passaggio al terminale annulla la richiesta `input`: l'errore che ne
			// segue è la conseguenza della nostra scelta, non un esito da mostrare.
			if (this.states[providerId]?.status === 'terminal') return;
			const message = error instanceof Error ? error.message : String(error);
			if (/requires secret input|requires interactive prompts/i.test(message)) {
				// omp stesso dice che serve la TUI: la tessera mostra il terminale.
				this.set(providerId, { status: 'terminal' });
				return;
			}
			this.set(providerId, { status: 'error', error: message });
		}
	}

	/** Riapre il browser: una seconda `login` rimanda `open_url` con un URL nuovo. */
	async reopen(providerId: string): Promise<void> {
		await this.start(providerId, null);
	}

	/** Risposta alla domanda `input`: è qui che va il codice incollato. */
	async submitCode(providerId: string, code: string): Promise<void> {
		const requestId = this.pendingInputId;
		const client = this.client;
		const trimmed = code.trim();
		if (!requestId || !client || trimmed.length < MIN_CODE_LENGTH) return;
		this.pendingInputId = null;
		this.set(providerId, { status: 'linking', promptTitle: null, promptPlaceholder: null });
		await client.respondUi({ type: 'extension_ui_response', id: requestId, value: trimmed });
	}

	/** Annulla il flusso: risponde `cancelled` a omp, che smette di attendere. */
	cancel(providerId: string): void {
		const requestId = this.pendingInputId;
		const client = this.client;
		this.pendingInputId = null;
		if (this.activeId === providerId) this.activeId = null;
		if (requestId && client) {
			void client
				.respondUi({ type: 'extension_ui_response', id: requestId, cancelled: true })
				.catch(() => {});
		}
		this.set(providerId, { status: 'cancelled', promptTitle: null, promptPlaceholder: null });
	}

	/** Il terminale si è chiuso: si rilegge lo stato vero, senza indovinare. */
	async finishTerminal(providerId: string): Promise<void> {
		if (this.activeId === providerId) this.activeId = null;
		this.set(providerId, { status: 'idle', id: null });
		await this.ensureOpen();
		await Promise.all([this.reloadAccounts(), this.refreshProviders()]);
		const stillAuthed = this.providers.find((p) => p.id === providerId)?.authenticated === true;
		const hasAccount = modelSettingsStore.authAccounts.some((a) => a.provider === providerId);
		if (stillAuthed || hasAccount) this.markConnectedLocally(providerId);
	}

	private async markConnected(providerId: string): Promise<void> {
		await Promise.all([this.reloadAccounts(), this.refreshProviders()]);
		this.markConnectedLocally(providerId);
	}

	private markConnectedLocally(providerId: string): void {
		if (this.activeId === providerId) this.activeId = null;
		this.set(providerId, {
			status: 'connected',
			id: providerId,
			url: null,
			deviceCode: null,
			promptTitle: null,
			promptPlaceholder: null,
			error: null
		});
	}

	/** Scollega: passa dalla rimozione account già usata dalle Impostazioni. */
	async disconnect(providerId: string): Promise<void> {
		await this.reloadAccounts();
		const canonical = OAUTH_PROVIDER_ALIASES[providerId] ?? providerId;
		const account =
			modelSettingsStore.authAccounts.find((a) => a.provider === canonical) ??
			modelSettingsStore.authAccounts.find((a) => a.provider === providerId);
		if (!account) return;
		await modelSettingsStore.removeAccount(account.provider, account.id);
		// Lo stato locale non basta: senza rileggere omp la tessera resterebbe
		// «collegata» solo perché l'elenco precedente lo diceva.
		await this.refreshProviders();
		const next = { ...this.states };
		delete next[providerId];
		this.states = next;
	}
}

/**
 * La domanda chiede una credenziale segreta invece di un codice o di un URL?
 * omp scrive il testo in chiaro ("Paste your DeepSeek API key", "… API
 * key/token (optional)") mentre per i codici dice "authorization code" o
 * "redirect URL": è l'unico segnale disponibile, e sbagliare costa solo un
 * terminale in più invece di un segreto digitato nella GUI.
 */
function looksLikeSecretPrompt(title: string, placeholder: string | null): boolean {
	const text = `${title} ${placeholder ?? ''}`;
	if (!/key|token|secret|password/i.test(text)) return false;
	if (/code|redirect url|authorization/i.test(text)) return false;
	return true;
}

/** Il codice dispositivo arriva nell'URL (`user_code=`) o nelle istruzioni. */
function extractDeviceCode(event: AgentSessionEvent, url: string): string | null {
	const fromUrl = url.match(/[?&]user_code=([A-Za-z0-9-]{4,16})/)?.[1] ?? null;
	if (fromUrl) return fromUrl.toUpperCase();
	const instructions = typeof event.instructions === 'string' ? event.instructions : '';
	const fromText =
		instructions.match(DEVICE_CODE)?.[0] ??
		(typeof event.message === 'string' ? event.message.match(DEVICE_CODE)?.[0] : null);
	return fromText ?? null;
}

/** Copia negli appunti: usata per il codice dispositivo. */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
