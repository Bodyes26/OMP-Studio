// Store reattivo di presenza desktop (Svelte 5): area di notifica (system tray),
// criteri di chiusura, prevenzione uscite accidentali con lavori attivi e avvio automatico.
//
// Conforme ai requisiti:
// - AUT-054: Scelta prima chiusura (Nascondi vs Esci) con opzione di memorizzazione; minimizzazione distinta.
// - AUT-055: Lavori in background e automazioni continuano da nascosto; Companion intatta.
// - AUT-056: Autostart al login disattivato di default, visibile o nascosto, nessuna dipendenza da PowerShell.
// - AUT-057: Menu essenziale (Stato, Apri, Automazioni, Attenzione, Esci).
// - AUT-058 / AUT-084: Fallback sicuro, gestione macOS Dock (Accessory quando nascosto, Regular al ripristino).
// - Intercettazione di chiusura ed uscita; annullamento uscita non uccide alcun processo.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { automationsStore } from './store.svelte.ts';
import { getLocale } from '#lib/automations/i18n.ts';

export type CloseAction = 'ask' | 'hide' | 'quit';
export type DesktopPlatform = 'windows' | 'macos' | 'linux';

export interface DesktopPresenceSettings {
	closeAction: CloseAction;
	rememberCloseAction: boolean;
	autostartEnabled: boolean;
	autostartStartHidden: boolean;
}

export interface DesktopPresenceState extends DesktopPresenceSettings {
	trayAvailable: boolean;
	activeAutomationsCount: number;
	activeInteractiveCount: number;
	attention: boolean;
	platform: DesktopPlatform;
	mainWindowVisible: boolean;
}

export interface ActiveJobsSummary {
	totalJobs: number;
	automationJobs: number;
	interactiveJobs: number;
}

export interface CloseRequestOutcome {
	action: 'hidden' | 'ask' | 'confirm_exit' | 'quit';
	totalJobs: number;
	automationJobs: number;
	interactiveJobs: number;
}

export interface ExitRequestOutcome {
	requiresConfirmation: boolean;
	totalJobs: number;
	automationJobs: number;
	interactiveJobs: number;
}

export class DesktopPresenceStore {
	state = $state<DesktopPresenceState>({
		closeAction: 'ask',
		rememberCloseAction: false,
		autostartEnabled: false,
		autostartStartHidden: true,
		trayAvailable: false,
		activeAutomationsCount: 0,
		activeInteractiveCount: 0,
		attention: false,
		platform: typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
			? 'macos'
			: typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)
				? 'windows'
				: 'linux',
		mainWindowVisible: true
	});

	loading = $state<boolean>(false);
	error = $state<string | null>(null);

	// Controlli di visualizzazione dei dialoghi
	showCloseDialog = $state<boolean>(false);
	showExitDialog = $state<boolean>(false);
	pendingExitJobs = $state<ActiveJobsSummary | null>(null);

	private unlistenFns: UnlistenFn[] = [];
	private exitApprovalResolvers: Array<(approved: boolean) => void> = [];
	private beforeExitCallback: (() => Promise<void>) | null = null;
	private closeRequestInFlight = false;
	private initialized = false;
	async init(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		this.loading = true;

		try {
			const s = await invoke<DesktopPresenceState>('desktop_presence_get_state');
			this.state = s;
			this.error = null;
		} catch (err) {
			console.warn('[DesktopPresence] Impossibile recuperare stato iniziale:', err);
			this.error = String(err);
		} finally {
			this.loading = false;
		}

		try {
			// Allinea la lingua nativa del menu tray con il locale di Studio
			const currentLocale = getLocale();
			await invoke('desktop_presence_set_locale', { locale: currentLocale });
		} catch (err) {
			console.warn('[DesktopPresence] Errore sync locale tray:', err);
		}

		try {
			const unlistenNativeClose = await listen('desktop-presence://native-close-requested', async () => {
				await this.handleCloseRequest();
			});
			this.unlistenFns.push(unlistenNativeClose);

			const unlistenCloseReq = await listen<{
				trayAvailable: boolean;
				totalJobs: number;
				automationJobs: number;
				interactiveJobs: number;
			}>('desktop-presence://close-requested', (event) => {
				if (event.payload) {
					this.state.trayAvailable = event.payload.trayAvailable;
				}
				this.showCloseDialog = true;
				this.showExitDialog = false;
			});
			this.unlistenFns.push(unlistenCloseReq);

			const unlistenExitReq = await listen<ActiveJobsSummary>('desktop-presence://exit-requested', async (event) => {
				let jobs = event.payload;
				if (!jobs || typeof jobs.totalJobs !== 'number') {
					jobs = await this.getActiveJobs();
				}
				if (jobs.totalJobs > 0) {
					this.pendingExitJobs = jobs;
					this.showExitDialog = true;
					this.showCloseDialog = false;
				} else {
					// A zero lavori: esegue prima il hook prima dell'uscita e solo se ha successo termina
					this.showExitDialog = false;
					this.showCloseDialog = false;
					await this.confirmExit(true);
				}
			});
			this.unlistenFns.push(unlistenExitReq);

			const unlistenAttention = await listen<{ attention: boolean }>(
				'desktop-presence://attention-changed',
				(event) => {
					this.state.attention = Boolean(event.payload?.attention);
				}
			);
			this.unlistenFns.push(unlistenAttention);

			const unlistenShown = await listen('desktop-presence://window-shown', () => {
				this.state.mainWindowVisible = true;
			});
			this.unlistenFns.push(unlistenShown);

			const unlistenHidden = await listen('desktop-presence://window-hidden', () => {
				this.state.mainWindowVisible = false;
			});
			this.unlistenFns.push(unlistenHidden);

			const unlistenNavigate = await listen('desktop-presence://navigate-automations', () => {
				try {
					automationsStore.open();
				} catch {
					window.dispatchEvent(new CustomEvent('omp-navigate-automations'));
				}
			});
			this.unlistenFns.push(unlistenNavigate);
		} catch (err) {
			console.error('[DesktopPresence] Errore registrazione listener eventi:', err);
		}
	}

	destroy(): void {
		for (const unlisten of this.unlistenFns) {
			try {
				unlisten();
			} catch (err) {
				console.error('[DesktopPresence] Errore unlisten:', err);
			}
		}
		this.unlistenFns = [];
		this.initialized = false;
	}

	async refresh(): Promise<void> {
		try {
			const s = await invoke<DesktopPresenceState>('desktop_presence_get_state');
			this.state = s;
			this.error = null;
		} catch (err) {
			this.error = String(err);
		}
	}

	/**
	 * Invocato da +page.svelte su onCloseRequested.
	 * Intercetta la chiusura nativa e determina se nascondere nella tray,
	 * mostrare il dialogo di prima chiusura o mostrare la conferma di uscita per lavori attivi.
	 */
	async handleCloseRequest(): Promise<void> {
		if (this.closeRequestInFlight) return;
		this.closeRequestInFlight = true;
		try {
			const outcome = await invoke<CloseRequestOutcome>('desktop_presence_request_close');
			if (outcome.action === 'hidden') {
				this.showCloseDialog = false;
				this.showExitDialog = false;
				this.state.mainWindowVisible = false;
				return;
			}
			if (outcome.action === 'ask') {
				this.showCloseDialog = true;
				this.showExitDialog = false;
				return;
			}
			if (outcome.action === 'confirm_exit') {
				this.pendingExitJobs = {
					totalJobs: outcome.totalJobs,
					automationJobs: outcome.automationJobs,
					interactiveJobs: outcome.interactiveJobs
				};
				this.showExitDialog = true;
				this.showCloseDialog = false;
				return;
			}
			if (outcome.action === 'quit') {
				await this.confirmExit(true);
			}
		} catch (err) {
			console.error('[DesktopPresence] Errore richiesta chiusura:', err);
		} finally {
			this.closeRequestInFlight = false;
		}
	}

	/**
	 * Invocato da flussi di uscita espliciti (menu di sistema, Cmd+Q, tray).
	 * Se ci sono lavori in corso, richiede conferma all'utente.
	 * Restituisce true se l'uscita puo' procedere immediatamente.
	 */
	async handleExitRequest(): Promise<boolean> {
		try {
			const outcome = await invoke<ExitRequestOutcome>('desktop_presence_request_exit');
			if (outcome.requiresConfirmation) {
				this.pendingExitJobs = {
					totalJobs: outcome.totalJobs,
					automationJobs: outcome.automationJobs,
					interactiveJobs: outcome.interactiveJobs
				};
				this.showExitDialog = true;
				return false;
			}
			await this.confirmExit(true);
			return true;
		} catch (err) {
			console.error('[DesktopPresence] Errore richiesta uscita:', err);
			return false;
		}
	}

	/**
	 * Registra un callback asincrono da eseguire prima di qualsiasi uscita effettiva
	 * e prima che authorizeExit() si risolva positivamente (es. persistWorkBeforeQuit del parent).
	 */
	setBeforeExit(callback: () => Promise<void>): void {
		this.beforeExitCallback = callback;
	}

	/**
	 * Allinea la lingua del menu contestuale nativo (tray) al cambio di lingua.
	 */
	async setLocale(locale: string): Promise<void> {
		try {
			await invoke('desktop_presence_set_locale', { locale });
		} catch (err) {
			console.error('[DesktopPresence] Errore impostazione locale tray:', err);
		}
	}

	async authorizeExit(_reason?: string): Promise<boolean> {
		try {
			const outcome = await invoke<ExitRequestOutcome>('desktop_presence_prepare_exit');
			if (!outcome.requiresConfirmation) {
				if (this.beforeExitCallback) {
					try {
						await this.beforeExitCallback();
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						this.error = `Impossibile completare il salvataggio prima dell'uscita: ${msg}`;
						console.error('[DesktopPresence] Autorizzazione uscita bloccata per errore in beforeExit:', err);
						return false;
					}
				}
				return true;
			}
			this.pendingExitJobs = {
				totalJobs: outcome.totalJobs,
				automationJobs: outcome.automationJobs,
				interactiveJobs: outcome.interactiveJobs
			};
			this.showExitDialog = true;
			const { promise, resolve } = Promise.withResolvers<boolean>();
			this.exitApprovalResolvers.push(resolve);
			return promise;
		} catch (err) {
			console.error('[DesktopPresence] Errore autorizzazione uscita:', err);
			return false;
		}
	}

	/**
	 * Revoca esplicitamente l'autorizzazione di uscita pregressa (ad es. se l'installazione
	 * dell'aggiornamento o il lancio dell'eseguibile fallisce): garantisce che successive
	 * richieste di uscita non bypassino le necessarie conferme.
	 */
	async revokeExitAuthorization(): Promise<void> {
		try {
			await invoke('desktop_presence_authorize_exit', { allow: false });
		} catch (err) {
			console.error('[DesktopPresence] Errore revoca autorizzazione uscita:', err);
		}
	}

	/**
	 * Risposta dell'utente al dialogo di prima chiusura (Nascondi vs Esci).
	 */
	async confirmCloseChoice(action: 'hide' | 'quit', remember: boolean): Promise<void> {
		this.showCloseDialog = false;
		if (action === 'hide') {
			try {
				await invoke('desktop_presence_respond_close', { action, remember });
				await this.refresh();
			} catch (err) {
				console.error('[DesktopPresence] Errore conferma scelta chiusura:', err);
			}
		} else if (action === 'quit') {
			try {
				await invoke('desktop_presence_respond_close', { action, remember });
			} catch (err) {
				console.error('[DesktopPresence] Errore salvataggio preferenza:', err);
			}
			const jobs = await this.getActiveJobs();
			if (jobs.totalJobs > 0) {
				this.pendingExitJobs = jobs;
				this.showExitDialog = true;
			} else {
				await this.confirmExit(true);
			}
		}
	}

	/**
	 * Annullamento del dialogo di prima chiusura: la finestra rimane aperta senza modifiche.
	 */
	async cancelCloseChoice(): Promise<void> {
		this.showCloseDialog = false;
		try {
			await invoke('desktop_presence_respond_close', { action: 'cancel', remember: false });
		} catch (err) {
			console.error('[DesktopPresence] Errore annulla scelta chiusura:', err);
		}
	}

	/**
	 * Conferma dell'uscita: se chiamata da authorizeExit() pre-autorizza il restart nativo
	 * senza forzare exit(0); se chiamata direttamente (directQuit=true) termina l'app.
	 */
	async confirmExit(directQuit = false): Promise<void> {
		this.showExitDialog = false;
		this.pendingExitJobs = null;
		const resolvers = this.exitApprovalResolvers.splice(0);

		// Eseguiamo il salvataggio registrato (persistWorkBeforeQuit) prima di procedere
		if (this.beforeExitCallback) {
			try {
				await this.beforeExitCallback();
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				this.error = `Impossibile completare il salvataggio prima dell'uscita: ${msg}`;
				console.error('[DesktopPresence] Uscita bloccata per errore in beforeExit:', err);
				// Blocca l'uscita: risolve le promesse pendenti con false senza uscire
				for (const resolve of resolvers) resolve(false);
				return;
			}
		}
		try {
			if (resolvers.length > 0 && !directQuit) {
				// Pre-autorizziamo la successiva uscita senza forzare app.exit(0)
				await invoke('desktop_presence_authorize_exit', { allow: true });
				for (const resolve of resolvers) resolve(true);
			} else {
				// Uscita definitiva standard
				await invoke('desktop_presence_respond_exit', { confirm: true });
				for (const resolve of resolvers) resolve(true);
			}
		} catch (err) {
			console.error('[DesktopPresence] Errore conferma uscita:', err);
			for (const resolve of resolvers) resolve(false);
		}
	}

	/**
	 * Annullamento dell'uscita: nessun processo viene killato, tutti i lavori continuano normalmente.
	 */
	async cancelExit(): Promise<void> {
		this.showExitDialog = false;
		this.pendingExitJobs = null;
		const resolvers = this.exitApprovalResolvers.splice(0);
		try {
			await invoke('desktop_presence_authorize_exit', { allow: false });
		} catch (err) {
			console.error('[DesktopPresence] Errore annullamento uscita:', err);
		}
		for (const resolve of resolvers) resolve(false);
	}

	/**
	 * Aggiorna le preferenze di presenza (es. dalle Impostazioni di Studio).
	 */
	async updateSettings(partial: Partial<DesktopPresenceSettings>): Promise<void> {
		try {
			const payload: DesktopPresenceSettings = {
				closeAction: partial.closeAction ?? this.state.closeAction,
				rememberCloseAction: partial.rememberCloseAction ?? this.state.rememberCloseAction,
				autostartEnabled: partial.autostartEnabled ?? this.state.autostartEnabled,
				autostartStartHidden: partial.autostartStartHidden ?? this.state.autostartStartHidden
			};
			const newState = await invoke<DesktopPresenceState>('desktop_presence_update_settings', {
				settings: payload
			});
			this.state = newState;
		} catch (err) {
			console.error('[DesktopPresence] Errore aggiornamento impostazioni:', err);
			throw err;
		}
	}

	async showMainWindow(): Promise<void> {
		try {
			await invoke('desktop_presence_show_main');
			this.state.mainWindowVisible = true;
		} catch (err) {
			console.error('[DesktopPresence] Errore visualizzazione finestra:', err);
		}
	}

	async hideMainWindow(): Promise<void> {
		try {
			await invoke('desktop_presence_hide_main');
			this.state.mainWindowVisible = false;
		} catch (err) {
			console.error('[DesktopPresence] Errore occultamento finestra:', err);
		}
	}

	async openAutomations(): Promise<void> {
		try {
			await invoke('desktop_presence_open_automations');
		} catch (err) {
			console.error('[DesktopPresence] Errore apertura automazioni:', err);
		}
	}

	async setAttention(attention: boolean): Promise<void> {
		try {
			await invoke('desktop_presence_set_attention', { attention });
			this.state.attention = attention;
		} catch (err) {
			console.error('[DesktopPresence] Errore impostazione attenzione:', err);
		}
	}

	async getActiveJobs(): Promise<ActiveJobsSummary> {
		try {
			return await invoke<ActiveJobsSummary>('desktop_presence_get_active_jobs');
		} catch (err) {
			console.error('[DesktopPresence] Errore recupero lavori attivi:', err);
			return {
				totalJobs: 0,
				automationJobs: 0,
				interactiveJobs: 0
			};
		}
	}
}

export const presenceStore = new DesktopPresenceStore();

