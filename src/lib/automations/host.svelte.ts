/**
 * Host frontend per il coordinamento delle automazioni di OMP Studio.
 *
 * Responsabilità e sequenza di boot (contratto host):
 * 1. Inizializzazione ordinata di automationsStore e runtime AI (startAutomationRuntime);
 * 2. Registrazione preventiva di tutti i listener (project-request, notifiche, presenza)
 *    prima di qualsiasi invio di contesto verso il backend;
 * 3. Bufferizzazione delle richieste progetto arrivate prima della readiness del contesto;
 * 4. Proiezione reattiva continua via $effect.root: attende context non-null da getContext()
 *    e invia il primo updateContext();
 * 5. Solo dopo il primo updateContext() riuscito, svuota il buffer delle richieste precoci e
 *    avvia il recovery di automations_project_pending (saltando deferred);
 * 6. Inoltro notifiche native (Windows via send_project_notification con audio e focus, macOS/Linux via plugin);
 * 7. Click notifica associato all'apertura della run (onOpenRun);
 * 8. Navigazione da DesktopPresence (desktop-presence://navigate-automations);
 * 9. Wrapper eventi agente interattivi (notifyAutomationAgentEvent);
 * 10. Pulizia completa delle risorse e propagazione rigorosa degli errori iniziali.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
	isPermissionGranted,
	requestPermission,
	sendNotification,
	onAction
} from '@tauri-apps/plugin-notification';
import { automationsStore } from './store.svelte.ts';
import { startAutomationRuntime } from './runtime.svelte.ts';
import { settingsStore } from '#lib/stores/settings.svelte.ts';
import { IS_WINDOWS } from '#lib/utils/platform.ts';
import type {
	AutomationContext,
	AutomationEvent,
	AutomationProjectRequest,
	AutomationTriggerKind
} from './types.ts';

export interface AutomationHostOptions {
	/** Restituisce lo snapshot corrente del contesto applicativo, o null se non ancora pronto. */
	getContext: () => AutomationContext | null;
	/** Gestore effettivo per l'apertura o chiusura di un progetto da parte di un'automazione. */
	handleProjectRequest: (request: AutomationProjectRequest) => Promise<void>;
	/** Callback per visualizzare i dettagli di una specifica esecuzione o la schermata generale. */
	onOpenRun: (runId?: string) => void;
}

interface NotificationPayload {
	runId?: string;
	automationId: string;
	automationName?: string;
	title: string;
	body: string;
}

/**
 * Avvia l'host frontend delle automazioni e restituisce la funzione di cleanup completa.
 */
export async function startAutomationHost(options: AutomationHostOptions): Promise<() => void> {
	const unlisteners: Array<() => void> = [];
	let stopRuntime: (() => void) | undefined;
	let cleanupRoot: (() => void) | undefined;

	const doCleanup = () => {
		if (cleanupRoot) {
			try {
				cleanupRoot();
			} catch {}
			cleanupRoot = undefined;
		}
		for (const unlisten of unlisteners.splice(0)) {
			try {
				unlisten();
			} catch {}
		}
		if (stopRuntime) {
			try {
				stopRuntime();
			} catch {}
			stopRuntime = undefined;
		}
	};

	try {
		// 1. Inizializza lo store nativo delle automazioni
		await automationsStore.init();

		// 2. Avvia il runtime AI dedicato alle automazioni
		stopRuntime = await startAutomationRuntime();

		// 3. Stato di readiness del contesto e buffer per richieste arrivate prima del boot
		let isContextReady = false;
		const earlyProjectRequests: AutomationProjectRequest[] = [];
		const inFlightRequests = new Set<string>();
		const handledRequests = new Set<string>();

		async function processProjectRequest(req: AutomationProjectRequest): Promise<void> {
			if (!req || req.status === 'deferred') return;

			// Se il contesto non è ancora pronto, mantieni la richiesta nel buffer
			if (!isContextReady) {
				if (!earlyProjectRequests.some((r) => r.requestId === req.requestId)) {
					earlyProjectRequests.push(req);
				}
				return;
			}

			if (inFlightRequests.has(req.requestId) || handledRequests.has(req.requestId)) {
				return;
			}
			inFlightRequests.add(req.requestId);

			try {
				await options.handleProjectRequest(req);
				handledRequests.add(req.requestId);
				await invoke('automations_project_result', {
					requestId: req.requestId,
					ok: true,
					detail: null
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[AutomationHost] Errore richiesta progetto ${req.requestId}:`, msg);
				automationsStore.error = msg;
				try {
					await invoke('automations_project_result', {
						requestId: req.requestId,
						ok: false,
						detail: msg
					});
				} catch (invokeErr) {
					console.error('[AutomationHost] Invio esito fallito:', invokeErr);
				}
			} finally {
				inFlightRequests.delete(req.requestId);
			}
		}

		// 4. INSTALLA PRIMA TUTTI I LISTENER (project, notification, presence) prima di mandare context al NativeCore

		// A. Listener richieste progetto da backend
		const unlistenReq = await listen<AutomationProjectRequest>(
			'automations://project-request',
			(event) => {
				void processProjectRequest(event.payload);
			}
		);
		unlisteners.push(unlistenReq);

		// B. Listener delle notifiche native emesse dal coordinatore nativo
		const unlistenNotif = await listen<NotificationPayload>(
			'automations://notification',
			async (event) => {
				const payload = event.payload;
				if (!payload || !settingsStore.notifications.enabled) {
					return;
				}

				const title = payload.title || `Automazione ${payload.automationName || payload.automationId}`;
				const body = payload.body || '';

				try {
					if (IS_WINDOWS) {
						// Canale canonico Windows con supporto audio e click nativo
						const projectId = payload.runId ? `automation-run:${payload.runId}` : 'automations';
						await invoke('send_project_notification', {
							projectId,
							title,
							body,
							silent: !settingsStore.notifications.sound,
							test: false
						});
					} else {
						// Canale standard Tauri notification plugin per macOS / Linux
						const hasPermission = await isPermissionGranted();
						const granted = hasPermission || (await requestPermission()) === 'granted';
						if (!granted) return;

						sendNotification({
							title,
							body,
							channelId: 'omp-studio-alerts',
							extra: payload.runId ? { runId: payload.runId } : undefined,
							silent: !settingsStore.notifications.sound
						});
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					console.warn('[AutomationHost] Invio notifica OS non riuscito:', msg);
					automationsStore.error = msg;
				}
			}
		);
		unlisteners.push(unlistenNotif);

		// C. Listener per il click su notifica nativa Windows (studio-focus-project)
		const unlistenFocus = await listen<{ projectId?: string }>('studio-focus-project', (event) => {
			const pid = event.payload?.projectId;
			if (typeof pid === 'string') {
				if (pid.startsWith('automation-run:')) {
					const runId = pid.slice('automation-run:'.length);
					automationsStore.open();
					options.onOpenRun(runId);
				} else if (pid === 'automations') {
					automationsStore.open();
					options.onOpenRun();
				}
			}
		});
		unlisteners.push(unlistenFocus);

		// D. Listener per il click su notifica tramite plugin Tauri (onAction)
		try {
			const actionResult = await onAction((notification) => {
				const extra = notification.extra;
				const runId =
					extra && typeof extra === 'object' && 'runId' in extra && typeof extra.runId === 'string'
						? extra.runId
						: undefined;
				try {
					automationsStore.open();
					options.onOpenRun(runId);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					automationsStore.error = msg;
				}
			});

			if (typeof actionResult === 'function') {
				unlisteners.push(actionResult);
			} else if (actionResult && typeof actionResult === 'object' && 'unregister' in actionResult) {
				const unregisterFn = actionResult.unregister;
				if (typeof unregisterFn === 'function') {
					unlisteners.push(() => {
						unregisterFn.call(actionResult);
					});
				}
			}
		} catch (err) {
			console.debug('[AutomationHost] Handler onAction non disponibile:', err);
		}

		// E. Listener per la navigazione aperta da DesktopPresence / system tray
		const unlistenPresence = await listen('desktop-presence://navigate-automations', () => {
			automationsStore.open();
			options.onOpenRun();
		});
		unlisteners.push(unlistenPresence);

		// 5. ORA AVVIA $effect.root che attende context non-null e primo updateContext riuscito
		cleanupRoot = $effect.root(() => {
			$effect(() => {
				const context = options.getContext();
				if (context === null || context === undefined) {
					// Attende che projectStore.ready sia vero
					return;
				}

				void (async () => {
					try {
						await automationsStore.updateContext(context);

						// Se è il primo invio riuscito, dichiara il contesto pronto e svuota le richieste
						if (!isContextReady) {
							isContextReady = true;

							// A. Processa richieste arrivate prima del contesto
							while (earlyProjectRequests.length > 0) {
								const queued = earlyProjectRequests.shift();
								if (queued) {
									void processProjectRequest(queued);
								}
							}

							// B. Solo ORA esegui la recovery delle richieste pendenti (salta deferred)
							try {
								const pending = await invoke<AutomationProjectRequest[]>('automations_project_pending');
								if (Array.isArray(pending)) {
									for (const req of pending) {
										void processProjectRequest(req);
									}
								}
							} catch (err) {
								const msg = err instanceof Error ? err.message : String(err);
								console.warn('[AutomationHost] Recovery richieste progetto non riuscito:', msg);
								automationsStore.error = msg;
							}
						}
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						automationsStore.error = msg;
					}
				})();
			});
		});

		return doCleanup;
	} catch (err) {
		doCleanup();
		const msg = err instanceof Error ? err.message : String(err);
		automationsStore.error = msg;
		throw err;
	}
}

/**
 * Notifica un evento proveniente dal runtime degli agenti interattivi (AUT-014).
 * Da agganciare alle sottoscrizioni effettive delle sessioni, senza turn_end generici.
 */
export async function notifyAutomationAgentEvent(
	kind: AutomationTriggerKind,
	projectPath?: string,
	detail?: string
): Promise<void> {
	try {
		const event: AutomationEvent = {
			kind,
			at: Date.now(),
			projectPath,
			paths: [],
			origin: 'interactive',
			detail
		};
		await invoke('automations_event', { event });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn('[AutomationHost] Errore notifica evento agente:', msg);
		automationsStore.error = msg;
	}
}
