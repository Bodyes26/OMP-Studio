import { invoke } from '#lib/backend/ipc.ts';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
	isPermissionGranted,
	requestPermission,
	sendNotification,
	createChannel,
	Importance,
	Visibility
} from '@tauri-apps/plugin-notification';
import { projectStore } from './projects.svelte';
import { settingsStore } from './settings.svelte';
import { m } from '#lib/paraglide/messages.js';
import { IS_WINDOWS } from '#lib/utils/platform.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { notifiesHere, type PresenceSample } from './notificationPresence.ts';

/** Attesa massima della risposta di un'altra macchina prima di notificare comunque. */
const PRESENCE_TIMEOUT_MS = 1500;

/** Secondi di inattività di una macchina, o `null` se non risponde in tempo. */
async function idleSecondsOn(machine?: string): Promise<number | null> {
	const { promise, resolve } = Promise.withResolvers<number | null>();
	const timer = setTimeout(() => resolve(null), PRESENCE_TIMEOUT_MS);
	invoke<number | null>('system_idle_seconds', undefined, machine ? { machine } : undefined)
		.then((seconds) => resolve(typeof seconds === 'number' ? seconds : null))
		.catch(() => resolve(null));
	const seconds = await promise;
	clearTimeout(timer);
	return seconds;
}

/**
 * Solo la macchina usata per ultima notifica (R-MI-31). Senza altre macchine
 * in linea non c'è nulla da chiedere: si notifica come sempre.
 */
async function shouldNotifyHere(): Promise<boolean> {
	const peers = linkStore.status.peers.filter((peer) => peer.online && peer.compatible);
	if (peers.length === 0) return true;
	const [here, ...others] = await Promise.all([
		idleSecondsOn(),
		...peers.map((peer) => idleSecondsOn(peer.id))
	]);
	const samples: PresenceSample[] = peers.map((peer, index) => ({ machineId: peer.id, idleSeconds: others[index] }));
	return notifiesHere({ machineId: linkStore.status.machineId, idleSeconds: here }, samples);
}

class NotificationManager {
	/** Progetti per cui l'utente ha preso visione portando il progetto a fuoco. */
	private acknowledgedIds = new Set<string>();
	/** Stato precedente per rilevare le transizioni effettive. */
	private previousStates = new Map<string, string>();
	/** Ultimo timestamp di notifica inviata per progetto per evitare spam. */
	private lastNotifiedTimestamps = new Map<string, number>();
	/** Testo dell'ultimo messaggio di ask per i progetti in GUI. */
	private askMessages = new Map<string, string>();
	/** Flag di inizializzazione listener. */
	private initialized = false;

	async init() {
		if (this.initialized) return;
		this.initialized = true;

		// Registra il canale notifiche per Windows e Android
		try {
			await createChannel({
				id: 'omp-studio-alerts',
				name: 'OMP Studio',
				description: m.notify_os_channel_desc(),
				importance: Importance.High,
				visibility: Visibility.Public,
				sound: 'default'
			});
		} catch (err) {
			// createChannel potrebbe non essere implementato su tutte le piattaforme desktop: non fatale
			console.debug('Inizializzazione canale notifiche:', err);
		}

		// Il click su una notifica di sistema non passa da `onAction`: su desktop
		// il plugin registra solo `notify`/`request_permission`/
		// `is_permission_granted` e `register_listener` vive solo su mobile, per
		// cui la sottoscrizione falliva con un errore ACL a ogni avvio senza mai
		// consegnare nulla (S8-13, S13-11). Su Windows il click passa da
		// `studio-focus-project`; la Companion apre il progetto con il suo
		// percorso. `handleNotificationClick` resta per quei percorsi.

		if (typeof window !== 'undefined') {
			window.addEventListener('focus', () => this.checkFocusAcknowledgement());
		}
	}

	/** Imposta o aggiorna il messaggio dell'Ask per un progetto in modalita' GUI. */
	setProjectAskMessage(projectId: string, message: string) {
		this.askMessages.set(projectId, message);
	}

	/** Cancella il messaggio di Ask quando la richiesta e' stata risolta. */
	clearProjectAskMessage(projectId: string) {
		this.askMessages.delete(projectId);
	}

	/**
	 * Conta i progetti attualmente in stato `attention` che non sono ancora
	 * stati messi a fuoco dall'utente.
	 */
	get unacknowledgedAttentionCount(): number {
		const attentionProjects = projectStore.projects.filter(
			(p) => p.lane.agentState === 'attention'
		);
		return attentionProjects.filter((p) => !this.acknowledgedIds.has(p.id)).length;
	}

	/**
	 * Elabora un cambiamento di stato di un progetto.
	 */
	async onProjectStateChanged(projectId: string, newState: string) {
		const project = projectStore.projects.find((p) => p.id === projectId);
		if (!project) return;

		const prev = this.previousStates.get(projectId) ?? 'unknown';
		if (prev === newState) return;
		this.previousStates.set(projectId, newState);

		if (newState !== 'attention') {
			this.acknowledgedIds.delete(projectId);
			this.lastNotifiedTimestamps.delete(projectId);
			this.askMessages.delete(projectId);
			await this.syncNativeAttention(false);
			return;
		}

		// Transizione a 'attention': verifichiamo se l'utente e' gia' a fuoco su questo progetto
		const isAppFocused = typeof document !== 'undefined' && document.hasFocus();
		const isViewingProject = projectStore.activeId === projectId;

		if (isAppFocused && isViewingProject) {
			// L'utente e' gia' davanti alla schermata di questo progetto: presa visione immediata
			this.acknowledgedIds.add(projectId);
			await this.syncNativeAttention(false);
			return;
		}

		// L'app e' in background/minimizzata OPPURE l'utente e' su un altro progetto
		this.acknowledgedIds.delete(projectId);

		// Notifica OS e lampeggio dell'icona solo sulla macchina usata per
		// ultima (R-MI-31); il conteggio sul badge resta, perché è stato.
		const here = await shouldNotifyHere();
		if (here) await this.dispatchOsNotification(project);
		await this.syncNativeAttention(here);
	}

	private async dismissProjectNotifications(projectId: string) {
		if (!IS_WINDOWS) return;
		try {
			await invoke('dismiss_project_notifications', { projectId });
		} catch (error) {
			console.warn('Ritiro notifiche progetto non riuscito:', error);
		}
	}

	/**
	 * Quando l'utente seleziona un progetto o l'app riprende il focus,
	 * azzera l'alert per quel progetto.
	 */
	acknowledge(projectId: string) {
		if (!this.acknowledgedIds.has(projectId)) {
			this.acknowledgedIds.add(projectId);
			void this.syncNativeAttention(false);
		}
	}

	/**
	 * Verifica se il progetto attivo e' in attention e, se la finestra ha il focus,
	 * lo marca come riconosciuto. Solo il terminale chiude anche "ha finito":
	 * la chat conferma la lettura dal transcript. Azzerarla qui contrasta con
	 * l'aggregazione dei risultati non letti e rischedula gli effetti senza fine.
	 */
	checkFocusAcknowledgement() {
		const isAppFocused = typeof document !== 'undefined' && document.hasFocus();
		if (!isAppFocused) return;

		const activeId = projectStore.activeId;
		if (!activeId) return;
		// Anche Git e heads-up vanno ritirati, non solo le richieste in attention.
		void this.dismissProjectNotifications(activeId);

		const activeProject = projectStore.projects.find((p) => p.id === activeId);
		if (activeProject && activeProject.lane.agentState === 'attention') {
			this.acknowledge(activeId);
		}
		if (activeProject?.lane.surface === 'terminal') {
			projectStore.acknowledgeFinished(activeId);
		}
	}

	/**
	 * Gli aggiornamenti Git restano distinti dalle richieste dell'agente.
	 * `arrived` = i commit sono gia' stati applicati da soli (R-MI-58): la
	 * frase dice che sono arrivati invece di chiedere la pull. `blocked` e'
	 * il motivo per cui l'avanzamento automatico non e' avvenuto.
	 */
	async notifyGitUpdates(
		project: { id: string; name: string },
		count: number,
		arrived = false,
		blocked: string | null = null
	): Promise<void> {
		if (!settingsStore.notifications.enabled || this.isAppFocused()) return;
		if (!(await shouldNotifyHere())) return;
		try {
			await this.init();
			let granted = await isPermissionGranted();
			if (!granted) granted = (await requestPermission()) === 'granted';
			if (!granted) return;
			const body = arrived
				? m.git_remote_arrived_body({ name: project.name, count })
				: blocked
					? m.git_remote_blocked_body({ name: project.name, count, reason: blocked })
					: m.git_remote_notification_body({ name: project.name, count });
			await this.sendProjectNotification(
				project.id,
				settingsStore.notifications.style === 'detailed'
					? `OMP Studio · ${project.name}` : 'OMP Studio',
				body
			);
		} catch (error) {
			console.warn('Invio notifica Git non riuscito:', error);
		}
	}

	/**
	 * Heads-up di fine turno (Gate R40): la stessa frase della chat,
	 * solo se l'utente non sta gia' guardando quel progetto. Con lo stile
	 * compatto la frase resta fuori dalla notifica, come le domande.
	 */
	async notifyHeadsUp(project: { id: string; name: string }, text: string): Promise<void> {
		if (!settingsStore.notifications.enabled) return;
		if (this.isAppFocused()) return;
		if (!(await shouldNotifyHere())) return;
		try {
			await this.init();
			let granted = await isPermissionGranted();
			if (!granted) granted = (await requestPermission()) === 'granted';
			if (!granted) return;
			const isDetailed = settingsStore.notifications.style === 'detailed';
			await this.sendProjectNotification(
				project.id,
				isDetailed ? m.headsup_notification_title({ project: project.name }) : 'OMP Studio',
				isDetailed ? text : m.headsup_notification_compact({ project: project.name })
			);
		} catch (error) {
			console.warn('Invio notifica heads-up non riuscito:', error);
		}
	}

	/**
	 * Invia la notifica toast del sistema operativo (se abilitata nelle impostazioni).
	 */
	private async dispatchOsNotification(project: { id: string; name: string }) {
		if (!settingsStore.notifications.enabled) return;
		if (this.isAppFocused()) return;

		// Evita notifiche duplicate a raffica (minimo 5 secondi tra notifiche per lo stesso progetto)
		const now = Date.now();
		const last = this.lastNotifiedTimestamps.get(project.id) ?? 0;
		if (now - last < 5000) return;
		this.lastNotifiedTimestamps.set(project.id, now);

		try {
			let granted = await isPermissionGranted();
			if (!granted) {
				const status = await requestPermission();
				granted = status === 'granted';
			}
			if (!granted) return;

			const isDetailed = settingsStore.notifications.style === 'detailed';
			const askMsg = this.askMessages.get(project.id)?.trim();

			let title: string;
			let body: string;

			if (isDetailed) {
				title = `OMP Studio · ${project.name}`;
				body = askMsg || m.l10n_state_needs_you_body({ project: project.name });
			} else {
				title = 'OMP Studio';
				body = m.l10n_state_needs_you_body({ project: project.name });
			}
			await this.sendProjectNotification(project.id, title, body);
		} catch (err) {
			console.warn('Invio notifica OS non riuscito:', err);
		}
	}

	private isAppFocused(): boolean {
		return typeof document !== 'undefined' && document.hasFocus();
	}

	private async sendProjectNotification(projectId: string, title: string, body: string) {
		// Il permesso puo' arrivare dopo un cambio di focus: ricontrolla prima dell'invio.
		if (this.isAppFocused()) return;
		if (IS_WINDOWS) {
			await invoke('send_project_notification', {
				projectId, title, body, silent: !settingsStore.notifications.sound, test: false
			});
		} else {
			sendNotification({
				title, body, channelId: 'omp-studio-alerts',
				extra: { projectId }, silent: !settingsStore.notifications.sound
			});
		}
	}

	/**
	 * Sincronizza lo stato di allerta dell'icona dell'applicazione (Taskbar Windows / Dock macOS).
	 */
	async syncNativeAttention(alert: boolean) {
		if (!settingsStore.notifications.appBadge) {
			try {
				await invoke('clear_app_attention');
			} catch {}
			return;
		}

		const count = this.unacknowledgedAttentionCount;
		try {
			if (count > 0) {
				await invoke('set_app_attention', { count, alert });
			} else {
				await invoke('clear_app_attention');
			}
		} catch (err) {
			console.warn('Sincronizzazione attenzione nativa non riuscita:', err);
		}
	}

	/**
	 * Gestisce il click su una notifica di sistema portando l'app in primo piano
	 * e selezionando il progetto di destinazione.
	 */
	async handleNotificationClick(projectId?: string) {
		try {
			const win = getCurrentWindow();
			await win.unminimize();
			await win.setFocus();
		} catch (e) {
			console.warn('Impossibile focalizzare la finestra:', e);
		}

		if (projectId) {
			projectStore.setActive(projectId);
			this.acknowledge(projectId);
		}
	}

	/**
	 * Invia una notifica di test del sistema operativo per verificare
	 * il corretto funzionamento di AUMID, icona e canale notifiche.
	 */
	async sendTestNotification(): Promise<{ ok: boolean; error?: string }> {
		try {
			let granted = await isPermissionGranted();
			if (!granted) {
				const status = await requestPermission();
				granted = status === 'granted';
			}
			if (!granted) {
				return { ok: false, error: m.notify_permission_denied() };
			}

			if (IS_WINDOWS) {
				await invoke('send_project_notification', {
					projectId: '__notification_test__',
					title: m.notify_test_title(),
					body: m.notify_test_body(),
					silent: !settingsStore.notifications.sound,
					test: true
				});
			} else {
				sendNotification({
					title: m.notify_test_title(),
					body: m.notify_test_body(),
					channelId: 'omp-studio-alerts',
					silent: !settingsStore.notifications.sound
				});
			}
			return { ok: true };
		} catch (err) {
			return { ok: false, error: String(err) };
		}
	}
}

export const notificationManager = new NotificationManager();
