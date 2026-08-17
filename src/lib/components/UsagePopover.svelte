<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let { open = false, onClose } = $props<{ open?: boolean, onClose?: () => void }>();

	let usageData = $state<any>(null);
	let loading = $state(false);
	let now = $state(Date.now());
	let timer: any = null;

	type ProviderHost = {
		provider: string;
		model: string;
		host: string;
		project: string;
		last_active_ms: number;
	};

	let providerHosts = $state<ProviderHost[]>([]);

	async function fetchUsage(force = false) {
		loading = true;
		try {
			const [usage, hosts] = await Promise.all([
				invoke<any>('usage_snapshot', { force }),
				invoke<ProviderHost[]>('provider_hosts')
			]);
			usageData = usage.raw_json;
			providerHosts = hosts;
		} catch (e) {
			console.error("Usage fetch failed", e);
		} finally {
			loading = false;
		}
	}

	function formatAge(ts: number | undefined) {
		if (!ts) return '';
		const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
		if (diffSec < 10) return 'ora';
		if (diffSec < 60) return `${diffSec}s fa`;
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return `${diffMin}m fa`;
		const diffHours = Math.floor(diffMin / 60);
		return `${diffHours}h fa`;
	}

	$effect(() => {
		if (open) {
			fetchUsage();
			now = Date.now();
			timer = setInterval(() => {
				now = Date.now();
			}, 10000);
		} else {
			if (timer) clearInterval(timer);
		}
	});

	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && onClose) {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="backdrop" onclick={onClose} transition:fade={{ duration: 180 }}></div>
	<div class="popover" transition:fly={{ y: -12, duration: 220, easing: cubicOut }}>
		<div class="header">
			<div class="title-group">
				<h3>API Usage Limits</h3>
				{#if usageData?.generatedAt}
					<span class="freshness" title={new Date(usageData.generatedAt).toLocaleString()}>
						Aggiornato {formatAge(usageData.generatedAt)}
					</span>
				{/if}
			</div>
			<div class="actions">
				<button
					class="icon-btn refresh-btn"
					class:spinning={loading}
					onclick={() => fetchUsage(true)}
					title="Aggiorna dati"
					disabled={loading}
				>
					↻
				</button>
				<button class="close-btn" onclick={onClose}>×</button>
			</div>
		</div>
		{#if loading && usageData}
			<div class="loading-bar"></div>
		{/if}
		<div class="content">
			{#if loading && !usageData}
				<div class="loading-state">
					<span class="spinner"></span>
					<span>Caricamento dati in corso...</span>
				</div>
			{:else if usageData && usageData.reports}
				{#each usageData.reports as report, i}
					{#if report.limits && report.limits.length > 0}
						{@const projectLabels = [...new Set(providerHosts
							.filter((host) => host.provider === report.provider)
							.map((host) => host.project)
							.filter((project) => project))]}
						<div class="provider-section" style="animation-delay: {i * 0.08}s;">
							<h4>{report.provider} <span class="meta">{report.metadata?.email || ''}</span></h4>
							{#each report.limits as limit}
								{@const usedFrac = limit.amount?.usedFraction ?? (1 - (limit.amount?.remainingFraction ?? 1))}
								{@const remainingFrac = limit.amount?.remainingFraction ?? (1 - usedFrac)}
								{@const remainingPercent = Math.round(remainingFrac * 100)}
								{@const usedPercent = Math.round(usedFrac * 100)}
								{@const colorVar = usedFrac >= 0.9 ? 'var(--brand)' : usedFrac >= 0.75 ? 'var(--warn)' : 'var(--ink-muted)'}
								<div class="limit-item">
									<div class="limit-label">
										<span>{limit.label}</span>
										<span class="value">
											{#if limit.amount?.unit === 'usd'}
												{remainingPercent}% (${limit.amount?.remaining?.toFixed(2)} / ${limit.amount?.limit?.toFixed(2)})
											{:else}
												{remainingPercent}%
											{/if}
										</span>
									</div>
									<div class="limit-bar" title="Consumato: {usedPercent}% | Rimanente: {remainingPercent}%">
										<div class="limit-fill" style="--target-width: {usedPercent}%; background: {colorVar}; --bar-delay: {i * 0.08}s;"></div>
									</div>
									{#if projectLabels.length > 0}
										<div class="host-usage">In uso da: {projectLabels.join(', ')}</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				{/each}
			{:else}
				<div class="msg">Nessun dato di utilizzo disponibile</div>
			{/if}
		</div>
	</div>
{/if}
<style>
	.backdrop {
		position: fixed;
		top: 0; left: 0; right: 0; bottom: 0;
		z-index: var(--z-backdrop);
	}

	.popover {
		position: fixed;
		top: 48px;
		right: var(--space-2);
		width: 360px;
		max-height: calc(100vh - 80px);
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		color: var(--ink);
		overflow: hidden;
		transition: max-height 0.35s cubic-bezier(0.16, 1, 0.3, 1), height 0.35s cubic-bezier(0.16, 1, 0.3, 1);
		interpolate-size: allow-keywords;
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
		font-size: var(--text-lg);
		font-weight: 500;
	}

	.freshness {
		font-size: var(--text-xs);
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
		font-size: 16px;
		padding: 4px;
		border-radius: var(--radius-sm);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		transition: color 0.15s ease, background 0.15s ease;
	}

	.close-btn {
		font-size: 20px;
	}

	.icon-btn:hover, .close-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.refresh-btn.spinning {
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
		width: 24px;
		height: 24px;
		border: 2px solid var(--line);
		border-top-color: var(--ink);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	.content {
		padding: var(--space-4);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		transition: height 0.35s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.msg {
		color: var(--ink-faint);
		font-size: var(--text-sm);
		text-align: center;
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
		font-size: var(--text-md);
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

	.limit-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.limit-label {
		display: flex;
		justify-content: space-between;
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.value {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	.limit-bar {
		height: 4px;
		background: var(--bg-sunken);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.host-usage {
		margin-top: var(--space-1);
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.limit-fill {
		height: 100%;
		border-radius: var(--radius-full);
		width: 0%;
		animation: barFill 0.75s cubic-bezier(0.16, 1, 0.3, 1) forwards;
		animation-delay: calc(var(--bar-delay, 0s) + 0.1s);
	}

	@keyframes barFill {
		from { width: 0%; }
		to { width: var(--target-width); }
	}
</style>