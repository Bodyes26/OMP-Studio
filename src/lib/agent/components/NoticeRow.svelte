<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Riga di avviso (notifica di sistema, errore di runtime o warning).
	// Traccia leggera nel linguaggio v2 (12.5px, --ink-muted, icona 14px, colori semantici).
	import { agentUiHooks } from '../ui-context';
	import type { NoticeEntry } from '../session.svelte';
	import { IconInfo, IconWarning, IconStatusFailed, IconTerminal, IconChevronRight } from '$lib/icons';

	let { entry, fresh = false }: { entry: NoticeEntry; fresh?: boolean } = $props();

	const hooks = agentUiHooks();
	let detailExpanded = $state(false);

	const hasDetail = $derived(Boolean(entry.detail && entry.detail.length > 0));
	const detailText = $derived(entry.detail ? entry.detail.join('\n') : '');
</script>

<div
	class="notice-row"
	class:rv-blur={fresh}
	class:error={entry.level === 'error'}
	class:warning={entry.level === 'warning'}
	class:info={entry.level === 'info'}
	style={fresh ? '--dur: 400ms; --blur: 4px;' : undefined}
>
	<div class="main-line">
		<div class="message-wrap">
			<span class="level-icon" aria-hidden="true">
				{#if entry.level === 'error'}
					<IconStatusFailed />
				{:else if entry.level === 'warning'}
					<IconWarning />
				{:else}
					<IconInfo />
				{/if}
			</span>
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
					aria-expanded={detailExpanded}
				>
					<span>{detailExpanded ? m.chat_v2_notice_hide_details() : m.chat_v2_notice_show_details({ count: entry.detail?.length ?? 0 })}</span>
					<span class="chevron" class:expanded={detailExpanded} aria-hidden="true">
						<IconChevronRight />
					</span>
				</button>
			{/if}
			{#if entry.offerTerminal}
				<button
					type="button"
					class="action-btn terminal-btn"
					onclick={() => hooks.switchToTerminal()}
				>
					<span class="btn-icon" aria-hidden="true"><IconTerminal /></span>
					<span>{m.project_popover_open_terminal()}</span>
				</button>
			{/if}
		</div>
	</div>

	{#if hasDetail && detailExpanded}
		<div class="detail-wrap rv-blur" style="--dur: 200ms; --blur: 2px;">
			<pre class="detail-pre">{detailText}</pre>
		</div>
	{/if}
</div>

<style>
	.notice-row {
		width: 100%;
		padding: 2px 0;
		font-size: var(--text-trace);
		line-height: 1.5;
		color: var(--ink-muted);
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.main-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-width: 0;
		flex-wrap: wrap;
	}

	.message-wrap {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex: 1;
	}

	.level-icon {
		--icon-size: 14px;
		width: 14px;
		height: 14px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--ink-faint);
	}

	.notice-row.error .level-icon {
		color: var(--danger);
	}

	.notice-row.warning .level-icon {
		color: var(--warn);
	}

	.notice-row.info .level-icon {
		color: var(--ink-muted);
	}

	.source {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.message {
		user-select: text;
		word-break: break-word;
		color: var(--ink-muted);
	}

	.notice-row.error .message {
		color: var(--danger);
	}

	.notice-row.warning .message {
		color: var(--warn);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.action-btn {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 1px 7px;
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		transition: background-color var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast);
	}

	.action-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.chevron {
		--icon-size: 12px;
		display: inline-flex;
		align-items: center;
		transition: transform var(--dur-fast) var(--ease-out);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.btn-icon {
		--icon-size: 12px;
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}

	.terminal-btn {
		color: var(--brand-ink);
		border-color: var(--line);
	}

	.terminal-btn:hover {
		color: var(--brand-ink);
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.detail-wrap {
		margin-top: 2px;
		border-left: 1px solid var(--line);
		margin-left: 7px;
		padding-left: 10px;
	}

	.detail-pre {
		margin: 0;
		padding: 6px 10px;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		line-height: 1.45;
		color: var(--ink-muted);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: normal;
		overflow-y: auto;
		max-height: 200px;
		user-select: text;
	}
</style>
