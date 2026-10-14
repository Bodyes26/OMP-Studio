import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CommandError, DeviceInfo, HostState, RemoteCommand } from '$remote-protocol';

/**
 * Contratto fra la WebView e il bridge Rust del controllo remoto
 * (`src-tauri/src/remote/`, Gate R44). Rust possiede configurazione,
 * credenziale e connessione al relay; la WebView pubblica lo stato della
 * macchina e risponde ai comandi che arrivano dai dispositivi.
 */

/**
 * - `disabled`: interruttore spento, nessuna connessione;
 * - `unpaired`: acceso ma senza credenziale;
 * - `waiting`: connessione caduta, nuovo tentativo a `retryAt`;
 * - `revoked`: il relay ha revocato la macchina, serve un nuovo abbinamento;
 * - `incompatible`: versione del protocollo diversa da quella del relay.
 */
export type RemoteConnection =
	| 'disabled'
	| 'unpaired'
	| 'connecting'
	| 'connected'
	| 'waiting'
	| 'revoked'
	| 'incompatible';

export interface RemoteStatus {
	enabled: boolean;
	relayUrl: string | null;
	machineName: string;
	/** UUID della macchina, generato alla prima lettura della configurazione. */
	hostId: string;
	paired: boolean;
	connection: RemoteConnection;
	lastError: string | null;
	retryAt: number | null;
	/** Dispositivi collegati al relay in questo momento. */
	clients: DeviceInfo[];
	/** Versione del relay dall'ultimo `welcome` (o da `/healthz` dopo un `incompatible`). */
	relayVersion: string | null;
	/** Gamma di protocolli accettata dal relay, se nota. */
	relayProtocol: { min: number; max: number } | null;
	/**
	 * Chi va aggiornato quando le versioni non combaciano: `relay` se Studio
	 * parla un protocollo piu' nuovo del massimo del relay, `studio` se piu'
	 * vecchio del minimo. `null` quando sono compatibili o non si sa.
	 */
	updateNeeded: 'relay' | 'studio' | null;
}

export interface RemoteCommandEvent {
	commandId: string;
	device: DeviceInfo;
	command: RemoteCommand;
}

export const REMOTE_STATUS_EVENT = 'remote://status';
export const REMOTE_COMMAND_EVENT = 'remote://command';

/** Unico punto d'accesso ai comandi `remote_*` di Tauri. */
export const remoteBridge = {
	status: () => invoke<RemoteStatus>('remote_get_status'),
	pair: (relayUrl: string, code: string, machineName: string) =>
		invoke<RemoteStatus>('remote_pair', { relayUrl, code, machineName }),
	setEnabled: (enabled: boolean) => invoke<RemoteStatus>('remote_set_enabled', { enabled }),
	setMachineName: (machineName: string) => invoke<RemoteStatus>('remote_set_machine_name', { machineName }),
	unpair: () => invoke<RemoteStatus>('remote_unpair'),
	/** Ultimo stato della macchina: Rust lo tiene e lo rimanda a ogni riconnessione. */
	publishState: (state: HostState) => invoke<void>('remote_publish_state', { state }),
	commandResult: (commandId: string, ok: boolean, error?: CommandError) =>
		invoke<void>('remote_command_result', { commandId, ok, error: error ?? null }),
	onStatus: (handler: (status: RemoteStatus) => void): Promise<UnlistenFn> =>
		listen<RemoteStatus>(REMOTE_STATUS_EVENT, (event) => handler(event.payload)),
	onCommand: (handler: (event: RemoteCommandEvent) => void): Promise<UnlistenFn> =>
		listen<RemoteCommandEvent>(REMOTE_COMMAND_EVENT, (event) => handler(event.payload))
};
