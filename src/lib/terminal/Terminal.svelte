<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { TerminalSession, type TerminalAgentState, type TerminalSessionInfo } from './terminal';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import '@xterm/xterm/css/xterm.css';

	let {
		cwd = '.',
		visible = true,
		resumeSessionId = null,
		launchArgs = null,
		onStateChange,
		onOpenFile,
		onInputPendingChange,
		onSessionChange,
		sessionRef
	} = $props<{
		cwd?: string;
		visible?: boolean;
		/** Sessione da riprendere all'avvio: la porta il passaggio da GUI. */
		resumeSessionId?: string | null;
		/** Argomenti espliciti per `omp` (il modal di setup lancia `omp setup`). */
		launchArgs?: string[] | null;
		onStateChange?: (state: TerminalAgentState) => void;
		onOpenFile?: (relPath: string, line: number | null) => void;
		onInputPendingChange?: (pending: boolean) => void;
		onSessionChange?: (session: TerminalSessionInfo | null) => void;
		sessionRef?: (session: TerminalSession | null) => void;
	}>();

	let container: HTMLElement;
	// Reattiva: l'`$effect` sulla visibilita' legge `session`, e con un `let`
	// semplice non si sarebbe mai riattivato dopo l'assegnazione in `onMount`.
	let session = $state<TerminalSession | null>(null);
	onMount(() => {

		session = new TerminalSession(
			container,
			cwd,
			(state) => onStateChange?.(state),
			(relPath, line) => onOpenFile?.(relPath, line),
			(pending) => onInputPendingChange?.(pending),
			(info) => onSessionChange?.(info),
			resumeSessionId,
			launchArgs
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

	// Il riadattamento va rimandato di un tick: alla comparsa il contenitore
	// non ha ancora le dimensioni finali. Il timer va annullato, o un cambio
	// rapido di scheda lascerebbe un `fit` in volo su un terminale distrutto.
	$effect(() => {
		if (!visible || !session) return;
		const current = session;
		const timer = window.setTimeout(() => current.fit(), 10);
		return () => window.clearTimeout(timer);
	});

	// Le preferenze del terminale si applicano a caldo: leggere i singoli
	// campi (non l'oggetto) evita di rieseguire l'effetto per scritture che
	// non riguardano il terminale (es. editor). Mai ricreare la sessione per
	// un cambio di impostazione.
	$effect(() => {
		void settingsStore.terminal.fontSize;
		void settingsStore.terminal.fontFamily;
		void settingsStore.terminal.scrollback;
		void settingsStore.terminal.cursorBlink;
		session?.applySettings();
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