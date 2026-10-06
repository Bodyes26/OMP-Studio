// Rune di Svelte 5 come funzioni identita' per i test eseguiti da Node.
//
// I moduli `.svelte.ts` usano `$state`/`$derived` a livello di modulo o di
// classe: compilati da Vite diventano segnali, eseguiti da Node sono variabili
// globali mai definite e il modulo fallisce gia' all'import. Con questo shim i
// test possono importare le funzioni pure di quei moduli (parser, normalizzatori).
// Non c'e' reattivita': gli effetti non girano e i valori derivati sono calcolati
// una sola volta, quindi i test non devono contare su di essa.
const identity = (value) => value;
const state = Object.assign(identity, {
	raw: identity,
	snapshot: (value) => structuredClone(value)
});
const derived = Object.assign(identity, { by: (fn) => fn() });
const effect = Object.assign(() => {}, {
	pre: () => {},
	root: (fn) => {
		fn();
		return () => {};
	},
	tracking: () => false
});

Object.assign(globalThis, { $state: state, $derived: derived, $effect: effect });
