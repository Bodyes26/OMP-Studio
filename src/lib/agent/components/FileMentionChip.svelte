<script lang="ts">
	// Menzione `@percorso` resa nel punto del testo in cui e' stata scritta.
	// Stesso aspetto del chip "Editor" in fondo alla bolla, ma inline: sta
	// dentro la riga e ne segue l'altezza.
	import { IconFile } from '$lib/icons';
	import { baseName } from '../tools/types';
	import { agentUiHooks } from '../ui-context';

	// `onOpen` serve alle superfici fuori dal transcript (anteprime dei task),
	// dove i ganci dell'agente non esistono e il clic non farebbe nulla.
	let { path, onOpen }: { path: string; onOpen?: (path: string) => void } = $props();

	const hooks = agentUiHooks();

	function open(event: MouseEvent) {
		// Nelle anteprime il chip sta dentro una card cliccabile: il clic apre
		// il file, non la card.
		event.stopPropagation();
		if (onOpen) onOpen(path);
		else hooks.openFile(path, null);
	}
</script>

<button type="button" class="file-mention-chip" title={`${path} • Clicca per aprire nell'editor`} onclick={open}>
	<span class="glyph"><IconFile aria-hidden="true" /></span>
	<span class="name">{baseName(path)}</span>
</button>

<style>
	.file-mention-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		max-width: 100%;
		margin: 0 1px;
		padding: 0 5px;
		vertical-align: baseline;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 0.86em;
		line-height: 1.45;
		color: var(--ink);
		cursor: pointer;
		white-space: nowrap;
		user-select: text;
		transition:
			color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.file-mention-chip:hover {
		color: var(--brand-ink);
		border-color: var(--line-strong);
	}

	.file-mention-chip:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}

	.glyph {
		--icon-size: 11px;
		display: inline-flex;
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.name {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
