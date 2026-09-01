import { invoke } from '@tauri-apps/api/core';
import { settingsStore } from '$lib/stores/settings.svelte';
import type { AgentSession, TranscriptEntry } from './session.svelte';

/**
 * Esegue una promise con un limite massimo di tempo sul frontend.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: number | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = window.setTimeout(() => {
			reject(new Error('Suggestions timeout'));
		}, ms);
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timer !== undefined) window.clearTimeout(timer);
	}
}

/**
 * Estrae il testo dell'ultimo messaggio assistant e del corrispondente messaggio user.
 */
function extractLastTurnContext(entries: TranscriptEntry[]): {
	lastAssistant: string;
	lastUser: string;
	assistantEntryId: number | null;
} {
	let lastAssistant = '';
	let lastUser = '';
	let assistantEntryId: number | null = null;

	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (!lastAssistant && entry.kind === 'assistant') {
			assistantEntryId = entry.id;
			const textBlocks = entry.blocks
				.filter((b): b is { type: 'text'; text: string } => b.type === 'text')
				.map((b) => b.text);
			lastAssistant = textBlocks.join('\n').trim();
		} else if (lastAssistant && !lastUser && entry.kind === 'user') {
			lastUser = (entry.content || '').trim();
		}
		if (lastAssistant && lastUser) break;
	}

	return { lastAssistant, lastUser, assistantEntryId };
}

/**
 * Controller per sessione dei suggerimenti dinamici generati da LLM (ruolo smol).
 *
 * Mantiene lo stato reattivo delle chip dinamiche, coordina la generazione tramite
 * il comando Tauri `generate_prompt_suggestions`, gestisce timeout, idempotenza per
 * turno e lazy generation quando la sessione torna visibile.
 */
export class SessionSuggestions {
	/** Lista reattiva dei testi di suggerimento dinamico correnti */
	items = $state<string[]>([]);

	private session: AgentSession;
	private visible = true;
	private requestToken = 0;
	private currentTurnKey: string | null = null;
	private generatedTurnKey: string | null = null;
	private pendingTurnKey: string | null = null;

	constructor(session: AgentSession) {
		this.session = session;
	}

	/**
	 * Notifica al controller che la visibilita' della superficie sessione e' cambiata.
	 * Se la sessione torna visibile e c'e' una generazione pendente per l'ultimo turno,
	 * la generazione viene avviata (lazy generation).
	 */
	setVisible(visible: boolean) {
		this.visible = visible;
		if (visible && this.pendingTurnKey && this.pendingTurnKey !== this.generatedTurnKey) {
			void this.generate(this.pendingTurnKey);
		}
	}

	/**
	 * Notifica la conclusione terminale di un turno dell'agente.
	 */
	notifyTurnEnd() {
		const { lastAssistant, assistantEntryId } = extractLastTurnContext(this.session.entries);
		if (assistantEntryId === null || !lastAssistant) {
			this.invalidate();
			return;
		}

		const turnKey = `turn_${assistantEntryId}`;
		this.currentTurnKey = turnKey;

		// Se i dinamici sono disabilitati nelle impostazioni, non generare
		if (!settingsStore.suggestions.dynamicEnabled) {
			this.items = [];
			this.pendingTurnKey = null;
			return;
		}

		// Se la sessione non e' visibile, rimanda la generazione a quando tornera' visibile
		if (!this.visible) {
			this.pendingTurnKey = turnKey;
			return;
		}

		void this.generate(turnKey);
	}

	/**
	 * Invalida e azzera i suggerimenti dinamici correnti e cancella le richieste in volo.
	 */
	invalidate() {
		this.requestToken++;
		this.items = [];
		this.currentTurnKey = null;
		this.pendingTurnKey = null;
	}

	/**
	 * Esegue la chiamata al backend per generare i suggerimenti prompt.
	 */
	private async generate(turnKey: string) {
		// Idempotenza: non generare due volte per lo stesso turno
		if (this.generatedTurnKey === turnKey) return;

		const { lastAssistant, lastUser } = extractLastTurnContext(this.session.entries);
		if (!lastAssistant || !settingsStore.suggestions.dynamicEnabled || !this.visible) {
			return;
		}

		const modelSelector = settingsStore.suggestions.modelSelector.trim() || null;
		const maxItems = Math.max(1, Math.min(3, settingsStore.suggestions.maxDynamic || 3));
		const timeoutMs = Math.max(5000, Math.min(60000, settingsStore.suggestions.timeoutMs || 20000));

		const token = ++this.requestToken;

		try {
			const res = await withTimeout(
				invoke<string[]>('generate_prompt_suggestions', {
					lastAssistant,
					lastUser,
					modelSelector,
					maxItems
				}),
				timeoutMs
			);

			// Se la richiesta e' stata superata o il turno e' cambiato, scarta silenziosamente
			if (token !== this.requestToken || this.currentTurnKey !== turnKey) {
				return;
			}

			this.generatedTurnKey = turnKey;
			this.items = Array.isArray(res)
				? res
						.map((s) => (typeof s === 'string' ? s.trim() : ''))
						.filter((s) => s.length > 0)
				: [];
		} catch {
			// Fallimento silenzioso: nessun log rumoroso in produzione, nessun errore alla UI
			if (token === this.requestToken) {
				this.items = [];
			}
		} finally {
			if (this.pendingTurnKey === turnKey) {
				this.pendingTurnKey = null;
			}
		}
	}
}
