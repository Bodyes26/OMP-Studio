<script lang="ts">
	// CodeBlock: blocco di codice per le risposte dell'assistente con evidenziazione
	// sintattica Monaco, intestazione a fisarmonica (accordion), altezza massima a 10.5 righe
	// con scorrimento interno, sfumatura/ombra sul fondo in presenza di overflow e copia rapida.
	import { untrack } from 'svelte';
	import { colorizeCode, type StreamFade } from '../markdown';
	import { countLabel } from '../tools/types';
	import StreamTail from './StreamTail.svelte';

	let {
		lang = '',
		text = '',
		fade = null
	}: {
		lang?: string;
		text: string;
		fade?: StreamFade | null;
	} = $props();

	let collapsed = $state(false);
	let copied = $state(false);
	let colorizedHtml = $state<string | null>(null);
	let preEl = $state<HTMLElement | null>(null);
	let canScrollDown = $state(false);

	const normalizedLang = $derived((lang ?? '').trim().toLowerCase());
	const displayLang = $derived(normalizedLang || 'testo');
	const lines = $derived(text ? text.split('\n') : []);
	const lineCount = $derived(lines.length);
	const lineLabel = $derived(countLabel(lineCount, 'riga', 'righe'));

	// Evidenziazione asincrona tramite Monaco
	$effect(() => {
		const currentText = text;
		const currentLang = normalizedLang;
		if (!currentText || !currentLang) {
			colorizedHtml = null;
			return;
		}

		let cancelled = false;
		colorizeCode(currentText, currentLang)
			.then((html) => {
				if (!cancelled) {
					colorizedHtml = html;
				}
			})
			.catch(() => {
				if (!cancelled) {
					colorizedHtml = null;
				}
			});

		return () => {
			cancelled = true;
		};
	});

	function checkScroll() {
		if (!preEl || collapsed) {
			canScrollDown = false;
			return;
		}
		const { scrollTop, scrollHeight, clientHeight } = preEl;
		const threshold = 4;
		canScrollDown = scrollHeight - (scrollTop + clientHeight) > threshold;
	}

	// Monitora il ridimensionamento e il caricamento del contenuto per l'ombra inferiore
	$effect(() => {
		// Dipendenze reattive
		void text;
		void colorizedHtml;
		void collapsed;

		if (!preEl || collapsed) {
			canScrollDown = false;
			return;
		}

		checkScroll();

		if (typeof ResizeObserver !== 'undefined') {
			const ro = new ResizeObserver(() => {
				checkScroll();
			});
			ro.observe(preEl);
			return () => ro.disconnect();
		}
	});

	async function handleCopy(e: MouseEvent) {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 1500);
		} catch {
			// Clipboard non accessibile nel contesto corrente
		}
	}

	function toggleCollapse() {
		collapsed = !collapsed;
	}
</script>

<div class="code-block" class:collapsed>
	<div class="code-header">
		<button
			type="button"
			class="header-toggle"
			onclick={toggleCollapse}
			aria-expanded={!collapsed}
			title={collapsed ? 'Espandi blocco di codice' : 'Comprimi blocco di codice'}
		>
			<span class="chevron" class:expanded={!collapsed} aria-hidden="true">▸</span>
			<span class="code-lang">{displayLang}</span>
			{#if lineCount > 1}
				<span class="line-badge">{lineLabel}</span>
			{/if}
		</button>

		<div class="header-right">
			<button
				type="button"
				class="copy-btn"
				onclick={handleCopy}
				title="Copia codice negli appunti"
			>
				{#if copied}
					<span class="copied-indicator">✓ Copiato!</span>
				{:else}
					<span>Copia</span>
				{/if}
			</button>
		</div>
	</div>

	{#if !collapsed}
		<div class="code-body-wrap">
			{#if colorizedHtml}
				<pre
					bind:this={preEl}
					class="code-pre colorized"
					onscroll={checkScroll}
				>{@html colorizedHtml}</pre>
			{:else}
				<pre
					bind:this={preEl}
					class="code-pre"
					onscroll={checkScroll}
				>{#if fade}<StreamTail {text} {fade} />{:else}{text}{/if}</pre>
			{/if}

			{#if canScrollDown}
				<div class="scroll-fade-bottom" aria-hidden="true"></div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.code-block {
		margin: var(--space-2) 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		overflow: hidden;
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.code-block:hover {
		border-color: var(--line-strong);
	}

	.code-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		background: var(--bg-hover);
		border-bottom: 1px solid var(--line);
		user-select: none;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.code-block.collapsed .code-header {
		border-bottom: none;
	}

	.code-header:hover {
		background: color-mix(in srgb, var(--bg-hover) 150%, transparent);
	}

	.header-toggle {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
		min-width: 0;
		padding: 4px var(--space-2);
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}

	.header-toggle:hover {
		color: var(--ink);
	}

	.chevron {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		transition: transform var(--dur-fast) var(--ease-out);
		display: inline-block;
		width: 10px;
		text-align: center;
		flex-shrink: 0;
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.code-lang {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 500;
		text-transform: lowercase;
		color: var(--ink-muted);
	}

	.line-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		opacity: 0.85;
	}

	.header-right {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.copy-btn {
		background: transparent;
		border: 1px solid transparent;
		padding: 1px var(--space-1);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		cursor: pointer;
		border-radius: var(--radius-sm);
		display: inline-flex;
		align-items: center;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.copy-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
		border-color: var(--line);
	}

	.copied-indicator {
		color: var(--brand-ink, var(--brand));
		font-weight: 500;
	}

	.code-body-wrap {
		position: relative;
		min-width: 0;
		background: var(--bg-sunken);
	}

	.code-pre {
		margin: 0;
		padding: var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.5;
		color: var(--ink);
		overflow-x: auto;
		overflow-y: auto;
		/* Massimo 10.5 righe di altezza: 10.5 * 1.5em + padding sopra/sotto */
		max-height: calc(10.5 * 1.5em + var(--space-2) * 2);
		white-space: pre;
		user-select: text;
		scrollbar-gutter: stable;
	}

	/* Ombra/sfumatura elegante sul fondo quando ci sono ulteriori righe oltre l'altezza massima */
	.scroll-fade-bottom {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 28px;
		background: linear-gradient(
			to bottom,
			transparent 0%,
			color-mix(in srgb, var(--bg-sunken) 80%, transparent) 40%,
			var(--bg-sunken) 100%
		);
		pointer-events: none;
		opacity: 1;
		transition: opacity var(--dur-fast) var(--ease-out);
		border-bottom-left-radius: var(--radius-sm);
		border-bottom-right-radius: var(--radius-sm);
		box-shadow: inset 0 -6px 8px -4px color-mix(in srgb, #000 35%, transparent);
	}
</style>
