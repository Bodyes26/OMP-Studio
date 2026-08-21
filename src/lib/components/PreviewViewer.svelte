<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { wrapPrototypeCode } from '$lib/prototype/wrapper';

	let {
		projectPath,
		filePath,
		onClose
	}: {
		projectPath: string;
		filePath: string;
		onClose?: () => void;
	} = $props();

	let rawContent = $state('');
	let htmlDoc = $state('');
	let loading = $state(true);
	let missing = $state(false);
	let copied = $state(false);
	let viewMode = $state<'preview' | 'code'>('preview');

	// Viewport responsive per testare il prototipo a larghezze diverse.
	type Device = 'desktop' | 'tablet' | 'mobile';
	const DEVICE_WIDTHS: Record<Device, string> = {
		desktop: '100%',
		tablet: '768px',
		mobile: '390px'
	};
	let device = $state<Device>('desktop');

	async function load() {
		loading = true;
		missing = false;
		try {
			const res: { content: string; exists: boolean } = await invoke('preview_file', {
				projectPath,
				rel: filePath
			});
			if (!res.exists) {
				missing = true;
				rawContent = '';
				htmlDoc = '';
			} else {
				rawContent = res.content;
				const title = filePath.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Prototipo';
				htmlDoc = wrapPrototypeCode(title, res.content);
			}
		} catch (e) {
			console.error('preview_file failed', e);
			missing = true;
			rawContent = '';
			htmlDoc = '';
		} finally {
			loading = false;
		}
	}

	async function copyCode() {
		if (!rawContent) return;
		try {
			await navigator.clipboard.writeText(rawContent);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 1800);
		} catch (e) {
			console.error('Failed to copy', e);
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose?.();
	}

	$effect(() => {
		if (projectPath && filePath) void load();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="preview-viewer">
	<div class="preview-toolbar">
		<div class="title-wrap">
			<span class="preview-badge">PROTO</span>
			<span class="preview-title" title={filePath}>{filePath.split('/').pop()}</span>
		</div>

		<div class="view-mode-group" role="group" aria-label="Modalita visualizzazione">
			<button
				class="mode-btn"
				class:active={viewMode === 'preview'}
				onclick={() => (viewMode = 'preview')}
				title="Anteprima interattiva live"
			>Anteprima</button>
			<button
				class="mode-btn"
				class:active={viewMode === 'code'}
				onclick={() => (viewMode = 'code')}
				title="Ispeziona codice sorgente"
			>Codice</button>
		</div>

		{#if viewMode === 'preview'}
			<div class="device-group" role="group" aria-label="Larghezza viewport">
				<button
					class="device-btn"
					class:active={device === 'desktop'}
					onclick={() => (device = 'desktop')}
					title="Desktop (100%)"
				>Desktop</button>
				<button
					class="device-btn"
					class:active={device === 'tablet'}
					onclick={() => (device = 'tablet')}
					title="Tablet (768px)"
				>Tablet</button>
				<button
					class="device-btn"
					class:active={device === 'mobile'}
					onclick={() => (device = 'mobile')}
					title="Mobile (390px)"
				>Mobile</button>
			</div>
		{/if}

		<span class="toolbar-spacer"></span>

		<button class="tool-btn" onclick={copyCode} title="Copia il codice sorgente negli appunti">
			{copied ? '✓ Copiato!' : 'Copia'}
		</button>
		<button class="tool-btn" onclick={() => void load()} title="Ricarica il file">Ricarica</button>
		<button class="tool-btn close" onclick={() => onClose?.()} title="Chiudi (Esc)">×</button>
	</div>

	{#if loading}
		<div class="center-note">Caricamento prototipo...</div>
	{:else if missing}
		<div class="center-note">File non trovato: {filePath}</div>
	{:else if viewMode === 'code'}
		<div class="code-view-container">
			<pre class="code-block"><code>{rawContent}</code></pre>
		</div>
	{:else}
		<div class="preview-stage">
			<!-- sandbox senza allow-same-origin: il prototipo gira isolato, non
			     puo' toccare il DOM di Studio ne' i cookie della WebView. -->
			<iframe
				class="preview-frame"
				style:width={DEVICE_WIDTHS[device]}
				sandbox="allow-scripts"
				title="Anteprima {filePath}"
				srcdoc={htmlDoc}
			></iframe>
		</div>
	{/if}
</div>

<style>
	.preview-viewer {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		background: var(--bg-sunken);
	}

	.preview-toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		min-height: 32px;
		flex-shrink: 0;
	}

	.title-wrap {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		margin-right: var(--space-1);
	}

	.preview-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.05em;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: var(--brand-glow, rgba(99, 102, 241, 0.15));
		color: var(--brand);
		border: 1px solid var(--brand-line, rgba(99, 102, 241, 0.3));
		flex-shrink: 0;
	}

	.preview-title {
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 25ch;
	}

	.view-mode-group,
	.device-group {
		display: flex;
		gap: 2px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 2px;
	}

	.mode-btn,
	.device-btn {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background 0.12s ease, color 0.12s ease;
	}

	.mode-btn:hover,
	.device-btn:hover {
		color: var(--ink);
	}

	.mode-btn.active,
	.device-btn.active {
		background: var(--bg-active);
		color: var(--ink);
		font-weight: 500;
	}

	.toolbar-spacer {
		flex: 1;
	}

	.tool-btn {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		padding: 3px 8px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background 0.12s ease, color 0.12s ease;
	}

	.tool-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.tool-btn.close {
		font-size: var(--text-md);
		line-height: 1;
		padding: 0 6px;
	}

	.preview-stage {
		flex: 1;
		display: flex;
		justify-content: center;
		align-items: stretch;
		overflow: hidden;
		padding: var(--space-2);
	}

	.preview-frame {
		height: 100%;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: #09090b;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
		transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.code-view-container {
		flex: 1;
		overflow: auto;
		padding: var(--space-4);
		background: var(--bg-sunken);
	}

	.code-block {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.6;
		color: var(--ink);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.center-note {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-muted);
		font-size: var(--text-sm);
	}
</style>
