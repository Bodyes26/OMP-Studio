<script lang="ts">
	/**
	 * Composer in modalita' ripetizione (/loop, variante B del prototipo).
	 *
	 * Prima dell'avvio: pillole con menu a tendina (limite, condizione con
	 * «Prova ora», cosa fare tra i giri), il prompt da ripetere e l'anteprima
	 * della riga `/loop …`. Avviato, lo stesso riquadro diventa il pannello di
	 * controllo: barra a segmenti per giro, contatore grande, Pausa (a fine
	 * giro) / Riprendi / Stop (immediato) al posto di Invia. Il motore e'
	 * l'estensione `studio-loop.ts` in omp: qui si legge `session.loop` e si
	 * mandano comandi, nessuno stato del loop vive nel componente.
	 */
	import type { AgentSession } from '$lib/agent/session.svelte';
	import {
		LOOP_LIMIT_PRESETS,
		draftCommand,
		formatElapsed,
		isLoopActive,
		loopSegments,
		sameLimit,
		type LoopBetween,
		type LoopConditionMode,
		type LoopDraft,
		type LoopLimitDraft,
		type LoopState
	} from '$lib/agent/loopMode';
	import { IconRepeat, IconChevronDown, IconCheck, IconClose, IconPause, IconPlay, IconStop } from '$lib/icons';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { m } from '$lib/paraglide/messages.js';

	let { session, visible = true } = $props<{ session: AgentSession; visible?: boolean }>();

	type Menu = 'limit' | 'cond' | 'between' | null;
	let menu = $state<Menu>(null);
	let rootEl = $state<HTMLDivElement | null>(null);
	let promptEl = $state<HTMLTextAreaElement | null>(null);

	const draft = $derived(session.loopSetup as LoopDraft | null);
	const loop = $derived(session.loop as LoopState | null);
	const active = $derived(isLoopActive(loop));
	const preview = $derived(draft ? draftCommand(draft) : null);
	// A turno in corso il primo giro diventerebbe uno steer: si avvia a agente fermo.
	const canStart = $derived(Boolean(draft && preview && draft.prompt.trim() && !session.isStreaming));

	// Orologio del pannello: solo mentre il loop e' vivo.
	let now = $state(Date.now());
	$effect(() => {
		if (!active) {
			now = Date.now();
			return;
		}
		const timer = window.setInterval(() => (now = Date.now()), 1000);
		return () => window.clearInterval(timer);
	});

	// Il prompt prende il fuoco quando si entra in modalita' ripetizione.
	$effect(() => {
		if (visible && draft && promptEl && document.activeElement !== promptEl) {
			promptEl.focus();
		}
	});

	// Clic fuori: chiude il menu della pillola.
	$effect(() => {
		if (!menu) return;
		const onDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (rootEl && target && !rootEl.contains(target)) menu = null;
			else if (target instanceof Element && !target.closest('.loop-pill-wrap')) menu = null;
		};
		window.addEventListener('pointerdown', onDown, true);
		return () => window.removeEventListener('pointerdown', onDown, true);
	});

	function update(patch: Partial<LoopDraft>) {
		if (!draft) return;
		session.loopSetup = { ...draft, ...patch };
	}

	function limitLabel(limit: LoopLimitDraft): string {
		if (limit.kind === 'iterations') {
			return limit.count === 1 ? m.loop_limit_one_iteration() : m.loop_limit_iterations({ count: limit.count });
		}
		if (limit.kind === 'duration') return m.loop_limit_duration({ spec: limit.spec });
		return m.loop_limit_none();
	}

	function betweenLabel(mode: LoopBetween): string {
		return mode === 'compact' ? m.loop_between_compact() : mode === 'reset' ? m.loop_between_reset() : m.loop_between_prompt();
	}

	function betweenDesc(mode: LoopBetween): string {
		return mode === 'compact'
			? m.loop_between_compact_desc()
			: mode === 'reset'
				? m.loop_between_reset_desc()
				: m.loop_between_prompt_desc();
	}

	function condOptionLabel(mode: LoopConditionMode): string {
		return mode === 'until' ? m.loop_cond_until() : mode === 'while' ? m.loop_cond_while() : m.loop_cond_none();
	}

	function pickLimit(limit: LoopLimitDraft) {
		update({ limit });
		menu = null;
	}

	async function start() {
		if (!draft || !canStart) return;
		menu = null;
		await session.startLoop(draft);
	}

	function onPromptKey(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			void start();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			if (menu) menu = null;
			else session.closeLoopSetup();
		}
	}

	function onPanelKey(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		if (menu) {
			menu = null;
			event.preventDefault();
			return;
		}
		// Come Esc nella TUI: mette in pausa (qui a fine giro), non ferma.
		if (loop && active && loop.status !== 'paused' && !loop.pauseRequested) {
			event.preventDefault();
			void session.pauseLoop();
		}
	}

	function probe() {
		const command = draft ? draft.command : loop?.condition?.command;
		if (command) void session.probeLoopCondition(command);
	}

	const probe$ = $derived(session.loopProbe);
	const probeCondition = $derived(
		draft ? (draft.condition === 'none' ? null : { until: draft.condition === 'until' }) : loop?.condition ?? null
	);
	/** Cosa farebbe il loop con l'esito della prova. */
	const probeVerdict = $derived.by(() => {
		const p = probe$;
		if (!p || p.running || !probeCondition) return null;
		if (p.timedOut) return { tone: 'bad', text: m.loop_probe_timeout() };
		if (p.exit !== 0 && p.exit !== 1) return { tone: 'bad', text: m.loop_probe_broken() };
		const stops = probeCondition.until ? p.exit === 0 : p.exit === 1;
		return { tone: stops ? 'good' : 'muted', text: stops ? m.loop_probe_stop() : m.loop_probe_continue() };
	});

	/* ------------------------------------------------------- pannello */

	const total = $derived(loop?.limit?.kind === 'iterations' ? loop.limit.initial : null);
	const segments = $derived(loop ? loopSegments(loop) : []);
	const elapsed = $derived(loop ? formatElapsed((loop.endedAt ?? now) - loop.startedAt) : '');

	const title = $derived.by(() => {
		if (!loop || active) return m.loop_running_title();
		if (loop.status === 'done') return m.loop_done_title();
		if (loop.status === 'error') return m.loop_error_title();
		return m.loop_stopped_title();
	});

	const badge = $derived.by((): { text: string; tone: string } => {
		if (!loop) return { text: '', tone: '' };
		switch (loop.status) {
			case 'running':
				return loop.pauseRequested
					? { text: m.loop_badge_pause_pending(), tone: 'warn' }
					: { text: m.loop_badge_running(), tone: 'live' };
			case 'checking':
				return { text: m.loop_badge_checking(), tone: 'live' };
			case 'waiting':
				return { text: m.loop_badge_waiting(), tone: 'live' };
			case 'resetting':
				return { text: m.loop_badge_resetting(), tone: 'live' };
			case 'paused':
				return { text: m.loop_badge_paused(), tone: '' };
			case 'armed':
				return { text: m.loop_badge_armed(), tone: '' };
			case 'done':
				return { text: m.loop_badge_done(), tone: 'ok' };
			case 'error':
				return { text: m.loop_badge_error(), tone: 'bad' };
			default:
				return { text: m.loop_badge_stopped(), tone: '' };
		}
	});

	const lastCheck = $derived.by(() => {
		if (!loop) return null;
		for (let i = loop.giri.length - 1; i >= 0; i--) {
			const check = loop.giri[i].check;
			if (check) return check;
		}
		return null;
	});

	function roundsLabel(n: number): string {
		return n === 1 ? m.loop_limit_one_iteration() : m.loop_limit_iterations({ count: n });
	}

	const endMessage = $derived.by(() => {
		if (!loop?.end) return '';
		const cmd = loop.condition?.command ?? '';
		switch (loop.end.reason) {
			case 'limit':
				return m.loop_end_limit({ count: loop.limit?.kind === 'iterations' ? loop.limit.initial : loop.giro });
			case 'duration':
				return m.loop_end_duration();
			case 'condition':
				return loop.condition?.until
					? m.loop_end_condition_until({ cmd })
					: m.loop_end_condition_while({ cmd, exit: String(loop.end.exit ?? 1) });
			case 'condition-timeout':
				return m.loop_end_timeout({ cmd });
			case 'condition-error':
				return m.loop_end_error({ cmd, exit: String(loop.end.exit ?? '?'), detail: loop.end.detail ?? '' });
			default:
				return m.loop_end_stopped({ giro: loop.giro });
		}
	});
</script>

{#snippet condText(cmd: string, until: boolean)}
	{m.loop_cond_prefix()} <code class="loop-code">{cmd}</code>
	{until ? m.loop_cond_until_suffix() : m.loop_cond_while_suffix()}
{/snippet}

{#snippet probeLine()}
	{#if probe$?.running}
		<span class="loop-probe muted"><span class="loop-spin" aria-hidden="true"></span>{m.loop_probe_running()}</span>
	{:else if probe$ && probeVerdict}
		<span class="loop-probe">
			<span class="font-mono" class:bad={probe$.exit !== 0} class:good={probe$.exit === 0}>exit {probe$.exit ?? '?'}</span>
			{#if probe$.out}<span class="muted"> · {probe$.out}</span>{/if}
			<span class="muted"> → </span><span class={probeVerdict.tone}>{probeVerdict.text}</span>
		</span>
	{/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={rootEl}
	class="loop-root"
	class:hidden={!visible}
	onkeydown={onPanelKey}
>
	{#if draft}
		<!-- Modalita' ripetizione: le opzioni sono pillole dentro il composer. -->
		<div class="composer-shell loop-shell" role="group" aria-label={m.loop_title()}>
			<div class="loop-head">
				<span class="loop-head-icon" aria-hidden="true"><IconRepeat /></span>
				<b class="loop-head-title">{m.loop_title()}</b>

				<div class="loop-pill-wrap">
					<button
						type="button"
						class="loop-pill"
						class:on={menu === 'limit'}
						aria-haspopup="menu"
						aria-expanded={menu === 'limit'}
						onclick={() => (menu = menu === 'limit' ? null : 'limit')}
					>
						{limitLabel(draft.limit)}<span class="loop-pill-chev"><IconChevronDown /></span>
					</button>
					{#if menu === 'limit'}
						<div class="loop-menu" role="menu">
							{#each LOOP_LIMIT_PRESETS as preset}
								{@const on = sameLimit(preset, draft.limit)}
								<button type="button" role="menuitemradio" aria-checked={on} class="loop-mi" class:on onclick={() => pickLimit(preset)}>
									<span class="loop-mi-check">{#if on}<IconCheck />{/if}</span>{limitLabel(preset)}
								</button>
							{/each}
							<div class="loop-menu-fields">
								{#if draft.limit.kind === 'iterations'}
									<input
										class="ui-input loop-num font-mono"
										type="number"
										min="1"
										value={draft.limit.count}
										aria-label={m.loop_limit_count_hint()}
										oninput={(e) => update({ limit: { kind: 'iterations', count: Math.max(1, Math.floor(+e.currentTarget.value || 1)) } })}
									/>
									<span class="muted small">{m.loop_limit_count_hint()}</span>
								{:else if draft.limit.kind === 'duration'}
									<input
										class="ui-input loop-num font-mono"
										value={draft.limit.spec}
										aria-label={m.loop_limit_duration_hint()}
										oninput={(e) => update({ limit: { kind: 'duration', spec: e.currentTarget.value } })}
									/>
									<span class="muted small">{m.loop_limit_duration_hint()}</span>
								{/if}
							</div>
						</div>
					{/if}
				</div>

				<div class="loop-pill-wrap">
					<button
						type="button"
						class="loop-pill"
						class:on={menu === 'cond'}
						aria-haspopup="menu"
						aria-expanded={menu === 'cond'}
						onclick={() => (menu = menu === 'cond' ? null : 'cond')}
					>
						{#if draft.condition === 'none'}
							{m.loop_cond_none()}
						{:else}
							{@render condText(draft.command || '…', draft.condition === 'until')}
						{/if}
						<span class="loop-pill-chev"><IconChevronDown /></span>
					</button>
					{#if menu === 'cond'}
						<div class="loop-menu wide" role="menu">
							{#each ['until', 'while', 'none'] as const as mode}
								{@const on = draft.condition === mode}
								<button type="button" role="menuitemradio" aria-checked={on} class="loop-mi" class:on onclick={() => update({ condition: mode })}>
									<span class="loop-mi-check">{#if on}<IconCheck />{/if}</span>{condOptionLabel(mode)}
								</button>
							{/each}
							{#if draft.condition !== 'none'}
								<div class="loop-menu-fields">
									<input
										class="ui-input loop-cmd font-mono"
										value={draft.command}
										aria-label={m.loop_cond_command_label()}
										placeholder="npm test"
										oninput={(e) => update({ command: e.currentTarget.value })}
										onkeydown={(e) => {
											if (e.key === 'Enter') {
												e.preventDefault();
												probe();
											}
										}}
									/>
									<Tooltip text={m.loop_probe_hint()} placement="top" offset={6}>
										<button type="button" class="ui-button ui-button-secondary loop-sm" disabled={!draft.command.trim()} onclick={probe}>
											{m.loop_probe()}
										</button>
									</Tooltip>
								</div>
								<div class="loop-menu-probe">{@render probeLine()}</div>
							{/if}
						</div>
					{/if}
				</div>

				<div class="loop-pill-wrap">
					<button
						type="button"
						class="loop-pill"
						class:on={menu === 'between'}
						aria-haspopup="menu"
						aria-expanded={menu === 'between'}
						onclick={() => (menu = menu === 'between' ? null : 'between')}
					>
						{m.loop_between_label({ mode: betweenLabel(draft.between).toLowerCase() })}<span class="loop-pill-chev"><IconChevronDown /></span>
					</button>
					{#if menu === 'between'}
						<div class="loop-menu wide" role="menu">
							{#each ['prompt', 'compact', 'reset'] as const as mode}
								{@const on = draft.between === mode}
								<button
									type="button"
									role="menuitemradio"
									aria-checked={on}
									class="loop-mi"
									class:on
									onclick={() => {
										update({ between: mode });
										menu = null;
									}}
								>
									<span class="loop-mi-check">{#if on}<IconCheck />{/if}</span>
									<span class="loop-mi-body">
										<span>{betweenLabel(mode)}</span>
										<span class="faint small">{betweenDesc(mode)}</span>
									</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<span class="loop-spacer"></span>
				<Tooltip text={m.loop_exit_setup()} placement="top" offset={6}>
					<button type="button" class="composer-icon-btn loop-x" aria-label={m.loop_exit_setup()} onclick={() => session.closeLoopSetup()}>
						<IconClose />
					</button>
				</Tooltip>
			</div>

			<textarea
				bind:this={promptEl}
				class="loop-prompt"
				rows="2"
				value={draft.prompt}
				placeholder={m.loop_prompt_placeholder()}
				oninput={(e) => update({ prompt: e.currentTarget.value })}
				onkeydown={onPromptKey}
			></textarea>

			<div class="composer-toolbar loop-tool">
				<span class="loop-preview font-mono" title={preview ?? ''}>{preview ?? ''}</span>
				<Tooltip text={canStart ? (preview ?? '') : session.isStreaming ? m.loop_start_busy() : m.loop_start_hint()} placement="top" offset={6}>
					<button type="button" class="ui-button ui-button-primary loop-start" disabled={!canStart} onclick={() => void start()}>
						<span class="loop-btn-icon" aria-hidden="true"><IconRepeat /></span>{m.loop_start()}
					</button>
				</Tooltip>
			</div>
		</div>
	{:else if loop}
		<!-- Avviato: il composer e' il pannello di controllo. -->
		<div
			class="composer-shell loop-shell running"
			class:paused={loop.status === 'paused'}
			role="region"
			aria-label={m.loop_panel_aria()}
		>
			<div
				class="loop-segbar"
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={total ?? segments.length}
				aria-valuenow={loop.giro}
				aria-label={m.loop_segments_aria({ giro: loop.giro, total: total ?? '∞' })}
			>
				{#each segments as seg, i (i)}
					<i class="seg seg-{seg}"></i>
				{/each}
			</div>

			<div class="loop-run">
				<span class="loop-big font-mono tabular-nums">{loop.giro}<span class="loop-big-total">/{total ?? '∞'}</span></span>
				<div class="loop-run-body">
					<div class="loop-run-row">
						<b class="loop-run-title">{title}</b>
						<span class="loop-badge loop-badge-{badge.tone}">{badge.text}</span>
						<span class="font-mono faint loop-elapsed tabular-nums">{elapsed}</span>
					</div>
					<div class="loop-sub">
						{#if active}
							{#if loop.restored}
								<span>{m.loop_restored()}</span>
							{:else if loop.condition}
								{@render condText(loop.condition.command, loop.condition.until)}
								<span class="faint"> · </span>
								{#if loop.status === 'checking'}
									<span class="loop-spin" aria-hidden="true"></span>{m.loop_checking()}
								{:else if lastCheck}
									{m.loop_last_check()} <code class="loop-code">{loop.condition.command}</code> →
									<span class:bad={lastCheck.exit !== 0} class:good={lastCheck.exit === 0}>exit {lastCheck.exit ?? '?'}</span>
									{#if lastCheck.out}<span class="faint"> · </span>{lastCheck.out}{/if}
								{:else}
									{m.loop_check_first()}
								{/if}
							{:else}
								{m.loop_no_condition()}
							{/if}
							{#if probe$ && !probe$.running && probeVerdict}
								<span class="faint"> · </span>{m.loop_probe()}: {@render probeLine()}
							{:else if probe$?.running}
								<span class="faint"> · </span>{@render probeLine()}
							{/if}
						{:else}
							{endMessage}
							{m.loop_end_summary({ rounds: roundsLabel(loop.giro), time: elapsed })}
						{/if}
					</div>
				</div>
			</div>

			<div class="composer-toolbar loop-tool sep">
				<span class="loop-echo" title={loop.prompt ?? ''}>
					<span class="loop-btn-icon" aria-hidden="true"><IconRepeat /></span>«{loop.prompt ?? ''}»
				</span>
				{#if active}
					{#if loop.condition}
						<Tooltip text={m.loop_probe_hint()} placement="top" offset={6}>
							<button type="button" class="ui-button ui-button-ghost loop-sm" disabled={probe$?.running} onclick={probe}>
								{m.loop_probe()}
							</button>
						</Tooltip>
					{/if}
					{#if loop.status === 'paused' || loop.status === 'armed'}
						<Tooltip text={m.loop_resume_hint()} placement="top" offset={6}>
							<button type="button" class="ui-button ui-button-secondary loop-sm" disabled={loop.status === 'armed'} onclick={() => void session.resumeLoop()}>
								<span class="loop-btn-icon" aria-hidden="true"><IconPlay /></span>{m.loop_resume()}
							</button>
						</Tooltip>
					{:else}
						<Tooltip text={m.loop_pause_hint()} placement="top" offset={6}>
							<button
								type="button"
								class="ui-button ui-button-secondary loop-sm"
								class:on={loop.pauseRequested}
								aria-pressed={loop.pauseRequested}
								onclick={() => void session.pauseLoop()}
							>
								<span class="loop-btn-icon" aria-hidden="true"><IconPause /></span>
								{loop.pauseRequested ? m.loop_pause_cancel() : m.loop_pause()}
							</button>
						</Tooltip>
					{/if}
					<Tooltip text={m.loop_stop_hint()} placement="top" offset={6}>
						<button type="button" class="ui-button ui-button-secondary loop-sm loop-stop" onclick={() => void session.stopLoop()}>
							<span class="loop-btn-icon" aria-hidden="true"><IconStop /></span>{m.loop_stop()}
						</button>
					</Tooltip>
				{:else}
					<button type="button" class="ui-button ui-button-secondary loop-sm" onclick={() => void session.dismissLoop()}>
						{m.loop_close()}
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.loop-root {
		position: relative;
		width: 100%;
		min-width: 0;
	}

	.loop-root.hidden {
		display: none;
	}

	/* Bordo nella tinta del brand: si vede subito che non e' il composer normale. */
	.loop-shell,
	.loop-shell:focus-within {
		border-color: color-mix(in oklch, var(--brand) 55%, transparent);
	}

	.loop-head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		padding: 8px 8px 0 14px;
		font-size: var(--text-sm);
	}

	.loop-head-icon {
		display: inline-flex;
		color: var(--brand-ink);
		--icon-size: 13px;
	}

	.loop-head-title {
		margin-right: 4px;
		font-weight: 600;
		color: var(--ink);
	}

	.loop-spacer {
		flex: 1;
	}

	.loop-x {
		width: 24px;
		height: 24px;
		--icon-size: 13px;
	}

	.loop-pill-wrap {
		position: relative;
	}

	.loop-pill {
		height: 26px;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 0 9px;
		border-radius: var(--radius-full);
		border: 1px solid var(--line-strong);
		background: var(--bg-base);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		white-space: nowrap;
		cursor: pointer;
		transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
	}

	.loop-pill:hover,
	.loop-pill.on {
		border-color: color-mix(in oklch, var(--brand) 60%, transparent);
		background: color-mix(in oklch, var(--brand) 10%, var(--bg-base));
	}

	.loop-pill-chev {
		display: inline-flex;
		color: var(--ink-muted);
		--icon-size: 11px;
	}

	.loop-code {
		font-family: var(--font-mono);
		font-size: 0.92em;
		background: var(--bg-hover);
		border-radius: var(--radius-sm);
		padding: 0 4px;
		color: var(--ink);
	}

	.loop-menu {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 0;
		z-index: 30;
		min-width: 170px;
		padding: 4px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		animation: rv-lift-in 160ms var(--ease-reveal) backwards;
	}

	.loop-menu.wide {
		min-width: 330px;
	}

	.loop-mi {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: 12.5px;
		text-align: left;
		cursor: pointer;
	}

	.loop-mi:hover {
		background: var(--bg-hover);
	}

	.loop-mi.on {
		font-weight: 600;
	}

	.loop-mi-check {
		display: inline-flex;
		width: 12px;
		flex: none;
		--icon-size: 12px;
	}

	.loop-mi-body {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.loop-menu-fields {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px 4px;
		border-top: 1px solid var(--line);
		margin-top: 4px;
	}

	.loop-menu-probe {
		padding: 2px 8px 6px;
		min-height: 18px;
		font-size: var(--text-meta);
	}

	.loop-num {
		width: 76px;
		flex: none;
	}

	.loop-cmd {
		flex: 1;
		min-width: 0;
	}

	.loop-prompt {
		display: block;
		width: 100%;
		min-height: 0;
		padding: 10px 14px 6px;
		border: none;
		outline: none;
		resize: none;
		background: transparent;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-chat);
		line-height: 1.55;
	}

	.loop-prompt::placeholder {
		color: var(--ink-faint);
	}

	.loop-tool {
		gap: 6px;
		padding: 2px 8px 8px;
	}

	.loop-tool.sep {
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid var(--line);
	}

	.loop-preview {
		flex: 1;
		min-width: 0;
		padding: 0 8px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: var(--text-meta);
		color: var(--ink-faint);
	}

	.loop-start {
		margin-left: auto;
	}

	.loop-btn-icon {
		display: inline-flex;
		--icon-size: 12px;
	}

	.loop-sm {
		padding: 4px 10px;
		gap: 5px;
		white-space: nowrap;
	}

	.loop-sm.on {
		background: var(--bg-active);
	}

	.loop-stop {
		color: var(--danger);
		border-color: color-mix(in oklch, var(--danger) 45%, transparent);
	}

	.loop-stop:hover:not(:disabled) {
		background: color-mix(in oklch, var(--danger) 12%, transparent);
		border-color: var(--danger);
	}

	/* Pannello di controllo */
	.loop-segbar {
		display: flex;
		gap: 3px;
		padding: 10px 14px 0;
	}

	.seg {
		flex: 1;
		height: 5px;
		border-radius: 3px;
		background: var(--line-strong);
	}

	.seg-done {
		background: var(--ink-muted);
	}

	.seg-ok {
		background: var(--success);
	}

	.seg-cur {
		background: var(--brand);
		animation: loop-pulse 1.4s ease-in-out infinite;
	}

	.seg-stop,
	.seg-fail {
		background: var(--danger);
	}

	.loop-shell.paused .seg-cur {
		animation: none;
	}

	@keyframes loop-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.45;
		}
	}

	.loop-run {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 14px 2px;
	}

	.loop-big {
		font-size: 26px;
		font-weight: 600;
		line-height: 1;
		color: var(--ink);
	}

	.loop-big-total {
		font-size: 16px;
		color: var(--ink-faint);
	}

	.loop-run-body {
		flex: 1;
		min-width: 0;
	}

	.loop-run-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-base);
	}

	.loop-run-title {
		font-weight: 600;
		color: var(--ink);
	}

	.loop-elapsed {
		font-size: var(--text-meta);
	}

	.loop-badge {
		display: inline-flex;
		align-items: center;
		padding: 0 7px;
		border-radius: var(--radius-full);
		border: 1px solid var(--line-strong);
		font-size: var(--text-caption);
		line-height: 1.5;
		color: var(--ink-muted);
	}

	.loop-badge-live {
		color: var(--warn);
		border-color: color-mix(in oklch, var(--warn) 55%, transparent);
	}

	.loop-badge-warn {
		color: var(--warn);
		border-color: color-mix(in oklch, var(--warn) 55%, transparent);
		background: color-mix(in oklch, var(--warn) 10%, transparent);
	}

	.loop-badge-ok {
		color: var(--success);
		border-color: color-mix(in oklch, var(--success) 55%, transparent);
	}

	.loop-badge-bad {
		color: var(--danger);
		border-color: color-mix(in oklch, var(--danger) 55%, transparent);
	}

	.loop-sub {
		margin-top: 2px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.loop-echo {
		flex: 1;
		min-width: 0;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding-left: 6px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: var(--text-sm);
		color: var(--ink-faint);
	}

	.loop-probe {
		white-space: nowrap;
	}

	.loop-spin {
		display: inline-block;
		width: 10px;
		height: 10px;
		margin-right: 5px;
		vertical-align: -1px;
		border: 1.5px solid var(--line-strong);
		border-top-color: var(--brand);
		border-radius: 50%;
		animation: loop-spin 0.9s linear infinite;
	}

	@keyframes loop-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.seg-cur,
		.loop-spin {
			animation: none;
		}
	}

	.muted {
		color: var(--ink-muted);
	}

	.faint {
		color: var(--ink-faint);
	}

	.small {
		font-size: var(--text-meta);
	}

	.good {
		color: var(--success);
	}

	.bad {
		color: var(--danger);
	}
</style>
