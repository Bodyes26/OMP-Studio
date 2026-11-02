<!--
  QuotaStrip.svelte — Striscia compatta dei provider in uso (Gate R48, R-REM-08).
  Mostra i soli provider usati dai rami attivi con percentuale e barra della finestra
  piu consumata. Se nessun provider e in uso mostra «Nessun provider in uso · Quote ›».
  Il tocco apre il foglio completo di tutti i provider.
-->
<script lang="ts">
	import type { RemoteQuota, RemoteProject, RemoteQuotaProvider } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import {
		getProvidersInUse,
		getWorstQuotaWindow,
		getQuotaLevel,
		normalizeProvider,
		providerDisplayName
	} from '../projectHelpers.ts';

	let {
		quota = null,
		projects = [],
		onOpenQuotaSheet
	}: {
		quota?: RemoteQuota | null;
		projects?: readonly RemoteProject[];
		onOpenQuotaSheet: () => void;
	} = $props();

	interface UsedProviderItem {
		providerId: string;
		name: string;
		pct: string;
		label: string;
		usedFraction: number;
		tone: 'ok' | 'warning' | 'exhausted';
	}

	const usedProviders = $derived.by<UsedProviderItem[]>(() => {
		if (!quota?.providers || quota.providers.length === 0) return [];
		const inUseSet = getProvidersInUse(projects);
		const list: UsedProviderItem[] = [];

		for (const qp of quota.providers) {
			const norm = normalizeProvider(qp.provider);
			if (inUseSet.has(norm)) {
				const worst = getWorstQuotaWindow(qp);
				const frac = worst?.usedFraction ?? 0;
				list.push({
					providerId: norm,
					name: providerDisplayName(qp.provider),
					pct: `${Math.round(frac * 100)}%`,
					label: worst?.label ? worst.label.toLowerCase() : '',
					usedFraction: frac,
					tone: getQuotaLevel(frac, qp.status)
				});
			}
		}

		return list;
	});
</script>

{#if usedProviders.length === 0}
	<button
		type="button"
		class="qstrip empty"
		onclick={onOpenQuotaSheet}
		data-testid="quota"
		aria-label={t('quotaNoProvidersInUse')}
	>
		<span class="qitem-empty">{t('quotaNoProvidersInUse')}</span>
	</button>
{:else}
	<button
		type="button"
		class="qstrip"
		onclick={onOpenQuotaSheet}
		data-testid="quota"
		aria-label={t('quotaStripAria')}
	>
		{#each usedProviders as item (item.providerId)}
			<span class="qitem">
				<span class="qitem-top">
					<b class="qname">{item.name}</b>
					<span class="qpct">{item.pct}</span>
					{#if item.label}
						<span class="qlabel">· {item.label}</span>
					{/if}
				</span>
				<span class="meter" aria-hidden="true">
					<i
						class="meter-fill tone-{item.tone}"
						style="width: {Math.max(4, Math.min(100, Math.round(item.usedFraction * 100)))}%"
					></i>
				</span>
			</span>
		{/each}
	</button>
{/if}

<style>
	.qstrip {
		display: flex;
		align-items: center;
		gap: 16px;
		overflow-x: auto;
		padding: 4px 0 8px;
		scrollbar-width: none;
		width: 100%;
		text-align: left;
		min-height: 44px;
		background: transparent;
		border: none;
		cursor: pointer;
		-webkit-overflow-scrolling: touch;
	}

	.qstrip::-webkit-scrollbar {
		display: none;
	}

	.qstrip.empty {
		color: var(--ink-muted);
		font-size: var(--text-sm);
	}

	.qitem-empty {
		display: inline-flex;
		align-items: center;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		padding: 4px 0;
	}

	.qitem {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 96px;
		flex-shrink: 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.qitem-top {
		display: flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
	}

	.qname {
		font-weight: 600;
		color: var(--ink);
	}

	.qpct {
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}

	.qlabel {
		color: var(--ink-muted);
	}

	.meter {
		display: block;
		height: 4px;
		border-radius: 2px;
		background: var(--line);
		overflow: hidden;
		width: 100%;
	}

	.meter-fill {
		display: block;
		height: 100%;
		border-radius: 2px;
		background: var(--brand);
		transition: width var(--dur-normal) var(--ease-out);
	}

	.meter-fill.tone-warning {
		background: var(--warn);
	}

	.meter-fill.tone-exhausted {
		background: var(--danger);
	}
</style>
