// Coda delle note visive di una sessione Laboratorio (Gate R3X-lab-indica).
//
// La scrive LabPreview (Punta, Riquadro, riaggancio, cattura) e la legge il
// composer (chip, invio). Una coda per sessione, anche se il composer non e'
// montato: vive in una WeakMap accanto alla sessione, senza toccarne la classe.
//
// `revision` cresce a ogni cambiamento strutturale (note aggiunte, rimosse,
// riagganciate), non con la sola modifica del testo: dice a LabPreview quando
// risincronizzare l'ispettore e ricatturare il fotogramma.

import type { LabFrame, LabNote, LabNoteKind, LabRect, LabTarget } from './visualNotes';

export type LabCaptureStatus = 'idle' | 'pending' | 'ok' | 'failed';

export interface LabSyncedNote {
	id: string;
	stale: boolean;
	targets?: LabTarget[];
	groups?: LabTarget[];
	total?: number;
	omitted?: number;
}

export class LabVisualNotes {
	notes = $state<LabNote[]>([]);
	activeId = $state<string | null>(null);
	revision = $state(0);
	frame = $state<LabFrame | null>(null);
	captureStatus = $state<LabCaptureStatus>('idle');
	captureError = $state<string | null>(null);
	/** Es. `desktop 1180×760`, aggiornato da LabPreview. */
	viewport = $state('');

	private nextN = 1;
	private seq = 0;
	private captureHandler: (() => Promise<void>) | null = null;
	private clearHandlers = new Set<() => void>();

	get count(): number {
		return this.notes.length;
	}

	add(kind: LabNoteKind, targets: LabTarget[], extra: { rect?: LabRect; total?: number; omitted?: number; pickId?: string } = {}): LabNote {
		const note: LabNote = {
			id: `vn-${Date.now().toString(36)}-${++this.seq}`,
			n: this.nextN++,
			kind,
			targets,
			text: '',
			stale: false,
			...extra
		};
		this.notes = [...this.notes, note];
		this.activeId = note.id;
		this.bump();
		return note;
	}

	/** Maiusc+clic: aggiunge un elemento alla nota attiva (o all'ultima). */
	addTarget(target: LabTarget): LabNote | null {
		const id = this.activeId ?? this.notes.at(-1)?.id;
		const note = this.notes.find((n) => n.id === id && n.kind === 'point');
		if (!note) return null;
		this.notes = this.notes.map((n) => (n.id === note.id ? { ...n, targets: [...n.targets, target] } : n));
		this.activeId = note.id;
		this.bump();
		return this.notes.find((n) => n.id === note.id) ?? null;
	}

	setText(id: string, text: string): void {
		this.notes = this.notes.map((n) => (n.id === id ? { ...n, text } : n));
	}

	remove(id: string): void {
		this.notes = this.notes.filter((n) => n.id !== id);
		if (this.activeId === id) this.activeId = null;
		if (this.notes.length === 0) this.nextN = 1;
		this.bump();
	}

	clear(): void {
		this.notes = [];
		this.activeId = null;
		this.nextN = 1;
		this.frame = null;
		this.captureStatus = 'idle';
		this.captureError = null;
		this.bump();
		for (const h of this.clearHandlers) h();
	}

	/** Esito del riaggancio dopo una ricompilazione: aggiorna solo cio' che e' cambiato. */
	applySync(results: readonly LabSyncedNote[]): void {
		let changed = false;
		const next = this.notes.map((note) => {
			const r = results.find((x) => x.id === note.id);
			if (!r) return note;
			const updated: LabNote = { ...note, stale: r.stale };
			if (note.kind === 'point' && r.targets) updated.targets = r.targets;
			if (note.kind === 'area' && r.groups) {
				updated.targets = r.groups;
				updated.total = r.total;
				updated.omitted = r.omitted;
			}
			if (JSON.stringify(updated) !== JSON.stringify(note)) changed = true;
			return updated;
		});
		if (changed) {
			this.notes = next;
			this.bump();
		}
	}

	setFrame(frame: LabFrame | null, status: LabCaptureStatus, error: string | null = null): void {
		this.frame = frame;
		this.captureStatus = status;
		this.captureError = error;
	}

	registerCaptureHandler(handler: () => Promise<void>): () => void {
		this.captureHandler = handler;
		return () => {
			if (this.captureHandler === handler) this.captureHandler = null;
		};
	}

	onClear(handler: () => void): () => void {
		this.clearHandlers.add(handler);
		return () => this.clearHandlers.delete(handler);
	}

	/**
	 * Fotogramma per l'invio: quello pronto se e' della revisione corrente,
	 * altrimenti ne chiede uno all'anteprima e lo aspetta al massimo `timeoutMs`.
	 * `null` = si invia solo il testo.
	 */
	async frameForSend(timeoutMs = 6000): Promise<LabFrame | null> {
		if (this.notes.length === 0) return null;
		const current = this.frame;
		if (current && current.revision === this.revision) return current;
		if (!this.captureHandler) return null;
		let timer: ReturnType<typeof setTimeout> | null = null;
		try {
			await Promise.race([
				this.captureHandler(),
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, timeoutMs);
				})
			]);
		} catch {
			return null;
		} finally {
			if (timer) clearTimeout(timer);
		}
		const after = this.frame as LabFrame | null;
		return after && after.revision === this.revision ? after : null;
	}

	private bump(): void {
		this.revision += 1;
	}
}

const stores = new WeakMap<object, LabVisualNotes>();

/** Coda delle note visive della sessione (creata al primo uso). */
export function labVisualNotesFor(session: object): LabVisualNotes {
	let store = stores.get(session);
	if (!store) {
		store = new LabVisualNotes();
		stores.set(session, store);
	}
	return store;
}
