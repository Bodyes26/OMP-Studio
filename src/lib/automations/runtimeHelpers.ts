/**
 * Helper per il runtime AI delle automazioni.
 *
 * Gestisce la risoluzione dei modelli, la composizione dei prompt multiprogetto (AUT-105),
 * le regole di sicurezza/conferma (AUT-027) e la protezione da fallback non autorizzati a pay-as-you-go.
 */

import type { AutomationDefinition, PromptAction, ResolvedAutomationTarget } from './types';
import { modelSettingsStore } from '#lib/stores/modelSettings.svelte.ts';
import { splitModelSelector } from '#lib/stores/modelSettingsHelpers.ts';
import { canonicalProvider, providersMatchStrict } from '#lib/stores/backgroundJobsHelpers.ts';
export interface ResolvedModelConfig {
	model: string;
	preventPayg: boolean;
	maxCostUsd?: number | null;
}

export interface PaygCheckResult {
	isPayg: boolean;
	reason?: string;
}

/**
 * Valuta rigorosamente se un modello è soggetto a costi a consumo (Pay-As-You-Go).
 * Rispetta le specifiche di sicurezza di AUT-026, AUT-079, AUT-080 e ACC-15:
 * - Solo provider locali e keyless garantiti (ollama, local, lmstudio, llamacpp, vllm, apple).
 * - Provider native OAuth-only flat rate documentati (google-gemini-cli, google-antigravity, openai-codex, github-copilot)
 *   con account OAuth valido e instradabile.
 * - Per provider ibridi come Anthropic (OAuth + API key): se è presente una chiave API o il percorso è ambiguo
 *   senza pin di enforcement nativo, fail-closed bloccato.
 * - Tutti gli altri provider (OpenRouter, Vertex Cloud, OpenAI API key, ecc.) o ignoti: considerati PAYG (fail-closed).
 */
export function checkModelPayAsYouGo(modelSelectorOrId: string): PaygCheckResult {
	const trimmed = modelSelectorOrId.trim();
	const parts = trimmed.split('/');
	const rawProvider = (parts.length > 1 ? parts[0] : '').toLowerCase();
	const modelId = (parts.length > 1 ? parts.slice(1).join('/') : parts[0]).toLowerCase();

	const catalogModel = modelSettingsStore.catalog?.find(
		(m) =>
			m.id.toLowerCase() === modelId ||
			m.selector.toLowerCase() === trimmed.toLowerCase()
	);
	const effectiveProvider = canonicalProvider(catalogModel?.provider || rawProvider);

	// 1. Modelli locali e keyless documentati: mai a consumo
	if (
		effectiveProvider === 'ollama' ||
		effectiveProvider === 'local' ||
		effectiveProvider === 'lmstudio' ||
		effectiveProvider === 'llamacpp' ||
		effectiveProvider === 'vllm' ||
		effectiveProvider === 'apple'
	) {
		return { isPayg: false };
	}

	const accounts = modelSettingsStore.authAccounts ?? [];

	// 2. Provider nativi OAuth-only a tariffa flat documentati (non hanno prodotto API key commerciale)
	if (
		effectiveProvider === 'google-gemini-cli' ||
		effectiveProvider === 'google-antigravity' ||
		effectiveProvider === 'openai-codex' ||
		effectiveProvider === 'github-copilot'
	) {
		const matching = accounts.find(
			(a: { provider: string; credentialType: string; hasCredential?: boolean }) =>
				providersMatchStrict(a.provider, effectiveProvider)
		);
		if (matching && matching.credentialType === 'oauth') {
			return { isPayg: false };
		}
		return {
			isPayg: true,
			reason: `Account OAuth flat non configurato o non valido per '${effectiveProvider}'.`
		};
	}

	// 3. Provider ibridi con abbonamento ma che ammettono anche API key (es. Anthropic)
	if (effectiveProvider === 'anthropic') {
		const anthropicAccounts = accounts.filter(
			(a: { provider: string; credentialType: string }) => providersMatchStrict(a.provider, 'anthropic')
		);
		const hasApiKey = anthropicAccounts.some((a: { credentialType: string }) => a.credentialType === 'api_key');
		const hasOauth = anthropicAccounts.some((a: { credentialType: string }) => a.credentialType === 'oauth');

		// Se è presente una chiave API o configurazione mista, l'SDK potrebbe addebitare a consumo senza pin nativo
		if (hasApiKey || !hasOauth) {
			return {
				isPayg: true,
				reason: `Il provider Anthropic dispone di chiave API o percorso ambiguo non vincolato a solo OAuth flat.`
			};
		}

		// Solo OAuth presente senza API key
		return { isPayg: false };
	}

	// 4. Tutti gli altri provider o modelli con costi da catalogo o ignoti: fail-closed
	return {
		isPayg: true,
		reason: `Il provider o modello '${trimmed}' non è un abbonamento flat documentato ed è soggetto a tariffazione a consumo.`
	};
}

export function isPayAsYouGoModel(modelSelectorOrId: string): boolean {
	return checkModelPayAsYouGo(modelSelectorOrId).isPayg;
}

/**
 * Risolve il modello effettivo da utilizzare per l'automazione.
 * Rispetta la scelta tra 'role' (es. default, smol, fast) e 'model' esplicito,
 * impedendo il fallback a modelli Pay-As-You-Go se non autorizzato (AUT-026/ACC-15).
 */
export function resolveActionModel(action: PromptAction): ResolvedModelConfig {
	const preventPayg = !action.allowPayAsYouGo;
	const maxCostUsd = action.maxCostUsd;

	if (action.modelMode === 'role') {
		const roleName = action.model || 'smol';
		const raw =
			modelSettingsStore.config?.modelRoles?.[roleName] ||
			modelSettingsStore.draftConfig?.modelRoles?.[roleName] ||
			roleName;

		const base = splitModelSelector(raw, modelSettingsStore.knownSelectors).base.trim();
		const effectiveModel = base || raw || 'smol';

		if (preventPayg) {
			const check = checkModelPayAsYouGo(effectiveModel);
			if (check.isPayg) {
				throw new Error(
					`Modello '${effectiveModel}' non autorizzato per questa automazione (AUT-026/ACC-15): ${check.reason || 'Soggetto a tariffazione Pay-As-You-Go. Abilitare "Consenti Pay-As-You-Go" per consentire l\'esecuzione.'}`
				);
			}
		}

		return {
			model: effectiveModel,
			preventPayg,
			maxCostUsd
		};
	}

	// Modalita' model specifica
	const modelName = (action.model || 'smol').trim();
	if (preventPayg) {
		const check = checkModelPayAsYouGo(modelName);
		if (check.isPayg) {
			throw new Error(
				`Modello '${modelName}' non autorizzato per questa automazione (AUT-026/ACC-15): ${check.reason || 'Soggetto a tariffazione Pay-As-You-Go. Abilitare "Consenti Pay-As-You-Go" per consentire l\'esecuzione.'}`
			);
		}
	}

	return {
		model: modelName,
		preventPayg,
		maxCostUsd
	};
}

/**
 * Compone il prompt per l'agente di automazione rispettando AUT-105:
 * per azioni aggregate su piu' progetti, preserva le istruzioni e i percorsi di ciascuno,
 * senza inventare gerarchie o precedenze non concordate. Preserva inoltre l'obbligo
 * di conferme per operazioni sensibili (AUT-027).
 */
export function buildAutomationPrompt(
	definition: AutomationDefinition,
	targets: ResolvedAutomationTarget[],
	contextInfo?: Record<string, unknown> | null
): string {
	const action = definition.action;
	const userPrompt = action.kind === 'prompt' ? action.prompt.trim() : '';

	const sections: string[] = [];

	// 1. Intestazione contesto automazione
	sections.push(`# Automazione: ${definition.name || 'Senza nome'}`);
	if (definition.description?.trim()) {
		sections.push(`Descrizione: ${definition.description.trim()}`);
	}

	// 2. Destinatari (AUT-003, AUT-105)
	if (targets.length > 1) {
		sections.push('## Destinatari multiprogetto (modalità aggregata)');
		sections.push(
			'Questa esecuzione opera sull\'insieme dei seguenti destinatari. Tutte le istruzioni e i vincoli di ciascun progetto sono ugualmente vincolanti; nessuna cartella prevale arbitrariamente sulle altre:\n' +
				targets.map((t) => `- [${t.name}] ${t.path} (${t.kind})`).join('\n')
		);
	} else if (targets.length === 1) {
		const target = targets[0];
		sections.push('## Destinatario');
		sections.push(`Progetto: ${target.name} (${target.path})`);
	} else if (definition.targets.cwd) {
		sections.push('## Cartella di lavoro');
		sections.push(`Percorso: ${definition.targets.cwd}`);
	}

	// 3. Metadati manifest di contesto (se disponibili)
	if (contextInfo && Object.keys(contextInfo).length > 0) {
		sections.push('## Metadati di contesto dell\'occorrenza');
		sections.push('```json\n' + JSON.stringify(contextInfo, null, 2) + '\n```');
	}

	// 4. Regole di sicurezza e conferme (AUT-027)
	sections.push('## Regole operative e conferme obbligatorie');
	sections.push(
		'- Conserva e applica tutte le regole e skill dell\'ambiente OMP Studio.\n' +
		'- L\'attivazione dell\'automazione autorizza l\'avvio del task, MA NON sostituisce le conferme per future operazioni sensibili o rischiose.\n' +
		'- Qualsiasi operazione distruttiva, pubblicazione esterna, sovrascrittura irreversibile o richiesta di chiarimento DEVE essere presentata all\'utente tramite il tool ask, attendendo esplicita conferma.'
	);

	// 5. Istruzioni utente
	sections.push('## Istruzioni da eseguire');
	sections.push(userPrompt || 'Esegui il controllo pianificato per questa automazione.');

	return sections.join('\n\n');
}
