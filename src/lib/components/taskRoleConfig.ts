import { splitModelSelector } from '../stores/modelSettingsHelpers.ts';

/**
 * Modello e thinking di un ruolo, dal selettore configurato (`provider/id[:thinking]`).
 *
 * Il thinking e' solo l'ultimo segmento e solo se e' un livello noto: molti id
 * contengono a loro volta i due punti (`ollama/qwen3:32b`, `openrouter/x:free`),
 * e dividere sul primo `:` troncava il modello e scambiava la variante per un
 * livello di ragionamento.
 */
export function roleConfigFromSelector(
	selector: string,
	knownSelectors?: ReadonlySet<string>
): { model: string; thinking: string } {
	if (!selector) return { model: '', thinking: 'auto' };
	const { base, thinking } = splitModelSelector(selector, knownSelectors);
	return { model: base, thinking: thinking ?? 'auto' };
}
