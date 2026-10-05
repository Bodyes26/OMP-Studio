<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { onMount, onDestroy } from 'svelte';
	import { TerminalSession, type TerminalAgentState, type TerminalSessionInfo } from './terminal';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { contextMenu, type ContextMenuEntry } from '$lib/contextMenu.svelte';
	import { IconCopy, IconPaste, IconSelectAll, IconClear, IconStop } from '$lib/icons';
	import { TerminalStopControl } from './stopControl.svelte';
	import { IS_MAC as isMac, MOD_LABEL as mod } from '$lib/utils/platform';
	import '@xterm/xterm/css/xterm.css';

	let {
		cwd = '.',
		visible = true,
		resumeSessionId = null,
		launchArgs = null,
		laneId = null,
		projectId = null,
		continueLast = false,
		onStateChange,
		onOpenFile,
		onInputPendingChange,
		onSessionChange,
		sessionRef,
		stopRef,
	} = $props<{
		cwd?: string;
		visible?: boolean;
		/** Sessione da riprendere all'avvio: la porta il passaggio da GUI. */
		resumeSessionId?: string | null;
		/** Argomenti espliciti per `omp` (il modal di setup lancia `omp setup`). */
		launchArgs?: string[] | null;
		laneId?: string | null;
		projectId?: string | null;
		continueLast?: boolean;
		onStateChange?: (state: TerminalAgentState) => void;
		onOpenFile?: (relPath: string, line: number | null) => void;
		onInputPendingChange?: (pending: boolean) => void;
		onSessionChange?: (session: TerminalSessionInfo | null) => void;
		sessionRef?: (session: TerminalSession | null) => void;
		/** Lo Stop sta nella testata della colonna, fuori dalla viewport (D6). */
		stopRef?: (control: TerminalStopControl | null) => void;
	}>();

	let container: HTMLElement;
	// Reattiva: l'`$effect` sulla visibilita' legge `session`, e con un `let`
	// semplice non si sarebbe mai riattivato dopo l'assegnazione in `onMount`.
	let session = $state<TerminalSession | null>(null);
	const stop = new TerminalStopControl(() => session);

	onMount(() => {
		session = new TerminalSession(
			container,
			cwd,
			(state) => {
				stop.setWorking(state === 'working');
				onStateChange?.(state);
			},
			(relPath, line) => onOpenFile?.(relPath, line),
			(pending) => onInputPendingChange?.(pending),
			(info) => onSessionChange?.(info),
			resumeSessionId,
			launchArgs,
			laneId,
			projectId,
			continueLast
		);
		sessionRef?.(session);
		stopRef?.(stop);

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
			stopRef?.(null);
			stop.disarm();
			if (session) session.destroy();
		};
	});

	onDestroy(() => {
		stop.disarm();
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

	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		if (!visible || !session) return;

		const hasSel = session.hasSelection();

		const items: ContextMenuEntry[] = [];

		if (stop.visible) {
			items.push(
				{
					kind: 'item',
					label: stop.armed ? m.force_kill_session_btn() : m.terminal_stop_agent_btn(),
					icon: IconStop,
					shortcut: stop.armed ? 'SIGKILL' : `${mod}C`,
					run: () => stop.press()
				},
				{ kind: 'separator' }
			);
		}

		items.push(
			{
				kind: 'item',
				label: m.context_menu_item_copy(),
				icon: IconCopy,
				shortcut: `${mod}C`,
				disabled: !hasSel,
				hint: !hasSel ? m.context_menu_hint_no_selection() : undefined,
				run: () => void session?.copy()
			},
			{
				kind: 'item',
				label: m.context_menu_item_paste(),
				icon: IconPaste,
				shortcut: `${mod}V`,
				run: () => void session?.paste()
			},
			{
				kind: 'item',
				label: m.context_menu_item_select_all(),
				icon: IconSelectAll,
				shortcut: `${mod}A`,
				run: () => session?.selectAll()
			},
			{
				kind: 'separator'
			},
			{
				kind: 'item',
				label: m.terminal_context_clear(),
				icon: IconClear,
				shortcut: isMac ? '⌘K' : 'Ctrl+L',
				run: () => session?.clear()
			}
		);

		contextMenu.open(event, {
			label: m.ui_terminal_terminale_cb00(),
			items,
			invoker: container
		});
	}
</script>

<!-- Il nodo e' solo l'host di xterm; l'elemento interattivo con ruolo e focus viene creato da xterm. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div 
	bind:this={container} 
	class="terminal-container" 
	style:visibility={visible ? 'visible' : 'hidden'}
	style:pointer-events={visible ? 'auto' : 'none'}
	style:position="absolute"
	style:inset="0"
	oncontextmenu={handleContextMenu}
></div>

<style>
	.terminal-container {
		width: 100%;
		height: 100%;
		padding: 0 var(--space-2);
		background-color: var(--bg-sunken);
		/* The inset is used when position is absolute */
		inset: 0;
	}

	/* Force canvas renderer to respect our CSS variables if needed, though we set hex in JS */
	:global(.xterm-viewport) {
		background-color: transparent !important;
	}
</style>