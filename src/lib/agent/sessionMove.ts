import { ask, message } from '@tauri-apps/plugin-dialog';
import { invoke, LOCAL_MACHINE } from '#lib/backend/ipc.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { m } from '#lib/paraglide/messages.js';
import { busyPaths } from '#lib/stores/copySync.svelte.ts';
import type { MoveEstimate } from '#lib/stores/copyMove.ts';
import { laneStore } from '#lib/stores/lanes.svelte.ts';
import { modelSettingsStore } from '#lib/stores/modelSettings.svelte.ts';
import { machineName } from '#lib/stores/projectMachines.svelte.ts';
import type { Project } from '#lib/stores/projects.svelte.ts';
import { laneOrchestrator } from '#lib/lanes/laneOrchestrator.svelte.ts';
import { MAIN_LANE_ID, type LaneId, type ProjectId } from '#lib/types/lanes.ts';
import type { AgentSession } from './session.svelte';

interface Resume { sessionId: string; lane: LaneId; model: string | null }
const pending = new Set<string>();

export async function continueSessionOn(from: Project, to: Project, session: AgentSession | undefined, resume: (result: Resume) => Promise<void>): Promise<boolean> {
	const sessionId = session?.sessionId;
	const rpcId = session?.client.id;
	if (!session || !sessionId || rpcId == null || !from.canonicalProjectPath || !to.canonicalProjectPath || from.lane.kind === 'lab') return false;
	if (pending.has(sessionId)) return true;
	pending.add(sessionId);
	const title = m.session_move_title({ machine: machineName(to.machineId) });
	const busy = () => session.sessionId !== sessionId || !session.isReady || session.isStreaming || session.pendingUi ||
		session.agentState === 'working' || busyPaths(from).length || busyPaths(to).length;
	try {
		if (busy()) throw new Error(m.session_move_busy());
		const source = from.machineId ?? LOCAL_MACHINE;
		const destination = to.machineId ?? LOCAL_MACHINE;
		const peer = source === LOCAL_MACHINE ? linkStore.status.machineId : source;
		const targetId = destination === LOCAL_MACHINE ? linkStore.status.machineId : destination;
		const sourcePath = session.cwd;
		let targetPath: string = to.canonicalProjectPath;
		const requestedModel = session.model ? `${session.model.provider}/${session.model.id}` : '';
		await modelSettingsStore.ensureMachineModels(destination);
		const config = modelSettingsStore.configFor(destination);
		if (!config) throw new Error(m.lane_machine_unavailable({ machine: machineName(destination) }));
		const missing = Boolean(requestedModel && !modelSettingsStore.knownSelectorsFor(destination).has(requestedModel));
		const model = missing ? config.modelRoles.default ?? null : null;
		if (missing && !model) throw new Error(m.session_move_no_model({ model: requestedModel }));
		const explanation = m.session_move_description() + (missing ? '\n\n' + m.session_move_model({ model: requestedModel, fallback: model ?? '' }) : '');
		if (!await ask(explanation, { title, okLabel: title, cancelLabel: m.common_cancel() })) return true;
		if (busy()) throw new Error(m.session_move_busy());
		const getCommit = (projectPath: string, machine: string) => invoke<{ hash: string } | null>('git_last_commit', { projectPath }, { machine });
		const commit = await getCommit(sourcePath, source);
		if (!commit) throw new Error(m.session_move_commit());
		let targetLane = MAIN_LANE_ID as LaneId;
		if (from.lane.laneId !== MAIN_LANE_ID && from.lane.branch) {
			const branch = await invoke<string>('copy_receive_lane_branch', {
				projectPath: to.canonicalProjectPath, peerPath: from.canonicalProjectPath, machine: peer,
				branch: from.lane.branch, commit: commit.hash, session: sessionId
			}, { machine: destination });
			const existing = laneStore.lanesFor(to.id as ProjectId).find((lane) => lane.branch === branch && lane.status !== 'archived' && lane.status !== 'closed');
			const lane = existing ?? await laneOrchestrator.openBranchLane(to, { branch, kind: 'local', surface: 'gui', activate: false });
			if (!lane.workspacePath) throw new Error(m.session_move_commit());
			targetLane = lane.laneId;
			targetPath = lane.workspacePath;
		} else {
			await invoke('copy_sync', { projectPath: targetPath, machine: peer, peerPath: from.canonicalProjectPath,
				busyPaths: destination === LOCAL_MACHINE ? busyPaths(to) : [] }, { machine: destination });
		}
		if ((await getCommit(targetPath, destination))?.hash !== commit.hash || (await getCommit(sourcePath, source))?.hash !== commit.hash) throw new Error(m.session_move_commit());
		if (busy()) throw new Error(m.session_move_busy());
		const sourceArgs = { projectPath: sourcePath };
		const estimate = await invoke<MoveEstimate>('copy_wip_estimate', sourceArgs, { machine: source });
		if (busy()) throw new Error(m.session_move_busy());
		let snapshot: { id: string; base: string; commit: string } | null = null;
		if (estimate.files) {
			snapshot = await invoke<{ id: string; base: string; commit: string }>('copy_wip_snapshot', sourceArgs, { machine: source });
			if (snapshot.base !== commit.hash) throw new Error(m.session_move_commit());
			await invoke('copy_wip_receive', { projectPath: targetPath, machine: peer, peerPath: sourcePath, ...snapshot }, { machine: destination });
		}
		const target = { machine: targetId, projectPath: to.canonicalProjectPath, sourcePath, targetPath, model };
		const transcript = await invoke<string>('session_move_export', { ...sourceArgs, session: sessionId, rpcId, target }, { machine: source });
		await invoke('session_move_import', { projectPath: targetPath, sourcePath, session: sessionId, transcript }, { machine: destination });
		if (snapshot) {
			try { await invoke('copy_wip_finish', { ...sourceArgs, id: snapshot.id }, { machine: source }); }
			catch (error) { await message(String(error), { title, kind: 'warning' }); }
		}
		await resume({ sessionId, lane: targetLane, model });
	} catch (error) {
		await message(String(error), { title, kind: 'error' });
	} finally {
		pending.delete(sessionId);
	}
	return true;
}
