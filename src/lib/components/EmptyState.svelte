<script lang="ts">
	import { IconWarning } from '$lib/icons';
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
		if (variant === 'no-projects') return 'Nessun progetto aperto';
		if (variant === 'no-tasks') return 'Nessun task in coda';
		return 'Nessun elemento';
	});

	const resolvedDescription = $derived.by(() => {
		if (description) return description;
		if (variant === 'no-projects') {
			return 'Apri una cartella locale per lavorare con gli agenti, oppure avvia uno Scratchpad temporaneo per una sessione rapida senza salvare su disco.';
		}
		if (variant === 'no-tasks') {
			return 'Crea il prossimo compito da eseguire per questo progetto. Puoi accodare più prompt con diversi ruoli e modelli.';
		}
		return '';
	});

	const defaultShortcuts = $derived.by<EmptyStateShortcut[]>(() => {
		if (shortcuts.length > 0) return shortcuts;
		if (variant === 'no-projects') {
			return [
				{ key: 'Ctrl+Alt+N', label: 'Apri cartella progetto' },
				{ key: 'Ctrl+Alt+S', label: 'Nuova chat rapida (Scratchpad)' },
				{ key: 'Ctrl+Alt+U', label: 'Quota e consumi API' },
				{ key: 'Ctrl+Alt+,', label: 'Impostazioni Studio' }
			];
		}
		if (variant === 'no-tasks') {
			return [
				{ key: 'Alt+E', label: 'Scrivi nel Composer' }
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
	<div class="empty-state-card">
		<div class="icon-wrapper" aria-hidden="true">
			{#if variant === 'no-projects'}
				<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
					<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path>
					<line x1="12" y1="11" x2="12" y2="17"></line>
					<line x1="9" y1="14" x2="15" y2="14"></line>
				</svg>
			{:else if variant === 'no-tasks'}
				<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
					<rect x="3" y="4" width="18" height="16" rx="2"></rect>
					<line x1="7" y1="8" x2="17" y2="8"></line>
					<line x1="7" y1="12" x2="13" y2="12"></line>
					<circle cx="16" cy="12" r="1"></circle>
					<line x1="7" y1="16" x2="10" y2="16"></line>
				</svg>
			{:else}
				<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="10"></circle>
					<line x1="12" y1="8" x2="12" y2="12"></line>
					<line x1="12" y1="16" x2="12.01" y2="16"></line>
				</svg>
			{/if}
		</div>

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
				<span class="notice-text">Configurazione di OMP incompleta o modelli mancanti.</span>
				{#if onSetupClick}
					<button type="button" class="btn-setup" onclick={onSetupClick}>
						Configura ora
					</button>
				{/if}
			</div>
		{/if}

		{#if primaryAction || secondaryAction}
			<div class="actions-row">
				{#if primaryAction}
					<button
						type="button"
						class="btn-action primary"
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
						class="btn-action secondary"
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
				<span class="shortcuts-heading">Scorciatoie rapide</span>
				<div class="shortcuts-grid">
					{#each defaultShortcuts as sc}
						{#if sc.action}
							<button type="button" class="shortcut-pill interactive" onclick={sc.action} title="Esegui {sc.label}">
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

	.empty-state-card {
		max-width: 580px;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-4);
		animation: emptyStateFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	.compact .empty-state-card {
		max-width: 380px;
		gap: var(--space-3);
	}

	@keyframes emptyStateFadeIn {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.icon-wrapper {
		width: 52px;
		height: 52px;
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--brand) 10%, var(--bg-sunken));
		border: 1px solid color-mix(in srgb, var(--brand) 25%, transparent);
		color: var(--brand);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.compact .icon-wrapper {
		width: 40px;
		height: 40px;
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

	.setup-notice {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--warn) 8%, var(--bg-sunken));
		border: 1px solid var(--warn-dim, #f59e0b44);
		color: var(--warn);
		font-size: var(--text-xs);
		max-width: 100%;
	}

	.notice-icon {
		font-weight: bold;
	}

	.notice-text {
		flex: 1;
		text-align: left;
	}

	.btn-setup {
		background: var(--warn);
		color: #000;
		border: none;
		border-radius: var(--radius-sm);
		padding: 2px 8px;
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
		flex-shrink: 0;
	}

	.btn-setup:hover {
		filter: brightness(1.1);
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

	.btn-action {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		border: 1px solid transparent;
	}

	.compact .btn-action {
		padding: 6px 12px;
		font-size: var(--text-xs);
	}

	.btn-action.primary {
		background: var(--brand);
		color: var(--brand-ink, #ffffff);
		border-color: transparent;
	}

	.btn-action.primary:hover {
		filter: brightness(1.1);
		box-shadow: 0 2px 6px color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.btn-action.secondary {
		background: var(--bg-raised);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.btn-action.secondary:hover {
		background: var(--bg-hover);
		border-color: var(--ink-muted);
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
		font-size: var(--text-xs);
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
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
		padding: 4px 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.shortcut-pill.interactive {
		cursor: pointer;
		transition: all 0.15s ease;
		background: var(--bg-raised);
	}

	.shortcut-pill.interactive:hover {
		color: var(--ink);
		border-color: var(--brand);
		background: var(--bg-hover);
	}

	.shortcut-key {
		background: color-mix(in srgb, var(--ink) 8%, transparent);
		color: var(--ink);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		padding: 1px 5px;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
	}

	.shortcut-label {
		white-space: nowrap;
	}
</style>
