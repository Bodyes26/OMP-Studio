/**
 * Gestione degli allegati nel composer remoto (Gate R44, C23).
 *
 * Supporta:
 * - Immagini: preparazione tramite shared `#lib/agent/images.ts` con anteprima immediata
 *   e staging sull'host remoto per non superare il tetto dei frame WebSocket (512 KiB).
 * - File generici e video: staging sul filesystem reale dell'host (%LOCALAPPDATA%/sh.omp.studio/attachments)
 *   tramite `stage_attachment` a chunk di max 192 KiB.
 */

import type { RemoteCommand } from '../../../src/protocol.ts';
import { isImageFile, prepareImage } from '#lib/agent/images.ts';
import { base64ToBlob } from '#lib/agent/chatDrop.ts';

/** Limite massimo per singolo allegato: 50 MiB. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Tetto per singola immagine base64 inline. */
export const MAX_IMAGE_BASE64_LENGTH = 320_000;

/** Budget massimo aggregato di immagini inline in un singolo frame WebSocket (400 KiB). */
export const MAX_AGGREGATE_INLINE_IMAGE_BYTES = 400_000;

/** Dimensione massima di ogni chunk binario per lo staging: 192 KiB (~256 KiB in base64). */
const CHUNK_SIZE_BYTES = 192 * 1024;

export interface RemoteAttachmentTransport {
	sendCommand: (hostId: string, command: RemoteCommand) => Promise<unknown>;
}

export interface RemoteComposerAttachment {
	id: string;
	kind: 'image' | 'video' | 'file';
	name: string;
	size: number;
	url?: string;
	mimeType?: string;
	base64?: string;
	stagedPath?: string;
	tokens: number;
	status: 'ready' | 'staging' | 'error';
	error?: string;
}

export function isVideoFile(file: File): boolean {
	return file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(file.name);
}

/**
 * Converte un file in chunk base64 e li trasmette all'host via `stage_attachment`.
 */
export async function stageFileToHost(
	file: File,
	hostId: string,
	projectId: string,
	laneId: string | null,
	transport: RemoteAttachmentTransport
): Promise<{ path: string; name: string; size: number }> {
	if (file.size > MAX_ATTACHMENT_BYTES) {
		throw new Error(
			`Il file "${file.name}" supera il limite di ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MiB`
		);
	}

	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	const stageId = `stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const totalChunks = Math.max(1, Math.ceil(bytes.length / CHUNK_SIZE_BYTES));

	let lastResult: { path: string; name: string; size: number } = {
		path: '',
		name: file.name,
		size: bytes.length
	};

	for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
		const start = chunkIdx * CHUNK_SIZE_BYTES;
		const end = Math.min(start + CHUNK_SIZE_BYTES, bytes.length);
		const slice = bytes.subarray(start, end);

		let binary = '';
		for (let i = 0; i < slice.length; i++) {
			binary += String.fromCharCode(slice[i]);
		}
		const base64Chunk = btoa(binary);

		const result = (await transport.sendCommand(hostId, {
			kind: 'stage_attachment',
			projectId,
			laneId,
			fileName: file.name,
			data: base64Chunk,
			chunkIndex: chunkIdx,
			totalChunks,
			stageId
		})) as { path: string; name: string; size: number };

		if (result && result.path) {
			lastResult = result;
		}
	}

	if (!lastResult.path) {
		throw new Error('Nessun percorso restituito dallo staging sul filesystem dell\'host');
	}

	return lastResult;
}

export function createRemoteAttachmentManager(options: {
	getHostId: () => string;
	getProjectId: () => string;
	getLaneId: () => string | null;
	getConnection: () => RemoteAttachmentTransport | null | undefined;
	onNotice?: (type: 'error' | 'warning' | 'info', message: string) => void;
}) {
	let attachments = $state<RemoteComposerAttachment[]>([]);
	let isStaging = $state(false);

	async function addFiles(files: FileList | File[]): Promise<void> {
		const fileList = Array.from(files);
		if (fileList.length === 0) return;

		for (const file of fileList) {
			if (isImageFile(file)) {
				const prep = await prepareImage(file, MAX_IMAGE_BASE64_LENGTH);
				if ('data' in prep) {
					const attId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
					const dataUrl = `data:${prep.mimeType};base64,${prep.data}`;
					attachments.push({
						id: attId,
						kind: 'image',
						name: file.name,
						size: file.size,
						url: dataUrl,
						mimeType: prep.mimeType,
						base64: prep.data,
						tokens: 1600,
						status: 'staging'
					});

					// Effettua lo staging anche per l'immagine (permette invio leggero se frame saturo)
					const transport = options.getConnection();
					const hostId = options.getHostId();
					const projectId = options.getProjectId();
					const laneId = options.getLaneId();

					if (!transport) {
						const item = attachments.find((a) => a.id === attId);
						if (item) {
							// Se offline ma l'immagine e' compressa inline, puo' essere considerata ready inline
							item.status = 'ready';
						}
						continue;
					}

					isStaging = true;
					const preparedFile = new File(
						[base64ToBlob(prep.data, prep.mimeType)],
						`${file.name.replace(/\.[^.]+$/, '')}.${prep.mimeType === 'image/png' ? 'png' : 'jpg'}`,
						{ type: prep.mimeType }
					);
					stageFileToHost(preparedFile, hostId, projectId, laneId, transport)
						.then((staged) => {
							const item = attachments.find((a) => a.id === attId);
							if (item) {
								item.stagedPath = staged.path;
								item.status = 'ready';
							}
						})
						.catch((err) => {
							// Se lo staging fallisce ma il base64 inline e' valido, resta usable inline
							const item = attachments.find((a) => a.id === attId);
							if (item) {
								item.status = 'ready';
							}
						})
						.finally(() => {
							isStaging = attachments.some((a) => a.status === 'staging');
						});
				} else {
					options.onNotice?.('warning', prep.error);
				}
			} else {
				const isVideo = isVideoFile(file);
				if (file.size > MAX_ATTACHMENT_BYTES) {
					options.onNotice?.(
						'warning',
						`"${file.name}" supera il limite di ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MiB`
					);
					continue;
				}

				const attId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
				const objUrl = isVideo ? URL.createObjectURL(file) : undefined;
				attachments.push({
					id: attId,
					kind: isVideo ? 'video' : 'file',
					name: file.name,
					size: file.size,
					url: objUrl,
					tokens: isVideo ? 9000 : Math.min(40000, Math.round(file.size / 4)),
					status: 'staging'
				});

				const transport = options.getConnection();
				if (!transport) {
					const item = attachments.find((a) => a.id === attId);
					if (item) {
						item.status = 'error';
						item.error = 'Nessuna connessione attiva verso l\'host';
					}
					options.onNotice?.('error', 'Nessuna connessione attiva verso l\'host');
					continue;
				}

				isStaging = true;
				const hostId = options.getHostId();
				const projectId = options.getProjectId();
				const laneId = options.getLaneId();

				stageFileToHost(file, hostId, projectId, laneId, transport)
					.then((staged) => {
						const item = attachments.find((a) => a.id === attId);
						if (item) {
							item.stagedPath = staged.path;
							item.status = 'ready';
						}
					})
					.catch((err) => {
						const item = attachments.find((a) => a.id === attId);
						if (item) {
							item.status = 'error';
							item.error = err instanceof Error ? err.message : String(err);
						}
						options.onNotice?.(
							'error',
							`Impossibile salvare l'allegato "${file.name}": ${item?.error ?? err}`
						);
					})
					.finally(() => {
						isStaging = attachments.some((a) => a.status === 'staging');
					});
			}
		}
	}

	function removeAttachment(id: string): void {
		const target = attachments.find((a) => a.id === id);
		if (target?.url && target.url.startsWith('blob:')) {
			URL.revokeObjectURL(target.url);
		}
		attachments = attachments.filter((a) => a.id !== id);
		isStaging = attachments.some((a) => a.status === 'staging');
	}

	function clear(): void {
		for (const a of attachments) {
			if (a.url && a.url.startsWith('blob:')) {
				URL.revokeObjectURL(a.url);
			}
		}
		attachments = [];
		isStaging = false;
	}

	return {
		get attachments() {
			return attachments;
		},
		get isStaging() {
			return isStaging;
		},
		get hasAttachments() {
			return attachments.length > 0;
		},
		addFiles,
		removeAttachment,
		clear
	};
}
