<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Cassetto del transcript di un subagent.
	//
	// Lettura incrementale: invia `get_subagent_messages { subagentId, fromByte }`,
	// avanza `fromByte` con `nextByte` e riparte da zero quando `reset` e' vero
	// (il file di sessione e' stato troncato o riscritto).
	//
	// All'apertura alza la sottoscrizione a `events`, alla chiusura la riporta
	// a `progress`: `events` inoltra ogni evento annidato di ogni subagent ed e'
	// costoso durante un fan-out a 32 worker.
	import type { AgentSession, SystemChipEntry } from '../session.svelte';
	import type { AgentMessage } from '../wire';
	import { IconSubagents, IconClose } from '$lib/icons';
	import { classifySystemMessage, stripNoticeWrapper } from '../notices';
	import SystemChip from './SystemChip.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';

	// Etichette di ruolo in italiano. Ruoli di sistema (custom e developer)
	// vengono gestiti separatamente come chip e non passano da qui.
	const ROLE_LABEL: Record<string, string> = {
		user: 'utente',
		assistant: 'assistente',
		toolResult: 'risultato tool'
	};

	function roleLabel(role: string): string {
		return ROLE_LABEL[role] ?? role;
	}

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
	let errorText = $state<string | null>(null);

	function textOf(content: AgentMessage['content']): string {
		if (!content) return '';
		if (typeof content === 'string') return content;
		if (!Array.isArray(content)) return '';
		return content
			.filter((block) => block.type === 'text' && typeof block.text === 'string')
			.map((block) => block.text ?? '')
			.join('\n');
	}

	type DrawerItem =
		| { type: 'system'; id: number; entry: SystemChipEntry }
		| { type: 'message'; id: number; msg: AgentMessage };

	const drawerItems = $derived.by(() => {
		const items: DrawerItem[] = [];
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			if (msg.role === 'custom' || msg.role === 'developer') {
				const text = textOf(msg.content);
				const classified = classifySystemMessage({
					role: msg.role,
					customType: msg.customType,
					display: msg.display,
					details: msg.details,
					text
				});

				if (!classified) {
					const stripped = stripNoticeWrapper(text).trim();
					if (stripped) {
						items.push({
							type: 'system',
							id: i,
							entry: {
								id: i,
								kind: 'system-chip',
								customType: 'custom-message',
								title: msg.role === 'developer' ? 'Promemoria' : 'Sistema',
								body: stripped
							}
						});
					}
					continue;
				}

				if (classified.kind === 'todo-reminder') {
					// I promemoria sui todo duplicano lo stato gia' visibile e vanno omessi
					continue;
				}

				if (classified.kind === 'hidden') {
					// I messaggi marcati display: false si mostrano solo se l'utente ha attivato la diagnosi
					if (!settingsStore.general.showInternalAgentMessages) {
						continue;
					}
					items.push({
						type: 'system',
						id: i,
						entry: {
							id: i,
							kind: 'system-chip',
							customType: classified.customType,
							title: classified.title,
							body: classified.body,
							internal: true
						}
					});
					continue;
				}

				if (classified.kind === 'chip') {
					items.push({
						type: 'system',
						id: i,
						entry: {
							id: i,
							kind: 'system-chip',
							customType: classified.customType,
							title: classified.title,
							body: classified.body
						}
					});
					continue;
				}

				if (classified.kind === 'subagent-result') {
					const body = classified.jobs.length > 0
						? classified.jobs.map((j) => j.envelope?.summaryLine ?? j.label ?? j.jobId).join(' | ')
						: stripNoticeWrapper(text);
					items.push({
						type: 'system',
						id: i,
						entry: {
							id: i,
							kind: 'system-chip',
							customType: 'async-result',
							title: 'Risultato in background',
							body
						}
					});
					continue;
				}

				if (classified.kind === 'irc') {
					const isIncoming = classified.direction === 'in';
					items.push({
						type: 'system',
						id: i,
						entry: {
							id: i,
							kind: 'system-chip',
							customType: isIncoming ? 'irc:incoming' : 'irc:autoreply',
							title: isIncoming
								? (classified.peer ? m.ui_subagentdrawer_messaggio_da_value1_5617({ value1: classified.peer }) : m.ui_subagentdrawer_messaggio_da_un_agente_6808())
								: m.ui_subagentdrawer_risposta_automatica_f42e(),
							body: classified.body
						}
					});
					continue;
				}
			} else {
				items.push({
					type: 'message',
					id: i,
					msg
				});
			}
		}
		return items;
	});

	// Polling con guardia di concorrenza, reset al cambio di subagentId e pulizia al dismount.
	$effect(() => {
		const currentId = subagentId;
		let fromByte = 0;
		let isPolling = false;
		let destroyed = false;

		// Reset stato locale all'avvio o al cambio di id
		messages = [];
		errorText = null;

		// Alza sottoscrizione a `events` durante l'ispezione
		void session.client.send({ type: 'set_subagent_subscription', level: 'events' });

		async function poll() {
			if (destroyed || isPolling) return;
			isPolling = true;
			try {
				const res: SubagentMessagesResponse = await session.client.send({
					type: 'get_subagent_messages',
					subagentId: currentId,
					fromByte
				});
				if (destroyed) return;
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
				if (!destroyed) {
					errorText = error instanceof Error ? error.message : String(error);
				}
			} finally {
				isPolling = false;
			}
		}

		void poll();
		const timer = window.setInterval(poll, 1500);

		return () => {
			destroyed = true;
			clearInterval(timer);
			// Riporta a `progress` alla chiusura per risparmiare banda
			void session.client.send({ type: 'set_subagent_subscription', level: 'progress' });
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
			return;
		}
		if (e.key === 'Escape') {
			e.stopPropagation();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="drawer-backdrop" onclick={onClose}></div>

<div class="subagent-drawer" role="dialog" aria-modal="true" aria-label={m.subagents_transcript_aria()}>
	<div class="drawer-head">
		<div class="head-info">
			<span class="glyph"><IconSubagents aria-hidden="true" /></span>
			<span class="title">{subagentId}</span>
		</div>
		<button type="button" class="btn-close" onclick={onClose} aria-label={m.page_modal_restart_btn_close()}><IconClose /></button>
	</div>

	{#if errorText}
		<div class="error-banner">{errorText}</div>
	{/if}

	<div class="messages-area">
		{#each drawerItems as item (item.id)}
			{#if item.type === 'system'}
				<div class="system-chip-wrap">
					<SystemChip entry={item.entry} />
				</div>
			{:else}
				{@const msg = item.msg}
				<div class="msg-row {msg.role}">
					<div class="msg-role">{roleLabel(msg.role)}</div>
					<div class="msg-body">
						{#each Array.isArray(msg.content) ? msg.content : [] as block, bIdx (bIdx)}
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
			{/if}
		{:else}
			<div class="empty">{m.ui_subagentdrawer_in_attesa_dei_messaggi_del_subagent_76d6()}</div>
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
		color: var(--brand-ink);
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.btn-close:hover {
		color: var(--ink);
	}

	.error-banner {
		padding: var(--space-1) var(--space-3);
		background: var(--bg-sunken);
		color: var(--danger);
		font-size: var(--text-xs);
	}

	.messages-area {
		flex: 1;
		/* Senza min-height: 0 il flex item non si comprime sotto l'altezza del proprio contenuto, quindi il contenitore lo taglia invece di far comparire la barra di scorrimento */
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.system-chip-wrap {
		display: flex;
		flex-direction: column;
	}

	.msg-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--text-xs);
		padding-left: var(--space-2);
	}

	.msg-role {
		font-family: var(--font-mono);
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}

	/* L'assistente si distingue dall'utente per etichetta di ruolo
	   (parola e peso), non piu' per stroke laterale colorato. */
	.msg-row.assistant .msg-role {
		color: var(--ink);
		font-weight: 600;
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
		font-size: var(--text-xs);
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
