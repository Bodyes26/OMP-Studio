/**
 * Instradamento delle notifiche Web Push nella nuova navigazione (Gate R48,
 * R-REM-16): la notifica porta alla macchina interessata e, se riguarda un
 * progetto, apre la chat del ramo della richiesta (la Principale se non e' detto).
 */
import { navigation } from './navigation.svelte.ts';
import { machineSelection } from './machine.svelte.ts';

export interface NotificationTarget {
	hostId?: string;
	projectId?: string;
	laneId?: string;
	requestId?: string;
}

export function navigateToNotificationTarget(target: NotificationTarget): void {
	if (!target.hostId) return;
	machineSelection.select(target.hostId);
	if (!target.projectId) return;
	navigation.openChat({
		hostId: target.hostId,
		projectId: target.projectId,
		laneId: target.laneId ?? 'main'
	});
}

/**
 * Inizializza i listener per i messaggi dal Service Worker e gestisce i parametri di avvio in URL.
 */
export function initNotificationRouting(): void {
	if (typeof window === 'undefined') return;

	// 1. Gestione parametri in query string se la finestra e' stata aperta da un click su notifica
	const params = new URLSearchParams(window.location.search);
	const hostId = params.get('host') ?? undefined;
	const projectId = params.get('project') ?? undefined;
	const laneId = params.get('lane') ?? undefined;
	const requestId = params.get('request') ?? undefined;

	if (hostId || projectId || requestId || laneId) {
		// Prima si pulisce l'indirizzo, poi si apre la chat: la voce di cronologia
		// della chat non deve essere sovrascritta.
		const cleanUrl = new URL(window.location.href);
		cleanUrl.searchParams.delete('host');
		cleanUrl.searchParams.delete('project');
		cleanUrl.searchParams.delete('lane');
		cleanUrl.searchParams.delete('request');
		window.history.replaceState(null, '', cleanUrl.pathname + cleanUrl.hash);
		navigateToNotificationTarget({ hostId, projectId, laneId, requestId });
	}

	// 2. Ascolto messaggi di focus inviati dal Service Worker a finestre gia' aperte
	if ('serviceWorker' in navigator) {
		navigator.serviceWorker.addEventListener('message', (event) => {
			if (event.data?.type === 'notification_focus') {
				navigateToNotificationTarget({
					hostId: event.data.hostId,
					projectId: event.data.projectId,
					laneId: event.data.laneId,
					requestId: event.data.requestId
				});
			}
		});
	}
}
