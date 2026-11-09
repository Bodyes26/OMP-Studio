/**
 * Tipi, costanti di fabbrica e logica di composizione pura per le Direttive dei Task.
 *
 * Principi (docs/DECISIONS.md & PRODUCT.md):
 * - Le direttive sono istruzioni semantiche aggiunte al prompt dei task (prima o dopo il testo principale).
 * - I 4 preset di fabbrica (Piano, Discussione, Minimale, Ricerca) sono modificabili, nascondibili e ripristinabili.
 * - Le direttive personalizzate create dall'utente possono essere create, modificate, riordinate ed eliminate.
 * - Un task memorizza uno snapshot immutabile delle direttive attive al momento della creazione/modifica.
 */

import { m } from '#lib/paraglide/messages.js';

/** Un messaggio Paraglide senza parametri, invocabile per lingua. */
type LocalizedMessage = (options: { locale: 'en' | 'it' }) => string;
export type DirectivePlacement = 'before' | 'after';
export type FactoryDirectiveKey = 'plan' | 'discussion' | 'minimal' | 'research';

export interface TaskDirective {
	id: string;
	factoryKey?: FactoryDirectiveKey;
	name: string;
	description: string;
	tag: string;
	prompt: string;
	placement: DirectivePlacement;
	order: number;
	revision: number;
	hidden?: boolean;
}

export interface TaskDirectiveSnapshot {
	id: string;
	factoryKey?: FactoryDirectiveKey;
	name: string;
	description: string;
	tag: string;
	prompt: string;
	placement: DirectivePlacement;
	order: number;
	revision: number;
}

export const FACTORY_DIRECTIVES: readonly TaskDirective[] = [
	{
		id: 'dir_factory_plan',
		factoryKey: 'plan',
		// Nome e descrizione sono mostrati nella UI: nascono nella lingua attiva.
		get name() {
			return m.directive_factory_plan_name();
		},
		get description() {
			return m.directive_factory_plan_desc();
		},
		tag: '/plan',
		prompt:
			'[Modalita Piano: formula prima un piano di esecuzione dettagliato passo-passo ed esponilo per approvazione prima di procedere con modifiche.]',
		placement: 'before',
		order: 10,
		revision: 1
	},
	{
		id: 'dir_factory_discussion',
		factoryKey: 'discussion',
		get name() {
			return m.directive_factory_discussion_name();
		},
		get description() {
			return m.directive_factory_discussion_desc();
		},
		tag: '/grill-me',
		prompt:
			"[Modalita Discussione: NON modificare codice subito. Analizza il progetto e usa la skill /grill-me o interroga l'utente con domande mirate per chiarire decisioni, vincoli e architettura prima di procedere.]",
		placement: 'before',
		order: 20,
		revision: 1
	},
	{
		id: 'dir_factory_minimal',
		factoryKey: 'minimal',
		get name() {
			return m.directive_factory_minimal_name();
		},
		get description() {
			return m.directive_factory_minimal_desc();
		},
		tag: '/ponytail',
		prompt:
			'[Modalita Minimale: applica la soluzione piu pigra, semplice e minimale possibile (/ponytail). Evita astrazioni premature, boilerplate o nuove dipendenze se non indispensabili.]',
		placement: 'before',
		order: 30,
		revision: 1
	},
	{
		id: 'dir_factory_research',
		factoryKey: 'research',
		get name() {
			return m.directive_factory_research_name();
		},
		get description() {
			return m.directive_factory_research_desc();
		},
		tag: 'Web',
		prompt:
			"[Direttiva Ricerca Online: Dopo aver analizzato al completo la richiesta e tutto il codice collegato nel progetto, effettua ricerche online approfondite sull'ambito e sulla richiesta (documentazione, riferimenti, librerie e best practice) prima di procedere con l'implementazione o le modifiche.]",
		placement: 'after',
		order: 40,
		revision: 1
	}
] as const;

/**
 * Crea uno snapshot congelato da una direttiva di catalogo.
 */
export function createDirectiveSnapshot(
	directive: TaskDirective | TaskDirectiveSnapshot
): TaskDirectiveSnapshot {
	return {
		id: directive.id,
		factoryKey: directive.factoryKey,
		name: directive.name,
		description: directive.description,
		tag: directive.tag,
		prompt: directive.prompt,
		placement: directive.placement,
		order: directive.order,
		revision: directive.revision
	};
}

/**
 * Restituisce la definizione originaria di fabbrica per una chiave specificata.
 */
export function getFactoryDirective(key: FactoryDirectiveKey): TaskDirective | undefined {
	return FACTORY_DIRECTIVES.find((d) => d.factoryKey === key);
}

/**
 * Restituisce il nome localizzato della direttiva di catalogo.
 * Se e' un preset di fabbrica (non modificato dall'utente), ritorna il messaggio Paraglide.
 */
export function directiveDisplayName(directive: {
	factoryKey?: FactoryDirectiveKey | null;
	id?: string;
	name: string;
}): string {
	const key = directive.factoryKey ?? (directive.id?.replace(/^dir_factory_/, '') as FactoryDirectiveKey | undefined);
	const name = directive.name ?? '';
	// Lo snapshot salvato porta il nome nella lingua in cui e' nato: entrambe
	// le varianti contano come "non personalizzato".
	const isFactory = (message: LocalizedMessage) =>
		!name || name === message({ locale: 'it' }) || name === message({ locale: 'en' });
	if (key === 'plan' && isFactory(m.directive_factory_plan_name)) {
		return m.directive_factory_plan_name();
	}
	if (key === 'discussion' && isFactory(m.directive_factory_discussion_name)) {
		return m.directive_factory_discussion_name();
	}
	if (key === 'minimal' && isFactory(m.directive_factory_minimal_name)) {
		return m.directive_factory_minimal_name();
	}
	if (key === 'research' && isFactory(m.directive_factory_research_name)) {
		return m.directive_factory_research_name();
	}
	return name;
}

/**
 * Restituisce la descrizione localizzata della direttiva di catalogo.
 * Se e' un preset di fabbrica (non modificato dall'utente), ritorna il messaggio Paraglide.
 */
export function directiveDisplayDescription(directive: {
	factoryKey?: FactoryDirectiveKey | null;
	id?: string;
	description?: string;
}): string {
	const key = directive.factoryKey ?? (directive.id?.replace(/^dir_factory_/, '') as FactoryDirectiveKey | undefined);
	const desc = directive.description ?? '';
	// Il catalogo salvato porta il testo della lingua in cui e' nato: si
	// riconosce il preset confrontando entrambe le varianti.
	const isFactory = (message: LocalizedMessage) =>
		!desc || desc === message({ locale: 'it' }) || desc === message({ locale: 'en' });
	if (key === 'plan' && isFactory(m.directive_factory_plan_desc)) {
		return m.directive_factory_plan_desc();
	}
	if (key === 'discussion' && isFactory(m.directive_factory_discussion_desc)) {
		return m.directive_factory_discussion_desc();
	}
	if (key === 'minimal' && isFactory(m.directive_factory_minimal_desc)) {
		return m.directive_factory_minimal_desc();
	}
	if (key === 'research' && isFactory(m.directive_factory_research_desc)) {
		return m.directive_factory_research_desc();
	}
	return desc;
}

/**
 * Confronta la revisione di uno snapshot nel task con il catalogo corrente.
 */
export function compareDirectiveRevision(
	snapshot: TaskDirectiveSnapshot,
	catalog: TaskDirective[]
): 'up_to_date' | 'upgrade_available' | 'orphan' {
	const current = catalog.find((d) => d.id === snapshot.id);
	if (!current) return 'orphan';
	if (current.revision > snapshot.revision) return 'upgrade_available';
	return 'up_to_date';
}

/**
 * Valida un singolo oggetto direttiva.
 */
export function isTaskDirective(value: unknown): value is TaskDirective {
	if (!value || typeof value !== 'object') return false;
	const d = value as Record<string, unknown>;
	return (
		typeof d.id === 'string' &&
		d.id.trim().length > 0 &&
		typeof d.name === 'string' &&
		typeof d.description === 'string' &&
		typeof d.tag === 'string' &&
		typeof d.prompt === 'string' &&
		(d.placement === 'before' || d.placement === 'after') &&
		typeof d.order === 'number' &&
		typeof d.revision === 'number'
	);
}

/**
 * Valida un singolo snapshot congelato.
 */
export function isTaskDirectiveSnapshot(value: unknown): value is TaskDirectiveSnapshot {
	if (!value || typeof value !== 'object') return false;
	const d = value as Record<string, unknown>;
	return (
		typeof d.id === 'string' &&
		d.id.trim().length > 0 &&
		typeof d.name === 'string' &&
		typeof d.tag === 'string' &&
		typeof d.prompt === 'string' &&
		(d.placement === 'before' || d.placement === 'after') &&
		typeof d.order === 'number' &&
		typeof d.revision === 'number'
	);
}

/**
 * Sanitizza e normalizza il catalogo delle direttive salvato su disco.
 * Assicura che tutti i preset di fabbrica siano presenti (se mancanti, vengono reinseriti)
 * e che l'ordinamento sia valido.
 */
export function sanitizeDirectivesCatalog(input: unknown): TaskDirective[] {
	const result: TaskDirective[] = [];
	const seenIds = new Set<string>();

	if (Array.isArray(input)) {
		for (const item of input) {
			if (isTaskDirective(item) && !seenIds.has(item.id)) {
				seenIds.add(item.id);
				result.push({
					id: item.id.trim(),
					factoryKey: item.factoryKey,
					name: item.name.trim(),
					description: item.description.trim(),
					tag: item.tag.trim(),
					prompt: item.prompt.trim(),
					placement: item.placement === 'after' ? 'after' : 'before',
					order: typeof item.order === 'number' ? item.order : result.length * 10,
					revision: typeof item.revision === 'number' && item.revision > 0 ? item.revision : 1,
					hidden: item.hidden === true
				});
			}
		}
	}

	// Assicura che i 4 preset di fabbrica esistano sempre nel catalogo
	for (const factory of FACTORY_DIRECTIVES) {
		const existing = result.find(
			(d) => d.id === factory.id || (factory.factoryKey && d.factoryKey === factory.factoryKey)
		);
		if (!existing) {
			result.push({ ...factory });
			seenIds.add(factory.id);
		}
	}

	return result.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * Compone il testo del prompt finale applicando le direttive selezionate
 * nel corretto ordine deterministico:
 * 1. Direttive `before` (in ordine crescente di `order`);
 * 2. Corpo del prompt utente;
 * 3. Direttive `after` (in ordine crescente di `order`).
 */
export function applyTaskDirectives(
	prompt: string,
	directives?: (TaskDirective | TaskDirectiveSnapshot)[]
): string {
	const body = prompt.trim();
	if (!directives || directives.length === 0) {
		return body;
	}

	const beforeList = directives
		.filter((d) => d.placement === 'before' && d.prompt && d.prompt.trim().length > 0)
		.sort((a, b) => a.order - b.order)
		.map((d) => d.prompt.trim());

	const afterList = directives
		.filter((d) => d.placement === 'after' && d.prompt && d.prompt.trim().length > 0)
		.sort((a, b) => a.order - b.order)
		.map((d) => d.prompt.trim());

	let result = body;

	if (beforeList.length > 0) {
		const beforeBlock = beforeList.join('\n\n');
		result = result ? `${beforeBlock}\n\n${result}` : beforeBlock;
	}

	if (afterList.length > 0) {
		const afterBlock = afterList.join('\n\n');
		result = result ? `${result}\n\n${afterBlock}` : afterBlock;
	}

	return result;
}
