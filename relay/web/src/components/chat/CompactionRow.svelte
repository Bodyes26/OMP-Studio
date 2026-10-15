<!--
  CompactionRow.svelte — Notifica di compattazione o avviso di sistema della sessione.
  Traccia leggera a 12.5px, icona 14px, colore --ink-faint.
-->
<script lang="ts">
	import type { RemoteChatMessage } from '../../../../src/protocol.ts';
	import { IconRefresh } from '../../icons.ts';

	let { message }: { message: RemoteChatMessage } = $props();
</script>

<div class="compaction-row rv-blur">
	<span class="row-icon" aria-hidden="true"><IconRefresh /></span>
	<span class="row-text">{message.text}</span>
</div>

<style>
	.compaction-row {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-1) 0;
		padding: 3px var(--space-2);
		font-size: var(--text-trace);
		color: var(--ink-faint);
		user-select: none;
		--icon-size: 13px;
	}

	.row-icon {
		display: inline-flex;
		align-items: center;
		color: var(--ink-faint);
	}

	.row-text {
		line-height: 1.4;
	}
</style>
