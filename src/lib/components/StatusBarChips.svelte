<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { taskStore } from '#lib/stores/tasks.svelte.ts';
	import { companionStore } from '#lib/stores/companion.svelte.ts';
	import { remoteStore } from '#lib/remote/remoteStore.svelte.ts';
	import { contextMenu } from '#lib/contextMenu.svelte.ts';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import { IconPin, IconRemote } from '#lib/icons.ts';

	// Companion, coda globale e controllo remoto riguardano tutta l'app, non il
	// progetto attivo: stanno nella barra di stato cosi' la barra superiore
	// resta alle tessere dei progetti.
	let {
		onQueueClick,
		onRemoteSettings
	}: {
		onQueueClick?: (anchor: HTMLElement) => void;
		onRemoteSettings?: () => void;
	} = $props();
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

{#if remoteStore.status.connection === 'connected' && remoteStore.status.clients.length > 0}
	{@const remoteLabel = m.statusbar_remote_chip_aria({
		count: remoteStore.status.clients.length,
		devices: remoteStore.status.clients.map((c) => c.name).join(', ')
	})}
	<Tooltip text={remoteLabel} placement="top">
		<button
			type="button"
			class="statusbar-chip brand"
			onclick={(e) => { e.stopPropagation(); onRemoteSettings?.(); }}
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
							run: () => onRemoteSettings?.()
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

	/* Coda e remoto compaiono solo quando c'e' qualcosa: il colore del brand
	   dice che sono uno stato, non un comando sempre presente. */
	.statusbar-chip.brand {
		color: var(--brand-ink);
		border-color: var(--brand-dim);
	}

	.statusbar-chip.brand:hover {
		border-color: var(--brand);
	}

	.companion-chip.active {
		color: var(--brand-ink);
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line-strong));
		background: color-mix(in oklch, var(--brand) 12%, transparent);
	}
</style>
