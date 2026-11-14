import { m } from '#lib/paraglide/messages.js';
import type { SetupStepId } from '#lib/stores/setupFlow.svelte.ts';

/**
 * Nome del passo, uno solo per indice, titolo e riepilogo.
 *
 * I getter sono funzioni perché l'etichetta deve seguire la lingua attiva senza
 * ricostruire chi la mostra: Paraglide risolve al momento della chiamata.
 */
const LABELS: Record<SetupStepId, () => string> = {
	engine: () => m.setup2_step_engine(),
	providers: () => m.setup2_step_providers(),
	roles: () => m.setup2_step_roles(),
	appearance: () => m.setup2_step_appearance(),
	updates: () => m.setup2_step_updates(),
	projects: () => m.setup2_step_projects(),
	github: () => m.setup2_step_github(),
	summary: () => m.setup2_step_summary()
};

export function stepLabel(id: SetupStepId): string {
	return LABELS[id]();
}
