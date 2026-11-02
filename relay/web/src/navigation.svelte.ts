/**
 * Navigazione della PWA (Gate R48, R-REM-06, R-REM-07):
 * la chat e l'anteprima sono voci distinte della cronologia del browser.
 * Il ritorno indietro (gesto swipe o tasto hardware del browser) chiude
 * prima l'anteprima, poi la chat, preservando l'espansione e la bozza.
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

/** Rotta della chat salvata in `history.state`, se presente. */
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

function isPreviewInState(state: unknown): boolean {
	if (!state || typeof state !== 'object') return false;
	return Boolean((state as Record<string, unknown>).preview);
}

class Navigation {
	chat = $state<ChatRoute | null>(null);
	previewOpen = $state<boolean>(false);

	private previewCloseHandlers = new Set<() => void>();

	constructor() {
		if (typeof window === 'undefined') return;
		this.chat = routeFromState(history.state);
		this.previewOpen = isPreviewInState(history.state);

		window.addEventListener('popstate', (event) => {
			const prevPreview = this.previewOpen;
			this.chat = routeFromState(event.state);
			this.previewOpen = isPreviewInState(event.state);

			if (prevPreview && !this.previewOpen) {
				for (const handler of this.previewCloseHandlers) {
					handler();
				}
			}
		});
	}

	onPreviewClose(handler: () => void): () => void {
		this.previewCloseHandlers.add(handler);
		return () => {
			this.previewCloseHandlers.delete(handler);
		};
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

		this.previewOpen = false;

		// Da una chat all'altra si sostituisce la voce, cosi' Indietro torna all'elenco.
		// Una sessione storica aperta da una chat dal vivo invece si impila: Indietro
		// riporta alla conversazione attiva, che resta invariata (R-REM-15).
		const stack = !current || (route.isHistory === true && !current.isHistory);
		if (stack) {
			history.pushState({ chat: next, preview: false }, '');
		} else {
			history.replaceState({ chat: next, preview: false }, '');
		}
		this.chat = next;
	}

	closeChat(): void {
		if (!this.chat) return;

		// Se l'anteprima e aperta, il primo indietro chiude l'anteprima
		if (this.previewOpen) {
			this.closePreview();
			return;
		}

		if (routeFromState(history.state)) {
			history.back();
			return;
		}
		this.chat = null;
	}

	openPreview(): void {
		if (this.previewOpen) return;
		this.previewOpen = true;
		if (typeof window !== 'undefined') {
			history.pushState({ chat: this.chat, preview: true }, '');
		}
	}

	closePreview(): void {
		if (!this.previewOpen) return;
		if (typeof window !== 'undefined' && isPreviewInState(history.state)) {
			history.back();
			return;
		}
		this.previewOpen = false;
		for (const handler of this.previewCloseHandlers) {
			handler();
		}
	}
}

export const navigation = new Navigation();
