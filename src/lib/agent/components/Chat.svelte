<script lang="ts">
	// Contenuto della colonna destra in modalita' GUI.
	//
	// Autoscroll ancorato in basso: se l'utente scrolla in su di piu' di 40px,
	// l'autoscroll si sospende e compare un pulsante «↓ In fondo».
	// Unico punto di innesto per i ganci verso il guscio (`setAgentUiHooks`).

	import type { AgentSession } from '../session.svelte';
	import type { StreamingBehavior } from '../wire';
	import { setAgentUiHooks } from '../ui-context';

	import ApprovalCard from './ApprovalCard.svelte';
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
	let behavior = $state<StreamingBehavior>('steer');

	function handleScroll() {
		if (!scrollEl) return;
		const distance = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
		userScrolledUp = distance > 40;
	}

	function scrollToBottom() {
		if (!scrollEl) return;
		scrollEl.scrollTop = scrollEl.scrollHeight;
		userScrolledUp = false;
	}

	// Autoscroll ancorato in fondo tramite ResizeObserver e MutationObserver:
	// segue lo streaming del testo e l'arrivo di nuove entry senza scatti o timeout non gestiti.
	$effect(() => {
		if (!scrollEl || !visible) return;

		if (!userScrolledUp) {
			scrollEl.scrollTop = scrollEl.scrollHeight;
		}

		const resizeObserver = new ResizeObserver(() => {
			if (!userScrolledUp && scrollEl) {
				scrollEl.scrollTop = scrollEl.scrollHeight;
			}
		});

		for (const child of scrollEl.children) {
			resizeObserver.observe(child);
		}

		const mutationObserver = new MutationObserver(() => {
			if (!scrollEl) return;
			for (const child of scrollEl.children) {
				resizeObserver.observe(child);
			}
			if (!userScrolledUp) {
				scrollEl.scrollTop = scrollEl.scrollHeight;
			}
		});

		mutationObserver.observe(scrollEl, { childList: true, subtree: true });

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
		<Transcript {session} />

		{#if session.pendingUi}
			<div class="pending-ui-slot">
				{#if session.pendingUi.kind === 'approval'}
					<ApprovalCard {session} pending={session.pendingUi} />
				{:else}
					<AskCard {session} pending={session.pendingUi} />
				{/if}
			</div>
		{/if}
	</div>

	{#if userScrolledUp}
		<button type="button" class="scroll-bottom-btn" onclick={scrollToBottom} title="Torna in fondo">
			↓ In fondo
		</button>
	{/if}

	<div class="footer-stack">
		{#if session.subagents.length > 0}
			<SubagentBar subagents={session.subagents} onOpen={() => (panelOpen = true)} />
		{/if}

		{#if session.todoPhases.length > 0}
			<TodoStrip phases={session.todoPhases} />
		{/if}

		<Composer
			{session}
			{behavior}
			{visible}
			onBehaviorChange={(b) => (behavior = b)}
			onSlashCommand={(cmd) => (onSlashCommand ? onSlashCommand(cmd) : false)}
		/>
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
		display: flex;
		flex-direction: column;
	}

	.pending-ui-slot {
		padding: 0 var(--space-3) var(--space-3);
		min-width: 0;
	}

	.scroll-bottom-btn {
		position: absolute;
		right: var(--space-4);
		bottom: 120px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-full);
		padding: 4px 10px;
		color: var(--ink);
		font-size: var(--text-xs);
		box-shadow: var(--shadow-overlay);
		cursor: pointer;
		z-index: var(--z-sticky);
	}

	.scroll-bottom-btn:hover {
		background: var(--bg-hover);
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
