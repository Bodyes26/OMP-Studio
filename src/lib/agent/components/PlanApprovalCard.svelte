<!--
  PlanApprovalCard.svelte (Gate R36).

  Scheda di approvazione del Piano: prende il posto del composer con la sagoma
  della scheda domanda. Quattro strade (tasti 1–4; preselezionata la nuova
  sessione pulita, come omp), ruolo di esecuzione, copia in `.omp/plans/`,
  «Salva ed esci», «Chiedi modifiche (n)» e «Approva ed esegui» (Ctrl+Invio).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Component } from 'svelte';
	import {
		IconCheck,
		IconCompact,
		IconGitBranch,
		IconKeepHistory,
		IconPlan,
		IconPlus,
		IconSave
	} from '$lib/icons';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import { parseRoleSelector } from '$lib/stores/modelSettingsHelpers';
	import { formatTokens } from '$lib/utils/format';
	import { IS_MAC } from '$lib/utils/platform';
	import type { AgentSession } from '../session.svelte';
	import { PLAN_EXEC_MODES, availableExecRoles, execModeForKey, type PlanExecMode } from '../planMode';

	let { session, visible = true } = $props<{ session: AgentSession; visible?: boolean }>();

	const plan = $derived(session.plan);
	const doc = $derived(plan.openDoc);
	const comments = $derived(doc ? plan.commentCount(doc.id) : 0);
	const edits = $derived(doc ? doc.deleted.length + Object.keys(doc.bodies).length : 0);

	const roles = $derived<Record<string, string>>(
		modelSettingsStore.config?.modelRoles ?? modelSettingsStore.draftConfig?.modelRoles ?? {}
	);
	const roleOptions = $derived(availableExecRoles(roles).map((role) => ({ value: role, label: role })));
	const roleModel = $derived.by(() => {
		const selector = roles[plan.execRole];
		if (!selector) return session.model?.name || session.model?.id || '';
		return parseRoleSelector(selector, modelSettingsStore.knownSelectors).modelId;
	});

	$effect(() => {
		if (visible) void modelSettingsStore.ensureConfigAndCatalog();
	});

	const tokens = $derived(session.contextUsage?.tokens ?? null);
	// Come omp: con il contesto quasi pieno «tutta la cronologia» non ha senso.
	const keepDisabled = $derived((session.contextUsage?.percent ?? 0) >= 85);

	const icons: Record<PlanExecMode, Component> = {
		fresh: IconPlus,
		lane: IconGitBranch,
		compact: IconCompact,
		keep: IconKeepHistory
	};

	function optionLabel(mode: PlanExecMode): string {
		switch (mode) {
			case 'fresh':
				return m.plan_exec_fresh();
			case 'lane':
				return m.plan_exec_lane();
			case 'compact':
				return m.plan_exec_compact();
			case 'keep':
				return m.plan_exec_keep();
		}
	}

	function optionDescription(mode: PlanExecMode): string {
		switch (mode) {
			case 'fresh':
				return m.plan_exec_fresh_desc();
			case 'lane':
				return m.plan_exec_lane_desc();
			case 'compact':
				return m.plan_exec_compact_desc();
			case 'keep':
				return keepDisabled
					? m.plan_exec_keep_disabled()
					: tokens
						? m.plan_exec_keep_desc_tokens({ tokens: formatTokens(tokens) })
						: m.plan_exec_keep_desc();
		}
	}

	function pick(mode: PlanExecMode) {
		if (mode === 'keep' && keepDisabled) return;
		plan.execMode = mode;
	}

	function approve() {
		if (plan.execMode === 'keep' && keepDisabled) return;
		void plan.approve();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!visible || e.defaultPrevented || e.isComposing) return;
		const target = e.target as HTMLElement | null;
		const typing = !!target?.closest('input, textarea, [contenteditable="true"]');
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			// Ctrl+Invio dentro un commento o una modifica salva quello, non approva.
			if (typing) return;
			e.preventDefault();
			approve();
			return;
		}
		if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
		const mode = execModeForKey(e.key);
		if (mode) {
			e.preventDefault();
			pick(mode);
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if doc}
	<div class="plan-approval rv-lift" style="--dur: 240ms;" role="region" aria-label={m.plan_approval_title()}>
		<div class="pa-head">
			<span class="pa-icon" aria-hidden="true"><IconPlan /></span>
			<div class="pa-q">{m.plan_approval_title()}</div>
		</div>
		<div class="pa-d">{m.plan_approval_desc()}</div>

		<div class="pa-opts" role="radiogroup" aria-label={m.plan_approval_title()}>
			{#each PLAN_EXEC_MODES as mode, index (mode)}
				{@const Icon = icons[mode]}
				{@const disabled = mode === 'keep' && keepDisabled}
				<div
					class="pa-opt"
					class:sel={plan.execMode === mode}
					class:dis={disabled}
					role="radio"
					aria-checked={plan.execMode === mode}
					aria-disabled={disabled}
					tabindex={plan.execMode === mode ? 0 : -1}
					onclick={() => pick(mode)}
					onkeydown={(e) => {
						if (e.key === ' ' || e.key === 'Enter') {
							if (e.ctrlKey || e.metaKey) return;
							e.preventDefault();
							pick(mode);
						}
					}}
				>
					<span class="pa-radio" aria-hidden="true"></span>
					<span class="pa-ic" aria-hidden="true"><Icon /></span>
					<div class="pa-opt-main">
						<div class="pa-opt-l">
							{optionLabel(mode)}
							{#if mode === 'fresh'}<span class="pa-rec">{m.plan_exec_recommended()}</span>{/if}
						</div>
						<div class="pa-opt-dd">{optionDescription(mode)}</div>
					</div>
					<span class="pa-kbd font-mono">{index + 1}</span>
				</div>
			{/each}
		</div>

		<div class="pa-sub">
			<span class="pa-lbl">{m.plan_approval_role()}</span>
			<Segmented
				options={roleOptions}
				value={plan.execRole}
				ariaLabel={m.plan_approval_role()}
				onChange={(value) => (plan.execRole = value)}
			/>
			{#if roleModel}<span class="pa-model font-mono">{roleModel}</span>{/if}
		</div>

		{#if plan.execMode === 'lane'}
			<div class="pa-sub">
				<span class="pa-lbl">{m.plan_approval_lane()}</span>
				<input class="pa-input" bind:value={plan.laneTitle} aria-label={m.plan_approval_lane()} />
				<span class="pa-note">{m.plan_approval_lane_note()}</span>
			</div>
		{/if}

		<div class="pa-sub">
			<span class="pa-lbl">{m.plan_approval_archive()}</span>
			<label class="pa-chk">
				<input type="checkbox" bind:checked={plan.autosave} />
				{m.plan_approval_archive_label()}
			</label>
		</div>

		<div class="pa-foot">
			<button type="button" class="ui-button ui-button-secondary" onclick={() => void plan.saveAndQuit()}>
				<IconSave aria-hidden="true" />
				{m.plan_approval_save_quit()}
			</button>
			<span class="pa-sp"></span>
			<button
				type="button"
				class="ui-button ui-button-secondary"
				class:muted={comments + edits === 0}
				onclick={() => void plan.refine()}
			>
				{comments > 0 ? m.plan_approval_refine_count({ count: comments }) : m.plan_approval_refine()}
			</button>
			<button
				type="button"
				class="ui-button ui-button-primary pa-primary"
				disabled={plan.execMode === 'keep' && keepDisabled}
				onclick={approve}
			>
				<IconCheck aria-hidden="true" />
				{m.plan_approval_approve()}
				<span class="pa-kbd on-brand font-mono">{IS_MAC ? '⌘ ↵' : 'Ctrl ↵'}</span>
			</button>
		</div>
	</div>
{/if}

<style>
	.plan-approval {
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-2xl);
		box-shadow: var(--shadow-raise);
		padding: var(--space-3) var(--space-4) 0;
		max-height: 58vh;
		overflow-y: auto;
		min-width: 0;
	}
	.pa-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		--icon-size: 16px;
	}
	.pa-icon {
		display: inline-flex;
		color: var(--brand-ink);
	}
	.pa-q {
		font-size: 15px;
		font-weight: 500;
		line-height: 1.45;
		color: var(--ink);
	}
	.pa-d {
		font-size: var(--text-sm);
		color: var(--ink-muted);
		margin: 2px 0 10px;
	}
	.pa-opts {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.pa-opt {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 7px 12px;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		cursor: pointer;
		outline: none;
		transition: background-color var(--dur-instant) var(--ease-out), border-color var(--dur-instant) var(--ease-out);
	}
	.pa-opt:hover {
		background: color-mix(in srgb, var(--ink) 6%, transparent);
		border-color: var(--line-strong);
	}
	.pa-opt:focus-visible {
		box-shadow: var(--focus-ring);
	}
	.pa-opt.sel {
		border-color: var(--brand);
		box-shadow: inset 0 0 0 1px var(--brand);
		background: color-mix(in srgb, var(--brand) 7%, transparent);
	}
	.pa-opt.dis {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.pa-radio {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1.5px solid var(--line-strong);
		display: grid;
		place-items: center;
		margin-top: 3px;
		flex: none;
	}
	.pa-opt.sel .pa-radio {
		border-color: var(--brand);
	}
	.pa-opt.sel .pa-radio::after {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--brand);
	}
	.pa-ic {
		display: inline-flex;
		color: var(--ink-muted);
		margin-top: 3px;
	}
	.pa-opt-main {
		flex: 1;
		min-width: 0;
	}
	.pa-opt-l {
		font-size: 13.5px;
		font-weight: 500;
		color: var(--ink);
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.pa-opt:not(.sel) .pa-opt-dd {
		display: none;
	}
	.pa-opt-dd {
		font-size: var(--text-sm);
		color: var(--ink-muted);
		line-height: 1.45;
		margin-top: 2px;
	}
	.pa-rec {
		font-size: 10.5px;
		padding: 1px 7px;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--success) 14%, transparent);
		color: var(--success);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--success) 25%, transparent);
		font-weight: 500;
	}
	.pa-kbd {
		font-size: 10.5px;
		padding: 0 5px;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		line-height: 16px;
	}
	.pa-kbd.on-brand {
		color: var(--on-brand);
		border-color: color-mix(in srgb, var(--on-brand) 40%, transparent);
	}
	.pa-sub {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin-top: var(--space-3);
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}
	.pa-lbl {
		width: 84px;
		color: var(--ink-faint);
	}
	.pa-model {
		font-size: 11.5px;
		color: var(--ink);
	}
	.pa-input {
		max-width: 220px;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		padding: 5px 8px;
		color: var(--ink);
		font: inherit;
		font-size: var(--text-sm);
		outline: none;
	}
	.pa-input:focus {
		border-color: var(--brand);
	}
	.pa-note {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}
	.pa-chk {
		display: inline-flex;
		gap: 6px;
		align-items: center;
		cursor: pointer;
	}
	.pa-chk input {
		accent-color: var(--brand);
	}
	.pa-foot {
		position: sticky;
		bottom: 0;
		background: var(--bg-raised);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 10px 0 12px;
		margin-top: var(--space-3);
		border-top: 1px solid var(--line);
		--icon-size: 13px;
	}
	.pa-sp {
		flex: 1;
	}
	.muted {
		opacity: 0.55;
	}
	.pa-primary {
		gap: 6px;
	}
</style>
