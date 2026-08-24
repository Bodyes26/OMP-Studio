// Ganci che le card hanno verso il guscio: aprire un file nell'editor,
// aprire un'immagine nel visualizzatore, aprire il transcript di un
// subagent, passare alla scheda TERMINAL.
//
// Passati per contesto e non per prop: una card `edit` sta a tre livelli di
// profondita' dentro il transcript e infilare quattro callback in ogni
// componente intermedio sarebbe rumore che non aggiunge tipi.

import { getContext, setContext } from 'svelte';

const KEY = Symbol('studio-agent-ui');

export interface AgentUiHooks {
	/** Apre un percorso (relativo o assoluto) nell'editor Monaco. */
	openFile(path: string, line?: number | null): void;
	/** Apre un'immagine base64 nel visualizzatore esistente. */
	openImage(data: string, mimeType: string): void;
	/** Apre il cassetto del transcript di un subagent. */
	openSubagent(subagentId: string): void;
	/** Passa alla scheda TERMINAL di questo progetto. */
	switchToTerminal(): void;
}

export function setAgentUiHooks(hooks: AgentUiHooks) {
	setContext(KEY, hooks);
}

/**
 * I ganci mancano solo se una card viene montata fuori dal transcript (nei
 * test, per esempio): in quel caso i clic non fanno niente invece di
 * lanciare.
 */
export function agentUiHooks(): AgentUiHooks {
	return (
		getContext<AgentUiHooks | undefined>(KEY) ?? {
			openFile: () => {},
			openImage: () => {},
			openSubagent: () => {},
			switchToTerminal: () => {}
		}
	);
}
