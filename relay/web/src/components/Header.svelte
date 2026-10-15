<!--
  Header.svelte — Barra superiore della PWA allineata alla TopBar di Studio.
  BrandMark geometrico, titolo dell'app, chip remoto e pulsante impostazioni.
-->
<script lang="ts">
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { IconSettings, IconRemote } from '../icons.ts';
	import BrandMark from './BrandMark.svelte';

	let { onOpenSettings } = $props<{ onOpenSettings: () => void }>();

	const onlineCount = $derived(
		connection.hosts.filter((h) => h.online).length
	);

	const statusLabel = $derived.by(() => {
		if (connection.status === 'connected') {
			if (onlineCount > 0) {
				return onlineCount === 1 ? t('machinesCountOne') : t('machinesCount', { count: onlineCount });
			}
			return t('online');
		}
		if (connection.status === 'connecting') return '...';
		return t('offline');
	});
</script>

<header class="header safe-top">
	<div class="brand">
		<BrandMark class="brand-logo" />
		<span class="app-title">{t('shortTitle')}</span>
	</div>

	<div class="actions">
		<div
			class="remote-chip"
			class:connected={connection.status === 'connected'}
			class:connecting={connection.status === 'connecting'}
			title={statusLabel}
		>
			<IconRemote />
			<span class="chip-label">{statusLabel}</span>
		</div>

		{#if connection.status !== 'unpaired' && connection.status !== 'checking'}
			<button
				type="button"
				class="settings-btn"
				onclick={onOpenSettings}
				aria-label={t('settings')}
			>
				<IconSettings />
			</button>
		{/if}
	</div>
</header>

<style>
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 44px;
		padding: 0 var(--space-4);
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
		position: sticky;
		top: 0;
		z-index: 100;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--ink);
	}

	:global(.brand-logo) {
		width: 20px;
		height: 17px;
		color: var(--ink);
	}

	.app-title {
		font-size: var(--text-label);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--ink);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.remote-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 10px;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink-muted);
		font-size: var(--text-caption);
		--icon-size: 13px;
	}

	.remote-chip.connected {
		color: var(--ink);
	}

	.remote-chip.connecting {
		color: var(--warn);
		border-color: color-mix(in oklab, var(--warn) 30%, var(--line));
	}

	.chip-label {
		font-variant-numeric: tabular-nums;
	}

	.settings-btn {
		display: inline-grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 16px;
		transition: background-color var(--dur-fast) var(--ease-out),
		            color var(--dur-fast) var(--ease-out),
		            border-color var(--dur-fast) var(--ease-out);
	}

	.settings-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	@media (pointer: coarse) {
		.settings-btn {
			width: 40px;
			height: 40px;
		}
	}
</style>
