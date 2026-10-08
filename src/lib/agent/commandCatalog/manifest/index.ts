// Manifesto curato dei comandi. L'ordine qui e' l'ordine di fabbrica nel composer:
// prima i controlli, poi i comandi omp, poi quelli del guscio Studio.
//
// I builtin di omp (origin 'omp') sono confrontati a ogni pubblicazione con
// `get_available_commands` da `scripts/check-commands.mjs`: un builtin senza voce
// qui, o una voce 'omp' che omp non espone piu', ferma la release.
// Procedura per aggiungere voci: docs/COMMANDS.md.

import type { CommandManifestEntry } from '../types';
import { CONTROL_ENTRIES } from './controls';
import { OMP_ENTRIES_MODES } from './omp-modes';
import { OMP_ENTRIES_SESSION } from './omp-session';
import { STUDIO_ENTRIES, STUDIO_LOOP_ENTRY } from './studio';

// ctl.limit e ctl.cost chiudono la riga sotto il composer (limite, poi costo a
// destra): nel manifesto stanno coi controlli, ma di fabbrica vanno dopo i
// toggle omp (fast, slow, prewalk), quindi si spostano in coda all'assemblaggio.
const TRAILING_READOUTS = ['ctl.limit', 'ctl.cost'];

// Azioni primarie fisse a sinistra nella toolbar: allegato e menzione @.
const LEADING_CONTROLS = ['ctl.attach', 'ctl.mention'];

// Comandi del guscio con collocazione di fabbrica nella toolbar:
// - «Ripeti» (/loop) segue subito allegato e @ (posizione approvata, variante B);
// - «A margine» (/btw) e «Modalita' Piano» (/plan) aprono la striscia centrale;
// - «Obiettivo» (guided-goal) chiude la striscia dei comandi di modalita'.
const LEADING_STUDIO_TOOLBAR = ['btw', 'plan'];

export const COMMAND_MANIFEST: readonly CommandManifestEntry[] = [
	...CONTROL_ENTRIES.filter((entry) => LEADING_CONTROLS.includes(entry.id)),
	STUDIO_LOOP_ENTRY,
	...STUDIO_ENTRIES.filter((entry) => LEADING_STUDIO_TOOLBAR.includes(entry.id)),
	...CONTROL_ENTRIES.filter(
		(entry) => !TRAILING_READOUTS.includes(entry.id) && !LEADING_CONTROLS.includes(entry.id)
	),
	...OMP_ENTRIES_MODES,
	...OMP_ENTRIES_SESSION,
	...STUDIO_ENTRIES.filter((entry) => !LEADING_STUDIO_TOOLBAR.includes(entry.id)),
	...TRAILING_READOUTS.flatMap((id) => CONTROL_ENTRIES.filter((entry) => entry.id === id))
];
