<!--
  PullToRefresh.svelte — Trascina verso il basso per ricaricare la PWA.
  Serve solo nell'app installata: li' `overscroll-behavior: none` (app.css)
  toglie il gesto nativo del browser e, se la schermata resta ferma, non c'e'
  altro modo di ricaricarla che chiudere e riaprire. Parte solo se il tocco
  inizia su una zona gia' scrollata fino in cima.
-->
<script lang="ts">
	import { t } from '../i18n.ts';
	import { IconRefresh } from '../icons.ts';
	import { reloadApp } from '../reloadApp.ts';

	const THRESHOLD = 80;
	const MAX_PULL = 120;

	let pull = $state(0);
	let refreshing = $state(false);
	let startY = 0;
	let tracking = false;

	function canPullFrom(target: EventTarget | null): boolean {
		let el = target instanceof Element ? target : null;
		while (el && el !== document.documentElement) {
			if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return false;
			const overflowY = getComputedStyle(el).overflowY;
			if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollTop > 0) return false;
			el = el.parentElement;
		}
		return true;
	}

	$effect(() => {
		if (!document.documentElement.hasAttribute('data-standalone')) return;

		const onStart = (e: TouchEvent) => {
			tracking = e.touches.length === 1 && !refreshing && canPullFrom(e.target);
			startY = e.touches[0]?.clientY ?? 0;
			pull = 0;
		};
		const onMove = (e: TouchEvent) => {
			if (!tracking) return;
			const dy = (e.touches[0]?.clientY ?? 0) - startY;
			if (dy <= 0) {
				pull = 0;
				return;
			}
			pull = Math.min(MAX_PULL, dy * 0.5);
		};
		const onEnd = () => {
			if (!tracking) return;
			tracking = false;
			if (pull >= THRESHOLD / 2) {
				refreshing = true;
				pull = THRESHOLD / 2;
				reloadApp();
			} else {
				pull = 0;
			}
		};

		document.addEventListener('touchstart', onStart, { passive: true });
		document.addEventListener('touchmove', onMove, { passive: true });
		document.addEventListener('touchend', onEnd, { passive: true });
		document.addEventListener('touchcancel', onEnd, { passive: true });
		return () => {
			document.removeEventListener('touchstart', onStart);
			document.removeEventListener('touchmove', onMove);
			document.removeEventListener('touchend', onEnd);
			document.removeEventListener('touchcancel', onEnd);
		};
	});
</script>

{#if pull > 0}
	<div
		class="ptr"
		class:spinning={refreshing}
		style:transform="translate(-50%, {pull - 20}px)"
		style:opacity={Math.min(1, pull / (THRESHOLD / 2))}
		role="status"
		aria-label={t('refreshing')}
	>
		<IconRefresh />
	</div>
{/if}

<style>
	.ptr {
		position: fixed;
		top: env(safe-area-inset-top, 0px);
		left: 50%;
		z-index: 1000;
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--bg-overlay, #222);
		color: var(--text-primary, #fff);
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
		pointer-events: none;
	}
	.spinning :global(svg) {
		animation: ptr-spin 0.8s linear infinite;
	}
	@keyframes ptr-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
