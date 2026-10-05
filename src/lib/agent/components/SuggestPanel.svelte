<script lang="ts">
	/**
	 * Tendina dei suggerimenti per menzioni file (@) e comandi slash (/) nel composer (C20);
	 * nel companion anche progetti (#), direttive (/) e ruoli o modelli (!).
	 * Si posiziona sopra il cursore usando le coordinate del Range rettangolo del caret.
	 */
	import type { AvailableCommand } from '$lib/agent/wire';
	import type { RankedFileItem } from '$lib/agent/fileMention';
	import type { ComposerTriggerKind } from '$lib/agent/composerDoc';
	import { IconFile, IconEditor, IconHistory, IconSparkles } from '$lib/icons';
	import { formatTokens } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages.js';

	/** Voce del companion: valore inserito nel badge, nome leggibile e dettaglio in mono. */
	interface NamedSuggestion {
		value: string;
		label: string;
		hint?: string;
		hits?: number[];
	}

	export type SuggestionItem =
		| { kind: 'file'; item: RankedFileItem; hits?: number[] }
		| { kind: 'cmd'; command: AvailableCommand; isSkill: boolean; hits?: number[] }
		| ({ kind: 'project'; hue: number } & NamedSuggestion)
		| ({ kind: 'directive' } & NamedSuggestion)
		| ({ kind: 'role'; hue?: number } & NamedSuggestion)
		| ({ kind: 'model' } & NamedSuggestion);

	let {
		kind = '@',
		query = '',
		items = [],
		selectedIndex = 0,
		left = 0,
		bottom = 0,
		top,
		emptyMessage,
		onPick,
		onHover
	} = $props<{
		kind: ComposerTriggerKind;
		query: string;
		items: SuggestionItem[];
		selectedIndex: number;
		left: number;
		bottom: number;
		/** Se presente la palette si apre sotto la riga (editor in cima alla vista). */
		top?: number;
		/** Sostituisce il messaggio a lista vuota (es. «indica prima il progetto»). */
		emptyMessage?: string;
		onPick: (s: SuggestionItem) => void;
		onHover: (index: number) => void;
	}>();

	const NAMED_HEADERS: Record<'project' | 'directive' | 'role' | 'model', () => string> = {
		project: m.suggest_section_projects,
		directive: m.suggest_section_directives,
		role: m.suggest_section_roles,
		model: m.suggest_section_models
	};

	let listEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!listEl || items.length === 0) return;
		const el = listEl.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | null;
		el?.scrollIntoView({ block: 'nearest' });
	});
</script>

{#snippet highlightText(text: string, hits: number[] = [], offset = 0)}
	{#if hits.length === 0}
		{text}
	{:else}
		{@const hitSet = new Set(hits)}
		{#each [...text] as ch, i}
			{#if hitSet.has(i + offset)}
				<mark class="highlight-char">{ch}</mark>
			{:else}
				<span>{ch}</span>
			{/if}
		{/each}
	{/if}
{/snippet}

<div
	class="suggest-panel rv-lift"
	style={top === undefined ? `left: ${left}px; bottom: ${bottom}px;` : `left: ${left}px; top: ${top}px;`}
	role="listbox"
	tabindex="-1"
>
	<div bind:this={listEl} class="suggest-list">
		{#if items.length === 0}
			<div class="empty-notice">
				{emptyMessage ??
					(kind === '@'
						? m.chat_v2_composer_no_files({ query })
						: m.chat_v2_composer_no_commands({ query }))}
			</div>
		{:else}
			{#each items as item, index}
				{@const active = index === selectedIndex}
				{@const prev = items[index - 1]}

				<!-- Header di sezione -->
				{#if item.kind === 'file' && index === 0}
					<div class="section-header">
						{query.trim().length === 0
							? m.chat_v2_composer_recent_files()
							: m.chat_v2_composer_project_files()}
					</div>
				{:else if item.kind === 'cmd' && (!prev || (prev.kind === 'cmd' && prev.isSkill !== item.isSkill))}
					<div class="section-header">
						{item.isSkill
							? m.chat_v2_composer_skills()
							: m.chat_v2_composer_commands()}
					</div>
				{:else if item.kind !== 'file' && item.kind !== 'cmd' && (!prev || prev.kind !== item.kind)}
					<div class="section-header">{NAMED_HEADERS[item.kind as keyof typeof NAMED_HEADERS]()}</div>
				{/if}

				{#if item.kind === 'file'}
					{@const file = item.item}
					{@const nameIdx = file.path.lastIndexOf('/') + 1}
					<button
						type="button"
						role="option"
						aria-selected={active}
						data-index={index}
						class="suggest-row"
						class:active
						onmousedown={(e) => e.preventDefault()}
						onmouseenter={() => onHover(index)}
						onclick={() => onPick(item)}
					>
						<span class="row-icon">
							{#if file.priority === 'active' || file.priority === 'open'}
								<IconEditor />
							{:else if file.priority === 'touched'}
								<IconHistory />
							{:else}
								<IconFile />
							{/if}
						</span>

						<span class="file-name">
							{@render highlightText(file.path.slice(nameIdx), item.hits, nameIdx)}
						</span>

						{#if nameIdx > 0}
							<span class="file-dir font-mono">
								{@render highlightText(file.path.slice(0, nameIdx), item.hits, 0)}
							</span>
						{/if}

						{#if active}
							<span class="token-est font-mono">
								~{formatTokens(Math.min(40000, Math.round(file.path.length * 30)))} tok
							</span>
						{/if}
					</button>
				{:else if item.kind === 'cmd'}
					{@const cmd = item.command}
					<button
						type="button"
						role="option"
						aria-selected={active}
						data-index={index}
						class="suggest-row cmd-row"
						class:active
						onmousedown={(e) => e.preventDefault()}
						onmouseenter={() => onHover(index)}
						onclick={() => onPick(item)}
					>
						<span class="row-icon">
							{#if item.isSkill}
								<IconSparkles />
							{:else}
								<span class="slash-glyph font-mono">/</span>
							{/if}
						</span>

						<div class="cmd-content">
							<div class="cmd-top">
								<span class="cmd-name font-mono">
									/<span>{@render highlightText(cmd.name, item.hits)}</span>
								</span>
								{#if cmd.input?.hint}
									<span class="cmd-args font-mono">‹{cmd.input.hint}›</span>
								{/if}
								{#if !item.isSkill && (cmd.source === 'studio' || ['new', 'compact', 'copy', 'model', 'role', 'thinking'].includes(cmd.name))}
									<span class="cmd-badge-immediate">{m.chat_v2_composer_immediate()}</span>
								{/if}
							</div>
							<span class="cmd-desc">{cmd.description}</span>
						</div>
					</button>
				{:else}
					<button
						type="button"
						role="option"
						aria-selected={active}
						data-index={index}
						class="suggest-row"
						class:active
						onmousedown={(e) => e.preventDefault()}
						onmouseenter={() => onHover(index)}
						onclick={() => onPick(item)}
					>
						<span class="row-icon">
							{#if item.kind === 'project'}
								<span class="identity-dot project" style="--dot-h: {item.hue}"></span>
							{:else if item.kind === 'role'}
								{#if item.hue !== undefined}
									<span class="identity-dot role" style="--dot-h: {item.hue}"></span>
								{:else if item.value === 'default'}
									<span class="identity-dot role is-default"></span>
								{/if}
							{:else if item.kind === 'directive'}
								<span class="slash-glyph font-mono">/</span>
							{:else}
								<IconSparkles />
							{/if}
						</span>
						<span class="file-name">{@render highlightText(item.label, item.hits)}</span>
						{#if item.hint && item.hint !== item.label}
							<span class="file-dir font-mono">{item.hint}</span>
						{/if}
					</button>
				{/if}
			{/each}
		{/if}
	</div>

	<div class="suggest-footer">
		<span><kbd>↑↓</kbd> naviga</span>
		<span><kbd>↵</kbd> o <kbd>Tab</kbd> inserisci</span>
		<span><kbd>Esc</kbd> chiudi</span>
	</div>
</div>

<style>
	.suggest-panel {
		position: absolute;
		z-index: var(--z-overlay);
		/* Larghezza allineata a SUGGEST_WIDTH in Composer.svelte (calcolo dell'ancoraggio). */
		width: 440px;
		max-width: calc(100% - 16px);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		color: var(--ink);
		font-family: var(--font-ui);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		/* La palette segue la digitazione: comparsa rapida, non la rivelazione lenta della chat. */
		--dur: 150ms;
		--blur: 3px;
	}

	.suggest-list {
		padding: var(--space-1);
		max-height: 280px;
		overflow-x: hidden;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.section-header {
		padding: var(--space-2) var(--space-2) 2px;
		font-size: var(--text-group-label);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}

	.suggest-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: 5px var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		text-align: left;
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.suggest-row:hover,
	.suggest-row.active {
		background: var(--bg-hover);
	}

	.cmd-row {
		align-items: flex-start;
		padding: 6px var(--space-2);
	}

	.row-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-muted);
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		margin-top: 1px;
		--icon-size: 14px;
	}

	.slash-glyph {
		font-weight: 700;
		color: var(--ink-muted);
	}

	/* Punto d'identita' (D1): progetto nella rampa di riempimento delle tessere,
	   ruolo nella rampa d'inchiostro come nel menu dei ruoli. */
	.identity-dot {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
	}

	.identity-dot.project {
		background: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--dot-h, 260));
	}

	.identity-dot.role {
		background: oklch(var(--proj-l-ink) var(--proj-c-ink) var(--dot-h, 260));
	}

	.identity-dot.role.is-default {
		background: var(--brand-ink);
	}

	.file-name {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		flex-shrink: 1;
	}

	.file-dir {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}

	.token-est {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		flex-shrink: 0;
		margin-left: auto;
	}

	.cmd-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.cmd-top {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
	}

	.cmd-name {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.cmd-args {
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.cmd-badge-immediate {
		margin-left: auto;
		font-size: var(--text-caption);
		color: var(--ink-faint);
		padding: 0 4px;
		background: var(--bg-base);
		border-radius: var(--radius-sm);
	}

	.cmd-desc {
		font-size: var(--text-caption);
		line-height: 1.35;
		color: var(--ink-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.suggest-row.active .cmd-desc {
		white-space: normal;
	}

	.highlight-char {
		background: transparent;
		color: var(--ink);
		font-weight: 700;
		text-decoration: underline;
		text-decoration-color: var(--warn);
		text-decoration-thickness: 2px;
		text-underline-offset: 2px;
	}

	.empty-notice {
		padding: var(--space-4);
		text-align: center;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.suggest-footer {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 5px var(--space-3);
		border-top: 1px solid var(--line);
		background: var(--bg-base);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		border-bottom-left-radius: var(--radius-lg);
		border-bottom-right-radius: var(--radius-lg);
	}

	.suggest-footer kbd {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}
</style>
