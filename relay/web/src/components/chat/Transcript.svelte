<!--
  Transcript.svelte — Flusso cronologico della conversazione.
  Ritmo verticale Studio, colonna leggibile centrata (max-width 720px),
  gruppi di strumenti compatti, autoscroll ancorato e pulsante 'In fondo'.
  Fedele a src/lib/agent/components/Transcript.svelte di Studio.
-->
<script lang="ts">
	import { t } from '../../i18n.ts';
	import type { RemoteChatMessage } from '../../../../src/protocol.ts';
	import { groupMessages } from '../../chat/merge.ts';
	import UserMessage from './UserMessage.svelte';
	import AssistantText from './AssistantText.svelte';
	import ToolGroup from './ToolGroup.svelte';
	import CompactionRow from './CompactionRow.svelte';
	import TurnFooter from '$lib/agent/components/TurnFooter.svelte';
	import ActivityIndicator from '$lib/agent/components/ActivityIndicator.svelte';
	import { IconArrowDown } from '../../icons.ts';

	let {
		messages = [],
		loadingOlder = false,
		hasOlder = false,
		onLoadOlder,
		isWorking = false,
		agentActivityText = null,
		agentActivityStartedAt = null,
		onOpenImage
	}: {
		messages: RemoteChatMessage[];
		loadingOlder?: boolean;
		hasOlder?: boolean;
		onLoadOlder?: () => Promise<void>;
		isWorking?: boolean;
		agentActivityText?: string | null;
		agentActivityStartedAt?: number | null;
		onOpenImage?: (dataUrl: string, mimeType?: string) => void;
	} = $props();

	let scrollEl = $state<HTMLDivElement | null>(null);
	let userScrolledUp = $state(false);

	const grouped = $derived(groupMessages(messages));
	const displayItems = $derived(grouped.items);
	const turnFooters = $derived(grouped.turnFootersByIndex);

	export function scrollToBottom(smooth = false): void {
		if (!scrollEl) return;
		userScrolledUp = false;
		scrollEl.scrollTo({
			top: scrollEl.scrollHeight,
			behavior: smooth ? 'smooth' : 'auto'
		});
	}

	export function isAtBottom(): boolean {
		if (!scrollEl) return true;
		return !userScrolledUp;
	}

	function handleScroll(): void {
		if (!scrollEl) return;
		const distance = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
		userScrolledUp = distance > 80;
	}

	// Auto-scroll ancorato al fondo: un messaggio utente forza il riaggancio e lo scroll in fondo
	$effect(() => {
		const count = messages.length;
		if (count > 0) {
			const last = messages[count - 1];
			if (last.role === 'user') {
				userScrolledUp = false;
				queueMicrotask(() => {
					if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
				});
				return;
			}
			if (!userScrolledUp) {
				queueMicrotask(() => {
					if (!userScrolledUp && scrollEl) {
						scrollEl.scrollTop = scrollEl.scrollHeight;
					}
				});
			}
		}
	});

	async function handleLoadOlder(): Promise<void> {
		if (!scrollEl || loadingOlder || !onLoadOlder) return;
		const oldScrollHeight = scrollEl.scrollHeight;
		await onLoadOlder();
		queueMicrotask(() => {
			if (scrollEl) {
				const added = scrollEl.scrollHeight - oldScrollHeight;
				scrollEl.scrollTop += added;
			}
		});
	}
</script>

<div class="scroll-area" bind:this={scrollEl} onscroll={handleScroll}>
	<div class="chat-content-container readable">
		{#if hasOlder}
			<div class="earlier-bar">
				<button
					type="button"
					class="earlier-btn"
					disabled={loadingOlder}
					onclick={handleLoadOlder}
				>
					{#if loadingOlder}
						<span class="spinner-small" aria-hidden="true"></span>
						<span>{t('loadingOlder')}</span>
					{:else}
						<span>{t('loadOlder')}</span>
					{/if}
				</button>
			</div>
		{/if}

		<div class="transcript-list">
			{#if displayItems.length === 0 && !isWorking}
				<div class="empty-state">
					<p>{t('noMessages')}</p>
				</div>
			{/if}

			{#each displayItems as item, i (item.kind === 'tool-group' ? item.id : `${item.kind}-${item.id}`)}
				{@const isFirst = i === 0}
				{@const prev = i > 0 ? displayItems[i - 1] : null}
				{@const isTurnBoundary = item.kind === 'user' && !isFirst}
				{@const isAfterUser = prev?.kind === 'user'}
				{@const isSystemTight = item.kind === 'system' && prev?.kind === 'system'}

				<div
					class="entry-row"
					class:turn-boundary={isTurnBoundary}
					class:after-user={isAfterUser}
					class:system-tight={isSystemTight}
				>
					{#if item.kind === 'user'}
						<UserMessage message={item.message} {onOpenImage} />
					{:else if item.kind === 'assistant'}
						<AssistantText message={item.message} streaming={isWorking && messages.at(-1)?.id === item.id} />
					{:else if item.kind === 'tool-group'}
						<ToolGroup messages={item.messages} summary={item.summary} />
					{:else if item.kind === 'system'}
						<CompactionRow message={item.message} />
					{/if}
				</div>

				{@const footer = turnFooters.get(i)}
				{#if footer}
					<TurnFooter data={{ ...footer, diff: footer.diff ? { ...footer.diff, files: [] } : undefined }} />
				{/if}
			{/each}

			{#if isWorking}
				<div class="agent-activity-slot">
					<ActivityIndicator
						startedAt={agentActivityStartedAt}
						label={agentActivityText}
					/>
				</div>
			{/if}
		</div>
	</div>

	{#if userScrolledUp}
		<div class="scroll-bottom-wrap">
			<button
				type="button"
				class="scroll-bottom-btn rv-lift"
				onclick={() => scrollToBottom(true)}
				aria-label={t('chatScrollToBottom')}
				title={t('chatScrollToBottom')}
			>
				<IconArrowDown />
			</button>
		</div>
	{/if}
</div>

<style>
	.scroll-area {
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow-y: auto;
		overflow-anchor: none;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.chat-content-container {
		width: 100%;
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
		padding: var(--space-3);
		box-sizing: border-box;
	}

	.chat-content-container.readable {
		max-width: 720px;
		margin: 0 auto;
	}

	.earlier-bar {
		display: flex;
		justify-content: center;
		padding: var(--space-1) 0 var(--space-3);
	}

	.earlier-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-1) var(--space-3);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		cursor: pointer;
		transition:
			border-color var(--dur-fast),
			color var(--dur-fast);
	}

	.earlier-btn:hover:not(:disabled) {
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.spinner-small {
		width: 12px;
		height: 12px;
		border: 1.5px solid var(--line-strong);
		border-top-color: var(--ink);
		border-radius: var(--radius-full);
		animation: spin 0.8s linear infinite;
	}

	.transcript-list {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.empty-state {
		padding: var(--space-6) var(--space-3);
		text-align: center;
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}

	.entry-row {
		margin-top: var(--space-3);
		min-width: 0;
	}

	.entry-row:first-child {
		margin-top: 0;
	}

	.entry-row.turn-boundary {
		margin-top: var(--space-6);
	}

	.entry-row.after-user {
		margin-top: var(--space-4);
	}

	.entry-row.system-tight {
		margin-top: var(--space-1);
	}

	.agent-activity-slot {
		margin-top: var(--space-3);
	}

	.scroll-bottom-wrap {
		position: sticky;
		bottom: var(--space-4);
		align-self: flex-end;
		margin-right: var(--space-4);
		margin-top: calc(-1 * (28px + var(--space-4)));
		z-index: var(--z-sticky);
	}

	.scroll-bottom-btn {
		width: 32px;
		height: 32px;
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		color: var(--ink);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-shadow: var(--shadow-overlay);
		--icon-size: 16px;
		transition:
			background-color var(--dur-fast),
			border-color var(--dur-fast),
			transform var(--dur-fast);
	}

	.scroll-bottom-btn:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.scroll-bottom-btn:active {
		transform: scale(0.97);
	}
</style>
