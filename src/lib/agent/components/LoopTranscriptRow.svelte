<script lang="ts">
	/**
	 * Righe del /loop nel transcript (variante B):
	 * - `start`: il messaggio d'avvio, badge «/loop» + prompt + opzioni;
	 * - `sep`: separatore del giro in corso («Giro n · prompt ripetuto»);
	 * - `giro`: un giro chiuso ripiegato in una riga (titolo, esito del
	 *   controllo, durata); un clic lo apre o lo richiude;
	 * - `end`: la riga tratteggiata con l'esito della ripetizione.
	 */
	import type { LoopState } from '$lib/agent/loopMode';
	import { formatElapsed, giroDurationMs, isLoopActive } from '$lib/agent/loopMode';
	import { IconChevronRight, IconRepeat, IconCheck, IconStop, IconWarning } from '$lib/icons';
	import { m } from '$lib/paraglide/messages.js';

	let {
		kind,
		loop = null,
		n = 0,
		open = false,
		headline = '',
		prompt = '',
		onToggle
	} = $props<{
		kind: 'start' | 'sep' | 'giro' | 'end';
		loop?: LoopState | null;
		n?: number;
		open?: boolean;
		headline?: string;
		prompt?: string;
		onToggle?: () => void;
	}>();

	const giro = $derived(loop?.giri.find((g: LoopState['giri'][number]) => g.n === n) ?? null);
	const check = $derived(giro?.check ?? null);
	const duration = $derived(giro && giro.endedAt !== undefined ? giroDurationMs(giro, Date.now()) : null);

	function limitText(state: LoopState): string {
		const limit = state.limit;
		if (limit?.kind === 'iterations') {
			return limit.initial === 1 ? m.loop_limit_one_iteration() : m.loop_limit_iterations({ count: limit.initial });
		}
		if (limit?.kind === 'duration') {
			const minutes = Math.round(limit.durationMs / 60000);
			return m.loop_limit_duration({ spec: minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m` });
		}
		return m.loop_limit_none();
	}

	function betweenText(state: LoopState): string {
		const mode =
			state.between === 'compact'
				? m.loop_between_compact()
				: state.between === 'reset'
					? m.loop_between_reset()
					: m.loop_between_prompt();
		return m.loop_between_label({ mode: mode.toLowerCase() });
	}

	const endTone = $derived(loop?.status === 'done' ? 'ok' : loop?.status === 'error' ? 'bad' : 'stop');
	const endTitle = $derived(
		loop?.status === 'done' ? m.loop_done_title() : loop?.status === 'error' ? m.loop_error_title() : m.loop_stopped_title()
	);
	const endText = $derived.by(() => {
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
	const endSummary = $derived(
		loop
			? m.loop_end_summary({
					rounds: loop.giro === 1 ? m.loop_limit_one_iteration() : m.loop_limit_iterations({ count: loop.giro }),
					time: formatElapsed((loop.endedAt ?? Date.now()) - loop.startedAt)
				})
			: ''
	);
</script>

{#if kind === 'start'}
	<div class="loop-start-wrap">
		<div class="loop-start">
			<div class="loop-start-text"><span class="chat-badge chat-badge--cmd">/loop</span> {prompt}</div>
			{#if loop}
				<div class="loop-start-meta">
					{limitText(loop)} ·
					{#if loop.condition}
						{m.loop_cond_prefix()} <code class="loop-code">{loop.condition.command}</code>
						{loop.condition.until ? m.loop_cond_until_suffix() : m.loop_cond_while_suffix()}
					{:else}
						{m.loop_cond_none()}
					{/if}
					· {betweenText(loop)}
				</div>
			{/if}
		</div>
	</div>
{:else if kind === 'sep'}
	<div class="loop-sep">
		<span class="loop-sep-label font-mono"><span class="loop-ico" aria-hidden="true"><IconRepeat /></span>{m.loop_giro_label({ n })}</span>
		{#if n > 1}<span class="faint">{m.loop_giro_repeated()}</span>{/if}
	</div>
{:else if kind === 'giro'}
	<button
		type="button"
		class="loop-fold"
		class:open
		aria-expanded={open}
		aria-label={open ? m.loop_giro_collapse({ n }) : m.loop_giro_expand({ n })}
		onclick={() => onToggle?.()}
	>
		<span class="loop-chev" aria-hidden="true"><IconChevronRight /></span>
		<b class="font-mono">{m.loop_giro_label({ n })}</b>
		<span class="loop-head muted">{headline || (giro?.aborted ? m.loop_giro_aborted() : '')}</span>
		{#if check}
			<span class="loop-exit font-mono" class:good={check.exit === 0} class:bad={check.exit !== 0}>exit {check.exit ?? '?'}</span>
		{:else if giro?.aborted}
			<span class="loop-exit font-mono bad">{m.loop_giro_aborted()}</span>
		{/if}
		{#if duration !== null}
			<span class="faint small font-mono">{(duration / 1000).toFixed(1)} s</span>
		{/if}
	</button>
{:else if kind === 'end' && loop && !isLoopActive(loop)}
	<div class="loop-end loop-end-{endTone}">
		<span class="loop-ico" aria-hidden="true">
			{#if endTone === 'ok'}<IconCheck />{:else if endTone === 'bad'}<IconWarning />{:else}<IconStop />{/if}
		</span>
		<span><b>{endTitle}.</b> {endText} {endSummary}</span>
	</div>
{/if}

<style>
	.loop-start-wrap {
		display: flex;
		justify-content: flex-end;
	}

	.loop-start {
		max-width: 80%;
		padding: 10px 14px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-2xl) var(--radius-2xl) var(--radius-md) var(--radius-2xl);
		color: var(--ink);
		word-break: break-word;
	}

	.loop-start-text {
		font-size: var(--text-chat);
		line-height: 24px;
		white-space: pre-wrap;
	}

	.loop-start-meta {
		margin-top: 4px;
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.loop-code {
		font-family: var(--font-mono);
		font-size: 0.92em;
		background: var(--bg-hover);
		border-radius: var(--radius-sm);
		padding: 0 4px;
		color: var(--ink);
	}

	.loop-sep {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 6px;
		font-size: var(--text-meta);
		color: var(--ink-muted);
	}

	.loop-sep::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--line);
	}

	.loop-sep-label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-weight: 600;
		color: var(--ink);
	}

	.loop-ico {
		display: inline-flex;
		--icon-size: 11px;
	}

	.loop-fold {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 10px;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: 12.5px;
		text-align: left;
		cursor: pointer;
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.loop-fold:hover {
		border-color: var(--line-strong);
	}

	.loop-fold b {
		font-size: var(--text-sm);
		white-space: nowrap;
	}

	.loop-chev {
		display: inline-flex;
		color: var(--ink-muted);
		--icon-size: 12px;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.loop-fold.open .loop-chev {
		transform: rotate(90deg);
	}

	.loop-head {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.loop-exit {
		flex: none;
		padding: 0 6px;
		border: 1px solid currentColor;
		border-radius: var(--radius-full);
		font-size: var(--text-caption);
	}

	.loop-end {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-md);
		font-size: 12.5px;
		color: var(--ink-muted);
	}

	.loop-end b {
		color: var(--ink);
	}

	.loop-end-ok .loop-ico {
		color: var(--success);
	}

	.loop-end-bad .loop-ico,
	.loop-end-stop .loop-ico {
		color: var(--danger);
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
