<script lang="ts">
	// Stop del terminale nella testata della colonna (D6): fuori dalla viewport,
	// con la sagoma dello Stop del composer. Armato, il cerchio diventa una
	// pillola che dice cosa fara' il secondo clic, senza bagliori animati.
	import { m } from '$lib/paraglide/messages.js';
	import { IconStop } from '$lib/icons';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import type { TerminalStopControl } from './stopControl.svelte';

	let { control }: { control: TerminalStopControl } = $props();

	const label = $derived(control.armed ? m.force_kill_session_btn() : m.terminal_stop_agent_btn());
</script>

<Tooltip text={label} placement="bottom">
	<button
		type="button"
		class="terminal-stop"
		class:armed={control.armed}
		aria-label={label}
		onclick={() => control.press()}
	>
		<IconStop aria-hidden="true" />
		{#if control.armed}
			<span class="terminal-stop-text">{m.force_kill_session_short()}</span>
		{/if}
	</button>
</Tooltip>
<span class="sr-only" aria-live="polite">{control.armed ? m.terminal_stop_armed_announce() : ''}</span>

<style>
	.terminal-stop {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: var(--radius-full);
		background: var(--danger);
		color: var(--on-danger);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		font-weight: 600;
		line-height: 1;
		white-space: nowrap;
		cursor: pointer;
		--icon-size: 15px;
	}

	.terminal-stop.armed {
		padding: 0 10px;
	}
</style>
