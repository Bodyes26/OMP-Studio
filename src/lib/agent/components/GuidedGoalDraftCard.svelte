<script lang="ts">
	/**
	 * Bozza dell'obiettivo alla fine dell'intervista: si legge come una card nel
	 * transcript e si corregge sul posto («Modifica»). I controlli (criterio vago,
	 * tetto mancante, verifica assente) tengono spento «Avvia obiettivo» finche'
	 * non sono risolti; confini e stop mancanti sono solo consigli.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { IconTarget, IconPencil, IconCheck, IconWarning, IconInfo } from '$lib/icons';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import type { AgentSession } from '../session.svelte';
	import {
		canLaunch,
		draftIssues,
		formatCap,
		isVagueCriterion,
		parseBoundaries,
		splitItems,
		type GoalDraft,
		type GoalInterview
	} from '../guidedGoal';
	import { lexMarkdownInline } from '../markdown';
	import MarkdownInline from './MarkdownInline.svelte';

	let { session, interview } = $props<{ session: AgentSession; interview: GoalInterview }>();

	const draft = $derived(interview.draft);
	const issues = $derived(draftIssues(draft));
	const blocking = $derived(issues.filter((issue) => issue.blocking));
	const tips = $derived(issues.filter((issue) => !issue.blocking));
	const launchable = $derived(canLaunch(draft));
	const editable = $derived(interview.phase === 'draft');
	const filled = $derived(
		[
			draft.criteria.length > 0,
			draft.verification.length > 0,
			draft.attempts !== null && draft.tokenBudget !== null,
			draft.allowed.length + draft.forbidden.length > 0,
			draft.stop.length > 0
		].filter(Boolean).length
	);

	let editing = $state(false);
	let objectiveText = $state('');
	let criteriaText = $state('');
	let verificationText = $state('');
	let attemptsText = $state('');
	let budgetText = $state('');
	let boundsText = $state('');
	let stopText = $state('');

	function openEditor() {
		objectiveText = draft.objective;
		criteriaText = draft.criteria.join('\n');
		verificationText = draft.verification.join('\n');
		attemptsText = draft.attempts === null ? '' : String(draft.attempts);
		budgetText = draft.tokenBudget === null ? '' : String(Math.round(draft.tokenBudget / 1000));
		boundsText = [
			...draft.allowed.map((item: string) => `${m.guided_goal_edit_allowed_prefix()} ${item}`),
			...draft.forbidden.map((item: string) => `${m.guided_goal_edit_forbidden_prefix()} ${item}`)
		].join('\n');
		stopText = draft.stop.join('\n');
		editing = true;
	}

	function positive(text: string): number | null {
		const value = Number(text.replace(',', '.'));
		return Number.isFinite(value) && value > 0 ? value : null;
	}

	function saveEditor() {
		const attempts = positive(attemptsText);
		const budgetK = positive(budgetText);
		const bounds = parseBoundaries(boundsText);
		const next: GoalDraft = {
			objective: objectiveText.trim(),
			criteria: splitItems(criteriaText),
			verification: splitItems(verificationText),
			attempts: attempts === null ? null : Math.round(attempts),
			tokenBudget: budgetK === null ? null : Math.round(budgetK * 1000),
			allowed: bounds.allowed,
			forbidden: bounds.forbidden,
			stop: splitItems(stopText)
		};
		session.updateGuidedGoalDraft(next);
		editing = false;
	}

	async function launch() {
		if (!launchable || interview.phase !== 'draft') return;
		await session.launchGuidedGoal();
	}
</script>

<section class="gcard" aria-label={m.guided_goal_draft_title()}>
	<header class="gc-h">
		<span class="gc-icon" aria-hidden="true"><IconTarget /></span>
		<b>{m.guided_goal_draft_title()}</b>
		<span class="gc-count">{m.guided_goal_draft_fields({ done: filled, total: 5 })}</span>
		<span class="gc-sp"></span>
		{#if interview.phase === 'started'}
			<span class="gc-badge ok">{m.guided_goal_draft_started()}</span>
		{:else if interview.phase === 'cancelled'}
			<span class="gc-badge">{m.guided_goal_draft_cancelled()}</span>
		{:else if blocking.length}
			<span class="gc-badge warn">{m.guided_goal_draft_issues({ count: blocking.length })}</span>
		{:else}
			<span class="gc-badge ok">{m.guided_goal_draft_ready()}</span>
		{/if}
	</header>

	{#if editing}
		<div class="gc-b edit">
			<label class="gk" for="gg-obj-{interview.id}">{m.guided_goal_field_objective()}</label>
			<input id="gg-obj-{interview.id}" class="gc-input" bind:value={objectiveText} />
			<label class="gk" for="gg-crit-{interview.id}">{m.guided_goal_field_criteria()} <span class="gk-hint">{m.guided_goal_edit_one_per_line()}</span></label>
			<textarea id="gg-crit-{interview.id}" class="gc-input" rows="3" bind:value={criteriaText}></textarea>
			<label class="gk" for="gg-verif-{interview.id}">{m.guided_goal_field_verification()} <span class="gk-hint">{m.guided_goal_edit_one_per_line()}</span></label>
			<textarea id="gg-verif-{interview.id}" class="gc-input font-mono" rows="2" bind:value={verificationText}></textarea>
			<div class="gc-two">
				<div>
					<label class="gk" for="gg-att-{interview.id}">{m.guided_goal_edit_attempts()}</label>
					<input id="gg-att-{interview.id}" class="gc-input" inputmode="numeric" bind:value={attemptsText} />
				</div>
				<div>
					<label class="gk" for="gg-bud-{interview.id}">{m.guided_goal_edit_budget()}</label>
					<input id="gg-bud-{interview.id}" class="gc-input" inputmode="numeric" bind:value={budgetText} />
				</div>
			</div>
			<label class="gk" for="gg-bounds-{interview.id}">{m.guided_goal_field_boundaries()} <span class="gk-hint">{m.guided_goal_edit_bounds_hint()}</span></label>
			<textarea id="gg-bounds-{interview.id}" class="gc-input" rows="2" bind:value={boundsText}></textarea>
			<label class="gk" for="gg-stop-{interview.id}">{m.guided_goal_field_stop()} <span class="gk-hint">{m.guided_goal_edit_one_per_line()}</span></label>
			<textarea id="gg-stop-{interview.id}" class="gc-input" rows="2" bind:value={stopText}></textarea>
		</div>
		<footer class="gc-f">
			<button type="button" class="gc-btn" onclick={() => (editing = false)}>{m.guided_goal_edit_cancel()}</button>
			<span class="gc-sp"></span>
			<button type="button" class="gc-btn primary" onclick={saveEditor}>
				<IconCheck aria-hidden="true" /> {m.guided_goal_edit_save()}
			</button>
		</footer>
	{:else}
		<div class="gc-b">
			<div class="gsec">
				<div class="gk">{m.guided_goal_field_objective()}</div>
				<div>{draft.objective || '—'}</div>
			</div>
			<div class="gsec">
				<div class="gk">{m.guided_goal_field_criteria()}</div>
				{#if draft.criteria.length}
					<ul>
						{#each draft.criteria as item, i (i)}
							<li class:vague={isVagueCriterion(item)}><MarkdownInline tokens={lexMarkdownInline(item)} /></li>
						{/each}
					</ul>
				{:else}
					<div class="missing">{m.guided_goal_missing()}</div>
				{/if}
			</div>
			<div class="gsec">
				<div class="gk">{m.guided_goal_field_verification()}</div>
				{#if draft.verification.length}
					<ul>
						{#each draft.verification as item, i (i)}
							<li><code>{item}</code></li>
						{/each}
					</ul>
				{:else}
					<div class="missing">{m.guided_goal_missing()}</div>
				{/if}
			</div>
			<div class="gsec two">
				<div>
					<div class="gk">{m.guided_goal_field_cap()}</div>
					{#if draft.attempts !== null && draft.tokenBudget !== null}
						<div>{formatCap(draft.attempts, draft.tokenBudget)}</div>
					{:else}
						<div class="missing">{formatCap(draft.attempts, draft.tokenBudget) || m.guided_goal_missing()}</div>
					{/if}
				</div>
				<div>
					<div class="gk">{m.guided_goal_field_boundaries()}</div>
					{#if draft.allowed.length || draft.forbidden.length}
						{#if draft.allowed.length}<div>{draft.allowed.join(', ')}</div>{/if}
						{#if draft.forbidden.length}
							<div class="faint">{m.guided_goal_bounds_forbidden_inline({ items: draft.forbidden.join(', ') })}</div>
						{/if}
					{:else}
						<div class="faint">—</div>
					{/if}
				</div>
			</div>
			<div class="gsec">
				<div class="gk">{m.guided_goal_field_stop()}</div>
				{#if draft.stop.length}
					<ul>
						{#each draft.stop as item, i (i)}
							<li>{item}</li>
						{/each}
					</ul>
				{:else}
					<div class="faint">—</div>
				{/if}
			</div>
		</div>

		{#if editable && issues.length}
			<div class="gc-issues" role="status">
				{#each blocking as issue, i (i)}
					<button type="button" class="issue warn" onclick={openEditor}>
						<IconWarning aria-hidden="true" /> <span>{issue.message}</span>
					</button>
				{/each}
				{#each tips as issue, i (i)}
					<button type="button" class="issue tip" onclick={openEditor}>
						<IconInfo aria-hidden="true" /> <span>{issue.message}</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if editable}
			<footer class="gc-f">
				<button type="button" class="gc-btn" onclick={openEditor}>
					<IconPencil aria-hidden="true" /> {m.guided_goal_edit()}
				</button>
				<button type="button" class="gc-btn" onclick={() => session.cancelGuidedGoal()}>{m.guided_goal_cancel()}</button>
				<span class="gc-sp"></span>
				<Tooltip text={launchable ? m.guided_goal_launch_hint() : m.guided_goal_launch_blocked()} placement="top" offset={6}>
					<button type="button" class="gc-btn primary" disabled={!launchable} onclick={launch}>
						<IconTarget aria-hidden="true" /> {m.guided_goal_launch()}
					</button>
				</Tooltip>
			</footer>
		{:else if interview.phase === 'starting'}
			<footer class="gc-f">
				<span class="faint">{m.guided_goal_starting()}</span>
			</footer>
		{/if}
	{/if}
</section>

<style>
	.gcard {
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-2xl);
		min-width: 0;
		overflow: hidden;
	}
	.gc-h {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 10px 14px;
		border-bottom: 1px solid var(--line);
		font-size: var(--text-sm);
		color: var(--ink);
	}
	.gc-icon {
		display: inline-flex;
		color: var(--brand-ink);
		--icon-size: 15px;
	}
	.gc-count {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}
	.gc-sp {
		flex: 1;
	}
	.gc-badge {
		font-size: var(--text-caption);
		font-weight: 500;
		padding: 1px 7px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}
	.gc-badge.ok {
		color: var(--success);
		border-color: color-mix(in oklab, var(--success) 40%, transparent);
	}
	.gc-badge.warn {
		color: var(--warn);
		border-color: color-mix(in oklab, var(--warn) 45%, transparent);
	}
	.gc-b {
		padding: 6px 14px 10px;
	}
	.gsec {
		padding: 8px 0;
		border-bottom: 1px solid var(--line);
		font-size: var(--text-chat);
		line-height: 1.55;
		color: var(--ink);
		min-width: 0;
	}
	.gsec:last-child {
		border-bottom: 0;
	}
	.gsec ul {
		margin: 0;
		padding-left: 18px;
	}
	.gsec li.vague {
		color: var(--warn);
		text-decoration: underline wavy color-mix(in oklab, var(--warn) 60%, transparent);
		text-underline-offset: 4px;
	}
	.gsec.two {
		display: grid;
		grid-template-columns: 1fr 1.4fr;
		gap: var(--space-4);
	}
	.gsec code {
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 0 5px;
	}
	.gk {
		display: block;
		font-size: var(--text-caption);
		color: var(--ink-faint);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 2px;
	}
	.gk-hint {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
	}
	.faint {
		color: var(--ink-faint);
	}
	.missing {
		color: var(--warn);
	}
	.gc-issues {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0 14px 10px;
		padding: 8px 10px;
		border-radius: var(--radius-md);
		background: color-mix(in oklab, var(--warn) 8%, transparent);
	}
	.issue {
		display: flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: none;
		padding: 0;
		font: inherit;
		font-size: var(--text-xs);
		text-align: left;
		cursor: pointer;
		--icon-size: 12px;
	}
	.issue.warn {
		color: var(--warn);
	}
	.issue.tip {
		color: var(--ink-muted);
	}
	.issue:hover span {
		text-decoration: underline;
	}
	.gc-f {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 10px 14px;
		border-top: 1px solid var(--line);
		font-size: var(--text-xs);
	}
	.gc-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 5px 12px;
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		color: var(--ink-muted);
		cursor: pointer;
		white-space: nowrap;
		--icon-size: 13px;
	}
	.gc-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}
	.gc-btn.primary {
		background: var(--brand);
		border-color: var(--brand);
		color: var(--on-brand);
		font-weight: 600;
	}
	.gc-btn.primary:hover:not(:disabled) {
		background: var(--brand);
		filter: brightness(1.08);
	}
	.gc-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.gc-b.edit {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: 10px;
	}
	.gc-b.edit .gk {
		margin-top: 6px;
	}
	.gc-input {
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
	.gc-input.font-mono {
		font-family: var(--font-mono);
		font-size: var(--text-mono);
	}
	.gc-input:focus {
		border-color: var(--brand);
		outline: none;
	}
	.gc-two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}
</style>
