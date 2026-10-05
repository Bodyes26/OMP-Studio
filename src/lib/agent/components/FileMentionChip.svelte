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

<button
	type="button"
	class="chat-badge chat-badge--file file-mention-btn"
	title={`${path} • Clicca per aprire nell'editor`}
	onclick={open}
>
	<span class="chat-badge-glyph"><IconFile aria-hidden="true" /></span>
	<span class="chat-badge-name">{baseName(path)}</span>
</button>

<style>
	.file-mention-btn {
		border: none;
		cursor: pointer;
		text-align: left;
		transition:
			box-shadow var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.file-mention-btn:hover {
		color: var(--brand-ink);
		box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--brand) 45%, transparent);
	}

	.file-mention-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
</style>
