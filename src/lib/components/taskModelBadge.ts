/**
 * Badge modello di un task: nome leggibile e provider per il logo.
 *
 * Vive fuori dai componenti perche' la stessa risoluzione serve alla riga
 * della coda (`QueueTaskItem`) e alla coda rapida del popover di progetto:
 * due copie divergerebbero al primo cambio di contratto dei selettori.
 *
 * Regole, tutte prese dai dati reali della coda e dal catalogo modelli:
 * - selettore esplicito e riconosciuto dal catalogo: nome del modello;
 * - selettore esplicito sconosciuto: «Modello assegnato», con il selettore nel
 *   tooltip invece di inventare un nome;
 * - nessun selettore: «Modello della sessione», senza logo (il provider lo
 *   decide la sessione al momento dell'avvio).
 */

import { m } from '#lib/paraglide/messages.js';
import type { StudioTask } from '#lib/stores/tasks.svelte.ts';
import { modelSettingsStore } from '#lib/stores/modelSettings.svelte.ts';
import { resolveCatalogModel, splitModelSelector } from '#lib/stores/modelSettingsHelpers.ts';

export interface TaskModelBadge {
	/** Testo del badge. */
	label: string;
	/** Provider per `ProviderLogo`; vuoto quando il modello non e' assegnato. */
	provider: string;
	/** Spiegazione del badge nel tooltip. */
	tooltip: string;
	/** Vero quando il task usa il modello configurato per la sessione. */
	isSession: boolean;
}

/** I lettori del catalogo stanno nella chiamata: il `$derived` che la invoca resta reattivo. */
export function resolveTaskModelBadge(task: Pick<StudioTask, 'options'>): TaskModelBadge {
	const rawSelector = task.options?.modelSelector?.trim();
	if (rawSelector) {
		const { base } = splitModelSelector(rawSelector, modelSettingsStore.knownSelectors);
		const catModel = resolveCatalogModel(modelSettingsStore.catalog, base);
		const slashIdx = base.indexOf('/');
		const provider = catModel?.provider || (slashIdx >= 0 ? base.slice(0, slashIdx) : '');
		if (catModel?.name) {
			return {
				label: catModel.name,
				provider,
				tooltip: rawSelector,
				isSession: false
			};
		}
		return {
			label: m.queue_task_assigned_model(),
			provider,
			tooltip: m.queue_task_assigned_model_tooltip({ selector: rawSelector }),
			isSession: false
		};
	}
	return {
		label: m.queue_task_session_model(),
		provider: '',
		tooltip: m.queue_task_session_model_tooltip(),
		isSession: true
	};
}
