<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Ispettore delle regole di contesto e delle skill dell'agente, piu' le
	// proposte nate dall'attrito ricorrente nei prompt recenti.
	//
	// Le skill globali (~/.omp/agent) si ispezionano ma non si aprono
	// nell'editor: `file_read`/`file_write` rifiutano per contratto i percorsi
	// fuori dalla radice del progetto, e l'unico file che Studio scrive dentro
	// ~/.omp resta il tema (docs/DECISIONS.md). Per quelle righe l'azione e'
	// rivelare il file nel file manager.
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import {
		IconCheck,
		IconClose,
		IconExternalLink,
		IconFile,
		IconPlus,
		IconRefresh,
		IconRename,
		IconRule,
		IconSkill
	} from '$lib/icons';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { chatReveal } from '$lib/agent/motion';
	import { rulesStore, type ContextRuleItem, type RuleSuggestion, type SkillItem } from '$lib/stores/rules.svelte';

	let {
		projectPath,
		onOpenFile
	}: {
		projectPath: string;
		onOpenFile: (relPath: string) => void;
	} = $props();

	let actionError = $state<string | null>(null);
	let applying = $state<string | null>(null);

	const context = $derived(rulesStore.contextFor(projectPath));
	const suggestions = $derived(rulesStore.suggestionsFor(projectPath));
	const agentsMd = $derived(context.rules.find((rule) => rule.id === 'agents_md'));
	const activeRulesCount = $derived(context.rules.filter((rule) => rule.exists).length);
	const projectSkills = $derived(context.skills.filter((skill) => skill.scope === 'project'));
	const globalSkills = $derived(context.skills.filter((skill) => skill.scope !== 'project'));
	const busy = $derived(rulesStore.isLoading(projectPath) || rulesStore.isAnalyzing(projectPath));
	// Righe nuove: chatReveal solo per le chiavi comparse dopo la prima lettura.
	// Montaggio, cambio scheda e ricaricamento restano fermi (Still-Room Rule).
	let knownRules: Set<string> | null = null;
	let freshKeys = $state(new Set<string>());

	function trackFresh(known: Set<string> | null, keys: string[], fresh: Set<string>): Set<string> {
		if (known) {
			for (const key of keys) if (!known.has(key)) fresh.add(key);
		}
		return new Set(keys);
	}

	$effect(() => {
		const allKeys = [
			...context.rules.filter((rule) => rule.exists).map((rule) => rule.id),
			...context.skills.map((skill) => skill.path)
		];
		const fresh = new Set<string>();
		knownRules = trackFresh(knownRules, allKeys, fresh);
		freshKeys = fresh;
	});

	// Il censimento e' per progetto e memorizzato nello store: al rientro nella
	// scheda non si rilegge il disco, quindi lo switch resta immediato.
	$effect(() => {
		if (!projectPath) return;
		knownRules = null;
		freshKeys = new Set();
		void rulesStore.loadContext(projectPath);
	});
	function scopeLabel(scope: SkillItem['scope']): string {
		if (scope === 'project') return m.rules_scope_project();
		return scope === 'managed' ? 'managed' : m.rules_scope_global();
	}

	async function refresh() {
		actionError = null;
		await Promise.all([
			rulesStore.loadContext(projectPath, true),
			rulesStore.analyzeFriction(projectPath, true)
		]);
	}

	async function initAgentsMd() {
		actionError = null;
		const rel = await rulesStore.initAgentsMd(projectPath);
		if (rel) onOpenFile(rel);
	}

	async function applySuggestion(suggestion: RuleSuggestion) {
		actionError = null;
		applying = suggestion.id;
		const error = await rulesStore.applySuggestion(projectPath, suggestion);
		applying = null;
		if (error) {
			actionError = error;
			return;
		}
		onOpenFile(suggestion.target_file);
	}

	async function revealSkill(skill: SkillItem) {
		try {
			await revealItemInDir(skill.path);
		} catch (error) {
			actionError = `Impossibile mostrare ${skill.name}: ${String(error)}`;
		}
	}

	function openRule(rule: ContextRuleItem) {
		if (!rule.exists) return;
		onOpenFile(rule.path);
	}
</script>

<div class="rules-panel">
	{#if actionError}
		<div class="msg error" role="alert">{actionError}</div>
	{:else if rulesStore.errorFor(projectPath)}
		<div class="msg error" role="alert">{rulesStore.errorFor(projectPath)}</div>
	{/if}

	<div class="scroll">
		<!-- Una proposta alla volta: la scheda resta un pannello di ispezione,
		     non una bacheca di avvisi. Le altre restano in coda dietro Ignora. -->
		{#if suggestions.length > 0}
			{@const suggestion = suggestions[0]}
			<article class="suggestion">
				<div class="suggestion-head">
					<StatusMark status="attention" />
					<span class="suggestion-title">{suggestion.title}</span>
					<span class="occurrences">{suggestion.occurrences}×</span>
				</div>
				<p class="suggestion-reason">{suggestion.reason}</p>
				<pre class="preview" aria-label={`Anteprima delle righe da aggiungere a ${suggestion.target_file}`}>{#each suggestion.proposed_content.trimEnd().split('\n') as line, index (index)}<span class="added">+ {line}</span>
{/each}</pre>
				<div class="suggestion-actions">
					<Tooltip
						text={agentsMd?.exists !== true ? 'Inizializza AGENTS.md per poter applicare la proposta' : undefined}
						disabled={agentsMd?.exists === true}
					>
						<button
							type="button"
							class="ui-button ui-button-primary"
							disabled={applying === suggestion.id || agentsMd?.exists !== true}
							onclick={() => void applySuggestion(suggestion)}
						>
							<IconCheck />
							Applica a {suggestion.target_file}
						</button>
					</Tooltip>
					<button
						type="button"
						class="ui-button ui-button-ghost"
						disabled={agentsMd?.exists !== true}
						onclick={() => onOpenFile(suggestion.target_file)}
					>
						<IconRename />
						{m.queue_drawer_edit_btn()}
					</button>
					<button
						type="button"
						class="ui-button ui-button-ghost"
						onclick={() => rulesStore.dismissSuggestion(suggestion.id)}
					>
						<IconClose />
						{m.rules_dismiss()}
					</button>
				</div>
				{#if suggestions.length === 2}
					<p class="queued">{m.rules_another_queued()}</p>
				{:else if suggestions.length > 2}
					<p class="queued">Altre {suggestions.length - 1} {m.ui_rulespanel_proposte_in_attesa_0c30()}</p>
				{/if}
			</article>
		{/if}

		<div class="section-label">
			{m.rules_context_rules_title()}
			{#if busy}<StatusMark status="running" />{/if}
			{#if activeRulesCount > 0}<span class="count">{activeRulesCount}</span>{/if}
		</div>
		{#each context.rules as rule (rule.id)}
			{#if rule.exists}
				<div class="row-wrap" in:chatReveal={{ duration: freshKeys.has(rule.id) ? undefined : 0 }}>
					<button type="button" class="row" onclick={() => openRule(rule)}>
						<span class="row-icon">
							{#if rule.rule_type === 'guidelines'}<IconFile />{:else}<IconRule />{/if}
						</span>
						<span class="row-body">
							<span class="row-title">{rule.name}</span>
							{#if rule.description}<span class="row-sub">{rule.description}</span>{/if}
						</span>
					</button>
				</div>
			{:else}
				<div class="missing">
					<p class="missing-text">
						{m.ui_rulespanel_questo_progetto_non_ha_ac09()} <code>AGENTS.md</code>{m.ui_rulespanel_l_agente_lavora_senza_convenzioni_scritte_9f6b()}
					</p>
					<button type="button" class="ui-button ui-button-primary" onclick={() => void initAgentsMd()}>
						<IconPlus />
						{m.rules_init_agents_md()}
					</button>
				</div>
			{/if}
		{/each}

		<div class="section-label">
			{m.rules_project_skills_title()}
			{#if projectSkills.length > 0}<span class="count">{projectSkills.length}</span>{/if}
		</div>

		{#if projectSkills.length === 0}
			<div class="empty">{m.ui_rulespanel_nessuna_skill_in_3df8()} <code>.omp/skills</code>.</div>
		{:else}
			{#each projectSkills as skill (skill.path)}
				<div class="row-wrap" in:chatReveal={{ duration: freshKeys.has(skill.path) ? undefined : 0 }}>
					<button
						type="button"
						class="row"
						disabled={!skill.rel_path}
						onclick={() => skill.rel_path && onOpenFile(skill.rel_path)}
					>
						<span class="row-icon"><IconSkill /></span>
						<span class="row-body">
							<span class="row-title">
								{skill.name}
								<span class="command">/{skill.name}</span>
								<span class="badge">{scopeLabel(skill.scope)}</span>
							</span>
							{#if skill.description}<span class="row-sub">{skill.description}</span>{/if}
						</span>
					</button>
				</div>
			{/each}
		{/if}
		<div class="section-label">
			{m.rules_global_skills_title()}
			{#if globalSkills.length > 0}<span class="count">{globalSkills.length}</span>{/if}
		</div>

		{#if globalSkills.length === 0}
			<div class="empty">{m.ui_rulespanel_nessuna_skill_in_3df8()} <code>~/.omp/agent</code>.</div>
		{:else}
			{#each globalSkills as skill (skill.path)}
				<div class="row-wrap" in:chatReveal={{ duration: freshKeys.has(skill.path) ? undefined : 0 }}>
					<Tooltip text={m.ui_rulespanel_fuori_dal_progetto_si_apre_nel_file_d6b3()}>
						<button
							type="button"
							class="row"
							aria-label={`${skill.name} — ${m.ui_rulespanel_fuori_dal_progetto_si_apre_nel_file_d6b3()}`}
							onclick={() => void revealSkill(skill)}
						>
							<span class="row-icon"><IconSkill /></span>
							<span class="row-body">
								<span class="row-title">
									{skill.name}
									<span class="command">/{skill.name}</span>
									<span class="badge">{scopeLabel(skill.scope)}</span>
								</span>
								{#if skill.description}<span class="row-sub">{skill.description}</span>{/if}
							</span>
							<span class="row-icon trailing"><IconExternalLink /></span>
						</button>
					</Tooltip>
				</div>
			{/each}
		{/if}
	</div>

	<div class="panel-toolbar">
		<button
			type="button"
			class="ui-button ui-button-secondary"
			disabled={busy}
			onclick={() => void refresh()}
		>
			<span class="refresh-icon" class:spinning={busy} aria-hidden="true">
				<IconRefresh />
			</span>
			{busy ? m.rules_analyzing_btn() : m.rules_refresh_btn()}
		</button>
	</div>
</div>

<style>
	.rules-panel {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		background: var(--bg-base);
	}

	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-bottom: var(--space-2);
	}

	.msg.error {
		margin: 0 var(--space-2) var(--space-2);
		padding: var(--space-2);
		border-radius: var(--radius-md);
		background: var(--danger-dim);
		color: var(--ink);
		font-size: var(--text-label);
		line-height: 1.4;
	}

	.section-label {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: var(--space-3) var(--space-3) var(--space-1);
		color: var(--ink-faint);
		font-size: var(--text-caption);
	}

	.count {
		padding: 0 var(--space-1);
		border-radius: var(--radius-full);
		background: var(--bg-active);
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.empty {
		padding: 2px var(--space-3) var(--space-1);
		color: var(--ink-faint);
		font-size: var(--text-caption);
	}

	.row {
		width: 100%;
		padding: var(--space-1) var(--space-2);
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		text-align: left;
		cursor: pointer;
	}

	.row:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	.row:active:not(:disabled) {
		background: var(--bg-active);
	}

	.row:disabled {
		cursor: default;
	}

	.row-icon {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		height: 18px;
		color: var(--ink-faint);
	}

	.row-icon.trailing {
		margin-left: auto;
	}

	.row-body {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.row-title {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-1);
		color: var(--ink);
		font-size: var(--text-body);
		font-weight: 450;
		line-height: 1.3;
	}

	.row-sub {
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		color: var(--ink-faint);
		font-size: var(--text-caption);
		line-height: 1.35;
	}

	.command {
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
	}

	.badge {
		padding: 1px var(--space-1);
		border-radius: var(--radius-full);
		background: var(--bg-raised);
		color: var(--ink-muted);
		font-size: var(--text-caption);
		font-weight: 600;
	}

	.missing {
		margin: 0 var(--space-2);
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
	}

	.missing-text {
		margin: 0;
		color: var(--ink-muted);
		font-size: var(--text-body);
		line-height: 1.45;
	}

	.suggestion {
		margin: 0 var(--space-2) var(--space-2);
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: var(--bg-raised);
	}

	.suggestion-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.suggestion-title {
		min-width: 0;
		color: var(--ink);
		font-size: var(--text-body);
		font-weight: 600;
		line-height: 1.3;
	}

	.occurrences {
		margin-left: auto;
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.suggestion-reason {
		margin: 0;
		color: var(--ink-muted);
		font-size: var(--text-caption);
	}

	.queued {
		margin: 0;
		color: var(--ink-faint);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
	}

	.preview {
		margin: 0;
		padding: var(--space-2);
		max-height: 140px;
		overflow: auto;
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		font-family: var(--font-mono);
		font-size: var(--text-label);
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.added {
		color: var(--ink);
	}

	.suggestion-actions,
	.panel-toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.panel-toolbar {
		padding: var(--space-2);
	}

	:global(.rules-panel .ui-button) {
		--icon-size: 12px;
	}

	code {
		font-family: var(--font-mono);
		font-size: var(--text-label);
	}

	.row-wrap {
		width: 100%;
	}

	.row-wrap :global(.tooltip-wrapper) {
		display: flex;
		width: 100%;
	}

	.refresh-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.refresh-icon.spinning {
		animation: spin 800ms linear infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.refresh-icon.spinning {
			animation: none;
		}
	}

	:root[data-animations="false"] .refresh-icon.spinning {
		animation: none;
	}
</style>
