<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { onMount, onDestroy } from 'svelte';
	import { TerminalSession, type TerminalAgentState, type TerminalSessionInfo } from './terminal';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { contextMenu, type ContextMenuEntry } from '$lib/contextMenu.svelte';
	import { IconCopy, IconPaste, IconSelectAll, IconClear } from '$lib/icons';
	import { IconWarning, IconClose } from '$lib/icons';
	import type { BlockedQuotaState } from '$lib/agent/quotaRecovery';
	import { IS_MAC as isMac, MOD_LABEL as mod } from '$lib/utils/platform';
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
		sessionRef,
		blockedQuota = null,
		onDismissBlockedQuota,
		onSwitchToGui,
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
		blockedQuota?: BlockedQuotaState | null;
		onDismissBlockedQuota?: () => void;
		onSwitchToGui?: () => void;
	}>();

	let container: HTMLElement;
	// Reattiva: l'`$effect` sulla visibilita' legge `session`, e con un `let`
	// semplice non si sarebbe mai riattivato dopo l'assegnazione in `onMount`.
	let session = $state<TerminalSession | null>(null);
	let agentState = $state<TerminalAgentState>('unknown');
	let stopArmed = $state(false);
	let stopArmedTimer: ReturnType<typeof setTimeout> | null = null;

	function clearTerminalStopArmed() {
		if (stopArmedTimer) {
			clearTimeout(stopArmedTimer);
			stopArmedTimer = null;
		}
		stopArmed = false;
	}

	function handleTerminalStopClick() {
		if (!stopArmed) {
			// Fase 1: Soft abort (SIGINT/Ctrl+C)
			void session?.interrupt();
			stopArmed = true;
			if (stopArmedTimer) clearTimeout(stopArmedTimer);
			stopArmedTimer = setTimeout(() => {
				stopArmed = false;
				stopArmedTimer = null;
			}, 2000);
		} else {
			// Fase 2: Forza arresto immediato (SIGKILL / taskkill)
			clearTerminalStopArmed();
			void session?.forceKill();
		}
	}

	$effect(() => {
		if (agentState !== 'working' && stopArmed) {
			clearTerminalStopArmed();
		}
	});

	onMount(() => {
		session = new TerminalSession(
			container,
			cwd,
			(state) => {
				agentState = state;
				onStateChange?.(state);
			},
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
			if (stopArmedTimer) clearTimeout(stopArmedTimer);
			if (session) session.destroy();
		};
	});

	onDestroy(() => {
		if (stopArmedTimer) clearTimeout(stopArmedTimer);
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

		if (agentState === 'working' || stopArmed) {
			items.push(
				{
					kind: 'item',
					label: stopArmed ? m.force_kill_session_btn() : m.terminal_stop_agent_btn(),
					icon: IconClear,
					shortcut: stopArmed ? 'SIGKILL' : `${mod}C`,
					run: handleTerminalStopClick
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
				hint: !hasSel ? 'Nessun testo selezionato' : undefined,
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
				label: 'Pulisci visualizzazione',
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

{#if visible && (agentState === 'working' || stopArmed)}
	<div class="terminal-stop-bar">
		<button
			type="button"
			class="terminal-stop-btn"
			class:armed={stopArmed}
			onclick={handleTerminalStopClick}
			title={stopArmed ? m.force_kill_session_btn() : m.terminal_stop_agent_btn()}
			aria-label={stopArmed ? m.force_kill_session_btn() : m.terminal_stop_agent_btn()}
		>
			<svg viewBox="0 0 16 16" class="btn-icon" aria-hidden="true">
				<rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" />
			</svg>
			<span class="btn-text">{stopArmed ? m.force_kill_session_short() : m.terminal_stop_agent_short()}</span>
		</button>
	</div>
{/if}

{#if visible && blockedQuota && !blockedQuota.dismissed}
	<div class="terminal-quota-banner" class:is-quota={blockedQuota.reasonKind === 'quota_exhausted'}>
		<div class="tqb-icon">
			<IconWarning />
		</div>
		<div class="tqb-body">
			<span class="tqb-title">{blockedQuota.title}</span>
			<span class="tqb-text">
				{m.ui_terminal_l_agente_si_e_fermato_allinea_il_fc3c()}<kbd>Ctrl+P</kbd>) e rilancia con <kbd>/retry</kbd>, oppure passa alla GUI per il recupero assistito.
			</span>
		</div>
		<div class="tqb-actions">
			{#if onSwitchToGui}
				<button type="button" class="tqb-btn" onclick={onSwitchToGui}>
					Passa alla GUI
				</button>
			{/if}
			{#if onDismissBlockedQuota}
				<button type="button" class="tqb-close" onclick={onDismissBlockedQuota} title={m.terminal_close_quota_alert()}>
					<IconClose />
				</button>
			{/if}
		</div>
	</div>
{/if}

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

	.terminal-quota-banner {
		position: absolute;
		top: var(--space-2);
		left: var(--space-2);
		right: var(--space-2);
		z-index: 10;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-surface-elevated, #242730);
		border: 1px solid var(--border-subtle);
		border-left: 3px solid var(--amber-fg, #f59e0b);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.25));
		pointer-events: auto;
	}

	.terminal-quota-banner.is-quota {
		border-left-color: var(--danger, #ef4444);
	}

	.tqb-icon {
		display: flex;
		align-items: center;
		color: var(--amber-fg, #f59e0b);
		flex-shrink: 0;
	}

	.terminal-quota-banner.is-quota .tqb-icon {
		color: var(--danger, #ef4444);
	}

	.tqb-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.tqb-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.tqb-text {
		font-size: var(--text-2xs);
		color: var(--ink-muted);
	}

	.tqb-text kbd {
		font-family: var(--font-mono);
		background: var(--bg-surface);
		padding: 1px 4px;
		border-radius: 3px;
		border: 1px solid var(--border-subtle);
		color: var(--ink);
	}

	.tqb-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.tqb-btn {
		font-size: var(--text-xs);
		padding: 3px 8px;
		border-radius: var(--radius-xs);
		background: var(--brand);
		color: var(--brand-contrast, #fff);
		font-weight: 500;
		cursor: pointer;
		border: none;
	}

	.tqb-btn:hover {
		opacity: 0.9;
	}

	.tqb-close {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		padding: 4px;
		border-radius: var(--radius-xs);
	}

	.tqb-close:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.terminal-stop-bar {
		position: absolute;
		top: var(--space-3);
		right: var(--space-3);
		z-index: 15;
		pointer-events: auto;
	}

	.terminal-stop-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		height: 28px;
		padding: 0 var(--space-2);
		background: var(--bg-overlay, var(--bg-raised));
		border: 1px solid var(--danger);
		border-radius: var(--radius-sm);
		color: var(--danger);
		font-size: var(--text-xs);
		font-weight: 500;
		cursor: pointer;
		backdrop-filter: blur(8px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
		transition: border-color var(--transition-fast, 120ms ease),
		            background var(--transition-fast, 120ms ease),
		            box-shadow var(--transition-fast, 120ms ease);
	}

	.terminal-stop-btn:hover {
		background: var(--danger-dim);
		border-color: var(--danger);
		color: var(--ink);
	}

	.terminal-stop-btn.armed {
		background: var(--danger-dim);
		border-color: var(--danger);
		color: var(--danger);
		animation: stop-armed-pulse 0.8s ease-in-out infinite alternate;
	}

	.terminal-stop-btn .btn-icon {
		width: 12px;
		height: 12px;
		flex-shrink: 0;
	}

	@keyframes stop-armed-pulse {
		0% {
			box-shadow: 0 0 0 1px var(--danger), 0 0 5px color-mix(in srgb, var(--danger) 45%, transparent);
			border-color: var(--danger);
		}
		100% {
			box-shadow: 0 0 0 2.5px var(--danger), 0 0 14px 2px color-mix(in srgb, var(--danger) 85%, transparent);
			border-color: var(--danger);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.terminal-stop-btn.armed {
			animation: none;
			box-shadow: 0 0 0 2px var(--danger);
		}
	}
</style>