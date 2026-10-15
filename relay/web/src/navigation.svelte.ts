/**
 * Navigazione della PWA: il quadro delle macchine e, sopra, la chat di una
 * corsia a tutto schermo. La chat entra nella cronologia del browser, cosi'
 * il tasto Indietro di Android e lo swipe di iOS la chiudono come una pagina.
 */

export interface ChatRoute {
	hostId: string;
	projectId: string;
	/** `main` per la Principale. */
	laneId: string;
}

/** Rotta della chat salvata in `history.state`, se c'e'. */
function routeFromState(state: unknown): ChatRoute | null {
	if (!state || typeof state !== 'object' || !('chat' in state)) return null;
	const chat: unknown = state.chat;
	if (!chat || typeof chat !== 'object') return null;
	if (!('hostId' in chat) || !('projectId' in chat) || !('laneId' in chat)) return null;
	const { hostId, projectId, laneId } = chat;
	if (typeof hostId !== 'string' || typeof projectId !== 'string' || typeof laneId !== 'string') return null;
	return { hostId, projectId, laneId };
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
		if (current && current.hostId === route.hostId && current.projectId === route.projectId && current.laneId === route.laneId) return;
		const next = { hostId: route.hostId, projectId: route.projectId, laneId: route.laneId };
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
