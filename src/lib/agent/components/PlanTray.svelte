<!--
  PlanTray.svelte (Gate R36).

  Vassoio «Piano in costruzione» sopra il composer: le cinque sezioni del
  formato del Piano si spuntano man mano che l'agente scrive `local://*-plan.md`.
  Le sezioni extra scritte dall'agente si accodano.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconCheck, IconPlan } from '$lib/icons';
	import type { ExpectedSectionId, OutlineItem } from '../planMode';

	let { outline, planFilePath = null } = $props<{
		outline: OutlineItem[];
		planFilePath?: string | null;
	}>();

	const done = $derived(outline.filter((item: OutlineItem) => item.state === 'done').length);

	function label(item: OutlineItem): string {
		const expected: Record<ExpectedSectionId, () => string> = {
			context: m.plan_section_context,
			approach: m.plan_section_approach,
			files: m.plan_section_files,
			verification: m.plan_section_verification,
			assumptions: m.plan_section_assumptions
		};
		return item.expected ? expected[item.expected as ExpectedSectionId]() : (item.heading ?? '');
	}
</script>

<section class="plan-tray rv-lift" style="--dur: 240ms;" aria-label={m.plan_tray_title()}>
	<div class="sr-only" aria-live="polite">{m.plan_tray_progress({ done, total: outline.length })}</div>
	<div class="plan-tray-head">
		<span class="plan-tray-icon" aria-hidden="true"><IconPlan /></span>
		<span class="plan-tray-title">{m.plan_tray_title()}</span>
		<span class="plan-badge live">{m.plan_tray_progress({ done, total: outline.length })}</span>
		{#if planFilePath}
			<span class="plan-tray-meta font-mono">{planFilePath}</span>
		{/if}
	</div>
	<div class="plan-outline">
		{#each outline as item, index (item.expected ?? `x-${index}-${item.heading}`)}
			<span class="plan-ol {item.state}">
				{#if item.state === 'done'}
					<span class="plan-ol-mark" aria-hidden="true"><IconCheck /></span>
				{:else if item.state === 'writing'}
					<span class="plan-ol-spin" aria-hidden="true"></span>
				{/if}
				{label(item)}
			</span>
		{/each}
	</div>
</section>

<style>
	.plan-tray {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-xl);
		min-width: 0;
	}
	.plan-tray-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		min-width: 0;
	}
	.plan-tray-icon {
		display: inline-flex;
		color: var(--brand-ink);
	}
	.plan-tray-title {
		font-weight: 600;
		color: var(--ink);
	}
	.plan-tray-meta {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.plan-badge {
		font-size: 10.5px;
		padding: 1px 7px;
		border-radius: var(--radius-full);
		border: 1px solid var(--line-strong);
		color: var(--ink-muted);
		white-space: nowrap;
	}
	.plan-badge.live {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 45%, transparent);
	}
	.plan-outline {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.plan-ol {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11.5px;
		padding: 2px 8px;
		border-radius: var(--radius-full);
		background: var(--bg-hover);
		color: var(--ink-muted);
		--icon-size: 11px;
		transition: opacity var(--dur-calm) var(--ease-out), color var(--dur-calm) var(--ease-out);
	}
	.plan-ol.done,
	.plan-ol.writing {
		color: var(--ink);
	}
	.plan-ol.pending {
		opacity: 0.45;
	}
	.plan-ol-mark {
		display: inline-flex;
	}
	.plan-ol-spin {
		width: 9px;
		height: 9px;
		border: 1.4px solid var(--line-strong);
		border-top-color: var(--ink);
		border-radius: 50%;
		animation: plan-spin 0.9s linear infinite;
	}
	@keyframes plan-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.plan-ol-spin {
			animation: none;
		}
	}
</style>
