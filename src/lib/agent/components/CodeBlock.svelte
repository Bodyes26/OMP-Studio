<script lang="ts">
	// CodeBlock: blocco di codice per le risposte dell'assistente con evidenziazione
	// sintattica Monaco, intestazione a fisarmonica (accordion) e copia rapida.
	// Il codice scorre con il transcript (nessun tetto di altezza interno).
	import { colorizeCode, type StreamFade } from '../markdown';
	import { countLabel } from '../tools/types';
	import StreamTail from './StreamTail.svelte';
	import { IconChevronRight, IconCheck } from '$lib/icons';

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
			<span class="chevron" class:expanded={!collapsed} aria-hidden="true"><IconChevronRight /></span>
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
					<span class="copied-indicator"><IconCheck aria-hidden="true" />Copiato!</span>
				{:else}
					<span>Copia</span>
				{/if}
			</button>
		</div>
	</div>

	{#if !collapsed}
		<div class="code-body-wrap">
			{#if colorizedHtml}
				<pre class="code-pre colorized">{@html colorizedHtml}</pre>
			{:else}
				<pre class="code-pre">{#if fade}<StreamTail {text} {fade} />{:else}{text}{/if}</pre>
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
		background: var(--bg-active);
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
		--icon-size: 12px;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		transition: transform var(--dur-fast) var(--ease-out);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 10px;
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
		font-size: var(--text-xs);
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
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--brand-ink);
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
		white-space: pre;
		user-select: text;
	}
</style>
