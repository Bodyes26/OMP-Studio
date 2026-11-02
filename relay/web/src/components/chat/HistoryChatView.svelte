<!--
  HistoryChatView.svelte — Vista trascrizione in sola lettura di una sessione passata (Gate R48, R-REM-15).
  Recupera i messaggi con il comando session_history, supporta paginazione all'indietro,
  nessun composer e nessuna sottoscrizione WebSocket dal vivo.
-->
<script lang="ts">
	import type { HistoryChatRoute } from '../../navigation.svelte.ts';
	import type { RemoteChatMessage, RemoteChatPage } from '../../../../src/protocol.ts';
	import { t } from '../../i18n.ts';
	import { connection } from '../../connection.svelte.ts';
	import { navigation } from '../../navigation.svelte.ts';
	import Transcript from './Transcript.svelte';
	import { IconClose } from '../../icons.ts';
	import { PreviewStore, setPreviewContext } from '../../preview.svelte.ts';
	import PreviewSurface from './PreviewSurface.svelte';

	let { route }: { route: HistoryChatRoute } = $props();

	let messages = $state<RemoteChatMessage[]>([]);
	let beforeCursor = $state<string | null>(null);
	let isLoading = $state(true);
	let loadingOlder = $state(false);
	let errorMessage = $state<string | null>(null);
	let loadOlderError = $state<string | null>(null);
	let activeImageModal = $state<{ url: string; mimeType?: string } | null>(null);
	let imageDialogEl = $state<HTMLDialogElement | null>(null);
	let expandPreview = $state(false);

	const preview = new PreviewStore();
	setPreviewContext(preview);

	$effect(() => {
		preview.setRouteContext({
			hostId: route.hostId,
			projectId: route.projectId,
			laneId: null,
			isHistory: true
		});
	});

	$effect(() => () => preview.destroy());

	// Contatore di generazione per proteggere dai ritorni asincroni stantii
	let activeGeneration = 0;

	$effect(() => {
		if (imageDialogEl && !imageDialogEl.open) imageDialogEl.showModal();
	});

	function openImageModal(url: string, mimeType?: string) {
		activeImageModal = { url, mimeType };
	}

	function closeImageModal() {
		activeImageModal = null;
	}

	const host = $derived(connection.hosts.find((h) => h.id === route.hostId));
	const hostState = $derived(connection.hostStates[route.hostId]?.state);
	const project = $derived(
		hostState?.projects.find((p) => p.id === route.projectId)
	);

	async function loadHistoryInitial() {
		const gen = ++activeGeneration;
		messages = [];
		beforeCursor = null;
		isLoading = true;
		errorMessage = null;
		loadOlderError = null;

		try {
			const res = (await connection.sendCommand(route.hostId, {
				kind: 'session_history',
				projectId: route.projectId,
				sessionId: route.sessionId,
				before: null,
				limit: 50
			})) as RemoteChatPage | undefined;

			if (gen !== activeGeneration) return;

			if (res && Array.isArray(res.messages)) {
				messages = res.messages;
				beforeCursor = res.before ?? null;
			}
		} catch (err) {
			if (gen !== activeGeneration) return;
			errorMessage = (err as Error)?.message || t('historyLoadError');
		} finally {
			if (gen === activeGeneration) {
				isLoading = false;
			}
		}
	}

	async function loadOlderMessages() {
		if (!beforeCursor || loadingOlder) return;
		const gen = activeGeneration;
		loadingOlder = true;
		loadOlderError = null;

		try {
			const res = (await connection.sendCommand(route.hostId, {
				kind: 'session_history',
				projectId: route.projectId,
				sessionId: route.sessionId,
				before: beforeCursor,
				limit: 50
			})) as RemoteChatPage | undefined;

			if (gen !== activeGeneration) return;

			if (res && Array.isArray(res.messages)) {
				messages = [...res.messages, ...messages];
				beforeCursor = res.before ?? null;
			}
		} catch (err) {
			if (gen !== activeGeneration) return;
			loadOlderError = (err as Error)?.message || t('chatLoadOlderError');
		} finally {
			if (gen === activeGeneration) {
				loadingOlder = false;
			}
		}
	}

	$effect(() => {
		if (connection.status === 'connected') {
			void loadHistoryInitial();
		}
	});
</script>

<div class="history-chat-view safe-top">
	<!-- Barra superiore a riga singola (allineata a ChatView) -->
	<header class="chat-bar">
		<button
			type="button"
			class="icon-btn"
			onclick={() => navigation.closeChat()}
			aria-label={t('close')}
			title={t('close')}
		>
			<IconClose />
		</button>

		<div class="bar-title">
			<strong class="project-title-text">{project?.name ?? ''}</strong>
			<span class="session-title-text">
				{route.sessionTitle || t('historyTitle')} · {t('readOnlyBadge')}
			</span>
		</div>

		<div class="bar-spacer" aria-hidden="true"></div>
	</header>

	{#if errorMessage}
		<div class="chat-error-banner" role="alert">
			<span>{errorMessage}</span>
		</div>
	{/if}

	{#if loadOlderError}
		<div class="chat-error-banner warn" role="alert">
			<span>{loadOlderError}</span>
		</div>
	{/if}

	<div class="history-content-split" class:expanded={expandPreview && preview.isOpen}>
		<div class="history-stream-column">
			<main class="chat-main">
				{#if isLoading}
					<div class="loading-state">
						<div class="spinner"></div>
					</div>
				{:else}
					<Transcript
						{messages}
						{loadingOlder}
						hasOlder={Boolean(beforeCursor)}
						onLoadOlder={loadOlderMessages}
						isWorking={false}
						onOpenImage={openImageModal}
						hostFeatures={host?.features ?? []}
						hostId={route.hostId}
						projectId={route.projectId}
						laneId={null}
						isHistory={true}
					/>
				{/if}
			</main>

			<!-- Footer in sola lettura: nessun composer -->
			<footer class="history-footer safe-bottom">
				<div class="footer-inner readable">
					<div class="readonly-banner">
						<span class="readonly-tag">{t('readOnlyBadge')}</span>
						<span class="readonly-desc">{t('archivedSessionBanner')}</span>
					</div>
				</div>
			</footer>
		</div>

		<PreviewSurface
			{preview}
			{expandPreview}
			onToggleExpand={() => (expandPreview = !expandPreview)}
		/>
	</div>

	{#if activeImageModal}
		<dialog
			bind:this={imageDialogEl}
			class="image-modal-backdrop"
			aria-label={t('chatImageCountSingular')}
			onclick={(e) => { if (e.target === e.currentTarget) closeImageModal(); }}
			onclose={closeImageModal}
			oncancel={closeImageModal}
		>
			<button type="button" class="image-modal-close" onclick={closeImageModal} aria-label={t('close')}>
				<IconClose />
			</button>
			<img src={activeImageModal.url} alt={t('chatImageCountSingular')} class="image-modal-img" />
		</dialog>
	{/if}
</div>

<style>
	.history-chat-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--bg-sunken);
		position: relative;
		overflow: hidden;
	}

	.chat-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		min-height: 48px;
		flex-shrink: 0;
		gap: 8px;
	}

	.icon-btn {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		transition: color var(--dur-fast), background var(--dur-fast);
	}

	.icon-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.bar-title {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		flex: 1;
		min-width: 0;
	}

	.project-title-text {
		font-size: 15px;
		font-weight: 650;
		color: var(--ink);
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}

	.session-title-text {
		font-size: 12px;
		color: var(--ink-muted);
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}

	.bar-spacer {
		width: 44px;
		height: 44px;
	}

	.history-content-split {
		flex: 1;
		min-height: 0;
		display: flex;
		overflow: hidden;
		position: relative;
	}

	.history-stream-column {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	/* Come nella chat dal vivo: l'anteprima si affianca solo quando e' aperta. */
	@media (min-width: 1024px) {
		.history-content-split.expanded .history-stream-column {
			display: none;
		}
	}

	.chat-main {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.loading-state {
		flex: 1;
		display: grid;
		place-items: center;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--line);
		border-top-color: var(--brand);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.chat-error-banner {
		padding: 8px 16px;
		background: color-mix(in oklch, var(--danger) 12%, transparent);
		color: var(--danger);
		font-size: var(--text-xs);
		border-bottom: 1px solid color-mix(in oklch, var(--danger) 25%, transparent);
	}

	.chat-error-banner.warn {
		background: color-mix(in oklch, var(--warn) 12%, transparent);
		color: var(--warn);
		border-bottom-color: color-mix(in oklch, var(--warn) 25%, transparent);
	}

	.history-footer {
		background: var(--bg-raised);
		border-top: 1px solid var(--line);
		padding: 10px 16px;
	}

	.footer-inner.readable {
		max-width: 720px;
		margin: 0 auto;
	}

	.readonly-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.readonly-tag {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-weight: 600;
	}

	.image-modal-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in oklch, var(--ink) 80%, transparent);
		border: none;
		padding: 0;
		margin: 0;
		width: 100vw;
		height: 100vh;
		display: grid;
		place-items: center;
		z-index: 100;
	}

	.image-modal-close {
		position: absolute;
		top: 16px;
		right: 16px;
		background: transparent;
		border: none;
		color: #fff;
		cursor: pointer;
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
	}

	.image-modal-img {
		max-width: 90vw;
		max-height: 90vh;
		object-fit: contain;
		border-radius: var(--radius-md);
	}
</style>
