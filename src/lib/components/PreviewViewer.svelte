<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { invoke } from '@tauri-apps/api/core';
	import { wrapPrototypeCode } from '$lib/prototype/wrapper';
	import { buildSandboxedSvgDocument, isSvgFileName, isSvgContent } from '$lib/editor/svgSandbox';
	import { colorizeCode } from '$lib/agent/markdown';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import { IconCheck, IconClose, IconCopy } from '$lib/icons';
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
	// I prototipi HTML non passano da `srcdoc`: l'iframe erediterebbe la CSP
	// dell'app (script solo da 'self') e i CDN di React/Babel non caricherebbero.
	// Il server di anteprima loopback li serve con una CSP propria.
	let frameUrl = $state('');
	// L'URL resta lo stesso a ogni ripubblicazione: senza ricreare l'iframe
	// «Ricarica» mostrerebbe ancora il documento precedente.
	let publishSeq = $state(0);
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
	let fileName = $derived(filePath.split('/').pop() ?? filePath);

	const viewOptions = $derived([
		{ value: 'preview' as const, label: m.preview_mode_preview() },
		{ value: 'code' as const, label: m.preview_mode_code() }
	]);
	const deviceOptions = $derived([
		{ value: 'desktop' as const, label: m.preview_device_desktop(), ariaLabel: m.preview_device_desktop_aria() },
		{ value: 'tablet' as const, label: m.preview_device_tablet(), ariaLabel: m.preview_device_tablet_aria() },
		{ value: 'mobile' as const, label: m.preview_device_mobile(), ariaLabel: m.preview_device_mobile_aria() }
	]);

	// Vista codice: stessa evidenziazione Monaco dei blocchi della chat, ma a
	// pagina intera e senza la cornice a fisarmonica del transcript.
	let colorizedHtml = $state<string | null>(null);
	let codeLanguage = $derived.by(() => {
		if (isCurrentSvg) return 'xml';
		const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
		return ext === 'htm' ? 'html' : ext;
	});
	$effect(() => {
		if (viewMode !== 'code' || !rawContent) {
			colorizedHtml = null;
			return;
		}
		const text = rawContent;
		const lang = codeLanguage;
		let cancelled = false;
		colorizeCode(text, lang)
			.then((html) => {
				if (!cancelled) colorizedHtml = html;
			})
			.catch(() => {
				if (!cancelled) colorizedHtml = null;
			});
		return () => {
			cancelled = true;
		};
	});

	async function load() {
		loading = true;
		missing = false;
		loadError = null;
		const key = `studio-preview:${projectPath}:${filePath}`;
		try {
			const res: { content: string; exists: boolean } = await invoke('preview_file', {
				projectPath,
				rel: filePath
			});
			if (!res.exists) {
				missing = true;
				rawContent = '';
				htmlDoc = '';
				frameUrl = '';
			} else {
				rawContent = res.content;
				const title = filePath.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Prototipo';
				if (isSvgFileName(filePath) || isSvgContent(res.content)) {
					htmlDoc = buildSandboxedSvgDocument(res.content);
					frameUrl = '';
				} else {
					htmlDoc = '';
					const { url } = await invoke<{ url: string }>('studio_preview_publish', {
						key,
						html: wrapPrototypeCode(title, res.content)
					});
					frameUrl = url;
					publishSeq += 1;
				}
			}
		} catch (e) {
			// Conserviamo l'errore reale per non confondere errori di I/O con file mancante
			loadError = m.ui_previewviewer_errore_durante_il_caricamento_del_file_value1_71d5({ value1: String(e) });
			rawContent = '';
			htmlDoc = '';
			frameUrl = '';
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
			}, 1500);
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
		if (!projectPath || !filePath) return;
		const key = `studio-preview:${projectPath}:${filePath}`;
		void load();
		return () => {
			void invoke('lab_preview_unpublish', { key }).catch(() => {});
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="preview-viewer">
	<!-- Testata fusa da 32 px: prende il posto di quella della colonna (D7). -->
	<div class="preview-toolbar">
		<span class="preview-title" title={filePath}>{fileName}</span>

		<Segmented
			options={viewOptions}
			value={viewMode}
			ariaLabel={m.preview_view_mode()}
			onChange={(mode) => (viewMode = mode)}
		/>

		{#if viewMode === 'preview'}
			<Segmented
				options={deviceOptions}
				value={device}
				ariaLabel={m.preview_device_group()}
				onChange={(next) => (device = next)}
			/>
		{/if}

		<span class="toolbar-spacer"></span>

		<Tooltip text={m.ui_previewviewer_copia_il_codice_sorgente_negli_appunti_3dc5()} placement="bottom">
			<button
				type="button"
				class="ui-button ui-button-ghost"
				onclick={copyCode}
				aria-label={m.ui_previewviewer_copia_codice_sorgente_negli_appunti_360b()}
			>
				{#if copied}<IconCheck /> {m.preview_copied()}{:else}<IconCopy /> {m.context_menu_item_copy()}{/if}
			</button>
		</Tooltip>
		<Tooltip text={m.preview_reload_aria()} placement="bottom">
			<button type="button" class="ui-button ui-button-ghost" onclick={() => void load()}>
				{m.preview_reload()}
			</button>
		</Tooltip>
		<button
			type="button"
			class="icon-btn"
			onclick={() => onClose?.()}
			aria-label={m.ui_previewviewer_chiudi_anteprima_d65a()}
		><IconClose /></button>
	</div>

	{#if loading}
		<div class="center-note">
			<StatusMark status="running" />
			<span>{m.ui_previewviewer_caricamento_prototipo_a97b()}</span>
		</div>
	{:else if missing}
		<div class="center-note">{m.ui_previewviewer_file_non_trovato_952c()} {filePath}</div>
	{:else if loadError}
		<div class="center-note error" role="alert">
			<span>{loadError}</span>
			<button type="button" class="ui-button ui-button-secondary" onclick={() => void load()}>
				{m.preview_retry()}
			</button>
		</div>
	{:else if viewMode === 'code'}
		<div class="code-view">
			{#if colorizedHtml}
				<pre class="code-pre">{@html colorizedHtml}</pre>
			{:else}
				<pre class="code-pre">{rawContent}</pre>
			{/if}
		</div>
	{:else}
		<div class="preview-stage">
			<!-- sandbox isolata: per file SVG 'allow-scripts' e' severamente disabilitato (sandbox=""),
			     mentre per prototipi UI e' attivo 'allow-scripts' ma MAI 'allow-same-origin'.
			     In nessun caso l'iframe ha accesso a IPC o al DOM dell'app. -->
			{#if isCurrentSvg}
				<iframe
					class="preview-frame"
					style:width={DEVICE_WIDTHS[device]}
					sandbox=""
					title={m.preview_frame_title({ path: filePath })}
					srcdoc={htmlDoc}
				></iframe>
			{:else if frameUrl}
				{#key publishSeq}
					<iframe
						class="preview-frame"
						style:width={DEVICE_WIDTHS[device]}
						sandbox="allow-scripts"
						title={m.preview_frame_title({ path: filePath })}
						src={frameUrl}
					></iframe>
				{/key}
			{/if}
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

	/* Stessa testata dell'editor e del Task Editor: 32 px sul pozzo, linea sotto. */
	.preview-toolbar {
		height: 32px;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-1) 0 var(--space-3);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.preview-title {
		min-width: 0;
		max-width: 25ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
		font-size: var(--text-label);
		font-weight: 500;
	}

	.toolbar-spacer {
		flex: 1;
	}

	.icon-btn {
		width: 28px;
		height: 28px;
		display: inline-grid;
		place-items: center;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 14px;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.icon-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.preview-toolbar .ui-button {
		--icon-size: 12px;
		gap: var(--space-1);
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

	.code-view {
		flex: 1;
		overflow: auto;
		padding: var(--space-3) var(--space-4);
		background: var(--bg-sunken);
	}

	.code-pre {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		line-height: 1.5;
		color: var(--ink);
		white-space: pre;
		tab-size: 2;
		user-select: text;
	}

	.center-note {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		color: var(--ink-muted);
		font-size: var(--text-body);
	}

	.center-note.error {
		flex-direction: column;
		color: var(--danger);
	}
</style>
