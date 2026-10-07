// Logica pura del layout del composer: nessuna dipendenza da Svelte o Tauri,
// cosi' si prova con i test di Node. Le funzioni non mutano gli argomenti.
//
// Regole:
// - il layout salvato conserva anche gli id sconosciuti (comando sparito da omp,
//   build piu' vecchia): `resolveLayout` li nasconde senza cancellarli, cosi' un
//   pin torna da solo se il comando ricompare;
// - i controlli `locked` (allegato, ruolo, modello, thinking) ci sono sempre,
//   nella posizione di fabbrica se l'utente non li ha spostati;
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
	const base = saved && saved.version === 1 ? saved : defaultLayout(manifest);

	const seen = new Set<string>();
	const kept: PinnedCommand[] = [];
	for (const pin of base.pinned) {
		const entry = entries.get(pin.id);
		if (!entry || seen.has(pin.id)) continue;
		if (!isSupported(entry, pin)) continue;
		seen.add(pin.id);
		kept.push(pin);
	}

	for (const entry of manifest) {
		if (!entry.locked || seen.has(entry.id) || !entry.defaultPlacement) continue;
		const { zone, form } = entry.defaultPlacement;
		const last = Math.max(-1, ...kept.filter((p) => p.zone === zone).map((p) => p.order));
		kept.push({ id: entry.id, zone, form, order: last + 1 });
	}
	return { version: 1, pinned: renumber(kept) };
}

/** Voci di una zona nell'ordine di disegno. */
export function itemsInZone(layout: ComposerLayout, zone: ComposerZone): PinnedCommand[] {
	return layout.pinned.filter((p) => p.zone === zone).sort((a, b) => a.order - b.order);
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

/**
 * Applica la risoluzione al layout salvato mantenendo gli id sconosciuti:
 * quello che si salva dopo una modifica e' il risultato dell'editor piu' i pin
 * orfani del salvato, cosi' non si perdono.
 */
export function mergeWithOrphans(
	edited: ComposerLayout,
	saved: ComposerLayout | null | undefined,
	manifest: Manifest
): ComposerLayout {
	if (!saved || saved.version !== 1) return edited;
	const entries = byId(manifest);
	const orphans = saved.pinned.filter((p) => !entries.has(p.id));
	if (orphans.length === 0) return edited;
	return { version: 1, pinned: [...edited.pinned, ...orphans.map((p) => ({ ...p }))] };
}
