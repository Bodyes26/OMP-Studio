<!--
  StatusMark.svelte — Segno di stato normativo e accessibile (Design v2).

  Stati gestiti:
  - pending: anello 14px 1.5px line-strong
  - running (o in_progress): anello 14px 1.5px line-strong con spin ink nel quarto superiore
  - completed (o done): disco 16px ink, spunta bg-raised 10px
  - blocked: cerchio 16px danger, punto esclamativo 10px on-danger (icona SVG, non Unicode)
  - failed (o aborted): cerchio 16px danger-dim, croce danger 10px
  - attention: punto 10px warn con anello ping 1.6s

  Regola Alive-and-Visible:
  - Si animano solo i segni visibili e attivi (active && visible && !motionReduced())
  - Rispetta prefers-reduced-motion e impostazione disattivazione animazioni
-->
<script lang="ts">
	import { IconCheck, IconClose } from '$lib/icons';
	import { motionReduced } from '$lib/agent/motionState.svelte';

	export type StatusMarkType =
		| 'pending'
		| 'running'
		| 'in_progress'
		| 'completed'
		| 'done'
		| 'blocked'
		| 'failed'
		| 'aborted'
		| 'attention';

	export interface StatusMarkProps {
		status: StatusMarkType;
		label?: string;
		active?: boolean;
		visible?: boolean;
		class?: string;
	}

	let {
		status,
		label,
		active = true,
		visible = true,
		class: customClass = ''
	}: StatusMarkProps = $props();

	const normalizedStatus = $derived.by(() => {
		switch (status) {
			case 'in_progress':
				return 'running';
			case 'done':
				return 'completed';
			case 'aborted':
				return 'failed';
			default:
				return status;
		}
	});

	let markNode = $state<HTMLSpanElement | null>(null);
	let onScreen = $state(false);
	let pageVisible = $state(true);
	const isAnimated = $derived(active && visible && onScreen && pageVisible && !motionReduced());

	$effect(() => {
		const node = markNode;
		if (!node || !active || !visible ||
			(normalizedStatus !== 'running' && normalizedStatus !== 'attention')) return;
		onScreen = false;
		const updateVisibility = () => { pageVisible = document.visibilityState !== 'hidden'; };
		updateVisibility();
		const observer = new IntersectionObserver(([entry]) => {
			const style = getComputedStyle(node);
			onScreen = entry.isIntersecting && style.visibility !== 'hidden';
		});
		observer.observe(node);
		document.addEventListener('visibilitychange', updateVisibility);
		return () => {
			observer.disconnect();
			document.removeEventListener('visibilitychange', updateVisibility);
		};
	});
</script>

<span
	bind:this={markNode}
	class={['status-mark-container', customClass].filter(Boolean).join(' ')}
	role={label ? 'status' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	{#if normalizedStatus === 'pending'}
		<span class="mark-pending"></span>
	{:else if normalizedStatus === 'running'}
		<span class="mark-running" class:mark-spin={isAnimated}></span>
	{:else if normalizedStatus === 'completed'}
		<span class="mark-completed">
			<IconCheck />
		</span>
	{:else if normalizedStatus === 'blocked'}
		<span class="mark-blocked">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="lucide lucide-alert-bang"
				aria-hidden="true"
			>
				<line x1="12" y1="6" x2="12" y2="13"></line>
				<line x1="12" y1="17" x2="12.01" y2="17"></line>
			</svg>
		</span>
	{:else if normalizedStatus === 'failed'}
		<span class="mark-failed">
			<IconClose />
		</span>
	{:else if normalizedStatus === 'attention'}
		<span class="mark-attention" class:mark-ping={isAnimated}></span>
	{/if}
</span>

<style>
	.status-mark-container {
		display: inline-grid;
		place-items: center;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		vertical-align: middle;
		line-height: 1;
	}

	/* Pending: anello neutro 14px da 1.5px */
	.mark-pending {
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		border: 1.5px solid var(--line-strong);
		box-sizing: border-box;
	}

	/* Running: anello 14px con quarto superiore in ink */
	.mark-running {
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		border: 1.5px solid var(--line-strong);
		border-top-color: var(--ink);
		box-sizing: border-box;
	}

	.mark-spin {
		animation: spin 1s linear infinite;
	}

	/* Il completamento resta neutro: l'accento non indica successo. */
	.mark-completed {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: var(--radius-full);
		background: var(--ink);
		color: var(--bg-raised);
		box-sizing: border-box;
		--icon-size: 10px;
	}

	/* Blocked: cerchio 16px danger, punto esclamativo SVG on-danger 10px */
	.mark-blocked {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: var(--radius-full);
		background: var(--danger);
		color: var(--on-danger, var(--bg-sunken));
		box-sizing: border-box;
	}

	.mark-blocked svg {
		width: 10px;
		height: 10px;
	}

	/* Failed: cerchio 16px danger-dim, croce danger 10px */
	.mark-failed {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: var(--radius-full);
		background: var(--danger-dim);
		color: var(--danger);
		box-sizing: border-box;
		--icon-size: 10px;
	}

	/* Attention: punto 10px warn con alone pulsante 1.6s */
	.mark-attention {
		position: relative;
		width: 10px;
		height: 10px;
		border-radius: var(--radius-full);
		background: var(--warn);
		box-sizing: border-box;
	}

	.mark-attention.mark-ping::after {
		content: '';
		position: absolute;
		inset: -4px;
		border-radius: var(--radius-full);
		background: var(--warn);
		opacity: 0.35;
		animation: status-ping 1.6s var(--ease-out) infinite;
	}

	@keyframes status-ping {
		0% {
			transform: scale(0.6);
			opacity: 0.5;
		}
		80%,
		100% {
			transform: scale(2.2);
			opacity: 0;
		}
	}

</style>
