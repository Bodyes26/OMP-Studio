/**
 * Ultimo riepilogo noto di ogni altra macchina, conservato fra i riavvii
 * (R-MI-11, R-MI-15). Senza, riaprendo Studio con il Mac spento i suoi
 * progetti sparivano dalla barra: niente tessera, niente coda su cui
 * registrare task in attesa che il Mac torni.
 *
 * Si conservano solo progetti e corsie: le code hanno il loro specchio nello
 * store dei task, e sessioni e stato del run al riavvio sono comunque vecchi.
 */

import { load, type Store } from '@tauri-apps/plugin-store';
import { debounce } from 'lodash-es';
import type { DesktopHostSnapshot } from '#lib/backend/host.ts';

const FILE = 'remote-hosts.json';
const KEY = 'hosts';

let store: Store | null = null;

async function open(): Promise<Store> {
	store ??= await load(FILE, { autoSave: false });
	return store;
}

export async function loadCachedHosts(): Promise<Record<string, DesktopHostSnapshot>> {
	try {
		const value = await (await open()).get<Record<string, DesktopHostSnapshot>>(KEY);
		return value && typeof value === 'object' ? value : {};
	} catch (error) {
		console.warn('Riepiloghi delle altre macchine non letti:', error);
		return {};
	}
}

/** Salva i riepiloghi completi; quelli ridotti (versione diversa) non descrivono le tessere. */
export const saveCachedHosts = debounce(async (hosts: Record<string, DesktopHostSnapshot>) => {
	const trimmed = Object.fromEntries(Object.entries(hosts)
		.filter(([, snapshot]) => !snapshot.reduced)
		.map(([machine, snapshot]) => [machine, { ...snapshot, tasks: [], sessions: [], state: undefined }]));
	try {
		const target = await open();
		await target.set(KEY, trimmed);
		await target.save();
	} catch (error) {
		console.warn('Riepiloghi delle altre macchine non salvati:', error);
	}
}, 2000);
