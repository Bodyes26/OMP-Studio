import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isPermissionGranted, requestPermission, sendNotification, onAction } from '@tauri-apps/plugin-notification';
import { projectStore } from './projects.svelte';
import { settingsStore } from './settings.svelte';

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

		// Registra il listener per il click sulle notifiche di sistema
		try {
			await onAction((notification) => {
				const projectId = (notification.extra?.projectId as string) || undefined;
				void this.handleNotificationClick(projectId);
			});
		} catch (err) {
			console.warn('Listener notifiche non disponibile:', err);
		}

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
		const attentionProjects = projectStore.projects.filter((p) => p.agentState === 'attention');
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

		// Invia notifica OS se abilitata
		await this.dispatchOsNotification(project);

		// Aggiorna l'alert nativo dell'icona (badge Dock / dot rosso Taskbar + flash)
		await this.syncNativeAttention(true);
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
	 * lo marca come riconosciuto.
	 */
	checkFocusAcknowledgement() {
		const isAppFocused = typeof document !== 'undefined' && document.hasFocus();
		if (!isAppFocused) return;

		const activeId = projectStore.activeId;
		if (!activeId) return;

		const activeProject = projectStore.projects.find((p) => p.id === activeId);
		if (activeProject && activeProject.agentState === 'attention') {
			this.acknowledge(activeId);
		}
	}

	/**
	 * Invia la notifica toast del sistema operativo (se abilitata nelle impostazioni).
	 */
	private async dispatchOsNotification(project: { id: string; name: string }) {
		if (!settingsStore.notifications.enabled) return;

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

			let title = 'OMP Studio';
			let body = `OMP ha bisogno di te su ${project.name}`;

			if (isDetailed && askMsg) {
				title = `OMP Studio · ${project.name}`;
				body = askMsg;
			}

			sendNotification({
				title,
				body,
				extra: { projectId: project.id },
				silent: !settingsStore.notifications.sound
			});
		} catch (err) {
			console.warn('Invio notifica OS non riuscito:', err);
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
}

export const notificationManager = new NotificationManager();
