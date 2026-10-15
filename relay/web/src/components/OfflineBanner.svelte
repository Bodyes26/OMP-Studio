<!--
  OfflineBanner.svelte — Avviso di disconnessione nel linguaggio Studio.
  Nessuna striscia gialla a tutta larghezza: un badge discreto su bg-raised,
  bordato, con icona di attenzione e azione rapida di riconnessione.
-->
<script lang="ts">
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { IconOffline, IconRefresh } from '../icons.ts';
</script>

{#if connection.isOffline}
	<div class="offline-wrap" role="status" aria-live="polite">
		<div class="offline-notice rv-lift">
			<span class="icon-slot" aria-hidden="true"><IconOffline /></span>
			<span class="offline-text">{t('offlineBanner')}</span>
			<button
				type="button"
				class="ui-button ui-button-secondary retry-btn"
				onclick={() => connection.reconnectImmediate()}
			>
				<IconRefresh />
				<span>{t('retrySync')}</span>
			</button>
		</div>
	</div>
{/if}

<style>
	.offline-wrap {
		padding: var(--space-2) var(--space-4);
		display: flex;
		justify-content: center;
		position: sticky;
		top: 44px;
		z-index: 90;
		pointer-events: none;
	}

	.offline-notice {
		pointer-events: auto;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px 12px;
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-full);
		box-shadow: var(--shadow-dock);
		color: var(--ink);
		font-size: var(--text-caption);
		max-width: 100%;
	}

	.icon-slot {
		display: inline-flex;
		color: var(--warn);
		--icon-size: 14px;
		flex-shrink: 0;
	}

	.offline-text {
		color: var(--ink-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.retry-btn {
		height: 24px;
		padding: 0 8px;
		font-size: var(--text-meta);
		border-radius: var(--radius-full);
		flex-shrink: 0;
		gap: 4px;
		--icon-size: 12px;
	}
</style>
