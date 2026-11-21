/**
 * Decisioni sull'identità delle copie (R-MI-32, R-MI-44).
 *
 * - Copie senza origin con lo stesso primo commit: si uniscono solo dopo la
 *   conferma dell'utente («È lo stesso progetto?»), e anche il «no» resta.
 *   La risposta vale su tutte le macchine collegate (R-MI-44): viaggia nello
 *   stato pubblicato da ogni finestra e vince la più recente, con l'orologio
 *   logico come la coda (R-MI-12).
 * - Repository rinominato su GitHub: il nome attuale di ogni slug, chiesto a
 *   GitHub una volta ogni tanto, unisce la copia rimasta col nome vecchio.
 */

import { load, type Store } from '@tauri-apps/plugin-store';
import { invoke, isTauri, LOCAL_MACHINE } from '#lib/backend/ipc.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { normalizeProjectPath, type Project } from './projects.svelte';
import { logicalClock } from './logicalClock.ts';
import {
	decide,
	isConfirmed,
	isRefused,
	mergeDecisions,
	pairId,
	toPortable,
	type LinkDecision
} from './linkDecisions.ts';

const FILE = 'project-links.json';
/** Ogni quanto si richiede a GitHub il nome attuale di uno slug. */
const CANONICAL_TTL_MS = 6 * 60 * 60 * 1000;
/** Le decisioni salvate prima di R-MI-44 contano come le più vecchie. */
const LEGACY_AT = 1;

/** Chi è una copia: macchina e cartella, stabile fra i riavvii. */
export function copyKeyOf(project: Pick<Project, 'machineId' | 'canonicalProjectPath'>): string {
	const path = project.canonicalProjectPath ? normalizeProjectPath(project.canonicalProjectPath).toLowerCase() : '';
	return `${project.machineId ?? LOCAL_MACHINE}::${path}`;
}

/** Decisioni nel formato di prima (solo questa finestra) → decisioni condivise. */
function migrateLegacy(linked: Record<string, string[]>, refused: string[]): LinkDecision[] {
	const result: LinkDecision[] = [];
	for (const [root, keys] of Object.entries(linked)) {
		for (let i = 0; i < keys.length; i++) {
			for (let j = i + 1; j < keys.length; j++) result.push(decide(keys[i], keys[j], root, true, LEGACY_AT));
		}
	}
	for (const pair of refused) {
		const [a, b] = pair.split('|');
		if (a && b) result.push(decide(a, b, '', false, LEGACY_AT));
	}
	return result;
}

class ProjectLinks {
	/** Coppia di copie (forma portabile) → ultima decisione. */
	decisions = $state<Record<string, LinkDecision>>({});
	/** Slug → nome attuale su GitHub (`null` se GitHub non lo sa dire). */
	canonical = $state<Record<string, string | null>>({});
	private store: Store | null = null;
	private ready: Promise<void> | null = null;
	private checkedAt = new Map<string, number>();

	init(): Promise<void> {
		if (!isTauri()) return Promise.resolve();
		return this.ready ??= (async () => {
			try {
				this.store = await load(FILE, { autoSave: false });
				const saved = await this.store.get<Record<string, LinkDecision>>('decisions');
				if (saved) {
					this.decisions = saved;
				} else {
					const legacy = migrateLegacy(
						(await this.store.get<Record<string, string[]>>('linked')) ?? {},
						(await this.store.get<string[]>('refused')) ?? []
					);
					this.decisions = mergeDecisions({}, legacy) ?? {};
				}
				for (const decision of Object.values(this.decisions)) logicalClock.observe(decision.at);
			} catch (error) {
				console.warn('Decisioni sulle copie non lette:', error);
			}
			this.follow();
		})();
	}

	/**
	 * Tiene le decisioni in forma portabile appena si conosce l'id di questa
	 * macchina, e assorbe quelle pubblicate dalle altre finestre (anche al
	 * ritorno di una macchina spenta: il suo stato arriva con la connessione).
	 */
	private follow(): void {
		$effect.root(() => {
			$effect(() => {
				const own = linkStore.status.machineId;
				if (!own) return;
				const incoming: LinkDecision[] = [];
				for (const decision of Object.values(this.decisions)) {
					const a = toPortable(decision.a, own);
					const b = toPortable(decision.b, own);
					if (a !== decision.a || b !== decision.b) incoming.push(decide(a, b, decision.root, decision.same, decision.at));
				}
				for (const host of Object.values(linkStore.hosts)) {
					for (const decision of host.linkDecisions ?? []) {
						logicalClock.observe(decision.at);
						incoming.push(decision);
					}
				}
				if (incoming.length === 0) return;
				let base = this.decisions;
				// Le chiavi locali appena tradotte lasciano il posto alla forma portabile.
				if (incoming.some((decision) => !base[pairId(decision.a, decision.b)])) {
					base = Object.fromEntries(Object.entries(base).filter(([, decision]) => !decision.a.startsWith(`${LOCAL_MACHINE}::`) && !decision.b.startsWith(`${LOCAL_MACHINE}::`)));
				}
				const merged = mergeDecisions(base, incoming);
				if (merged || base !== this.decisions) {
					this.decisions = merged ?? base;
					void this.save();
				}
			});
		});
	}

	private async save(): Promise<void> {
		if (!this.store) return;
		await this.store.set('decisions', $state.snapshot(this.decisions));
		await this.store.delete('linked');
		await this.store.delete('refused');
		await this.store.save();
	}

	private portable(key: string): string {
		return toPortable(key, linkStore.status.machineId);
	}

	/** Decisioni da pubblicare alle altre macchine (R-MI-44). */
	shared(): LinkDecision[] {
		const own = linkStore.status.machineId;
		if (!own) return [];
		return Object.values(this.decisions).filter((decision) => !decision.a.startsWith(`${LOCAL_MACHINE}::`) && !decision.b.startsWith(`${LOCAL_MACHINE}::`));
	}

	isConfirmed(root: string, copyKey: string): boolean {
		return isConfirmed(this.decisions, root, this.portable(copyKey));
	}

	isRefused(a: string, b: string): boolean {
		return isRefused(this.decisions, this.portable(a), this.portable(b));
	}

	/** Ultima decisione fra due copie, se c'è (per poterla cambiare). */
	decisionFor(a: string, b: string): LinkDecision | null {
		return this.decisions[pairId(this.portable(a), this.portable(b))] ?? null;
	}

	/** «È lo stesso progetto»: le copie si uniscono in una tessera. */
	link(root: string, copyKeys: readonly string[]): void {
		const keys = copyKeys.map((key) => this.portable(key));
		const at = logicalClock.now();
		const next = { ...this.decisions };
		for (let i = 0; i < keys.length; i++) {
			for (let j = i + 1; j < keys.length; j++) {
				const decision = decide(keys[i], keys[j], root, true, at);
				next[pairId(decision.a, decision.b)] = decision;
			}
		}
		this.decisions = next;
		void this.save();
	}

	/** «Sono diversi»: non si chiede più per questa coppia, su nessuna macchina. */
	refuse(a: string, b: string, root = ''): void {
		const decision = decide(this.portable(a), this.portable(b), root, false, logicalClock.now());
		this.decisions = { ...this.decisions, [pairId(decision.a, decision.b)]: decision };
		void this.save();
	}

	/**
	 * Nome attuale su GitHub di `slug`, se già noto; altrimenti lo chiede in
	 * sottofondo e per ora risponde `null`. Si legge dentro i calcoli della
	 * barra: la richiesta parte fuori dal calcolo, una sola per slug.
	 */
	canonicalSlug(slug: string | null | undefined): string | null {
		const key = slug?.trim().toLowerCase();
		if (!key || !isTauri()) return null;
		const last = this.checkedAt.get(key);
		if (last === undefined || Date.now() - last > CANONICAL_TTL_MS) {
			this.checkedAt.set(key, Date.now());
			queueMicrotask(() => {
				invoke<string | null>('github_canonical_repo', { slug: key })
					.then((name) => { if (this.canonical[key] !== name) this.canonical = { ...this.canonical, [key]: name }; })
					.catch(() => undefined);
			});
		}
		return this.canonical[key] ?? null;
	}
}

export const projectLinks = new ProjectLinks();
