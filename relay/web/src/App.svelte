<!--
  App.svelte — Radice della PWA Studio Remote.
  Layout a una colonna centrato (mobile o senza chat) oppure a due colonne
  (su desktop >= 960px con chat aperta: dashboard a sinistra, chat a destra).
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
	import { initNotificationRouting } from './notificationRouting.ts';
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

	const hasChat = $derived(Boolean(navigation.chat));
</script>

<div class="app-layout" class:has-chat={hasChat}>
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
	</div>

	{#if navigation.chat}
		<div class="chat-pane" role="region" aria-label={navigation.chat.laneId}>
			<ChatView route={navigation.chat} />
		</div>
	{/if}
</div>

<style>
	.app-layout {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
		position: relative;
	}

	.shell-content {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		flex: 1;
	}

	.main-content {
		flex: 1;
		display: flex;
		flex-direction: column;
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

	/* Su mobile (<960px): .chat-pane e' a tutto schermo in overlay fisso */
	.chat-pane {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: var(--bg-base);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* Su desktop (>=960px): layout a due colonne quando la chat e' aperta */
	@media (min-width: 960px) {
		.app-layout.has-chat {
			display: grid;
			grid-template-columns: 380px 1fr;
			height: 100vh;
			overflow: hidden;
		}

		.app-layout.has-chat .shell-content {
			height: 100vh;
			min-height: 0;
			overflow-y: auto;
			border-right: 1px solid var(--line);
		}

		.app-layout.has-chat .chat-pane {
			position: relative;
			inset: auto;
			z-index: 1;
			height: 100vh;
			overflow: hidden;
		}
	}
</style>
