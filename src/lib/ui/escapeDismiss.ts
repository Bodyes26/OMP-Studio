// Gli handler delegati di Svelte arrivano dopo i listener nativi del focus trap.
// Consuma Esc in capture: annulla il modulo senza chiudere il dialogo che lo ospita.
export function escapeDismiss(node: HTMLElement, callback?: () => void) {
	let dismiss = callback;
	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !dismiss) return;
		event.preventDefault();
		event.stopPropagation();
		dismiss();
	}
	node.addEventListener('keydown', onKeydown, true);
	return {
		update(next?: () => void) { dismiss = next; },
		destroy() { node.removeEventListener('keydown', onKeydown, true); }
	};
}
