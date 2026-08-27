<script lang="ts">
	// Contenuto della colonna destra in modalita' GUI.
	//
	// Autoscroll ancorato in basso: se l'utente si allontana dal fondo,
	// l'autoscroll si sospende e compare un pulsante «In fondo» con icona freccia in giu'.
	// Unico punto di innesto per i ganci verso il guscio (`setAgentUiHooks`).

	import type { AgentSession } from '../session.svelte';
	import { chatReveal } from '../motion';
	import { setAgentUiHooks } from '../ui-context';
	import { IconArrowDown } from '$lib/icons';
	import { settingsStore } from '$lib/stores/settings.svelte';

	import AskCard from './AskCard.svelte';
	import Composer from './Composer.svelte';
	import SubagentBar from './SubagentBar.svelte';
	import SubagentDrawer from './SubagentDrawer.svelte';
	import SubagentPanel from './SubagentPanel.svelte';
	import TodoStrip from './TodoStrip.svelte';
	import Transcript from './Transcript.svelte';

	let {
		session,
		visible = true,
		onOpenFile,
		onOpenImage,
		onSwitchToTerminal,
		onSlashCommand
	} = $props<{
		session: AgentSession;
		visible?: boolean;
		onOpenFile?: (path: string, line?: number | null) => void;
		onOpenImage?: (data: string, mimeType: string) => void;
		onSwitchToTerminal?: () => void;
		onSlashCommand?: (raw: string) => boolean;
	}>();

	// Ganci condivisi passati via contesto: i componenti annidati non hanno
	// bisogno di callback inoltrate a mano.
	setAgentUiHooks({
		openFile: (path, line) => onOpenFile?.(path, line),
		openImage: (data, mimeType) => onOpenImage?.(data, mimeType),
		openSubagent: (id) => {
			activeSubagentId = id;
			panelOpen = false;
		},
		switchToTerminal: () => onSwitchToTerminal?.()
	});

	let scrollEl: HTMLElement | null = $state(null);
	let userScrolledUp = $state(false);
	let panelOpen = $state(false);
	let activeSubagentId = $state<string | null>(null);

	let lastScrollTop = 0;
	// Soglia in pixel per considerare l'utente "al fondo" (tolleranza subpixel e font scaling).
	const SCROLL_THRESHOLD = 32;

	function autoScrollToBottom() {
		if (!scrollEl || userScrolledUp) return;
		scrollEl.scrollTop = scrollEl.scrollHeight;
		lastScrollTop = scrollEl.scrollTop;
	}

	function scrollToBottom() {
		if (!scrollEl) return;
		userScrolledUp = false;
		scrollEl.scrollTop = scrollEl.scrollHeight;
		lastScrollTop = scrollEl.scrollTop;
	}

	function handleScroll() {
		if (!scrollEl) return;
		const currentScrollTop = scrollEl.scrollTop;
		const distance = scrollEl.scrollHeight - currentScrollTop - scrollEl.clientHeight;

		// Se l'utente e' tornato vicino al fondo (o il contenuto entra nella viewport),
		// l'autoscroll si riaggancia automaticamente.
		if (distance <= SCROLL_THRESHOLD) {
			userScrolledUp = false;
		} else if (currentScrollTop < lastScrollTop - 2) {
			// Solo se lo scroll si muove effettivamente verso l'alto l'utente ha deciso
			// di allontanarsi dal fondo; la crescita di altezza del contenuto o le
			// animazioni transitorie non devono mai essere scambiate per uno scroll dell'utente.
			userScrolledUp = true;
		}

		lastScrollTop = currentScrollTop;
	}

	// Quando cambia la sessione attiva, ripristina l'ancoraggio in fondo.
	let lastSessionId: string | null = null;
	$effect(() => {
		const currentSessionId = session.sessionId ?? '';
		if (lastSessionId !== null && lastSessionId !== currentSessionId) {
			userScrolledUp = false;
			scrollToBottom();
		}
		lastSessionId = currentSessionId;
	});

	// Autoscroll ancorato in fondo tramite ResizeObserver e MutationObserver:
	// segue lo streaming del testo e l'arrivo di nuove entry senza scatti o timeout non gestiti.
	$effect(() => {
		if (!scrollEl || !visible) return;

		autoScrollToBottom();

		const resizeObserver = new ResizeObserver(() => {
			autoScrollToBottom();
		});

		// Osserva sia il contenitore scrollabile che tutti i figli diretti
		resizeObserver.observe(scrollEl);
		for (const child of scrollEl.children) {
			resizeObserver.observe(child);
		}

		const mutationObserver = new MutationObserver(() => {
			if (!scrollEl) return;
			for (const child of scrollEl.children) {
				resizeObserver.observe(child);
			}
			autoScrollToBottom();
		});

		mutationObserver.observe(scrollEl, { childList: true, subtree: true, characterData: true });

		return () => {
			resizeObserver.disconnect();
			mutationObserver.disconnect();
		};
	});
</script>

<div
	class="chat-surface"
	style:visibility={visible ? 'visible' : 'hidden'}
	style:pointer-events={visible ? 'auto' : 'none'}
	style:position="absolute"
	style:inset="0"
>
	<div class="scroll-area" bind:this={scrollEl} onscroll={handleScroll}>
		<div
			class="chat-content-container"
			class:readable={settingsStore.general.chatWidth === 'readable'}
		>
			<Transcript {session} />

			{#if session.pendingUi}
				<div
					class="pending-ui-slot"
					transition:chatReveal={{ duration: 220, blur: 4, distance: 3 }}
				>
					<AskCard {session} pending={session.pendingUi} />
				</div>
			{/if}
		</div>
	</div>

	{#if userScrolledUp}
		<button
			type="button"
			class="scroll-bottom-btn"
			class:readable={settingsStore.general.chatWidth === 'readable'}
			onclick={scrollToBottom}
			title="Torna in fondo"
			transition:chatReveal={{ duration: 180, blur: 3, distance: 2 }}
		>
			<IconArrowDown aria-hidden="true" />
			In fondo
		</button>
	{/if}

	<div class="footer-stack">
		<div
			class="footer-inner"
			class:readable={settingsStore.general.chatWidth === 'readable'}
		>
			{#if session.subagents.length > 0}
				<SubagentBar subagents={session.subagents} onOpen={() => (panelOpen = true)} />
			{/if}

			{#if session.todoPhases.length > 0}
				<TodoStrip phases={session.todoPhases} />
			{/if}

			<Composer
				{session}
				{visible}
				onSlashCommand={(cmd: string) => (onSlashCommand ? onSlashCommand(cmd) : false)}
			/>
		</div>
	</div>

	{#if panelOpen}
		<SubagentPanel
			subagents={session.subagents}
			onOpenDrawer={(id) => {
				activeSubagentId = id;
				panelOpen = false;
			}}
			onClose={() => (panelOpen = false)}
		/>
	{/if}

	{#if activeSubagentId}
		<SubagentDrawer
			{session}
			subagentId={activeSubagentId}
			onClose={() => (activeSubagentId = null)}
		/>
	{/if}
</div>

<style>
	.chat-surface {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		background-color: var(--bg-sunken);
		min-width: 0;
		overflow: hidden;
	}

	.scroll-area {
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow-y: auto;
		overflow-anchor: none;
		display: flex;
		flex-direction: column;
	}
	.chat-content-container {
		width: 100%;
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.chat-content-container.readable {
		max-width: 860px;
		margin: 0 auto;
	}


	.pending-ui-slot {
		padding: 0 var(--space-3) var(--space-3);
		min-width: 0;
	}

	.scroll-bottom-btn {
		position: absolute;
		right: var(--space-4);
		bottom: calc(var(--space-5) * 5);
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-full);
		padding: var(--space-1) var(--space-3);
		color: var(--ink);
		font-size: var(--text-xs);
		cursor: pointer;
		z-index: var(--z-sticky);
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		--icon-size: 12px;
	}
	.scroll-bottom-btn:hover {
		background: var(--bg-hover);
	}

	.scroll-bottom-btn.readable {
		right: max(var(--space-4), calc(50% - 430px + var(--space-4)));
	}

	.footer-inner {
		width: 100%;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.footer-inner.readable {
		max-width: 860px;
		margin: 0 auto;
	}

	.footer-stack {
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		border-top: 1px solid var(--line);
		min-width: 0;
		z-index: var(--z-sticky);
	}
</style>
