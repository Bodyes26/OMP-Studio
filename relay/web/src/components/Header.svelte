<script lang="ts">
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';

	let { onOpenSettings } = $props<{ onOpenSettings: () => void }>();

	const statusLabel = $derived.by(() => {
		if (connection.status === 'connected') return t('online');
		if (connection.status === 'connecting') return '...';
		return t('offline');
	});
</script>

<header class="header safe-top">
	<div class="brand">
		<div class="logo-mark">π</div>
		<div class="title-group">
			<h1 class="app-title">{t('appTitle')}</h1>
			<div class="status-indicator">
				<span class="status-dot" class:online={connection.status === 'connected'} class:connecting={connection.status === 'connecting'}></span>
				<span class="status-text">{statusLabel}</span>
			</div>
		</div>
	</div>

	{#if connection.status !== 'unpaired' && connection.status !== 'checking'}
		<button class="settings-btn" onclick={onOpenSettings} aria-label={t('settings')}>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="3"></circle>
				<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
			</svg>
		</button>
	{/if}
</header>

<style>
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		background: var(--bg-base);
		border-bottom: 1px solid var(--line);
		position: sticky;
		top: 0;
		z-index: 100;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.logo-mark {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 16px;
		color: var(--brand);
	}

	.title-group {
		display: flex;
		flex-direction: column;
	}

	.app-title {
		font-size: 15px;
		font-weight: 650;
		color: var(--ink);
		line-height: 1.2;
	}

	.status-indicator {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--ink-faint);
	}

	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
	}
	.status-dot.online {
		background: var(--success);
	}
	.status-dot.connecting {
		background: var(--warn);
	}

	.settings-btn {
		width: 44px;
		height: 44px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-raised);
		color: var(--ink);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.settings-btn:hover {
		background: var(--bg-hover);
	}
</style>
