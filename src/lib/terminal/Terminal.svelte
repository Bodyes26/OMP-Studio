<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { TerminalSession } from './terminal';
	import '@xterm/xterm/css/xterm.css';

	let { cwd = '.', visible = true, onStateChange, onOpenFile } = $props<{
		cwd?: string,
		visible?: boolean,
		onStateChange?: (s: string) => void,
		onOpenFile?: (relPath: string, line: number | null) => void
	}>();

	let container: HTMLElement;
	let session: TerminalSession;

	onMount(() => {
		session = new TerminalSession(
			container,
			cwd,
			(s) => onStateChange?.(s),
			(relPath, line) => onOpenFile?.(relPath, line)
		);
	});

	onDestroy(() => {
		if (session) session.destroy();
	});

	// React to visibility changes
	$effect(() => {
		if (visible && session) {
			// Small timeout to allow DOM to render before fitting
			setTimeout(() => session.fit(), 10);
		}
	});
</script>

<div 
	bind:this={container} 
	class="terminal-container" 
	style:visibility={visible ? 'visible' : 'hidden'}
	style:position={visible ? 'relative' : 'absolute'}
></div>

<style>
	.terminal-container {
		width: 100%;
		height: 100%;
		padding: var(--space-2);
		background-color: var(--bg-sunken);
		/* The inset is used when position is absolute */
		inset: 0;
	}

	/* Force canvas renderer to respect our CSS variables if needed, though we set hex in JS */
	:global(.xterm-viewport) {
		background-color: transparent !important;
	}
</style>