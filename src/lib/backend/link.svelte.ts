import { invoke, isTauri, listen, updateLinkedMachines, LOCAL_MACHINE, type UnlistenFn } from './ipc.ts';
import type { RemoteCommand } from '$remote-protocol';
import type { DesktopHostSnapshot } from './host.ts';
import { projectStore } from '#lib/stores/projects.svelte.ts';

export interface MachinePermissions {
	agents: boolean;
	files: boolean;
	terminal: boolean;
}
export interface LinkedMachine {
	id: string;
	name: string;
	permissions: MachinePermissions;
	online: boolean;
	compatible: boolean;
	version: string | null;
	route: 'direct' | 'relay' | null;
	latencyMs: number | null;
}
export interface LinkStatus {
	enabled: boolean;
	name: string;
	machineId: string;
	platform: string;
	relayUrl: string;
	hasRelayToken: boolean;
	peers: LinkedMachine[];
}

class LinkStore {
	status = $state<LinkStatus>({ enabled: false, name: '', machineId: '', platform: '', relayUrl: '', hasRelayToken: false, peers: [] });
	hosts = $state<Record<string, DesktopHostSnapshot>>({});
	loading = $state(false);
	busy = $state(false);
	error = $state<string | null>(null);
	private initializing: Promise<void> | null = null;
	private unlisten: UnlistenFn | null = null;
	private unlistenHost: UnlistenFn | null = null;

	private apply(status: LinkStatus): void {
		this.status = status;
		updateLinkedMachines(status.peers);
		const known = new Set(status.peers.map((peer) => peer.id));
		for (const machine of Object.keys(this.hosts)) {
			if (known.has(machine)) continue;
			delete this.hosts[machine];
			projectStore.removeRemoteMachine(machine);
		}
	}

	private applyHost(machine: string, state: DesktopHostSnapshot): void {
		if (state.version !== 1 || !Array.isArray(state.projects) || !Array.isArray(state.lanes) ||
			!Array.isArray(state.tasks) || typeof state.projectRoot !== 'string') {
			this.error = `Invalid host snapshot from ${machine}`;
			return;
		}
		this.hosts[machine] = state;
		projectStore.syncRemoteProjects(machine, this.status.peers.find((peer) => peer.id === machine)?.name ?? machine, state);
	}

	command<T>(machine: string, command: RemoteCommand): Promise<T> {
		return invoke<T>('link_host_action', { command }, { machine });
	}

	machineFor(machineId: string | undefined): LinkedMachine | undefined {
		if (!machineId || machineId === LOCAL_MACHINE) return undefined;
		return this.status.peers.find((peer) => peer.id === machineId);
	}

	initialize(): Promise<void> {
		if (!isTauri()) return Promise.resolve();
		return this.initializing ??= this.load();
	}

	private async load(): Promise<void> {
		this.loading = true;
		try {
			this.unlisten ??= await listen<LinkStatus>('link:status', (event) => this.apply(event.payload));
			const received = new Set<string>();
			this.unlistenHost ??= await listen<{ machine: string; state: DesktopHostSnapshot }>('link:host_state', (event) => {
				received.add(event.payload.machine);
				this.applyHost(event.payload.machine, event.payload.state);
			});
			const cached = await invoke<Record<string, DesktopHostSnapshot>>('link_host_states');
			for (const [machine, state] of Object.entries(cached)) {
				if (!received.has(machine)) this.applyHost(machine, state);
			}
			await this.refresh();
		} catch (error) {
			this.error = String(error);
		} finally {
			this.loading = false;
		}
	}

	async refresh(): Promise<void> {
		this.apply(await invoke<LinkStatus>('link_status'));
		this.error = null;
	}

	private async action<T>(run: () => Promise<T>): Promise<T> {
		if (this.busy) throw new Error('An instance configuration change is already running');
		this.busy = true;
		this.error = null;
		try {
			return await run();
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
			throw error;
		} finally {
			this.busy = false;
		}
	}

	configure(config: { enabled: boolean; name: string; relayUrl: string; relayToken?: string }): Promise<void> {
		return this.action(async () => {
			this.apply(await invoke<LinkStatus>('link_configure', { ...config, relayToken: config.relayToken ?? null }));
		});
	}

	pairingCode(): Promise<string> {
		return this.action(() => invoke<string>('link_pairing_code'));
	}

	pair(code: string): Promise<void> {
		return this.action(async () => this.apply(await invoke<LinkStatus>('link_pair', { code })));
	}

	permissions(machine: string, permissions: MachinePermissions): Promise<void> {
		return this.action(async () => this.apply(await invoke<LinkStatus>('link_permissions', { machine, permissions })));
	}

	revoke(machine: string): Promise<void> {
		return this.action(async () => this.apply(await invoke<LinkStatus>('link_revoke', { machine })));
	}
}

export const linkStore = new LinkStore();
