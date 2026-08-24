<script lang="ts">
	// Cassetto del transcript di un subagent.
	//
	// Lettura incrementale: invia `get_subagent_messages { subagentId, fromByte }`,
	// avanza `fromByte` con `nextByte` e riparte da zero quando `reset` e' vero
	// (il file di sessione e' stato troncato o riscritto).
	//
	// All'apertura alza la sottoscrizione a `events`, alla chiusura la riporta
	// a `progress`: `events` inoltra ogni evento annidato di ogni subagent ed e'
	// costoso durante un fan-out a 32 worker.
	import { onDestroy, onMount } from 'svelte';
	import type { AgentSession } from '../session.svelte';
	import type { AgentMessage } from '../wire';

	let {
		session,
		subagentId,
		onClose
	} = $props<{
		session: AgentSession;
		subagentId: string;
		onClose: () => void;
	}>();

	interface SubagentMessagesResponse {
		sessionFile?: string;
		fromByte?: number;
		nextByte?: number;
		reset?: boolean;
		messages?: AgentMessage[];
	}

	let messages = $state<AgentMessage[]>([]);
	let fromByte = 0;
	let pollTimer: number | null = null;
	let errorText = $state<string | null>(null);

	async function poll() {
		try {
			const res: SubagentMessagesResponse = await session.client.send({
				type: 'get_subagent_messages',
				subagentId,
				fromByte
			});
			if (res.reset) {
				messages = [];
				fromByte = 0;
			}
			if (Array.isArray(res.messages) && res.messages.length > 0) {
				messages = [...messages, ...res.messages];
			}
			if (typeof res.nextByte === 'number') {
				fromByte = res.nextByte;
			}
			errorText = null;
		} catch (error) {
			errorText = error instanceof Error ? error.message : String(error);
		}
	}

	onMount(() => {
		// Alza sottoscrizione a `events` durante l'ispezione
		void session.client.send({ type: 'set_subagent_subscription', level: 'events' });
		void poll();
		pollTimer = window.setInterval(poll, 1500);

		return () => {
			if (pollTimer !== null) clearInterval(pollTimer);
			// Riporta a `progress` alla chiusura per risparmiare banda
			void session.client.send({ type: 'set_subagent_subscription', level: 'progress' });
		};
	});

	onDestroy(() => {
		if (pollTimer !== null) clearInterval(pollTimer);
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="drawer-backdrop" onclick={onClose}></div>

<div class="subagent-drawer" role="dialog" aria-label="Transcript subagent">
	<div class="drawer-head">
		<div class="head-info">
			<span class="glyph">⇉</span>
			<span class="title">{subagentId}</span>
		</div>
		<button type="button" class="btn-close" onclick={onClose} aria-label="Chiudi">×</button>
	</div>

	{#if errorText}
		<div class="error-banner">{errorText}</div>
	{/if}

	<div class="messages-area">
		{#each messages as msg, idx (idx)}
			<div class="msg-row {msg.role}">
				<div class="msg-role">{msg.role}</div>
				<div class="msg-body">
					{#each msg.content ?? [] as block, bIdx (bIdx)}
						{#if block.type === 'text' && block.text}
							<pre class="text-content">{block.text}</pre>
						{:else if block.type === 'toolCall'}
							<div class="tool-call-mini">
								<span class="tool-name">{block.name}</span>
								{#if block.arguments}
									<span class="tool-args">{JSON.stringify(block.arguments)}</span>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			</div>
		{:else}
			<div class="empty">In attesa dei messaggi del subagent...</div>
		{/each}
	</div>
</div>

<style>
	.drawer-backdrop {
		position: absolute;
		inset: 0;
		background: var(--backdrop);
		z-index: var(--z-overlay);
	}

	.subagent-drawer {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 85%;
		max-width: 600px;
		background: var(--bg-overlay);
		border-left: 1px solid var(--line-strong);
		box-shadow: var(--shadow-overlay);
		display: flex;
		flex-direction: column;
		z-index: var(--z-dialog);
		overflow: hidden;
	}

	.drawer-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--line);
	}

	.head-info {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	.glyph {
		color: var(--brand);
	}

	.title {
		color: var(--ink);
		font-weight: 600;
	}

	.btn-close {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		font-size: var(--text-lg);
		cursor: pointer;
		line-height: 1;
		padding: 0 4px;
	}

	.btn-close:hover {
		color: var(--ink);
	}

	.error-banner {
		padding: var(--space-1) var(--space-3);
		background: color-mix(in srgb, var(--brand) 15%, transparent);
		color: var(--brand-ink);
		font-size: var(--text-xs);
	}

	.messages-area {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.msg-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--text-xs);
		border-left: 2px solid var(--line);
		padding-left: var(--space-2);
	}

	.msg-row.user {
		border-left-color: var(--ink-faint);
	}

	.msg-row.assistant {
		border-left-color: var(--brand-dim);
	}

	.msg-role {
		font-family: var(--font-mono);
		color: var(--ink-faint);
		font-size: 10px;
		text-transform: uppercase;
	}

	.msg-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.text-content {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}

	.tool-call-mini {
		display: flex;
		gap: var(--space-1);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tool-name {
		color: var(--ink);
		font-weight: 500;
	}

	.tool-args {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.empty {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-style: italic;
		padding: var(--space-4) 0;
		text-align: center;
	}
</style>
