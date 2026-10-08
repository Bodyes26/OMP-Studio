// Logica pura del layout del composer: nessuna dipendenza da Svelte o Tauri,
// cosi' si prova con i test di Node. Le funzioni non mutano gli argomenti.
//
// Regole:
// - il layout salvato conserva anche gli id sconosciuti (comando sparito da omp,
//   build piu' vecchia): `resolveLayout` li nasconde senza cancellarli, cosi' un
//   pin torna da solo se il comando ricompare;
// - i controlli `locked` (allegato, ruolo, modello, thinking) ci sono sempre,
//   nella posizione di fabbrica se l'utente non li ha spostati;
// - una voce fissata di fabbrica che il layout salvato non conosceva ancora
//   (`known`) compare nella sua posizione di fabbrica: le novita' arrivano anche
//   a chi ha personalizzato il composer, le rimozioni dell'utente restano;
// - una posizione e' valida solo se il manifesto la dichiara in `supported`.

import type {
	CommandManifestEntry,
	CommandPlacement,
	ComposerLayout,
	ComposerZone,
	PinnedCommand
} from './types';

export type Manifest = readonly CommandManifestEntry[];

const ZONES: readonly ComposerZone[] = ['toolbar', 'statusLine'];

/**
 * Voci diventate fissate di fabbrica quando i layout senza `known` erano gia'
 * in uso: prima erano pulsanti scritti a mano nel composer, fuori dal layout.
 * Per quei layout contano come mai viste, cosi' restano dove l'utente le vedeva.
 */
const ADDED_AFTER_LEGACY_LAYOUT: readonly string[] = ['btw', 'plan'];

/** Gruppi visivi della toolbar: il composer li disegna in quest'ordine, sinistra-centro-destra. */
const TOOLBAR_LEFT_IDS: readonly string[] = ['ctl.attach', 'ctl.mention'];
const TOOLBAR_RIGHT_IDS: readonly string[] = ['ctl.context'];

function byId(manifest: Manifest): Map<string, CommandManifestEntry> {
	return new Map(manifest.map((entry) => [entry.id, entry]));
}

export function isSupported(entry: CommandManifestEntry, placement: CommandPlacement): boolean {
	return entry.supported.some((p) => p.zone === placement.zone && p.form === placement.form);
}

/** Riassegna `order` 0..n-1 dentro ogni zona, mantenendo la sequenza attuale. */
function renumber(pinned: readonly PinnedCommand[]): PinnedCommand[] {
	const out: PinnedCommand[] = [];
	for (const zone of ZONES) {
		pinned
			.filter((p) => p.zone === zone)
			.sort((a, b) => a.order - b.order)
			.forEach((p, order) => out.push({ ...p, order }));
	}
	return out;
}

/** Layout di fabbrica: ogni voce con `defaultPlacement`, nell'ordine del manifesto. */
export function defaultLayout(manifest: Manifest): ComposerLayout {
	const pinned: PinnedCommand[] = [];
	for (const entry of manifest) {
		const placement = entry.defaultPlacement;
		if (!placement) continue;
		pinned.push({ id: entry.id, zone: placement.zone, form: placement.form, order: pinned.length });
	}
	return { version: 1, pinned: renumber(pinned) };
}

/**
 * Layout effettivo da disegnare: parte da quello salvato (o dal default), scarta
 * id sconosciuti e posizioni non supportate, aggiunge i controlli bloccati mancanti.
 * Non e' da risalvare: il salvato resta com'e'.
 */
export function resolveLayout(saved: ComposerLayout | null | undefined, manifest: Manifest): ComposerLayout {
	const entries = byId(manifest);
	const usable = saved && saved.version === 1 ? saved : null;
	const base = usable ?? defaultLayout(manifest);

	const seen = new Set<string>();
	let kept: PinnedCommand[] = [];
	for (const pin of base.pinned) {
		const entry = entries.get(pin.id);
		if (!entry || seen.has(pin.id)) continue;
		if (!isSupported(entry, pin)) continue;
		seen.add(pin.id);
		kept.push(pin);
	}
	kept = renumber(kept);

	const known = usable ? knownIds(usable, manifest) : null;
	const factory = defaultLayout(manifest);
	for (const entry of manifest) {
		if (seen.has(entry.id) || !entry.defaultPlacement) continue;
		// Una voce gia' nota e assente e' stata tolta dall'utente: resta fuori.
		if (!entry.locked && (!known || known.has(entry.id))) continue;
		kept = insertAtFactoryPosition(kept, factory, entry.id, entry.defaultPlacement);
		seen.add(entry.id);
	}
	return { version: 1, pinned: kept };
}

function knownIds(saved: ComposerLayout, manifest: Manifest): Set<string> {
	if (saved.known) return new Set(saved.known);
	return new Set(manifest.map((entry) => entry.id).filter((id) => !ADDED_AFTER_LEGACY_LAYOUT.includes(id)));
}

/**
 * Inserisce `id` subito dopo la voce che lo precede nel layout di fabbrica e che
 * e' ancora nella stessa zona; se non ce n'e' nessuna, in testa alla zona.
 */
function insertAtFactoryPosition(
	pinned: PinnedCommand[],
	factory: ComposerLayout,
	id: string,
	placement: CommandPlacement
): PinnedCommand[] {
	const factoryZone = itemsInZone(factory, placement.zone).map((p) => p.id);
	const before = factoryZone.slice(0, factoryZone.indexOf(id)).reverse();
	const anchor = before
		.map((prevId) => pinned.find((p) => p.id === prevId && p.zone === placement.zone))
		.find((p) => p !== undefined);
	const order = anchor ? anchor.order + 0.5 : -0.5;
	return renumber([...pinned, { id, zone: placement.zone, form: placement.form, order }]);
}

/** Voci di una zona nell'ordine di disegno. */
export function itemsInZone(layout: ComposerLayout, zone: ComposerZone): PinnedCommand[] {
	return layout.pinned.filter((p) => p.zone === zone).sort((a, b) => a.order - b.order);
}

/**
 * Ripartizione visiva della toolbar, la stessa nel composer e nell'anteprima delle
 * impostazioni: allegato e @ a sinistra, contesto a destra accanto all'invio, il
 * resto nella striscia centrale. Ogni gruppo segue l'ordine del layout.
 */
export function partitionToolbar(pins: readonly PinnedCommand[]): {
	left: PinnedCommand[];
	center: PinnedCommand[];
	right: PinnedCommand[];
} {
	return {
		left: pins.filter((p) => TOOLBAR_LEFT_IDS.includes(p.id)),
		center: pins.filter((p) => !TOOLBAR_LEFT_IDS.includes(p.id) && !TOOLBAR_RIGHT_IDS.includes(p.id)),
		right: pins.filter((p) => TOOLBAR_RIGHT_IDS.includes(p.id))
	};
}

/** Posizione in cui finisce un pin nuovo: quella di fabbrica se c'e', altrimenti la prima supportata. */
export function suggestedPlacement(entry: CommandManifestEntry): CommandPlacement | null {
	return entry.defaultPlacement ?? entry.supported[0] ?? null;
}

/**
 * Fissa un comando (o lo sposta se gia' fissato) in fondo alla zona.
 * Restituisce il layout invariato se la posizione non e' supportata.
 * `layout` e' quello gia' risolto, non quello salvato grezzo.
 */
export function pin(
	layout: ComposerLayout,
	manifest: Manifest,
	id: string,
	placement?: CommandPlacement
): ComposerLayout {
	const entry = byId(manifest).get(id);
	if (!entry) return layout;
	const target = placement ?? suggestedPlacement(entry);
	if (!target || !isSupported(entry, target)) return layout;
	const rest = layout.pinned.filter((p) => p.id !== id);
	const last = Math.max(-1, ...rest.filter((p) => p.zone === target.zone).map((p) => p.order));
	return {
		version: 1,
		pinned: renumber([...rest, { id, zone: target.zone, form: target.form, order: last + 1 }])
	};
}

/** Toglie il pin. I controlli `locked` non si rimuovono. */
export function unpin(layout: ComposerLayout, manifest: Manifest, id: string): ComposerLayout {
	const entry = byId(manifest).get(id);
	if (entry?.locked) return layout;
	return { version: 1, pinned: renumber(layout.pinned.filter((p) => p.id !== id)) };
}

/**
 * Sposta un pin alla posizione `index` di `placement.zone` (0 = primo), cambiando
 * zona e/o forma se serve. Indice fuori intervallo viene limitato alla coda.
 */
export function movePin(
	layout: ComposerLayout,
	manifest: Manifest,
	id: string,
	placement: CommandPlacement,
	index: number
): ComposerLayout {
	const entry = byId(manifest).get(id);
	if (!entry || !isSupported(entry, placement)) return layout;
	if (!layout.pinned.some((p) => p.id === id)) return layout;

	const rest = layout.pinned.filter((p) => p.id !== id);
	const zoneItems = rest.filter((p) => p.zone === placement.zone).sort((a, b) => a.order - b.order);
	const at = Math.max(0, Math.min(index, zoneItems.length));
	zoneItems.splice(at, 0, { id, zone: placement.zone, form: placement.form, order: at });
	const others = rest.filter((p) => p.zone !== placement.zone);
	return {
		version: 1,
		pinned: renumber([...others, ...zoneItems.map((p, order) => ({ ...p, order }))])
	};
}

/** Fissa (se serve) e colloca `id` alla posizione `index` della zona: e' il rilascio di un trascinamento. */
export function placePin(
	layout: ComposerLayout,
	manifest: Manifest,
	id: string,
	placement: CommandPlacement,
	index: number
): ComposerLayout {
	const withPin = layout.pinned.some((p) => p.id === id) ? layout : pin(layout, manifest, id, placement);
	return movePin(withPin, manifest, id, placement, index);
}

/**
 * Layout da salvare dopo una modifica nell'editor: il risultato dell'editor, i pin
 * orfani del salvato (comandi che questa build non conosce, cosi' non si perdono)
 * e `known` con tutti gli id visti finora, perche' le voci tolte non ricompaiano.
 */
export function layoutToSave(
	edited: ComposerLayout,
	saved: ComposerLayout | null | undefined,
	manifest: Manifest
): ComposerLayout {
	const usable = saved && saved.version === 1 ? saved : null;
	const entries = byId(manifest);
	const orphans = usable ? usable.pinned.filter((p) => !entries.has(p.id)) : [];
	const known = new Set([...(usable?.known ?? []), ...manifest.map((entry) => entry.id)]);
	return {
		version: 1,
		pinned: [...edited.pinned.map((p) => ({ ...p })), ...orphans.map((p) => ({ ...p }))],
		known: [...known]
	};
}
/** Alias retrocompatibile di `layoutToSave`. */
export const mergeWithOrphans = layoutToSave;
