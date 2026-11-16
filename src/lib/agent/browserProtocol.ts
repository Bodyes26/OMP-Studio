// Tipi puri del contratto `browser-live-v1` condivisi con il relay.
//
// Perche' un file a parte: `browser-live.ts` importa il runtime del canale e i
// messaggi (`#lib/backend/ipc.ts`, paraglide), quindi il typecheck del relay —
// che non ha la lib DOM — non puo' seguirlo senza incontrare `window` e
// `document`. Qui restano solo le forme che viaggiano sul filo, e sia
// `browser-live.ts` sia `wire.ts` le prendono da qui.

export interface RpcCapability {
	name: string;
	version: number;
	/** Trasporti supportati. Assente o vuoto significa inutilizzabile. */
	transports?: string[];
	/** Estensioni opzionali: un'intersezione vuota e' comunque valida. */
	features?: string[];
}

/** Identita' di una tab Browser Studio: la stessa su RPC e canale live. */
export interface BrowserSessionIdentity {
	projectId: string;
	laneId?: string;
	chatSessionId: string;
	browserSessionId: string;
	tabId: string;
}
