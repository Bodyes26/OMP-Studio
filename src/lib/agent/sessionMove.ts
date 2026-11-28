/**
 * Cambiare macchina da una chat (R-MI-14, R-MI-62, R-MI-63).
 *
 * Tre esiti, decisi da `decideSwitch` (puro, provato):
 * - chat vuota: si passa subito alla copia gemella, senza domande e senza
 *   spostare la conversazione (D3: prima una chat vuota passava dallo
 *   spostamento completo e si fermava su «Le copie non sono sullo stesso
 *   commit» solo perche' la partenza era indietro);
 * - chat ferma: si sposta come in R-MI-14, ma prima Studio allinea da solo i
 *   commit delle due copie (fast-forward e, se divergono senza conflitto,
 *   l'unione di R-MI-61) e si ferma soltanto davanti a un conflitto vero;
 * - agente al lavoro o domanda in attesa: lo spostamento si prenota sotto il
 *   composer e parte da se' a turno finito, con «Annulla».
 *
 * Le modifiche non committate seguono il cambio senza chiedere (R-MI-63): un
 * avviso con «Annulla» le riporta indietro con lo stesso procedimento.
 */

import { ask, message } from '@tauri-apps/plugin-dialog';
import { invoke, LOCAL_MACHINE } from '#lib/backend/ipc.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { laneSessionKey, sessionRegistry } from '#lib/agent/sessionRegistry.ts';
import { getDirtyEditorPaths } from '#lib/editor/editorActivity.svelte.ts';
import { studioLog } from '#lib/diagnostics/studioLog.ts';
import { m } from '#lib/paraglide/messages.js';
import { busyPaths, type CopySyncReport } from '#lib/stores/copySync.svelte.ts';
import {
	finishChanges,
	machineTrueId,
	MoveNotFinishedError,
	moveChangesBetween,
	receiveChanges,
	snapshotChanges,
	type WipMove
} from '#lib/stores/copyMove.ts';
import { laneStore, type LaneRecord } from '#lib/stores/lanes.svelte.ts';
import { modelSettingsStore } from '#lib/stores/modelSettings.svelte.ts';
import { machineName } from '#lib/stores/projectMachines.svelte.ts';
import { projectStore, type Project } from '#lib/stores/projects.svelte.ts';
import { samePathLoose } from '#lib/stores/remoteQueue.ts';
import { laneOrchestrator } from '#lib/lanes/laneOrchestrator.svelte.ts';
import { MAIN_LANE_ID, type LaneId, type ProjectId } from '#lib/types/lanes.ts';
import {
	alignUntilSettled,
	alignVerdict,
	decideSwitch,
	isBlocked,
	type AlignVerdict,
	type SettledVerdict,
	type CopyOccupation,
	type SwitchBlocked
} from './machineSwitch.ts';
import type { AgentSession } from './session.svelte';

export interface SessionMoveResume {
	sessionId: string;
	lane: LaneId;
	model: string | null;
}

/**
 * Esito del cambio macchina. `pending` (uno spostamento gia' in corso) e
 * `deferred` dicono al chiamante di non attivare la copia di arrivo: ci
 * pensa lo spostamento quando arriva.
 */
export type SwitchResult = 'instant' | 'moved' | 'deferred' | 'pending' | 'blocked' | 'cancelled';

/**
 * Spostamenti in corso, per corsia (S3-17): un secondo clic non ne avvia un
 * altro. La chiave e' la corsia e non il `sessionId`, che cambia a meta'
 * allineamento (riapertura, import) e lasciava passare un secondo
 * trasferimento sulla stessa cartella.
 */
const running = new Set<string>();

// ---------------------------------------------------------------------------
// Avvisi sotto il composer: spostamento prenotato e modifiche portate.
//
// Vivono fuori dalle rune perche' li scrive il flusso del cambio macchina e li
// legge il composer di una corsia qualsiasi: un registro con ascoltatori, come
// `sessionRegistry`, evita stato reattivo in un modulo `.ts`.
// ---------------------------------------------------------------------------

export interface MachineSwitchNotice {
	id: number;
	kind: 'deferred' | 'moved' | 'moved-back';
	/** Macchina di destinazione (per `moved`, quella della partenza). */
	machine: string;
	/** Modifiche portate: zero quando non ce n'erano. */
	count: number;
}

interface MovedPayload {
	fromMachine: string | undefined;
	fromPath: string;
	toMachine: string | undefined;
	toPath: string;
}

interface DeferredSwitch {
	cancelled: boolean;
	/** Sessione che ha prenotato lo spostamento: se la corsia ne adotta un'altra, non parte. */
	sessionId: string;
}

/** La corsia che la copia di arrivo mostrera' davvero (puo' essere cambiata). */
function arrivalLaneKey(to: Project, laneId?: string): string {
	const live = projectStore.projects.find((copy) => copy.id === to.id);
	return laneSessionKey(to.id, laneId ?? live?.lane.laneId ?? to.lane.laneId);
}

const notices = new Map<string, MachineSwitchNotice>();
const pendingSwitches = new Map<string, DeferredSwitch>();
const movedPayloads = new Map<number, MovedPayload>();
const noticeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let noticeSeq = 0;

/** Il composer di una corsia si iscrive e rilegge `machineSwitchNotice`. */
export function subscribeMachineSwitch(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function machineSwitchNotice(sessionKey: string): MachineSwitchNotice | null {
	return notices.get(sessionKey) ?? null;
}

function setNotice(sessionKey: string, notice: MachineSwitchNotice): void {
	notices.set(sessionKey, notice);
	// Ogni avviso scade da solo: uno «prenotato» che resta sotto il composer
	// dopo che lo spostamento e' partito mostra un «Annulla» che non fa piu'
	// nulla, e un «Portate N modifiche» fuori tempo confonde (S3-19).
	const existing = noticeTimers.get(sessionKey);
	if (existing !== undefined) clearTimeout(existing);
	noticeTimers.set(sessionKey, setTimeout(() => {
		noticeTimers.delete(sessionKey);
		clearNotice(sessionKey, notice.id);
	}, notice.kind === 'moved-back' ? 5_000 : NOTICE_TTL_MS));
	for (const listener of listeners) listener();
}

function clearNotice(sessionKey: string, id?: number): void {
	const current = notices.get(sessionKey);
	if (!current || (id !== undefined && current.id !== id)) return;
	notices.delete(sessionKey);
	// Il payload dell'«Annulla» vive quanto l'avviso: scaduto quello, non c'e'
	// piu' niente da riportare indietro.
	movedPayloads.delete(current.id);
	const timer = noticeTimers.get(sessionKey);
	if (timer !== undefined) {
		clearTimeout(timer);
		noticeTimers.delete(sessionKey);
	}
	for (const listener of listeners) listener();
}

/** «Annulla» sullo spostamento prenotato (R-MI-62): non parte piu'. */
export function cancelMachineSwitch(sessionKey: string): void {
	const deferred = pendingSwitches.get(sessionKey);
	if (deferred) {
		deferred.cancelled = true;
		pendingSwitches.delete(sessionKey);
	}
	clearNotice(sessionKey);
}

// ---------------------------------------------------------------------------
// Chi occupa davvero una cartella (D1, D2).
// ---------------------------------------------------------------------------

/**
 * Una copia e' occupata solo se un agente ci sta lavorando o aspetta una
 * risposta in quella cartella, se l'editor ha li' file non salvati: la sola
 * presenza di una sessione remota non conta (D1), e i file sporchi di un
 * altro progetto nemmeno (D2, R-MI-57).
 */
function folderState(copy: Project, folder: string): CopyOccupation {
	let working: string | null = null;
	let question: string | null = null;
	const unsaved: string[] = [];
	// I file non salvati li conosce solo la finestra che li ha aperti.
	if ((copy.machineId ?? LOCAL_MACHINE) === LOCAL_MACHINE) {
		for (const dirty of getDirtyEditorPaths()) {
			if (samePathLoose(dirty, folder)) unsaved.push(dirty);
		}
	}
	const lanes: Array<AgentLaneLike> = [copy.lane, ...laneStore.lanesFor(copy.id)];
	for (const lane of lanes) {
		if (lane.status === 'archived' || lane.status === 'closed') continue;
		if (!lane.workspacePath || !samePathLoose(lane.workspacePath, folder)) continue;
		// `laneAgentState` conta il lavoro vero, anche quando arriva da
		// un'altra macchina; `laneBusyRemotely` conterebbe anche una surface
		// aperta e ferma, che non occupa nulla (D1).
		const state = laneOrchestrator.laneAgentState(copy, lane.laneId);
		if (state === 'working') working ??= folder;
		else if (state === 'attention') question ??= folder;
	}
	// Sessioni senza una corsia corrispondente (la principale prima che il
	// registro delle corsie la conosca).
	for (const session of sessionRegistry.getSessionsForProject(copy.id)) {
		if (!samePathLoose(session.cwd, folder)) continue;
		if (session.pendingUi) question ??= folder;
		else if (session.isStreaming || session.agentState === 'working') working ??= folder;
	}
	return { machine: machineName(copy.machineId), working, question, unsaved };
}

type AgentLaneLike = Project['lane'] | LaneRecord;

/** Questa chat non ha ancora nulla da spostare: nessuna voce di conversazione. */
function isEmptyChat(session: AgentSession | undefined): boolean {
	if (!session || !session.sessionId) return true;
	return !session.entries.some((entry) => entry.kind === 'user' || entry.kind === 'assistant' || entry.kind === 'tool');
}

/** Una corsia viaggia come branch nuova: sulla destinazione non c'e' lavoro da rispettare. */
function isLaneMove(from: Project): boolean {
	return from.lane.laneId !== MAIN_LANE_ID && Boolean(from.lane.branch);
}

function decision(from: Project, to: Project, session: AgentSession) {
	return decideSwitch({
		empty: false,
		// `settle.running`: il turno e' finito ma un job in background lavora
		// ancora, e a meta' lavoro non si sposta nulla.
		working: session.isStreaming || session.agentState === 'working' || session.settle.running,
		question: Boolean(session.pendingUi),
		from: folderState(from, session.cwd),
		// Una corsia arriva come branch nuova: la' non c'e' lavoro da rispettare.
		to: isLaneMove(from)
			? { machine: machineName(to.machineId), working: null, question: null, unsaved: [] }
			: folderState(to, to.canonicalProjectPath ?? ''),
		conflict: null
	});
}

/**
 * Cosa impedisce davvero il cambio verso `to`: `null` se si puo' fare adesso o
 * prenotare a fine turno. E' la stessa regola dell'indicatore sotto il
 * composer e del flusso vero, cosi' i due non divergono.
 */
export function switchBlock(from: Project, to: Project, session: AgentSession | undefined): SwitchBlocked | null {
	if (!from.canonicalProjectPath || !to.canonicalProjectPath || from.lane.kind === 'lab') return null;
	if (!session || isEmptyChat(session)) return null;
	const result = decision(from, to, session);
	return isBlocked(result) ? result : null;
}

/** Il messaggio di un blocco: dice cosa impedisce il cambio e dove. */
export function switchBlockText(block: SwitchBlocked): string {
	const files = block.files.join(', ');
	switch (block.blocked) {
		case 'agent': return m.session_switch_blocked_agent({ machine: block.machine, folder: files });
		case 'question': return m.session_switch_blocked_question({ machine: block.machine, folder: files });
		case 'unsaved': return m.session_switch_blocked_unsaved({ machine: block.machine, files });
		case 'conflict': return m.session_switch_blocked_conflict({ machine: block.machine, files });
	}
}

// ---------------------------------------------------------------------------
// Allineamento delle copie (R-MI-61, R-MI-62).
// ---------------------------------------------------------------------------

function localBusy(copy: Project): string[] {
	return (copy.machineId ?? LOCAL_MACHINE) === LOCAL_MACHINE ? busyPaths(copy) : [];
}

async function headOf(projectPath: string, machine: string): Promise<string | null> {
	return (await invoke<{ hash: string } | null>('git_last_commit', { projectPath }, { machine }))?.hash ?? null;
}

/** Tentativi quando la stessa cartella ha gia' un giro in corso. */
const GUARD_RETRIES = 10;
const GUARD_WAIT_MS = 500;

/**
 * `copy_sync` sulla copia di `machine`. Il giro periodico della finestra puo'
 * tenere la stessa cartella proprio in quel momento (`sync already running`,
 * guardia del backend): non e' un disallineamento, si aspetta che finisca.
 */
async function syncCopy(machine: string, args: Record<string, unknown>): Promise<CopySyncReport> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await invoke<CopySyncReport>('copy_sync', args, { machine });
		} catch (error) {
			if (attempt >= GUARD_RETRIES || !String(error).includes('sync already running')) throw error;
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, GUARD_WAIT_MS);
			await promise;
		}
	}
}

/**
 * Porta le due copie sullo stesso commit, ognuna tirando dall'altra, e guarda
 * il risultato. Se una parte ha unito da sola (R-MI-61) fa un giro in piu',
 * perche' l'altra e' rimasta indietro di quel commit. Non si aspetta mai
 * l'unione altrui: chi e' libero unisce.
 */
async function alignCopies(from: Project, to: Project, fromPath: string, toPath: string): Promise<SettledVerdict> {
	const source = from.machineId ?? LOCAL_MACHINE;
	const destination = to.machineId ?? LOCAL_MACHINE;
	const round = async (): Promise<AlignVerdict> => {
		const toReport = await syncCopy(destination, {
			projectPath: toPath, machine: machineTrueId(source), peerPath: fromPath, busyPaths: localBusy(to)
		});
		const fromReport = await syncCopy(source, {
			projectPath: fromPath, machine: machineTrueId(destination), peerPath: toPath, busyPaths: localBusy(from)
		});
		return alignVerdict({
			from: { machine: machineName(source), head: await headOf(fromPath, source), branches: fromReport.branches },
			to: { machine: machineName(destination), head: await headOf(toPath, destination), branches: toReport.branches },
			merged: toReport.branches.some((branch) => branch.state === 'merged')
				|| fromReport.branches.some((branch) => branch.state === 'merged')
		});
	};
	// Un'unione appena fatta (R-MI-61) lascia l'altra copia indietro di quel
	// commit: il contratto prevede un giro in piu', non un'attesa infinita.
	return alignUntilSettled(round);
}

/** Traduce l'esito dell'allineamento in un messaggio; `null` se si puo' procedere. */
function alignBlockedText(verdict: SettledVerdict): string | null {
	if (verdict === 'aligned') return null;
	if (verdict.blocked === 'conflict') return m.session_switch_blocked_conflict({ machine: verdict.machine, files: verdict.files.join(', ') });
	if (verdict.blocked === 'pending') return m.session_switch_blocked_pending({ machine: verdict.machine, detail: verdict.detail });
	return m.session_move_commit();
}

// ---------------------------------------------------------------------------
// Spostamento.
// ---------------------------------------------------------------------------

const IDLE_POLL_MS = 800;

/**
 * Aspetta che il turno finisca davvero: lo streaming (con l'attesa che la
 * sessione gia' offre) e poi l'eventuale domanda rimasta aperta, che non ha
 * un turno da attendere e va ricontrollata a intervalli.
 */
async function waitForTurnEnd(session: AgentSession, cancelled: () => boolean): Promise<boolean> {
	while (!cancelled()) {
		if (!session.isStreaming && !session.pendingUi && !session.isCompacting && !session.settle.running) return true;
		if (session.isStreaming) {
			await session.waitForIdle(60_000);
			continue;
		}
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, IDLE_POLL_MS);
		await promise;
	}
	return false;
}

/** Tutti gli avvisi sotto il composer scadono: uno prenotato che resta li'
 *  dopo che lo spostamento e' partito mostra un «Annulla» che non fa piu'
 *  nulla (S3-19). La scadenza si cancella con `clearNotice`. */
const NOTICE_TTL_MS = 30_000;

function notifyMoved(sessionKey: string, count: number, payload: MovedPayload): void {
	// «Portate N modifiche da M» (R-MI-63). Senza modifiche non c'e' nulla da
	// annullare e nessun avviso da mostrare.
	if (count === 0) return;
	const id = ++noticeSeq;
	movedPayloads.set(id, payload);
	setNotice(sessionKey, { id, kind: 'moved', machine: machineName(payload.fromMachine), count });
}

/** «Annulla» sull'avviso: le modifiche tornano sulla copia di partenza (R-MI-63). */
export async function undoMovedChanges(sessionKey: string, id: number): Promise<void> {
	const payload = movedPayloads.get(id);
	if (!payload) return;
	movedPayloads.delete(id);
	// Cartelle occupate della copia di partenza, se e' questa macchina: le
	// conosce solo la finestra che la possiede.
	const back = projectStore.projects.find((candidate) => samePathLoose(candidate.canonicalProjectPath, payload.fromPath));
	try {
		await moveChangesBetween({
			fromPath: payload.toPath, toPath: payload.fromPath,
			fromMachine: payload.toMachine, toMachine: payload.fromMachine,
			busyPaths: back ? localBusy(back) : []
		});
		setNotice(sessionKey, { id, kind: 'moved-back', machine: machineName(payload.fromMachine), count: 0 });
	} catch (error) {
		clearNotice(sessionKey, id);
		await message(m.copies_move_failed({ from: machineName(payload.fromMachine), error: String(error) }), {
			title: m.copies_move_title(), kind: 'error'
		});
	}
}

/**
 * Le modifiche seguono il cambio (R-MI-63): niente domanda, l'arrivo riceve
 * prima i commit e poi l'istantanea, la partenza si pulisce solo dopo. Per una
 * corsia (`sync` falso) la branch dell'arrivo è già sul commit giusto.
 */
async function carryChanges(
	from: Project, to: Project, fromPath: string, toPath: string, commit: string, sync = true
): Promise<number> {
	const transfer: WipMove = {
		fromPath, toPath,
		fromMachine: from.machineId, toMachine: to.machineId,
		busyPaths: localBusy(to)
	};
	const snapshot = await snapshotChanges(transfer, commit);
	if (!snapshot) return 0;
	await receiveChanges(transfer, snapshot, sync);
	await finishChanges(transfer, snapshot);
	return snapshot.files;
}

async function perform(
	from: Project,
	to: Project,
	session: AgentSession,
	resume: (result: SessionMoveResume) => Promise<void>
): Promise<SwitchResult> {
	const sessionId = session.sessionId;
	const rpcId = session.client.id;
	if (!sessionId) return 'blocked';
	// La protezione e' per corsia, non per sessione (S3-17).
	const laneKey = laneSessionKey(from.id, from.lane.laneId);
	if (running.has(laneKey)) return 'pending';
	running.add(laneKey);
	const title = m.session_move_title({ machine: machineName(to.machineId) });
	try {
		const source = from.machineId ?? LOCAL_MACHINE;
		const destination = to.machineId ?? LOCAL_MACHINE;
		const sourcePath = session.cwd;
		let targetPath: string = to.canonicalProjectPath ?? '';
		const laneMove = isLaneMove(from);
		// F29: il modello della sessione esiste la'? Si dice prima di spostare.
		const requestedModel = session.model ? `${session.model.provider}/${session.model.id}` : '';
		await modelSettingsStore.ensureMachineModels(destination);
		const config = modelSettingsStore.configFor(destination);
		if (!config) {
			await message(m.lane_machine_unavailable({ machine: machineName(destination) }), { title, kind: 'info' });
			return 'blocked';
		}
		const missing = Boolean(requestedModel && !modelSettingsStore.knownSelectorsFor(destination).has(requestedModel));
		const model = missing ? config.modelRoles.default ?? null : null;
		if (missing && !model) {
			await message(m.session_move_no_model({ model: requestedModel }), { title, kind: 'info' });
			return 'blocked';
		}
		// R-MI-62: si allinea prima di chiedere, cosi' davanti a un conflitto
		// arriva il nome dei file invece di una conferma inutile.
		if (!laneMove) {
			const blocked = alignBlockedText(await alignCopies(from, to, sourcePath, targetPath));
			if (blocked) {
				await message(blocked, { title, kind: 'info' });
				return 'blocked';
			}
		}
		const before = decision(from, to, session);
		if (isBlocked(before)) {
			await message(switchBlockText(before), { title, kind: 'info' });
			return 'blocked';
		}
		// R-MI-14 / F29: cosa viaggia e cosa resta. Le modifiche non si chiedono
		// piu': seguono il cambio da sole (R-MI-63).
		const explanation = m.session_move_description()
			+ (missing ? '\n\n' + m.session_move_model({ model: requestedModel, fallback: model ?? '' }) : '');
		if (!await ask(explanation, { title, okLabel: title, cancelLabel: m.common_cancel() })) return 'cancelled';
		// Fra la domanda e la risposta l'agente puo' essere ripartito.
		const after = decision(from, to, session);
		if (isBlocked(after)) {
			await message(switchBlockText(after), { title, kind: 'info' });
			return 'blocked';
		}
		const commit = await headOf(sourcePath, source);
		if (!commit) throw new Error(m.session_move_commit());
		let targetLane = MAIN_LANE_ID as LaneId;
		if (laneMove) {
			const branch = await invoke<string>('copy_receive_lane_branch', {
				projectPath: targetPath, peerPath: from.canonicalProjectPath, machine: machineTrueId(source),
				branch: from.lane.branch, commit, session: sessionId
			}, { machine: destination });
			const existing = laneStore.lanesFor(to.id as ProjectId)
				.find((lane) => lane.branch === branch && lane.status !== 'archived' && lane.status !== 'closed');
			const lane = existing ?? await laneOrchestrator.openBranchLane(to, { branch, kind: 'local', surface: 'gui', activate: false });
			if (!lane.workspacePath) throw new Error(m.session_move_commit());
			targetLane = lane.laneId;
			targetPath = lane.workspacePath;
		}
		// R-MI-63: le modifiche seguono senza domande; l'istantanea deve partire
		// dal commit che l'arrivo ricevera'. Se il trasferimento non riesce ci si
		// ferma qui: la partenza ha ancora le sue modifiche e spostare la chat
		// le lascerebbe indietro.
		let carried = 0;
		try {
			carried = await carryChanges(from, to, sourcePath, targetPath, commit, !laneMove);
		} catch (error) {
			// Arrivate ma non ripulite alla partenza: il lavoro e' gia'
			// sull'arrivo, quindi si passa li' e si dice cosa resta da fare.
			if (!(error instanceof MoveNotFinishedError)) {
				await message(m.copies_move_failed({ from: machineName(source), error: String(error) }), {
					title: m.copies_move_title(), kind: 'warning'
				});
				return 'blocked';
			}
			await message(m.copies_move_unfinished({ from: machineName(source), to: machineName(destination), error: error.message }), { title, kind: 'warning' });
		}
		const target = { machine: machineTrueId(destination), projectPath: to.canonicalProjectPath ?? '', sourcePath, targetPath, model };
		const transcript = await invoke<string>('session_move_export', { projectPath: sourcePath, session: sessionId, rpcId, target }, { machine: source });
		await invoke('session_move_import', { projectPath: targetPath, sourcePath, session: sessionId, transcript }, { machine: destination });
		await resume({ sessionId, lane: targetLane, model });
		// L'avviso si aggancia alla corsia che la copia di arrivo mostra davvero:
		// con una corsia diversa da quella di partenza la chiave di `to.lane`
		// non e' montata e l'avviso non si vedeva (S3-19).
		notifyMoved(arrivalLaneKey(to, targetLane), carried, {
			fromMachine: from.machineId, fromPath: sourcePath,
			toMachine: to.machineId, toPath: targetPath
		});
		return 'moved';
	} catch (error) {
		await message(String(error), { title, kind: 'error' });
		return 'blocked';
	} finally {
		running.delete(laneKey);
	}
}

/** Lo spostamento si prenota e parte da solo a turno finito (R-MI-62). */
function deferSwitch(
	from: Project,
	to: Project,
	session: AgentSession,
	sessionKey: string,
	resume: (result: SessionMoveResume) => Promise<void>
): void {
	const id = ++noticeSeq;
	const deferred: DeferredSwitch = { cancelled: false, sessionId: session.sessionId ?? '' };
	pendingSwitches.set(sessionKey, deferred);
	setNotice(sessionKey, { id, kind: 'deferred', machine: machineName(to.machineId), count: 0 });
	void (async () => {
		if (!await waitForTurnEnd(session, () => deferred.cancelled)) return;
		pendingSwitches.delete(sessionKey);
		clearNotice(sessionKey, id);
		// La corsia puo' aver ripreso un'altra chat nel frattempo: spostare
		// quella nuova significherebbe portare via un lavoro che l'utente non
		// ha prenotato (S4-14).
		if (deferred.sessionId && session.sessionId !== deferred.sessionId) {
			studioLog.info('session', `spostamento prenotato annullato: la corsia ha ripreso ${session.sessionId ?? 'nessuna chat'}`);
			return;
		}
		await perform(from, to, session, resume);
	})();
}

/**
 * Chat vuota: si passa alla copia gemella senza dialoghi. Le modifiche non
 * committate seguono lo stesso (R-MI-63), ma un loro intoppo non deve
 * ricreare l'attesa che R-MI-62 toglie: si avvisa e si passa lo stesso.
 * L'avviso va sulla corsia di arrivo, che è quella che l'utente vedrà.
 */
async function instantSwitch(from: Project, to: Project, session: AgentSession | undefined): Promise<SwitchResult> {
	// La copia di questa finestra risponde sempre; una gemella spenta no.
	if (to.machineId && to.machineId !== LOCAL_MACHINE && !linkStore.machineFor(to.machineId)?.online) {
		await message(m.lane_machine_unavailable({ machine: machineName(to.machineId) }), { kind: 'info' });
		return 'blocked';
	}
	const source = from.machineId ?? LOCAL_MACHINE;
	const sourcePath = session?.cwd ?? from.canonicalProjectPath ?? '';
	const targetPath = to.canonicalProjectPath ?? '';
	if (!isLaneMove(from) && sourcePath && targetPath) {
		try {
			const commit = await headOf(sourcePath, source);
			const pending = commit
				? (await invoke<{ files: number }>('copy_wip_estimate', { projectPath: sourcePath }, { machine: source })).files
				: 0;
			// R-MI-63 eredita da R-MI-28 il vincolo sul lavoro in corso: un altro
			// agente, una domanda o file non salvati in una delle due cartelle
			// non si toccano. La chat vuota passa lo stesso, le modifiche no.
			const occupied = pending > 0 && [folderState(from, sourcePath), folderState(to, targetPath)]
				.some((state) => state.working || state.question || state.unsaved.length > 0);
			if (occupied) {
				await message(m.copies_move_busy({ from: machineName(from.machineId) }), { title: m.copies_move_title(), kind: 'info' });
			} else if (commit && pending > 0) {
				const carried = await carryChanges(from, to, sourcePath, targetPath, commit);
				// L'avviso si aggancia alla corsia che la copia di arrivo
				// attiverà: è lì che l'utente si troverà dopo il cambio.
				notifyMoved(laneSessionKey(to.id, to.lane.laneId), carried, {
					fromMachine: from.machineId, fromPath: sourcePath,
					toMachine: to.machineId, toPath: targetPath
				});
			}
		} catch (error) {
			await message(m.copies_move_failed({ from: machineName(source), error: String(error) }), {
				title: m.copies_move_title(), kind: 'warning'
			});
		}
	}
	return 'instant';
}

/**
 * Porta questa chat sulla copia `to` del progetto. Il risultato dice al
 * chiamante se attivare subito la copia (`instant`), se lo spostamento e'
 * gia' avvenuto (`moved`) o se non deve toccare nulla (`deferred`, `pending`,
 * `blocked`, `cancelled`).
 */
export async function continueSessionOn(
	from: Project,
	to: Project,
	session: AgentSession | undefined,
	resume: (result: SessionMoveResume) => Promise<void>
): Promise<SwitchResult> {
	if (!from.canonicalProjectPath || !to.canonicalProjectPath || from.lane.kind === 'lab') return 'blocked';
	const sessionKey = session?.sessionKey ?? laneSessionKey(from.id, from.lane.laneId);
	// Una richiesta esplicita prende il posto di quella prenotata: l'utente ha
	// scelto di nuovo, magari per un'altra macchina.
	cancelMachineSwitch(sessionKey);
	if (isEmptyChat(session)) return instantSwitch(from, to, session);
	// Da qui in poi la sessione c'e' e ha una conversazione: `decision` e
	// `perform` la ricevono sempre come parametro.
	const active = session!;
	const result = decision(from, to, active);
	if (result === 'defer') {
		deferSwitch(from, to, active, sessionKey, resume);
		return 'deferred';
	}
	if (isBlocked(result)) {
		await message(switchBlockText(result), { title: m.session_move_title({ machine: machineName(to.machineId) }), kind: 'info' });
		return 'blocked';
	}
	return perform(from, to, active, resume);
}
