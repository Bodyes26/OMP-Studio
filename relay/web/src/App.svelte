<!--
  App.svelte — Radice della PWA Studio Remote (Gate R48).

  Telefono: la pagina dei progetti resta sempre montata e la chat la copre a
  tutto schermo, cosi' chiudendola ritrovi l'elenco e l'espansione come li
  avevi lasciati (R-REM-04). Da 1024px l'elenco resta a sinistra e la chat a
  destra (R-REM-14). Nuovo lavoro e Lavoro in coda vivono in un unico foglio
  montato qui, raggiungibile da pagina iniziale, espansione e chat.
-->
<script lang="ts">
	import './app.css';
	import { connection } from './connection.svelte.ts';
	import { navigation } from './navigation.svelte.ts';
	import { t } from './i18n.ts';
	import OfflineBanner from './components/OfflineBanner.svelte';
	import PairingView from './components/PairingView.svelte';
	import HomeView from './components/HomeView.svelte';
	import SettingsSheet from './components/SettingsSheet.svelte';
	import ChatView from './components/chat/ChatView.svelte';
	import HistoryChatView from './components/chat/HistoryChatView.svelte';
	import WorkSheet from './components/work/WorkSheet.svelte';
	import { initNotificationRouting } from './notificationRouting.ts';
	import { chatTransition } from './motion.ts';
	import { applyTheme, pickTheme } from './theme.ts';

	let showSettings = $state(false);

	$effect(() => {
		connection.init();
		initNotificationRouting();
	});

	$effect(() => {
		if (connection.status === 'unpaired') {
			applyTheme(null);
			return;
		}
		const theme = pickTheme(connection.hosts, connection.hostStates);
		if (theme) applyTheme(theme);
	});

	const isPaired = $derived(connection.status !== 'unpaired' && connection.status !== 'checking');
	const chatRoute = $derived(isPaired ? navigation.chat : null);
</script>

<div class="app-layout" class:is-paired={isPaired} class:has-chat={Boolean(chatRoute)}>
	<div class="status-bar-backdrop" aria-hidden="true"></div>

	<div class="list-pane">
		<OfflineBanner />
		<div class="list-body">
			{#if connection.status === 'checking'}
				<div class="checking-state">
					<div class="spinner"></div>
				</div>
			{:else if connection.status === 'unpaired'}
				<PairingView />
			{:else}
				<HomeView onOpenSettings={() => (showSettings = true)} />
			{/if}
		</div>
	</div>

	{#if isPaired}
		{#if chatRoute}
			<div class="chat-pane" transition:chatTransition role="region" aria-label={t('chatRegion')}>
				{#if chatRoute.isHistory}
					{#key `${chatRoute.hostId}:${chatRoute.projectId}:${chatRoute.sessionId}`}
						<HistoryChatView route={chatRoute} />
					{/key}
				{:else}
					{#key `${chatRoute.hostId}:${chatRoute.projectId}:${chatRoute.laneId}`}
						<ChatView route={chatRoute} />
					{/key}
				{/if}
			</div>
		{:else}
			<div class="empty-pane" aria-hidden="true">
				<p>{t('chatEmptyWide')}</p>
			</div>
		{/if}

		<WorkSheet />
	{/if}

	{#if showSettings}
		<SettingsSheet onClose={() => (showSettings = false)} />
	{/if}
</div>

<style>
	.app-layout {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		position: relative;
	}

	.app-layout.is-paired {
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
	}

	/* App installata: `100dvh` esclude le aree sicure (WebKit 254868) e lascia
	   una fascia vuota in fondo; viewport.ts misura l'altezza vera, che come
	   `100dvh` non segue la tastiera. */
	:global(:root[data-standalone]) .app-layout.is-paired {
		height: var(--app-layout-height, 100dvh);
	}

	/*
	 * App installata: senza un elemento fisso a tutta larghezza in cima, iOS
	 * sfuma la barra di stato con una sfocatura che scende sotto l'area sicura e
	 * copre intestazione e pulsanti. Con questa fascia la barra prende il colore
	 * pieno del fondo (basta che sia alta almeno 6px, larga oltre l'80% e a meno
	 * di 4px dal bordo).
	 */
	.status-bar-backdrop {
		display: none;
	}
	:global(:root[data-standalone]) .status-bar-backdrop {
		display: block;
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: max(6px, env(safe-area-inset-top, 0px));
		background: var(--bg-sunken);
		z-index: 150;
		pointer-events: none;
	}

	.list-pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}

	.list-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.app-layout.is-paired .list-pane,
	.app-layout.is-paired .list-body {
		overflow: hidden;
	}

	.app-layout:not(.is-paired) .list-body {
		overflow-y: auto;
	}

	.checking-state {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 300px;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--line);
		border-top-color: var(--brand);
		border-radius: var(--radius-full);
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Telefono: la chat copre l'elenco, che resta montato sotto. */
	.chat-pane {
		position: fixed;
		inset: var(--app-top, 0px) 0 auto 0;
		z-index: 100;
		background: var(--bg-sunken);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		height: 100vh;
		height: var(--app-height, 100dvh);
	}

	.empty-pane {
		display: none;
	}

	@media (min-width: 1024px) {
		.app-layout.is-paired {
			display: grid;
			grid-template-columns: minmax(340px, 400px) minmax(0, 1fr);
		}

		.app-layout.is-paired .list-pane {
			border-right: 1px solid var(--line);
		}

		.chat-pane {
			position: relative;
			inset: auto;
			z-index: 1;
			height: 100%;
		}

		.empty-pane {
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 32px;
			color: var(--ink-muted);
			font-size: var(--text-label);
			text-align: center;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 2s;
		}
	}
</style>
