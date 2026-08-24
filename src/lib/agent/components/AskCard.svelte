<script lang="ts">
	// Card per richieste interattive dall'agente (ask: select, input, editor, confirm).
	// Gestisce round singoli di selezione (anche per multi-select sequenziali),
	// countdown con scadenza e navigazione da tastiera.
	import type { AgentSession, PendingAsk } from '../session.svelte';

	let { session, pending } = $props<{ session: AgentSession; pending: PendingAsk }>();

	let selectedIndex = $state(0);
	let inputValue = $state('');
	let editorValue = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);
	let editorEl = $state<HTMLTextAreaElement | null>(null);
	let cardEl = $state<HTMLElement | null>(null);

	// Scadenza con countdown
	let now = $state(Date.now());
	$effect(() => {
		if (!pending.deadline) return;
		const timer = setInterval(() => {
			now = Date.now();
		}, 500);
		return () => clearInterval(timer);
	});

	const remainingSeconds = $derived.by(() => {
		if (!pending.deadline) return null;
		const diff = Math.ceil((pending.deadline - now) / 1000);
		return diff > 0 ? diff : 0;
	});

	const showCountdown = $derived(remainingSeconds !== null && remainingSeconds > 0);

	// Parsing del titolo per estrarre eventuale contatore di round `(N selected) Domanda`
	const parsedTitle = $derived.by(() => {
		const raw = pending.title || '';
		const match = raw.match(/^\((\d+\s+selected|\d+\s+selezionat[io]|[^)]+)\)\s*(.*)$/i);
		if (match) {
			return {
				counter: match[1].trim(),
				text: match[2].trim() || raw
			};
		}
		return {
			counter: null,
			text: raw
		};
	});

	const options = $derived(pending.options ?? []);
	const optionDetails = $derived(pending.optionDetails ?? []);

	// Reset dello stato quando cambia la richiesta: il fuoco va sul campo di
	// testo per input/editor, altrimenti sulla card stessa (select/confirm)
	// cosi' le scorciatoie sotto restano scoperte da onkeydown solo qui.
	$effect(() => {
		const _req = pending.requestId;
		selectedIndex = 0;
		inputValue = pending.prefill ?? '';
		editorValue = pending.prefill ?? '';

		if (pending.method === 'input' && inputEl) {
			inputEl.focus();
		} else if (pending.method === 'editor' && editorEl) {
			editorEl.focus();
		} else {
			cardEl?.focus();
		}
	});

	// Navigazione da tastiera per select e confirm: gestita sul contenitore
	// (mai su window), altrimenti Invio/Esc/frecce digitate altrove nell'app
	// (es. nel composer) risponderebbero a questa richiesta al posto loro.
	function onCardKeydown(e: KeyboardEvent) {
		if (pending.method === 'select') {
			if (options.length === 0) return;
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				selectedIndex = (selectedIndex + 1) % options.length;
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				selectedIndex = (selectedIndex - 1 + options.length) % options.length;
			} else if (e.key === 'Enter') {
				e.preventDefault();
				const opt = options[selectedIndex];
				if (opt !== undefined) {
					session.answerSelect(opt);
				}
			} else if (e.key === 'Escape') {
				e.preventDefault();
				session.cancelPendingUi();
			}
		} else if (pending.method === 'confirm') {
			if (e.key === 'Enter') {
				e.preventDefault();
				session.answerConfirm(true);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				session.answerConfirm(false);
			}
		}
	}

	function handleInputKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			session.answerSelect(inputValue);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			session.cancelPendingUi();
		}
	}

	function handleEditorKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			session.answerSelect(editorValue);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			session.cancelPendingUi();
		}
	}
</script>

<div
	class="ask-card"
	role="dialog"
	aria-modal="true"
	aria-labelledby="ask-title"
	tabindex="-1"
	bind:this={cardEl}
	onkeydown={onCardKeydown}
>
	<div class="header">
		<div class="title-row">
			{#if parsedTitle.counter}
				<span class="counter-badge">{parsedTitle.counter}</span>
			{/if}
			<h3 id="ask-title" class="title-text">{parsedTitle.text}</h3>
			{#if showCountdown}
				<span class="deadline-badge">Scade tra {remainingSeconds}s</span>
			{/if}
		</div>
		{#if pending.message}
			<p class="message-text">{pending.message}</p>
		{/if}
	</div>

	<div class="body">
		{#if pending.method === 'select'}
			<div class="options-list" role="listbox">
				{#each options as opt, i}
					<button
						type="button"
						role="option"
						aria-selected={selectedIndex === i}
						class="option-item"
						class:selected={selectedIndex === i}
						onclick={() => session.answerSelect(opt)}
						onmouseenter={() => (selectedIndex = i)}
					>
						<span class="option-label">{opt}</span>
						{#if optionDetails[i]?.description}
							<span class="option-desc">{optionDetails[i].description}</span>
						{/if}
					</button>
				{/each}
			</div>
			<div class="shortcut-hints">
				<span><span class="kbd">↑</span> <span class="kbd">↓</span> per navigare</span>
				<span><span class="kbd">↵</span> per scegliere</span>
				<span><span class="kbd">Esc</span> per annullare</span>
			</div>
		{:else if pending.method === 'input'}
			<div class="input-container">
				<input
					type="text"
					class="text-input"
					placeholder={pending.placeholder ?? ''}
					bind:value={inputValue}
					bind:this={inputEl}
					onkeydown={handleInputKeydown}
				/>
				<div class="actions">
					<button
						type="button"
						class="btn-cancel"
						onclick={() => session.cancelPendingUi()}
						title="Annulla (Esc)"
					>
						Annulla <span class="kbd">Esc</span>
					</button>
					<button
						type="button"
						class="btn-submit"
						onclick={() => session.answerSelect(inputValue)}
						title="Invia risposta (Enter)"
					>
						Invia <span class="kbd">↵</span>
					</button>
				</div>
			</div>
		{:else if pending.method === 'editor'}
			<div class="editor-container">
				<textarea
					class="editor-input"
					placeholder={pending.placeholder ?? ''}
					bind:value={editorValue}
					bind:this={editorEl}
					onkeydown={handleEditorKeydown}
				></textarea>
				<div class="actions">
					<button
						type="button"
						class="btn-cancel"
						onclick={() => session.cancelPendingUi()}
						title="Annulla (Esc)"
					>
						Annulla <span class="kbd">Esc</span>
					</button>
					<button
						type="button"
						class="btn-submit"
						onclick={() => session.answerSelect(editorValue)}
						title="Invia risposta (Ctrl+Enter)"
					>
						Invia <span class="kbd">Ctrl+↵</span>
					</button>
				</div>
			</div>
		{:else if pending.method === 'confirm'}
			<div class="confirm-container">
				<div class="actions">
					<button
						type="button"
						class="btn-cancel"
						onclick={() => session.answerConfirm(false)}
						title="Nega / Annulla (Esc)"
					>
						No <span class="kbd">Esc</span>
					</button>
					<button
						type="button"
						class="btn-submit"
						onclick={() => session.answerConfirm(true)}
						title="Conferma (Enter)"
					>
						Sì <span class="kbd">↵</span>
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.ask-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		min-width: 0;
		outline: none;
	}

	.header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.counter-badge {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 2px 6px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.title-text {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
		flex: 1;
		min-width: 120px;
	}

	.deadline-badge {
		background: color-mix(in srgb, var(--warn) 15%, transparent);
		border: 1px solid var(--warn);
		border-radius: var(--radius-sm);
		padding: 2px 6px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--warn);
		margin-left: auto;
	}

	.message-text {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.options-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-height: 280px;
		overflow-y: auto;
		min-width: 0;
	}

	.option-item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		text-align: left;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast);
		width: 100%;
	}

	.option-item:hover,
	.option-item.selected {
		background: var(--bg-hover);
		border-color: var(--brand);
	}

	.option-label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
	}

	.option-desc {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		margin-top: 2px;
	}

	.shortcut-hints {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		margin-top: 2px;
	}

	.input-container,
	.editor-container {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.text-input {
		width: 100%;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		padding: 8px var(--space-3);
		font-size: var(--text-sm);
		font-family: var(--font-ui);
		color: var(--ink);
		outline: none;
		transition: border-color var(--dur-fast);
	}

	.text-input:focus {
		border-color: var(--brand);
	}

	.editor-input {
		width: 100%;
		min-height: 100px;
		resize: vertical;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		color: var(--ink);
		outline: none;
		transition: border-color var(--dur-fast);
	}

	.editor-input:focus {
		border-color: var(--brand);
	}

	.confirm-container {
		display: flex;
		justify-content: flex-end;
		min-width: 0;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border-radius: var(--radius-sm);
		padding: 6px var(--space-3);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-cancel {
		background: var(--bg-hover);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.btn-cancel:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.btn-submit {
		background: var(--brand);
		border: 1px solid var(--brand);
		color: var(--on-brand);
		font-weight: 600;
	}

	.btn-submit:hover {
		filter: brightness(1.08);
	}

	.kbd {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		opacity: 0.75;
	}
</style>
