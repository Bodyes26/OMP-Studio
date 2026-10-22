<!--
  App.svelte — Radice della PWA Studio Remote (Fleet Hub).
  Layout a due colonne persistente su desktop (>=960px) solo quando abbinato:
  lista persistente a sinistra (390px), chat o riepilogo vuoto (FleetOverview) a destra.
  In stato non abbinato o verifica: layout a colonna piena centrato senza controlli macchina.
  Su mobile (<960px): lista o chat a tutto schermo con tasto Indietro nativo del browser preservato.
-->
<script lang="ts">
	import './app.css';
	import { connection } from './connection.svelte.ts';
	import { navigation } from './navigation.svelte.ts';
	import Header from './components/Header.svelte';
	import OfflineBanner from './components/OfflineBanner.svelte';
	import PairingView from './components/PairingView.svelte';
	import Dashboard from './components/Dashboard.svelte';
	import SettingsSheet from './components/SettingsSheet.svelte';
	import ChatView from './components/chat/ChatView.svelte';
	import HistoryChatView from './components/inbox/HistoryChatView.svelte';
	import FleetOverview from './components/inbox/FleetOverview.svelte';
	import NewChatModal from './components/inbox/NewChatModal.svelte';
	import { initNotificationRouting } from './notificationRouting.ts';
	import { applyTheme, pickTheme } from './theme.ts';

	let showSettings = $state(false);
	let showNewChatModal = $state(false);
	let newChatHostId = $state<string | undefined>(undefined);
	let newChatProjectId = $state<string | undefined>(undefined);

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

	const hasChat = $derived(Boolean(navigation.chat));
	const isPaired = $derived(connection.status !== 'unpaired' && connection.status !== 'checking');

	function handleStartNewChat(hostId?: string, projectId?: string) {
		newChatHostId = hostId;
		newChatProjectId = projectId;
		showNewChatModal = true;
	}
</script>

<div class="app-layout" class:has-chat={hasChat} class:is-paired={isPaired}>
	<div class="shell-content">
		<Header onOpenSettings={() => (showSettings = true)} />
		<OfflineBanner />

		<main class="main-content">
			{#if connection.status === 'checking'}
				<div class="checking-state">
					<div class="spinner"></div>
				</div>
			{:else if connection.status === 'unpaired'}
				<PairingView />
			{:else}
				<Dashboard onOpenSettings={() => (showSettings = true)} />
			{/if}
		</main>

		{#if showSettings}
			<SettingsSheet onClose={() => (showSettings = false)} />
		{/if}

		{#if showNewChatModal}
			<NewChatModal
				initialHostId={newChatHostId}
				initialProjectId={newChatProjectId}
				onClose={() => {
					showNewChatModal = false;
					newChatHostId = undefined;
					newChatProjectId = undefined;
				}}
			/>
		{/if}
	</div>

	<!-- Area destra: Chat attiva, Trascrizione storica o Riepilogo macchine (SOLO quando abbinato) -->
	{#if isPaired}
		{#if navigation.chat}
			<div
				class="chat-pane"
				role="region"
				aria-label={navigation.chat.isHistory ? (navigation.chat.sessionTitle || 'Cronologia') : navigation.chat.laneId}
			>
				{#if navigation.chat.isHistory}
					<HistoryChatView route={navigation.chat} />
				{:else}
					{#key `${navigation.chat.hostId}:${navigation.chat.projectId}:${navigation.chat.laneId}`}
						<ChatView route={navigation.chat} />
					{/key}
				{/if}
			</div>
		{:else}
			<div class="desktop-right-pane" role="region" aria-label="Riepilogo macchine">
				<FleetOverview onStartNewChat={handleStartNewChat} />
			</div>
		{/if}
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

	.shell-content {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		min-height: 100dvh;
		flex: 1;
	}

	.app-layout.is-paired .shell-content {
		height: 100vh;
		height: 100dvh;
		min-height: 0;
		overflow: hidden;
	}

	.main-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.app-layout.is-paired .main-content {
		overflow: hidden;
	}

	.app-layout:not(.is-paired) .shell-content,
	.app-layout:not(.is-paired) .main-content {
		overflow-y: auto;
		height: auto;
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

	/* Su mobile (<960px): riepilogo desktop nascosto */
	.desktop-right-pane {
		display: none;
	}

	/* Su mobile (<960px): .chat-pane e' a tutto schermo in overlay fisso */
	.chat-pane {
		position: fixed;
		inset: var(--app-top, 0px) 0 auto 0;
		z-index: 100;
		background: var(--bg-base);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		height: 100vh;
		height: var(--app-height, 100dvh);
	}
	/* Su desktop (>=960px): SEMPRE a due colonne SOLO quando is-paired */
	@media (min-width: 960px) {
		.app-layout.is-paired {
			display: grid;
			grid-template-columns: 390px 1fr;
			height: 100vh;
			overflow: hidden;
		}

		.app-layout.is-paired .shell-content {
			height: 100vh;
			min-height: 0;
			overflow-y: hidden;
			border-right: 1px solid var(--line);
		}

		.desktop-right-pane {
			display: flex;
			position: relative;
			height: 100vh;
			overflow: hidden;
			z-index: 1;
		}

		.chat-pane {
			position: relative;
			inset: auto;
			z-index: 1;
			height: 100vh;
			overflow: hidden;
		}
	}
</style>
