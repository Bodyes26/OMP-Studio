<script lang="ts">
	/**
	 * Riga di stato sotto il composer: velocita' (rapida/lenta), prewalk, limite
	 * d'uso e costo. Una voce compare solo quando puo' agire su modello e ruolo
	 * attivi: un comando inutilizzabile non occupa spazio in una colonna stretta.
	 */
	import type { AgentSession } from '../session.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import { modelSupportsFastMode, usageLimitDetail, usageLimitLabel } from '../sessionModes';
	import { IconFastMode, IconSlowMode, IconPrewalk, IconRefresh, IconWarning } from '$lib/icons';
	import { m } from '$lib/paraglide/messages.js';

	let {
		session,
		activeRole,
		isLab
	} = $props<{
		session: AgentSession;
		activeRole: string | null;
		isLab: boolean;
	}>();

	const smolConfigured = $derived(modelSettingsStore.config?.modelRoles?.smol?.trim() || '');
	const smolFallbacks = $derived(modelSettingsStore.config?.fallbackChains?.smol || []);
	const prewalkState = $derived(session.prewalk?.state ?? 'off');
	const prewalkTarget = $derived(session.prewalk?.target || '');
	const handedOffTo = $derived(session.prewalk?.handedOffTo || session.model?.name || session.model?.id || '');
	const prewalkBusy = $derived(session.prewalkBusy || !session.isReady);

	// Il laboratorio lavora con il suo modello fisso: velocita' e prewalk non si toccano.
	// Con fast accesa su un modello che non la regge omp la tiene in pausa: la voce resta
	// visibile solo se l'utente l'aveva accesa, cosi' la puo' spegnere.
	const showFast = $derived(
		!isLab && (session.fastModeActive || modelSupportsFastMode(session.model))
	);
	const showSlow = $derived(!isLab && session.slowModeSupported);
	// Su smol prewalk non ha dove passare; dopo il passaggio resta per «ripeti».
	const showPrewalk = $derived(
		!isLab && smolConfigured !== '' && (activeRole !== 'smol' || prewalkState !== 'off')
	);
	const limit = $derived(session.usageLimit);
	const totalCost = $derived(session.totalCost);
	const hasItems = $derived(showFast || showSlow || showPrewalk || limit !== null || (totalCost ?? 0) > 0);

	const fastPaused = $derived(session.fastModeEnabled && !session.fastModeActive);
	const fastTooltip = $derived(
		fastPaused
			? `${m.chat_v2_composer_modes_fast_title()}: ${m.chat_v2_composer_modes_fast_unavailable()}`
			: `${m.chat_v2_composer_modes_fast_title()}: ${m.chat_v2_composer_modes_fast_desc()}`
	);
	const slowTooltip = $derived.by(() => {
		const base = `${m.chat_v2_composer_modes_slow_title()}: ${m.chat_v2_composer_modes_slow_desc()}`;
		if (!session.slowModeScope) return base;
		const scope =
			session.slowModeScope === 'session'
				? m.chat_v2_composer_modes_slow_scope_session()
				: m.chat_v2_composer_modes_slow_scope_global();
		return `${base} (${scope})`;
	});
	const prewalkTooltip = $derived.by(() => {
		if (session.prewalkBusy) return m.chat_v2_composer_prewalk_busy();
		if (smolFallbacks.length > 0) {
			return m.chat_v2_composer_prewalk_tooltip_with_fallbacks({
				smol: smolConfigured,
				fallbacks: smolFallbacks.join(', ')
			});
		}
		return m.chat_v2_composer_prewalk_tooltip({ smol: smolConfigured });
	});
	const costTooltip = $derived(
		session.subagentCost > 0
			? `${m.chat_v2_composer_context_cost_label()}: ${m.chat_session_cost_split({
					own: `$${(session.sessionCost ?? 0).toFixed(4)}`,
					subagents: `$${session.subagentCost.toFixed(4)}`
				})}`
			: m.chat_v2_composer_context_cost_label()
	);

	let speedBusy = $state(false);

	/**
	 * Rapida e lenta sono livelli di servizio alternativi: accenderne uno spegne
	 * l'altro. Per le famiglie flex omp li alterna gia' da se', ma la corsia lenta
	 * di Anthropic e' un'impostazione separata e va spenta esplicitamente.
	 */
	async function toggleSpeed(tier: 'fast' | 'slow') {
		if (speedBusy) return;
		speedBusy = true;
		try {
			if (tier === 'fast') {
				const enable = !session.fastModeEnabled;
				if (enable && session.slowModeEnabled && !(await session.setSlowMode(false))) return;
				await session.setFastMode(enable);
			} else {
				const enable = !session.slowModeEnabled;
				if (enable && session.fastModeEnabled && !(await session.setFastMode(false))) return;
				await session.setSlowMode(enable);
			}
		} finally {
			speedBusy = false;
		}
	}

	async function runPrewalk(action: () => Promise<unknown>) {
		try {
			await action();
		} catch (err) {
			session.pushNotice('error', err instanceof Error ? err.message : String(err), 'prewalk');
		}
	}
</script>

{#if hasItems}
	<div class="status-line" role="group" aria-label={m.chat_v2_composer_status_label()}>
		{#if showFast}
			<span class="status-entry"><Tooltip text={fastTooltip} placement="top" offset={6}>
				<button
					type="button"
					class="status-item"
					class:on={session.fastModeEnabled && !fastPaused}
					class:paused={fastPaused}
					aria-pressed={session.fastModeEnabled}
					aria-label={m.chat_v2_composer_modes_fast_title()}
					disabled={speedBusy}
					onclick={() => void toggleSpeed('fast')}
				>
					<span class="status-icon"><IconFastMode /></span>{m.chat_v2_composer_status_fast()}
				</button>
			</Tooltip></span>
		{/if}

		{#if showSlow}
			<span class="status-entry"><Tooltip text={slowTooltip} placement="top" offset={6}>
				<button
					type="button"
					class="status-item"
					class:on={session.slowModeEnabled}
					aria-pressed={session.slowModeEnabled}
					aria-label={m.chat_v2_composer_modes_slow_title()}
					disabled={speedBusy}
					onclick={() => void toggleSpeed('slow')}
				>
					<span class="status-icon"><IconSlowMode /></span>{m.chat_v2_composer_status_slow()}
				</button>
			</Tooltip></span>
		{/if}

		{#if showPrewalk}
			<span class="status-entry">
				<Tooltip text={prewalkTooltip} placement="top" offset={6}>
					<button
						type="button"
						class="status-item"
						class:on={prewalkState !== 'off'}
						aria-pressed={prewalkState !== 'off'}
						aria-label={prewalkState === 'off'
							? m.chat_v2_composer_prewalk_arm_aria()
							: m.chat_v2_composer_prewalk_disarm_aria()}
						disabled={prewalkBusy}
						onclick={() =>
							void runPrewalk(() =>
								prewalkState === 'off' ? session.armPrewalk() : session.disarmPrewalk()
							)}
					>
						<span class="status-icon"><IconPrewalk /></span>{m.chat_v2_composer_prewalk_title().toLowerCase()}
						{#if prewalkState === 'armed'}
							<span class="status-target">→ {prewalkTarget || '…'}</span>
						{:else if prewalkState === 'handedOff'}
							<span class="status-target">· {handedOffTo || '…'}</span>
						{/if}
					</button>
				</Tooltip>
				{#if prewalkState === 'handedOff'}
					<Tooltip text={m.chat_v2_composer_prewalk_restart_aria()} placement="top" offset={6}>
						<button
							type="button"
							class="status-item"
							aria-label={m.chat_v2_composer_prewalk_restart_aria()}
							disabled={prewalkBusy}
							onclick={() => void runPrewalk(() => session.restartPrewalk())}
						>
							<span class="status-icon"><IconRefresh /></span>{m.chat_v2_composer_prewalk_restart().toLowerCase()}
						</button>
					</Tooltip>
				{/if}
			</span>
		{/if}

		{#if limit}
			<span class="status-entry"><Tooltip text={usageLimitDetail(limit)} placement="top" offset={6}>
				<span class="status-item warn" role="status">
					<span class="status-icon"><IconWarning /></span>{usageLimitLabel(limit)}
				</span>
			</Tooltip></span>
		{/if}

		{#if totalCost !== null && totalCost > 0}
			<span class="status-entry status-cost"><Tooltip text={costTooltip} placement="top" offset={6}>
				<span class="status-item">${totalCost < 0.01 ? totalCost.toFixed(4) : totalCost.toFixed(2)}</span>
			</Tooltip></span>
		{/if}
	</div>
{/if}

<style>
	/* Fuori dal riquadro del composer, in stile riga di stato della TUI: monospazio
	   piccolo, voci separate da un punto, il costo spinto a destra. */
	.status-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 8px;
		padding: 4px 6px 0;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		min-width: 0;
		/* Ogni voce ha il suo punto a sinistra, dentro lo spazio fra le voci: a inizio
		   riga (anche dopo un a capo in colonna stretta) cade fuori dal bordo sinistro
		   e viene tagliato. Sopra, sotto e a destra il ritaglio lascia spazio agli
		   anelli di fuoco. */
		clip-path: inset(-6px -6px -6px 6px);
	}

	.status-entry {
		display: inline-flex;
		align-items: center;
	}

	.status-entry:not(.status-cost)::before {
		content: '·';
		width: 8px;
		margin-left: -8px;
		text-align: center;
		color: var(--line-strong);
	}

	.status-cost {
		margin-left: auto;
	}

	.status-item {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: inherit;
		font: inherit;
		white-space: nowrap;
		--icon-size: 11px;
	}

	button.status-item {
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	button.status-item:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	button.status-item:disabled {
		cursor: progress;
	}

	.status-item.on {
		color: var(--ink);
	}

	.status-item.on .status-icon {
		color: var(--brand-ink);
	}

	.status-item.paused,
	.status-item.warn {
		color: var(--warn);
	}

	.status-icon {
		display: inline-flex;
		align-items: center;
	}

	.status-target {
		color: var(--ink-muted);
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
