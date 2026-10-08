// Contratto del catalogo dei comandi e del layout del composer.
//
// Il manifesto (`manifest/*.ts`) e' l'unica fonte di verita' curata: alimenta la
// voce Impostazioni > Comandi, il menu `/`, i pin del composer e il controllo di
// release che confronta i builtin di omp con quanto descritto qui.
// Il layout dell'utente salva solo {id, zona, forma, ordine}: l'id e' stabile,
// quindi i pin sopravvivono agli aggiornamenti di omp.

/** Da dove viene il comando. `control` = controllo del composer che non e' uno slash. */
export type CommandOrigin = 'omp' | 'studio' | 'control';

/** Aree del composer in cui un comando puo' essere fissato. */
export type ComposerZone = 'toolbar' | 'statusLine';

/**
 * Forma di resa dentro una zona:
 * - `icon`: pulsante quadrato con sola icona (tooltip col nome);
 * - `chip`: icona + etichetta breve, adatta a mostrare uno stato.
 */
export type ComposerForm = 'icon' | 'chip';

/** Comportamento del controllo quando e' fissato nel composer. */
export type CommandControlKind =
	/** Attiva/disattiva una modalita' (es. fast, prewalk): ha stato. */
	| 'toggle'
	/** Sceglie un valore (modello, ruolo, thinking, effort). */
	| 'picker'
	/** Lancia il comando una volta, come se fosse digitato (es. compact). */
	| 'action'
	/** Apre un pannello o una vista di Studio. */
	| 'panel'
	/** Mostra solo un valore (costo, limite, contesto). */
	| 'readout'
	/** Nessun controllo dedicato: si usa solo da menu `/` o dal catalogo. */
	| 'none';

export type CommandCategory =
	| 'modes' // fast, slow, prewalk, ratchet, advisor, extended-context…
	| 'models' // model, modelpreset, effort, role, thinking
	| 'context' // context, compact, handoff, shake, @, memory…
	| 'session' // new, resume, fork, tree, rename, move, export, share…
	| 'workspace' // add-dir, remove-dir, dirs, wt, git, terminal…
	| 'tools' // tools, mcp, ssh, browser, todo, jobs, trace, dump…
	| 'extensions' // plugins, marketplace, reload-plugins
	| 'info' // usage, stats, changelog, help, cost
	| 'security' // security
	| 'app'; // settings, login, quit…

export interface CommandPlacement {
	zone: ComposerZone;
	form: ComposerForm;
}

/** Testi bilingui: ogni campo e' obbligatorio in entrambe le lingue. */
export interface CommandText {
	/** Nome leggibile (2-3 parole), es. "Pre-walk". */
	title: string;
	/** Una frase: che cosa fa. */
	summary: string;
	/** 1-3 vantaggi concreti, uno per riga di array. */
	benefits: string[];
	/** 1-3 esempi d'uso, con il comando digitato e una nota breve. */
	examples: { command: string; note: string }[];
	/** Quando conviene usarlo (opzionale, una frase). */
	whenToUse?: string;
}

export type CommandTexts = { it: CommandText; en: CommandText };

export interface CommandManifestEntry {
	/** Nome senza slash per i comandi (`prewalk`); per i controlli un id fisso (`attach`, `model`…). */
	id: string;
	origin: CommandOrigin;
	category: CommandCategory;
	/** Nome di un'icona esportata da `src/lib/icons.ts` (es. `IconAt`). */
	icon: string;
	control: CommandControlKind;
	/** Posizioni consentite. Vuoto = solo catalogo/menu `/`. */
	supported: CommandPlacement[];
	/** Posizione di fabbrica. `null` = non fissato di default. Deve stare in `supported`. */
	defaultPlacement: CommandPlacement | null;
	/** Controlli che l'utente non puo' rimuovere dal composer (allegato, ruolo, modello, thinking). */
	locked?: boolean;
	/** Sintassi argomenti, es. `[istruzioni]`: solo informativa per il catalogo. */
	argsHint?: string;
	text: CommandTexts;
}

/** Una voce fissata dall'utente. `order` e' crescente dentro la stessa zona. */
export interface PinnedCommand {
	id: string;
	zone: ComposerZone;
	form: ComposerForm;
	order: number;
}

/**
 * Layout salvato. `null` nelle impostazioni = usa i valori di fabbrica.
 * `known` elenca gli id del manifesto esistenti all'ultimo salvataggio: una voce
 * fissata di fabbrica che non vi compare e' nuova e compare da sola nel composer,
 * mentre una gia' nota e assente e' stata tolta dall'utente e resta fuori.
 */
export interface ComposerLayout {
	version: 1;
	pinned: PinnedCommand[];
	known?: string[];
}
