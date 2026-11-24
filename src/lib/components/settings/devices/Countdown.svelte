<!--
  Quanto resta a un codice monouso (R-MI-53, R-MI-55, R-REM-25). Il tempo si
  ricalcola ogni secondo: un timer che scade non deve restare a schermo come se
  valesse ancora, quindi a zero il testo cambia e la schermata lo tratta come
  scaduto.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';

	let { expiresAt }: { expiresAt: number } = $props();

	let now = $state(Date.now());

	$effect(() => {
		const timer = window.setInterval(() => { now = Date.now(); }, 1000);
		return () => window.clearInterval(timer);
	});

	const remaining = $derived(Math.max(0, Math.floor((expiresAt - now) / 1000)));

	const label = $derived.by(() => {
		const minutes = Math.floor(remaining / 60);
		const seconds = String(remaining % 60).padStart(2, '0');
		return `${Math.floor(minutes / 60) > 0 ? `${Math.floor(minutes / 60)}:` : ''}${String(minutes % 60).padStart(2, '0')}:${seconds}`;
	});
</script>

<span class="countdown" class:expired={remaining === 0} aria-live="off">
	{remaining === 0 ? m.devices_expired() : m.devices_expires({ time: label })}
</span>

<style>
	.countdown {
		color: var(--ink-muted);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
	}
	.countdown.expired {
		color: var(--warn);
	}
</style>
