<script lang="ts">
	/**
	 * Riga di stato sotto il composer.
	 *
	 * Disegna le voci della zona `statusLine` definite dal layout (`layout.pinned`):
	 * - Controlli con stato (`fast`, `slow`, `prewalk`, `ctl.limit`, `ctl.cost`):
	 *   compaiono solo quando il loro stato/modello lo richiede (un pin non li fa comparire
	 *   se non hanno nulla da dire, preservando spazio per colonne strette);
	 * - Controlli contestuali (`ctl.context`, `ctl.mention`): anello di contesto con pannello
	 *   ContextPanel e inserimento rapido `@` nell'editor;
	 * - Comandi generici fissati dall'utente: resi tramite `ComposerPinnedItem`.
	 * - Voci non configurabili, che compaiono solo quando c'e' qualcosa da dire:
	 *   «in background» (turno ceduto, sessione non ancora quieta) e le voci di
	 *   stato delle estensioni di omp (`setStatus`), una per `statusKey`.
	 *
	 * Overflow:
	 * Se le voci superano la larghezza orizzontale disponibile, le voci in coda
	 * confluiscono automaticamente nel menu compatto «…» (`ComposerOverflowMenu`).
	 * La misura avviene via ResizeObserver con cache delle larghezze, evitando flicker
	 * al primo render.
	 */
	import type { AgentSession } from '../session.svelte';
	import type { ComposerLayout, PinnedCommand, CommandManifestEntry } from '../commandCatalog/types';
	import { statusEntries } from '../extensionUi';
	import { resolveLayout, itemsInZone } from '../commandCatalog/layout';
	import { COMMAND_MANIFEST } from '../commandCatalog/manifest/index';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import { modelSupportsFastMode, usageLimitDetail, usageLimitLabel } from '../sessionModes';
	import { resolveContextWindow } from '../contextReport';
	import { formatTokens } from '$lib/utils/format';
	import {
		IconFastMode,
		IconSlowMode,
		IconPrewalk,
		IconRefresh,
		IconWarning,
		IconAt,
		IconLock
	} from '$lib/icons';
	import { m } from '$lib/paraglide/messages.js';

	import Tooltip from '$lib/ui/Tooltip.svelte';
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import ContextPanel from './ContextPanel.svelte';
	import ComposerPinnedItem from './ComposerPinnedItem.svelte';
	import ComposerOverflowMenu from './ComposerOverflowMenu.svelte';
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import { motionReduced } from '$lib/agent/motionState.svelte';
	let {
		session,
		activeRole,
		isLab,
		layout,
		draftTokens = 0,
		onActivateCommand,
		onInsertMention
	} = $props<{
		session: AgentSession;
		activeRole: string | null;
		isLab: boolean;
		layout?: ComposerLayout | null;
		draftTokens?: number;
		onActivateCommand?: (entry: CommandManifestEntry) => void;
		onInsertMention?: () => void;
	}>();

	const manifestMap = new Map(COMMAND_MANIFEST.map((entry) => [entry.id, entry]));

	// Layout effettivo: usa il prop se passato, altrimenti risolve dallo store impostazioni
	const resolvedLayout = $derived(
		layout !== undefined
			? (layout ?? resolveLayout(null, COMMAND_MANIFEST))
			: resolveLayout(settingsStore.composerLayout, COMMAND_MANIFEST)
	);

	const statusPins = $derived(itemsInZone(resolvedLayout, 'statusLine'));

	const smolConfigured = $derived(modelSettingsStore.config?.modelRoles?.smol?.trim() || '');
	const smolFallbacks = $derived(modelSettingsStore.config?.fallbackChains?.smol || []);
	const prewalkState = $derived(session.prewalk?.state ?? 'off');
	const prewalkTarget = $derived(session.prewalk?.target || '');
	const handedOffTo = $derived(
		session.prewalk?.handedOffTo || session.model?.name || session.model?.id || ''
	);
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

	// Regola di visibilità: i controlli di sistema compaiono solo se c'è un'informazione reale
	// da comunicare. Un pin non li forza a schermo se lo stato è inattivo.
	function isPinActive(id: string): boolean {
		switch (id) {
			case 'fast':
				return showFast;
			case 'slow':
				return showSlow;
			case 'prewalk':
				return showPrewalk;
			case 'ctl.limit':
				return limit !== null;
			case 'ctl.cost':
				return totalCost !== null && totalCost > 0;
			default:
				// Controlli espliciti e comandi generici fissati dall'utente sono sempre visibili
				return true;
		}
	}

	/**
	 * Voci di sessione che non stanno nel layout: le si infila nella stessa
	 * sequenza dei pin (prima del costo, che resta spinto a destra) cosi'
	 * condividono misura e overflow. Gli id con `__` non collidono con i comandi.
	 */
	const BACKGROUND_ID = '__background';
	const EXT_PREFIX = '__ext:';
	const extStatus = $derived(statusEntries(session.extensionStatus));
	const extStatusText = $derived(new Map(extStatus.map((entry) => [entry.key, entry.text])));
	const sessionItems = $derived.by((): PinnedCommand[] => {
		const items: PinnedCommand[] = [];
		const synthetic = (id: string): PinnedCommand => ({ id, zone: 'statusLine', form: 'chip', order: 0 });
		if (session.backgroundPending) items.push(synthetic(BACKGROUND_ID));
		for (const entry of extStatus) items.push(synthetic(`${EXT_PREFIX}${entry.key}`));
		return items;
	});

	const activePins = $derived.by(() => {
		const pins = statusPins.filter((pin) => isPinActive(pin.id));
		if (sessionItems.length === 0) return pins;
		const costIndex = pins.findIndex((pin) => pin.id === 'ctl.cost');
		if (costIndex === -1) return [...pins, ...sessionItems];
		return [...pins.slice(0, costIndex), ...sessionItems, ...pins.slice(costIndex)];
	});
	const hasItems = $derived(activePins.length > 0);

	function extKey(id: string): string {
		return id.slice(EXT_PREFIX.length);
	}

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
	let contextMenuOpen = $state(false);

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

	// --------------------------------------------------------------------------
	// Misurazione dinamica dell'overflow tramite ResizeObserver
	// --------------------------------------------------------------------------
	let lineEl = $state<HTMLDivElement | null>(null);
	let overflowOpen = $state(false);
	let overflowCutIndex = $state<number>(-1); // -1 = tutto a schermo senza overflow

	const widthCache = new Map<string, number>();

	function checkOverflow() {
		if (!lineEl) return;
		// Le voci del Piano stanno sempre davanti: lo spazio per i pin e' il resto.
		let planWidth = 0;
		for (const node of lineEl.querySelectorAll<HTMLElement>('.status-entry[data-pin-id^="plan"]')) {
			planWidth += node.offsetWidth + 8;
		}
		const containerWidth = lineEl.clientWidth - planWidth;
		if (containerWidth <= 0) return;

		// Aggiorna le larghezze misurate per ogni voce attualmente disegnata nel DOM
		const nodes = lineEl.querySelectorAll<HTMLElement>('.status-entry[data-pin-id]');
		for (const node of nodes) {
			const id = node.dataset.pinId;
			if (id && node.offsetWidth > 0) {
				widthCache.set(id, node.offsetWidth);
			}
		}

		const gap = 8;
		const overflowBtnWidth = 32;

		let cumulative = 0;
		let cut = -1;

		for (let i = 0; i < activePins.length; i++) {
			const pin = activePins[i];
			const w = widthCache.get(pin.id) ?? 60;
			const isFirst = i === 0;
			const nextTotal = cumulative + (isFirst ? 0 : gap) + w;

			const isLast = i === activePins.length - 1;
			const neededWithMore = nextTotal + (isLast ? 0 : gap + overflowBtnWidth);

			if (neededWithMore > containerWidth && i > 0) {
				cut = i;
				break;
			}
			cumulative = nextTotal;
		}

		overflowCutIndex = cut;
	}

	$effect(() => {
		if (!lineEl) return;
		// Rilancia al cambio del numero o della composizione di pin attivi
		// (le voci delle estensioni cambiano testo e quindi larghezza).
		void activePins.length;
		void activePins.map((pin) => pin.id).join('|');
		void extStatus.map((entry) => entry.text).join('|');

		const ro = new ResizeObserver(() => {
			checkOverflow();
		});
		ro.observe(lineEl);

		// Misura al primo mount (senza flicker perche' parte con -1 e adatta nel primo frame)
		checkOverflow();

		return () => ro.disconnect();
	});

	const visiblePins = $derived(
		overflowCutIndex === -1 ? activePins : activePins.slice(0, overflowCutIndex)
	);
	const overflowPins = $derived(
		overflowCutIndex === -1 ? [] : activePins.slice(overflowCutIndex)
	);

	function isPinnedDisabled(entry: CommandManifestEntry): boolean {
		if (entry.origin === 'studio') return false;
		return !session.isReady || session.isCompacting;
	}
</script>

{#if hasItems || session.plan.active}
	<div
		bind:this={lineEl}
		class="status-line"
		role="group"
		aria-label={m.chat_v2_composer_status_label()}
	>
		{#if session.plan.active}
			<!-- Modalita' Piano: prima voce, sempre visibile finche' e' accesa. -->
			<span class="status-entry status-plan" data-pin-id="plan">
				<span class="status-item on">
					<span class="status-icon"><IconLock /></span>{m.plan_status_readonly()}
				</span>
			</span>
			{#if session.plan.planFilePath}
				<span class="status-entry status-plan-file" data-pin-id="plan-file">
					<span class="status-item">{m.plan_status_file({ path: session.plan.planFilePath })}</span>
				</span>
				<span class="status-entry" data-pin-id="plan-review">
					<Tooltip text={m.plan_status_review_title()} placement="top" offset={6}>
						<button
							type="button"
							class="status-item"
							disabled={session.isStreaming || session.plan.review !== null}
							onclick={() => void session.plan.reopenReview()}
						>
							/plan-review
						</button>
					</Tooltip>
				</span>
			{/if}
		{/if}
		{#each visiblePins as pin (pin.id)}
			<span
				class="status-entry"
				class:status-cost={pin.id === 'ctl.cost'}
				data-pin-id={pin.id}
				animate:flip={{ duration: motionReduced() ? 0 : 180 }}
				in:scale={{ duration: motionReduced() ? 0 : 140, start: 0.85 }}
				out:scale={{ duration: motionReduced() ? 0 : 100, start: 0.85 }}
			>
				{#if pin.id === 'fast' && showFast}
					<Tooltip text={fastTooltip} placement="top" offset={6}>
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
					</Tooltip>
				{:else if pin.id === 'slow' && showSlow}
					<Tooltip text={slowTooltip} placement="top" offset={6}>
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
					</Tooltip>
				{:else if pin.id === 'prewalk' && showPrewalk}
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
				{:else if pin.id === BACKGROUND_ID}
					<Tooltip text={m.chat_v2_composer_status_background_tooltip()} placement="top" offset={6}>
						<span class="status-item background" role="status">
							<span class="background-dot" aria-hidden="true"></span>{m.chat_v2_composer_status_background()}
						</span>
					</Tooltip>
				{:else if pin.id.startsWith(EXT_PREFIX)}
					{@const key = extKey(pin.id)}
					<Tooltip
						text={`${m.chat_v2_composer_extension_status_tooltip({ key })}: ${extStatusText.get(key) ?? ''}`}
						placement="top"
						offset={6}
					>
						<span class="status-item ext-status">{extStatusText.get(key) ?? ''}</span>
					</Tooltip>
				{:else if pin.id === 'ctl.limit' && limit}
					<Tooltip text={usageLimitDetail(limit)} placement="top" offset={6}>
						<span class="status-item warn" role="status">
							<span class="status-icon"><IconWarning /></span>{usageLimitLabel(limit)}
						</span>
					</Tooltip>
				{:else if pin.id === 'ctl.cost' && totalCost !== null && totalCost > 0}
					<Tooltip text={costTooltip} placement="top" offset={6}>
						<span class="status-item">
							${totalCost < 0.01 ? totalCost.toFixed(4) : totalCost.toFixed(2)}
						</span>
					</Tooltip>
				{:else if pin.id === 'ctl.context'}
					<!-- Controllo finestra di contesto pinnato nella statusLine -->
					<MenuButton
						open={contextMenuOpen}
						title={m.chat_v2_composer_context_title()}
						tooltip={session.cacheWarmingInFlight
							? `${m.chat_v2_composer_context_title()} · ${m.chat_v2_composer_modes_cache_in_flight({ phase: session.cacheWarmingInFlight.phase })}`
							: undefined}
						hasPopup="dialog"
						contentRole="dialog"
						align="right"
						width="320px"
						onToggle={() => (contextMenuOpen = !contextMenuOpen)}
						onClose={() => (contextMenuOpen = false)}
					>
						{#snippet trigger()}
							{@const maxCtx = resolveContextWindow(session.contextUsage, session.model?.contextWindow)}
							{@const used = (session.contextUsage?.tokens || 0) + draftTokens}
							{@const pct = Math.min(1, used / maxCtx)}
							{@const C = 2 * Math.PI * 7}
							<span class="context-ring-wrap">
								<svg viewBox="0 0 18 18" class="context-ring" aria-hidden="true">
									<circle cx="9" cy="9" r="7" fill="none" stroke="var(--line)" stroke-width="2.2" />
									<circle
										cx="9"
										cy="9"
										r="7"
										fill="none"
										stroke={pct > 0.85 ? 'var(--danger)' : pct > 0.6 ? 'var(--warn)' : 'var(--ink)'}
										stroke-width="2.2"
										stroke-linecap="round"
										stroke-dasharray={C}
										stroke-dashoffset={C * (1 - pct)}
									/>
								</svg>
								{#if session.cacheWarmingInFlight}
									<span class="context-warming-dot" aria-hidden="true"></span>
								{/if}
							</span>
							<span class="context-numbers font-mono tabular-nums">
								{formatTokens(used)}<span class="context-max">/{formatTokens(maxCtx)}</span>
							</span>
						{/snippet}
						{#snippet children()}
							<ContextPanel
								model={session.model}
								contextUsage={session.contextUsage}
								report={session.contextReport}
								{draftTokens}
								sessionCost={session.sessionCost}
								subagentCost={session.subagentCost}
								cacheWarmingInFlight={session.cacheWarmingInFlight}
								cacheWarmingLast={session.cacheWarmingLast}
								onCompact={() => {
									contextMenuOpen = false;
									void session.compact();
								}}
							/>
						{/snippet}
					</MenuButton>
				{:else if pin.id === 'ctl.mention'}
					<!-- Tasto menzione @ pinnato nella statusLine -->
					<Tooltip text={m.chat_v2_composer_mention_title()} placement="top" offset={6}>
						<button
							type="button"
							class="status-item"
							aria-label={m.chat_v2_composer_mention_title()}
							onclick={() => onInsertMention?.()}
						>
							<span class="status-icon"><IconAt /></span>@{m.chat_v2_composer_mention_title().toLowerCase()}
						</button>
					</Tooltip>
				{:else}
					<!-- Qualsiasi altro comando generico fissato dall'utente -->
					{@const entry = manifestMap.get(pin.id)}
					{#if entry}
						<ComposerPinnedItem
							{entry}
							form={pin.form}
							zone="statusLine"
							disabled={isPinnedDisabled(entry)}
							onActivate={onActivateCommand}
						/>
					{/if}
				{/if}
			</span>
		{/each}

		<!-- Menu di overflow se la riga supera la larghezza disponibile -->
		{#if overflowPins.length > 0}
			<span
				class="status-entry status-overflow"
				class:pushed-right={overflowPins.some((p) => p.id === 'ctl.cost')}
			>
				<ComposerOverflowMenu
					open={overflowOpen}
					onToggle={() => (overflowOpen = !overflowOpen)}
					onClose={() => (overflowOpen = false)}
				>
					{#each overflowPins as pin (pin.id)}
						{#if pin.id === 'fast'}
							<button
								type="button"
								class="overflow-menu-item"
								class:is-active={session.fastModeEnabled}
								onclick={() => {
									overflowOpen = false;
									void toggleSpeed('fast');
								}}
							>
								<IconFastMode />
								<span>{m.chat_v2_composer_modes_fast_title()}</span>
							</button>
						{:else if pin.id === 'slow'}
							<button
								type="button"
								class="overflow-menu-item"
								class:is-active={session.slowModeEnabled}
								onclick={() => {
									overflowOpen = false;
									void toggleSpeed('slow');
								}}
							>
								<IconSlowMode />
								<span>{m.chat_v2_composer_modes_slow_title()}</span>
							</button>
						{:else if pin.id === 'prewalk'}
							<button
								type="button"
								class="overflow-menu-item"
								class:is-active={prewalkState !== 'off'}
								onclick={() => {
									overflowOpen = false;
									void runPrewalk(() =>
										prewalkState === 'off' ? session.armPrewalk() : session.disarmPrewalk()
									);
								}}
							>
								<IconPrewalk />
								<span>{m.chat_v2_composer_prewalk_title()}</span>
							</button>
						{:else if pin.id === BACKGROUND_ID}
							<div class="overflow-menu-item" role="status" title={m.chat_v2_composer_status_background_tooltip()}>
								<span class="background-dot" aria-hidden="true"></span>
								<span>{m.chat_v2_composer_status_background()}</span>
							</div>
						{:else if pin.id.startsWith(EXT_PREFIX)}
							{@const key = extKey(pin.id)}
							<div class="overflow-menu-item ext-status-row" title={m.chat_v2_composer_extension_status_tooltip({ key })}>
								<span class="ext-status-key">{key}</span>
								<span class="ext-status-text">{extStatusText.get(key) ?? ''}</span>
							</div>
						{:else if pin.id === 'ctl.limit' && limit}
							<div class="overflow-menu-item warn">
								<IconWarning />
								<span>{usageLimitLabel(limit)}</span>
							</div>
						{:else if pin.id === 'ctl.cost' && totalCost !== null && totalCost > 0}
							<div class="overflow-menu-item">
								<span>${totalCost < 0.01 ? totalCost.toFixed(4) : totalCost.toFixed(2)}</span>
							</div>
						{:else if pin.id === 'ctl.mention'}
							<button
								type="button"
								class="overflow-menu-item"
								onclick={() => {
									overflowOpen = false;
									onInsertMention?.();
								}}
							>
								<IconAt />
								<span>{m.chat_v2_composer_mention_title()}</span>
							</button>
						{:else}
							{@const entry = manifestMap.get(pin.id)}
							{#if entry}
								<button
									type="button"
									class="overflow-menu-item"
									disabled={isPinnedDisabled(entry)}
									onclick={() => {
										overflowOpen = false;
										onActivateCommand?.(entry);
									}}
								>
									<span>/{entry.id}</span>
								</button>
							{/if}
						{/if}
					{/each}
				</ComposerOverflowMenu>
			</span>
		{/if}
	</div>
{/if}

<style>
	/* Fuori dal riquadro del composer, in stile riga di stato della TUI: monospazio
	   piccolo, voci separate da un punto, il costo spinto a destra. */
	.status-line {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		column-gap: 8px;
		padding: 4px 6px 0;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		min-width: 0;
		overflow: hidden;
		/* Ogni voce ha il suo punto a sinistra, dentro lo spazio fra le voci: a inizio
		   riga cade fuori dal bordo sinistro e viene tagliato. */
		clip-path: inset(-6px -6px -6px 6px);
	}

	.status-entry {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}

	.status-plan::before {
		content: none !important;
	}
	.status-plan-file .status-item {
		max-width: 260px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: inline-block;
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

	.status-overflow.pushed-right {
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

	/* Lavoro in background: un punto che respira, come il riscaldamento della
	   cache, e il testo in `--ink-muted`. Discreto: non e' un'attenzione. */
	.status-item.background {
		color: var(--ink-muted);
	}

	.background-dot {
		width: 6px;
		height: 6px;
		flex-shrink: 0;
		border-radius: var(--radius-full);
		background: var(--ink-muted);
		animation: background-breathe 1.6s ease-in-out infinite;
	}

	@keyframes background-breathe {
		50% {
			opacity: 0.3;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.background-dot {
			animation: none;
		}
	}

	/* Voce di un'estensione: testo libero, tagliato con ellissi. */
	.status-item.ext-status {
		display: inline-block;
		max-width: 240px;
		overflow: hidden;
		text-overflow: ellipsis;
		vertical-align: middle;
	}

	.ext-status-row {
		cursor: default;
		max-width: 320px;
	}

	.ext-status-key {
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.ext-status-text {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.status-target {
		color: var(--ink-muted);
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Voci del menu di overflow */
	.overflow-menu-item {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border-radius: var(--radius-md);
		background: transparent;
		border: none;
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		cursor: pointer;
		text-align: left;
		white-space: nowrap;
		--icon-size: 13px;
	}

	.overflow-menu-item:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	.overflow-menu-item:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.overflow-menu-item.is-active {
		color: var(--brand-ink);
	}

	.overflow-menu-item.warn {
		color: var(--warn);
	}

	/* Elementi SVG del contesto */
	.context-ring {
		width: 18px;
		height: 18px;
		transform: rotate(-90deg);
	}

	.context-ring-wrap {
		position: relative;
		display: inline-flex;
	}

	.context-warming-dot {
		position: absolute;
		top: -2px;
		right: -3px;
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background: var(--warn);
		border: 1.5px solid var(--bg-raised);
		animation: context-warming 1.2s ease-in-out infinite;
	}

	@keyframes context-warming {
		50% {
			opacity: 0.35;
		}
	}

	.context-numbers {
		font-size: var(--text-caption);
		color: var(--ink);
	}

	.context-max {
		color: var(--ink-faint);
	}
</style>
