// Ganci di risposta alle richieste di attenzione.
//
// La card del progetto ospita la domanda ma non la risolve: le risposte
// viaggiano verso la finestra principale attraverso lo store, e i loro
// gestori vivono nella vista. Raccoglierli in un tipo solo evita quindici
// prop ripetute su due componenti, e li tiene tipizzati (un `Record` di
// callback avrebbe perso proprio cio' che serve a non sbagliare argomento).

import type { AttentionRequest } from '$lib/stores/companion.svelte';

export interface CompanionAskHandlers {
	/** Storico esteso per progetto: chiave `projectId`. */
	expandedHistory: Record<string, boolean>;
	/** Risposta libera aperta al posto delle opzioni, per progetto. */
	customReplyProjects: Record<string, boolean>;
	onToggleHistory: (projectId: string) => void;
	onCustomReplyToggle: (projectId: string, open: boolean) => void;
	onReplyDraftChange: (projectId: string, value: string) => void;
	onQuickReplySelect: (projectId: string, value: string, laneId?: string | null, requestId?: string | null) => void | Promise<void>;
	onQuickReplyConfirm: (projectId: string, confirmed: boolean, laneId?: string | null, requestId?: string | null) => void | Promise<void>;
	onQuickReplyCancel: (projectId: string, laneId?: string | null, requestId?: string | null) => void | Promise<void>;
	onQuickReplyText: (projectId: string, laneId?: string | null, requestId?: string | null) => void | Promise<void>;
	onResolveQuotaBlocked: (projectId: string, selector: string, laneId?: string | null) => void | Promise<void>;
	onDismissQuotaBlocked: (projectId: string, laneId?: string | null) => void | Promise<void>;
	draftFor: (req: AttentionRequest) => string;
	wantsText: (pending: AttentionRequest['pendingUi']) => boolean;
}
