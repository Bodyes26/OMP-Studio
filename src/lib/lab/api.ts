// Accesso ai comandi Rust del Laboratorio. Un solo punto tipizzato, cosi' i
// nomi dei comandi e la forma degli argomenti non si ripetono nei componenti.
// `projectPath: null` indica l'indice globale delle bozze.

import { invoke } from '@tauri-apps/api/core';
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

export const labApi = {
	paths: () => invoke<LabPaths>('lab_paths'),

	/** Crea workspace dal template, git interno con commit iniziale e voce d'indice. */
	createPrototype: (projectPath: string | null, title: string | null = null) =>
		invoke<LabIndexEntry>('lab_prototype_create', { projectPath, title }),

	listIndex: (projectPath: string | null) =>
		invoke<LabIndexEntry[]>('lab_index_list', { projectPath }),

	updateIndex: (projectPath: string | null, id: string, patch: LabIndexPatch) =>
		invoke<LabIndexEntry>('lab_index_update', { projectPath, id, patch }),

	removeFromIndex: (projectPath: string | null, id: string, deleteWorkspace: boolean) =>
		invoke<void>('lab_index_remove', { projectPath, id, deleteWorkspace }),

	/** Sposta una bozza nell'indice di un progetto; il workspace resta dov'e'. */
	associate: (id: string, targetProjectPath: string) =>
		invoke<LabIndexEntry>('lab_prototype_associate', { id, targetProjectPath }),

	duplicate: (projectPath: string | null, id: string) =>
		invoke<LabIndexEntry>('lab_prototype_duplicate', { projectPath, id }),

	/** `null` se non c'era nulla da committare. */
	commit: (workspacePath: string, message: string) =>
		invoke<LabRevision | null>('lab_git_commit', { workspacePath, message }),

	log: (workspacePath: string, limit = 100) =>
		invoke<LabRevision[]>('lab_git_log', { workspacePath, limit }),

	filesAt: (workspacePath: string, sha: string) =>
		invoke<LabFile[]>('lab_git_files_at', { workspacePath, sha }),

	/** Riporta i file alla revisione `sha` e registra un nuovo commit di ripristino. */
	restore: (workspacePath: string, sha: string) =>
		invoke<LabRevision>('lab_git_restore', { workspacePath, sha }),

	snapshot: (workspacePath: string) => invoke<LabFile[]>('lab_workspace_snapshot', { workspacePath }),

	workspaceExists: (workspacePath: string) =>
		invoke<boolean>('lab_workspace_exists', { workspacePath }),

	readMeta: (workspacePath: string) => invoke<LabMeta | null>('lab_meta_read', { workspacePath }),

	writePreviewStatus: (workspacePath: string, status: LabPreviewStatus) =>
		invoke<void>('lab_preview_status_write', { workspacePath, status }),

	watchStart: (workspacePath: string, key: string) =>
		invoke<void>('lab_watch_start', { workspacePath, key }),

	watchStop: (key: string) => invoke<void>('lab_watch_stop', { key }),

	/** La destinazione non deve esistere o deve essere una cartella vuota. */
	exportTo: (workspacePath: string, destination: string) =>
		invoke<void>('lab_export', { workspacePath, destination }),

	/** Asset condivisi (vendor React, runtime Tailwind) serviti sotto `/_vendor/`. */
	publishShared: (files: LabServedFile[]) => invoke<void>('lab_preview_publish_shared', { files }),

	/** Pubblica (sostituendo) i file di un'anteprima; `key` e' l'id prototipo o `id@sha`. */
	publish: (key: string, files: LabServedFile[]) =>
		invoke<{ url: string }>('lab_preview_publish', { key, files }),

	unpublish: (key: string) => invoke<void>('lab_preview_unpublish', { key })
};
