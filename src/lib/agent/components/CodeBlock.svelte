<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	// CodeBlock: blocco di codice per le risposte dell'assistente con evidenziazione
	// sintattica Monaco, intestazione a fisarmonica (accordion) e copia rapida.
	// Il codice scorre con il transcript (nessun tetto di altezza interno).
	import { colorizeCode, getCachedColorizedCode, detectFilePathBlock, type FilePathItem } from '../markdown';
	import { agentUiHooks } from '../ui-context';
	import { IconChevronRight, IconCheck, IconFile, IconCopy } from '$lib/icons';
	import { Lingering } from '../motionState.svelte';
	let {
		lang = '',
		text = '',
		onOpenFile
	}: {
		lang?: string;
		text: string;
		onOpenFile?: (path: string) => void;
	} = $props();

	let collapsed = $state(false);
	let hasToggled = $state(false);
	let copied = $state(false);
	let copiedItemIndex = $state<number | null>(null);
	let colorizedHtml = $state<string | null>(null);

	const openLinger = new Lingering<true>();
	// Il blocco nasce aperto (collapsed = false): il fold parte gia' disteso.
	openLinger.shown = true;

	$effect(() => {
		openLinger.update(!collapsed ? true : undefined);
	});

	onDestroy(() => {
		openLinger.dispose();
	});
	const hooks = agentUiHooks();
	const normalizedLang = $derived((lang ?? '').trim().toLowerCase());
	const displayLang = $derived(normalizedLang || m.code_block_fallback_lang());
	// Conteggio righe rapido con indexOf('\n') senza allocare array di stringhe
	const lineCount = $derived.by(() => {
		if (!text) return 0;
		let count = 1;
		let pos = -1;
		while ((pos = text.indexOf('\n', pos + 1)) !== -1) {
			count++;
		}
		return count;
	});
	const lineLabel = $derived(m.chat_lines_count({ count: lineCount }));
	const filePathItems = $derived(detectFilePathBlock(text, normalizedLang));

	// Evidenziazione asincrona tramite Monaco:
	// - se gia' in cache LRU, applica immediatamente senza attese;
	// - altrimenti applica throttle trailing (~250ms) per non ricolorare
	//   a ogni singolo token durante lo streaming, mostrando il testo grezzo.
	$effect(() => {
		const currentText = text;
		const currentLang = normalizedLang;
		if (!currentText || !currentLang || filePathItems) {
			colorizedHtml = null;
			return;
		}

		const cached = getCachedColorizedCode(currentText, currentLang);
		if (cached) {
			colorizedHtml = cached;
			return;
		}

		let cancelled = false;
		const timer = setTimeout(() => {
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
		}, 250);

		return () => {
			cancelled = true;
			clearTimeout(timer);
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

	async function handleCopyItem(e: MouseEvent, itemRaw: string, index: number) {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(itemRaw);
			copiedItemIndex = index;
			setTimeout(() => {
				if (copiedItemIndex === index) copiedItemIndex = null;
			}, 1500);
		} catch {
			// Clipboard non accessibile
		}
	}

	function toggleCollapse() {
		hasToggled = true;
		collapsed = !collapsed;
	}
</script>

{#if filePathItems}
	<div class="file-chips-block">
		{#each filePathItems as item, idx}
			<div class="file-chip-row">
				<button
					type="button"
					class="file-chip-btn"
					title={item.line ? `Apri ${item.path}:${item.line} nell'editor` : `Apri ${item.path} nell'editor`}
					onclick={() => onOpenFile ? onOpenFile(item.path) : hooks.openFile(item.path, item.line)}
				>
					<span class="file-chip-icon" aria-hidden="true"><IconFile /></span>
					<span class="file-chip-path">
						{item.path}
					</span>
					{#if item.line}
						<span class="file-chip-line">:{item.line}</span>
					{/if}
				</button>
				<button
					type="button"
					class="file-chip-copy"
					title={m.ui_codeblock_copia_percorso_negli_appunti_d113()}
					onclick={(e) => handleCopyItem(e, item.raw, idx)}
				>
					{#if copiedItemIndex === idx}
						<span class="copied-indicator"><IconCheck aria-hidden="true" /></span>
					{:else}
						<IconCopy aria-hidden="true" />
					{/if}
				</button>
			</div>
		{/each}
	</div>
{:else}
	<div class="code-block" class:collapsed={openLinger.shown === undefined}>
	<div class="code-header">
		<button
			type="button"
			class="header-toggle"
			onclick={toggleCollapse}
			aria-expanded={!collapsed}
			title={collapsed ? m.code_block_expand() : m.code_block_collapse()}
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
				title={m.ui_codeblock_copia_codice_negli_appunti_d9e1()}
			>
				{#if copied}
					<span class="copied-indicator"><IconCheck aria-hidden="true" />{m.browser_copied()}</span>
				{:else}
					<span>{m.context_menu_item_copy()}</span>
				{/if}
			</button>
		</div>
	</div>

	{#if openLinger.shown !== undefined}
		<div class={!hasToggled ? undefined : (openLinger.leaving ? 'tray-out' : 'tray-in')}>
			<div class="tray-fold-inner">
				<div class="code-body-wrap">
					{#if colorizedHtml}
						<pre class="code-pre colorized">{@html colorizedHtml}</pre>
					{:else}
						<pre class="code-pre">{text}</pre>
					{/if}
				</div>
			</div>
		</div>
	{/if}
	</div>
{/if}

<style>
	.code-block {
		margin: var(--space-2) 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		overflow: hidden;
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	.file-chips-block {
		margin: var(--space-2) 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-width: 100%;
	}

	.file-chip-row {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		max-width: 100%;
	}

	.file-chip-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 2px var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
		transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
	}

	.file-chip-btn:hover {
		border-color: var(--brand);
		color: var(--brand-ink);
		background: var(--bg-hover);
	}

	.file-chip-icon {
		--icon-size: 14px;
		display: inline-flex;
		align-items: center;
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.file-chip-btn:hover .file-chip-icon {
		color: var(--brand-ink);
	}
	.file-chip-path {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-chip-line {
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.file-chip-copy {
		--icon-size: 13px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-1);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
		flex-shrink: 0;
	}

	.file-chip-copy:hover {
		color: var(--ink);
		background: var(--bg-hover);
		border-color: var(--line);
	}

	.file-chip-copy .copied-indicator {
		--icon-size: 13px;
		color: var(--brand-ink);
		display: inline-flex;
		align-items: center;
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
		font-size: var(--text-caption);
	}
	.header-toggle:hover {
		color: var(--ink);
	}

	.chevron {
		--icon-size: 12px;
		font-size: var(--text-caption);
		color: var(--ink-faint);
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
		font-size: var(--text-caption);
		font-weight: 500;
		text-transform: lowercase;
		color: var(--ink-muted);
	}

	.line-badge {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
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
		font-size: var(--text-caption);
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
		--icon-size: 13px;
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
		font-size: var(--text-mono);
		line-height: 1.5;
		overflow-x: auto;
		white-space: pre;
		user-select: text;
	}
</style>
