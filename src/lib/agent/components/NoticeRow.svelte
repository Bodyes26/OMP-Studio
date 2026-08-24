<script lang="ts">
	// Riga di avviso (notifica di sistema, errore di runtime o warning).
	// A tutta larghezza con bordi sottili e colori semantici.
	import { agentUiHooks } from '../ui-context';
	import type { NoticeEntry } from '../session.svelte';

	let { entry }: { entry: NoticeEntry } = $props();

	const hooks = agentUiHooks();
	let detailExpanded = $state(false);

	const hasDetail = $derived(Boolean(entry.detail && entry.detail.length > 0));
	const detailText = $derived(entry.detail ? entry.detail.join('\n') : '');
</script>

<div class="notice-row" class:error={entry.level === 'error'} class:warning={entry.level === 'warning'} class:info={entry.level === 'info'}>
	<div class="main-line">
		<div class="message-wrap">
			{#if entry.source}
				<span class="source">[{entry.source}]</span>
			{/if}
			<span class="message">{entry.message}</span>
		</div>

		<div class="actions">
			{#if hasDetail}
				<button
					type="button"
					class="action-btn"
					onclick={() => (detailExpanded = !detailExpanded)}
				>
					{detailExpanded ? 'Nascondi dettagli' : `Dettagli (${entry.detail?.length ?? 0})`}
				</button>
			{/if}
			{#if entry.offerTerminal}
				<button
					type="button"
					class="action-btn terminal-btn"
					onclick={() => hooks.switchToTerminal()}
				>
					Apri nel TERMINAL
				</button>
			{/if}
		</div>
	</div>

	{#if hasDetail && detailExpanded}
		<pre class="detail-pre">{detailText}</pre>
	{/if}
</div>

<style>
	.notice-row {
		width: 100%;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		padding: var(--space-1) 0;
		font-size: var(--text-xs);
		line-height: 1.4;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.main-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.message-wrap {
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
		min-width: 0;
		flex: 1;
	}

	.source {
		font-family: var(--font-mono);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.message {
		user-select: text;
		word-break: break-word;
	}

	.notice-row.error .message {
		color: var(--brand-ink);
	}

	.notice-row.warning .message {
		color: var(--warn);
	}

	.notice-row.info .message {
		color: var(--ink-faint);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	.action-btn {
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		cursor: pointer;
	}

	.action-btn:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.terminal-btn {
		color: var(--brand-ink);
	}

	.detail-pre {
		margin: var(--space-1) 0 0 0;
		padding: var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.4;
		color: var(--ink-muted);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		white-space: pre-wrap;
		word-break: break-all;
		max-height: 240px;
		overflow-y: auto;
		user-select: text;
	}
</style>
