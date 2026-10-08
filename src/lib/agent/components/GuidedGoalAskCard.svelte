<script lang="ts">
	/**
	 * Scheda della domanda corrente dell'obiettivo guidato, al posto del
	 * composer: risposte proposte (fisse o dell'agente), «Altro…» per scrivere
	 * la propria, Salta e Annulla. Stessa grammatica di AskCard (opzioni,
	 * «Consigliata», tasti 1–9, Invio), ma tutto resta in Studio.
	 */
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { IconTarget, IconArrowRight, IconWarning, IconSparkles } from '$lib/icons';
	import type { AgentSession } from '../session.svelte';
	import { currentQuestion, isVagueCriterion, GOAL_FIELDS, type GoalInterview } from '../guidedGoal';
	import { isImeComposing } from '../askFocus';

	let { session, interview, visible = true } = $props<{
		session: AgentSession;
		interview: GoalInterview;
		visible?: boolean;
	}>();

	const question = $derived(currentQuestion(interview));
	const isIdea = $derived(interview.phase === 'idea');
	const stepNumber = $derived(Math.min(interview.step + 1, GOAL_FIELDS.length));

	/** -1 = «Altro…». Si riparte dalla consigliata a ogni domanda. */
	let selected = $state(0);
	let other = $state('');
	let otherEl: HTMLInputElement | HTMLTextAreaElement | null = $state(null);
	let cardEl: HTMLElement | null = $state(null);
	let lastKey = '';

	$effect(() => {
		const key = `${interview.id}:${interview.phase}:${interview.step}:${question?.question ?? ''}`;
		if (key === lastKey) return;
		lastKey = key;
		const recommended = question?.options.findIndex((option) => option.recommended) ?? -1;
		selected = isIdea || !question?.options.length ? -1 : Math.max(0, recommended);
		other = '';
		if (visible) {
			void tick().then(() => {
				if (selected === -1) otherEl?.focus();
				else cardEl?.focus();
			});
		}
	});

	const otherVague = $derived(question?.field === 'criteria' && selected === -1 && isVagueCriterion(other));
	const canSend = $derived(selected === -1 ? other.trim().length > 0 : true);

	function send() {
		if (!canSend) return;
		if (isIdea || selected === -1 || !question) {
			session.answerGuidedGoal(other);
			return;
		}
		const option = question.options[selected];
		if (option) session.answerGuidedGoal(option.value);
	}

	function onKeydown(event: KeyboardEvent) {
		if (isImeComposing(event)) return;
		const target = event.target as HTMLElement | null;
		const typing = target === otherEl;
		if (event.key === 'Escape') {
			event.preventDefault();
			session.cancelGuidedGoal();
			return;
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			send();
			return;
		}
		if (typing || !question) return;
		const digit = Number(event.key);
		if (Number.isInteger(digit) && digit >= 1 && digit <= question.options.length) {
			event.preventDefault();
			selected = digit - 1;
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const count = question.options.length + 1;
			const index = selected === -1 ? question.options.length : selected;
			const next = (index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
			selected = next === question.options.length ? -1 : next;
			if (selected === -1) void tick().then(() => otherEl?.focus());
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	bind:this={cardEl}
	class="ask-card gg-ask"
	role="group"
	tabindex="0"
	aria-label={m.guided_goal_ask_aria()}
	onkeydown={onKeydown}
>
	<div class="ask-head">
		<span class="gg-icon" aria-hidden="true"><IconTarget /></span>
		<p class="ask-text gg-q">{isIdea ? m.guided_goal_q_idea() : question?.question}</p>
		{#if !isIdea}
			<span class="ask-counter">{stepNumber}/{GOAL_FIELDS.length}</span>
		{/if}
	</div>
	<p class="ask-detail">
		{isIdea ? m.guided_goal_ask_idea_hint() : m.guided_goal_ask_hint()}
		{#if interview.agent === 'pending'}
			<span class="gg-agent"><IconSparkles aria-hidden="true" /> {m.guided_goal_agent_pending()}</span>
		{:else if question?.fromAgent}
			<span class="gg-agent done"><IconSparkles aria-hidden="true" /> {m.guided_goal_agent_ready()}</span>
		{/if}
	</p>

	{#if isIdea}
		<textarea
			bind:this={otherEl}
			class="gg-other-input"
			rows="2"
			placeholder={m.guided_goal_idea_placeholder()}
			bind:value={other}
		></textarea>
	{:else if question}
		<div class="ask-options" role="radiogroup" aria-label={question.question}>
			{#each question.options as option, i (`${interview.step}-${i}`)}
				<div
					class="ask-opt"
					class:selected={selected === i}
					role="radio"
					aria-checked={selected === i}
					tabindex="-1"
					onclick={() => (selected = i)}
					onkeydown={(event) => {
						if (event.key === ' ') {
							event.preventDefault();
							selected = i;
						}
					}}
				>
					<span class="gg-radio" aria-hidden="true"><span class="dot"></span></span>
					<span class="ask-opt-body">
						<span class="ask-opt-label">
							{option.label}
							{#if option.recommended}<span class="ask-rec">{m.chat_v2_ask_recommended()}</span>{/if}
						</span>
						{#if option.description}<span class="ask-opt-desc">{option.description}</span>{/if}
					</span>
					{#if i < 9}<kbd class="ui-kbd" aria-hidden="true">{i + 1}</kbd>{/if}
				</div>
			{/each}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="ask-opt gg-other"
				class:selected={selected === -1}
				role="radio"
				aria-checked={selected === -1}
				tabindex="-1"
				onclick={() => {
					selected = -1;
					void tick().then(() => otherEl?.focus());
				}}
			>
				<span class="gg-radio" aria-hidden="true"><span class="dot"></span></span>
				<input
					bind:this={otherEl}
					class="gg-other-input"
					placeholder={m.guided_goal_other_placeholder()}
					bind:value={other}
					onfocus={() => (selected = -1)}
				/>
			</div>
		</div>
		{#if otherVague}
			<p class="gg-vague" role="status"><IconWarning aria-hidden="true" /> {m.guided_goal_vague_hint()}</p>
		{/if}
	{/if}

	<div class="ask-foot">
		<button type="button" class="ask-btn" onclick={() => session.cancelGuidedGoal()}>
			{m.guided_goal_cancel()} <kbd class="ui-kbd">Esc</kbd>
		</button>
		{#if !isIdea}
			<button type="button" class="ask-btn" onclick={() => session.skipGuidedGoalQuestion()}>{m.guided_goal_skip()}</button>
		{/if}
		<span class="ask-actions">
			<button type="button" class="ask-btn primary" disabled={!canSend} onclick={send}>
				{m.guided_goal_answer()} <IconArrowRight aria-hidden="true" />
			</button>
		</span>
	</div>
</div>

<style>
	/* Stessa scheda della domanda di omp (AskCard), ripresa qui con le sue misure. */
	.ask-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-2xl);
		padding: var(--space-3) var(--space-4) 0;
		min-width: 0;
		max-height: 58vh;
		overflow-y: auto;
		outline: none;
		box-shadow: var(--shadow-raise);
	}
	.ask-card > * {
		flex-shrink: 0;
	}
	.ask-head {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		min-width: 0;
	}
	.gg-icon {
		display: inline-flex;
		color: var(--brand-ink);
		--icon-size: 16px;
		margin-top: 3px;
	}
	.gg-q {
		flex: 1;
		min-width: 0;
	}
	.ask-detail {
		margin-top: calc(-1 * var(--space-2));
	}
	.gg-agent {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: var(--space-2);
		color: var(--ink-faint);
		--icon-size: 12px;
	}
	.gg-agent.done {
		color: var(--brand-ink);
	}
	.gg-radio {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		margin-top: 2px;
		flex-shrink: 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-full);
	}
	.gg-radio .dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: transparent;
	}
	.ask-opt.selected .gg-radio {
		background: var(--brand);
		border-color: var(--brand);
	}
	.ask-opt.selected .gg-radio .dot {
		background: var(--on-brand);
	}
	.gg-other {
		align-items: center;
	}
	.gg-other-input {
		flex: 1;
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		padding: 6px 10px;
		font-size: var(--text-sm);
		font-family: var(--font-ui);
		color: var(--ink);
		resize: vertical;
	}
	.gg-other-input:focus {
		border-color: var(--brand);
		outline: none;
	}
	.gg-vague {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: calc(-1 * var(--space-1)) 0 0;
		font-size: var(--text-xs);
		color: var(--warn);
		--icon-size: 12px;
	}
	.ask-foot {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 calc(-1 * var(--space-4));
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--line);
		background: color-mix(in oklab, var(--bg-sunken) 45%, var(--bg-raised));
	}
	.ask-actions {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.ask-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		padding: 5px 12px;
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		color: var(--ink-muted);
		cursor: pointer;
		white-space: nowrap;
		--icon-size: 12px;
	}
	.ask-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}
	.ask-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.ask-btn.primary {
		background: var(--brand);
		border-color: var(--brand);
		color: var(--on-brand);
		font-weight: 600;
		padding: 5px 14px;
	}
	.ask-btn.primary:hover:not(:disabled) {
		filter: brightness(1.08);
	}
</style>
