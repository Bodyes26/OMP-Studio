/**
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
		return `Il task richiede ${configuration.modelSelector}, il terminale usa ${session.modelSelector}: allinea il modello nel terminale (Ctrl+P) oppure lancia il task dalla scheda GUI`;
	}

	const thinkingLevel = configuration.thinkingLevel || 'auto';
	if (thinkingLevel !== 'auto' && session.thinkingLevel && session.thinkingLevel !== thinkingLevel) {
		return `Il task richiede thinking ${thinkingLevel}, il terminale usa ${session.thinkingLevel}: allinealo nel terminale (Alt+T) oppure lancia il task dalla scheda GUI`;
	}

	return null;
}
