<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconCircleAlert, IconFolderPlus, IconListTodo, IconWarning } from '$lib/icons';
	export interface EmptyStateAction {
		label: string;
		shortcut?: string;
		onClick: () => void;
		primary?: boolean;
	}

	export interface EmptyStateShortcut {
		key: string;
		label: string;
		action?: () => void;
	}

	export type EmptyStateVariant = 'no-projects' | 'no-tasks' | 'generic';

	let {
		variant = 'generic',
		title,
		description,
		primaryAction,
		secondaryAction,
		shortcuts = [],
		compact = false,
		setupIncomplete = false,
		onSetupClick
	} = $props<{
		variant?: EmptyStateVariant;
		title?: string;
		description?: string;
		primaryAction?: EmptyStateAction;
		secondaryAction?: EmptyStateAction;
		shortcuts?: EmptyStateShortcut[];
		compact?: boolean;
		setupIncomplete?: boolean;
		onSetupClick?: () => void;
	}>();

	const resolvedTitle = $derived.by(() => {
		if (title) return title;
		if (variant === 'no-projects') return m.empty_state_title_no_projects();
		if (variant === 'no-tasks') return m.empty_state_title_no_tasks();
		return m.empty_state_title_generic();
	});

	const resolvedDescription = $derived.by(() => {
		if (description) return description;
		if (variant === 'no-projects') {
			return m.empty_state_desc_no_projects();
		}
		if (variant === 'no-tasks') {
			return m.empty_state_desc_no_tasks();
		}
		return '';
	});

	const defaultShortcuts = $derived.by<EmptyStateShortcut[]>(() => {
		if (shortcuts.length > 0) return shortcuts;
		if (variant === 'no-projects') {
			return [
				{ key: 'Ctrl+Alt+N', label: m.empty_state_shortcut_open_folder() },
				{ key: 'Ctrl+Alt+S', label: m.empty_state_shortcut_scratchpad() },
				{ key: 'Ctrl+Alt+P', label: m.empty_state_shortcut_lab() },
				{ key: 'Ctrl+Alt+U', label: m.empty_state_shortcut_quota() },
				{ key: 'Ctrl+Alt+,', label: m.empty_state_shortcut_settings() }
			];
		}
		if (variant === 'no-tasks') {
			return [
				{ key: 'Alt+E', label: m.empty_state_shortcut_composer() }
			];
		}
		return [];
	});
</script>

<div
	class="empty-state-root"
	class:compact
	role="region"
	aria-label={resolvedTitle}
>
	<div class="empty-state-card rv-lift">
		<span class="empty-icon" aria-hidden="true">
			{#if variant === 'no-projects'}
				<IconFolderPlus />
			{:else if variant === 'no-tasks'}
				<IconListTodo />
			{:else}
				<IconCircleAlert />
			{/if}
		</span>

		<div class="text-group">
			{#if compact}
				<h3 class="title">{resolvedTitle}</h3>
			{:else}
				<h2 class="title">{resolvedTitle}</h2>
			{/if}
			{#if resolvedDescription}
				<p class="description">{resolvedDescription}</p>
			{/if}
		</div>

		{#if setupIncomplete}
			<div class="setup-notice">
				<span class="notice-icon" aria-hidden="true"><IconWarning /></span>
				<span class="notice-text">{m.empty_state_setup_notice()}</span>
				{#if onSetupClick}
					<button type="button" class="ui-button ui-button-secondary" onclick={onSetupClick}>
						{m.empty_state_btn_setup()}
					</button>
				{/if}
			</div>
		{/if}

		{#if primaryAction || secondaryAction}
			<div class="actions-row">
				{#if primaryAction}
					<button
						type="button"
						class="ui-button ui-button-primary"
						onclick={primaryAction.onClick}
					>
						<span>{primaryAction.label}</span>
						{#if primaryAction.shortcut}
							<kbd class="btn-kbd">{primaryAction.shortcut}</kbd>
						{/if}
					</button>
				{/if}

				{#if secondaryAction}
					<button
						type="button"
						class="ui-button ui-button-secondary"
						onclick={secondaryAction.onClick}
					>
						<span>{secondaryAction.label}</span>
						{#if secondaryAction.shortcut}
							<kbd class="btn-kbd">{secondaryAction.shortcut}</kbd>
						{/if}
					</button>
				{/if}
			</div>
		{/if}

		{#if defaultShortcuts.length > 0}
			<div class="shortcuts-section">
				<span class="shortcuts-heading">{m.empty_state_shortcuts_heading()}</span>
				<div class="shortcuts-grid">
					{#each defaultShortcuts as sc}
						{#if sc.action}
							<button type="button" class="shortcut-pill interactive" onclick={sc.action}>
								<kbd class="shortcut-key">{sc.key}</kbd>
								<span class="shortcut-label">{sc.label}</span>
							</button>
						{:else}
							<div class="shortcut-pill">
								<kbd class="shortcut-key">{sc.key}</kbd>
								<span class="shortcut-label">{sc.label}</span>
							</div>
						{/if}
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.empty-state-root {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		padding: var(--space-6) var(--space-4);
		box-sizing: border-box;
		background: transparent;
	}

	.empty-state-root.compact {
		padding: var(--space-4) var(--space-3);
	}

	/* Ingresso condiviso rv-lift alla durata dei pannelli: la classe vive in
	   app.css e si azzera da sola con le animazioni disattivate. */
	.empty-state-card {
		--dur: var(--dur-slow);
		max-width: 580px;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-4);
	}

	.compact .empty-state-card {
		max-width: 380px;
		gap: var(--space-3);
	}

	/* Icona neutra senza tessera: l'officina tace di colore, l'accento resta
	   all'azione primaria. */
	.empty-icon {
		--icon-size: 24px;
		display: inline-flex;
		color: var(--ink-faint);
	}

	.compact .empty-icon {
		--icon-size: 20px;
	}

	.text-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: 65ch;
	}

	.title {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--ink);
		letter-spacing: -0.02em;
		text-wrap: balance;
	}

	.compact .title {
		font-size: var(--text-base);
	}

	.description {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink-muted);
		line-height: 1.5;
		text-wrap: pretty;
	}

	.compact .description {
		font-size: var(--text-xs);
	}

	/* Stesso schema della riga di attenzione del vassoio: ambra al 15%, testo
	   --ink per restare leggibile su ogni tema, l'ambra solo nell'icona. */
	.setup-notice {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in oklch, var(--warn) 15%, transparent);
		color: var(--ink);
		font-size: var(--text-caption);
		max-width: 100%;
	}

	.notice-icon {
		--icon-size: 14px;
		display: inline-flex;
		color: var(--warn);
	}

	.notice-text {
		flex: 1;
		text-align: left;
	}

	.setup-notice .ui-button {
		flex-shrink: 0;
	}

	.actions-row {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: var(--space-3);
		width: 100%;
		margin-top: var(--space-1);
	}

	.btn-kbd {
		background: color-mix(in srgb, currentColor 14%, transparent);
		color: inherit;
		border-radius: var(--radius-sm);
		padding: 1px 6px;
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		font-weight: 600;
		border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
	}

	.shortcuts-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		margin-top: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px solid var(--line);
	}

	.shortcuts-heading {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.shortcuts-grid {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
		width: 100%;
	}

	.shortcut-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 10px 3px 4px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.shortcut-pill.interactive {
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
		background: var(--bg-raised);
	}

	.shortcut-pill.interactive:hover {
		color: var(--ink);
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	.shortcut-key {
		background: color-mix(in srgb, var(--ink) 8%, transparent);
		color: var(--ink);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-full);
		padding: 1px 6px;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
	}

	.shortcut-label {
		white-space: nowrap;
	}
</style>
