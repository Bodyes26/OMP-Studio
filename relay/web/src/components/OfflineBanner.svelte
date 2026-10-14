<script lang="ts">
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
</script>

{#if connection.isOffline}
	<div class="offline-banner" role="status" aria-live="polite">
		<span class="offline-dot"></span>
		<span class="offline-text">{t('offlineBanner')}</span>
		<button class="retry-btn" onclick={() => connection.reconnectImmediate()}>
			{t('confirm')}
		</button>
	</div>
{/if}

<style>
	.offline-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 16px;
		background: var(--warn-bg);
		border-bottom: 1px solid color-mix(in srgb, var(--warn) 35%, transparent);
		color: var(--ink);
		font-size: 13px;
	}

	.offline-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		background: var(--warn);
		flex-shrink: 0;
	}

	.offline-text {
		flex: 1;
	}

	.retry-btn {
		padding: 4px 10px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line-strong);
		background: var(--bg-sunken);
		color: var(--ink);
		font-size: 12px;
		cursor: pointer;
		min-height: 32px;
	}
</style>
