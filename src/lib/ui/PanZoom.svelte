<!--
  PanZoom.svelte — Contenitore con pan e zoom per diagrammi e anteprime.

  Un dito (o il mouse) trascina, due dita pizzicano attorno al loro centro, la
  rotella zooma sul puntatore, il doppio tocco/clic riporta alla vista iniziale.
  `touch-action: none` toglie al browser lo scorrimento e il pinch di pagina
  solo dentro l'area: fuori il resto dell'interfaccia scorre normalmente.
  I comandi dei pulsanti (`zoomIn`, `zoomOut`, `reset`) sono esposti per
  `bind:this`, cosi' desktop (toolbar) e telefono (gesti) usano lo stesso nucleo.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		minScale = 0.25,
		maxScale = 8,
		scale = $bindable(1),
		label
	}: {
		children: Snippet;
		minScale?: number;
		maxScale?: number;
		scale?: number;
		/** Nome accessibile dell'area. */
		label?: string;
	} = $props();

	let x = $state(0);
	let y = $state(0);
	let viewport = $state<HTMLDivElement | null>(null);

	const pointers = new Map<number, { x: number; y: number }>();
	let pinchStart: { distance: number; scale: number } | null = null;
	let dragging = $state(false);
	let lastTap = 0;
	let gestureMoved = false;
	let gestureStart: { x: number; y: number } | null = null;

	function clamp(value: number): number {
		return Math.min(maxScale, Math.max(minScale, value));
	}

	/** Cambia scala mantenendo fermo il punto (cx, cy) relativo al viewport. */
	function zoomAt(next: number, cx: number, cy: number) {
		const target = clamp(next);
		const ratio = target / scale;
		x = cx - (cx - x) * ratio;
		y = cy - (cy - y) * ratio;
		scale = target;
	}

	function center(): { cx: number; cy: number } {
		const rect = viewport?.getBoundingClientRect();
		return { cx: (rect?.width ?? 0) / 2, cy: (rect?.height ?? 0) / 2 };
	}

	export function zoomIn() {
		const { cx, cy } = center();
		zoomAt(scale * 1.25, cx, cy);
	}

	export function zoomOut() {
		const { cx, cy } = center();
		zoomAt(scale / 1.25, cx, cy);
	}

	export function reset() {
		scale = 1;
		x = 0;
		y = 0;
	}

	function localPoint(event: { clientX: number; clientY: number }) {
		const rect = viewport!.getBoundingClientRect();
		return { px: event.clientX - rect.left, py: event.clientY - rect.top };
	}

	function onWheel(event: WheelEvent) {
		event.preventDefault();
		const { px, py } = localPoint(event);
		zoomAt(scale * Math.exp(-event.deltaY * 0.0015), px, py);
	}

	function onPointerDown(event: PointerEvent) {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		if (pointers.size === 0) {
			gestureMoved = false;
			gestureStart = { x: event.clientX, y: event.clientY };
		}
		viewport?.setPointerCapture(event.pointerId);
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (pointers.size === 2) {
			gestureMoved = true;
			const [a, b] = [...pointers.values()];
			pinchStart = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale };
		}
		dragging = true;
	}

	function onPointerMove(event: PointerEvent) {
		const previous = pointers.get(event.pointerId);
		if (!previous) return;
		const current = { x: event.clientX, y: event.clientY };
		pointers.set(event.pointerId, current);
		if (gestureStart && Math.hypot(current.x - gestureStart.x, current.y - gestureStart.y) > 6) {
			gestureMoved = true;
		}

		if (pointers.size >= 2 && pinchStart) {
			const [a, b] = [...pointers.values()];
			const distance = Math.hypot(a.x - b.x, a.y - b.y);
			const mid = localPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
			if (pinchStart.distance > 0) zoomAt(pinchStart.scale * (distance / pinchStart.distance), mid.px, mid.py);
			return;
		}
		x += current.x - previous.x;
		y += current.y - previous.y;
	}

	function onPointerUp(event: PointerEvent) {
		pointers.delete(event.pointerId);
		if (pointers.size < 2) pinchStart = null;
		if (pointers.size === 0) {
			dragging = false;
			// Doppio tocco: stesso gesto di «zoom 1:1» dei visualizzatori mobili.
			const now = event.timeStamp;
			if (event.pointerType === 'touch' && event.type !== 'pointercancel' && !gestureMoved) {
				if (lastTap > 0 && now - lastTap < 300) {
					reset();
					lastTap = 0;
				} else {
					lastTap = now;
				}
			} else {
				lastTap = 0;
			}
		}
	}

	// `wheel` va agganciato non passivo per poter chiamare preventDefault.
	$effect(() => {
		const node = viewport;
		if (!node) return;
		node.addEventListener('wheel', onWheel, { passive: false });
		return () => node.removeEventListener('wheel', onWheel);
	});
</script>

<div
	bind:this={viewport}
	class="panzoom"
	class:dragging
	role="application"
	aria-label={label}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	ondblclick={reset}
>
	<div class="panzoom-layer" style:transform="translate({x}px, {y}px) scale({scale})">
		{@render children()}
	</div>
</div>

<style>
	.panzoom {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		touch-action: none;
		cursor: grab;
		user-select: none;
		-webkit-user-select: none;
	}

	.panzoom.dragging {
		cursor: grabbing;
	}

	.panzoom-layer {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		transform-origin: 0 0;
		will-change: transform;
	}
</style>
