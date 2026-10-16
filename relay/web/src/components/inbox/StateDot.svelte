<!--
  StateDot.svelte — Adattatore verso il segno di stato canonico di Studio (StatusMark).
  Riutilizza la convenzione di stato ufficiale del progetto senza duplicare stili o animazioni.
-->
<script lang="ts">
	import type { FleetSessionState } from '../../fleet.ts';
	import StatusMark, { type StatusMarkType } from '../StatusMark.svelte';

	let {
		state = 'idle',
		class: extraClass = ''
	}: {
		state?: FleetSessionState | string;
		class?: string;
	} = $props();

	const statusMarkStatus = $derived.by<StatusMarkType>(() => {
		switch (state) {
			case 'working':
			case 'running':
			case 'background':
				return 'running';
			case 'waiting':
			case 'attention':
				return 'attention';
			case 'error':
				return 'failed';
			case 'done':
			case 'completed':
				return 'completed';
			case 'idle':
			default:
				return 'pending';
		}
	});
</script>

<StatusMark status={statusMarkStatus} class={extraClass} />
