<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { wrapPrototypeCode } from '$lib/prototype/wrapper';
	import { buildSandboxedSvgDocument, isSvgFileName, isSvgContent } from '$lib/editor/svgSandbox';
	import { IconCheck, IconClose } from '$lib/icons';
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
	let loadError = $state<string | null>(null);
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
	let isCurrentSvg = $derived(isSvgFileName(filePath) || isSvgContent(rawContent));
	async function load() {
		loading = true;
		missing = false;
		loadError = null;
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
				if (isSvgFileName(filePath) || isSvgContent(res.content)) {
					htmlDoc = buildSandboxedSvgDocument(res.content);
				} else {
					htmlDoc = wrapPrototypeCode(title, res.content);
				}
			}
		} catch (e) {
			// Conserviamo l'errore reale per non confondere errori di I/O con file mancante
			loadError = `Errore durante il caricamento del file: ${String(e)}`;
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
		} catch {
			// Accesso agli appunti non consentito o non disponibile
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			const t = e.target as HTMLElement | null;
			if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
				return;
			}
			onClose?.();
		}
	}
	$effect(() => {
		if (projectPath && filePath) void load();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="preview-viewer">
	<div class="preview-toolbar">
		<div class="title-wrap">
			<span class="preview-badge">{isCurrentSvg ? 'SVG' : 'PROTO'}</span>
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

		<button class="tool-btn" onclick={copyCode} title="Copia il codice sorgente negli appunti" aria-label="Copia codice sorgente negli appunti">
			{#if copied}<IconCheck /> Copiato!{:else}Copia{/if}
		</button>
		<button class="tool-btn" onclick={() => void load()} title="Ricarica il file" aria-label="Ricarica file anteprima">Ricarica</button>
		<button class="tool-btn close" onclick={() => onClose?.()} title="Chiudi (Esc)" aria-label="Chiudi anteprima"><IconClose /></button>
	</div>

	{#if loading}
		<div class="center-note">Caricamento prototipo...</div>
	{:else if missing}
		<div class="center-note">File non trovato: {filePath}</div>
	{:else if loadError}
		<div class="center-note error" role="alert">
			<span>{loadError}</span>
			<button type="button" class="retry-btn" onclick={() => void load()}>Riprova</button>
		</div>
	{:else if viewMode === 'code'}
		<div class="code-view-container">
			<pre class="code-block"><code>{rawContent}</code></pre>
		</div>
	{:else}
		<div class="preview-stage">
			<!-- sandbox isolata: per file SVG 'allow-scripts' e' severamente disabilitato (sandbox=""),
			     mentre per prototipi UI e' attivo 'allow-scripts' ma MAI 'allow-same-origin'.
			     In nessun caso l'iframe ha accesso a IPC o al DOM dell'app. -->
			<iframe
				class="preview-frame"
				style:width={DEVICE_WIDTHS[device]}
				sandbox={isCurrentSvg ? '' : 'allow-scripts'}
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
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.05em;
		padding: 1px 5px;
		background: var(--brand-dim);
		color: var(--ink);
		border: 1px solid var(--line);
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
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
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
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
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
		background: var(--bg-base);
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

	.center-note.error {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		color: var(--danger);
	}

	.center-note .retry-btn {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		padding: 2px 10px;
		cursor: pointer;
	}

	.center-note .retry-btn:hover {
		background: var(--bg-hover);
	}
</style>
