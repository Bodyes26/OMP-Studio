<script lang="ts">
	// CodeBlock: blocco di codice per le risposte dell'assistente con evidenziazione
	// sintattica Monaco, intestazione a fisarmonica (accordion) e copia rapida.
	// Il codice scorre con il transcript (nessun tetto di altezza interno).
	import { colorizeCode, detectFilePathBlock, type FilePathItem, type StreamFade } from '../markdown';
	import { agentUiHooks } from '../ui-context';
	import { countLabel } from '../tools/types';
	import StreamTail from './StreamTail.svelte';
	import { IconChevronRight, IconCheck, IconFile, IconCopy } from '$lib/icons';

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
	let copiedItemIndex = $state<number | null>(null);
	let colorizedHtml = $state<string | null>(null);

	const hooks = agentUiHooks();
	const normalizedLang = $derived((lang ?? '').trim().toLowerCase());
	const displayLang = $derived(normalizedLang || 'testo');
	const lines = $derived(text ? text.split('\n') : []);
	const lineCount = $derived(lines.length);
	const lineLabel = $derived(countLabel(lineCount, 'riga', 'righe'));
	const filePathItems = $derived(detectFilePathBlock(text, normalizedLang));
	// Evidenziazione asincrona tramite Monaco
	$effect(() => {
		const currentText = text;
		const currentLang = normalizedLang;
		if (!currentText || !currentLang || filePathItems) {
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
					onclick={() => hooks.openFile(item.path, item.line)}
				>
					<span class="file-chip-icon" aria-hidden="true"><IconFile /></span>
					<span class="file-chip-path">
						{#if fade && idx === filePathItems.length - 1}
							<StreamTail text={item.path} {fade} />
						{:else}
							{item.path}
						{/if}
					</span>
					{#if item.line}
						<span class="file-chip-line">:{item.line}</span>
					{/if}
				</button>
				<button
					type="button"
					class="file-chip-copy"
					title="Copia percorso negli appunti"
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
		font-size: var(--text-sm);
		cursor: pointer;
		text-align: left;
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
		display: inline-flex;
		align-items: center;
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.file-chip-icon :global(svg) {
		width: 14px;
		height: 14px;
	}

	.file-chip-btn:hover .file-chip-icon {
		color: var(--brand);
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

	.file-chip-copy :global(svg) {
		width: 13px;
		height: 13px;
	}

	.file-chip-copy .copied-indicator {
		color: var(--brand);
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
