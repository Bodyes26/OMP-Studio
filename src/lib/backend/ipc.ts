/**
 * Unico confine IPC della finestra (Gate R49).
 *
 * Le chiamate locali restano IPC Tauri. Quelle remote passano dal backend
 * nativo su iroh, compresi i canali RPC/PTY e gli allegati binari. Non si
 * ripiega mai sul disco o sui processi locali quando una macchina manca.
 */
import {
	Channel,
	invoke as tauriInvoke,
	isTauri,
	type InvokeArgs,
	type InvokeOptions
} from '@tauri-apps/api/core';
import { emit, listen, type Event, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';
import { commandScope, type BackendCommand } from './commands.ts';
import { m } from '#lib/paraglide/messages.js';
import { studioLog } from '#lib/diagnostics/studioLog.ts';

export { Channel, emit, isTauri, listen };
export type { BackendCommand, Event, EventCallback, InvokeArgs, UnlistenFn };

/** Identificativo di una macchina con Studio; `LOCAL_MACHINE` e' questa. */
export type MachineId = string;
export const LOCAL_MACHINE: MachineId = 'local';
/**
 * Comandi che passano anche verso una macchina con una versione di Studio
 * incompatibile: servono ad aggiornarla (R-MI-10, R-MI-38). Stesso elenco di
 * `UPDATE_COMMANDS` in `src-tauri/src/link/mod.rs`.
 */
export const UPDATE_COMMANDS: readonly string[] = [
	'get_studio_version', 'check_studio_update', 'studio_update_remote_start', 'studio_update_remote_status'
];

const linkedMachines = new Map<MachineId, { online: boolean; compatible: boolean; name: string }>();

export function updateLinkedMachines(machines: readonly { id: MachineId; name?: string; online: boolean; compatible: boolean }[]): void {
	linkedMachines.clear();
	for (const machine of machines) linkedMachines.set(machine.id, { ...machine, name: machine.name ?? machine.id });
}

export interface BackendCallOptions extends Partial<InvokeOptions> {
	/** Macchina che deve eseguire il comando: quella del progetto. Assente = locale. */
	machine?: MachineId;
}

/**
 * - `local_only`: il comando appartiene alla macchina di chi guarda;
 * - `incompatible_version`: la macchina richiede un aggiornamento di Studio;
 * - `machine_unreachable`: nessun collegamento attivo con quella macchina.
 */
export type BackendRouteRefusal = 'local_only' | 'incompatible_version' | 'machine_unreachable';

export type BackendRoute =
	| { kind: 'local' }
	| { kind: 'machine'; machine: MachineId }
	| { kind: 'refused'; reason: 'local_only' };

export class BackendRouteError extends Error {
	readonly command: BackendCommand;
	readonly machine: MachineId;
	readonly reason: BackendRouteRefusal;

	constructor(command: BackendCommand, machine: MachineId, reason: BackendRouteRefusal) {
		super(`Backend command ${command} not routed to machine ${machine}: ${reason}`);
		this.name = 'BackendRouteError';
		this.command = command;
		this.machine = machine;
		this.reason = reason;
	}
}

/**
 * Testo per le superfici d'errore di un errore qualunque (S3-link-front-08,
 * contratto C5): un rifiuto di instradamento diventa una frase con il nome
 * della macchina, il resto resta il messaggio dell'errore. L'id della macchina
 * non arriva mai all'utente.
 *
 * Il rifiuto va nel registro a INFO, non sulla console come errore: o la
 * macchina e' spenta (l'utente lo vede gia' nel chip e nel popover), o il
 * comando non appartiene a quella macchina, e succede a ogni giro di polling.
 */
export function routeErrorText(error: unknown): string {
	if (error instanceof BackendRouteError) {
		// Fuori dalla finestra (test, avvio) il registro non esiste: il testo per
		// l'utente non deve dipendere da lui.
		if (typeof window !== 'undefined') {
			studioLog.info('link', `comando ${error.command} non instradato: ${error.reason} -> ${error.machine}`);
		}
		const name = linkedMachines.get(error.machine)?.name ?? error.machine;
		switch (error.reason) {
			case 'machine_unreachable': return m.machines_error_unreachable({ machine: name });
			case 'incompatible_version': return m.machines_error_incompatible({ machine: name });
			case 'local_only': return m.machines_error_local_only({ machine: name });
		}
	}
	return error instanceof Error ? error.message : String(error);
}

/** Decide dove gira `command` chiesto per `machine`; puro, non apre collegamenti. */
export function routeCommand(command: BackendCommand, machine: MachineId = LOCAL_MACHINE): BackendRoute {
	if (machine === LOCAL_MACHINE) return { kind: 'local' };
	switch (commandScope(command)) {
		case 'routed':
		case 'stream':
		case 'adapt':
			return { kind: 'machine', machine };
		case 'local':
			return { kind: 'refused', reason: 'local_only' };
	}
}

export async function invoke<T>(
	command: BackendCommand,
	args?: InvokeArgs,
	options?: BackendCallOptions
): Promise<T> {
	const machine = options?.machine ?? LOCAL_MACHINE;
	const route = routeCommand(command, machine);
	switch (route.kind) {
		case 'local':
			return tauriInvoke<T>(command, args, options?.headers === undefined ? undefined : { headers: options.headers });
		case 'machine': {
			const status = linkedMachines.get(machine);
			if (!status?.online) throw new BackendRouteError(command, machine, 'machine_unreachable');
			if (!status.compatible && !UPDATE_COMMANDS.includes(command)) {
				throw new BackendRouteError(command, machine, 'incompatible_version');
			}
			if (commandScope(command) === 'stream') {
				const { onEvent, onOutput, ...body } = (args ?? {}) as Record<string, unknown>;
				if (command === 'pty_open') {
					return tauriInvoke<T>('link_open_pty', { machine, args: body, onOutput });
				}
				return tauriInvoke<T>('link_open_rpc', { machine, command, args: body, onEvent });
			}
			if (args instanceof ArrayBuffer || ArrayBuffer.isView(args) || Array.isArray(args)) {
				const headers = new Headers(options?.headers);
				headers.set('x-studio-machine', machine);
				headers.set('x-studio-command', command);
				return tauriInvoke<T>('link_invoke', args, { headers });
			}
			return tauriInvoke<T>('link_invoke', {
				machine, command, args: args ?? {}, headers: Object.fromEntries(new Headers(options?.headers))
			});
		}
		case 'refused':
			throw new BackendRouteError(command, machine, route.reason);
	}
}
