/**
 * todoTrace.ts
 *
 * Funzione pura e tracker per estrarre le tracce sintetiche dei todo nel flusso
 * della chat (Gate R32 - C12).
 *
 * Regole del piano:
 * - riga "Lista di N todo · k completati" espandibile alla prima creazione;
 * - marcatore "2/5 titolo" quando cambia il todo attivo;
 * - "N di N todo completati" alla fine;
 * - intestazioni di fase se le fasi sono piu' di una;
 * - gli aggiornamenti che non cambiano il todo attivo non producono righe;
 * - reset pulito quando la lista viene ricreata (op 'init' o nuovo elenco).
 */

import type { AgentToolResult, TodoItem, TodoPhase, TodoStatus } from './wire';

export type TodoTraceItem =
	| {
			type: 'creation';
			id: string;
			total: number;
			completed: number;
			phases: TodoPhase[];
	  }
	| {
			type: 'phase_header';
			id: string;
			phaseIndex: number;
			phaseName: string;
			taskCount: number;
	  }
	| {
			type: 'step';
			id: string;
			phaseIndex: number;
			phaseName?: string;
			taskIndex: number; // 0-based nella fase
			globalIndex: number; // 1-based per visualizzazione: "2/5"
			total: number;
			title: string;
			status: TodoStatus;
			blocker?: string;
	  }
	| {
			type: 'completion';
			id: string;
			total: number;
			completed: number;
	  };

export interface TodoCallInput {
	args?: Record<string, unknown> | null;
	result?: AgentToolResult | Record<string, unknown> | null;
	phases?: TodoPhase[];
	op?: string;
}

export interface ExtractedPhases {
	phases: TodoPhase[];
	op: string;
}

/**
 * Estrae l'elenco normalizzato delle fasi e dei task da una chiamata di tool o snapshot.
 */
export function extractPhasesFromCall(call: TodoCallInput): ExtractedPhases {
	if (call.phases && Array.isArray(call.phases)) {
		return { phases: call.phases, op: call.op ?? 'todo' };
	}

	const rawResult = call.result;
	const details =
		rawResult && typeof rawResult === 'object' && 'details' in rawResult
			? (rawResult.details as Record<string, unknown>)
			: (rawResult as Record<string, unknown> | undefined);

	const args = call.args ?? {};
	const op =
		typeof details?.op === 'string'
			? details.op
			: typeof args.op === 'string'
				? args.op
				: 'todo';

	const rawPhases = (
		Array.isArray(details?.phases)
			? details.phases
			: Array.isArray(args.list)
				? args.list
				: []
	) as Record<string, unknown>[];

	const phases: TodoPhase[] = [];
	for (let pIdx = 0; pIdx < rawPhases.length; pIdx++) {
		const p = rawPhases[pIdx];
		const phaseName = typeof p.name === 'string' ? p.name : `Fase ${pIdx + 1}`;
		const rawTasks = (Array.isArray(p.tasks) ? p.tasks : []) as Record<string, unknown>[];
		const tasks: TodoItem[] = [];

		for (let tIdx = 0; tIdx < rawTasks.length; tIdx++) {
			const t = rawTasks[tIdx];
			const content =
				typeof t.content === 'string'
					? t.content
					: typeof t.text === 'string'
						? t.text
						: '';
			const rawStatus = (typeof t.status === 'string' ? t.status : 'pending') as TodoStatus;
			const blocker = typeof t.blocker === 'string' ? t.blocker : undefined;

			tasks.push({
				id: typeof t.id === 'string' ? t.id : `task-${pIdx}-${tIdx}`,
				content,
				status: rawStatus,
				blocker
			});
		}

		phases.push({
			id: typeof p.id === 'string' ? p.id : `phase-${pIdx}`,
			name: phaseName,
			tasks
		});
	}

	return { phases, op };
}

interface ActiveTaskInfo {
	phaseIndex: number;
	phaseName: string;
	taskIndex: number;
	globalIndex: number; // 1-based
	item: TodoItem;
}

function findActiveTask(phases: TodoPhase[]): ActiveTaskInfo | null {
	let globalIndex = 0;

	// Prima cerca il primo task in esecuzione
	for (let pIdx = 0; pIdx < phases.length; pIdx++) {
		const phase = phases[pIdx];
		const tasks = phase.tasks ?? [];
		for (let tIdx = 0; tIdx < tasks.length; tIdx++) {
			globalIndex++;
			const task = tasks[tIdx];
			if (task.status === 'in_progress') {
				return {
					phaseIndex: pIdx,
					phaseName: phase.name,
					taskIndex: tIdx,
					globalIndex,
					item: task
				};
			}
		}
	}

	// Se nessuno e' in esecuzione, cerca il primo bloccato
	globalIndex = 0;
	for (let pIdx = 0; pIdx < phases.length; pIdx++) {
		const phase = phases[pIdx];
		const tasks = phase.tasks ?? [];
		for (let tIdx = 0; tIdx < tasks.length; tIdx++) {
			globalIndex++;
			const task = tasks[tIdx];
			if (task.status === 'blocked') {
				return {
					phaseIndex: pIdx,
					phaseName: phase.name,
					taskIndex: tIdx,
					globalIndex,
					item: task
				};
			}
		}
	}

	return null;
}

function countTasks(phases: TodoPhase[]): { total: number; completed: number; allFinished: boolean } {
	let total = 0;
	let completed = 0;
	let allFinished = true;

	for (const p of phases) {
		for (const t of p.tasks ?? []) {
			total++;
			if (t.status === 'completed') {
				completed++;
			} else if (t.status !== 'abandoned') {
				allFinished = false;
			}
		}
	}

	return { total, completed, allFinished: total > 0 && allFinished };
}

function areListsDisjoint(prev: TodoPhase[], next: TodoPhase[]): boolean {
	const prevContents = new Set(
		prev.flatMap((p) => p.tasks ?? []).map((t) => `${t.id ?? ''}:${t.content}`)
	);
	if (prevContents.size === 0) return true;
	const matches = next
		.flatMap((p) => p.tasks ?? [])
		.filter((t) => prevContents.has(`${t.id ?? ''}:${t.content}`));
	return matches.length === 0;
}

/**
 * Tracker a stato delle tracce todo. Riceve chiamate consecutive e produce
 * solo i nuovi elementi secondo le regole del piano.
 */
export class TodoTraceTracker {
	private hasCreated = false;
	private lastPhases: TodoPhase[] = [];
	private lastActiveKey: string | null = null;
	private lastActiveStatus: TodoStatus | null = null;
	private lastPhaseIndexEmitted: number | null = null;
	private allCompletedEmitted = false;
	private itemCounter = 0;

	private nextId(prefix: string): string {
		return `${prefix}-${++this.itemCounter}`;
	}

	/**
	 * Elabora una chiamata todo e restituisce le nuove tracce generate (se presenti).
	 */
	process(call: TodoCallInput): TodoTraceItem[] {
		const { phases, op } = extractPhasesFromCall(call);
		const items: TodoTraceItem[] = [];

		if (phases.length === 0) {
			return items;
		}

		const { total, completed, allFinished } = countTasks(phases);
		if (total === 0) {
			return items;
		}

		// Rilevamento ricreazione lista:
		// 1. op esplicita 'init'
		// 2. prima chiamata mai vista
		// 3. lista precedentemente conclusa e ora ricompare con task non completati
		// 4. task completamente disgiunti dalla lista precedente
		const isRecreation =
			!this.hasCreated ||
			op === 'init' ||
			(this.allCompletedEmitted && !allFinished) ||
			(this.lastPhases.length > 0 && areListsDisjoint(this.lastPhases, phases));

		if (isRecreation) {
			this.hasCreated = true;
			this.allCompletedEmitted = false;
			this.lastActiveKey = null;
			this.lastActiveStatus = null;
			this.lastPhaseIndexEmitted = null;
			this.lastPhases = phases;

			items.push({
				type: 'creation',
				id: this.nextId('todo-creation'),
				total,
				completed,
				phases
			});

			const initialActive = findActiveTask(phases);
			if (initialActive) {
				// Se ci sono piu' fasi, emette l'intestazione della prima fase attiva
				if (phases.length > 1) {
					items.push({
						type: 'phase_header',
						id: this.nextId('phase-hdr'),
						phaseIndex: initialActive.phaseIndex,
						phaseName: initialActive.phaseName,
						taskCount: (phases[initialActive.phaseIndex].tasks ?? []).length
					});
					this.lastPhaseIndexEmitted = initialActive.phaseIndex;
				}

				items.push({
					type: 'step',
					id: this.nextId('step'),
					phaseIndex: initialActive.phaseIndex,
					phaseName: phases.length > 1 ? initialActive.phaseName : undefined,
					taskIndex: initialActive.taskIndex,
					globalIndex: initialActive.globalIndex,
					total,
					title: initialActive.item.content,
					status: initialActive.item.status,
					blocker: initialActive.item.blocker
				});

				this.lastActiveKey = `${initialActive.phaseIndex}:${initialActive.taskIndex}:${initialActive.item.content}`;
				this.lastActiveStatus = initialActive.item.status;
			}

			// Se la lista nasce gia' interamente completata
			if (allFinished) {
				items.push({
					type: 'completion',
					id: this.nextId('todo-completion'),
					total,
					completed
				});
				this.allCompletedEmitted = true;
			}

			return items;
		}

		this.lastPhases = phases;
		const currentActive = findActiveTask(phases);

		if (currentActive) {
			const activeKey = `${currentActive.phaseIndex}:${currentActive.taskIndex}:${currentActive.item.content}`;
			const activeChanged =
				this.lastActiveKey !== activeKey || this.lastActiveStatus !== currentActive.item.status;

			if (activeChanged) {
				// Cambio di fase se ci sono piu' fasi e la fase e' cambiata
				if (
					phases.length > 1 &&
					(this.lastPhaseIndexEmitted === null ||
						this.lastPhaseIndexEmitted !== currentActive.phaseIndex)
				) {
					items.push({
						type: 'phase_header',
						id: this.nextId('phase-hdr'),
						phaseIndex: currentActive.phaseIndex,
						phaseName: currentActive.phaseName,
						taskCount: (phases[currentActive.phaseIndex].tasks ?? []).length
					});
					this.lastPhaseIndexEmitted = currentActive.phaseIndex;
				}

				items.push({
					type: 'step',
					id: this.nextId('step'),
					phaseIndex: currentActive.phaseIndex,
					phaseName: phases.length > 1 ? currentActive.phaseName : undefined,
					taskIndex: currentActive.taskIndex,
					globalIndex: currentActive.globalIndex,
					total,
					title: currentActive.item.content,
					status: currentActive.item.status,
					blocker: currentActive.item.blocker
				});

				this.lastActiveKey = activeKey;
				this.lastActiveStatus = currentActive.item.status;
			}
		} else if (allFinished && !this.allCompletedEmitted) {
			items.push({
				type: 'completion',
				id: this.nextId('todo-completion'),
				total,
				completed
			});
			this.allCompletedEmitted = true;
			this.lastActiveKey = null;
			this.lastActiveStatus = null;
		}

		return items;
	}

	reset(): void {
		this.hasCreated = false;
		this.lastPhases = [];
		this.lastActiveKey = null;
		this.lastActiveStatus = null;
		this.lastPhaseIndexEmitted = null;
		this.allCompletedEmitted = false;
	}
}

/**
 * Funzione pura: data una sequenza completa di chiamate todo, calcola l'elenco
 * ordinato di tracce nel flusso.
 */
export function deriveTodoTraces(calls: TodoCallInput[]): TodoTraceItem[] {
	const tracker = new TodoTraceTracker();
	const out: TodoTraceItem[] = [];
	for (const call of calls) {
		const emitted = tracker.process(call);
		out.push(...emitted);
	}
	return out;
}
