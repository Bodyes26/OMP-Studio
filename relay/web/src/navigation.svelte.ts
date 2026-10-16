/**
 * Navigazione della PWA: il quadro delle macchine e, sopra, la chat di una
 * corsia a tutto schermo o una sessione storica. La chat entra nella cronologia
 * del browser, cosi' il tasto Indietro di Android e lo swipe di iOS la chiudono
 * come una pagina.
 */

export interface LiveChatRoute {
	hostId: string;
	projectId: string;
	/** `main` per la Principale, o id della corsia. */
	laneId: string;
	isHistory?: false;
}

export interface HistoryChatRoute {
	hostId: string;
	projectId: string;
	sessionId: string;
	sessionTitle?: string | null;
	isHistory: true;
	laneId?: never;
}

export type ChatRoute = LiveChatRoute | HistoryChatRoute;

/** Rotta della chat salvata in `history.state`, se c'e'. */
function routeFromState(state: unknown): ChatRoute | null {
	if (!state || typeof state !== 'object' || !('chat' in state)) return null;
	const chat: unknown = (state as Record<string, unknown>).chat;
	if (!chat || typeof chat !== 'object') return null;
	const c = chat as Record<string, unknown>;
	if (typeof c.hostId !== 'string' || typeof c.projectId !== 'string') return null;

	if (c.isHistory === true && typeof c.sessionId === 'string') {
		return {
			hostId: c.hostId,
			projectId: c.projectId,
			sessionId: c.sessionId,
			sessionTitle: typeof c.sessionTitle === 'string' ? c.sessionTitle : null,
			isHistory: true
		};
	}

	if (typeof c.laneId === 'string') {
		return {
			hostId: c.hostId,
			projectId: c.projectId,
			laneId: c.laneId,
			isHistory: false
		};
	}

	return null;
}

class Navigation {
	chat = $state<ChatRoute | null>(null);

	constructor() {
		if (typeof window === 'undefined') return;
		// Dopo un ricaricamento la chat aperta resta aperta.
		this.chat = routeFromState(history.state);
		window.addEventListener('popstate', (event) => {
			this.chat = routeFromState(event.state);
		});
	}

	openChat(route: ChatRoute): void {
		const current = this.chat;
		if (
			current &&
			current.hostId === route.hostId &&
			current.projectId === route.projectId &&
			((!route.isHistory && !current.isHistory && current.laneId === route.laneId) ||
				(route.isHistory && current.isHistory && current.sessionId === route.sessionId))
		) {
			return;
		}

		const next: ChatRoute = route.isHistory
			? {
					hostId: route.hostId,
					projectId: route.projectId,
					sessionId: route.sessionId,
					sessionTitle: route.sessionTitle ?? null,
					isHistory: true
				}
			: {
					hostId: route.hostId,
					projectId: route.projectId,
					laneId: route.laneId,
					isHistory: false
				};

		// Da una chat all'altra si sostituisce la voce: Indietro torna sempre al quadro.
		if (current) history.replaceState({ chat: next }, '');
		else history.pushState({ chat: next }, '');
		this.chat = next;
	}

	closeChat(): void {
		if (!this.chat) return;
		if (routeFromState(history.state)) {
			history.back();
			return;
		}
		this.chat = null;
	}
}

export const navigation = new Navigation();
