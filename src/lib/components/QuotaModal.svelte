<script module lang="ts">
	export type { ProviderHost } from '$lib/stores/quota.svelte';
</script>

<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import { rvLift } from '$lib/agent/motion';
	import { anchoredPopover } from '$lib/anchoredPopover';
	import { quotaStore, providersMatch, type ProviderHost, type QuotaLimit, type QuotaReport } from '$lib/stores/quota.svelte';
	import { activeQuotaStore } from '$lib/stores/activeQuota.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import QuotaLimitRow from './quota/QuotaLimitRow.svelte';
	import { limitTone } from '$lib/quota/resolve';
	import { IconRefresh, IconClose, IconWarning } from '$lib/icons';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';

	let {
		open = false,
		anchor = null,
		onClose,
		guiHosts = [],
		onOpenSettings
	} = $props<{
		open?: boolean;
		anchor?: HTMLElement | null;
		onClose?: () => void;
		guiHosts?: ProviderHost[];
		onOpenSettings?: (section?: string) => void;
	}>();

	let popoverEl = $state<HTMLDivElement | null>(null);
	let previousFocus: HTMLElement | null = null;
	let now = $state(Date.now());

	/* Preferenze colore semaforo del popover quote */
	const popover = $derived(settingsStore.appearance.quotaPopover);

	/* Host GUI e host noti allo store: usati per l'etichetta "In uso da" */
	const allHosts = $derived([...guiHosts, ...quotaStore.providerHosts]);

	/* Il provider del modello in uso (quello della chip) va in cima: e' la quota
	   che si cerca aprendo il popover. Dentro il gruppo, prima l'account che la
	   chip ha risolto. Sort stabile: il resto mantiene l'ordine di OMP. */
	const sortedReports = $derived.by(() => {
		const provider = activeQuotaStore.activeProvider;
		if (!provider) return quotaStore.reports;
		const email = activeQuotaStore.info.accountEmail;
		const rank = (report: QuotaReport) =>
			!providersMatch(report.provider, provider) ? 2 : email && report.metadata?.email === email ? 0 : 1;
		return [...quotaStore.reports].sort((a, b) => rank(a) - rank(b));
	});

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

	// Memorizza il focus precedente all'apertura per ripristino esplicito
	$effect(() => {
		if (open) {
			previousFocus = (document.activeElement as HTMLElement) || anchor || null;
		} else {
			previousFocus = null;
		}
	});

	// Fallback di posizionamento in alto a destra quando anchor non e' fornito
	$effect(() => {
		if (open && popoverEl && !anchor) {
			popoverEl.style.top = '48px';
			popoverEl.style.right = 'var(--space-3)';
			popoverEl.style.left = 'auto';
			popoverEl.style.bottom = 'auto';
		}
	});

	function restoreFocus() {
		if (anchor?.isConnected) {
			anchor.focus();
		} else if (previousFocus?.isConnected) {
			previousFocus.focus();
		}
	}

	function handleExplicitClose() {
		onClose?.();
		restoreFocus();
	}

	// Chiusura al click esterno (fase di cattura): non ruba il fuoco al target cliccato
	$effect(() => {
		if (!open) return;

		const handlePointerDown = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (!target || !popoverEl) return;
			if (popoverEl.contains(target) || (anchor && anchor.contains(target))) {
				return;
			}
			onClose?.();
		};

		document.addEventListener('pointerdown', handlePointerDown, true);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true);
		};
	});

	function handlePopoverKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			handleExplicitClose();
			return;
		}
		// Tab esce liberamente: gestito da handleFocusOut
	}

	function handleWindowKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			const t = e.target as HTMLElement | null;
			if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
				return;
			}
			e.stopPropagation();
			handleExplicitClose();
		}
	}

	function handleFocusOut(e: FocusEvent) {
		const related = e.relatedTarget as Node | null;
		if (!popoverEl?.contains(related) && !(anchor && anchor.contains(related))) {
			// Uscita naturale del Tab: chiude senza ripristinare il fuoco sull'ancora
			onClose?.();
		}
	}
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

{#if open}
	<div
		bind:this={popoverEl}
		class="popover"
		class:quota-semantic={popover.semanticColors}
		role="dialog"
		tabindex="-1"
		aria-label="Limiti di utilizzo API"
		popover="manual"
		use:anchoredPopover={{
			anchor,
			placement: 'bottom-end',
			offset: 8,
			motion: false
		}}
		transition:rvLift={{ blur: 3 }}
		style="--dur: var(--dur-menu); --blur: 3px;"
		onkeydown={handlePopoverKeyDown}
		onfocusout={handleFocusOut}
	>
		<div class="header">
			<div class="title-group">
				<h3 class="header-title">{m.quota_heading()}</h3>
				{#if quotaStore.rawJson?.generatedAt}
					<span class="freshness" title={i18n.formatDate(quotaStore.rawJson.generatedAt, { dateStyle: 'short', timeStyle: 'medium' })}>
						{quotaStore.loading ? m.quota_updating() : m.quota_updated_age({ age: formatAge(quotaStore.rawJson.generatedAt) })}
					</span>
				{/if}
			</div>
			<div class="actions">
				<Tooltip text={m.quota_force_refresh()} placement="bottom" offset={4}>
					<button
						class="icon-btn refresh-btn"
						onclick={() => void quotaStore.refresh(true)}
						aria-label={m.ui_quotamodal_aggiorna_dati_utilizzo_api_6f79()}
						disabled={quotaStore.loading}
						aria-busy={quotaStore.loading}
					>
						{#if quotaStore.loading}
							<StatusMark status="running" active={open} visible={open} />
						{:else}
							<span class="refresh-icon"><IconRefresh /></span>
						{/if}
					</button>
				</Tooltip>
				<button class="close-btn" onclick={handleExplicitClose} aria-label={m.quota_close()}><IconClose /></button>
			</div>
		</div>

		<div class="content">
			{#if quotaStore.status === 'offline'}
				<div class="quota-alert offline" role="alert">
					<div class="alert-icon" aria-hidden="true">
						<IconWarning />
					</div>
					<div class="alert-body">
						<strong class="alert-title">{m.quota_unreachable_title()}</strong>
						<p class="alert-desc">{m.quota_unreachable_desc()}</p>
						{#if quotaStore.error}
							<div class="error-detail" title={quotaStore.error}>{quotaStore.error}</div>
						{/if}
					</div>
					<button
						type="button"
						class="ui-button ui-button-secondary action-btn"
						onclick={() => void quotaStore.refresh(true)}
						disabled={quotaStore.loading}
					>
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
							class="ui-button ui-button-primary action-btn"
							onclick={() => { handleExplicitClose(); onOpenSettings('models'); }}
						>
							{m.quota_configure()}
						</button>
					{/if}
				</div>
			{/if}

			{#if quotaStore.disabledCredentials.length > 0}
				<div class="disabled-creds-card">
					<div class="disabled-header">
						<span class="warning-icon" aria-hidden="true"><IconWarning /></span>
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
					<StatusMark status="running" />
					<span>{m.quota_querying()}</span>
				</div>
			{:else if quotaStore.reports && quotaStore.reports.length > 0}
				<div class="reports-container">
					<!-- Senza chiave: OMP restituisce un report per account, quindi lo
					     stesso provider compare piu' volte (es. due account Codex) e una
					     chiave sul provider manderebbe in errore il blocco. -->
					{#each sortedReports as report}
						{#if report.limits && report.limits.length > 0}
							{@const projectLabels = [...new Set(allHosts
								.filter((host) => providersMatch(host.provider, report.provider))
								.map((host) => host.project || host.host)
								.filter((label) => Boolean(label)))]}
							<div class="provider-section">
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
										label={limit.label}
										{remainingPercent}
										tone={limitTone(remainingPercent, limit.status)}
										{resetCountdown}
										{resetExact}
										{valueText}
										delayIndex={limitIndex}
									/>
								{/each}
							</div>
						{/if}
					{/each}
				</div>
			{:else if quotaStore.status !== 'offline' && quotaStore.status !== 'unconfigured'}
				<div class="msg">{m.quota_no_data()}</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.popover {
		position: fixed;
		top: 48px;
		right: var(--space-3);
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

	.header-title {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-title);
		font-weight: 550;
		line-height: 1.3;
		text-wrap: balance;
		color: var(--ink);
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
		border-radius: var(--radius-md);
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

	.content {
		flex: 0 1 auto;
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
		border: 1px solid var(--line);
	}

	.quota-alert.offline {
		background: var(--bg-sunken);
		border-color: var(--line);
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

	.quota-alert.offline .alert-title {
		color: var(--warn);
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
		font-size: var(--text-xs);
		flex-shrink: 0;
		align-self: center;
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

	.warning-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--warn);
		--icon-size: 14px;
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
		gap: var(--space-3);
	}

	.provider-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.provider-section + .provider-section {
		border-top: 1px solid var(--line);
		padding-top: var(--space-3);
	}

	h4 {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.meta {
		font-size: var(--text-caption);
		font-weight: 400;
		color: var(--ink-faint);
	}

	.host-usage {
		margin-top: calc(-1 * var(--space-1));
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}
</style>
