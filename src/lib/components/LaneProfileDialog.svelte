<script lang="ts">
	// Consenso una tantum sui file locali non versionati di una corsia isolata
	// (Gate R27 / PLAN W10).
	//
	// Il dialogo mostra lo stack rilevato con la sua evidenza, gli avvisi sul
	// restore e i file candidati. Niente viene copiato finche' l'utente non
	// conferma; la decisione vale anche per le corsie successive.
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/ui/Dialog.svelte';
	import { IconPlus, IconGitBranch, IconWarning } from '$lib/icons';
	import type { ProjectStack, RestoreMode } from '$lib/types/lanes';
	import type {
		CandidateRule,
		ProfileWarning,
		StackDetection,
		UntrackedCandidate
	} from '$lib/lanes/stackDetector';

	let {
		open = false,
		detection = null,
		candidates = [],
		onConfirm,
		onCancel
	}: {
		open?: boolean;
		detection?: StackDetection | null;
		candidates?: UntrackedCandidate[];
		/** Riceve i percorsi selezionati (eventualmente vuoti) e quelli mostrati. */
		onConfirm: (accepted: string[]) => void;
		onCancel: () => void;
	} = $props();

	let selected = $state<Record<string, boolean>>({});

	// I candidati arrivano preselezionati: sono file che l'utente ha comunque
	// gia' sul disco e che servono a far partire il progetto nella corsia.
	$effect(() => {
		if (!open) return;
		const next: Record<string, boolean> = {};
		for (const candidate of candidates) next[candidate.relativePath] = true;
		selected = next;
	});

	function confirm() {
		onConfirm(candidates.map((c) => c.relativePath).filter((path) => selected[path]));
	}

	function formatBytes(bytes: number): string {
		if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
		if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
		if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${bytes} B`;
	}

	function stackLabel(stack: ProjectStack): string {
		switch (stack) {
			case 'aspnet':
				return m.laneprofile_stack_aspnet();
			case 'dotnet':
				return m.laneprofile_stack_dotnet();
			case 'node':
				return m.laneprofile_stack_node();
			case 'vite':
				return m.laneprofile_stack_vite();
			case 'svelte':
				return m.laneprofile_stack_svelte();
			case 'static':
				return m.laneprofile_stack_static();
		}
	}

	function restoreLabel(mode: RestoreMode): string {
		switch (mode) {
			case 'package_reference':
				return m.laneprofile_restore_package_reference();
			case 'packages_config':
				return m.laneprofile_restore_packages_config();
			case 'mixed':
				return m.laneprofile_restore_mixed();
			case 'none':
				return m.laneprofile_restore_none();
		}
	}

	function ruleLabel(rule: CandidateRule): string {
		switch (rule) {
			case 'dot_env':
				return m.laneprofile_rule_dot_env();
			case 'ini_file':
				return m.laneprofile_rule_ini_file();
			case 'local_settings':
				return m.laneprofile_rule_local_settings();
		}
	}

	function warningLabel(warning: ProfileWarning): string {
		switch (warning.kind) {
			case 'packages_config_restore':
				return warning.estimatedBytes
					? m.laneprofile_warning_packages_config_size({
							size: formatBytes(warning.estimatedBytes)
						})
					: m.laneprofile_warning_packages_config();
			case 'nuget_cache_missing':
				return m.laneprofile_warning_nuget_missing();
			case 'scan_truncated':
				return m.laneprofile_warning_truncated();
		}
	}

	const stacks = $derived(detection?.stacks ?? []);
	const warnings = $derived(detection?.warnings ?? []);
	const generated = $derived((detection?.generatedDirectories ?? []).slice(0, 6).join(', '));
</script>

<Dialog
	{open}
	title={m.laneprofile_title()}
	onClose={onCancel}
	initialFocus="[data-dialog-primary]"
>
	{#snippet icon()}
		<span class="dialog-icon-wrap">
			<IconGitBranch />
		</span>
	{/snippet}

	{#snippet body()}
		<p class="dialog-subtitle">{m.laneprofile_subtitle({ count: candidates.length })}</p>

		<div class="profile-box">
			<span class="label">{m.laneprofile_stack_label()}</span>
			<div class="chips">
				{#if stacks.length === 0}
					<span class="chip muted">{m.laneprofile_stack_unknown()}</span>
				{:else}
					{#each stacks as stack (stack)}
						<span class="chip">{stackLabel(stack)}</span>
					{/each}
				{/if}
				<span class="chip muted">{restoreLabel(detection?.restoreMode ?? 'none')}</span>
			</div>
			{#if detection && detection.subprojects.length > 0}
				<ul class="evidence">
					{#each detection.subprojects as subproject (subproject.directory)}
						<li>
							{#if subproject.directory}
								<span class="path">{subproject.directory}</span>
							{/if}
							<span class="manifests">{subproject.manifests.join(' · ')}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		{#each warnings as warning (warning.kind)}
			<div class="trace-warning">
				<span class="trace-icon"><IconWarning /></span>
				<span class="trace-text">{warningLabel(warning)}</span>
			</div>
		{/each}

		{#if candidates.length > 0}
			<div class="profile-box">
				<span class="label">{m.laneprofile_files_label()}</span>
				<ul class="files">
					{#each candidates as candidate (candidate.relativePath)}
						<li>
							<label class="file-item">
								<input
									type="checkbox"
									class="ui-checkbox"
									bind:checked={selected[candidate.relativePath]}
								/>
								<span class="path">{candidate.relativePath}</span>
								<span class="meta meta-bytes">{formatBytes(candidate.bytes)}</span>
								<span class="meta">{ruleLabel(candidate.rule)}</span>
							</label>
						</li>
					{/each}
				</ul>
				<p class="hint">{m.laneprofile_intro()}</p>
			</div>
		{/if}

		{#if generated}
			<p class="hint">{m.laneprofile_generated_hint({ dirs: generated })}</p>
		{/if}
	{/snippet}

	{#snippet footer()}
		<button type="button" class="ui-button ui-button-secondary" onclick={onCancel}>
			{m.laneprofile_cancel()}
		</button>
		<button
			type="button"
			class="ui-button ui-button-primary"
			data-dialog-primary
			onclick={confirm}
		>
			<IconPlus />
			<span>{candidates.length > 0 ? m.laneprofile_confirm() : m.laneprofile_confirm_none()}</span>
		</button>
	{/snippet}
</Dialog>

<style>
	.dialog-icon-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		--icon-size: 16px;
		color: var(--ink-muted);
	}

	.dialog-subtitle {
		margin: 0;
		font-size: var(--text-body);
		line-height: 1.4;
		color: var(--ink-muted);
		font-variant-numeric: tabular-nums;
	}

	.label {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.profile-box {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3) var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		padding: 2px 8px;
		border-radius: var(--radius-full);
		background: var(--bg-hover);
		font-size: var(--text-caption);
		color: var(--ink);
	}

	.chip.muted {
		background: transparent;
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink-muted);
	}

	.evidence,
	.files {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.evidence li {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		min-width: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.file-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		padding: 3px 0;
		cursor: pointer;
	}

	.path {
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}

	.manifests,
	.meta {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.meta-bytes {
		font-variant-numeric: tabular-nums;
	}

	.trace-warning {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		font-size: var(--text-trace);
		line-height: 1.45;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	.trace-icon {
		flex-shrink: 0;
		color: var(--warn);
		display: flex;
		align-items: center;
		--icon-size: 15px;
		margin-top: 1px;
	}

	.trace-text {
		flex: 1;
		min-width: 0;
	}

	.hint {
		margin: 0;
		font-size: var(--text-body);
		line-height: 1.45;
		color: var(--ink-muted);
	}
</style>
