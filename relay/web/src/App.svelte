<script lang="ts">
	import './app.css';
	import { connection } from './connection.svelte.ts';
	import Header from './components/Header.svelte';
	import OfflineBanner from './components/OfflineBanner.svelte';
	import PairingView from './components/PairingView.svelte';
	import Dashboard from './components/Dashboard.svelte';
	import SettingsSheet from './components/SettingsSheet.svelte';

	let showSettings = $state(false);

	$effect(() => {
		connection.init();
	});
</script>

<div class="app-layout">
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

<style>
	.app-layout {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--bg-sunken);
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
</style>
