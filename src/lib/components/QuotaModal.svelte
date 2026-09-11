<script module lang="ts">
	export type { ProviderHost } from '$lib/stores/quota.svelte';
</script>

<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { trapFocus } from '$lib/focusTrap';
	import { quotaStore, providersMatch, type ProviderHost, type QuotaLimit } from '$lib/stores/quota.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import QuotaLimitRow from './quota/QuotaLimitRow.svelte';
	import { limitTone } from '$lib/quota/resolve';
	import { IconRefresh, IconClose, IconWarning } from '$lib/icons';
	let {
		open = false,
		onClose,
		guiHosts = [],
		onOpenSettings
	} = $props<{
		open?: boolean;
		onClose?: () => void;
		guiHosts?: ProviderHost[];
		onOpenSettings?: (section?: string) => void;
	}>();

	let now = $state(Date.now());

	/* Variante e preferenze colore semaforo del popover quote */
	const popover = $derived(settingsStore.appearance.quotaPopover);

	/* Host GUI e host noti allo store: usati per l'etichetta "In uso da".
	   Sta nello script perche' {@const} non e' ammesso come figlio di un <div>. */
	const allHosts = $derived([...guiHosts, ...quotaStore.providerHosts]);

	function formatAge(ts: number | undefined) {
		if (!ts) return '';
		const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
		if (diffSec < 10) return m.quota_time_now();
		if (diffSec < 60) return m.quota_time_seconds_ago({ sec: diffSec });
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return m.quota_time_minutes_ago({ min: diffMin });
		const diffHours = Math.floor(diffMin / 60);
		return m.quota_time_hours_ago({ hours: diffHours });
	}

	function formatReset(resetsAt: number | undefined) {
		if (!resetsAt) return '';
		const diffMs = resetsAt - now;
		if (diffMs <= 0) return m.quota_reset_now();
		const diffSec = Math.floor(diffMs / 1000);
		if (diffSec < 60) return m.quota_reset_in_seconds({ sec: diffSec });
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return m.quota_reset_in_minutes({ min: diffMin });
		const diffHours = Math.floor(diffMin / 60);
		const remMin = diffMin % 60;
		if (diffHours < 24) {
			return remMin > 0 ? m.quota_reset_in_hours({ hours: diffHours, min: remMin }) : `tra ${diffHours}h`;
		}
		const diffDays = Math.floor(diffHours / 24);
		const remHours = diffHours % 24;
		return remHours > 0 ? m.quota_reset_in_days({ days: diffDays, hours: remHours }) : `tra ${diffDays}g`;
	}

	$effect(() => {
		if (open) {
			void quotaStore.refresh(false);
			now = Date.now();
			const timer = setInterval(() => {
				now = Date.now();
			}, 10000);
			return () => {
				clearInterval(timer);
			};
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open && onClose) {
			const t = e.target as HTMLElement | null;
			if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
				return;
			}
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<button type="button" class="backdrop" onclick={onClose} aria-label={m.ui_quotamodal_chiudi_limiti_utilizzo_160a()} tabindex="-1" transition:fade={{ duration: 180 }}></button>
	<div
		class="popover"
		class:quota-semantic={popover.semanticColors}
		data-variant={popover.variant}
		role="dialog"
		aria-modal="true"
		aria-label="Limiti di utilizzo API"
		use:trapFocus={{ onEscape: onClose }}
		transition:fly={{ y: -12, duration: 220, easing: cubicOut }}
	>
		<div class="header">
			<div class="title-group">
				<h3>{m.quota_heading()}</h3>
				{#if quotaStore.rawJson?.generatedAt}
					<span class="freshness" title={i18n.formatDate(quotaStore.rawJson.generatedAt, { dateStyle: 'short', timeStyle: 'medium' })}>
						{quotaStore.loading ? m.quota_updating() : m.quota_updated_age({ age: formatAge(quotaStore.rawJson.generatedAt) })}
					</span>
				{/if}
			</div>
			<div class="actions">
				<button
					class="icon-btn refresh-btn"
					onclick={() => void quotaStore.refresh(true)}
					title={m.quota_force_refresh()}
					aria-label={m.ui_quotamodal_aggiorna_dati_utilizzo_api_6f79()}
					disabled={quotaStore.loading}
				>
					<span class="refresh-icon" class:spinning={quotaStore.loading}><IconRefresh /></span>
				</button>
				<button class="close-btn" onclick={onClose} aria-label={m.quota_close()}><IconClose /></button>
			</div>
		</div>

		{#if quotaStore.loading && quotaStore.rawJson}
			<div class="loading-bar"></div>
		{/if}

		<div class="content">
			{#if quotaStore.status === 'offline'}
				<div class="quota-alert offline" role="alert">
					<div class="alert-icon" aria-hidden="true">
						<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line x1="1" y1="1" x2="23" y2="23"></line>
							<path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
							<path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
							<path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
							<path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
							<path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
							<line x1="12" y1="20" x2="12.01" y2="20"></line>
						</svg>
					</div>
					<div class="alert-body">
						<strong class="alert-title">{m.quota_unreachable_title()}</strong>
						<p class="alert-desc">{m.quota_unreachable_desc()}</p>
						{#if quotaStore.error}
							<div class="error-detail" title={quotaStore.error}>{quotaStore.error}</div>
						{/if}
					</div>
					<button type="button" class="action-btn" onclick={() => void quotaStore.refresh(true)} disabled={quotaStore.loading}>
						{quotaStore.loading ? m.page_omp_update_status_checking() : m.quota_retry()}
					</button>
				</div>
			{/if}

			{#if quotaStore.status === 'unconfigured'}
				<div class="quota-alert unconfigured">
					<div class="alert-icon" aria-hidden="true"><IconWarning /></div>
					<div class="alert-body">
						<strong class="alert-title">{m.quota_unconfigured_title()}</strong>
						<p class="alert-desc">{m.quota_unconfigured_desc()}</p>
					</div>
					{#if onOpenSettings}
						<button
							type="button"
							class="action-btn primary"
							onclick={() => { onClose?.(); onOpenSettings('models'); }}
						>
							{m.quota_configure()}
						</button>
					{/if}
				</div>
			{/if}

			{#if quotaStore.disabledCredentials.length > 0}
				<div class="disabled-creds-card">
					<div class="disabled-header">
						<span class="warning-bullet">!</span>
						<span class="disabled-title">Credenziali disabilitate o scadute ({quotaStore.disabledCredentials.length})</span>
					</div>
					<div class="disabled-list">
						{#each quotaStore.disabledCredentials as cred (cred.id)}
							<div class="disabled-row">
								<div class="cred-info">
									<strong class="cred-provider">{cred.provider}</strong>
									{#if cred.email}
										<span class="cred-email">· {cred.email}</span>
									{/if}
								</div>
								<div class="cred-cause" title={cred.cause}>{cred.cause}</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if quotaStore.loading && !quotaStore.rawJson}
				<div class="loading-state">
					<span class="spinner"></span>
					<span>{m.quota_querying()}</span>
				</div>
			{:else if quotaStore.reports && quotaStore.reports.length > 0}
				{#key popover.variant}
					<div class="reports-container" in:fade={{ duration: 120 }}>
						{#each quotaStore.reports as report, i}
							{#if report.limits && report.limits.length > 0}
								{@const projectLabels = [...new Set(allHosts
									.filter((host) => providersMatch(host.provider, report.provider))
									.map((host) => host.project || host.host)
									.filter((label) => Boolean(label)))]}
								<div class="provider-section" style="animation-delay: {i * 0.08}s;">
									<h4>
										<span>{report.provider}</span>
										{#if report.metadata?.email}
											<span class="meta">{report.metadata.email}</span>
										{/if}
									</h4>
									{#if projectLabels.length > 0}
										<div class="host-usage">In uso da: {projectLabels.join(', ')}</div>
									{/if}
									{#each report.limits as limit, limitIndex}
										{@const rawUsed = typeof limit.amount?.usedFraction === 'number' ? limit.amount.usedFraction : null}
										{@const rawRem = typeof limit.amount?.remainingFraction === 'number' ? limit.amount.remainingFraction : null}
										{@const usedFrac = Math.max(0, Math.min(1, rawUsed ?? (rawRem !== null ? 1 - rawRem : 0)))}
										{@const remainingFrac = Math.max(0, Math.min(1, rawRem ?? (1 - usedFrac)))}
										{@const remainingPercent = Math.round(remainingFrac * 100)}
										{@const resetsAt = limit.window?.resetsAt ?? limit.resetsAt}
										{@const resetCountdown = formatReset(resetsAt)}
										{@const resetExact = resetsAt ? i18n.formatDate(resetsAt, { dateStyle: 'short', timeStyle: 'medium' }) : ''}
										{@const valueText =
											limit.amount?.unit === 'usd' && typeof limit.amount?.remaining === 'number' && typeof limit.amount?.limit === 'number'
												? `${remainingPercent}% ($${limit.amount.remaining.toFixed(2)} / $${limit.amount.limit.toFixed(2)})`
												: limit.amount?.unit === 'usd' && typeof limit.amount?.remaining === 'number'
													? `${remainingPercent}% ($${limit.amount.remaining.toFixed(2)})`
													: `${remainingPercent}%`}
										<QuotaLimitRow
											variant={popover.variant}
											label={limit.label}
											{remainingPercent}
											tone={limitTone(remainingPercent, limit.status)}
											{resetCountdown}
											{resetExact}
											{valueText}
											delayIndex={i * 4 + limitIndex}
										/>
									{/each}
								</div>
							{/if}
						{/each}
					</div>
				{/key}
			{:else if quotaStore.status !== 'offline' && quotaStore.status !== 'unconfigured'}
				<div class="msg">{m.quota_no_data()}</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		top: 0; left: 0; right: 0; bottom: 0;
		z-index: var(--z-backdrop);
		background: transparent;
		border: none;
		padding: 0;
		cursor: default;
	}

	.popover {
		position: fixed;
		top: 48px;
		right: var(--space-2);
		width: 380px;
		max-height: calc(100vh - 80px);
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		color: var(--ink);
		overflow: hidden;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--line);
	}

	.title-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	h3 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
	}

	.freshness {
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.icon-btn, .close-btn {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		font-size: var(--text-lg);
		padding: 4px;
		border-radius: var(--radius-sm);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
	}

	.icon-btn:disabled, .close-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.close-btn {
		font-size: var(--text-xl);
	}

	.icon-btn:hover, .close-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.refresh-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	.refresh-icon.spinning {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.loading-bar {
		height: 2px;
		width: 100%;
		background: linear-gradient(90deg, transparent, var(--brand), transparent);
		background-size: 200% 100%;
		animation: loadingPulse 1.5s ease-in-out infinite;
	}

	@keyframes loadingPulse {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-6) 0;
		color: var(--ink-muted);
		font-size: var(--text-sm);
	}

	.spinner {
		width: 22px;
		height: 22px;
		border: 2px solid var(--line);
		border-top-color: var(--brand);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.content {
		flex: 0 1 auto;
		/* Senza min-height: 0 il flex item non si comprime sotto l'altezza del proprio contenuto, quindi il contenitore lo taglia invece di far comparire la barra di scorrimento */
		min-height: 0;
		padding: var(--space-4);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.msg {
		color: var(--ink-faint);
		font-size: var(--text-sm);
		text-align: center;
	}

	.quota-alert {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
	}

	.quota-alert.offline {
		border-color: var(--warn-dim, #f59e0b44);
		background: color-mix(in srgb, var(--warn, #f59e0b) 6%, var(--bg-sunken));
	}

	.quota-alert.unconfigured {
		border-color: var(--line-strong);
	}

	.alert-icon {
		font-size: 16px;
		color: var(--warn);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-top: 1px;
	}

	.alert-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.alert-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.alert-desc {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.error-detail {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ink-faint);
		margin-top: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.action-btn {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		padding: 4px 10px;
		cursor: pointer;
		flex-shrink: 0;
		align-self: center;
		transition: all 0.15s ease;
	}

	.action-btn:hover {
		background: var(--bg-hover);
		border-color: var(--ink-muted);
	}

	.action-btn.primary {
		background: var(--brand);
		color: var(--brand-ink, #ffffff);
		border-color: transparent;
	}

	.action-btn.primary:hover {
		filter: brightness(1.1);
	}

	.disabled-creds-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.disabled-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.warning-bullet {
		font-size: 11px;
		font-weight: 700;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--warn);
		color: #000;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.disabled-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.disabled-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: 2px;
	}

	.disabled-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--text-xs);
		border-bottom: 1px solid var(--line);
		padding-bottom: 4px;
	}

	.disabled-row:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.cred-info {
		display: flex;
		align-items: baseline;
		gap: 4px;
	}

	.cred-provider {
		color: var(--ink);
	}

	.cred-email {
		color: var(--ink-faint);
	}

	.cred-cause {
		color: var(--ink-muted);
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.reports-container {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.provider-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		animation: sectionFadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	@keyframes sectionFadeIn {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	h4 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.meta {
		font-size: var(--text-xs);
		font-weight: 400;
		color: var(--ink-faint);
	}

	.host-usage {
		margin-top: calc(-1 * var(--space-1));
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	/* Variante telemetria: layout compatto, separatori hairline e intestazione mono */
	.popover[data-variant='telemetry'] .reports-container {
		gap: var(--space-3);
	}

	/* Le righe telemetria sono blocchi di tre livelli (etichetta, barra, reset):
	   servono 8px tra un blocco e il successivo perche' si leggano come unita'. */
	.popover[data-variant='telemetry'] .provider-section {
		gap: var(--space-2);
	}

	.popover[data-variant='telemetry'] .provider-section + .provider-section {
		border-top: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
		padding-top: var(--space-3);
	}

	.popover[data-variant='telemetry'] h4 {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.16em;
		color: var(--ink-faint);
	}

	.popover[data-variant='telemetry'] h4 .meta {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: 400;
		text-transform: none;
		letter-spacing: normal;
		color: var(--ink-faint);
	}

	/* Variante radiale: spaziatura piu ariosa e tipografia standard */
	.popover[data-variant='radial'] .reports-container {
		gap: var(--space-5);
	}

	.popover[data-variant='radial'] .provider-section {
		gap: var(--space-3);
	}

	.popover[data-variant='radial'] .provider-section + .provider-section {
		border-top: 1px solid var(--line);
		padding-top: var(--space-4);
	}
</style>
