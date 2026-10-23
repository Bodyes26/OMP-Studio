// Dissolvenza mirata allo switch di progetto o di corsia.
//
// Allo switch il guscio non anima le colonne: lascia ferme etichette, composer e
// righe invariate, e dissolve soltanto cio' che e' diverso da prima. Il modulo ha
// due compiti:
//   1. fotografare, PRIMA che le colonne cambino, cio' che ogni regione mostra
//      (`registerSnapshot` + `markSwitch`);
//   2. dissolvere a cascata gli elementi che risultano diversi (`dissolve`).
//
// Chi reagisce allo switch lo fa una volta sola per epoca (`SwitchInfo.epoch`) e
// solo dentro `SWITCH_WINDOW_MS`: un montaggio qualunque, fuori da uno switch, non
// anima mai. Il terminale non partecipa (Still-Room Rule, docs/DESIGN.md).

import { motionReduced } from '$lib/agent/motionState.svelte';

export type SwitchKind = 'project' | 'lane';

export interface SwitchInfo {
	kind: SwitchKind;
	/** Cresce a ogni switch: chi ha gia' reagito a un'epoca non reagisce due volte. */
	epoch: number;
}

/** Durata di un elemento che si dissolve: allineata a --dur-dissolve in app.css. */
export const DISSOLVE_MS = 300;
/** Distanza fra un elemento e il successivo nella cascata. */
export const DISSOLVE_STEP_MS = 35;
/** Tetto del ritardo: oltre, la cascata sembrerebbe un caricamento lento. */
export const DISSOLVE_MAX_DELAY_MS = 420;
/**
 * Tempo entro cui una regione che si monta o riceve dati in ritardo (albero file,
 * file non ancora in cache) conta ancora come parte dello switch.
 */
const SWITCH_WINDOW_MS = 1500;

const providers = new Map<string, () => unknown>();
let captured = new Map<string, unknown>();
let current: (SwitchInfo & { at: number }) | null = null;
let epoch = 0;

/**
 * Una regione dichiara come fotografare cio' che mostra. Restituisce la funzione
 * che annulla la registrazione, da usare come ritorno di un `$effect`.
 */
export function registerSnapshot(name: string, snapshot: () => unknown): () => void {
	providers.set(name, snapshot);
	return () => {
		if (providers.get(name) === snapshot) providers.delete(name);
	};
}

/**
 * Da chiamare prima che il DOM cambi (un `$effect.pre`): fotografa tutte le
 * regioni registrate e apre la finestra dello switch.
 */
export function markSwitch(kind: SwitchKind): void {
	captured = new Map();
	for (const [name, snapshot] of providers) {
		try {
			captured.set(name, snapshot());
		} catch {
			// Una fotografia mancata vale come regione senza stato precedente: tutto nuovo.
		}
	}
	epoch += 1;
	current = { kind, epoch, at: Date.now() };
}

/** Lo switch in corso, se la finestra e' ancora aperta. */
export function pendingSwitch(): SwitchInfo | null {
	if (!current || Date.now() - current.at > SWITCH_WINDOW_MS) return null;
	return { kind: current.kind, epoch: current.epoch };
}

/** Cio' che la regione `name` mostrava quando e' partito l'ultimo switch. */
export function switchSnapshot<T>(name: string): T | undefined {
	return captured.get(name) as T | undefined;
}

/**
 * Dissolve gli elementi dati, a cascata nell'ordine ricevuto. La classe
 * `.sw-dissolve` (app.css) dichiara solo la fase di partenza e viene tolta a
 * fine animazione: l'elemento torna allo stato naturale, senza residui.
 * Con movimento ridotto non fa nulla.
 */
export function dissolve(targets: Iterable<Element>): void {
	if (motionReduced()) return;
	let order = 0;
	for (const target of targets) {
		if (!(target instanceof HTMLElement) || !target.isConnected) continue;
		const delay = Math.min(order * DISSOLVE_STEP_MS, DISSOLVE_MAX_DELAY_MS);
		order += 1;
		target.style.setProperty('--sw-delay', `${delay}ms`);
		target.classList.add('sw-dissolve');
		const finish = () => {
			target.classList.remove('sw-dissolve');
			target.style.removeProperty('--sw-delay');
			target.removeEventListener('animationend', onEnd);
			window.clearTimeout(timer);
		};
		// L'evento risale dai figli: conta solo la fine dell'animazione dell'elemento.
		const onEnd = (event: AnimationEvent) => {
			if (event.target === target) finish();
		};
		target.addEventListener('animationend', onEnd);
		// Rete di sicurezza: se l'elemento esce dal DOM l'evento non arriva.
		const timer = window.setTimeout(finish, DISSOLVE_MS + delay + 120);
	}
}
