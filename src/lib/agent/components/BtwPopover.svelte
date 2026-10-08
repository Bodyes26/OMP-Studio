<!--
  BtwPopover.svelte — riquadro «A margine» (`/btw`, variante A del prototipo).

  Galleggia sopra il composer e il vassoio, ancorato al piede della chat.
  Domanda veloce sulla sessione: risponde il modello senza strumenti, la
  risposta scorre qui mentre l'agente principale continua, e non entra mai nel
  transcript. Gli approfondimenti si scrivono nello stesso campo; lo Storico
  (condiviso con il `/btw` del terminale) si apre a tendina. Esc chiude: se la
  risposta e' ancora in arrivo resta una riga nel vassoio con «Apri».
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import type { SessionBtw } from '../btwState.svelte';
	import { btwLatestTurn, btwTurns, btwWhen, isBtwRunning, type BtwRecord, type BtwTurn } from '../btw';
	import { lexMarkdown } from '../markdown';
	import Markdown from './Markdown.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import {
		IconArrowUp,
		IconAside,
		IconClose,
		IconCopy,
		IconFollowUp,
		IconHistory,
		IconPlus,
		IconQuote
	} from '$lib/icons';

	let {
		btw,
		onUseInMessage,
		onClose
	} = $props<{
		btw: SessionBtw;
		/** Dopo «Usa nel messaggio»: il fuoco torna al composer. */
		onUseInMessage?: () => void;
		/** Dopo la chiusura (Esc, X, Ctrl+B): il fuoco torna al composer. */
		onClose?: () => void;
	}>();

	let inputEl = $state<HTMLTextAreaElement | null>(null);
	let bodyEl = $state<HTMLElement | null>(null);
	let pinnedToEnd = true;

	const record = $derived(btw.selected);
	const pending = $derived(btw.pending);
	/** Turni mostrati: quelli del record piu' la domanda appena partita, se il record non c'e' ancora. */
	const turns = $derived.by<BtwTurn[]>(() => {
		const list = record ? btwTurns(record) : [];
		if (pending && pending.recordId === btw.selectedId) {
			list.push({
				question: pending.question,
				answer: '',
				status: 'running',
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
		}
		return list;
	});
	const running = $derived(btw.selectedRunning);
	const latest = $derived(turns.length > 0 ? turns[turns.length - 1] : null);
	const canSend = $derived(btw.draft.trim().length > 0 && !btw.busy);
	const suggestions = $derived([m.btw_suggest_1(), m.btw_suggest_2(), m.btw_suggest_3()]);

	// Il fuoco va al campo a ogni apertura (pulsante, Ctrl+B, «Apri», /btw).
	$effect(() => {
		void btw.focusTick;
		void tick().then(() => inputEl?.focus());
	});

	// Lo streaming segue il fondo, finche' l'utente non risale a leggere.
	$effect(() => {
		void latest?.answer;
		void turns.length;
		if (!bodyEl || !pinnedToEnd) return;
		void tick().then(() => {
			if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
		});
	});

	function onBodyScroll() {
		if (!bodyEl) return;
		pinnedToEnd = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 24;
	}

	// Il campo cresce con il testo fino a 5 righe.
	$effect(() => {
		void btw.draft;
		if (!inputEl) return;
		inputEl.style.height = 'auto';
		inputEl.style.height = `${Math.min(inputEl.scrollHeight, 19 * 5 + 14)}px`;
	});

	function close() {
		btw.setOpen(false);
		onClose?.();
	}

	function send() {
		if (!canSend) return;
		pinnedToEnd = true;
		void btw.ask(btw.draft);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.isComposing) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			if (btw.historyOpen) btw.historyOpen = false;
			else close();
			return;
		}
		// Ctrl+B (Cmd+B su Mac) chiude come apre; nel campo non deve fare il grassetto.
		if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === 'KeyB') {
			event.preventDefault();
			close();
		}
	}

	function handleInputKeydown(event: KeyboardEvent) {
		if (event.isComposing) return;
		if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
			event.preventDefault();
			send();
		}
	}

	function pickSuggestion(text: string) {
		btw.draft = text;
		void tick().then(() => inputEl?.focus());
	}

	function useInMessage() {
		if (btw.useInMessage()) onUseInMessage?.();
	}

	function statusLabel(turn: BtwTurn): string | null {
		if (turn.status === 'cancelled') return m.btw_status_cancelled();
		if (turn.status === 'interrupted') return m.btw_status_interrupted();
		if (turn.status === 'error') return m.btw_status_error();
		return null;
	}

	function topicMeta(topic: BtwRecord): string {
		const when = btwWhen(topic.createdAt, Date.now(), getLocale(), m.btw_when_now());
		const count = btwTurns(topic).length;
		return count > 1 ? `${when} · ${m.btw_history_turns({ count })}` : when;
	}

	function topicState(topic: BtwRecord): 'live' | 'ok' | 'off' {
		if (isBtwRunning(topic)) return 'live';
		return btwLatestTurn(topic).status === 'complete' ? 'ok' : 'off';
	}
</script>

<div
	class="btw-pop rv-lift"
	style="--dur: 220ms; --blur: 2px;"
	role="dialog"
	tabindex="-1"
	aria-label={m.btw_aria()}
	onkeydown={handleKeydown}
>
	<header class="btw-head">
		<span class="btw-mark" aria-hidden="true"><IconAside /></span>
		<strong class="btw-title">{m.btw_title()}</strong>
		<span class="btw-badge">{m.btw_badge_out_of_context()}</span>
		<span class="btw-sub">{m.btw_subtitle()}</span>
		<span class="btw-spacer"></span>
		<button
			type="button"
			class="ui-button ui-button-secondary btw-sm"
			class:on={btw.historyOpen}
			aria-expanded={btw.historyOpen}
			aria-controls="btw-history"
			onclick={() => btw.toggleHistory()}
		>
			<IconHistory aria-hidden="true" />
			{m.btw_history()}
			<span class="btw-count tabular-nums">{btw.records.length}</span>
		</button>
		<Tooltip text={m.btw_close()} placement="top" offset={6}>
			<button type="button" class="btw-icon-btn" aria-label={m.btw_close()} onclick={close}>
				<IconClose />
			</button>
		</Tooltip>
	</header>

	{#if btw.historyOpen}
		<ul class="btw-history" id="btw-history" aria-label={m.btw_history_aria()}>
			{#each btw.records as topic (topic.id)}
				<li><button
					type="button"
					class="btw-hrow"
					class:on={topic.id === btw.selectedId}
					onclick={() => btw.selectTopic(topic.id)}
				>
					<span class="btw-dot {topicState(topic)}" aria-hidden="true"></span>
					<span class="btw-hq">{topic.question}</span>
					<span class="btw-hmeta">{topicMeta(topic)}</span>
				</button></li>
			{:else}
				<li class="btw-empty">{m.btw_history_empty()}</li>
			{/each}
		</ul>
	{/if}

	<div class="btw-body" bind:this={bodyEl} onscroll={onBodyScroll}>
		{#if turns.length > 0}
			{#each turns as turn, index (index)}
				{@const label = statusLabel(turn)}
				<div class="btw-q" class:followup={index > 0}>
					{#if index > 0}
						<span class="btw-fu" aria-label={m.btw_followup_aria()}><IconFollowUp aria-hidden="true" /></span>
					{/if}
					<span>{turn.question}</span>
				</div>
				<div class="btw-a" aria-live={index === turns.length - 1 ? 'polite' : undefined}>
					{#if turn.status === 'running' && !turn.answer}
						<span class="btw-thinking"><span class="btw-spin" aria-hidden="true"></span>{m.btw_thinking()}</span>
					{:else if turn.answer}
						<Markdown tokens={lexMarkdown(turn.answer)} />
						{#if turn.status === 'running'}<span class="btw-caret" aria-hidden="true"></span>{/if}
					{/if}
					{#if label}
						<span class="btw-state" title={turn.error ?? undefined}>{label}{#if turn.error}: {turn.error}{/if}</span>
					{/if}
				</div>
			{/each}
		{:else}
			<p class="btw-intro">{m.btw_intro()}</p>
			<div class="btw-sugg">
				{#each suggestions as suggestion (suggestion)}
					<button type="button" class="ui-chip" onclick={() => pickSuggestion(suggestion)}>{suggestion}</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if turns.length > 0}
		<div class="btw-actions">
			{#if running}
				<span class="btw-busy"><span class="btw-spin" aria-hidden="true"></span>{m.btw_running()}</span>
				<span class="btw-spacer"></span>
				<button
					type="button"
					class="ui-button ui-button-secondary btw-sm"
					disabled={!record || !isBtwRunning(record)}
					onclick={() => void btw.cancel()}
				>
					{m.btw_cancel()}
				</button>
			{:else}
				<button
					type="button"
					class="ui-button ui-button-secondary btw-sm"
					disabled={!latest?.answer}
					onclick={() => void btw.copySelected()}
				>
					<IconCopy aria-hidden="true" />
					{m.btw_copy()}
				</button>
				<Tooltip text={m.btw_use_hint()} placement="top" offset={6}>
					<button
						type="button"
						class="ui-button ui-button-secondary btw-sm"
						disabled={!latest?.answer}
						onclick={useInMessage}
					>
						<IconQuote aria-hidden="true" />
						{m.btw_use()}
					</button>
				</Tooltip>
				<span class="btw-spacer"></span>
				<button type="button" class="ui-button ui-button-secondary btw-sm" onclick={() => btw.newQuestion()}>
					<IconPlus aria-hidden="true" />
					{m.btw_new()}
				</button>
			{/if}
		</div>
	{/if}

	<div class="btw-input">
		<textarea
			bind:this={inputEl}
			bind:value={btw.draft}
			class="btw-field"
			rows="1"
			spellcheck="false"
			aria-label={m.btw_aria()}
			placeholder={turns.length > 0 ? m.btw_placeholder_followup() : m.btw_placeholder_new()}
			onkeydown={handleInputKeydown}
		></textarea>
		<button
			type="button"
			class="btw-send"
			aria-label={m.btw_send()}
			title={m.btw_send()}
			disabled={!canSend}
			onclick={send}
		>
			<IconArrowUp />
		</button>
	</div>
</div>

<style>
	.btw-pop {
		position: absolute;
		left: calc(var(--space-3) - var(--space-2));
		right: calc(var(--space-3) - var(--space-2));
		bottom: calc(100% + var(--space-2));
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		max-height: min(58vh, 520px);
		padding: 10px 14px 12px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-2xl);
		box-shadow: var(--shadow-overlay);
		font-family: var(--font-ui);
		color: var(--ink);
		min-width: 0;
	}

	.btw-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 12.5px;
		padding-bottom: var(--space-2);
		margin-bottom: 10px;
		border-bottom: 1px solid var(--line);
		min-width: 0;
	}
	.btw-mark {
		display: inline-flex;
		color: var(--brand-ink);
		--icon-size: 14px;
	}
	.btw-title {
		font-weight: 600;
		white-space: nowrap;
	}
	.btw-badge {
		font-size: 10.5px;
		padding: 1px 7px;
		border-radius: var(--radius-full);
		border: 1px solid var(--line-strong);
		color: var(--ink-muted);
		white-space: nowrap;
	}
	.btw-sub {
		color: var(--ink-faint);
		font-size: var(--text-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.btw-spacer {
		flex: 1;
	}
	.btw-sm {
		padding: 3px 9px;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--ink-muted);
		--icon-size: 12px;
		white-space: nowrap;
	}
	.btw-sm:hover:not(:disabled),
	.btw-sm.on {
		color: var(--ink);
	}
	.btw-sm.on {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}
	.btw-count {
		color: var(--ink-faint);
	}
	.btw-icon-btn {
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 14px;
	}
	.btw-icon-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.btw-history {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: -4px 0 10px;
		padding: 0 0 var(--space-2);
		border-bottom: 1px solid var(--line);
		max-height: 168px;
		overflow-y: auto;
		flex: none;
	}
	.btw-hrow {
		width: 100%;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 5px 8px;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 12.5px;
		text-align: left;
		cursor: pointer;
		min-width: 0;
	}
	.btw-hrow:hover,
	.btw-hrow.on {
		background: var(--bg-hover);
	}
	.btw-hq {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.btw-hmeta {
		color: var(--ink-faint);
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.btw-empty {
		margin: 2px 8px;
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}

	.btw-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex: none;
		display: inline-block;
	}
	.btw-dot.live {
		background: var(--warn);
		animation: state-pulse 1.2s ease-in-out infinite;
	}
	.btw-dot.ok {
		background: var(--success);
	}
	.btw-dot.off {
		background: var(--ink-faint);
	}

	.btw-body {
		overflow-y: auto;
		min-height: 40px;
		flex: 1 1 auto;
		overscroll-behavior: contain;
	}
	.btw-intro {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
		color: var(--ink-muted);
		line-height: 1.45;
	}
	.btw-sugg {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.btw-sugg :global(.ui-chip) {
		font-size: var(--text-sm);
		padding: 4px 10px;
		background: transparent;
		border-color: var(--line-strong);
	}
	.btw-q {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 10px 0 4px;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--ink-muted);
	}
	.btw-q:first-child {
		margin-top: 0;
	}
	.btw-fu {
		display: inline-flex;
		color: var(--ink-faint);
		--icon-size: 11px;
	}
	.btw-a {
		font-size: var(--text-md);
		line-height: 22px;
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	.btw-a :global(.paragraph) {
		margin: 0 0 6px;
	}
	.btw-a :global(.paragraph:last-of-type) {
		display: inline;
	}
	.btw-caret {
		display: inline-block;
		width: 7px;
		height: 15px;
		margin-left: 2px;
		vertical-align: -2px;
		background: var(--ink);
		animation: state-pulse 1s ease-in-out infinite;
	}
	.btw-thinking,
	.btw-busy {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--ink-faint);
		font-size: 12.5px;
	}
	.btw-busy {
		color: var(--ink-muted);
		font-size: var(--text-sm);
	}
	.btw-spin {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 1.5px solid var(--line-strong);
		border-top-color: var(--ink);
		animation: spin 0.9s linear infinite;
		flex: none;
	}
	.btw-state {
		display: inline-block;
		margin-left: var(--space-2);
		font-size: 10.5px;
		padding: 0 6px;
		border-radius: var(--radius-full);
		border: 1px solid var(--line-strong);
		color: var(--ink-faint);
	}

	.btw-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: var(--space-2) 0 2px;
		flex: none;
	}

	.btw-input {
		display: flex;
		align-items: flex-end;
		gap: var(--space-2);
		padding-top: var(--space-2);
		flex: none;
	}
	.btw-field {
		flex: 1;
		min-height: 34px;
		resize: none;
		padding: 6px 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-base);
		line-height: 19px;
		outline: none;
		caret-color: var(--ink);
		box-sizing: border-box;
	}
	.btw-field:focus {
		border-color: var(--brand);
	}
	.btw-field::placeholder {
		color: var(--ink-faint);
	}
	.btw-send {
		width: 28px;
		height: 28px;
		margin-bottom: 3px;
		flex: none;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: var(--ink);
		color: var(--bg-base);
		cursor: pointer;
		--icon-size: 14px;
	}
	.btw-send:disabled {
		opacity: 0.35;
		cursor: default;
	}
</style>
