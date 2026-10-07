<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Contenuto della colonna destra in modalita' GUI.
	//
	// Autoscroll ancorato in basso: se l'utente si allontana dal fondo,
	// l'autoscroll si sospende e compare un pulsante «In fondo» con icona freccia in giu'.
	// Unico punto di innesto per i ganci verso il guscio (`setAgentUiHooks`).

	import type { AgentSession, QueuedMessage } from '../session.svelte';
	import type { RestoredQueuedMessage } from '../wire';
	import type { SuggestionChipItem } from '$lib/stores/promptSuggestions';
	import { setContext, tick as svelteTick } from 'svelte';
	import { chatReveal } from '../motion';
	import { setAgentUiHooks } from '../ui-context';
	import { IconArrowDown, IconAt } from '$lib/icons';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { motionReduced } from '../motionState.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { dropSummary, physicalToCssPoint } from '../chatDrop';

	import AskCard from './AskCard.svelte';
	import AskStreamPreview from './AskStreamPreview.svelte';
	import Composer from './Composer.svelte';
	import ComposerTray from './ComposerTray.svelte';
	import QueueChips from './QueueChips.svelte';
	import SubagentDrawer from './SubagentDrawer.svelte';
	import SuggestionChips from './SuggestionChips.svelte';
	import Transcript from './Transcript.svelte';

	let {
		session,
		visible = true,
		onOpenFile,
		onOpenImage,
		onSwitchToTerminal,
		onSlashCommand,
		onNewChat
	} = $props<{
		session: AgentSession;
		visible?: boolean;
		onOpenFile?: (path: string, line?: number | null) => void;
		onOpenImage?: (data: string, mimeType: string) => void;
		onSwitchToTerminal?: () => void;
		onSlashCommand?: (raw: string) => boolean;
		onNewChat?: () => void;
	}>();

	/** Inserisce testo nel composer della sessione attiva */
	export function insertText(text: string): void {
		session.insertComposerText(text);
	}
	setContext<() => string>('git-diff-project-path', () => session.cwd);
	// Ganci condivisi passati via contesto: i componenti annidati non hanno
	// bisogno di callback inoltrate a mano.
	setAgentUiHooks({
		openFile: (path, line) => onOpenFile?.(path, line),
		openImage: (data, mimeType) => onOpenImage?.(data, mimeType),
		openSubagent: (id) => {
			activeSubagentId = id;
		},
		cancelSubagent: (id) => {
			void session.cancelSubagent(id);
		},
		switchToTerminal: () => onSwitchToTerminal?.()
	});

	let scrollEl: HTMLElement | null = $state(null);
	let contentEl: HTMLElement | null = $state(null);
	let userScrolledUp = $state(false);
	let pinned = true;
	let rafId = 0;
	let askMinimizedRequestId = $state<string | null>(null);
	const askMinimized = $derived(
		session.pendingUi !== null && session.pendingUi.requestId === askMinimizedRequestId
	);
	function minimizeAsk() {
		if (!session.pendingUi) return;
		askMinimizedRequestId = session.pendingUi.requestId;
		if (visible && document.hasFocus()) void svelteTick().then(() => composerRef?.focus());
	}
	function openAsk() {
		askMinimizedRequestId = null;
	}
	let activeSubagentId = $state<string | null>(null);
	let quotaSwitching = $state(false);
	const quotaInfo = $derived.by(() => {
		const bq = session.blockedQuotaState;
		if (!bq || bq.dismissed) return undefined;
		const suggested = bq.suggestedModel;
		return {
			kind: bq.reasonKind === 'quota_exhausted' ? ('exhausted' as const) : ('limit' as const),
			title: bq.title,
			message: bq.message,
			diagnostic: bq.rawError,
			switchLabel: suggested ? m.chat_v2_tray_quota_switch({ model: suggested.modelName }) : undefined,
			switching: quotaSwitching,
			onSwitch: suggested
				? async () => {
						if (quotaSwitching) return;
						quotaSwitching = true;
						try {
							await session.applyQuotaRecovery(suggested.selector, suggested.thinking);
						} finally {
							quotaSwitching = false;
						}
				  }
				: undefined,
			onChooseModel: () => modelSettingsStore.openModal('catalog'),
			onDismiss: () => session.dismissBlockedQuota()
		};
	});

	let lastScrollTop = 0;
	// Soglia in pixel per considerare l'utente "al fondo" (tolleranza subpixel e font scaling).
	const SCROLL_THRESHOLD = 40;

	function requestScrollToBottom() {
		if (!visible || !scrollEl || !pinned || userScrolledUp) return;
		if (motionReduced()) {
			const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
			scrollEl.scrollTop = maxScroll;
			lastScrollTop = scrollEl.scrollTop;
			return;
		}
		if (rafId) return;
		rafId = requestAnimationFrame(() => {
			rafId = 0;
			if (!visible || !scrollEl || !pinned || userScrolledUp) return;
			const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
			if (Math.abs(scrollEl.scrollTop - maxScroll) >= 1) {
				scrollEl.scrollTop = maxScroll;
				lastScrollTop = scrollEl.scrollTop;
			}
		});
	}

	function scrollToBottom() {
		if (!visible || !scrollEl) return;
		pinned = true;
		userScrolledUp = false;
		if (rafId) {
			cancelAnimationFrame(rafId);
			rafId = 0;
		}
		const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
		scrollEl.scrollTop = maxScroll;
		lastScrollTop = scrollEl.scrollTop;
	}

	function handleWheel(e: WheelEvent) {
		if (e.deltaY < 0) {
			pinned = false;
			userScrolledUp = true;
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			}
		}
	}

	function handleScroll() {
		if (!scrollEl) return;
		const currentScrollTop = scrollEl.scrollTop;
		const distance = scrollEl.scrollHeight - currentScrollTop - scrollEl.clientHeight;

		// Se l'utente e' entro la soglia dal fondo, si riaggancia automaticamente.
		if (distance <= SCROLL_THRESHOLD) {
			pinned = true;
			userScrolledUp = false;
		} else if (currentScrollTop < lastScrollTop - 2) {
			// Solo se lo scroll si muove effettivamente verso l'alto l'utente ha deciso
			// di allontanarsi dal fondo.
			pinned = false;
			userScrolledUp = true;
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			}
		}

		lastScrollTop = currentScrollTop;
	}

	// Quando cambia la sessione attiva, ripristina l'ancoraggio in fondo.
	let lastSessionId: string | null = null;
	$effect(() => {
		const currentSessionId = session.sessionId ?? '';
		if (lastSessionId !== null && lastSessionId !== currentSessionId) {
			pinned = true;
			userScrolledUp = false;
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			}
			if (scrollEl && visible) {
				scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
				lastScrollTop = scrollEl.scrollTop;
			}
		}
		lastSessionId = currentSessionId;
	});

	// Quando viene seminato un nuovo prompt (lancio da coda), garantisce l'ancoraggio in fondo.
	$effect(() => {
		if (session.seededPrompt) {
			pinned = true;
			userScrolledUp = false;
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			}
			if (scrollEl && visible) {
				scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
				lastScrollTop = scrollEl.scrollTop;
			}
		}
	});

	// Autoscroll ancorato in fondo tramite ResizeObserver con coalescing per frame:
	// segue lo streaming e le rivelazioni (chatReveal) senza ritardo esponenziale.
	$effect(() => {
		if (!scrollEl || !visible) return;

		scrollEl.addEventListener('wheel', handleWheel, { passive: true });
		requestScrollToBottom();

		const resizeObserver = new ResizeObserver(() => {
			requestScrollToBottom();
		});

		resizeObserver.observe(scrollEl);
		if (contentEl) {
			resizeObserver.observe(contentEl);
		}
		return () => {
			scrollEl?.removeEventListener('wheel', handleWheel);
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			}
			resizeObserver.disconnect();
		};
	});

	let isDraggingColumn = $state(false);
	let dragSummary = $state('');
	let surfaceEl: HTMLElement | null = $state(null);
	let composerRef: {
		focus: () => void;
		addPaths: (paths: readonly string[]) => Promise<void>;
		restoreQueue: (entries: readonly RestoredQueuedMessage[]) => void;
		visibleSuggestionChips: () => SuggestionChipItem[];
		applySuggestionChip: (prompt: string) => void;
	} | null = $state(null);

	/**
	 * Il trascinamento dal sistema operativo e' intercettato da Tauri
	 * (dragDropEnabled): gli eventi HTML `drop` non ricevono i file, arriva
	 * solo l'evento nativo con i percorsi e la posizione. Ogni Chat montata lo
	 * riceve, ma reagisce solo quella sotto il puntatore: le chat nascoste
	 * hanno `visibility: hidden` e `elementFromPoint` non le trova.
	 * I trascinamenti interni (linguette dell'editor) restano HTML5 e non
	 * passano da qui.
	 */
	function isOverThisChat(position: { x: number; y: number }): boolean {
		if (!visible || !surfaceEl) return false;
		const point = physicalToCssPoint(position, window.devicePixelRatio);
		const target = document.elementFromPoint(point.x, point.y);
		return target !== null && surfaceEl.contains(target);
	}

	$effect(() => {
		if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
		let disposed = false;
		let unlisten: (() => void) | null = null;
		let paths: string[] = [];
		void getCurrentWebview()
			.onDragDropEvent((event) => {
				const payload = event.payload;
				if (payload.type === 'leave') {
					isDraggingColumn = false;
					paths = [];
					return;
				}
				if (payload.type === 'enter') {
					paths = payload.paths;
					dragSummary = dropSummary(paths);
				}
				const inside = paths.length > 0 && isOverThisChat(payload.position);
				if (payload.type === 'drop') {
					isDraggingColumn = false;
					const dropped = payload.paths.length > 0 ? payload.paths : paths;
					paths = [];
					if (inside && dropped.length > 0 && composerRef) {
						void composerRef.addPaths(dropped).then(() => composerRef?.focus());
					}
					return;
				}
				isDraggingColumn = inside;
			})
			.then((stop) => {
				if (disposed) stop();
				else unlisten = stop;
			})
			.catch((error) => console.warn('Trascinamento nativo non disponibile:', error));
		return () => {
			disposed = true;
			unlisten?.();
			isDraggingColumn = false;
		};
	});

	/**
	 * Modifica di un chip: il messaggio esce dalla coda di omp e torna
	 * nell'editor, accanto alla bozza se ce n'e' una. Il testo del chip e'
	 * opaco e va rimandato identico al comando.
	 */
	async function editQueuedMessage(chip: QueuedMessage) {
		const restored = await session.removeQueuedMessage(chip.text, chip.queue);
		if (!restored) return;
		composerRef?.restoreQueue([restored]);
		composerRef?.focus();
	}

	async function removeQueuedMessage(chip: QueuedMessage) {
		await session.removeQueuedMessage(chip.text, chip.queue);
	}

	async function promoteQueuedMessage(chip: QueuedMessage) {
		await session.promoteQueuedMessage(chip.text);
	}

</script>

<div
	bind:this={surfaceEl}
	class="chat-surface"
	style:visibility={visible ? 'visible' : 'hidden'}
	style:content-visibility={visible ? 'visible' : 'hidden'}
	style:pointer-events={visible ? 'auto' : 'none'}
	style:position="absolute"
	style:inset="0"
>
	{#if isDraggingColumn}
		<div class="chat-column-drag-overlay" aria-hidden="true">
			<div class="drag-overlay-card">
				<span class="drag-overlay-label">
					<IconAt aria-hidden="true" />
					{m.chat_v2_composer_drop_overlay()}
				</span>
				{#if dragSummary}
					<span class="drag-overlay-names font-mono">{dragSummary}</span>
				{/if}
				<span class="drag-overlay-hint">{m.chat_v2_drop_hint()}</span>
			</div>
		</div>
	{/if}
	<div class="scroll-area" bind:this={scrollEl} onscroll={handleScroll}>
		<div
			bind:this={contentEl}
			class="chat-content-container"
			class:readable={settingsStore.general.chatWidth === 'readable'}
		>
			<Transcript {session} {visible} />

			{#if session.streamAsk && !session.pendingUi && session.streamAsk.state.questions.length > 0}
				<div class="pending-ui-slot" transition:chatReveal={{ duration: 220, blur: 4, distance: 3 }}>
					<AskStreamPreview state={session.streamAsk.state} />
				</div>
			{/if}
		</div>
	</div>

	<div class="footer-stack" class:content-below={userScrolledUp}>
		<div
			class="footer-inner"
			class:readable={settingsStore.general.chatWidth === 'readable'}
		>
			{#if userScrolledUp}
				<div class="scroll-bottom-wrap">
					<Tooltip text={m.chat_scroll_to_bottom()}>
						<button
							type="button"
							class="scroll-bottom-btn rv-lift"
							onclick={scrollToBottom}
							aria-label={m.chat_scroll_to_bottom()}
							style="--dur: 200ms; --blur: 2px;"
						>
							<IconArrowDown aria-hidden="true" />
						</button>
					</Tooltip>
				</div>
			{/if}
			{#snippet queuedRows()}
				<QueueChips
					chips={session.queuedChips}
					onEdit={editQueuedMessage}
					onRemove={removeQueuedMessage}
					onPromote={promoteQueuedMessage}
				/>
			{/snippet}
			<!-- Sopra il vassoio: vassoio e composer restano un blocco unico. -->
			<SuggestionChips
				chips={composerRef?.visibleSuggestionChips() ?? []}
				onSelect={(prompt) => composerRef?.applySuggestionChip(prompt)}
			/>
			<ComposerTray
				quota={quotaInfo}
				phases={session.todoPhases}
				reminder={session.todoReminder}
				subagents={session.subagents}
				queueCount={Math.max(session.queuedChips.length, session.queuedMessageCount)}
				queue={queuedRows}
				goal={session.goal?.goal ?? null}
				onPauseGoal={() => void session.pauseGoal()}
				onResumeGoal={() => void session.resumeGoal()}
				onDropGoal={() => void session.dropGoal()}
				questionOpen={session.pendingUi !== null}
				onOpenSubagent={(id) => (activeSubagentId = id)}
				onCancelSubagent={(id) => void session.cancelSubagent(id)}
				questionMinimized={askMinimized && session.pendingUi
					? {
							title: session.pendingUi.title,
							count: session.pendingUi.totalQuestions,
							onOpen: openAsk
						}
					: undefined}
			/>
			{#if session.pendingUi && !askMinimized}
				{@const cardKey = `${session.pendingUi.toolCallId ?? session.pendingUi.requestId}:${session.pendingUi.questions?.length ?? 0}:${session.pendingUi.questionIndex ?? 0}`}
				{#key cardKey}
					<AskCard {session} pending={session.pendingUi} {visible} onMinimize={minimizeAsk} />
				{/key}
			{/if}
			<div class:composer-under-ask={session.pendingUi !== null && !askMinimized}>
				<Composer
					bind:this={composerRef}
					{session}
					visible={visible && (session.pendingUi === null || askMinimized)}
					dropTarget={isDraggingColumn}
					onSlashCommand={(cmd: string) => (onSlashCommand ? onSlashCommand(cmd) : false)}
					{onNewChat}
				/>
			</div>
		</div>
	</div>


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
		position: relative;
	}
	.chat-column-drag-overlay {
		position: absolute;
		inset: var(--space-2);
		z-index: var(--z-overlay);
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px dashed var(--brand-ink);
		border-radius: var(--radius-2xl);
		background: color-mix(in oklch, var(--bg-sunken) 75%, transparent);
		backdrop-filter: none;
		pointer-events: none;
	}

	.drag-overlay-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		max-width: min(420px, calc(100% - 2 * var(--space-4)));
		padding: var(--space-3) var(--space-4);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-overlay);
		text-align: center;
	}

	.drag-overlay-label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 500;
		--icon-size: 15px;
	}

	.drag-overlay-names {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--brand-ink);
		font-size: var(--text-xs);
	}

	.drag-overlay-hint {
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		line-height: 1.4;
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
		max-width: 720px;
		margin: 0 auto;
	}


	.pending-ui-slot {
		padding: 0 var(--space-3) var(--space-3);
		min-width: 0;
	}

	.scroll-bottom-wrap {
		position: absolute;
		right: var(--space-4);
		bottom: calc(100% + var(--space-3) + 28px);
		z-index: var(--z-sticky);
	}
	.scroll-bottom-btn {
		width: 28px;
		height: 28px;
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		padding: 0;
		color: var(--ink);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-shadow: var(--shadow-overlay);
		--icon-size: 16px;
		transition: background-color var(--dur-fast), border-color var(--dur-fast), transform var(--dur-fast);
	}
	.scroll-bottom-btn:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}
	.scroll-bottom-btn:active {
		transform: scale(0.97);
	}
	.composer-under-ask { display: none; }

	.footer-inner {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		min-width: 0;
		box-sizing: border-box;
		padding-inline: var(--space-3);
	}

	.footer-inner.readable {
		max-width: 720px;
		margin: 0 auto;
	}

	/* Nessuna linea tra chat e composer: basta lo spazio. Quando la conversazione
	   scorre sotto il composer una sfumatura leggera la dissolve, invece di tagliarla. */
	.footer-stack {
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		padding-bottom: var(--space-3);
		min-width: 0;
		z-index: var(--z-sticky);
	}

	.footer-stack::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 100%;
		height: 28px;
		pointer-events: none;
		background: linear-gradient(to bottom, transparent, var(--bg-sunken));
		backdrop-filter: blur(2px);
		/* Solo il canale alfa conta nella maschera: usiamo var(--ink) come token opaco */
		mask-image: linear-gradient(to bottom, transparent, var(--ink));
		opacity: 0;
		transition: opacity var(--dur-base) var(--ease-out);
	}

	.footer-stack.content-below::before {
		opacity: 1;
	}
</style>
