<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { Project } from '#lib/stores/projects.svelte.ts';
	import { IconFile, IconFolder, IconFolderPlus } from '#lib/icons.ts';

	let {
		project,
		onFileSelect,
		onPromote
	}: {
		project: Project;
		onFileSelect?: (file: string) => void;
		onPromote?: () => void;
	} = $props();

	function fileName(p: string): string {
		return p.split('/').pop() || p;
	}

	function fileDir(p: string): string {
		const idx = p.lastIndexOf('/');
		return idx === -1 ? '' : p.slice(0, idx);
	}
</script>

<div class="external-files-panel">
	<div class="panel-section workdir-section">
		<div class="section-header">
			<span class="section-icon"><IconFolder /></span>
			<span class="section-title">{m.external_panel_workdir_label()}</span>
		</div>
		<div class="workdir-path" title={project.lane.workspacePath ?? ''}>
			{project.lane.workspacePath}
		</div>
	</div>

	<div class="panel-section files-section">
		<div class="section-header">
			<span class="section-title">{m.external_panel_open_files_label()}</span>
			<span class="count-badge">{project.lane.openFiles.length}</span>
		</div>
		{#if project.lane.openFiles.length === 0}
			<div class="empty-files">{m.external_panel_no_open_files()}</div>
		{:else}
			<div class="files-list" role="list">
				{#each project.lane.openFiles as file (file)}
					{@const isActive = project.lane.activeFile === file}
					<button
						type="button"
						class="file-row"
						class:active={isActive}
						onclick={() => onFileSelect?.(file)}
						title={file}
					>
						<span class="file-icon"><IconFile /></span>
						<span class="file-names">
							<span class="file-name">{fileName(file)}</span>
							{#if fileDir(file)}
								<span class="file-dir">{fileDir(file)}</span>
							{/if}
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="panel-section promote-section">
		<p class="promote-desc">{m.external_panel_promote_desc()}</p>
		<button
			type="button"
			class="ui-button ui-button-primary promote-btn"
			onclick={onPromote}
		>
			<span class="btn-icon"><IconFolderPlus /></span>
			<span>{m.external_panel_promote_btn()}</span>
		</button>
	</div>
</div>

<style>
	.external-files-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: var(--space-3);
		gap: var(--space-4);
		overflow-y: auto;
		color: var(--ink);
	}

	.panel-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-group-label);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}

	.section-icon {
		display: inline-flex;
		align-items: center;
		font-size: 14px;
	}

	.count-badge {
		font-size: var(--text-xs);
		background: var(--bg-hover);
		color: var(--ink-muted);
		padding: 1px 6px;
		border-radius: var(--radius-full);
	}

	.workdir-path {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		word-break: break-all;
		user-select: text;
	}

	.files-section {
		flex: 1;
		min-height: 0;
	}

	.files-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-y: auto;
	}

	.file-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px var(--space-2);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.file-row:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.file-row.active {
		background: var(--bg-active);
		border-color: var(--line-strong);
		color: var(--brand-ink);
		font-weight: 500;
	}

	.file-icon {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--ink-faint);
	}

	.file-row.active .file-icon {
		color: var(--brand);
	}

	.file-names {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.file-name {
		font-size: var(--text-label);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.file-dir {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.empty-files {
		font-size: var(--text-label);
		color: var(--ink-faint);
		font-style: italic;
		padding: var(--space-2) 0;
	}

	.promote-section {
		padding-top: var(--space-3);
		border-top: 1px solid var(--line);
	}

	.promote-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		margin: 0 0 var(--space-2) 0;
		line-height: 1.4;
	}

	.promote-btn {
		width: 100%;
		gap: var(--space-2);
		padding: 8px var(--space-3);
		font-size: var(--text-label);
		font-weight: 500;
	}

	.btn-icon {
		display: inline-flex;
		align-items: center;
	}
</style>
