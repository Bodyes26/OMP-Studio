// Controller reattivo per l'assistente AI dedicato alla creazione e rifinitura delle automazioni.
// Rispetta AUT-024, AUT-059, AUT-060, AUT-061, AUT-062 e AUT-099.

import { invoke } from '@tauri-apps/api/core';
import type {
	AutomationDraft,
	AutomationDefinition,
	AssistantMessage,
	AutomationSettings,
	CommandAction,
	PromptAction,
	AutomationAction,
	AutomationTargets,
	AutomationPlatform
} from './types.ts';
import { newCommandAction } from './types.ts';
import type { AgentSession } from '#lib/agent/session.svelte.ts';
import { createAutomationAgent } from './runtime.svelte.ts';
import { resolveActionModel } from './runtimeHelpers.ts';
import { automationsStore } from './store.svelte.ts';

export interface ScriptProposal {
	path: string;
	content: string;
	written: boolean;
	error?: string;
}

export interface ProposalDiffSummary {
	appliedKeys: string[];
	preservedManualKeys: string[];
}

// Registro reattivo globale delle sessioni helper dell'assistente per cap globale (parent)
let activeAssistantSessions = $state<AgentSession[]>([]);

export function registerAssistantSession(session: AgentSession): () => void {
	if (!activeAssistantSessions.includes(session)) {
		activeAssistantSessions = [...activeAssistantSessions, session];
	}
	return () => {
		unregisterAssistantSession(session);
	};
}

export function unregisterAssistantSession(session: AgentSession): void {
	activeAssistantSessions = activeAssistantSessions.filter((s) => s !== session);
}

/**
 * Conteggio reattivo delle sessioni helper dell'assistente realmente in elaborazione.
 * Esclude le sessioni in attesa di risposta interattiva (pendingUi/ask).
 */
export function getAutomationAssistantActiveCount(): number {
	let count = 0;
	for (const session of activeAssistantSessions) {
		const isRunning =
			(session.isStreaming ||
				session.agentState === 'working' ||
				session.backgroundPending) &&
			!session.pendingUi;
		if (isRunning) {
			count++;
		}
	}
	return count;
}

export class AutomationAssistantController {
	draft = $state<AutomationDraft>()!;
	settings = $state<AutomationSettings | null>(null);
	conversation = $state<AssistantMessage[]>([]);
	isBusy = $state(false);
	error = $state<string | null>(null);

	// Proposta strutturata attuale in attesa di revisione da parte dell'utente
	currentProposal = $state<Partial<AutomationDefinition> | null>(null);
	currentScriptProposal = $state<ScriptProposal | null>(null);
	lastDiffSummary = $state<ProposalDiffSummary | null>(null);

	// Insieme dei campi modificati manualmente dall'utente nel wizard (AUT-099)
	manualFields = $state<Set<string>>(new Set());

	// Sessione dell'agente omp sottostante
	session = $state<AgentSession | null>(null);

	constructor(draft: AutomationDraft, settings?: AutomationSettings, manualFields?: Set<string>) {
		this.draft = draft;
		this.settings = settings ?? null;
		this.conversation = [...(draft.conversation ?? [])];
		if (manualFields) {
			this.manualFields = new Set(manualFields);
		}
	}

	/** Registra una modifica manuale a un campo per impedirne la sovrascrittura silenziosa */
	markManualEdit(fieldPath: string) {
		this.manualFields.add(fieldPath);
	}

	/**
	 * Verifica se un campo o qualsiasi sua proprietà annidata/genitore
	 * è stata modificata manualmente dall'utente (AUT-099).
	 */
	isFieldOrNestedManual(path: string): boolean {
		if (this.manualFields.has(path)) return true;
		const prefix = `${path}.`;
		for (const manual of this.manualFields) {
			if (manual.startsWith(prefix) || path.startsWith(`${manual}.`)) {
				return true;
			}
		}
		return false;
	}

	/** Indica se l'ambito (CWD o percorsi progetto) è esplicitamente configurato (AUT-024, AUT-059) */
	get isScopeConfigured(): boolean {
		const cwd = this.draft.definition.targets.cwd?.trim();
		const paths = this.draft.definition.targets.projectPaths;
		return Boolean(cwd || (paths && paths.length > 0));
	}

	/** Imposta esplicitamente l'ambito di lavoro se non configurato */
	setScope(projectPath: string) {
		const clean = projectPath.trim();
		if (!clean) return;
		this.draft.definition.targets.cwd = clean;
		if (!this.draft.definition.targets.projectPaths.includes(clean)) {
			this.draft.definition.targets.projectPaths = [clean, ...this.draft.definition.targets.projectPaths];
		}
		this.draft.updatedAt = Date.now();
		void automationsStore.saveDraft(this.draft);
	}

	/** Inizializza e apre la vera AgentSession con confinamento read-only */
	async ensureAgent(): Promise<AgentSession> {
		if (this.session && this.session.client.isOpen && !this.session.exited) {
			return this.session;
		}

		if (!this.isScopeConfigured) {
			throw new Error('Ambito non configurato: seleziona un progetto o cartella di lavoro prima di avviare l’assistente AI (AUT-024/AUT-059).');
		}

		// Risoluzione reale del modello assistente (AUT-026/AUT-060)
		const resolved = resolveActionModel({
			kind: 'prompt',
			prompt: '',
			modelMode: this.settings?.assistantModelMode ?? 'role',
			model: this.settings?.assistantModel || 'smol',
			allowPayAsYouGo: this.settings?.assistantAllowPayAsYouGo ?? false,
			maxCostUsd: null
		});

		const cwd = this.draft.definition.targets.cwd || (this.draft.definition.targets.projectPaths[0] ?? '');
		const projectPaths = this.draft.definition.targets.projectPaths ?? [cwd];

		const agent = createAutomationAgent({
			id: `assistant-${this.draft.id}`,
			cwd,
			projectPaths,
			model: resolved.model,
			readOnly: true,
			preventPayg: resolved.preventPayg
		});

		this.session = agent;
		registerAssistantSession(agent);

		// Apertura reale del processo RPC omp
		if (!agent.client.isOpen) {
			await agent.open();
		}

		const isReady = await agent.waitUntilReady(10000);
		if (!isReady) {
			throw new Error('La sessione dell’assistente non è diventata pronta entro il tempo limite.');
		}

		return this.session;
	}

	/** Invia un messaggio dell'utente all'assistente */
	async sendMessage(userText: string): Promise<void> {
		const trimmed = userText.trim();
		if (!trimmed || this.isBusy) return;

		this.isBusy = true;
		this.error = null;

		const userMsg: AssistantMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			text: trimmed,
			at: Date.now()
		};

		this.conversation = [...this.conversation, userMsg];
		this.draft.conversation = [...this.conversation];

		// Persistenza immediata su DB (AUT-062)
		try {
			await automationsStore.saveDraft(this.draft);
		} catch (saveErr) {
			console.warn('Errore salvataggio bozza:', saveErr);
		}

		try {
			const agent = await this.ensureAgent();

			// Costruisci il prompt contestuale esplicito per l'assistente (AUT-059, AUT-060)
			const contextPrompt = this.buildContextualPrompt(trimmed);
			await agent.prompt(contextPrompt);

			// Attendi reale conclusione del turno o eventuale ask (nessun fallback fittizio)
			await this.waitForTurnSettled(agent);

			if (agent.pendingUi) {
				// L'agente ha una richiesta bloccante / ask: la UI visualizza AskCard
				return;
			}

			const assistantReplyText = agent.lastAssistantText;
			if (!assistantReplyText) {
				throw new Error('L’assistente ha completato il turno senza produrre testo.');
			}

			// Analizza la risposta per estrarre eventuali blocchi proposta
			const { cleanText, proposal, scriptProposal } = this.parseAssistantOutput(assistantReplyText);

			const replyMsg: AssistantMessage = {
				id: crypto.randomUUID(),
				role: 'assistant',
				text: cleanText || assistantReplyText,
				at: Date.now()
			};

			this.conversation = [...this.conversation, replyMsg];
			this.draft.conversation = [...this.conversation];

			if (proposal) {
				this.currentProposal = proposal;
			}
			if (scriptProposal) {
				this.currentScriptProposal = {
					...scriptProposal,
					written: false
				};
			}

			// Salva persistentemente su database (AUT-062)
			await automationsStore.saveDraft(this.draft);
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.isBusy = false;
		}
	}

	/** Attende che il turno corrente della sessione giunga a completamento reale o richieda ask */
	private async waitForTurnSettled(agent: AgentSession): Promise<void> {
		const initialDelay = Promise.withResolvers<void>();
		setTimeout(initialDelay.resolve, 80);
		await initialDelay.promise;

		const { promise, resolve } = Promise.withResolvers<void>();
		const check = () => {
			if (agent.exited || agent.pendingUi !== null) {
				resolve();
				return;
			}
			const working = agent.isStreaming || agent.agentState === 'working' || agent.backgroundPending;
			if (!working) {
				resolve();
				return;
			}
			setTimeout(check, 100);
		};
		check();
		return promise;
	}

	/** Costruisce il prompt con il contesto esplicito dell'ambito (AUT-059) */
	private buildContextualPrompt(userText: string): string {
		const def = this.draft.definition;
		const contextSummary = {
			currentName: def.name || '(non impostato)',
			currentTargets: def.targets.source,
			projectPaths: def.targets.projectPaths,
			currentActionKind: def.action.kind,
			manualFields: Array.from(this.manualFields)
		};

		return `Sei l'assistente dedicato di OMP Studio per la creazione e revisione delle automazioni ricorrenti (AUT-059..AUT-062).
Operi in SOLA LETTURA su questo progetto. Non eseguire comandi o scritture.
Se mancano dettagli per configurare l'automazione, fai solo le domande pertinenti (es. giorni, orario, fuso, comandi o filtri).
Se hai elementi sufficienti o vuoi proporre una configurazione strutturata, inserisci un blocco JSON delimitato da \`\`\`automation-proposal
con i campi di AutomationDefinition aggiornati (name, description, action, targets, triggers, policy).
Se proponi un file di script dedicato, inserisci un blocco delimitato da \`\`\`script-proposal con {"path": "...", "content": "..."}.

Contesto attuale:
${JSON.stringify(contextSummary, null, 2)}

Richiesta utente:
${userText}`;
	}

	/** Estrae blocchi speciali di proposta dal testo prodotto dall'assistente */
	private parseAssistantOutput(text: string): {
		cleanText: string;
		proposal: Partial<AutomationDefinition> | null;
		scriptProposal: { path: string; content: string } | null;
	} {
		let clean = text;
		let proposal: Partial<AutomationDefinition> | null = null;
		let scriptProposal: { path: string; content: string } | null = null;

		const proposalRegex = /```automation-proposal\s*([\s\S]*?)```/;
		const propMatch = text.match(proposalRegex);
		if (propMatch) {
			try {
				proposal = JSON.parse(propMatch[1].trim());
				clean = clean.replace(propMatch[0], '').trim();
			} catch (e) {
				console.warn('Errore parsing blocco automation-proposal:', e);
			}
		}

		const scriptRegex = /```script-proposal\s*([\s\S]*?)```/;
		const scriptMatch = text.match(scriptRegex);
		if (scriptMatch) {
			try {
				scriptProposal = JSON.parse(scriptMatch[1].trim());
				clean = clean.replace(scriptMatch[0], '').trim();
			} catch (e) {
				console.warn('Errore parsing blocco script-proposal:', e);
			}
		}

		return { cleanText: clean, proposal, scriptProposal };
	}

	/**
	 * Applica la proposta strutturata alla bozza corrente,
	 * proteggendo TUTTI i campi e le proprietà annidate modificate manualmente (AUT-099).
	 * Esegue merge sicuro base+campi proposti senza cast ciechi e valida con preview nativa.
	 */
	applyProposal(proposal: Partial<AutomationDefinition> = this.currentProposal ?? {}): ProposalDiffSummary {
		const applied: string[] = [];
		const preserved: string[] = [];

		const def = this.draft.definition;

		// 1. Nome e Descrizione
		if (proposal.name !== undefined) {
			if (this.isFieldOrNestedManual('name')) {
				preserved.push('name');
			} else {
				def.name = proposal.name;
				applied.push('name');
			}
		}

		if (proposal.description !== undefined) {
			if (this.isFieldOrNestedManual('description')) {
				preserved.push('description');
			} else {
				def.description = proposal.description;
				applied.push('description');
			}
		}

		// 2. Azione (con merge sicuro dei campi per evitare DTO incompleto o perdita di manual edits)
		if (proposal.action !== undefined) {
			const propAction = proposal.action;
			const targetKind = propAction.kind || def.action.kind;

			if (this.isFieldOrNestedManual('action') || this.isFieldOrNestedManual('action.kind')) {
				// Il tipo o l'intero gruppo azione è stato modificato manualmente: preserva
				preserved.push('action');
			} else if (targetKind !== def.action.kind) {
				// Cambio di tipo azione consentito (nessuna edit manuale bloccante)
				if (targetKind === 'command') {
					const platform: AutomationPlatform = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform) ? 'windows' : typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? 'macos' : 'linux';
					const baseCmd = newCommandAction(platform);
					def.action = {
						...baseCmd,
						...(propAction as Partial<CommandAction>),
						kind: 'command'
					};
				} else {
					const promptAct = propAction as Partial<PromptAction>;
					def.action = {
						kind: 'prompt',
						prompt: promptAct.prompt || '',
						modelMode: promptAct.modelMode || 'role',
						model: promptAct.model || 'default',
						allowPayAsYouGo: promptAct.allowPayAsYouGo ?? false,
						maxCostUsd: promptAct.maxCostUsd ?? null
					};
				}
				applied.push('action.kind');
			} else {
				// Stesso tipo di azione: merge selettivo per-proprietà
				if (def.action.kind === 'command' && propAction.kind === 'command') {
					if (propAction.command !== undefined) {
						if (this.isFieldOrNestedManual('action.command')) preserved.push('action.command');
						else { def.action.command = propAction.command; applied.push('action.command'); }
					}
					if (propAction.mode !== undefined) {
						if (this.isFieldOrNestedManual('action.mode')) preserved.push('action.mode');
						else { def.action.mode = propAction.mode; applied.push('action.mode'); }
					}
					if (propAction.args !== undefined) {
						if (this.isFieldOrNestedManual('action.args')) preserved.push('action.args');
						else { def.action.args = [...propAction.args]; applied.push('action.args'); }
					}
					if (propAction.interpreter !== undefined) {
						if (this.isFieldOrNestedManual('action.interpreter')) preserved.push('action.interpreter');
						else { def.action.interpreter = propAction.interpreter; applied.push('action.interpreter'); }
					}
					if (propAction.scriptPolicy !== undefined) {
						if (this.isFieldOrNestedManual('action.scriptPolicy')) preserved.push('action.scriptPolicy');
						else { def.action.scriptPolicy = propAction.scriptPolicy; applied.push('action.scriptPolicy'); }
					}
					if (propAction.environment !== undefined) {
						if (this.isFieldOrNestedManual('action.environment')) preserved.push('action.environment');
						else { def.action.environment = { ...def.action.environment, ...propAction.environment }; applied.push('action.environment'); }
					}
				} else if (def.action.kind === 'prompt' && propAction.kind === 'prompt') {
					if (propAction.prompt !== undefined) {
						if (this.isFieldOrNestedManual('action.prompt')) preserved.push('action.prompt');
						else { def.action.prompt = propAction.prompt; applied.push('action.prompt'); }
					}
					if (propAction.model !== undefined) {
						if (this.isFieldOrNestedManual('action.model')) preserved.push('action.model');
						else { def.action.model = propAction.model; applied.push('action.model'); }
					}
					if (propAction.modelMode !== undefined) {
						if (this.isFieldOrNestedManual('action.modelMode')) preserved.push('action.modelMode');
						else { def.action.modelMode = propAction.modelMode; applied.push('action.modelMode'); }
					}
					if (propAction.maxCostUsd !== undefined) {
						if (this.isFieldOrNestedManual('action.maxCostUsd')) preserved.push('action.maxCostUsd');
						else { def.action.maxCostUsd = propAction.maxCostUsd; applied.push('action.maxCostUsd'); }
					}
				}
			}
		}

		// 3. Targets (merge selettivo dei singoli campi)
		if (proposal.targets !== undefined) {
			const propTargets = proposal.targets;
			if (propTargets.source !== undefined) {
				if (this.isFieldOrNestedManual('targets.source')) preserved.push('targets.source');
				else { def.targets.source = propTargets.source; applied.push('targets.source'); }
			}
			if (propTargets.projectPaths !== undefined) {
				if (this.isFieldOrNestedManual('targets.projectPaths')) preserved.push('targets.projectPaths');
				else { def.targets.projectPaths = [...propTargets.projectPaths]; applied.push('targets.projectPaths'); }
			}
			if (propTargets.mode !== undefined) {
				if (this.isFieldOrNestedManual('targets.mode')) preserved.push('targets.mode');
				else { def.targets.mode = propTargets.mode; applied.push('targets.mode'); }
			}
			if (propTargets.cwd !== undefined) {
				if (this.isFieldOrNestedManual('targets.cwd')) preserved.push('targets.cwd');
				else { def.targets.cwd = propTargets.cwd; applied.push('targets.cwd'); }
			}
			if (propTargets.filters !== undefined) {
				if (this.isFieldOrNestedManual('targets.filters')) preserved.push('targets.filters');
				else { def.targets.filters = [...propTargets.filters]; applied.push('targets.filters'); }
			}
		}

		// 4. Triggers
		if (proposal.triggers !== undefined) {
			if (this.isFieldOrNestedManual('triggers')) {
				preserved.push('triggers');
			} else {
				def.triggers = proposal.triggers;
				applied.push('triggers');
			}
		}

		// 5. Policy
		if (proposal.policy !== undefined) {
			const propPolicy = proposal.policy;
			for (const [k, v] of Object.entries(propPolicy)) {
				const keyPath = `policy.${k}`;
				if (this.isFieldOrNestedManual(keyPath) || this.isFieldOrNestedManual('policy')) {
					preserved.push(keyPath);
				} else {
					(def.policy as unknown as Record<string, unknown>)[k] = v;
					applied.push(keyPath);
				}
			}
		}

		def.updatedAt = Date.now();
		this.draft.updatedAt = Date.now();

		this.lastDiffSummary = { appliedKeys: applied, preservedManualKeys: preserved };
		this.currentProposal = null;

		// Validazione reale con native preview (AUT-051)
		void automationsStore.preview(def).then((prev) => {
			if (prev.issues && prev.issues.length > 0) {
				console.warn('Avvertenze anteprima dopo applicazione proposta:', prev.issues);
			}
		}).catch((err) => {
			console.warn('Verifica preview proposta non riuscita:', err);
		});

		void automationsStore.saveDraft(this.draft).catch((err) => {
			console.warn('Errore salvataggio bozza su applicazione proposta:', err);
		});

		return this.lastDiffSummary;
	}

	/** Scarta la proposta corrente senza applicarla */
	discardProposal() {
		this.currentProposal = null;
	}

	/**
	 * Conferma esplicita dell'utente per la scrittura di un file script su disco (AUT-061).
	 * Usa la firma IPC reale 'file_write' con projectPath, rel e content.
	 * Valida rigorosamente che il percorso sia confinato nella radice del progetto.
	 */
	async confirmWriteScript(): Promise<boolean> {
		if (!this.currentScriptProposal || this.currentScriptProposal.written) {
			return false;
		}

		const { path: scriptPath, content } = this.currentScriptProposal;

		// Determina il projectPath autorizzato (CWD o primo projectPath)
		const projectPath =
			this.draft.definition.targets.cwd?.trim() ||
			this.draft.definition.targets.projectPaths[0]?.trim();

		if (!projectPath) {
			const err = 'Impossibile scrivere lo script: nessun percorso di progetto configurato nei destinatari.';
			this.currentScriptProposal.error = err;
			throw new Error(err);
		}

		// Normalizza il percorso relativo entro la radice del progetto autorizzato
		let rel = scriptPath.trim().replace(/\\/g, '/');
		const normProj = projectPath.replace(/\\/g, '/');
		if (rel.startsWith(normProj)) {
			rel = rel.slice(normProj.length).replace(/^\/+/, '');
		}
		if (rel.startsWith('/') || rel.startsWith('../') || rel.includes('/../')) {
			const err = `Percorso script non valido o fuori dall'ambito del progetto: ${rel}`;
			this.currentScriptProposal.error = err;
			throw new Error(err);
		}

		try {
			// Chiamata IPC reale 'file_write' con firma { projectPath, rel, content }
			await invoke('file_write', {
				projectPath,
				rel,
				content
			});

			if (this.draft.definition.action.kind === 'command') {
				const cmd = this.draft.definition.action as CommandAction;
				if (!cmd.watchedFiles.includes(scriptPath)) {
					cmd.watchedFiles.push(scriptPath);
				}
			}

			this.currentScriptProposal.written = true;
			this.currentScriptProposal.error = undefined;
			await automationsStore.saveDraft(this.draft);
			return true;
		} catch (err) {
			this.currentScriptProposal.error = err instanceof Error ? err.message : String(err);
			throw err;
		}
	}

	/** Annulla l'operazione o il prompt corrente */
	async cancel(): Promise<void> {
		if (this.session) {
			if (this.session.pendingUi) {
				await this.session.cancelPendingUi();
			}
			await this.session.abort();
		}
		this.isBusy = false;
	}

	/** Pulisce risorse associate all'assistente */
	destroy() {
		if (this.session) {
			unregisterAssistantSession(this.session);
			void this.session.close().catch(() => {});
			this.session = null;
		}
	}
}
