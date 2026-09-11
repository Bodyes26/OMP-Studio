
import { m as msg } from '$lib/paraglide/messages.js';/**
 * Confronto tra la configurazione richiesta da un task e quella pubblicata
 * dalla sessione del terminale.
 *
 * Il TUI di omp non espone nessun comando per impostare modello e thinking di
 * una sessione: `/model <selector>` non cambia niente, finisce nel prompt come
 * messaggio per il modello. Sulla superficie terminale, quindi, la
 * configurazione del task non si applica: si verifica. Se la sessione usa un
 * altro modello il task resta in coda con l'indicazione di cosa allineare,
 * invece di partire a modello sbagliato.
 *
 * Una sessione appena creata non ha ancora un file JSONL (omp lo scrive col
 * primo messaggio) e non pubblica ne' modello ne' thinking: in quel caso non
 * c'e' niente da confrontare e il task parte, perche' bloccarlo su un dato
 * assente sarebbe una certezza inventata.
 */

export interface TerminalTaskConfiguration {
	modelSelector: string;
	thinkingLevel?: string;
}

export interface TerminalSessionConfiguration {
	modelSelector?: string | null;
	thinkingLevel?: string | null;
}

export function describeConfigurationMismatch(
	session: TerminalSessionConfiguration,
	configuration: TerminalTaskConfiguration
): string | null {
	if (!session.modelSelector) return null;

	if (session.modelSelector !== configuration.modelSelector) {
		return msg.ui_ts_taskconfiguration_il_task_richiede_value1_il_terminale_usa_b103({ value1: configuration.modelSelector, value2: session.modelSelector });
	}

	const thinkingLevel = configuration.thinkingLevel || 'auto';
	if (thinkingLevel !== 'auto' && session.thinkingLevel && session.thinkingLevel !== thinkingLevel) {
		return msg.ui_ts_taskconfiguration_il_task_richiede_thinking_value1_il_terminale_0eec({ value1: thinkingLevel, value2: session.thinkingLevel });
	}

	return null;
}
