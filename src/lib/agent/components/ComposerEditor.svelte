<script lang="ts">
	/**
	 * Editor contenteditable con badge non modificabili (@file e /comando) (C19).
	 * Gestisce incollaggio testo semplice/file, sicurezza composizione IME,
	 * navigazione caret, cancellazione e undo nativo.
	 */
	import {
		serializeEditorDom,
		segmentsToWireText,
		parsePlainTextToSegments,
		renderSegmentsToDom,
		NBSP,
		type ComposerSegment
	} from '$lib/agent/composerDoc';

	let {
		placeholder = '',
		ariaLabel = "Messaggio per l'agente",
		submitWithModifier = false,
		disabled = false,
		onSend,
		onFilesPaste,
		onTriggerChange,
		onKeydownFilter,
		onInput
	} = $props<{
		placeholder?: string;
		ariaLabel?: string;
		/**
		 * Invio va a capo e solo Ctrl/Cmd+Invio chiama `onSend`: serve dove si scrive
		 * un testo lungo e ponderato (Task Editor), non una battuta della chat.
		 */
		submitWithModifier?: boolean;
		disabled?: boolean;
		onSend?: (isAlt: boolean) => void;
		onFilesPaste?: (files: FileList | File[]) => void;
		onTriggerChange?: (trigger: { kind: '@' | '/'; query: string; node: Text; start: number; caretRect: { left: number; top: number } } | null) => void;
		onKeydownFilter?: (e: KeyboardEvent) => boolean;
		onInput?: () => void;
	}>();

	let editorEl = $state<HTMLDivElement | null>(null);
	let isComposing = $state(false);
	let isBlank = $state(true);
	let dismissedTrigger = $state<{ node: Node; start: number } | null>(null);

	export function focus(): void {
		editorEl?.focus();
	}

	/** Fuoco con il cursore in fondo al testo (riapertura di una bozza). */
	export function focusEnd(): void {
		if (!editorEl) return;
		editorEl.focus();
		caretAfter(editorEl, editorEl.childNodes.length);
	}

	export function clear(): void {
		if (editorEl) {
			editorEl.innerHTML = '';
			sync();
		}
	}

	export function getSegments(): ComposerSegment[] {
		if (!editorEl) return [];
		return serializeEditorDom(editorEl);
	}

	export function getWireText(isSkill?: (name: string) => boolean): string {
		return segmentsToWireText(getSegments(), isSkill);
	}

	export function setSegments(segs: ComposerSegment[]): void {
		if (!editorEl) return;
		renderSegmentsToDom(segs, editorEl);
		sync();
	}

	export function setPlainText(text: string, isSkill?: (name: string) => boolean): void {
		const segs = parsePlainTextToSegments(text, isSkill);
		setSegments(segs);
	}

	export function getIsBlank(): boolean {
		return isBlank;
	}

	export function getIsEmpty(): boolean {
		const segs = getSegments();
		return !segs.some((s) => s.t !== 'text' || s.s.trim().length > 0);
	}

	/**
	 * Posiziona il cursore subito dopo il nodo specificato.
	 */
	function caretAfter(node: Node, offset: number) {
		const sel = window.getSelection();
		if (!sel) return;
		const r = document.createRange();
		r.setStart(node, offset);
		r.collapse(true);
		sel.removeAllRanges();
		sel.addRange(r);
	}

	/**
	 * Inserisce il carattere '@' alla posizione corrente del cursore.
	 */
	export function insertAt(): void {
		if (!editorEl) return;
		editorEl.focus();
		const sel = window.getSelection();
		if (!sel || !sel.rangeCount || !editorEl.contains(sel.anchorNode)) {
			caretAfter(editorEl, editorEl.childNodes.length);
		}
		const node = sel?.anchorNode;
		const prev = node?.nodeType === Node.TEXT_NODE ? (node.textContent ?? '')[(sel?.anchorOffset ?? 1) - 1] : undefined;
		const textToInsert = prev && !/[\s\u00A0]/.test(prev) ? ' @' : '@';
		document.execCommand('insertText', false, textToInsert);
		sync();
	}

	/**
	 * Sostituisce il range del trigger corrente con il badge specificato (o lo elimina).
	 */
	export function replaceTrigger(badgeEl: HTMLElement | null, trigger: { node: Text; start: number; query: string }): void {
		if (!editorEl) return;
		const range = document.createRange();
		range.setStart(trigger.node, trigger.start);
		range.setEnd(trigger.node, Math.min(trigger.node.length, trigger.start + 1 + trigger.query.length));
		range.deleteContents();

		if (badgeEl) {
			range.insertNode(badgeEl);
			const spaceNode = document.createTextNode(NBSP);
			badgeEl.after(spaceNode);
			caretAfter(spaceNode, 1);
		} else {
			caretAfter(trigger.node, trigger.start);
		}
		sync();
	}

	export function dismissCurrentTrigger(trigger: { node: Text; start: number }): void {
		dismissedTrigger = { node: trigger.node, start: trigger.start };
		onTriggerChange?.(null);
	}

	/**
	 * Legge lo stato del trigger (@ o /) alla posizione corrente del caret.
	 */
	function readTrigger(): { kind: '@' | '/'; query: string; node: Text; start: number; caretRect: { left: number; top: number } } | null {
		if (!editorEl) return null;
		const sel = window.getSelection();
		if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
		const node = sel.anchorNode;
		if (!node || node.nodeType !== Node.TEXT_NODE || !editorEl.contains(node)) return null;

		const fullText = node.textContent ?? '';
		const before = fullText.slice(0, sel.anchorOffset);

		let kind: '@' | '/';
		let query: string;

		// 1. Trigger @ per i file (a inizio testo o preceduto da spazio/NBSP)
		const atMatch = before.match(/(?:^|[\s\u00A0])@([^\s\u00A0@]*)$/);
		if (atMatch) {
			kind = '@';
			query = atMatch[1];
		} else {
			// 2. Trigger / per comandi e skill: come @, a inizio testo o dopo uno spazio,
			// cosi' si richiama una skill anche a meta' frase. Un / dentro una parola
			// (percorsi, URL) non apre la palette.
			const slashMatch = before.match(/(?:^|[\s\u00A0])\/([\w:-]*)$/);
			if (!slashMatch) return null;
			kind = '/';
			query = slashMatch[1];
		}

		const start = sel.anchorOffset - query.length - 1;
		if (dismissedTrigger && dismissedTrigger.node === node && dismissedTrigger.start === start) {
			return null;
		}

		// Calcolo coordinate Range rettangolo del caret
		const range = document.createRange();
		range.setStart(node, start);
		range.setEnd(node, start + 1);
		const rect = range.getBoundingClientRect();

		return {
			kind,
			query,
			node: node as Text,
			start,
			caretRect: { left: rect.left, top: rect.top }
		};
	}

	function sync() {
		if (!editorEl) return;
		// Pulizia nodi vuoti residui
		if (!editorEl.textContent && !editorEl.querySelector('[data-kind]') && editorEl.innerHTML) {
			editorEl.innerHTML = '';
		}

		isBlank = !editorEl.textContent && !editorEl.querySelector('[data-kind]');
		onInput?.();

		const trigger = readTrigger();
		onTriggerChange?.(trigger);
	}

	function handlePaste(e: ClipboardEvent) {
		e.preventDefault();
		const clipboard = e.clipboardData;
		if (!clipboard) return;

		// Se la clipboard contiene file (es. screenshot incollati, file trascinati)
		if (clipboard.files && clipboard.files.length > 0) {
			onFilesPaste?.(clipboard.files);
			return;
		}

		// Incollaggio testo semplice per preservare l'undo nativo
		const text = clipboard.getData('text/plain');
		if (text) {
			document.execCommand('insertText', false, text);
			sync();
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		// Se la palette o il parent ha gestito il tasto (es. frecce, invio scelta, Esc)
		if (onKeydownFilter && onKeydownFilter(e)) {
			return;
		}

		// Sicurezza IME composition: durante la digitazione CJK / accenti Enter non invia
		if (isComposing || e.isComposing) {
			if (e.key === 'Enter') {
				return;
			}
		}

		if (e.key === 'Enter') {
			if (submitWithModifier) {
				// Invio semplice resta il ritorno a capo nativo del contenteditable.
				if (!(e.ctrlKey || e.metaKey)) return;
				e.preventDefault();
				onSend?.(e.altKey);
				return;
			}
			if (e.shiftKey || e.ctrlKey) {
				// Shift/Ctrl+Invio inseriscono un ritorno a capo.
				return;
			}
			e.preventDefault();
			const isAlt = e.altKey;
			onSend?.(isAlt);
		}
	}
</script>

<div class="composer-editor-wrapper">
	{#if isBlank}
		<div class="editor-placeholder" aria-hidden="true">
			{placeholder}
		</div>
	{/if}

	<div
		bind:this={editorEl}
		contenteditable={!disabled}
		role="textbox"
		aria-multiline="true"
		aria-label={ariaLabel}
		spellcheck="false"
		class="composer-editable"
		class:disabled
		oninput={sync}
		onblur={() => onTriggerChange?.(null)}
		onfocus={() => onTriggerChange?.(readTrigger())}
		onpaste={handlePaste}
		onkeydown={handleKeyDown}
		oncompositionstart={() => (isComposing = true)}
		oncompositionend={() => {
			isComposing = false;
			sync();
		}}
	></div>
</div>

<style>
	.composer-editor-wrapper {
		position: relative;
		width: 100%;
		min-width: 0;
		padding: 10px 14px 4px;
	}

	.editor-placeholder {
		position: absolute;
		left: 14px;
		right: 14px;
		top: 10px;
		color: var(--ink-faint);
		font-family: var(--font-ui);
		font-size: var(--text-chat);
		line-height: 24px;
		pointer-events: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		user-select: none;
	}

	/* Altezza regolabile dal consumatore: la chat resta 24-240 px, il Task Editor
	   imposta --editor-min-height e --editor-max-height sul contenitore. */
	.composer-editable {
		min-height: var(--editor-min-height, 24px);
		max-height: var(--editor-max-height, 240px);
		overflow-y: auto;
		overflow-x: hidden;
		outline: none;
		font-family: var(--font-ui);
		font-size: var(--text-chat);
		line-height: 24px;
		color: var(--ink);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.composer-editable :global(.chat-badge) {
		max-width: min(260px, calc(100% - 2px));
	}

	.composer-editable.disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
