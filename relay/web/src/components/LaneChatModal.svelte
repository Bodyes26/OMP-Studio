<script lang="ts">
	import type { Feature, RemoteChatEvent, RemoteChatMessage, RemoteChatPage, RemoteLane } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';

	let {
		hostId,
		hostName,
		hostFeatures,
		projectId,
		projectTitle,
		lane,
		onClose
	} = $props<{
		hostId: string;
		hostName: string;
		hostFeatures: Feature[];
		projectId: string;
		projectTitle: string;
		lane: RemoteLane;
		onClose: () => void;
	}>();

	let messages = $state<RemoteChatMessage[]>([]);
	let beforeCursor = $state<string | null>(null);
	let loadingHistory = $state(false);
	let loadingOlder = $state(false);
	let inputText = $state('');
	let whileBusy = $state<'steer' | 'follow_up'>('steer');
	let isSending = $state(false);
	let isStopping = $state(false);
	let errorMessage = $state<string | null>(null);

	let messagesContainer = $state<HTMLDivElement | null>(null);

	const canSend = $derived(hostFeatures.includes('session_control'));
	const currentProject = $derived(
		connection.hostStates[hostId]?.state.projects.find((p) => p.id === projectId)
	);
	const currentLane = $derived(
		currentProject?.lanes.find((l) => l.id === lane.id) ?? lane
	);
	const isWorking = $derived(currentLane.agent.state === 'working');

	function scrollToBottom(smooth = false): void {
		if (!messagesContainer) return;
		messagesContainer.scrollTo({
			top: messagesContainer.scrollHeight,
			behavior: smooth ? 'smooth' : 'auto'
		});
	}

	async function loadInitialHistory(): Promise<void> {
		loadingHistory = true;
		errorMessage = null;
		try {
			const res = (await connection.sendCommand(hostId, {
				kind: 'chat_history',
				projectId,
				laneId: lane.id === 'main' ? null : lane.id,
				before: null,
				limit: 50
			})) as RemoteChatPage | undefined;

			if (res && Array.isArray(res.messages)) {
				// Handoff pulito tra storico e messaggi gia' presenti in live (#10)
				messages = res.messages;
				beforeCursor = res.before;
				queueMicrotask(() => scrollToBottom(false));
			}
		} catch (err: unknown) {
			const e = err as { message?: string };
			errorMessage = e?.message || t('chatLoadError');
		} finally {
			loadingHistory = false;
		}
	}

	async function loadOlderMessages(): Promise<void> {
		if (!beforeCursor || loadingOlder) return;
		loadingOlder = true;
		errorMessage = null;
		try {
			const oldScrollHeight = messagesContainer?.scrollHeight ?? 0;
			const res = (await connection.sendCommand(hostId, {
				kind: 'chat_history',
				projectId,
				laneId: lane.id === 'main' ? null : lane.id,
				before: beforeCursor,
				limit: 50
			})) as RemoteChatPage | undefined;

			if (res && Array.isArray(res.messages)) {
				messages = [...res.messages, ...messages];
				beforeCursor = res.before;
				queueMicrotask(() => {
					if (messagesContainer) {
						const added = messagesContainer.scrollHeight - oldScrollHeight;
						messagesContainer.scrollTop += added;
					}
				});
			}
		} catch (err: unknown) {
			const e = err as { message?: string };
			errorMessage = e?.message || t('chatLoadOlderError');
		} finally {
			loadingOlder = false;
		}
	}

	function handleIncomingChatEvent(event: RemoteChatEvent): void {
		if (event.kind === 'reset') {
			void loadInitialHistory();
			return;
		}

		if (event.kind === 'message') {
			const idx = messages.findIndex((m) => m.id === event.message.id);
			if (idx >= 0) {
				messages[idx] = event.message;
				messages = [...messages];
			} else {
				messages = [...messages, event.message];
				queueMicrotask(() => scrollToBottom(true));
			}
			return;
		}

		if (event.kind === 'delta') {
			const idx = messages.findIndex((m) => m.id === event.messageId);
			if (idx >= 0) {
				const existing = messages[idx];
				messages[idx] = {
					...existing,
					text: existing.text + event.text
				};
				messages = [...messages];
			} else {
				const newMsg: RemoteChatMessage = {
					id: event.messageId,
					role: 'assistant',
					text: event.text,
					toolName: null,
					timestamp: Date.now()
				};
				messages = [...messages, newMsg];
			}
			queueMicrotask(() => scrollToBottom(false));
		}
	}

	async function handleSend(): Promise<void> {
		const text = inputText.trim();
		if (!text || isSending || !canSend) return;

		isSending = true;
		errorMessage = null;
		try {
			await connection.sendCommand(hostId, {
				kind: 'send_prompt',
				projectId,
				laneId: lane.id === 'main' ? null : lane.id,
				text,
				whileBusy
			});
			inputText = '';
		} catch (err: unknown) {
			const e = err as { message?: string };
			errorMessage = e?.message || t('chatSendError');
		} finally {
			isSending = false;
		}
	}

	async function handleStop(): Promise<void> {
		if (isStopping || !canSend) return;
		isStopping = true;
		errorMessage = null;
		try {
			await connection.sendCommand(hostId, {
				kind: 'abort',
				projectId,
				laneId: lane.id === 'main' ? null : lane.id
			});
		} catch (err: unknown) {
			const e = err as { message?: string };
			errorMessage = e?.message || t('chatStopError');
		} finally {
			isStopping = false;
		}
	}

	function handleKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void handleSend();
		}
	}

	function escapeHtml(str: string): string {
		return str
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	/**
	 * Rendering sicuro di un sottoinsieme markdown: escape preliminare totale,
	 * poi blocchi di codice, inline code, grassetto, corsivo e a capo.
	 * Nessun tag HTML utente o link javascript: puo' essere iniettato.
	 */
	function renderSafeMarkdown(raw: string): string {
		if (!raw) return '';
		const parts = raw.split(/```/g);
		return parts
			.map((part, index) => {
				if (index % 2 === 1) {
					return `<pre class="code-block"><code>${escapeHtml(part.trim())}</code></pre>`;
				}
				let safe = escapeHtml(part);
				safe = safe.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
				safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
				safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
				safe = safe.replace(/\n/g, '<br />');
				return safe;
			})
			.join('');
	}

	$effect(() => {
		void loadInitialHistory();
		const unlisten = connection.subscribeChat(hostId, projectId, lane.id, (ev) => {
			handleIncomingChatEvent(ev);
		});
		return () => {
			unlisten();
		};
	});
</script>

<div
	class="modal-backdrop"
	onclick={onClose}
	onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
	role="presentation"
>
	<div
		class="chat-sheet"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		aria-labelledby="chat-title"
	>
		<div class="chat-header">
			<div class="header-left">
				<div class="badge-row">
					<span class="machine-badge">{hostName}</span>
					<span class="project-badge">{projectTitle}</span>
				</div>
				<h3 id="chat-title" class="lane-title">{lane.title}</h3>
			</div>

			<div class="header-right">
				{#if canSend && isWorking}
					<button
						class="btn btn-danger btn-sm"
						onclick={handleStop}
						disabled={isStopping}
						aria-label={t('stopButton')}
					>
						{isStopping ? t('stopping') : t('stopButton')}
					</button>
				{/if}
				<button class="btn btn-secondary btn-icon" onclick={onClose} aria-label={t('close')}>
					✕
				</button>
			</div>
		</div>

		{#if errorMessage}
			<div class="error-banner">
				{errorMessage}
			</div>
		{/if}

		<div class="messages-container" bind:this={messagesContainer}>
			{#if beforeCursor}
				<div class="load-older-row">
					<button class="btn btn-secondary btn-sm" onclick={loadOlderMessages} disabled={loadingOlder}>
						{loadingOlder ? t('loadingOlder') : t('loadOlder')}
					</button>
				</div>
			{/if}

			{#if loadingHistory}
				<div class="loading-state">
					<div class="spinner"></div>
				</div>
			{:else if messages.length === 0}
				<div class="empty-chat">
					<span>{t('noMessages')}</span>
				</div>
			{:else}
				{#each messages as msg (msg.id)}
					<div
						class="message-row"
						class:msg-user={msg.role === 'user'}
						class:msg-assistant={msg.role === 'assistant'}
						class:msg-tool={msg.role === 'tool'}
						class:msg-system={msg.role === 'system'}
					>
						<div class="message-bubble">
							{#if msg.role === 'tool'}
								<div class="tool-header">
									<span class="tool-tag">{t('toolCall')}: {msg.toolName || ''}</span>
								</div>
							{/if}

							<div class="message-content">
								{@html renderSafeMarkdown(msg.text)}
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<div class="chat-composer">
			{#if !canSend}
				<div class="composer-hint">
					{t('composerDisabled')}
				</div>
			{:else}
				{#if isWorking}
					<div class="busy-controls">
						<label class="radio-label">
							<input type="radio" bind:group={whileBusy} value="steer" />
							<span>{t('steerOption')}</span>
						</label>
						<label class="radio-label">
							<input type="radio" bind:group={whileBusy} value="follow_up" />
							<span>{t('followUpOption')}</span>
						</label>
					</div>
				{/if}

				<div class="input-row">
					<textarea
						class="chat-input"
						placeholder={t('chatInputPlaceholder')}
						bind:value={inputText}
						onkeydown={handleKeyDown}
						rows="2"
					></textarea>
					<button
						class="btn btn-primary send-btn"
						onclick={handleSend}
						disabled={!inputText.trim() || isSending}
					>
						{isSending ? t('sendingPrompt') : t('send')}
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 12px;
	}

	.chat-sheet {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		width: 100%;
		max-width: 680px;
		height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
		overflow: hidden;
	}

	.chat-header {
		padding: 12px 16px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid var(--line);
		background: var(--bg-sunken);
		gap: 12px;
	}

	.header-left {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.badge-row {
		display: flex;
		gap: 6px;
		align-items: center;
	}

	.machine-badge {
		font-size: 11px;
		font-weight: 600;
		background: var(--line);
		color: var(--ink-muted);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.project-badge {
		font-size: 11px;
		font-weight: 500;
		color: var(--ink-muted);
	}

	.lane-title {
		font-size: 15px;
		font-weight: 650;
		color: var(--ink);
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.btn-icon {
		padding: 6px 10px;
		font-size: 14px;
	}

	.error-banner {
		background: var(--danger-bg);
		color: var(--danger);
		font-size: 12px;
		padding: 8px 16px;
		border-bottom: 1px solid var(--line);
	}

	.messages-container {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.load-older-row {
		display: flex;
		justify-content: center;
		margin-bottom: 8px;
	}

	.loading-state,
	.empty-chat {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-muted);
		font-size: 13px;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--line);
		border-top-color: var(--brand);
		border-radius: var(--radius-full);
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.message-row {
		display: flex;
		width: 100%;
	}

	.msg-user {
		justify-content: flex-end;
	}

	.msg-assistant,
	.msg-tool,
	.msg-system {
		justify-content: flex-start;
	}

	.message-bubble {
		max-width: 85%;
		padding: 10px 14px;
		border-radius: var(--radius-md);
		font-size: 13.5px;
		line-height: 1.45;
		word-break: break-word;
	}

	.msg-user .message-bubble {
		background: var(--brand);
		color: var(--on-brand);
		border-bottom-right-radius: 2px;
	}

	.msg-assistant .message-bubble {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink);
		border-bottom-left-radius: 2px;
	}

	.msg-tool .message-bubble {
		background: var(--bg-sunken);
		border: 1px dashed var(--line);
		color: var(--ink-muted);
		font-size: 12px;
	}

	.msg-system .message-bubble {
		background: transparent;
		color: var(--ink-muted);
		font-size: 12px;
		font-style: italic;
		padding: 4px 8px;
	}

	.tool-header {
		margin-bottom: 4px;
	}

	.tool-tag {
		font-weight: 600;
		font-size: 11px;
		text-transform: uppercase;
		color: var(--ink-muted);
	}

	.message-content {
		line-height: 1.5;
	}

	:global(.message-content .code-block) {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 8px 10px;
		margin: 6px 0;
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: 12px;
		white-space: pre;
	}

	:global(.message-content .inline-code) {
		background: var(--bg-hover);
		border-radius: var(--radius-sm);
		padding: 2px 4px;
		font-family: var(--font-mono);
		font-size: 12px;
	}

	.chat-composer {
		padding: 12px 16px;
		border-top: 1px solid var(--line);
		background: var(--bg-sunken);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.busy-controls {
		display: flex;
		gap: 16px;
		font-size: 12px;
		color: var(--ink-muted);
	}

	.radio-label {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
	}

	.input-row {
		display: flex;
		gap: 8px;
		align-items: flex-end;
	}

	.chat-input {
		flex: 1;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 8px 12px;
		color: var(--ink);
		font-size: 13.5px;
		line-height: 1.4;
		resize: none;
		outline: none;
	}

	.chat-input:focus {
		border-color: var(--brand);
	}

	.send-btn {
		height: 38px;
		padding: 0 16px;
		flex-shrink: 0;
	}

	.composer-hint {
		font-size: 12px;
		color: var(--ink-muted);
		text-align: center;
		padding: 6px 0;
	}
</style>
