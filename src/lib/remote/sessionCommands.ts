/**
 * Controllo della sessione da remoto (Gate R44, R5): interrompere il turno e
 * scrivere alla sessione di una corsia.
 */

import { invoke } from '@tauri-apps/api/core';
import { projectStore } from '$lib/stores/projects.svelte';
import { laneOrchestrator } from '$lib/lanes/laneOrchestrator.svelte';
import { sessionRegistry } from '$lib/agent/sessionRegistry';
import { stageAttachmentHeaders, type DroppedImage } from '$lib/agent/chatDrop';
import type { RemotePromptImage } from '$remote-protocol';
import type { ImageContent } from '$lib/agent/wire';
import { RemoteCommandFailure } from './commands';
/**
 * Interrompe il turno della corsia remota come farebbe il pulsante Stop di Studio.
 */
export async function abortRemoteLane(projectId: string, laneId: string | null): Promise<void> {
	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', `Progetto "${projectId}" non trovato`);
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;

	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure('not_found', `Corsia "${laneId}" non trovata nel progetto "${projectId}"`);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	if (surface === 'terminal') {
		throw new RemoteCommandFailure(
			'unsupported',
			"L'interruzione remota non e' disponibile per corsie su terminale."
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
		throw new RemoteCommandFailure('rejected', "Il testo del messaggio non puo' essere vuoto");
	}
	if (trimmed.length > 20_000) {
		throw new RemoteCommandFailure('rejected', 'Il testo del messaggio supera il limite di 20.000 caratteri');
	}

	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', `Progetto "${projectId}" non trovato`);
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;

	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure('not_found', `Corsia "${laneId}" non trovata nel progetto "${projectId}"`);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	if (surface === 'terminal') {
		throw new RemoteCommandFailure(
			'unsupported',
			"L'invio di messaggi non e' disponibile per corsie su terminale."
		);
	}

	// Sicurezza Lab: se e' una corsia Lab, non deve mai essere aperta senza confinamento Lab
	if (lane?.kind === 'lab' && !lane.labPrototypeId) {
		throw new RemoteCommandFailure(
			'rejected',
			"La corsia Laboratorio non ha un prototipo associato valido."
		);
	}

	let session = isMain
		? sessionRegistry.getMainSession(projectId)
		: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

	if (!session) {
		if (lane?.kind === 'lab') {
			throw new RemoteCommandFailure(
				'rejected',
				"La corsia Laboratorio deve essere aperta in Studio prima di potervi inviare messaggi."
			);
		}
		if (!lane) {
			throw new RemoteCommandFailure('not_found', `Corsia "${effectiveLaneId}" non trovata`);
		}
		session = laneOrchestrator.getOrCreateAgentSession(project, lane);
	}

	if (!session.isOpen) {
		if (lane?.kind === 'lab') {
			throw new RemoteCommandFailure(
				'rejected',
				"La sessione Laboratorio non e' aperta in Studio."
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
						`Impossibile leggere l'immagine allegata: ${err instanceof Error ? err.message : String(err)}`
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
			'Il payload complessivo delle immagini allegate supera il limite del frame fisico omp (700 KB base64).'
		);
	}

	const behavior = whileBusy === 'follow_up' ? 'followUp' : 'steer';
	const result = await session.prompt(wireText, imagesToSend, behavior);
	if (result === 'failed') {
		throw new RemoteCommandFailure('failed', 'Impossibile inviare il messaggio alla sessione');
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
		throw new RemoteCommandFailure('rejected', 'Nome file non valido');
	}
	if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 1000) {
		throw new RemoteCommandFailure('rejected', 'Numero totale di chunk non valido');
	}
	if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= totalChunks) {
		throw new RemoteCommandFailure('rejected', 'Indice del chunk non valido');
	}

	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', `Progetto "${projectId}" non trovato`);
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;
	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure('not_found', `Corsia "${laneId}" non trovata nel progetto "${projectId}"`);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	if (surface === 'terminal') {
		throw new RemoteCommandFailure(
			'unsupported',
			"Lo staging degli allegati non e' disponibile per corsie su terminale."
		);
	}

	if (lane?.kind === 'lab' && !lane.labPrototypeId) {
		throw new RemoteCommandFailure(
			'rejected',
			"La corsia Laboratorio non ha un prototipo associato valido."
		);
	}

	let session = isMain
		? sessionRegistry.getMainSession(projectId)
		: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

	if (!session) {
		if (lane?.kind === 'lab') {
			throw new RemoteCommandFailure(
				'rejected',
				"La corsia Laboratorio deve essere aperta in Studio prima dello staging."
			);
		}
		if (!lane) {
			throw new RemoteCommandFailure('not_found', `Corsia "${effectiveLaneId}" non trovata`);
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
			throw new RemoteCommandFailure('rejected', 'Identificatore di staging mancante per caricamento a blocchi');
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
			throw new RemoteCommandFailure('rejected', 'Metadati del caricamento modificati');
		}

		if (upload.chunks[chunkIndex] !== undefined) {
			throw new RemoteCommandFailure('rejected', `Chunk duplicato: indice ${chunkIndex}`);
		}

		const chunkBytes = (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
		if (upload.totalBytes + chunkBytes > 50 * 1024 * 1024) {
			pendingUploads.delete(uploadKey);
			throw new RemoteCommandFailure('rejected', 'Dimensione complessiva allegato supera il limite di 50 MiB');
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
			throw new RemoteCommandFailure('rejected', 'Dimensione allegato supera il limite di 50 MiB');
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
		throw new RemoteCommandFailure('rejected', 'Dati allegato base64 non validi');
	}

	if (bytes.length > 50 * 1024 * 1024) {
		throw new RemoteCommandFailure('rejected', 'Dimensione allegato decodificato eccede 50 MiB');
	}

	try {
		const staged = await invoke<{ path: string; name: string; size: number }>('stage_chat_attachment', bytes, {
			headers: stageAttachmentHeaders(session.sessionKey, fileName)
		});
		return staged;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new RemoteCommandFailure('failed', `Salvataggio allegato non riuscito: ${msg}`);
	}
}

export async function refreshRemoteContext(
	projectId: string,
	laneId: string | null,
	force: boolean = false
): Promise<{ success: true }> {
	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', `Progetto "${projectId}" non trovato`);
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;
	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure('not_found', `Corsia "${laneId}" non trovata nel progetto "${projectId}"`);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	if (surface === 'terminal') {
		throw new RemoteCommandFailure(
			'unsupported',
			"L'operazione sul contesto non e' disponibile per corsie su terminale."
		);
	}

	const session = isMain
		? sessionRegistry.getMainSession(projectId)
		: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

	if (!session) {
		throw new RemoteCommandFailure('not_found', `Sessione "${effectiveLaneId}" non trovata`);
	}

	if (!session.isOpen || !session.isReady || !session.isAttached) {
		throw new RemoteCommandFailure('rejected', "La sessione non e' pronta in Studio");
	}

	if (session.isContextBusy) {
		throw new RemoteCommandFailure('rejected', 'Sessione occupata: turno, interruzione o dialogo in corso');
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
		throw new RemoteCommandFailure('not_found', `Progetto "${projectId}" non trovato`);
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;
	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure('not_found', `Corsia "${laneId}" non trovata nel progetto "${projectId}"`);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	if (surface === 'terminal') {
		throw new RemoteCommandFailure(
			'unsupported',
			"La compattazione non e' disponibile per corsie su terminale."
		);
	}

	const session = isMain
		? sessionRegistry.getMainSession(projectId)
		: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

	if (!session) {
		throw new RemoteCommandFailure('not_found', `Sessione "${effectiveLaneId}" non trovata`);
	}
	if (!session.isOpen || !session.isReady || !session.isAttached) {
		throw new RemoteCommandFailure('rejected', "La sessione non e' aperta e pronta in Studio");
	}
	if (session.isContextBusy) {
		throw new RemoteCommandFailure('rejected', 'Sessione occupata: turno, interruzione o dialogo in corso');
	}
	const ok = await session.compact();
	if (!ok) {
		throw new RemoteCommandFailure('rejected', 'Compattazione non avviata: sessione gia in compattazione o non necessaria');
	}
	return { success: true };
}
