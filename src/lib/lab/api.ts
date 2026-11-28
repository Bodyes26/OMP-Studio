// Accesso ai comandi Rust del Laboratorio. Un solo punto tipizzato, cosi' i
// nomi dei comandi e la forma degli argomenti non si ripetono nei componenti.
// `projectPath: null` indica l'indice globale delle bozze.
//
// Il contenuto del prototipo vive sulla macchina che possiede il progetto
// (R-MI-06): i comandi che leggono o scrivono il workspace passano dal
// `ProjectBackend` della superficie, quindi su un progetto remoto girano
// sull'host con il suo percorso (S3-link-front-05). La pubblicazione resta
// invece su questa macchina: il server di anteprima serve l'iframe di questa
// finestra, e un URL loopback dell'host non sarebbe raggiungibile.

import { invoke, LOCAL_MACHINE, type BackendCommand, type InvokeArgs } from '#lib/backend/ipc.ts';
import { createProjectBackend, type ProjectBackend } from '#lib/backend/projectScope.ts';
import { m } from '#lib/paraglide/messages.js';
import type {
	LabFile,
	LabIndexEntry,
	LabIndexPatch,
	LabMeta,
	LabPaths,
	LabPreviewStatus,
	LabRevision,
	LabServedFile
} from './types';

export interface LabApi {
	readonly machine: string;
	readonly backend: ProjectBackend;
	paths: () => Promise<LabPaths>;
	createPrototype: (projectPath: string | null, title?: string | null) => Promise<LabIndexEntry>;
	listIndex: (projectPath: string | null) => Promise<LabIndexEntry[]>;
	updateIndex: (projectPath: string | null, id: string, patch: LabIndexPatch) => Promise<LabIndexEntry>;
	removeFromIndex: (projectPath: string | null, id: string, deleteWorkspace: boolean) => Promise<void>;
	associate: (id: string, targetProjectPath: string) => Promise<LabIndexEntry>;
	duplicate: (projectPath: string | null, id: string) => Promise<LabIndexEntry>;
	commit: (workspacePath: string, message: string) => Promise<LabRevision | null>;
	log: (workspacePath: string, limit?: number) => Promise<LabRevision[]>;
	filesAt: (workspacePath: string, sha: string) => Promise<LabFile[]>;
	restore: (workspacePath: string, sha: string) => Promise<LabRevision>;
	snapshot: (workspacePath: string) => Promise<LabFile[]>;
	workspaceExists: (workspacePath: string) => Promise<boolean>;
	readMeta: (workspacePath: string) => Promise<LabMeta | null>;
	writePreviewStatus: (workspacePath: string, status: LabPreviewStatus) => Promise<void>;
	watchStart: (workspacePath: string, key: string) => Promise<void>;
	watchStop: (key: string) => Promise<void>;
	exportTo: (workspacePath: string, destination: string) => Promise<void>;
	publishShared: (files: LabServedFile[]) => Promise<void>;
	publish: (key: string, files: LabServedFile[]) => Promise<{ url: string }>;
	unpublish: (key: string) => Promise<void>;
}

/** I comandi del contenuto: gli unici che devono girare dove vive il progetto. */
function contentCalls(run: <T>(command: BackendCommand, args?: InvokeArgs) => Promise<T>) {
	return {
		paths: () => run<LabPaths>('lab_paths'),

		/**
		 * Crea workspace dal template, git interno con commit iniziale e voce d'indice.
		 * Titolo predefinito e testo della pagina vuota arrivano nella lingua
		 * dell'interfaccia: il template Rust non conosce la lingua scelta.
		 */
		createPrototype: (projectPath: string | null, title: string | null = null) =>
			run<LabIndexEntry>('lab_prototype_create', {
				projectPath,
				title: title ?? m.lanestrip_new_prototype(),
				emptyHint: m.lab_template_empty_hint()
			}),

		listIndex: (projectPath: string | null) =>
			run<LabIndexEntry[]>('lab_index_list', { projectPath }),

		updateIndex: (projectPath: string | null, id: string, patch: LabIndexPatch) =>
			run<LabIndexEntry>('lab_index_update', { projectPath, id, patch }),

		removeFromIndex: (projectPath: string | null, id: string, deleteWorkspace: boolean) =>
			run<void>('lab_index_remove', { projectPath, id, deleteWorkspace }),

		/** Sposta una bozza nell'indice di un progetto; il workspace resta dov'e'. */
		associate: (id: string, targetProjectPath: string) =>
			run<LabIndexEntry>('lab_prototype_associate', { id, targetProjectPath }),

		duplicate: (projectPath: string | null, id: string) =>
			run<LabIndexEntry>('lab_prototype_duplicate', { projectPath, id }),

		/** `null` se non c'era nulla da committare. */
		commit: (workspacePath: string, message: string) =>
			run<LabRevision | null>('lab_git_commit', { workspacePath, message }),

		log: (workspacePath: string, limit = 100) =>
			run<LabRevision[]>('lab_git_log', { workspacePath, limit }),

		filesAt: (workspacePath: string, sha: string) =>
			run<LabFile[]>('lab_git_files_at', { workspacePath, sha }),

		/** Riporta i file alla revisione `sha` e registra un nuovo commit di ripristino. */
		restore: (workspacePath: string, sha: string) =>
			run<LabRevision>('lab_git_restore', { workspacePath, sha }),

		snapshot: (workspacePath: string) => run<LabFile[]>('lab_workspace_snapshot', { workspacePath }),

		workspaceExists: (workspacePath: string) =>
			run<boolean>('lab_workspace_exists', { workspacePath }),

		readMeta: (workspacePath: string) => run<LabMeta | null>('lab_meta_read', { workspacePath }),

		writePreviewStatus: (workspacePath: string, status: LabPreviewStatus) =>
			run<void>('lab_preview_status_write', { workspacePath, status }),

		watchStart: (workspacePath: string, key: string) =>
			run<void>('lab_watch_start', { workspacePath, key }),

		watchStop: (key: string) => run<void>('lab_watch_stop', { key }),

		/** La destinazione non deve esistere o deve essere una cartella vuota. */
		exportTo: (workspacePath: string, destination: string) =>
			run<void>('lab_export', { workspacePath, destination })
	};
}

/** Pubblicazione sul server di anteprima di questa macchina: mai remota. */
const publishCalls = {
	/** Asset condivisi (vendor React, runtime Tailwind) serviti sotto `/_vendor/`. */
	publishShared: (files: LabServedFile[]) =>
		invoke<void>('lab_preview_publish_shared', { files }, { machine: LOCAL_MACHINE }),

	/** Pubblica (sostituendo) i file di un'anteprima; `key` e' l'id prototipo o `id@sha`. */
	publish: (key: string, files: LabServedFile[]) =>
		invoke<{ url: string }>('lab_preview_publish', { key, files }, { machine: LOCAL_MACHINE }),

	unpublish: (key: string) =>
		invoke<void>('lab_preview_unpublish', { key }, { machine: LOCAL_MACHINE })
};

/** Il Laboratorio di una superficie: contenuto sulla macchina che possiede il progetto. */
export function createLabApi(backend: ProjectBackend): LabApi {
	return {
		machine: backend.machine,
		backend,
		...contentCalls((command, args) => backend.invoke(command, args)),
		...publishCalls
	};
}

/** Laboratorio di questa macchina: bozze libere, barra e ciclo di vita delle corsie. */
export const labApi: LabApi = createLabApi(createProjectBackend(LOCAL_MACHINE));

/**
 * Comandi del Laboratorio per un progetto (S3-link-front-05): su una copia di
 * un'altra macchina l'indice e il workspace vivono la'. `project` assente o
 * senza macchina (bozze libere) resta questa.
 */
export function labApiFor(project: { machineId?: string | null } | null | undefined): LabApi {
	return project?.machineId ? createLabApi(createProjectBackend(project.machineId)) : labApi;
}
