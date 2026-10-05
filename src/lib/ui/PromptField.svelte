<!--
  PromptField.svelte — Campo per scrivere un prompt fuori dalla chat (Two Voices Rule).

  ComposerEditor nella sagoma del composer, in voce chat 15/24, con testo semplice in
  entrata e in uscita e nessuna palette: nelle impostazioni globali un `@file` o un
  `/comando` non hanno un progetto o una sessione a cui riferirsi.
  Invio va a capo, Ctrl+Invio conferma (`onSubmit`), Esc annulla (`onCancel`).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import ComposerEditor from '$lib/agent/components/ComposerEditor.svelte';
	import { escapeDismiss } from './escapeDismiss';

	interface PromptFieldProps {
		value?: string;
		placeholder?: string;
		ariaLabel: string;
		onSubmit?: () => void;
		onCancel?: () => void;
	}

	let { value = $bindable(''), placeholder = '', ariaLabel, onSubmit, onCancel }: PromptFieldProps = $props();

	let editor = $state<ComposerEditor | null>(null);
	// Ultimo testo scritto dall'editor: distingue una modifica esterna (bozza caricata,
	// testo generato dall'AI) dall'eco della digitazione, che non va riscritta nel DOM.
	let lastEmitted: string | null = null;

	$effect(() => {
		const next = value;
		const ed = editor;
		if (!ed || next === lastEmitted) return;
		untrack(() => {
			lastEmitted = next;
			// Un solo segmento di testo: niente badge ricostruiti dal testo (un
			// `/skill:x` iniziale perderebbe il prefisso nel giro di andata e ritorno).
			ed.setSegments(next ? [{ t: 'text', s: next }] : []);
		});
	});

	function handleInput() {
		if (!editor) return;
		const text = editor.getWireText();
		lastEmitted = text;
		value = text;
	}


	export function focus(): void {
		editor?.focusEnd();
	}
</script>

<div class="composer-shell prompt-field" use:escapeDismiss={onCancel}>
	<ComposerEditor
		bind:this={editor}
		{placeholder}
		{ariaLabel}
		triggers={[]}
		submitWithModifier
		onSend={() => onSubmit?.()}
		onInput={handleInput}
	/>
</div>

<style>
	.prompt-field {
		--editor-min-height: 96px;
		--editor-max-height: 280px;
		/* Senza barra sotto l'editor: il margine inferiore pareggia quello superiore. */
		padding-bottom: 6px;
	}

	.prompt-field:has(:global(.composer-editable:focus-visible)) {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
</style>
