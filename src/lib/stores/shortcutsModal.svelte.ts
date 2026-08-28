/**
 * Store reattivo Svelte 5 per il controllo dello stato del modale delle scorciatoie da tastiera.
 * Permette l'apertura/chiusura globale da qualsiasi superficie (GUI, Terminale, Editor, TopBar, EmptyState).
 */
class ShortcutsModalStore {
	isOpen = $state(false);

	open() {
		this.isOpen = true;
	}

	close() {
		this.isOpen = false;
	}

	toggle() {
		this.isOpen = !this.isOpen;
	}
}

export const shortcutsModalStore = new ShortcutsModalStore();
