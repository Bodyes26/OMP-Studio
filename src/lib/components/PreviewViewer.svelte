<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';

	let {
		projectPath,
		filePath,
		onClose
	}: {
		projectPath: string;
		filePath: string;
		onClose?: () => void;
	} = $props();

	let html = $state('');
	let loading = $state(true);
	let missing = $state(false);

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
				html = '';
			} else {
				html = res.content;
			}
		} catch (e) {
			console.error('preview_file failed', e);
			missing = true;
			html = '';
		} finally {
			loading = false;
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
		<span class="preview-title" title={filePath}>{filePath.split('/').pop()}</span>
		<div class="device-group" role="group" aria-label="Larghezza viewport">
			<button
				class="device-btn"
				class:active={device === 'desktop'}
				onclick={() => (device = 'desktop')}
				title="Desktop"
			>Desktop</button>
			<button
				class="device-btn"
				class:active={device === 'tablet'}
				onclick={() => (device = 'tablet')}
				title="Tablet"
			>Tablet</button>
			<button
				class="device-btn"
				class:active={device === 'mobile'}
				onclick={() => (device = 'mobile')}
				title="Mobile"
			>Mobile</button>
		</div>
		<span class="toolbar-spacer"></span>
		<button class="tool-btn" onclick={() => void load()} title="Ricarica il prototipo">Ricarica</button>
		<button class="tool-btn close" onclick={() => onClose?.()} title="Chiudi (Esc)">×</button>
	</div>

	{#if loading}
		<div class="center-note">Caricamento...</div>
	{:else if missing}
		<div class="center-note">File non trovato: {filePath}</div>
	{:else}
		<div class="preview-stage">
			<!-- sandbox senza allow-same-origin: il prototipo gira isolato, non
			     puo' toccare il DOM di Studio ne' i cookie della WebView. -->
			<iframe
				class="preview-frame"
				style:width={DEVICE_WIDTHS[device]}
				sandbox="allow-scripts"
				title="Anteprima {filePath}"
				srcdoc={html}
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
		min-height: 30px;
		flex-shrink: 0;
	}

	.preview-title {
		color: var(--ink);
		font-size: var(--text-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 30ch;
	}

	.device-group {
		display: flex;
		gap: 2px;
		background: var(--bg-base);
		border-radius: var(--radius-sm);
		padding: 2px;
	}

	.device-btn {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.device-btn.active {
		background: var(--bg-active);
		color: var(--ink);
	}

	.toolbar-spacer {
		flex: 1;
	}

	.tool-btn {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.tool-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.tool-btn.close {
		font-size: var(--text-md);
		line-height: 1;
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
		background: #ffffff;
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
