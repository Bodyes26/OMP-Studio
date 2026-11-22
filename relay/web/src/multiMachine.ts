/**
 * Un elenco solo con i progetti di tutte le macchine abbinate (R-REM-17…R-REM-23).
 *
 * Le regole sono pure perche' le usano pagina iniziale, espansione, coda,
 * storico, Nuovo lavoro e chat: devono dare la stessa risposta ovunque.
 * Ogni macchina pubblica la chiave della propria copia (`RemoteProject.identity`,
 * R-MI-12): due copie con la stessa chiave non nulla sono lo stesso progetto.
 * Senza chiave la copia resta un progetto a se', com'e' per gli host vecchi.
 */

import type {
	Feature,
	HostState,
	HostSummary,
	RemoteLane,
	RemoteProject,
	RemoteQuota,
	RemoteTask
} from '../../src/protocol.ts';
import {
	getLaneStatus,
	getProjectPriority,
	type ProjectStatus
} from './projectHelpers.ts';

/** Una copia di un progetto su una macchina del relay. */
export interface ProjectCopy {
	hostId: string;
	hostName: string;
	/** Il relay ha la macchina collegata adesso. */
	online: boolean;
	/** Id della macchina nel collegamento fra computer (`HostState.linkMachineId`). */
	linkMachineId: string | null;
	project: RemoteProject;
}

/** Le copie dello stesso progetto su macchine diverse, una riga sola. */
export interface ProjectGroup {
	/** Chiave stabile: `identity` o la coppia host/progetto per le copie senza chiave. */
	key: string;
	identity: string | null;
	name: string;
	copies: ProjectCopy[];
	/** La copia che rappresenta la riga: prima quella in attesa, poi l'ultima usata. */
	primary: ProjectCopy;
	status: ProjectStatus;
	lastUsedAt: number | null;
	isShared: boolean;
	/** Almeno una copia e' raggiungibile adesso. */
	reachable: boolean;
}

/** Un ramo di una copia, con la macchina che lo possiede. */
export interface LaneEntry {
	copy: ProjectCopy;
	lane: RemoteLane;
	status: ProjectStatus;
}

/** Un lavoro della coda unica (R-REM-19). */
export interface TaskEntry {
	task: RemoteTask;
	/** La copia che ha pubblicato la voce piu' recente. */
	copy: ProjectCopy;
}

/** Una macchina proponibile per un lavoro nuovo (R-REM-20). */
export interface MachineOption {
	/** Id nel collegamento fra computer; per gli host vecchi e' l'hostId del relay. */
	id: string;
	name: string;
	online: boolean;
	lastUsedAt: number | null;
	/** La copia da usare quando si sceglie questa macchina. */
	copy: ProjectCopy;
}

function lastUsed(copy: ProjectCopy): number {
	const value = copy.project.lastUsedAt;
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Copie di tutti i progetti pubblicati, anche quelle di macchine spente (ultimo stato noto). */
export function collectCopies(
	hosts: readonly HostSummary[],
	hostStates: Record<string, { state: HostState }>
): ProjectCopy[] {
	const copies: ProjectCopy[] = [];
	for (const host of hosts) {
		const snapshot = hostStates[host.id];
		if (!snapshot?.state?.projects) continue;
		const linkMachineId = snapshot.state.linkMachineId ?? null;
		for (const project of snapshot.state.projects) {
			copies.push({
				hostId: host.id,
				hostName: host.name,
				online: host.online,
				linkMachineId,
				project
			});
		}
	}
	return copies;
}

/**
 * Unisce le copie con la stessa `identity` non nulla (R-REM-17) e ordina i
 * gruppi come l'elenco di Studio (R-REM-02): prima le richieste, poi il
 * lavoro, poi i fermi; dentro un gruppo l'ordine di pubblicazione della
 * prima copia incontrata.
 */
export function groupProjects(
	hosts: readonly HostSummary[],
	hostStates: Record<string, { state: HostState }>
): ProjectGroup[] {
	const order: string[] = [];
	const buckets = new Map<string, ProjectCopy[]>();

	for (const copy of collectCopies(hosts, hostStates)) {
		const identity = copy.project.identity ?? null;
		const key = identity ? `id:${identity}` : `h:${copy.hostId}:${copy.project.id}`;
		const bucket = buckets.get(key);
		if (bucket) {
			bucket.push(copy);
		} else {
			buckets.set(key, [copy]);
			order.push(key);
		}
	}

	const groups = order.map((key) => {
		const copies = buckets.get(key)!;
		// Ordine stabile prima dell'uso: la macchina che pubblica per prima.
		copies.sort((a, b) => lastUsed(b) - lastUsed(a));
		const identity = copies[0]!.project.identity ?? null;
		const primary = pickOpenCopyOf(copies);
		const status = copies.reduce<ProjectStatus>((worst, copy) => {
			const current = getProjectStatusOf(copy);
			return getProjectPriorityOf(current) < getProjectPriorityOf(worst) ? current : worst;
		}, 'idle');
		return {
			key,
			identity,
			name: primary.project.name,
			copies,
			primary,
			status,
			lastUsedAt: primary.project.lastUsedAt ?? null,
			isShared: copies.length > 1,
			reachable: copies.some((copy) => copy.online)
		} satisfies ProjectGroup;
	});

	return groups
		.map((group, index) => ({ group, index, priority: getProjectPriorityOf(group.status) }))
		.sort((a, b) => a.priority - b.priority || a.index - b.index)
		.map((item) => item.group);
}

/**
 * Il gruppo che contiene una specifica copia: la si cerca per host e id
 * locale, perche' due macchine possono numerare i progetti in modo diverso.
 */
export function groupForProject(
	hosts: readonly HostSummary[],
	hostStates: Record<string, { state: HostState }>,
	hostId: string,
	projectId: string
): ProjectGroup | null {
	for (const group of groupProjects(hosts, hostStates)) {
		if (group.copies.some((copy) => copy.hostId === hostId && copy.project.id === projectId)) {
			return group;
		}
	}
	return null;
}

/** Stato di una copia: richiesta, lavoro o ferma. */
export function getProjectStatusOf(copy: ProjectCopy): ProjectStatus {
	const own = getProjectPriority(copy.project);
	if (own === 0) return 'question';
	if (own === 1) return 'working';
	return 'idle';
}

function getProjectPriorityOf(status: ProjectStatus): number {
	if (status === 'question') return 0;
	if (status === 'working') return 1;
	return 2;
}

/**
 * La copia da aprire toccando la riga (R-REM-18): prima chi aspetta una
 * risposta, poi l'ultima usata. Una copia spenta non puo' aprire la chat, per
 * cui si preferisce una copia in attesa raggiungibile; se sono tutte spente
 * vale l'ordine puro, cosi' la riga resta quella del lavoro da riprendere.
 */
function pickOpenCopyOf(copies: readonly ProjectCopy[]): ProjectCopy {
	const ranked = [...copies].sort((a, b) => lastUsed(b) - lastUsed(a));
	return (
		ranked.find((copy) => copy.online && getProjectStatusOf(copy) === 'question') ??
		ranked.find((copy) => copy.online) ??
		ranked.find((copy) => getProjectStatusOf(copy) === 'question') ??
		ranked[0]!
	);
}

/** La copia che la riga rappresenta (R-REM-18): prima chi aspetta, poi l'ultima usata. */
export function pickOpenCopy(group: ProjectGroup): ProjectCopy {
	return pickOpenCopyOf(group.copies);
}

/** Rami di tutte le copie, ognuno con la macchina che lo possiede. */
export function mergedLanes(group: ProjectGroup): LaneEntry[] {
	const entries: LaneEntry[] = [];
	for (const copy of group.copies) {
		for (const lane of copy.project.lanes) {
			entries.push({ copy, lane, status: getLaneStatus(copy.project, lane) });
		}
	}
	return entries;
}

/** Copie con una richiesta in attesa: se una e' in linea, le spente non contano. */
function waitingCopies(group: ProjectGroup): ProjectCopy[] {
	const waiting = group.copies.filter((copy) => getProjectStatusOf(copy) === 'question');
	const reachable = waiting.filter((copy) => copy.online);
	return reachable.length > 0 ? reachable : waiting;
}

/**
 * Rami che aspettano una risposta su tutte le copie: contano insieme
 * (R-REM-18). Piu' di uno significa espansione, non apertura automatica.
 */
export function waitingLanes(group: ProjectGroup): LaneEntry[] {
	const entries: LaneEntry[] = [];
	for (const copy of waitingCopies(group)) {
		for (const lane of copy.project.lanes) {
			if (getLaneStatus(copy.project, lane) === 'question') entries.push({ copy, lane, status: 'question' });
		}
	}
	return entries;
}

export type GroupOpenTarget =
	| { action: 'chat'; hostId: string; projectId: string; laneId: string }
	| { action: 'expand' };

/**
 * Cosa fare al tocco della riga (R-REM-03 applicato all'insieme delle copie):
 * una sola richiesta apre la chat di quel ramo e di quella macchina; un solo
 * ramo con coda vuota apre la sua chat; altrimenti si espande.
 */
export function decideGroupOpenTarget(group: ProjectGroup): GroupOpenTarget {
	// Una copia spenta non ha una chat da aprire: al massimo si espande e si
	// legge il suo ultimo stato (R-REM-22).
	const waiting = waitingLanes(group).filter((entry) => entry.copy.online);
	if (waiting.length === 1) {
		const entry = waiting[0]!;
		return {
			action: 'chat',
			hostId: entry.copy.hostId,
			projectId: entry.copy.project.id,
			laneId: entry.lane.id
		};
	}

	// Due richieste su due copie si mostrano entrambe: aprire l'una
	// nasconderebbe l'altra (R-REM-18). La coda e' quella unica, gia' dedotta.
	const totalLanes = group.copies.reduce((sum, copy) => sum + copy.project.lanes.length, 0);
	const totalQueue = mergedTasks(group).length;
	if (totalLanes === 1 && totalQueue === 0) {
		const copy = group.copies.find((candidate) => candidate.project.lanes.length === 1);
		if (copy) {
			return {
				action: 'chat',
				hostId: copy.hostId,
				projectId: copy.project.id,
				laneId: copy.project.lanes[0]!.id
			};
		}
	}
	return { action: 'expand' };
}

/**
 * Coda unica (R-REM-19): ogni lavoro una volta sola, vince la voce con
 * `updatedAt` piu' recente. La copia che la pubblica dice anche dove andare
 * a modificarla.
 */
export function mergedTasks(group: ProjectGroup): TaskEntry[] {
	const byId = new Map<string, TaskEntry>();
	const order: string[] = [];
	for (const copy of group.copies) {
		for (const task of copy.project.tasks ?? []) {
			if (task.status !== 'queued') continue;
			const existing = byId.get(task.id);
			if (!existing) {
				byId.set(task.id, { task, copy });
				order.push(task.id);
				continue;
			}
			const existingAt = existing.task.updatedAt ?? 0;
			const candidateAt = task.updatedAt ?? 0;
			if (candidateAt > existingAt) byId.set(task.id, { task, copy });
		}
	}
	return order.map((id) => byId.get(id)!).filter(Boolean);
}

/** La macchina del lavoro: `undefined` quando il lavoro segue l'auto-avvio. */
export function taskMachine(group: ProjectGroup, task: RemoteTask): MachineOption | undefined {
	if (!task.machineId) return undefined;
	return machineOptions(group).find((option) => option.id === task.machineId);
}

/**
 * Macchine su cui il progetto esiste, una voce per macchina (R-REM-20).
 * L'id e' quello del collegamento fra computer; gli host vecchi, che non lo
 * pubblicano, restano distinguibili per hostId del relay.
 */
export function machineOptions(group: ProjectGroup): MachineOption[] {
	const seen = new Map<string, MachineOption>();
	for (const copy of group.copies) {
		const id = copy.linkMachineId ?? copy.hostId;
		const existing = seen.get(id);
		if (!existing) {
			seen.set(id, {
				id,
				name: copy.hostName,
				online: copy.online,
				lastUsedAt: copy.project.lastUsedAt ?? null,
				copy
			});
			continue;
		}
		// Una macchina con piu' copie dello stesso progetto vale una volta sola.
		if (lastUsed(copy) > lastUsed(existing.copy)) {
			seen.set(id, {
				id,
				name: copy.hostName,
				online: copy.online || existing.online,
				lastUsedAt: copy.project.lastUsedAt ?? null,
				copy
			});
		} else if (copy.online) {
			existing.online = true;
		}
	}
	return [...seen.values()].sort(
		(a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.name.localeCompare(b.name)
	);
}

/**
 * Macchina proposta per un lavoro nuovo (R-MI-13, F18): l'ultima usata,
 * preferendo una raggiungibile perche' una macchina spenta non puo' partire.
 */
export function proposedMachine(group: ProjectGroup): MachineOption | null {
	const options = machineOptions(group);
	if (options.length === 0) return null;
	const ranked = [...options].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
	return ranked.find((option) => option.online) ?? ranked[0]!;
}

/** La copia di una macchina scelta, se quella macchina ha il progetto. */
export function copyForMachine(group: ProjectGroup, machineId: string | null): ProjectCopy | undefined {
	if (!machineId) return undefined;
	const option = machineOptions(group).find((candidate) => candidate.id === machineId);
	return option?.copy;
}

/**
 * Dove mandare «Avvia» (R-REM-19): la macchina del lavoro; senza macchina
 * quella con l'auto-avvio acceso; altrimenti l'ultima usata.
 */
export function runTaskCopy(group: ProjectGroup, task: RemoteTask): ProjectCopy {
	const machine = taskMachine(group, task);
	if (machine) return machine.copy;
	const auto = group.copies.find((copy) => copy.project.autoDispatch && copy.online);
	if (auto) return auto;
	const autoAny = group.copies.find((copy) => copy.project.autoDispatch);
	if (autoAny) return autoAny;
	// Ultima usata (F18), anche spenta: il requisito chiede quella, e l'errore
	// «macchina offline» dice all'utente cosa fare invece di partire altrove.
	const ranked = [...group.copies].sort((a, b) => lastUsed(b) - lastUsed(a));
	return ranked[0]!;
}

/**
 * Dove mandare modifica, spostamento o eliminazione (R-REM-19): una copia
 * raggiungibile, preferendo la macchina del lavoro; la replica della coda
 * porta la modifica alle altre. Solo se nessuna e' in linea si sceglie la
 * macchina del lavoro comunque, cosi' l'errore e' esplicito.
 */
export function editTaskCopy(group: ProjectGroup, task: RemoteTask, fallback?: ProjectCopy): ProjectCopy {
	const ranked = [...group.copies].sort((a, b) => lastUsed(b) - lastUsed(a));
	const machine = taskMachine(group, task);
	if (machine) {
		const online = group.copies.find(
			(copy) => copy.online && (copy.linkMachineId ?? copy.hostId) === machine.id
		);
		if (online) return online;
	}
	const reachable = ranked.find((copy) => copy.online);
	if (reachable) return reachable;
	if (machine) return machine.copy;
	return fallback ?? ranked[0]!;
}

/**
 * Copia su cui creare un lavoro per una macchina scelta (R-REM-20, R-REM-22).
 * Se la macchina scelta e' spenta ma un'altra copia e' raggiungibile, il
 * lavoro nasce li' con `machineId` della macchina spenta: la replica della
 * coda lo portera' a destinazione quando quella torna.
 */
export function createTaskCopy(group: ProjectGroup, machineId: string | null): ProjectCopy {
	const chosen = copyForMachine(group, machineId);
	if (chosen?.online) return chosen;
	if (chosen) {
		const reachable = [...group.copies]
			.sort((a, b) => lastUsed(b) - lastUsed(a))
			.find((copy) => copy.online);
		return reachable ?? chosen;
	}
	return pickOpenCopy(group);
}

export interface DeferredEntry {
	hostId: string;
	hostName: string;
	commandId: string;
	projectId: string;
	prompt: string;
	createdAt: number;
}

/** Lavori che aspettano il ritorno di una macchina spenta (R-REM-22). */
export function deferredEntries(hosts: readonly HostSummary[]): DeferredEntry[] {
	const out: DeferredEntry[] = [];
	for (const host of hosts) {
		for (const entry of host.deferred ?? []) {
			out.push({
				hostId: host.id,
				hostName: host.name,
				commandId: entry.commandId,
				projectId: entry.projectId,
				prompt: entry.prompt,
				createdAt: entry.createdAt
			});
		}
	}
	return out;
}

/** Lavori in attesa che riguardano un progetto (per id di una delle copie). */
export function deferredForGroup(group: ProjectGroup, hosts: readonly HostSummary[]): DeferredEntry[] {
	const projectIds = new Set(group.copies.map((copy) => copy.project.id));
	const hostIds = new Set(group.copies.map((copy) => copy.hostId));
	return deferredEntries(hosts).filter(
		(entry) => hostIds.has(entry.hostId) && projectIds.has(entry.projectId)
	);
}

export type MachineMark = 'use' | 'on' | 'off';

export interface GlyphSpec {
	kind: 'remote' | 'offline' | 'copies';
	copies?: MachineMark[];
}

/** Glifo della riga: una macchina, l'altra o tutte e due (R-MI-19). */
export function groupGlyph(group: ProjectGroup): GlyphSpec {
	if (group.copies.length <= 1) {
		const copy = group.copies[0];
		return { kind: copy && !copy.online ? 'offline' : 'remote' };
	}
	const primary = pickOpenCopy(group);
	const ordered = [...group.copies].sort((a, b) => lastUsed(b) - lastUsed(a));
	return {
		kind: 'copies',
		copies: ordered.map((copy) => {
			if (!copy.online) return 'off';
			return copy === primary ? 'use' : 'on';
		})
	};
}

/** Copie raggiungibili: storico e quote le interrogano una per una (R-REM-21, R-REM-23). */
export function reachableCopies(group: ProjectGroup): ProjectCopy[] {
	return group.copies.filter((copy) => copy.online);
}

/** Una macchina nel foglio delle quote (R-REM-23): provider e account suoi. */
export interface QuotaSection {
	hostId: string;
	hostName: string;
	online: boolean;
	features: Feature[];
	quota: RemoteQuota | null;
	projects: readonly RemoteProject[];
}

/** Le macchine di cui il foglio quote mostra una sezione, in ordine di elenco. */
export function quotaSections(
	hosts: readonly HostSummary[],
	hostStates: Record<string, { state: HostState }>
): QuotaSection[] {
	const sections: QuotaSection[] = [];
	for (const host of hosts) {
		const state = hostStates[host.id]?.state;
		if (!state) continue;
		sections.push({
			hostId: host.id,
			hostName: host.name,
			online: host.online,
			features: host.features,
			quota: state.quota,
			projects: state.projects
		});
	}
	return sections;
}
