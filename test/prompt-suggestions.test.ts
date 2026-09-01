/**
 * Contratti osservabili dei Suggerimenti Prompt del composer.
 *
 * Difende tre invarianti che l'utente percepisce direttamente:
 * 1. Un `settings.json` scritto da una versione precedente non fa perdere i preset.
 * 2. Le chip statiche stanno sempre davanti e le dinamiche si accodano, cosi'
 *    nessuna scorciatoia Alt+N cambia bersaglio quando i suggerimenti generati
 *    arrivano qualche secondo dopo la fine del turno.
 * 3. Una risposta generata identica a un suggerimento fisso non viene proposta due volte.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	FACTORY_SUGGESTIONS,
	MAX_STATIC_CHIPS,
	MAX_DYNAMIC_CHIPS,
	composeSuggestionChips,
	getFactorySuggestion,
	isPromptSuggestion,
	normalizeSuggestionText,
	sanitizeSuggestionsCatalog,
	visibleSuggestions,
	type PromptSuggestion
} from '../src/lib/stores/promptSuggestions.ts';

function suggestion(over: Partial<PromptSuggestion> = {}): PromptSuggestion {
	return {
		id: 'sug-1',
		factoryKey: null,
		label: 'Etichetta',
		prompt: 'Testo del prompt',
		order: 10,
		hidden: false,
		...over
	};
}

describe('Suggerimenti prompt: validazione del catalogo', () => {
	it('riconosce un suggerimento valido', () => {
		assert.equal(isPromptSuggestion(suggestion()), true);
	});

	it('rifiuta label o prompt vuoti dopo trim', () => {
		assert.equal(isPromptSuggestion(suggestion({ label: '   ' })), false);
		assert.equal(isPromptSuggestion(suggestion({ prompt: '' })), false);
	});

	it('rifiuta una factoryKey sconosciuta', () => {
		assert.equal(isPromptSuggestion(suggestion({ factoryKey: 'inventata' as never })), false);
	});

	it('i preset di fabbrica sono tutti validi e raggiungibili per chiave', () => {
		for (const preset of FACTORY_SUGGESTIONS) {
			assert.equal(isPromptSuggestion(preset), true, `preset non valido: ${preset.id}`);
			assert.ok(preset.factoryKey, 'un preset di fabbrica deve avere una factoryKey');
			assert.deepEqual(getFactorySuggestion(preset.factoryKey!), preset);
		}
	});
});

describe('Suggerimenti prompt: tolleranza dello schema su disco', () => {
	it('un file assente o malformato ricade sui preset di fabbrica', () => {
		for (const input of [undefined, null, 'non un array', 42, {}, []]) {
			const out = sanitizeSuggestionsCatalog(input);
			assert.equal(out.length, FACTORY_SUGGESTIONS.length, `input ${JSON.stringify(input)}`);
		}
	});

	it('scarta le voci non valide conservando quelle buone', () => {
		const out = sanitizeSuggestionsCatalog([
			suggestion({ id: 'buona', label: 'Buona' }),
			{ id: 'rotta' },
			null
		]);
		assert.ok(
			out.some((s) => s.id === 'buona'),
			'la voce valida deve sopravvivere'
		);
		assert.equal(
			out.some((s) => s.id === 'rotta'),
			false
		);
	});

	it('reinserisce i preset di fabbrica mancanti', () => {
		const out = sanitizeSuggestionsCatalog([suggestion({ id: 'solo-custom' })]);
		for (const preset of FACTORY_SUGGESTIONS) {
			assert.ok(
				out.some((s) => s.factoryKey === preset.factoryKey),
				`preset perso dopo la sanitizzazione: ${preset.factoryKey}`
			);
		}
	});

	it('tronca le etichette a 28 caratteri e rinormalizza gli order a passo 10', () => {
		const out = sanitizeSuggestionsCatalog([
			suggestion({ id: 'lunga', label: 'x'.repeat(80), order: 999 })
		]);
		const lunga = out.find((s) => s.id === 'lunga');
		assert.ok(lunga);
		assert.ok(lunga.label.length <= 28, `etichetta non troncata: ${lunga.label.length}`);
		const orders = out.map((s) => s.order);
		assert.deepEqual(
			orders,
			[...orders].sort((a, b) => a - b),
			'gli order devono essere crescenti'
		);
		assert.deepEqual(
			orders,
			orders.map((_, i) => (i + 1) * 10),
			'gli order devono essere rinormalizzati a passo 10'
		);
	});

	it('deduplica per id', () => {
		const out = sanitizeSuggestionsCatalog([
			suggestion({ id: 'doppio', label: 'Primo' }),
			suggestion({ id: 'doppio', label: 'Secondo' })
		]);
		assert.equal(out.filter((s) => s.id === 'doppio').length, 1);
	});
});

describe('Suggerimenti prompt: selezione delle statiche visibili', () => {
	const catalogo = [
		suggestion({ id: 'c', label: 'Terza', order: 30 }),
		suggestion({ id: 'a', label: 'Prima', order: 10 }),
		suggestion({ id: 'nascosta', label: 'Nascosta', order: 15, hidden: true }),
		suggestion({ id: 'b', label: 'Seconda', order: 20 }),
		suggestion({ id: 'd', label: 'Quarta', order: 40 })
	];

	it('esclude le nascoste, ordina per order e taglia al limite', () => {
		const out = visibleSuggestions(catalogo, MAX_STATIC_CHIPS);
		assert.deepEqual(
			out.map((s) => s.id),
			['a', 'b', 'c']
		);
	});

	it('il limite predefinito e MAX_STATIC_CHIPS', () => {
		assert.equal(visibleSuggestions(catalogo).length, MAX_STATIC_CHIPS);
	});
});

describe('Suggerimenti prompt: normalizzazione per il confronto', () => {
	it('ignora maiuscole, spazi ridondanti e punteggiatura finale', () => {
		assert.equal(
			normalizeSuggestionText('  Procedi   PURE!!! '),
			normalizeSuggestionText('procedi pure')
		);
	});

	it('una stringa di soli spazi normalizza a vuoto', () => {
		assert.equal(normalizeSuggestionText('   '), '');
	});
});

describe('Suggerimenti prompt: composizione della riga di chip', () => {
	const statiche = [
		suggestion({ id: 's1', label: 'Procedi pure', prompt: 'Procedi pure.', order: 10 }),
		suggestion({ id: 's2', label: 'Spiega la scelta', prompt: 'Spiega la scelta.', order: 20 })
	];

	it('le statiche precedono le dinamiche e la numerazione e posizionale', () => {
		const chips = composeSuggestionChips(statiche, ['Mostrami il diff', 'Esegui i test']);
		assert.deepEqual(
			chips.map((c) => c.shortcutNumber),
			[1, 2, 3, 4]
		);
		assert.deepEqual(
			chips.map((c) => c.isDynamic),
			[false, false, true, true]
		);
	});

	it("l'arrivo delle dinamiche non cambia il bersaglio delle scorciatoie gia a schermo", () => {
		const prima = composeSuggestionChips(statiche, []);
		const dopo = composeSuggestionChips(statiche, ['Mostrami il diff']);
		for (const chip of prima) {
			const stessaPosizione = dopo.find((c) => c.shortcutNumber === chip.shortcutNumber);
			assert.ok(stessaPosizione);
			assert.equal(
				stessaPosizione.prompt,
				chip.prompt,
				`Alt+${chip.shortcutNumber} ha cambiato bersaglio`
			);
		}
	});

	it('scarta una dinamica che coincide con una statica gia mostrata', () => {
		const chips = composeSuggestionChips(statiche, ['procedi pure!', 'Mostrami il diff']);
		assert.deepEqual(
			chips.filter((c) => c.isDynamic).map((c) => c.prompt),
			['Mostrami il diff']
		);
	});

	it('deduplica anche fra dinamiche e scarta le stringhe vuote', () => {
		const chips = composeSuggestionChips([], ['Esegui i test', '   ', 'ESEGUI I TEST.']);
		assert.deepEqual(
			chips.map((c) => c.prompt),
			['Esegui i test']
		);
	});

	it('rispetta il limite di dinamiche e lo tiene dentro MAX_DYNAMIC_CHIPS', () => {
		const molte = ['uno', 'due', 'tre', 'quattro', 'cinque'];
		assert.equal(composeSuggestionChips([], molte, 1).length, 1);
		assert.equal(composeSuggestionChips([], molte, 2).length, 2);
		assert.equal(composeSuggestionChips([], molte, 99).length, MAX_DYNAMIC_CHIPS);
		assert.equal(composeSuggestionChips([], molte, 0).length, MAX_DYNAMIC_CHIPS);
	});

	it('non supera mai Alt+6 con il massimo di statiche e dinamiche', () => {
		const treStatiche = visibleSuggestions(sanitizeSuggestionsCatalog(undefined), MAX_STATIC_CHIPS);
		const chips = composeSuggestionChips(treStatiche, ['a', 'b', 'c'], MAX_DYNAMIC_CHIPS);
		assert.equal(chips.length, 6);
		assert.equal(Math.max(...chips.map((c) => c.shortcutNumber)), 6);
	});

	it("tronca l'etichetta lunga di una dinamica conservando il prompt intero", () => {
		const lunga = 'Mostrami il diff completo di tutti i file toccati dal piano';
		const [chip] = composeSuggestionChips([], [lunga]);
		assert.ok(chip.label.length <= 28, `etichetta troppo lunga: ${chip.label.length}`);
		assert.ok(chip.label.endsWith('...'));
		assert.equal(chip.prompt, lunga, 'il prompt inviato deve restare integro');
		assert.equal(chip.title, lunga, 'il tooltip deve mostrare il testo completo');
	});

	it('senza dinamiche la riga contiene solo le statiche', () => {
		const chips = composeSuggestionChips(statiche, []);
		assert.equal(chips.length, statiche.length);
		assert.equal(
			chips.every((c) => c.isDynamic === false),
			true
		);
	});
});
