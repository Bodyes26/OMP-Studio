/**
 * Instradamento delle notifiche Web Push verso l'elemento visivo corretto nella PWA
 * (scroll automatico e focus su macchina, progetto, richiesta di attenzione o corsia).
 */
import { navigation } from './navigation.svelte.ts';

export interface NotificationTarget {
	hostId?: string;
	projectId?: string;
	laneId?: string;
	requestId?: string;
}

/**
 * Trova l'elemento target nel DOM e lo porta al centro con uno scorrimento fluido.
 * Include tentativi ripetuti se i componenti non sono ancora idratati.
 */
export function navigateToNotificationTarget(target: NotificationTarget, attempts = 15): void {
	if (typeof document === 'undefined') return;

	// Notifica su una corsia senza richiesta di attenzione: apre la chat a tutto schermo
	if (target.hostId && target.projectId && target.laneId && !target.requestId) {
		navigation.openChat({
			hostId: target.hostId,
			projectId: target.projectId,
			laneId: target.laneId
		});
		return;
	}

	const findTargetElement = (): HTMLElement | null => {
		if (target.requestId) {
			const el = document.getElementById(`attention-${target.requestId}`);
			if (el) return el;
		}
		if (target.projectId) {
			const el = document.getElementById(`project-${target.projectId}`);
			if (el) return el;
		}
		if (target.hostId) {
			const el = document.getElementById(`host-${target.hostId}`);
			if (el) return el;
		}
		return null;
	};

	const element = findTargetElement();
	if (element) {
		element.scrollIntoView({ behavior: 'smooth', block: 'center' });
		element.classList.add('highlight-focus');
		setTimeout(() => {
			element.classList.remove('highlight-focus');
		}, 2000);
		return;
	}

	if (attempts > 0) {
		setTimeout(() => {
			navigateToNotificationTarget(target, attempts - 1);
		}, 200);
	}
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
		navigateToNotificationTarget({ hostId, projectId, laneId, requestId });

		// Pulisce la query string per non rieseguire lo scroll ai successivi refresh
		const cleanUrl = new URL(window.location.href);
		cleanUrl.searchParams.delete('host');
		cleanUrl.searchParams.delete('project');
		cleanUrl.searchParams.delete('lane');
		cleanUrl.searchParams.delete('request');
		window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.hash);
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
