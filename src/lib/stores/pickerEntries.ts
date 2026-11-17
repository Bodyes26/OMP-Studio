/**
 * Elenco unico dei progetti di tutte le macchine per il selettore (R-MI-21).
 *
 * Tre gruppi approvati in anteprima (F23, variante C): «In questa finestra»,
 * «Aperti su altre macchine» (aperti dove girano ma non in questa barra),
 * «Chiusi». La stessa cartella presente su più macchine è una voce sola: la
 * chiave è il repository GitHub quando c'è, altrimenti il nome della cartella.
 */

export type PickerGroup = 'window' | 'elsewhere' | 'closed';

export interface PickerCopy {
	machineId: string;
	machineName: string;
	local: boolean;
	online: boolean;
	state: 'open' | 'closed';
	path: string;
	/** Tessera di questa finestra o tessera nascosta da rimettere in barra. */
	projectId?: string;
}

export interface PickerEntry {
	key: string;
	name: string;
	label: string | null;
	hue: number | null;
	group: PickerGroup;
	copies: PickerCopy[];
	diverged: boolean;
	/** Tessera da attivare per le voci del gruppo «In questa finestra». */
	tileId: string | null;
}

export interface PickerSource {
	key: string;
	name: string;
	label?: string | null;
	hue?: number | null;
	copy: PickerCopy;
}

/** Chiave di unione: `owner/repo` in minuscolo, altrimenti il nome della cartella. */
export function pickerKey(repo: string | null | undefined, folderName: string): string {
	return repo ? `repo:${repo.toLowerCase()}` : `name:${folderName.toLowerCase()}`;
}

export function folderName(path: string): string {
	const parts = path.split(/[\\/]+/).filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

const GROUP_ORDER: Record<PickerGroup, number> = { window: 0, elsewhere: 1, closed: 2 };

/**
 * Compone le voci. `tiles` sono le tessere della barra (una per gruppo di
 * copie), `hidden` i progetti aperti altrove ma non qui, `closed` le cartelle
 * note ma chiuse. Una voce prende il gruppo «più vicino»: se una sua copia è
 * in barra è «In questa finestra», anche se su un'altra macchina è chiusa.
 */
export function buildPickerEntries(
	tiles: ReadonlyArray<{ id: string; key: string; name: string; label: string | null; hue: number | null; diverged: boolean; copies: PickerCopy[] }>,
	hidden: readonly PickerSource[],
	closed: readonly PickerSource[]
): PickerEntry[] {
	const byKey = new Map<string, PickerEntry>();
	for (const tile of tiles) {
		byKey.set(tile.key, {
			key: tile.key,
			name: tile.name,
			label: tile.label,
			hue: tile.hue,
			group: 'window',
			copies: [...tile.copies],
			diverged: tile.diverged,
			tileId: tile.id
		});
	}
	const add = (source: PickerSource, group: PickerGroup) => {
		const entry = byKey.get(source.key);
		if (!entry) {
			byKey.set(source.key, {
				key: source.key,
				name: source.name,
				label: source.label ?? null,
				hue: source.hue ?? null,
				group,
				copies: [source.copy],
				diverged: false,
				tileId: null
			});
			return;
		}
		// La stessa macchina non compare due volte: la copia aperta vince su
		// quella chiusa (la cartella aperta è la stessa).
		if (entry.copies.some((copy) => copy.machineId === source.copy.machineId)) return;
		entry.copies.push(source.copy);
		if (GROUP_ORDER[group] < GROUP_ORDER[entry.group]) entry.group = group;
	};
	for (const source of hidden) add(source, 'elsewhere');
	for (const source of closed) add(source, 'closed');
	const entries = [...byKey.values()];
	for (const entry of entries) {
		entry.copies.sort((a, b) => Number(b.local) - Number(a.local) || a.machineName.localeCompare(b.machineName));
	}
	return entries;
}

/** Filtro per macchine: con nessuna scelta passa tutto. */
export function filterPickerEntries(entries: readonly PickerEntry[], machines: ReadonlySet<string>, query: string): PickerEntry[] {
	const q = query.trim().toLowerCase();
	return entries.filter((entry) => {
		if (machines.size > 0 && !entry.copies.some((copy) => machines.has(copy.machineId))) return false;
		if (!q) return true;
		return entry.name.toLowerCase().includes(q) ||
			(entry.label?.toLowerCase().includes(q) ?? false) ||
			entry.copies.some((copy) => copy.path.toLowerCase().includes(q));
	});
}

/** Copia da aprire con un clic sulla riga: questa macchina se c'è, altrimenti la prima in linea. */
export function preferredClosedCopy(entry: PickerEntry): PickerCopy | undefined {
	const closed = entry.copies.filter((copy) => copy.state === 'closed' && copy.online);
	return closed.find((copy) => copy.local) ?? closed[0];
}
