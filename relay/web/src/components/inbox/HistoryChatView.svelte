<!--
  HistoryChatView.svelte — Vista trascrizione in sola lettura di una sessione passata.
  Recupera i messaggi con il comando session_history, supporta paginazione all'indietro,
  nessun composer e nessuna sottoscrizione WebSocket dal vivo.
-->
<script lang="ts">
	import type { HistoryChatRoute } from '../../navigation.svelte.ts';
	import type { RemoteChatMessage, RemoteChatPage } from '../../../../src/protocol.ts';
	import { t } from '../../i18n.ts';
	import { connection } from '../../connection.svelte.ts';
	import { navigation } from '../../navigation.svelte.ts';
	import Transcript from '../chat/Transcript.svelte';
	import { IconArrowLeft, IconClose } from '../../icons.ts';

	let { route }: { route: HistoryChatRoute } = $props();

	let messages = $state<RemoteChatMessage[]>([]);
	let beforeCursor = $state<string | null>(null);
	let isLoading = $state(true);
	let loadingOlder = $state(false);
	let errorMessage = $state<string | null>(null);
	let loadOlderError = $state<string | null>(null);
	let activeImageModal = $state<{ url: string; mimeType?: string } | null>(null);
	let imageDialogEl = $state<HTMLDialogElement | null>(null);

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
	const hostName = $derived(host?.name ?? 'Macchina');
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
				limit: 40
			})) as RemoteChatPage | undefined;

			if (gen !== activeGeneration) return;
			messages = res?.messages ?? [];
			beforeCursor = res?.before ?? null;
		} catch (err: unknown) {
			if (gen !== activeGeneration) return;
			errorMessage = (err as { message?: string })?.message || t('chatLoadError');
		} finally {
			if (gen === activeGeneration) {
				isLoading = false;
			}
		}
	}

	async function loadOlderMessages() {
		if (!route.sessionId || !beforeCursor || loadingOlder) return;
		const gen = activeGeneration;
		loadingOlder = true;
		loadOlderError = null;
		try {
			const res = (await connection.sendCommand(route.hostId, {
				kind: 'session_history',
				projectId: route.projectId,
				sessionId: route.sessionId,
				before: beforeCursor,
				limit: 40
			})) as RemoteChatPage | undefined;

			if (gen !== activeGeneration) return;
			const older = res?.messages ?? [];
			messages = [...older, ...messages];
			beforeCursor = res?.before ?? null;
		} catch (err: unknown) {
			if (gen !== activeGeneration) return;
			loadOlderError = (err as { message?: string })?.message || t('chatLoadOlderError');
		} finally {
			if (gen === activeGeneration) {
				loadingOlder = false;
			}
		}
	}

	$effect(() => {
		void route.hostId;
		void route.projectId;
		void route.sessionId;
		loadHistoryInitial();
	});
</script>

<div class="history-chat-view safe-top">
	<header class="chat-header">
		<button
			type="button"
			class="header-back-btn"
			onclick={() => navigation.closeChat()}
			aria-label={t('chatBack')}
			title={t('chatBack')}
		>
			<IconArrowLeft />
		</button>

		<div class="header-titles">
			<div class="header-context">
				{#if project}
					<span class="project-name">{project.name}</span>
					<span class="header-sep">/</span>
				{/if}
				<span class="header-host">{hostName}</span>
			</div>
			<div class="header-session-title">
				<span class="title-text">{route.sessionTitle || t('historyTitle')}</span>
				<span class="readonly-badge">{t('readOnlyBadge')}</span>
			</div>
		</div>
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
		background: var(--bg-base);
		position: relative;
		overflow: hidden;
	}

	.chat-header {
		display: flex;
		align-items: center;
		gap: var(--space-2, 8px);
		height: 48px;
		padding: 0 var(--space-3, 12px);
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
		flex-shrink: 0;
		z-index: var(--z-dock, 10);
	}

	.header-back-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-sunken);
		color: var(--ink);
		cursor: pointer;
		flex-shrink: 0;
	}

	.header-back-btn:hover {
		background: var(--bg-hover, var(--bg-raised));
	}

	.header-titles {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.header-context {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-mini, 11px);
		color: var(--ink-muted);
	}

	.header-sep {
		color: var(--ink-faint);
	}

	.header-session-title {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.title-text {
		font-size: var(--text-label, 13px);
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.readonly-badge {
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		font-size: var(--text-mini, 10px);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.chat-error-banner {
		padding: var(--space-2, 8px) var(--space-3, 12px);
		background: color-mix(in oklch, var(--danger) 15%, transparent);
		border-bottom: 1px solid color-mix(in oklch, var(--danger) 30%, transparent);
		color: var(--danger);
		font-size: var(--text-sm, 12px);
		text-align: center;
	}

	.chat-error-banner.warn {
		background: color-mix(in oklch, var(--warn) 15%, transparent);
		border-bottom: 1px solid color-mix(in oklch, var(--warn) 30%, transparent);
		color: var(--warn);
	}
	.chat-main {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		position: relative;
		overflow: hidden;
	}

	.loading-state {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--line);
		border-top-color: var(--brand);
		border-radius: var(--radius-full);
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.history-footer {
		border-top: 1px solid var(--line);
		background: var(--bg-sunken);
		padding: var(--space-3, 12px);
		flex-shrink: 0;
	}

	.footer-inner {
		max-width: 720px;
		margin: 0 auto;
		width: 100%;
	}

	.readonly-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: var(--radius-lg);
		background: var(--bg-base);
		border: 1px dashed var(--line);
		font-size: var(--text-caption, 12px);
		color: var(--ink-muted);
	}

	.readonly-tag {
		font-weight: 600;
		color: var(--ink);
	}

	.image-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 300;
		background: rgba(0, 0, 0, 0.8);
		border: none;
		padding: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		max-width: none;
		max-height: none;
	}

	.image-modal-img {
		max-width: 90vw;
		max-height: 85vh;
		object-fit: contain;
		border-radius: var(--radius-md);
	}

	.image-modal-close {
		position: absolute;
		top: 16px;
		right: 16px;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-full);
		background: rgba(255, 255, 255, 0.2);
		color: #ffffff;
		border: none;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
</style>
