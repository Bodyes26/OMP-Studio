/**
 * Controllo della sessione da remoto (Gate R44, R5): interrompere il turno e
 * scrivere alla sessione di una corsia.
 */

import { invoke } from '@tauri-apps/api/core';
import { projectStore } from '#lib/stores/projects.svelte.ts';
import { laneOrchestrator } from '#lib/lanes/laneOrchestrator.svelte.ts';
import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
import { stageAttachmentHeaders, type DroppedImage } from '#lib/agent/chatDrop.ts';
import type { RemotePromptImage } from '$remote-protocol';
import type { ImageContent } from '#lib/agent/wire.ts';
import { RemoteCommandFailure } from './commands';
import { m } from '#lib/paraglide/messages.js';
/**
 * Interrompe il turno della corsia remota come farebbe il pulsante Stop di Studio.
 */
export async function abortRemoteLane(projectId: string, laneId: string | null): Promise<void> {
	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', m.l10n_lab_remote_project_not_found({ project: projectId }));
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;

	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure(
			'not_found',
			m.l10n_lab_remote_lane_not_found({ lane: laneId ?? 'main', project: projectId })
		);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	if (surface === 'terminal') {
		throw new RemoteCommandFailure(
			'unsupported',
			m.l10n_lab_remote_abort_terminal_unavailable()
		);
	}

	const session = isMain
		? sessionRegistry.getMainSession(projectId)
		: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

	if (session) {
		await session.abort();
	}
}

/**
 * Invia un prompt alla sessione: a sessione ferma avvia un nuovo turno; se impegnata
 * accoda il messaggio con la modalita' scelta ('steer' o 'follow_up').
 */
export async function sendRemotePrompt(
	projectId: string,
	laneId: string | null,
	text: string,
	whileBusy: 'steer' | 'follow_up',
	images?: RemotePromptImage[],
	attachments?: Array<{ path: string; name: string }>
): Promise<void> {
	const trimmed = (text ?? '').trim();
	const hasImages = Array.isArray(images) && images.length > 0;
	const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
	if (!trimmed && !hasImages && !hasAttachments) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_prompt_text_empty());
	}
	if (trimmed.length > 20_000) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_prompt_text_too_long());
	}

	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', m.l10n_lab_remote_project_not_found({ project: projectId }));
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;

	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure(
			'not_found',
			m.l10n_lab_remote_lane_not_found({ lane: laneId ?? 'main', project: projectId })
		);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	if (surface === 'terminal') {
		throw new RemoteCommandFailure(
			'unsupported',
			m.l10n_lab_remote_send_terminal_unavailable()
		);
	}

	// Sicurezza Lab: se e' una corsia Lab, non deve mai essere aperta senza confinamento Lab
	if (lane?.kind === 'lab' && !lane.labPrototypeId) {
		throw new RemoteCommandFailure(
			'rejected',
			m.l10n_lab_remote_lab_lane_no_prototype()
		);
	}

	let session = isMain
		? sessionRegistry.getMainSession(projectId)
		: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

	if (!session) {
		if (lane?.kind === 'lab') {
			throw new RemoteCommandFailure(
				'rejected',
				m.l10n_lab_remote_lab_lane_not_open_send()
			);
		}
		if (!lane) {
			throw new RemoteCommandFailure(
				'not_found',
				m.l10n_lab_remote_lane_not_found_short({ lane: effectiveLaneId })
			);
		}
		session = laneOrchestrator.getOrCreateAgentSession(project, lane);
	}

	if (!session.isOpen) {
		if (lane?.kind === 'lab') {
			throw new RemoteCommandFailure(
				'rejected',
				m.l10n_lab_remote_lab_lane_not_open()
			);
		}
		await session.open(null);
	}

	let wireText = trimmed;
	if (hasAttachments) {
		const pathsBlock = attachments!.map((a) => `- ${a.path}`).join('\n');
		if (!wireText.includes(pathsBlock)) {
			wireText = wireText
				? `${wireText}\n\nAllegati:\n${pathsBlock}`
				: pathsBlock;
		}
	}

	const imagesToSend: ImageContent[] = [];
	if (images && images.length > 0) {
		for (const img of images) {
			if (img.data) {
				imagesToSend.push({
					type: 'image',
					data: img.data,
					mimeType: img.mimeType || 'image/jpeg'
				});
			} else if (img.path) {
				try {
					const dropped = await invoke<DroppedImage>('chat_attachment_read_image', { path: img.path });
					imagesToSend.push({
						type: 'image',
						data: dropped.base64,
						mimeType: dropped.mimeType || img.mimeType || 'image/jpeg'
					});
				} catch (err) {
					throw new RemoteCommandFailure(
						'failed',
						m.l10n_lab_remote_attachment_image_read_failed({
					error: err instanceof Error ? err.message : String(err)
				})
					);
				}
			}
		}
	}
	let totalImageBase64Length = 0;
	for (const img of imagesToSend) {
		totalImageBase64Length += (img.data ? img.data.length : 0);
	}
	if (totalImageBase64Length + wireText.length > 700_000) {
		throw new RemoteCommandFailure(
			'rejected',
			m.l10n_lab_remote_images_payload_too_large()
		);
	}

	const behavior = whileBusy === 'follow_up' ? 'followUp' : 'steer';
	const result = await session.prompt(wireText, imagesToSend, behavior);
	if (result === 'failed') {
		throw new RemoteCommandFailure('failed', m.l10n_lab_remote_send_failed());
	}
}

interface PendingStageUpload {
	chunks: string[];
	received: number;
	total: number;
	totalBytes: number;
	expiresAt: number;
	fileName: string;
}
const pendingUploads = new Map<string, PendingStageUpload>();

export async function stageRemoteAttachment(
	projectId: string,
	laneId: string | null,
	fileName: string,
	data: string,
	chunkIndex: number = 0,
	totalChunks: number = 1,
	stageId?: string
): Promise<{ path: string; name: string; size: number }> {
	if (!fileName || typeof fileName !== 'string' || !fileName.trim()) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_file_name_invalid());
	}
	if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 1000) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_chunk_total_invalid());
	}
	if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= totalChunks) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_chunk_index_invalid());
	}

	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', m.l10n_lab_remote_project_not_found({ project: projectId }));
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;
	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure(
			'not_found',
			m.l10n_lab_remote_lane_not_found({ lane: laneId ?? 'main', project: projectId })
		);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	if (surface === 'terminal') {
		throw new RemoteCommandFailure(
			'unsupported',
			m.l10n_lab_remote_staging_terminal_unavailable()
		);
	}

	if (lane?.kind === 'lab' && !lane.labPrototypeId) {
		throw new RemoteCommandFailure(
			'rejected',
			m.l10n_lab_remote_lab_lane_no_prototype()
		);
	}

	let session = isMain
		? sessionRegistry.getMainSession(projectId)
		: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

	if (!session) {
		if (lane?.kind === 'lab') {
			throw new RemoteCommandFailure(
				'rejected',
				m.l10n_lab_remote_lab_lane_not_open_staging()
			);
		}
		if (!lane) {
			throw new RemoteCommandFailure(
				'not_found',
				m.l10n_lab_remote_lane_not_found_short({ lane: effectiveLaneId })
			);
		}
		session = laneOrchestrator.getOrCreateAgentSession(project, lane);
	}

	const now = Date.now();
	for (const [id, upload] of pendingUploads) {
		if (upload.expiresAt < now) {
			pendingUploads.delete(id);
		}
	}

	const uploadKey = `${projectId}:${effectiveLaneId}:${stageId || 'direct'}`;
	let fullBase64 = data;

	if (totalChunks > 1) {
		if (!stageId) {
			throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_stage_id_missing());
		}
		let upload = pendingUploads.get(uploadKey);
		if (!upload) {
			upload = {
				chunks: new Array(totalChunks),
				received: 0,
				total: totalChunks,
				totalBytes: 0,
				fileName,
				expiresAt: now + 5 * 60 * 1000
			};
			pendingUploads.set(uploadKey, upload);
		} else {
			upload.expiresAt = now + 5 * 60 * 1000;
		}
		if (upload.total !== totalChunks || upload.fileName !== fileName) {
			pendingUploads.delete(uploadKey);
			throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_upload_metadata_changed());
		}

		if (upload.chunks[chunkIndex] !== undefined) {
			throw new RemoteCommandFailure('rejected', `Chunk duplicato: indice ${chunkIndex}`);
		}

		const chunkBytes = (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
		if (upload.totalBytes + chunkBytes > 50 * 1024 * 1024) {
			pendingUploads.delete(uploadKey);
			throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_attachment_total_too_large());
		}

		upload.chunks[chunkIndex] = data;
		upload.received += 1;
		upload.totalBytes += chunkBytes;

		if (upload.received < upload.total) {
			return { path: '', name: fileName, size: upload.totalBytes };
		}

		fullBase64 = upload.chunks.join('');
		pendingUploads.delete(uploadKey);
	} else {
		const singleBytes = (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
		if (singleBytes > 50 * 1024 * 1024) {
			throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_attachment_too_large());
		}
	}

	let bytes: Uint8Array;
	try {
		const binary = atob(fullBase64);
		bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
	} catch {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_base64_invalid());
	}

	if (bytes.length > 50 * 1024 * 1024) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_attachment_decoded_too_large());
	}

	try {
		const staged = await invoke<{ path: string; name: string; size: number }>('stage_chat_attachment', bytes, {
			headers: stageAttachmentHeaders(session.sessionKey, fileName)
		});
		return staged;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new RemoteCommandFailure('failed', m.l10n_lab_remote_attachment_save_failed({ error: msg }));
	}
}

export async function refreshRemoteContext(
	projectId: string,
	laneId: string | null,
	force: boolean = false
): Promise<{ success: true }> {
	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', m.l10n_lab_remote_project_not_found({ project: projectId }));
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;
	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure(
			'not_found',
			m.l10n_lab_remote_lane_not_found({ lane: laneId ?? 'main', project: projectId })
		);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	if (surface === 'terminal') {
		throw new RemoteCommandFailure(
			'unsupported',
			m.l10n_lab_remote_context_terminal_unavailable()
		);
	}

	const session = isMain
		? sessionRegistry.getMainSession(projectId)
		: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

	if (!session) {
		throw new RemoteCommandFailure(
				'not_found',
				m.l10n_lab_remote_session_not_found({ lane: effectiveLaneId })
			);
	}

	if (!session.isOpen || !session.isReady || !session.isAttached) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_session_not_ready());
	}

	if (session.isContextBusy) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_session_busy());
	}

	await session.refreshState();
	await session.refreshContextReport(force);
	return { success: true };
}

export async function compactRemoteContext(
	projectId: string,
	laneId: string | null
): Promise<{ success: true }> {
	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', m.l10n_lab_remote_project_not_found({ project: projectId }));
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;
	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure(
			'not_found',
			m.l10n_lab_remote_lane_not_found({ lane: laneId ?? 'main', project: projectId })
		);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	if (surface === 'terminal') {
		throw new RemoteCommandFailure(
			'unsupported',
			m.l10n_lab_remote_compaction_terminal_unavailable()
		);
	}

	const session = isMain
		? sessionRegistry.getMainSession(projectId)
		: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

	if (!session) {
		throw new RemoteCommandFailure(
				'not_found',
				m.l10n_lab_remote_session_not_found({ lane: effectiveLaneId })
			);
	}
	if (!session.isOpen || !session.isReady || !session.isAttached) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_session_not_open_ready());
	}
	if (session.isContextBusy) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_session_busy());
	}
	const ok = await session.compact();
	if (!ok) {
		throw new RemoteCommandFailure('rejected', m.l10n_lab_remote_compaction_not_started());
	}
	return { success: true };
}
