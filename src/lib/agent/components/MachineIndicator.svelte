<!--
  Dove sta girando questa sessione (R-MI-13, F19).

  Compare solo quando il progetto esiste su più di una macchina: su un progetto
  di una sola macchina la domanda non si pone, e un'etichetta fissa sarebbe
  rumore. Il clic apre l'elenco delle copie; sceglierne una passa su quella
  macchina.

  Sempre cliccabile (R-MI-62): una chat vuota passa subito, una chat ferma si
  sposta, un turno in corso prenota il cambio a fine turno. Non c'è più uno
  stato «a turno fermo»: era quello a dire «aspetta la fine del turno» anche
  quando nessuno stava lavorando.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { IconCheck, IconMonitor } from '#lib/icons.ts';
	import { escapeDismiss } from '#lib/ui/escapeDismiss.ts';
	import type { MachineChoice } from '../machineChoice.ts';

	let {
		machines,
		current,
		blocked,
		onChange
	}: {
		machines: MachineChoice[];
		current: string;
		/**
		 * Perché il cambio verso quella macchina non può partire adesso (R-MI-62).
		 * È lo stesso predicato del flusso: un turno in corso non compare qui,
		 * perché quello si prenota a fine turno.
		 */
		blocked?: (machineId: string) => string | null;
		onChange: (machineId: string) => void;
	} = $props();

	let open = $state(false);
	let root = $state<HTMLElement | null>(null);

	const currentName = $derived(machines.find((machine) => machine.id === current)?.name ?? current);
	// Una sola macchina: niente indicatore, non c'è nulla da scegliere.
	const visible = $derived(machines.length > 1);

	$effect(() => {
		if (!open) return;
		function onPointerDown(event: PointerEvent) {
			if (root && event.target instanceof Node && !root.contains(event.target)) open = false;
		}
		document.addEventListener('pointerdown', onPointerDown);
		return () => document.removeEventListener('pointerdown', onPointerDown);
	});

	function pick(machine: MachineChoice): void {
		open = false;
		if (machine.id !== current) onChange(machine.id);
	}
</script>

{#if visible}
	<div class="machine-indicator" bind:this={root} use:escapeDismiss={() => (open = false)}>
		<button
			type="button"
			class="chip"
			title={m.machine_indicator_title({ name: currentName })}
			aria-label={m.machine_indicator_aria({ name: currentName })}
			aria-haspopup="menu"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			<IconMonitor />
			<span>{currentName}</span>
		</button>
		{#if open}
			<div class="menu" role="menu" aria-label={m.machine_indicator_menu()}>
				{#each machines as machine (machine.id)}
					{@const reason = machine.id === current ? null : blocked?.(machine.id) ?? null}
					<button
						type="button"
						role="menuitemradio"
						aria-checked={machine.id === current}
						class="row"
						disabled={reason !== null}
						title={reason ?? undefined}
						onclick={() => pick(machine)}
					>
						<span class="mark">{#if machine.id === current}<IconCheck />{/if}</span>
						<span class="name">{machine.name}</span>
						{#if !machine.online}<span class="off">{m.machine_indicator_offline()}</span>{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.machine-indicator {
		position: relative;
		display: inline-flex;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 6px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-muted);
		font: inherit;
		font-size: var(--text-caption);
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
	}
	.chip:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}
	.chip :global(svg) {
		width: 12px;
		height: 12px;
		flex: none;
	}
	.menu {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 0;
		min-width: 180px;
		padding: 4px;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		box-shadow: var(--shadow-md);
		z-index: 40;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: var(--text-body);
		text-align: left;
		cursor: pointer;
	}
	.row:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.row:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.mark {
		display: inline-flex;
		width: 14px;
		flex: none;
	}
	.mark :global(svg) {
		width: 12px;
		height: 12px;
	}
	.name {
		flex: 1;
		min-width: 0;
	}
	.off {
		color: var(--ink-faint);
		font-size: var(--text-caption);
	}
</style>
