<script lang="ts">
	/**
	 * Un passo dell'intervista dell'obiettivo guidato nel transcript: il comando,
	 * le domande (voce dell'agente), le risposte (bolle dell'utente), la bozza e
	 * la riga «Obiettivo avviato». Vive solo in Studio: niente di questo arriva
	 * a omp finche' non si preme «Avvia obiettivo».
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { IconTarget, IconClose } from '$lib/icons';
	import type { AgentSession, GuidedGoalEntry } from '../session.svelte';
	import GuidedGoalDraftCard from './GuidedGoalDraftCard.svelte';

	let { entry, session } = $props<{ entry: GuidedGoalEntry; session: AgentSession }>();

	const interview = $derived(
		session.guidedGoal && session.guidedGoal.id === entry.interviewId ? session.guidedGoal : null
	);
</script>

{#if entry.part === 'command'}
	<div class="gg-user">
		<div class="gg-bubble">
			<span class="gg-cmd font-mono">/guided-goal</span>
			{#if entry.text}<span>{entry.text}</span>{/if}
		</div>
	</div>
{:else if entry.part === 'answer'}
	<div class="gg-user">
		<div class="gg-bubble small">{entry.text}</div>
	</div>
{:else if entry.part === 'question'}
	<p class="gg-question">{entry.text}</p>
{:else if entry.part === 'draft'}
	{#if interview}
		<GuidedGoalDraftCard {session} {interview} />
	{:else}
		<p class="gg-note">{m.guided_goal_draft_gone()}</p>
	{/if}
{:else if entry.part === 'started'}
	<div class="gg-sysrow" role="status">
		<span class="gg-sys-icon" aria-hidden="true"><IconTarget /></span>
		<span><b>{m.guided_goal_started_label()}</b> {entry.text}</span>
	</div>
{:else}
	<div class="gg-sysrow muted" role="status">
		<span class="gg-sys-icon" aria-hidden="true"><IconClose /></span>
		<span>{entry.text}</span>
	</div>
{/if}

<style>
	.gg-user {
		display: flex;
		justify-content: flex-end;
		margin-left: auto;
		max-width: 80%;
		min-width: 0;
	}
	.gg-bubble {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-2xl) var(--radius-2xl) var(--radius-md) var(--radius-2xl);
		padding: 10px 14px;
		color: var(--ink);
		font-size: var(--text-chat);
		line-height: 24px;
		word-break: break-word;
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.gg-bubble.small {
		padding: 7px 12px;
	}
	.gg-cmd {
		font-size: var(--text-xs);
		color: var(--ink);
		background: var(--bg-active, var(--bg-hover));
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 0 6px;
		line-height: 20px;
	}
	.gg-question {
		margin: 0;
		font-size: var(--text-prose);
		line-height: 28px;
		color: var(--ink);
	}
	.gg-note {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}
	.gg-sysrow {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px 12px;
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-lg);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}
	.gg-sysrow b {
		color: var(--ink);
		font-weight: 600;
	}
	.gg-sys-icon {
		display: inline-flex;
		color: var(--brand-ink);
		--icon-size: 14px;
	}
	.gg-sysrow.muted .gg-sys-icon {
		color: var(--ink-faint);
	}
</style>
