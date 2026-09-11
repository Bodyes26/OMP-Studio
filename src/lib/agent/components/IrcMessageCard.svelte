<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Tessera per i messaggi IRC scambiati tra agenti (in entrata o risposta automatica in uscita).
	// Rende leggibile la comunicazione tra peer con mittente, destinatario, direzione e formattazione
	// markdown invece di stampare XML grezzo o blocchi opachi nella chat.
	import { agentUiHooks } from '../ui-context';
	import type { IrcEntry } from '../session.svelte';
	import { lexMarkdown } from '../markdown';
	import Markdown from './Markdown.svelte';
	import { IconArrowLeft, IconArrowRight, IconChevronRight } from '$lib/icons';

	let { entry }: { entry: IrcEntry } = $props();

	const hooks = agentUiHooks();

	let expanded = $state(false);

	const lines = $derived(entry.body ? entry.body.split('\n') : []);
	const isLong = $derived(lines.length > 12 || entry.body.length > 600);
	const tokens = $derived(lexMarkdown(entry.body ?? ''));
</script>

<div class="irc-card" class:incoming={entry.direction === 'in'} class:outgoing={entry.direction === 'out'}>
	<div class="header">
		<span class="dir-icon" title={entry.direction === 'in' ? m.ui_ircmessagecard_messaggio_in_entrata_423d() : m.ui_ircmessagecard_risposta_in_uscita_7918()}>
			{#if entry.direction === 'in'}
				<IconArrowLeft />
			{:else}
				<IconArrowRight />
			{/if}
		</span>

		<span class="header-text">
			{#if entry.direction === 'in'}
				{m.ui_ircmessagecard_messaggio_da_c1f3()}
			{:else}
				{m.ui_ircmessagecard_risposta_automatica_a_cf5e()}
			{/if}
			{#if entry.peer === 'Main'}
				<span class="peer-text">{entry.peer}</span>
			{:else}
				<button
					type="button"
					class="peer-btn"
					onclick={() => hooks.openSubagent(entry.peer)}
					title={`Apri transcript di ${entry.peer}`}
				>
					{entry.peer}
				</button>
			{/if}
		</span>

		{#if entry.replyTo}
			<span class="reply-chip">{m.ui_ircmessagecard_in_risposta_a_9e84()} {entry.replyTo}</span>
		{/if}
	</div>

	<div class="body-wrap" class:clamped={isLong && !expanded}>
		<Markdown {tokens} />
	</div>

	{#if isLong}
		<button
			type="button"
			class="expand-btn"
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}
		>
			<span class="chevron" class:expanded aria-hidden="true">
				<IconChevronRight />
			</span>
			<span class="expand-label">{expanded ? m.ui_ircmessagecard_mostra_meno_3326() : m.ui_ircmessagecard_mostra_tutto_cfd0()}</span>
		</button>
	{/if}
</div>

<style>
	.irc-card {
		width: 100%;
		border-top: 1px solid var(--line);
		padding: var(--space-2) 0;
		font-size: var(--text-sm);
		line-height: 1.5;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		flex-wrap: wrap;
	}

	.dir-icon {
		--icon-size: 12px;
		display: inline-flex;
		align-items: center;
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.header-text {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-1);
		color: var(--ink-muted);
	}

	.peer-text {
		font-family: var(--font-mono);
		font-weight: 500;
		color: var(--ink);
	}

	.peer-btn {
		font-family: var(--font-mono);
		font-weight: 500;
		color: var(--brand-ink);
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		font-size: inherit;
		text-decoration: underline;
		text-decoration-color: var(--line-strong);
		text-underline-offset: 2px;
	}

	.peer-btn:hover {
		color: var(--ink);
	}

	.reply-chip {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1);
	}

	.body-wrap {
		font-size: var(--text-sm);
		color: var(--ink-muted);
		padding: var(--space-1) 0;
	}

	.body-wrap.clamped {
		max-height: 260px;
		overflow: hidden;
		position: relative;
		mask-image: linear-gradient(to bottom, black calc(100% - 32px), transparent 100%);
		-webkit-mask-image: linear-gradient(to bottom, black calc(100% - 32px), transparent 100%);
	}

	.expand-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: transparent;
		border: none;
		padding: 2px 0;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		cursor: pointer;
		align-self: flex-start;
		border-radius: var(--radius-sm);
	}

	.expand-btn:hover {
		color: var(--ink);
	}

	.chevron {
		--icon-size: 12px;
		display: inline-flex;
		align-items: center;
		transition: transform var(--dur-fast) var(--ease-out);
		color: var(--ink-faint);
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.expand-label {
		font-family: var(--font-ui);
	}
</style>
