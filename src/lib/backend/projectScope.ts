import { getContext, setContext } from 'svelte';
import {
	invoke, listen, LOCAL_MACHINE,
	type BackendCallOptions, type BackendCommand, type EventCallback, type InvokeArgs, type MachineId, type UnlistenFn
} from './ipc.ts';

const PROJECT_BACKEND = Symbol('studio-project-backend');
const REMOTE_EVENTS: Record<string, true> = {
	'studio://file-changed': true,
	'lab://changed': true,
	'diagram://new': true
};

export interface ProjectBackend {
	readonly machine: MachineId;
	invoke<T>(command: BackendCommand, args?: InvokeArgs, options?: Omit<BackendCallOptions, 'machine'>): Promise<T>;
	listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn>;
	listenResync(handler: EventCallback<void>): Promise<UnlistenFn>;
}

/** La destinazione appartiene alla superficie, non al progetto attivo della finestra. */
export function createProjectBackend(machine: MachineId): ProjectBackend {
	return {
		machine,
		invoke<T>(command: BackendCommand, args?: InvokeArgs, options?: Omit<BackendCallOptions, 'machine'>): Promise<T> {
			return invoke<T>(command, args, { ...options, machine });
		},
		listen<T>(event: string, handler: EventCallback<T>) {
			if (machine !== LOCAL_MACHINE && !Object.hasOwn(REMOTE_EVENTS, event)) {
				return Promise.reject(new Error(`Unsupported remote project event: ${event}`));
			}
			return listen<T>(machine === LOCAL_MACHINE ? event : `link:event:${machine}:${event}`, handler);
		},
		listenResync(handler: EventCallback<void>) {
			return listen<void>(`link:resync:${machine}`, handler);
		}
	};
}

const localBackend = createProjectBackend(LOCAL_MACHINE);
export function provideProjectBackend(machine: MachineId): void {
	setContext(PROJECT_BACKEND, createProjectBackend(machine));
}

export function useProjectBackend(): ProjectBackend {
	return getContext<ProjectBackend | undefined>(PROJECT_BACKEND) ?? localBackend;
}
