<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { TerminalSession, type TerminalAgentState, type TerminalSessionInfo } from './terminal';
	import '@xterm/xterm/css/xterm.css';

	let {
		cwd = '.',
		visible = true,
		onStateChange,
		onOpenFile,
		onInputPendingChange,
		onSessionChange,
		sessionRef
	} = $props<{
		cwd?: string;
		visible?: boolean;
		onStateChange?: (state: TerminalAgentState) => void;
		onOpenFile?: (relPath: string, line: number | null) => void;
		onInputPendingChange?: (pending: boolean) => void;
		onSessionChange?: (session: TerminalSessionInfo | null) => void;
		sessionRef?: (session: TerminalSession | null) => void;
	}>();

	let container: HTMLElement;
	let session: TerminalSession;
	onMount(() => {

		session = new TerminalSession(
			container,
			cwd,
			(state) => onStateChange?.(state),
			(relPath, line) => onOpenFile?.(relPath, line),
			(pending) => onInputPendingChange?.(pending),
			(info) => onSessionChange?.(info)
		);
		sessionRef?.(session);

		const handleRestart = (event: Event) => {
			const targetCwd = (event as CustomEvent<{ targetCwd?: string }>).detail?.targetCwd;
			if (!targetCwd || targetCwd === cwd) {
				void session?.restart();
			}
		};

		window.addEventListener('omp-terminals-restart', handleRestart);

		return () => {
			window.removeEventListener('omp-terminals-restart', handleRestart);
			sessionRef?.(null);
			if (session) session.destroy();
		};
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
	style:pointer-events={visible ? 'auto' : 'none'}
	style:position="absolute"
	style:inset="0"
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