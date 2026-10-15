<!--
  CodeBlock.svelte — Blocco di codice con testata ripiegabile, indicatore lingua,
  conteggio righe e pulsante copia rapida.
  Fedele a Studio ma leggero (plain mono <pre>, senza Monaco).
-->
<script lang="ts">
	import { t } from '../../i18n.ts';
	import { IconChevronRight, IconCopy, IconCheck } from '../../icons.ts';

	let {
		lang = '',
		text = ''
	}: {
		lang?: string;
		text: string;
	} = $props();

	let collapsed = $state(false);
	let copied = $state(false);

	const normalizedLang = $derived((lang ?? '').trim().toLowerCase());
	const displayLang = $derived(normalizedLang || 'code');

	const lineCount = $derived.by(() => {
		if (!text) return 0;
		let count = 1;
		let pos = -1;
		while ((pos = text.indexOf('\n', pos + 1)) !== -1) {
			count++;
		}
		return count;
	});

	async function handleCopy(e: MouseEvent): Promise<void> {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 1500);
		} catch {
			// Clipboard non accessibile
		}
	}

	function toggleCollapse(): void {
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
			title={collapsed ? t('chatCodeExpand') : t('chatCodeCollapse')}
		>
			<span class="chevron" class:expanded={!collapsed} aria-hidden="true">
				<IconChevronRight />
			</span>
			<span class="code-lang">{displayLang}</span>
			{#if lineCount > 1}
				<span class="line-badge">{t('chatLinesCount', { count: lineCount })}</span>
			{/if}
		</button>

		<div class="header-right">
			<button
				type="button"
				class="copy-btn"
				onclick={handleCopy}
				title={t('chatCopy')}
			>
				{#if copied}
					<span class="copied-indicator"><IconCheck aria-hidden="true" />{t('chatCopied')}</span>
				{:else}
					<span class="copy-idle"><IconCopy aria-hidden="true" />{t('chatCopy')}</span>
				{/if}
			</button>
		</div>
	</div>

	{#if !collapsed}
		<div class="code-body-wrap">
			<pre class="code-pre"><code>{text}</code></pre>
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 10px;
		color: var(--ink-faint);
		flex-shrink: 0;
		transition: transform var(--dur-fast) var(--ease-out);
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
		padding-right: var(--space-1);
	}

	.copy-btn {
		background: transparent;
		border: 1px solid transparent;
		padding: 2px var(--space-2);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		cursor: pointer;
		border-radius: var(--radius-sm);
		display: inline-flex;
		align-items: center;
		gap: 4px;
		--icon-size: 13px;
		transition:
			background-color var(--dur-fast) var(--ease-out),
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

	.copy-idle {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.code-body-wrap {
		position: relative;
		min-width: 0;
		background: var(--bg-sunken);
	}

	.code-pre {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		line-height: 1.5;
		color: var(--ink);
		overflow-x: auto;
		white-space: pre;
	}

	.code-pre code {
		font-family: inherit;
		font-size: inherit;
	}
</style>
