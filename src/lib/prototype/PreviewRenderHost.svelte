<script lang="ts">
	// Render host nascosto per l'anteprima dei prototipi UI (ANT-009, ANT-010).
	//
	// Montato incondizionatamente in +page.svelte (desktop app), resta attivo
	// indipendentemente dalla superficie o corsia correntemente selezionata.
	// Ascolta `preview://new`, accoda le richieste in modo sequenziale, renderizza
	// ciascun prototipo in un iframe isolato fuori schermo (sandbox="allow-scripts")
	// con l'harness di monitoraggio iniettato, attende l'esito (o il timeout) e scrive
	// atomicamente il file di ack `<id>.ack.json` prima di passare alla richiesta successiva.

	import { onMount, onDestroy } from 'svelte';
	import { invoke, isTauri } from '@tauri-apps/api/core';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { wrapPrototypeCode } from '#lib/prototype/wrapper.ts';
	import type { LanePreviewPayload } from '#lib/agent/laneSurfaces.ts';
	import { buildPreviewHarnessScript, injectPreviewHarness } from './harness.ts';
	import { m } from '#lib/paraglide/messages.js';

	interface QueueItem {
		id: string;
		title: string;
		file_path: string;
		cwd: string;
		snapshot?: boolean;
	}

	interface GitRevContent {
		content: string;
		exists: boolean;
	}

	let queue: QueueItem[] = [];
	let processing = false;
	let currentItem = $state<QueueItem | null>(null);
	let currentFrameUrl = $state('');
	let iframeEl = $state<HTMLIFrameElement | null>(null);
	let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
	let unlistenPreview: UnlistenFn | null = null;

	function enqueue(payload: LanePreviewPayload) {
		if (!payload || !payload.id || !payload.file_path) return;
		queue.push({
			id: payload.id,
			title: payload.title || m.l10n_lab_remote_preview_default_title(),
			file_path: payload.file_path,
			cwd: payload.cwd || '',
			snapshot: payload.snapshot
		});
		void processNext();
	}

	async function processNext() {
		if (processing || queue.length === 0) return;
		processing = true;

		const item = queue.shift()!;
		currentItem = item;

		// Resta sotto l'attesa dello strumento (8s, 15s con snapshot): allo scadere non si
		// scrive alcun ack, cosi' l'agente riceve "non confermato" e non un falso errore
		// del suo codice quando la rete o le CDN sono lente.
		const timeoutMs = item.snapshot ? 14000 : 7000;
		timeoutTimer = setTimeout(() => {
			if (currentItem?.id === item.id) cleanupAndNext();
		}, timeoutMs);

		const publishKey = `studio-render-host:${item.id}`;

		try {
			const rev = await invoke<GitRevContent>('preview_file', {
				projectPath: item.cwd,
				rel: item.file_path
			});

			if (!rev || !rev.exists || !rev.content.trim()) {
				await writeAck(item.id, {
					version: 1,
					id: item.id,
					ok: false,
					errors: [
						{ message: m.l10n_lab_remote_render_file_missing({ path: item.file_path }) }
					],
					width: 0,
					height: 0
				});
				cleanupAndNext();
				return;
			}

			const wrapped = wrapPrototypeCode(item.title, rev.content);
			const harness = buildPreviewHarnessScript(item.id, Boolean(item.snapshot));
			const injected = injectPreviewHarness(wrapped, harness);

			const { url } = await invoke<{ url: string }>('studio_preview_publish', {
				key: publishKey,
				html: injected
			});

			currentFrameUrl = url;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			await writeAck(item.id, {
				version: 1,
				id: item.id,
				ok: false,
				errors: [
					{ message: m.l10n_lab_remote_render_publish_failed({ error: msg }) }
				],
				width: 0,
				height: 0
			});
			cleanupAndNext();
		}
	}

	function cleanupAndNext() {
		if (timeoutTimer) {
			clearTimeout(timeoutTimer);
			timeoutTimer = null;
		}
		const staleItem = currentItem;
		currentItem = null;
		currentFrameUrl = '';

		if (staleItem) {
			const key = `studio-render-host:${staleItem.id}`;
			void invoke('lab_preview_unpublish', { key }).catch(() => {});
		}

		setTimeout(() => {
			processing = false;
			void processNext();
		}, 50);
	}

	async function writeAck(id: string, ack: unknown) {
		try {
			await invoke('studio_preview_ack', { id, ack });
		} catch (err) {
			console.error('[PreviewRenderHost] Scrittura file ack fallita:', err);
		}
	}

	function handleWindowMessage(event: MessageEvent) {
		if (!currentItem || !iframeEl) return;
		if (event.source !== iframeEl.contentWindow) return;
		const data = event.data;
		if (!data || typeof data !== 'object') return;
		if (data.type !== 'studio-preview-ack' || data.id !== currentItem.id) return;

		if (timeoutTimer) {
			clearTimeout(timeoutTimer);
			timeoutTimer = null;
		}

		void writeAck(currentItem.id, data).then(() => {
			cleanupAndNext();
		});
	}

	onMount(() => {
		if (!isTauri()) return;

		window.addEventListener('message', handleWindowMessage);

		void listen<LanePreviewPayload>('preview://new', (e) => {
			if (e.payload) {
				enqueue(e.payload);
			}
		}).then((un) => {
			unlistenPreview = un;
		});
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('message', handleWindowMessage);
		}
		if (unlistenPreview) {
			unlistenPreview();
			unlistenPreview = null;
		}
		if (timeoutTimer) {
			clearTimeout(timeoutTimer);
			timeoutTimer = null;
		}
		if (currentItem) {
			const key = `studio-render-host:${currentItem.id}`;
			void invoke('lab_preview_unpublish', { key }).catch(() => {});
			currentItem = null;
		}
	});
</script>

{#if currentFrameUrl}
	<!-- Dentro il viewport ma trasparente: Chromium sospende il rendering degli iframe
	     cross-origin fuori schermo e la cattura dello snapshot non terminerebbe mai. -->
	<iframe
		bind:this={iframeEl}
		src={currentFrameUrl}
		sandbox="allow-scripts"
		tabindex="-1"
		aria-hidden="true"
		title={m.l10n_lab_remote_render_host_title()}
		style="position: fixed; left: 0; top: 0; width: 1280px; height: 800px; opacity: 0; pointer-events: none; z-index: -1; border: 0;"
	></iframe>
{/if}
