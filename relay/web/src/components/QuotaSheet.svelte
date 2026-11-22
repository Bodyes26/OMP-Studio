<!--
  QuotaSheet.svelte — Foglio di dettaglio delle quote, una sezione per macchina (R-REM-08, R-REM-23).
  Ogni macchina ha i suoi provider e i suoi account: il foglio li divide, cosi'
  un ramo del PC non mostra le quote del Mac. Chi apre il foglio da una chat
  vede la sezione di quella macchina per prima.
-->
<script lang="ts">
	import type { RemoteQuota, RemoteProject, RemoteQuotaProvider } from '../../../src/protocol.ts';
	import { t, getFormatLocale } from '../i18n.ts';
	import { formatHHMM } from '../schedule.ts';
	import { connection } from '../connection.svelte.ts';
	import { IconClose, IconRefresh, ProviderLogo } from '../icons.ts';
	import {
		getProvidersInUse,
		getQuotaLevel,
		getLaneStatus,
		normalizeProvider,
		providerDisplayName,
		laneLabel
	} from '../projectHelpers.ts';
	import { scrim, bottomSheet } from '../motion.ts';
	import MachineGlyph from './MachineGlyph.svelte';
	import type { QuotaSection } from '../multiMachine.ts';

	let {
		sections,
		highlightHostId = null,
		onClose
	}: {
		sections: QuotaSection[];
		/** Macchina della chat aperta: la sua sezione va per prima. */
		highlightHostId?: string | null;
		onClose: () => void;
	} = $props();

	let isRefreshing = $state(false);
	let refreshMessage = $state<string | null>(null);
	let refreshingHostId = $state<string | null>(null);

	const ordered = $derived.by(() => {
		const list = [...sections];
		if (highlightHostId) {
			list.sort((a, b) => (a.hostId === highlightHostId ? -1 : b.hostId === highlightHostId ? 1 : 0));
		}
		return list;
	});

	function sortedProviders(section: QuotaSection): RemoteQuotaProvider[] {
		const kind = section.quota?.providers;
		if (!kind) return [];
		const inUse = getProvidersInUse(section.projects);
		return kind.slice().sort((a, b) => {
			const aInUse = inUse.has(normalizeProvider(a.provider));
			const bInUse = inUse.has(normalizeProvider(b.provider));
			if (aInUse !== bInUse) return aInUse ? -1 : 1;
			return a.provider.localeCompare(b.provider);
		});
	}

	function getProjectsUsingProvider(section: QuotaSection, providerName: string): string[] {
		const normTarget = normalizeProvider(providerName);
		const list: string[] = [];
		for (const p of section.projects) {
			for (const lane of p.lanes) {
				if (getLaneStatus(p, lane) !== 'idle') {
					const laneProv = lane.agent.provider ? normalizeProvider(lane.agent.provider) : null;
					if (laneProv === normTarget) {
						list.push(p.lanes.length > 1 ? `${p.name} · ${laneLabel(lane)}` : p.name);
						break;
					}
				}
			}
		}
		return list;
	}

	function formatResetTime(resetsAt: number | null): string {
		if (!resetsAt) return '';
		const d = new Date(resetsAt);
		const now = new Date();
		const isToday =
			d.getDate() === now.getDate() &&
			d.getMonth() === now.getMonth() &&
			d.getFullYear() === now.getFullYear();

		const timeStr = formatHHMM(resetsAt);
		if (isToday) return timeStr;

		const dayName = d.toLocaleDateString(getFormatLocale(), { weekday: 'short' });
		return `${dayName} ${timeStr}`;
	}

	async function handleRefresh(section: QuotaSection): Promise<void> {
		if (isRefreshing || !section.features.includes('quota_refresh')) return;
		isRefreshing = true;
		refreshingHostId = section.hostId;
		refreshMessage = null;
		try {
			await connection.sendCommand(section.hostId, { kind: 'refresh_quota' });
			refreshMessage = t('quotaRefreshed');
			setTimeout(() => {
				refreshMessage = null;
			}, 2500);
		} catch (err) {
			refreshMessage = (err as Error)?.message || t('errFailed');
		} finally {
			isRefreshing = false;
			refreshingHostId = null;
		}
	}
</script>

<div class="backdrop" transition:scrim onclick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
	<div class="sheet" transition:bottomSheet role="dialog" aria-modal="true" aria-label={t('quotaSheetTitle')}>
		<div class="grip" aria-hidden="true"></div>

		<div class="sheet-head">
			<div class="head-titles">
				<h2>{t('quotaSheetTitle')}</h2>
				{#if ordered.length === 1}
					<p class="sub">{t('quotaSheetSub', { machine: ordered[0]!.hostName })}</p>
				{:else}
					<p class="sub">{t('quotaPerMachine')}</p>
				{/if}
			</div>
			<button
				type="button"
				class="icon-btn"
				onclick={onClose}
				aria-label={t('close')}
				title={t('close')}
			>
				<IconClose />
			</button>
		</div>

		<div class="sheet-body">
			{#each ordered as section (section.hostId)}
				{@const providers = sortedProviders(section)}
				<div class="machine-section" data-testid={`quota-section-${section.hostId}`}>
					<div class="machine-head">
						<MachineGlyph glyph={{ kind: section.online ? 'remote' : 'offline' }} size={12} />
						<span class="machine-name">{section.hostName}</span>
						{#if !section.online}
							<span class="machine-offline">{t('offline')}</span>
						{/if}
						{#if section.features.includes('quota_refresh')}
							<button
								type="button"
								class="section-refresh"
								disabled={isRefreshing && refreshingHostId === section.hostId}
								onclick={() => void handleRefresh(section)}
								aria-label={t('quotaRefresh')}
								title={t('quotaRefresh')}
							>
								<IconRefresh />
							</button>
						{/if}
					</div>

					{#if providers.length === 0}
						<p class="empty-text">{t('quotaNoData')}</p>
					{:else}
						<div class="providers-list">
							{#each providers as p (p.provider + (p.account ?? ''))}
								{@const normId = normalizeProvider(p.provider)}
								{@const usingProjects = getProjectsUsingProvider(section, p.provider)}
								<div class="quota-block">
									<div class="provider-header">
										<div class="provider-info">
											<ProviderLogo provider={normId} size={16} />
											<strong class="provider-name">{providerDisplayName(p.provider)}</strong>
										</div>
										{#if p.account}
											<span class="provider-account">{p.account}</span>
										{/if}
									</div>

									<div class="windows-list">
										{#each p.windows as win (win.id)}
											{@const frac = win.usedFraction ?? 0}
											{@const tone = getQuotaLevel(win.usedFraction, p.status)}
											<div class="window-row">
												<div class="window-top">
													<span class="window-label">{win.label}</span>
													<span class="window-pct tone-{tone}">
														{Math.round(frac * 100)}%
													</span>
												</div>

												<div class="meter" aria-hidden="true">
													<i
														class="meter-fill tone-{tone}"
														style="width: {Math.max(4, Math.min(100, Math.round(frac * 100)))}%"
													></i>
												</div>

												{#if win.resetsAt}
													<div class="window-reset">
														{t('quotaResetsAt', { time: formatResetTime(win.resetsAt) })}
													</div>
												{/if}
											</div>
										{/each}
									</div>

									<div class="usage-footer">
										{#if usingProjects.length > 0}
											<span class="in-use-text">
												{t('quotaInUseBy', { projects: usingProjects.join(', ') })}
											</span>
										{:else}
											<span class="not-in-use-text">{t('quotaNotInUse')}</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if refreshMessage}
			<div class="sheet-actions">
				<span class="refresh-msg">{refreshMessage}</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: color-mix(in oklch, var(--ink) 35%, transparent);
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.sheet {
		width: 100%;
		max-width: 560px;
		max-height: min(88dvh, var(--app-h, 100dvh));
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border-radius: 18px 18px 0 0;
		padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
		box-shadow: var(--shadow-overlay);
	}

	.grip {
		width: 36px;
		height: 5px;
		border-radius: 3px;
		background: var(--line-strong);
		margin: 0 auto 8px;
		flex-shrink: 0;
	}

	.sheet-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 8px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.head-titles h2 {
		font-size: 18px;
		font-weight: 650;
		color: var(--ink);
		margin: 0;
	}

	.head-titles .sub {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		margin: 2px 0 0;
	}

	.icon-btn {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		border-radius: 50%;
	}

	.icon-btn:hover {
		color: var(--ink);
	}

	.sheet-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 0;
		-webkit-overflow-scrolling: touch;
	}

	.empty-text {
		color: var(--ink-muted);
		font-size: var(--text-sm);
		padding: 16px 0;
		text-align: center;
	}

	.providers-list {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.machine-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 4px 0 12px;
		border-bottom: 1px dashed var(--line);
	}

	.machine-section:last-child {
		border-bottom: none;
	}

	.machine-head {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.machine-head .machine-name {
		color: var(--ink);
	}

	.machine-offline {
		color: var(--danger);
	}

	.section-refresh {
		margin-left: auto;
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		background: transparent;
		border: none;
		border-radius: 50%;
		color: var(--ink-muted);
		cursor: pointer;
	}

	.section-refresh:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.quota-block {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.provider-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}

	.provider-info {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.provider-name {
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.provider-account {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		font-family: var(--font-mono);
	}

	.windows-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.window-row {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.window-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		font-size: var(--text-xs);
	}

	.window-label {
		color: var(--ink);
	}

	.window-pct {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: var(--ink);
	}

	.window-pct.tone-warning {
		color: var(--warn);
	}

	.window-pct.tone-exhausted {
		color: var(--danger);
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
	}

	.meter-fill.tone-warning {
		background: var(--warn);
	}

	.meter-fill.tone-exhausted {
		background: var(--danger);
	}

	.window-reset {
		font-size: 11px;
		color: var(--ink-muted);
		text-align: right;
	}

	.usage-footer {
		font-size: var(--text-xs);
		padding-top: 4px;
		border-top: 1px dashed var(--line);
	}

	.in-use-text {
		color: var(--ink);
	}

	.not-in-use-text {
		color: var(--ink-muted);
	}

	.sheet-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
		flex-shrink: 0;
	}

	.refresh-msg {
		font-size: var(--text-xs);
		color: var(--brand);
		margin-right: auto;
	}

	.refresh-btn {
		min-height: 44px;
		padding: 0 16px;
		border-radius: var(--radius-md);
		background: var(--brand);
		color: var(--bg-base);
		font-size: var(--text-sm);
		font-weight: 600;
		border: none;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.refresh-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

</style>
