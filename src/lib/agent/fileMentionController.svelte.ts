// Stato e tastiera della palette @file, condivisi da ogni textarea che
// accetta menzioni (composer della chat, editor dei task, companion).
// Il chiamante resta padrone del testo: il controller legge testo e caret
// da `update()` e restituisce il risultato di una scelta con `apply()`.

import {
	extractFileMentionAtCursor,
	insertFileMentionAtCursor,
	loadProjectFiles,
	rankFileCandidates,
	type FileMentionMatch,
	type FileRankingContext,
	type RankedFileItem
} from './fileMention';

export interface FileMentionControllerOptions {
	/** Progetto da cui prendere i file; vuoto = progetto non ancora scelto. */
	projectPath: () => string | null | undefined;
	/** Priorita' per file attivo, aperti e toccati dall'agente. */
	rankingContext?: () => FileRankingContext;
	/** Riceve testo e caret dopo l'inserimento della menzione scelta. */
	apply: (text: string, caret: number) => void;
}

export class FileMentionController {
	open = $state(false);
	items = $state<RankedFileItem[]>([]);
	selectedIndex = $state(0);
	/** @ digitata senza un progetto da cui cercare (companion prima di #progetto). */
	missingProject = $state(false);

	#options: FileMentionControllerOptions;
	#match: FileMentionMatch | null = null;
	#text = '';
	// Il catalogo si carica in modo asincrono: una risposta arrivata dopo un
	// tasto successivo non deve sovrascrivere la lista piu' recente.
	#generation = 0;

	constructor(options: FileMentionControllerOptions) {
		this.#options = options;
	}

	async update(text: string, caret: number): Promise<void> {
		const generation = ++this.#generation;
		const match = extractFileMentionAtCursor(text, caret);
		if (!match) {
			this.close();
			return;
		}
		this.#match = match;
		this.#text = text;

		const projectPath = this.#options.projectPath();
		if (!projectPath) {
			this.missingProject = true;
			this.items = [];
			this.selectedIndex = 0;
			this.open = true;
			return;
		}

		const files = await loadProjectFiles(projectPath);
		if (generation !== this.#generation) return;
		const ranked = rankFileCandidates(match.query, files, this.#options.rankingContext?.() ?? {}, 8);
		this.missingProject = false;
		this.items = ranked;
		if (this.selectedIndex >= ranked.length) this.selectedIndex = 0;
		this.open = true;
	}

	close(): void {
		this.#generation++;
		this.#match = null;
		this.open = false;
		this.items = [];
		this.selectedIndex = 0;
		this.missingProject = false;
	}

	pick(item: RankedFileItem): void {
		const match = this.#match;
		this.close();
		if (!match) return;
		const result = insertFileMentionAtCursor(this.#text, match.startIndex, match.endIndex, item.path);
		this.#options.apply(result.newText, result.newCursorPos);
	}

	/** Navigazione della palette aperta; `true` se il tasto e' stato consumato. */
	handleKeydown(event: KeyboardEvent): boolean {
		if (!this.open) return false;
		const count = this.items.length;
		switch (event.key) {
			case 'ArrowDown':
				if (count > 0) this.selectedIndex = (this.selectedIndex + 1) % count;
				break;
			case 'ArrowUp':
				if (count > 0) this.selectedIndex = (this.selectedIndex - 1 + count) % count;
				break;
			case 'Enter':
			case 'Tab': {
				const item = this.items[this.selectedIndex];
				if (item) this.pick(item);
				else this.close();
				break;
			}
			case 'Escape':
				this.close();
				break;
			default:
				return false;
		}
		event.preventDefault();
		return true;
	}
}
