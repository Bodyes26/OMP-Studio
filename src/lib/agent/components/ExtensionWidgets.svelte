<script lang="ts">
	/**
	 * Widget di testo delle estensioni di omp (`setWidget`), sopra o sotto il
	 * composer come nella TUI (`aboveEditor` / `belowEditor`).
	 *
	 * Sono righe da terminale: blocco monospazio, niente a capo automatico (le
	 * colonne restano allineate, chi sfora scorre in orizzontale). I colori
	 * ANSI diventano i toni semantici di Studio (`parseAnsiLine`): la palette
	 * a sedici colori appartiene al terminale e al tema di omp.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import {
		parseAnsiLine,
		widgetsAt,
		type ExtensionWidgetMap,
		type ExtensionWidgetPlacement
	} from '../extensionUi';

	let { widgets, placement } = $props<{
		widgets: ExtensionWidgetMap;
		placement: ExtensionWidgetPlacement;
	}>();

	const items = $derived(widgetsAt(widgets, placement));
</script>

{#if items.length > 0}
	<div class="ext-widgets" class:below={placement === 'belowEditor'}>
		{#each items as widget (widget.key)}
			<div
				class="ext-widget"
				role="group"
				aria-label={m.chat_v2_composer_extension_widget_aria({ key: widget.key })}
			>
				{#each widget.lines as line, index (index)}
					<div class="ext-line">
						{#each parseAnsiLine(line) as seg, segIndex (segIndex)}<span
								class="seg"
								class:tone-danger={seg.tone === 'danger'}
								class:tone-success={seg.tone === 'success'}
								class:tone-warn={seg.tone === 'warn'}
								class:tone-accent={seg.tone === 'accent'}
								class:tone-muted={seg.tone === 'muted'}
								class:tone-strong={seg.tone === 'strong'}
								class:bold={seg.bold}
								class:dim={seg.dim}
								class:italic={seg.italic}
								class:underline={seg.underline}>{seg.text}</span
							>{/each}
					</div>
				{/each}
			</div>
		{/each}
	</div>
{/if}

<style>
	/* Superficie neutra come le strisce sopra l'editor: `--bg-base`, bordo
	   `--line`, `--radius-md`, testo mono 11 px `--ink-muted`. */
	.ext-widgets {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0 var(--space-2) 6px;
		min-width: 0;
	}

	.ext-widgets.below {
		margin: 6px var(--space-2) 0;
	}

	.ext-widget {
		padding: 6px 10px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.5;
		color: var(--ink-muted);
		max-height: 180px;
		overflow: auto;
		user-select: text;
	}

	.ext-line {
		white-space: pre;
		min-height: 1.5em;
	}

	.tone-danger {
		color: var(--danger);
	}
	.tone-success {
		color: var(--success);
	}
	.tone-warn {
		color: var(--warn);
	}
	.tone-accent {
		color: var(--brand-ink);
	}
	.tone-muted {
		color: var(--ink-faint);
	}
	.tone-strong {
		color: var(--ink);
	}
	.bold {
		font-weight: 600;
	}
	.dim {
		opacity: 0.7;
	}
	.italic {
		font-style: italic;
	}
	.underline {
		text-decoration: underline;
	}
</style>
