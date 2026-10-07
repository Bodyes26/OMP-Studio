<script lang="ts">
	/**
	 * ModesMenu.svelte — Controllo unificato per modalita operative (Fast, Slow),
	 * limiti di utilizzo account e riscaldamento della prompt cache.
	 */
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import { IconSliders, IconFlame, IconWarning } from '$lib/icons';
	import { m } from '$lib/paraglide/messages.js';
	import type { AgentSession } from '../session.svelte';
	import {
		formatRelativeTime,
		formatResetTime,
		getModesTooltipText
	} from '../sessionModes';

	let {
		session,
		open = false,
		onToggle,
		onClose
	} = $props<{
		session: AgentSession;
		open: boolean;
		onToggle: () => void;
		onClose: () => void;
	}>();

	const tooltipText = $derived(
		getModesTooltipText({
			fastModeEnabled: session.fastModeEnabled,
			fastModeActive: session.fastModeActive,
			slowModeEnabled: session.slowModeEnabled,
			usageLimit: session.usageLimit,
			cacheWarmingInFlight: session.cacheWarmingInFlight
		})
	);

	function outcomeLabel(outcome: string): string {
		switch (outcome) {
			case 'hit':
				return m.chat_v2_composer_modes_cache_outcome_hit();
			case 'miss':
				return m.chat_v2_composer_modes_cache_outcome_miss();
			case 'error':
				return m.chat_v2_composer_modes_cache_outcome_error();
			case 'aborted':
				return m.chat_v2_composer_modes_cache_outcome_aborted();
			default:
				return outcome;
		}
	}

	function formatCost(cost: number): string {
		return `$${cost.toFixed(4)}`;
	}
</script>

<MenuButton
	{open}
	title={m.chat_v2_composer_modes_title()}
	tooltip={tooltipText}
	hasPopup="dialog"
	contentRole="dialog"
	width="340px"
	{onToggle}
	{onClose}
>
	{#snippet trigger()}
		<span
			class="modes-icon-wrap"
			class:fast-active={session.fastModeEnabled && session.fastModeActive}
			class:slow-active={session.slowModeEnabled}
			class:warning-limit={session.usageLimit !== null}
			class:warming-pulse={session.cacheWarmingInFlight !== null}
			aria-hidden="true"
		>
			<IconSliders />
		</span>
	{/snippet}

	{#snippet children()}
		<div class="modes-popover" role="dialog" aria-label={m.chat_v2_composer_modes_title()}>
			<div class="modes-popover-header">
				<span class="modes-title">{m.chat_v2_composer_modes_title()}</span>
			</div>

			<!-- Sezione Fast Mode -->
			<div class="mode-item">
				<div class="mode-row">
					<div class="mode-text">
						<span class="mode-label">{m.chat_v2_composer_modes_fast_title()}</span>
						<span class="mode-desc">{m.chat_v2_composer_modes_fast_desc()}</span>
					</div>
					<Switch
						checked={session.fastModeEnabled}
						onChange={(val) => void session.setFastMode(val)}
						ariaLabel={m.chat_v2_composer_modes_fast_title()}
					/>
				</div>
				{#if session.fastModeEnabled && !session.fastModeActive}
					<div class="mode-warning-note">
						{m.chat_v2_composer_modes_fast_unavailable()}
					</div>
				{/if}
			</div>

			<!-- Sezione Slow Mode -->
			<div class="mode-item">
				<div class="mode-row">
					<div class="mode-text">
						<div class="mode-label-row">
							<span class="mode-label">{m.chat_v2_composer_modes_slow_title()}</span>
							{#if session.slowModeScope}
								<span class="mode-scope-badge">
									{session.slowModeScope === 'session'
										? m.chat_v2_composer_modes_slow_scope_session()
										: m.chat_v2_composer_modes_slow_scope_global()}
								</span>
							{/if}
						</div>
						<span class="mode-desc">{m.chat_v2_composer_modes_slow_desc()}</span>
					</div>
					<Switch
						checked={session.slowModeEnabled}
						disabled={!session.slowModeSupported}
						onChange={(val) => void session.setSlowMode(val)}
						ariaLabel={m.chat_v2_composer_modes_slow_title()}
					/>
				</div>
				{#if !session.slowModeSupported}
					<div class="mode-unsupported-note">
						{m.chat_v2_composer_modes_slow_unsupported()}
					</div>
				{/if}
			</div>

			<!-- Sezione Limite Account (visibile solo se presente) -->
			{#if session.usageLimit}
				<div class="modes-divider" aria-hidden="true"></div>
				<div class="usage-limit-section">
					<div class="section-title warning">
						<span class="section-icon"><IconWarning /></span>
						<span>{m.chat_v2_composer_modes_usage_limit_title()}</span>
					</div>
					<div class="usage-limit-content">
						{#if session.usageLimit.stage === 'low_priority'}
							<div class="usage-stage">
								<span class="stage-name">{m.chat_v2_composer_modes_usage_limit_stage_low_priority()}</span>
								{#if session.usageLimit.allowanceLeftPercent !== undefined}
									<span class="stage-detail">
										{m.chat_v2_composer_modes_usage_limit_allowance({
											percent: session.usageLimit.allowanceLeftPercent
										})}
									</span>
								{/if}
							</div>
						{:else if session.usageLimit.stage === 'wrap_up'}
							<div class="usage-stage">
								<span class="stage-name">{m.chat_v2_composer_modes_usage_limit_stage_wrap_up()}</span>
								<span class="stage-detail">
									{session.usageLimit.extraUsage
										? m.chat_v2_composer_modes_usage_limit_extra_yes()
										: m.chat_v2_composer_modes_usage_limit_extra_no()}
								</span>
							</div>
						{/if}
						{#if session.usageLimit.resetsAtSec !== undefined}
							<div class="usage-reset">
								{m.chat_v2_composer_modes_usage_limit_resets_at({
									time: formatResetTime(session.usageLimit.resetsAtSec)
								})}
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Sezione Riscaldamento Cache -->
			<div class="modes-divider" aria-hidden="true"></div>
			<div class="cache-section">
				<div class="section-title">
					<span class="section-icon flame"><IconFlame /></span>
					<span>{m.chat_v2_composer_modes_cache_title()}</span>
				</div>
				<div class="cache-content">
					{#if session.cacheWarmingInFlight}
						<div class="cache-in-flight">
							<span class="cache-pulse-dot" aria-hidden="true"></span>
							<span>
								{m.chat_v2_composer_modes_cache_in_flight({
									phase: session.cacheWarmingInFlight.phase
								})}
							</span>
						</div>
					{:else if session.cacheWarmingLast}
						<div class="cache-last">
							<div class="cache-outcome-row">
								<span class="cache-outcome-tag" class:hit={session.cacheWarmingLast.outcome === 'hit'}>
									{m.chat_v2_composer_modes_cache_last_outcome({
										outcome: outcomeLabel(session.cacheWarmingLast.outcome)
									})}
								</span>
								<span class="cache-time">
									{formatRelativeTime(session.cacheWarmingLast.at)}
								</span>
							</div>
							{#if session.cacheWarmingLast.cost !== undefined}
								<div class="cache-cost">
									{m.chat_v2_composer_modes_cache_cost({
										cost: formatCost(session.cacheWarmingLast.cost)
									})}
								</div>
							{/if}
							{#if session.cacheWarmingLast.warmingStopReason}
								<div class="cache-stop-reason">
									{m.chat_v2_composer_modes_cache_stop_reason({
										reason: session.cacheWarmingLast.warmingStopReason
									})}
								</div>
							{/if}
						</div>
					{:else}
						<div class="cache-empty">
							{m.chat_v2_composer_modes_cache_none()}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/snippet}
</MenuButton>

<style>
	.modes-icon-wrap {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-muted);
		transition: color var(--dur-fast, 120ms) ease;
	}

	.modes-icon-wrap.fast-active {
		color: var(--accent);
	}

	.modes-icon-wrap.slow-active {
		color: var(--primary, #38bdf8);
	}

	.modes-icon-wrap.warning-limit {
		color: var(--warn, #eab308) !important;
	}

	@keyframes warming-glyph-pulse {
		0%, 100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.4;
			transform: scale(0.92);
		}
	}

	.modes-icon-wrap.warming-pulse {
		animation: warming-glyph-pulse var(--dur-pulse, 1800ms) ease-in-out infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.modes-icon-wrap.warming-pulse {
			animation: none !important;
		}
	}

	:root[data-animations="false"] .modes-icon-wrap.warming-pulse {
		animation: none !important;
	}

	.modes-popover {
		padding: var(--space-3, 12px) var(--space-4, 16px);
		display: flex;
		flex-direction: column;
		gap: var(--space-3, 12px);
		font-family: var(--font-ui);
		font-size: var(--text-sm, 13px);
		color: var(--ink);
	}

	.modes-popover-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: 2px;
	}

	.modes-title {
		font-size: var(--text-xs, 11px);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-muted);
	}

	.mode-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.mode-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3, 12px);
	}

	.mode-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
	}

	.mode-label-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.mode-label {
		font-weight: 500;
		color: var(--ink);
	}

	.mode-scope-badge {
		font-size: 10px;
		padding: 1px 5px;
		border-radius: var(--radius-sm, 4px);
		background: var(--bg-surface, rgba(255, 255, 255, 0.06));
		color: var(--ink-muted);
		border: 1px solid var(--line, rgba(255, 255, 255, 0.08));
	}

	.mode-desc {
		font-size: var(--text-xs, 12px);
		color: var(--ink-muted);
		line-height: 1.35;
	}

	.mode-warning-note {
		font-size: 11px;
		color: var(--warn, #eab308);
		background: color-mix(in oklch, var(--warn, #eab308) 12%, transparent);
		padding: 4px 8px;
		border-radius: var(--radius-sm, 4px);
		margin-top: 2px;
	}

	.mode-unsupported-note {
		font-size: 11px;
		color: var(--ink-muted);
		font-style: italic;
		margin-top: 2px;
	}

	.modes-divider {
		height: 1px;
		background: var(--line, rgba(255, 255, 255, 0.08));
		margin: 2px 0;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-xs, 11px);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-secondary);
		margin-bottom: 4px;
	}

	.section-title.warning {
		color: var(--warn, #eab308);
	}

	.section-icon {
		display: inline-flex;
		align-items: center;
		--icon-size: 13px;
	}

	.section-icon.flame {
		color: #f97316;
	}

	.usage-limit-content,
	.cache-content {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--text-xs, 12px);
	}

	.usage-stage {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.stage-name {
		font-weight: 500;
		color: var(--ink);
	}

	.stage-detail {
		color: var(--ink-muted);
	}

	.usage-reset {
		color: var(--ink-secondary);
		font-size: 11px;
	}

	.cache-in-flight {
		display: flex;
		align-items: center;
		gap: 6px;
		color: #f97316;
		font-weight: 500;
	}

	.cache-pulse-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #f97316;
		animation: warming-glyph-pulse var(--dur-pulse, 1800ms) ease-in-out infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.cache-pulse-dot {
			animation: none !important;
		}
	}

	:root[data-animations="false"] .cache-pulse-dot {
		animation: none !important;
	}

	.cache-last {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.cache-outcome-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.cache-outcome-tag {
		font-weight: 500;
		color: var(--ink-secondary);
	}

	.cache-outcome-tag.hit {
		color: var(--success, #22c55e);
	}

	.cache-time {
		color: var(--ink-muted);
		font-size: 11px;
	}

	.cache-cost,
	.cache-stop-reason {
		font-size: 11px;
		color: var(--ink-muted);
	}

	.cache-empty {
		color: var(--ink-muted);
		font-style: italic;
	}
</style>
