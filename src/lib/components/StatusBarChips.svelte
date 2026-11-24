<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { taskStore } from '#lib/stores/tasks.svelte.ts';
	import { companionStore } from '#lib/stores/companion.svelte.ts';
	import { remoteStore } from '#lib/remote/remoteStore.svelte.ts';
	import { projectStore } from '#lib/stores/projects.svelte.ts';
	import { linkStore } from '#lib/backend/link.svelte.ts';
	import { remoteJobs } from '#lib/backend/remoteJobs.svelte.ts';
	import { copySyncStore } from '#lib/stores/copySync.svelte.ts';
	import { projectGroup } from '#lib/stores/projectMachines.svelte.ts';
	import { machinesChipSummary, type MachineDotState } from '#lib/stores/machineStatus.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { contextMenu } from '#lib/contextMenu.svelte.ts';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import MachinesPopover from './machines/MachinesPopover.svelte';
	import { IconPin, IconRemote, IconMonitor, IconTerminal, IconRefresh } from '#lib/icons.ts';

	// Companion, coda globale e macchine riguardano tutta l'app, non il
	// progetto attivo: stanno nella barra di stato cosi' la barra superiore
	// resta alle tessere dei progetti.
	let {
		onQueueClick
	}: {
		onQueueClick?: (anchor: HTMLElement) => void;
	} = $props();

	const controlledMachine = $derived(linkStore.machineFor(projectStore.activeProject?.machineId));
	// Un'altra macchina sta eseguendo un comando qui (R-MI-36): deve restare
	// visibile cosa gira e chi l'ha chiesto, anche senza aprire le impostazioni.
	const incomingJob = $derived(remoteJobs.incomingActive[0] ?? null);
	$effect(() => { remoteJobs.start(); });

	// Chip «Macchine» (R-MI-49): c'e' con almeno una macchina abbinata, con un
	// punto per macchina e l'indicatore animato durante un giro di copie.
	const summary = $derived(machinesChipSummary(linkStore.status.peers.map((peer) => ({
		id: peer.id,
		name: peer.name,
		online: peer.online,
		compatible: peer.compatible,
		responded: linkStore.hasResponded(peer.id),
		offlineReason: linkStore.offlineReason(peer.id)
	}))));
	const projectMachine = $derived.by(() => {
		const project = projectStore.activeProject;
		if (!project) return null;
		const group = projectGroup(project);
		if (group.length < 2) return null;
		const ids = new Set(group.flatMap((copy) => copy.machineId ? [copy.machineId] : []));
		if (ids.size !== 1) return null;
		return summary.dots.find((dot) => ids.has(dot.id)) ?? null;
	});
	const syncing = $derived(copySyncStore.anyRunning);

	let machinesOpen = $state(false);
	let machinesAnchor = $state<HTMLElement | null>(null);

	// L'etichetta accessibile dice nome e stato di ogni macchina, piu' il giro
	// in corso: i punti colorati da soli non bastano a chi non li vede.
	const machinesAria = $derived(m.machines_chip_aria({
		devices: summary.dots.map((dot) => `${dot.name} (${stateLabel(dot.state)})`).join(', ')
	}) + (syncing ? ` · ${m.machines_chip_syncing()}` : ''));

	function stateLabel(state: MachineDotState): string {
		switch (state) {
			case 'online': return m.machines_state_online();
			case 'waiting': return m.machines_response_waiting();
			case 'relay': return m.machines_state_relay();
			case 'incompatible': return m.machines_state_incompatible();
			default: return m.machines_state_offline();
		}
	}

	function toggleMachines(event: MouseEvent): void {
		event.stopPropagation();
		machinesAnchor = event.currentTarget as HTMLElement;
		machinesOpen = !machinesOpen;
	}
</script>

<Tooltip text={m.statusbar_companion_chip_title()} placement="top">
	<button
		type="button"
		class="statusbar-chip companion-chip"
		class:active={companionStore.isPinned}
		onclick={(e) => { e.stopPropagation(); void companionStore.toggleCompanion(); }}
		aria-label={m.statusbar_companion_chip_aria()}
	>
		<IconPin size={13} /> Companion
	</button>
</Tooltip>

{#if taskStore.totalQueued > 0}
	<Tooltip text={m.statusbar_queue_chip_title()} placement="top">
		<button
			type="button"
			class="statusbar-chip brand queue-chip"
			onclick={(e) => { e.stopPropagation(); onQueueClick?.(e.currentTarget); }}
			aria-label={m.statusbar_queue_chip_aria({ count: taskStore.totalQueued })}
		>
			{m.statusbar_queue_chip_label({ count: taskStore.totalQueued })}
		</button>
	</Tooltip>
{/if}

{#if summary.visible}
	<Tooltip text={m.machines_chip_title()} placement="top">
		<button
			type="button"
			class="statusbar-chip brand machines-chip"
			class:all-off={!summary.anyOnline}
			aria-expanded={machinesOpen}
			aria-haspopup="dialog"
			onclick={toggleMachines}
			aria-label={machinesAria}
		>
			{#if syncing}
				<span class="sync-mark" aria-hidden="true"><IconRefresh size={12} /></span>
			{/if}
			<span class="dots" aria-hidden="true">
				{#each summary.dots as dot (dot.id)}
					<span
						class="dot"
						class:online={dot.state === 'online'}
						class:waiting={dot.state === 'waiting'}
						class:relay={dot.state === 'relay'}
						class:incompatible={dot.state === 'incompatible'}
					></span>
				{/each}
			</span>
			<span>{projectMachine ? `${projectMachine.name} · ${stateLabel(projectMachine.state)}` : m.machines_chip_label()}</span>
		</button>
	</Tooltip>
	<MachinesPopover open={machinesOpen} anchor={machinesAnchor} onClose={() => (machinesOpen = false)} />
{/if}

{#if controlledMachine}
	<Tooltip text={m.statusbar_machine_chip_title({ name: controlledMachine.name })} placement="top">
		<button
			type="button"
			class="statusbar-chip brand"
			class:offline={!controlledMachine.online}
			onclick={(e) => { e.stopPropagation(); settingsStore.openDevice('computer', controlledMachine.id); }}
			oncontextmenu={(e) => {
				e.preventDefault();
				e.stopPropagation();
				contextMenu.open(e, {
					label: controlledMachine.name,
					items: [
						{
							kind: 'item',
							label: m.statusbar_machine_chip_open_device({ name: controlledMachine.name }),
							run: () => settingsStore.openDevice('computer', controlledMachine.id)
						}
					]
				});
			}}
			aria-label={m.statusbar_machine_chip_aria({ name: controlledMachine.name })}
		>
			<IconMonitor size={13} />
			<span>{controlledMachine.name}</span>
		</button>
	</Tooltip>
{/if}

{#if incomingJob}
	<Tooltip text={m.statusbar_exec_chip_title({ name: incomingJob.machineName, command: incomingJob.command })} placement="top">
		<button
			type="button"
			class="statusbar-chip brand"
			onclick={(e) => { e.stopPropagation(); settingsStore.openDevice('computer', incomingJob.machineId); }}
			aria-label={m.statusbar_exec_chip_aria({ name: incomingJob.machineName })}
		>
			<IconTerminal size={13} />
			<span>{incomingJob.machineName}</span>
		</button>
	</Tooltip>
{/if}

{#if remoteStore.status.connection === 'connected' && remoteStore.status.clients.length > 0}
	{@const remoteLabel = m.statusbar_remote_chip_aria({
		count: remoteStore.status.clients.length,
		devices: remoteStore.status.clients.map((c) => c.name).join(', ')
	})}
	<Tooltip text={remoteLabel} placement="top">
		<button
			type="button"
			class="statusbar-chip brand"
			onclick={(e) => { e.stopPropagation(); settingsStore.openSection('devices'); }}
			oncontextmenu={(e) => {
				e.preventDefault();
				e.stopPropagation();
				contextMenu.open(e, {
					label: m.settings_remote_machines_title(),
					items: [
						{
							kind: 'item',
							label: m.statusbar_remote_chip_open_machines(),
							run: () => void remoteStore.openMachinesWindow()
						},
						{
							kind: 'item',
							label: m.statusbar_remote_chip_settings(),
							run: () => settingsStore.openSection('devices')
						}
					]
				});
			}}
			aria-label={remoteLabel}
		>
			<IconRemote size={13} />
			<span>{m.statusbar_remote_chip_label({ count: remoteStore.status.clients.length })}</span>
		</button>
	</Tooltip>
{/if}

<style>
	/* Stessa sagoma dei pulsanti versione della barra di stato (20 px), ma in
	   sans: sono comandi, non numeri da confrontare. */
	.statusbar-chip {
		background: transparent;
		border: 1px solid transparent;
		color: var(--ink-muted);
		height: 20px;
		padding: 0 6px;
		font-size: var(--text-caption);
		border-radius: var(--radius-md);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
		transition: background-color var(--dur-fast) var(--ease-out),
		            border-color var(--dur-fast) var(--ease-out),
		            color var(--dur-fast) var(--ease-out);
	}

	.statusbar-chip:hover {
		color: var(--ink);
		background: var(--bg-hover);
		border-color: var(--line);
	}

	.statusbar-chip:focus-visible {
		outline: none;
		border-color: var(--brand);
		box-shadow: 0 0 0 1px var(--brand);
	}

	/* Coda e macchine compaiono solo quando c'e' qualcosa: il colore del brand
	   dice che sono uno stato, non un comando sempre presente. */
	.statusbar-chip.brand {
		color: var(--brand-ink);
		border-color: var(--brand-dim);
	}

	.statusbar-chip.brand:hover {
		border-color: var(--brand);
	}

	/* Il progetto attivo vive su un'altra macchina: il chip resta visibile
	   anche a collegamento caduto, perche' dice dove sta il lavoro. */
	.statusbar-chip.offline {
		color: var(--ink-faint);
		border-style: dashed;
	}

	.companion-chip.active {
		color: var(--brand-ink);
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line-strong));
		background: color-mix(in oklch, var(--brand) 12%, transparent);
	}

	/* Punti delle macchine: 5 px, in fila. Il colore e' l'unico segnale del
	   chip; l'etichetta accessibile dice nome e stato di ognuna. */
	.machines-chip .dots {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	.machines-chip .dot {
		width: 5px;
		height: 5px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
	}
	.machines-chip .dot.online { background: var(--success); }
	/* Collegata ma non ancora risposta (D8): ambra, non verde. */
	.machines-chip .dot.waiting { background: var(--warn); }
	.machines-chip .dot.relay { background: var(--warn); }
	.machines-chip .dot.incompatible { background: var(--warn); }
	.machines-chip.all-off { color: var(--ink-faint); border-style: dashed; }

	/* Giro di sincronizzazione in corso: una freccia che gira piano. Con il
	   movimento ridotto resta ferma e il testo accessibile dice lo stesso. */
	.sync-mark {
		display: inline-flex;
		align-items: center;
		color: var(--brand-ink);
		animation: machines-spin 1400ms linear infinite;
	}
	@keyframes machines-spin {
		to { transform: rotate(360deg); }
	}
	@media (prefers-reduced-motion: reduce) {
		.sync-mark { animation: none; }
	}
</style>
