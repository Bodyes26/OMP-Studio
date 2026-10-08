<!--
  PlanApprovedCard.svelte (Gate R36).

  Primo messaggio dell'esecuzione dopo l'approvazione: invece di una bolla con
  tutto il piano, una card «Piano approvato · titolo» con sezioni e percorso,
  e «Mostra piano» per leggerlo.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconPlan } from '$lib/icons';
	import { lexMarkdown } from '../markdown';
	import type { ApprovedPlanMessage } from '../planMode';
	import Markdown from './Markdown.svelte';

	let { approved } = $props<{ approved: ApprovedPlanMessage }>();
	let open = $state(false);
</script>

<article class="approved">
	<div class="ap-row">
		<span class="ap-icon" aria-hidden="true"><IconPlan /></span>
		<div class="ap-main">
			<div class="ap-t">
				{approved.title ? m.plan_approved_title({ title: approved.title }) : m.plan_approved_title_plain()}
			</div>
			<div class="ap-m font-mono">
				{m.plan_approved_meta({ count: approved.sectionCount, path: approved.planFilePath })}
			</div>
		</div>
		<button type="button" class="ui-button ui-button-secondary" aria-expanded={open} onclick={() => (open = !open)}>
			{open ? m.plan_approved_hide() : m.plan_approved_show()}
		</button>
	</div>
	{#if open}
		<div class="ap-body rv-lift" style="--dur: 200ms;">
			<Markdown tokens={lexMarkdown(approved.content)} />
		</div>
	{/if}
</article>

<style>
	.approved {
		border: 1px solid var(--line);
		border-radius: var(--radius-xl);
		background: var(--bg-raised);
		padding: 10px 12px;
		min-width: 0;
	}
	.ap-row {
		display: flex;
		gap: 10px;
		align-items: center;
		--icon-size: 16px;
	}
	.ap-icon {
		display: inline-flex;
		color: var(--brand-ink);
	}
	.ap-main {
		flex: 1;
		min-width: 0;
	}
	.ap-t {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ap-m {
		font-size: 11.5px;
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ap-body {
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid var(--line);
		font-size: 13.5px;
		line-height: 21px;
		color: var(--ink-muted);
	}
</style>
