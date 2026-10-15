<!--
  ActivityIndicator.svelte — Indicatore di attivita' dell'agente con StatusMark animato,
  testo shimmer e cronometro del tempo trascorso.
  Fedele a src/lib/agent/components/ActivityIndicator.svelte di Studio.
-->
<script lang="ts">
	import { t, getLanguage } from '../../i18n.ts';
	import StatusMark from '../StatusMark.svelte';

	let {
		startedAt = null,
		label = null
	}: {
		startedAt?: number | null;
		label?: string | null;
	} = $props();

	let now = $state(Date.now());
	const elapsed = $derived(startedAt != null ? Math.max(0, now - startedAt) : 0);
	const showTimer = $derived(startedAt != null && elapsed >= 1000);

	$effect(() => {
		const anchor = startedAt;
		if (anchor == null) return;

		let stopped = false;
		let timer: ReturnType<typeof setTimeout>;

		const tick = () => {
			if (stopped) return;
			const stamp = Date.now();
			now = stamp;
			timer = setTimeout(tick, stamp - anchor < 60_000 ? 100 : 1000);
		};

		timer = setTimeout(tick, 100);
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	});

	function formatElapsed(ms: number): string {
		const totalSecs = Math.floor(ms / 1000);
		if (totalSecs < 60) {
			const dec = (ms / 1000).toFixed(1);
			const formatted = getLanguage() === 'it' ? dec.replace('.', ',') : dec;
			return `${formatted} s`;
		}
		const mins = Math.floor(totalSecs / 60);
		const secs = totalSecs % 60;
		return `${mins}m ${secs}s`;
	}
</script>

<div class="activity rv-blur" role="status" aria-live="polite">
	<StatusMark status="running" />
	<span class="label text-shimmer">{label ?? t('chatThinkingStreaming')}</span>
	{#if showTimer}
		<span class="elapsed tabular-nums font-mono">{formatElapsed(elapsed)}</span>
	{/if}
</div>

<style>
	.activity {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: fit-content;
		padding: var(--space-1) var(--space-2);
		user-select: none;
	}

	.label {
		font-size: 13.5px;
		font-weight: 500;
	}

	.elapsed {
		font-size: var(--text-meta);
		color: var(--ink-faint);
		white-space: nowrap;
	}
</style>
