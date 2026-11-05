// Il DOM della sandbox non propaga la tastiera al guscio: inoltriamo solo
// la navigazione progetto/corsia, senza concedere accesso al DOM o a IPC.
export const PREVIEW_SHORTCUT_SCRIPT = `<script>window.addEventListener('keydown',function(e){if((e.key!=='Tab'&&e.code!=='Tab')||!(e.ctrlKey||e.metaKey)||e.altKey)return;e.preventDefault();e.stopImmediatePropagation();window.parent.postMessage({source:'studio-preview-shortcut',type:e.shiftKey?'lane-next':'project-next'},'*');},true);</script>`;

export function previewShortcuts(frame: HTMLIFrameElement): { destroy(): void } {
	const host = frame.ownerDocument.defaultView!;
	function receive(event: MessageEvent) {
		if (event.source !== frame.contentWindow || frame.ownerDocument.activeElement !== frame) return;
		const data = event.data;
		if (!data || data.source !== 'studio-preview-shortcut') return;
		if (data.type !== 'project-next' && data.type !== 'lane-next') return;
		// Riutilizza il gestore del guscio, comprese le sue guardie sui dialoghi.
		host.dispatchEvent(new KeyboardEvent('keydown', {
			key: 'Tab', code: 'Tab', ctrlKey: true,
			shiftKey: data.type === 'lane-next', cancelable: true
		}));
	}
	host.addEventListener('message', receive);
	return { destroy: () => host.removeEventListener('message', receive) };
}
