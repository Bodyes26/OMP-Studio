/**
 * Test di unita' per la logica di gestione impostazioni modelli, sanitizzazione maxDynamic,
 * merge del catalogo su refresh singolo provider e filtro account soft-delete.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	mergeProviderIntoCatalog,
	isAuthAccountActive,
	getProviderEnvVarHint,
	resolveCatalogModel,
	sanitizeMaxDynamic,
	resolveActiveRole,
	nextCycleRole,
	parseRoleSelector,
	supportedThinkingLevels,
	clampThinkingLevel,
	type ModelDto,
	type AuthAccount
} from '../src/lib/stores/modelSettingsHelpers.ts';
import { composeSuggestionChips, type PromptSuggestion } from '../src/lib/stores/promptSuggestions.ts';

function createModel(provider: string, id: string): ModelDto {
	return {
		id,
		name: `Model ${id}`,
		provider,
		selector: `${provider}/${id}`,
		isCustom: false
	};
}

function createAccount(provider: string, id: number, disabledCause?: string): AuthAccount {
	return {
		id,
		provider,
		credentialType: 'oauth',
		disabledCause,
		hasCredential: true
	};
}

describe('ModelSettings: mergeProviderIntoCatalog', () => {
	it('preserva i modelli degli altri provider durante il refresh mirato', () => {
		const existing: ModelDto[] = [
			createModel('anthropic', 'claude-3-5-sonnet'),
			createModel('anthropic', 'claude-3-haiku'),
			createModel('openai', 'gpt-4o'),
			createModel('google', 'gemini-1.5-pro')
		];

		const refreshedAnthropic: ModelDto[] = [
			createModel('anthropic', 'claude-3-7-sonnet'),
			createModel('anthropic', 'claude-3-5-sonnet')
		];

		const result = mergeProviderIntoCatalog(existing, 'anthropic', refreshedAnthropic);

		// Deve contenere 4 modelli in totale
		assert.equal(result.length, 4);
		// I modelli openai e google non devono essere persi
		assert.ok(result.some((m) => m.selector === 'openai/gpt-4o'));
		assert.ok(result.some((m) => m.selector === 'google/gemini-1.5-pro'));
		// I modelli anthropic devono essere quelli rinfrescati
		assert.ok(result.some((m) => m.selector === 'anthropic/claude-3-7-sonnet'));
		assert.ok(result.some((m) => m.selector === 'anthropic/claude-3-5-sonnet'));
		assert.equal(result.some((m) => m.selector === 'anthropic/claude-3-haiku'), false);
	});

	it('gestisce il refresh di un provider non ancora presente nel catalogo', () => {
		const existing: ModelDto[] = [createModel('openai', 'gpt-4o')];
		const refreshed: ModelDto[] = [createModel('perplexity', 'sonar-pro')];

		const result = mergeProviderIntoCatalog(existing, 'perplexity', refreshed);
		assert.equal(result.length, 2);
		assert.ok(result.some((m) => m.selector === 'openai/gpt-4o'));
		assert.ok(result.some((m) => m.selector === 'perplexity/sonar-pro'));
	});
});

describe('ModelSettings: resolveCatalogModel', () => {
	// I gateway (cloudflare-ai-gateway, kilo, nanogpt, zenmux) pubblicano modelli
	// il cui `id` e' `anthropic/claude-opus-5`, identico al selettore del provider
	// nativo `anthropic`. Nel catalogo il gateway precede anthropic, quindi una
	// ricerca `selector || id` in un solo passaggio attribuiva il modello al gateway.
	const catalogWithGatewayCollision: ModelDto[] = [
		createModel('cloudflare-ai-gateway', 'anthropic/claude-opus-5'),
		createModel('kilo', 'anthropic/claude-opus-5'),
		createModel('anthropic', 'claude-opus-5'),
		createModel('zenmux', 'anthropic/claude-opus-5')
	];

	it('preferisce il match esatto sul selettore rispetto all id di un gateway', () => {
		const resolved = resolveCatalogModel(catalogWithGatewayCollision, 'anthropic/claude-opus-5');
		assert.equal(resolved?.provider, 'anthropic');
		assert.equal(resolved?.selector, 'anthropic/claude-opus-5');
	});

	it('ignora il suffisso di thinking del selettore di ruolo', () => {
		const resolved = resolveCatalogModel(catalogWithGatewayCollision, 'anthropic/claude-opus-5:high');
		assert.equal(resolved?.provider, 'anthropic');
	});

	it('risolve il selettore completo di un gateway sul gateway stesso', () => {
		const resolved = resolveCatalogModel(
			catalogWithGatewayCollision,
			'cloudflare-ai-gateway/anthropic/claude-opus-5'
		);
		assert.equal(resolved?.provider, 'cloudflare-ai-gateway');
	});

	it('ripiega sull id nudo quando nessun selettore corrisponde', () => {
		const resolved = resolveCatalogModel(catalogWithGatewayCollision, 'claude-opus-5');
		assert.equal(resolved?.provider, 'anthropic');
	});

	it('restituisce undefined su selettore vuoto o sconosciuto', () => {
		assert.equal(resolveCatalogModel(catalogWithGatewayCollision, ''), undefined);
		assert.equal(resolveCatalogModel(catalogWithGatewayCollision, 'inesistente/modello'), undefined);
	});
});

describe('ModelSettings: isAuthAccountActive', () => {
	it('esclude gli account soft-deleted con "deleted by user"', () => {
		const active = createAccount('anthropic', 1);
		const deleted = createAccount('anthropic', 2, 'deleted by user');
		const expired = createAccount('anthropic', 3, 'token expired');

		assert.equal(isAuthAccountActive(active), true);
		assert.equal(isAuthAccountActive(deleted), false);
		assert.equal(isAuthAccountActive(expired), true);
	});
});

describe('ModelSettings: getProviderEnvVarHint', () => {
	it('restituisce la variabile d ambiente per i provider noti', () => {
		assert.equal(getProviderEnvVarHint('anthropic'), 'ANTHROPIC_API_KEY');
		assert.equal(getProviderEnvVarHint('openai'), 'OPENAI_API_KEY');
		assert.equal(getProviderEnvVarHint('google-antigravity'), 'GEMINI_API_KEY');
		assert.equal(getProviderEnvVarHint('perplexity'), 'PERPLEXITY_API_KEY');
		assert.equal(getProviderEnvVarHint('groq'), 'GROQ_API_KEY');
	});

	it('restituisce null per provider sconosciuti o custom', () => {
		assert.equal(getProviderEnvVarHint('my-custom-ollama'), null);
	});
});

describe('Settings: sanitizzazione maxDynamic da stringhe legacy', () => {
	it('converte stringhe numeriche valide in numeri entro il range [1, 3]', () => {
		assert.equal(sanitizeMaxDynamic('1'), 1);
		assert.equal(typeof sanitizeMaxDynamic('1'), 'number');
		assert.equal(sanitizeMaxDynamic('2'), 2);
		assert.equal(sanitizeMaxDynamic('3'), 3);
	});

	it('effettua clamp su valori fuori range o stringhe non valide', () => {
		assert.equal(sanitizeMaxDynamic('10'), 3);
		assert.equal(sanitizeMaxDynamic('0'), 1);
		assert.equal(sanitizeMaxDynamic('-5'), 1);
		assert.equal(sanitizeMaxDynamic('non-un-numero'), 3); // default fallback
		assert.equal(sanitizeMaxDynamic(undefined), 3);
	});

	it('composeSuggestionChips gestisce correttamente maxDynamic stringa o numero', () => {
		const statics: PromptSuggestion[] = [];
		const dynamics = ['D1', 'D2', 'D3', 'D4'];

		const chipsNum = composeSuggestionChips(statics, dynamics, 2);
		assert.equal(chipsNum.length, 2);

		const chipsStr = composeSuggestionChips(statics, dynamics, '1' as unknown as number);
		assert.equal(chipsStr.length, 1);
	});
});

describe('Ruoli: ruolo attivo con modelli condivisi', () => {
	// Configurazione reale: default e plan sullo stesso Opus, quattro ruoli sullo stesso Flash.
	const roles = {
		plan: 'anthropic/claude-opus-5-5:max',
		smol: 'google-antigravity/gemini-3.8-flash:high',
		vision: 'google-antigravity/gemini-3.8-flash:high',
		default: 'anthropic/claude-opus-5-5:high',
		commit: 'google-antigravity/gemini-3.8-flash:high',
		task: 'google-antigravity/gemini-3.8-flash:high'
	};
	const opus = { provider: 'anthropic', id: 'claude-opus-5-5' };
	const flash = { provider: 'google-antigravity', id: 'gemini-3.8-flash' };

	it('il ruolo scelto vince sugli altri ruoli con lo stesso modello', () => {
		assert.equal(resolveActiveRole(roles, flash, 'high', 'commit'), 'commit');
		assert.equal(resolveActiveRole(roles, opus, 'max', 'plan'), 'plan');
	});

	it('senza scelta distingue per thinking prima che per ordine', () => {
		assert.equal(resolveActiveRole(roles, opus, 'high', null), 'default');
		assert.equal(resolveActiveRole(roles, opus, 'max', null), 'plan');
	});

	it("ignora la scelta quando il modello e' cambiato altrove", () => {
		assert.equal(resolveActiveRole(roles, opus, 'high', 'smol'), 'default');
		assert.equal(resolveActiveRole(roles, { provider: 'x', id: 'y' }, 'high', 'smol'), null);
	});

	it('il ciclo rapido percorre tutti i ruoli anche con modelli condivisi', () => {
		const order = ['plan', 'vision', 'default', 'smol', 'task', 'commit', 'slow'];
		const visited: string[] = [];
		let current: string | null = 'plan';
		for (let i = 0; i < 6; i++) {
			current = nextCycleRole(order, roles, current);
			visited.push(current!);
		}
		assert.deepEqual(visited, ['vision', 'default', 'smol', 'task', 'commit', 'plan']);
	});

	it('separa il provider solo sul primo segmento', () => {
		assert.deepEqual(parseRoleSelector('nanogpt/anthropic/claude-opus:high'), {
			provider: 'nanogpt',
			modelId: 'anthropic/claude-opus',
			thinking: 'high'
		});
	});
});

describe('Thinking: livelli accettati dal modello', () => {
	it('offre off piu gli sforzi dichiarati, in ordine di scala', () => {
		const opus = { reasoning: true, thinking: { mode: 'anthropic-adaptive', efforts: ['max', 'low', 'high', 'medium'] } };
		assert.deepEqual(supportedThinkingLevels(opus), ['off', 'low', 'medium', 'high', 'max']);
		// `omp models --json` pubblica gli sforzi come elenco piatto.
		assert.deepEqual(supportedThinkingLevels({ reasoning: true, thinking: ['minimal', 'xhigh'] }), ['off', 'minimal', 'xhigh']);
	});

	it('lascia solo off ai modelli che non ragionano', () => {
		assert.deepEqual(supportedThinkingLevels({ reasoning: false, thinking: { efforts: ['high'] } }), ['off']);
	});

	it('non restringe la scala quando gli sforzi non sono noti', () => {
		assert.equal(supportedThinkingLevels(null), null);
		assert.equal(supportedThinkingLevels({ reasoning: true }), null);
		assert.equal(supportedThinkingLevels({ reasoning: true, thinking: { mode: 'budget', efforts: [] } }), null);
	});

	it('riporta un livello fuori scala al piu alto non superiore, come omp', () => {
		const offered = ['auto', 'off', 'low', 'medium', 'high'];
		assert.equal(clampThinkingLevel('max', offered), 'high');
		assert.equal(clampThinkingLevel('medium', offered), 'medium');
		// Sotto il primo sforzo disponibile omp sale al primo sforzo, non spegne.
		assert.equal(clampThinkingLevel('minimal', offered), 'low');
	});

	it('non inventa un livello per auto o off assenti dalla scala', () => {
		assert.equal(clampThinkingLevel('auto', ['off', 'low']), null);
		assert.equal(clampThinkingLevel('high', ['auto', 'off']), 'off');
	});
});
