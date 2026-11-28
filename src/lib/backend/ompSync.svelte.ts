import { invoke, isTauri, LOCAL_MACHINE } from './ipc.ts';
import { linkStore } from './link.svelte.ts';

export const categories = ['roles', 'general', 'agents', 'skills', 'rules', 'mcp'] as const;
export type Category = typeof categories[number];
interface Preferences { categories: Record<string, Category[]>; pinned: string[] }
interface Document { category: Category; key: string; text: string | null; updated: number; pinned?: string[] }
interface Conflict { id: string; machine: string; here: Document; there: Document }
interface Base { here: string | null; there: string | null }
const ids = (doc: Document) => `${doc.category}/${doc.key}`;
const empty = (doc: Document): Document => ({ ...doc, text: null, updated: 0, pinned: undefined });
const scope = { machine: LOCAL_MACHINE };
const storageKey = 'studio-omp-sync-baseline-v1';

async function digest(text: string | null): Promise<string | null> {
	if (text === null) return null;
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

class OmpSync {
	preferences = $state<Preferences>({ categories: {}, pinned: [] });
	conflicts = $state<Conflict[]>([]);
	errors = $state<Record<string, string>>({});
	busy = $state(false);
	private baseline: Record<string, Base> = {};
	private loading: Promise<void> | null = null;
	/** Giro chiesto mentre un altro era in corso: riparte appena quello finisce. */
	private pendingSync: { only?: string } | null = null;

	private load(): Promise<void> {
		return this.loading ??= (async () => {
			this.preferences = await invoke<Preferences>('omp_sync_preferences', {}, scope);
			try { this.baseline = JSON.parse(localStorage.getItem(storageKey) ?? '{}'); } catch { this.baseline = {}; }
		})().catch((error) => { this.loading = null; throw error; });
	}

	start(): () => void {
		if (!isTauri()) return () => {};
		const tick = () => { void this.sync().catch((error) => { this.errors = { ...this.errors, local: String(error) }; }); };
		tick();
		// Il giro legge e scrive preferenze, anche su un'altra macchina: a
		// finestra nascosta si salta, e il primo giro al ritorno rimette in
		// pari (S7-04). Il ritmo resta quello di prima quando si guarda.
		const timer = window.setInterval(() => {
			if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
			tick();
		}, 30_000);
		const onVisibility = () => {
			if (document.visibilityState === 'visible') tick();
		};
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			window.clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}

	async enable(machine: string, category: Category, enabled: boolean): Promise<void> {
		await this.load();
		const current = new Set(this.preferences.categories[machine] ?? []);
		if (enabled) current.add(category); else current.delete(category);
		await this.save({ ...this.preferences, categories: { ...this.preferences.categories, [machine]: [...current] } });
		if (!enabled) this.conflicts = this.conflicts.filter((c) => c.machine !== machine || c.here.category !== category);
		await this.sync();
	}

	async pin(role: string, enabled: boolean): Promise<void> {
		await this.load();
		const pinned = new Set(this.preferences.pinned);
		if (enabled) pinned.add(role); else pinned.delete(role);
		await this.save({ ...this.preferences, pinned: [...pinned] });
	}

	private async save(value: Preferences): Promise<void> {
		this.preferences = await invoke<Preferences>('omp_sync_preferences', { value: $state.snapshot(value) }, scope);
	}

	/**
	 * Un giro chiesto mentre un altro e' in corso non si perde (S3-link-front-30):
	 * `enable()` puo' cadere li' e la categoria appena accesa aspetterebbe il
	 * giro da 30 s senza dirlo. La richiesta si accoda e riparte a fine giro.
	 */
	async sync(only?: string): Promise<void> {
		await this.load();
		if (this.busy) {
			// L'ultima richiesta vince: un giro su tutte le macchine copre anche
			// quello chiesto per una sola.
			this.pendingSync = only === undefined ? {} : { only };
			return;
		}
		this.busy = true;
		try {
			for (const peer of linkStore.status.peers) {
				if ((only && only !== peer.id) || !peer.online || !peer.compatible || !this.preferences.categories[peer.id]?.length) continue;
				try {
					await this.reconcile(peer.id);
					const { [peer.id]: _, ...rest } = this.errors;
					this.errors = rest;
				} catch (error) { this.errors = { ...this.errors, [peer.id]: String(error) }; }
			}
		} finally {
			this.busy = false;
			localStorage.setItem(storageKey, JSON.stringify(this.baseline));
			const queued = this.pendingSync;
			this.pendingSync = null;
			if (queued !== null) void this.sync(queued.only);
		}
	}

	private async reconcile(machine: string): Promise<void> {
		const [local, remote] = await Promise.all([
			invoke<Document[]>('omp_sync_snapshot', { machine }, scope),
			invoke<Document[]>('omp_sync_snapshot', {}, { machine })
		]);
		const enabled = new Set(remote.filter((d) => !d.key).map((d) => d.category));
		const shared = new Set(local.filter((d) => !d.key && enabled.has(d.category)).map((d) => d.category));
		const here = new Map(local.filter((d) => d.key && shared.has(d.category)).map((d) => [ids(d), d]));
		const there = new Map(remote.filter((d) => d.key && shared.has(d.category)).map((d) => [ids(d), d]));
		const conflicts: Conflict[] = [];
		for (const key of new Set([...here.keys(), ...there.keys()])) {
			const a = here.get(key) ?? empty(there.get(key)!);
			const b = there.get(key) ?? empty(a);
			const id = `${machine}/${key}`;
			const [ah, bh] = await Promise.all([digest(a.text), digest(b.text)]);
			if (ah === bh) { this.baseline[id] = { here: ah, there: bh }; continue; }
			const previous = this.baseline[id];
			let fromHere: boolean;
			if (previous) {
				const aChanged = ah !== previous.here;
				const bChanged = bh !== previous.there;
				if (!aChanged && !bChanged) continue;
				if (aChanged && bChanged) { conflicts.push({ id, machine, here: a, there: b }); continue; }
				fromHere = aChanged;
			} else if (a.updated !== b.updated) fromHere = a.updated > b.updated;
			else { conflicts.push({ id, machine, here: a, there: b }); continue; }
			await this.apply(machine, a, b, fromHere, ah, bh);
		}
		this.conflicts = [...this.conflicts.filter((c) => c.machine !== machine), ...conflicts];
	}

	private async apply(machine: string, a: Document, b: Document, fromHere: boolean, ah: string | null, bh: string | null): Promise<void> {
		const target = fromHere ? machine : LOCAL_MACHINE;
		await invoke('omp_sync_apply', {
			...(fromHere ? {} : { machine }), document: fromHere ? a : b, expected: fromHere ? b.text : a.text
		}, { machine: target });
		// I ruoli fissati e le credenziali locali possono rendere diversi i file
		// applicati: registra l'effettivo contenuto condivisibile dopo la scrittura.
		const docs = await invoke<Document[]>('omp_sync_snapshot', fromHere ? {} : { machine }, { machine: target });
		const after = await digest(docs.find((d) => ids(d) === ids(a))?.text ?? null);
		this.baseline[`${machine}/${ids(a)}`] = fromHere ? { here: ah, there: after } : { here: after, there: bh };
	}

	async resolve(conflict: Conflict, keepHere: boolean): Promise<void> {
		const { machine, here, there } = conflict;
		await this.apply(machine, here, there, keepHere, await digest(here.text), await digest(there.text));
		localStorage.setItem(storageKey, JSON.stringify(this.baseline));
		this.conflicts = this.conflicts.filter((c) => c.id !== conflict.id);
	}
}

export const ompSync = new OmpSync();
