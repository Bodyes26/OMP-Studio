<script lang="ts">
	// Consenso una tantum sui file locali non versionati di una corsia isolata
	// (Gate R27 / PLAN W10).
	//
	// Il dialogo mostra lo stack rilevato con la sua evidenza, gli avvisi sul
	// restore e i file candidati. Niente viene copiato finche' l'utente non
	// conferma; la decisione vale anche per le corsie successive.
	import { m } from '$lib/paraglide/messages.js';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { trapFocus } from '$lib/focusTrap';
	import { IconClose, IconWarning, IconPlus } from '$lib/icons';
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
	let primaryBtnEl = $state<HTMLButtonElement | null>(null);

	// I candidati arrivano preselezionati: sono file che l'utente ha comunque
	// gia' sul disco e che servono a far partire il progetto nella corsia.
	$effect(() => {
		if (!open) return;
		const next: Record<string, boolean> = {};
		for (const candidate of candidates) next[candidate.relativePath] = true;
		selected = next;
	});

	$effect(() => {
		if (!open) return;
		const timer = setTimeout(() => primaryBtnEl?.focus(), 30);
		return () => clearTimeout(timer);
	});

	function handleKeydown(event: KeyboardEvent) {
		if (!open || event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		onCancel();
	}

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

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={onCancel} transition:fade={{ duration: 150 }}></div>

	<div
		class="modal-window"
		role="dialog"
		aria-modal="true"
		aria-labelledby="lane-profile-title"
		use:trapFocus
		transition:fly={{ y: -16, duration: 200, easing: cubicOut }}
	>
		<div class="modal-header">
			<div class="header-icon"><IconWarning /></div>
			<div class="header-text">
				<h3 id="lane-profile-title">{m.laneprofile_title()}</h3>
				<p class="subtitle">{m.laneprofile_subtitle({ count: candidates.length })}</p>
			</div>
			<button
				type="button"
				class="btn-close"
				onclick={onCancel}
				aria-label={m.laneprofile_cancel()}
			>
				<IconClose />
			</button>
		</div>

		<div class="modal-body">
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
								<span class="path">{subproject.directory || '.'}</span>
								<span class="manifests">{subproject.manifests.join(' · ')}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#each warnings as warning (warning.kind)}
				<p class="warning">{warningLabel(warning)}</p>
			{/each}

			{#if candidates.length > 0}
				<div class="profile-box">
					<span class="label">{m.laneprofile_files_label()}</span>
					<ul class="files">
						{#each candidates as candidate (candidate.relativePath)}
							<li>
								<label>
									<input type="checkbox" bind:checked={selected[candidate.relativePath]} />
									<span class="path">{candidate.relativePath}</span>
									<span class="meta">{formatBytes(candidate.bytes)}</span>
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
		</div>

		<div class="modal-footer">
			<button type="button" class="btn btn-secondary" onclick={onCancel}>
				{m.laneprofile_cancel()}
			</button>
			<button type="button" class="btn btn-primary" bind:this={primaryBtnEl} onclick={confirm}>
				<IconPlus />
				<span>{candidates.length > 0 ? m.laneprofile_confirm() : m.laneprofile_confirm_none()}</span>
			</button>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg-base) 80%, black);
		backdrop-filter: blur(2px);
		z-index: var(--z-modal, 1000);
	}

	.modal-window {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 520px;
		max-width: calc(100vw - 32px);
		max-height: calc(100vh - 64px);
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg, 10px);
		box-shadow:
			0 16px 40px rgba(0, 0, 0, 0.45),
			0 0 0 1px var(--line-strong);
		z-index: calc(var(--z-modal, 1000) + 1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		gap: var(--space-3, 12px);
		padding: var(--space-4, 16px) var(--space-4, 16px) var(--space-3, 12px);
		border-bottom: 1px solid var(--line);
	}

	.header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		flex: 0 0 auto;
		border-radius: 50%;
		color: var(--warning, #d29922);
		background: color-mix(in srgb, var(--warning, #d29922) 14%, transparent);
	}

	.header-text {
		flex: 1;
		min-width: 0;
	}

	.header-text h3 {
		margin: 0;
		font-size: var(--text-base, 14px);
		font-weight: 600;
		color: var(--fg-default);
	}

	.subtitle {
		margin: 2px 0 0;
		font-size: var(--text-sm, 12px);
		color: var(--fg-muted);
	}

	.btn-close {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm, 4px);
		background: transparent;
		color: var(--fg-muted);
		cursor: pointer;
	}

	.btn-close:hover {
		background: var(--bg-hover);
		color: var(--fg-default);
	}

	.modal-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3, 12px);
		padding: var(--space-4, 16px);
		overflow-y: auto;
	}

	.label {
		font-size: var(--text-xs, 11px);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-subtle, var(--fg-muted));
	}

	.profile-box {
		display: flex;
		flex-direction: column;
		gap: var(--space-2, 8px);
		padding: var(--space-3, 12px);
		border: 1px solid var(--line);
		border-radius: var(--radius-md, 6px);
		background: var(--bg-subtle, var(--bg-base));
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid var(--line-strong);
		font-size: var(--text-xs, 11px);
		color: var(--fg-default);
	}

	.chip.muted {
		color: var(--fg-muted);
	}

	.evidence,
	.files {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.evidence li {
		display: flex;
		gap: var(--space-2, 8px);
		align-items: baseline;
		min-width: 0;
		font-size: var(--text-xs, 11px);
		color: var(--fg-muted);
	}

	.files label {
		display: flex;
		align-items: baseline;
		gap: var(--space-2, 8px);
		min-width: 0;
		cursor: pointer;
	}

	.path {
		font-family: var(--font-mono);
		font-size: var(--text-xs, 11px);
		color: var(--fg-default);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.manifests,
	.meta {
		font-size: var(--text-xs, 11px);
		color: var(--fg-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.warning {
		margin: 0;
		padding: var(--space-2, 8px) var(--space-3, 12px);
		border-radius: var(--radius-md, 6px);
		border: 1px solid color-mix(in srgb, var(--warning, #d29922) 40%, var(--line));
		background: color-mix(in srgb, var(--warning, #d29922) 10%, transparent);
		font-size: var(--text-sm, 12px);
		color: var(--fg-default);
	}

	.hint {
		margin: 0;
		font-size: var(--text-sm, 12px);
		color: var(--fg-muted);
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2, 8px);
		padding: var(--space-3, 12px) var(--space-4, 16px);
		border-top: 1px solid var(--line);
		background: var(--bg-subtle, transparent);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: var(--radius-sm, 4px);
		border: 1px solid var(--line-strong);
		background: var(--bg-elevated, transparent);
		color: var(--fg-default);
		font-size: var(--text-sm, 12px);
		cursor: pointer;
	}

	.btn-secondary:hover {
		background: var(--bg-hover);
	}

	.btn-primary {
		border-color: var(--accent, var(--line-strong));
		background: var(--accent, var(--bg-elevated));
		color: var(--accent-fg, #fff);
	}

	.btn-primary:hover {
		filter: brightness(1.08);
	}
</style>
