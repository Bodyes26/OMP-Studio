// Store reattivo per la superficie di anteprima (diagrammi Mermaid, SVG, prototipi HTML).
// Gestisce apertura, chiusura, caricamento on-demand di contenuti grandi (get_artifact),
// cache per messageId e pubblicazione di prototipi HTML su /v1/preview.

import { getContext, setContext } from 'svelte';
import { t } from './i18n.ts';
import { connection } from './connection.svelte.ts';
import { wrapPrototypeCode } from '#lib/prototype/wrapper.ts';
import {
	API,
	PREVIEW_MAX_HTML_BYTES,
	type CommandError,
	type RemoteArtifact,
	type RemoteArtifactKind,
	type RemoteCommand
} from '../../src/protocol.ts';

export const PROTOTYPE_MAX_BYTES = PREVIEW_MAX_HTML_BYTES; // 1 MiB

interface CommandErrorLike {
	code?: string;
	message?: string;
}

function isCommandErrorLike(err: unknown): err is CommandErrorLike {
	return Boolean(err && typeof err === 'object' && ('code' in err || 'message' in err));
}

interface PublishErrorResponse {
	error?: string | { code?: string; message?: string };
}

interface PublishSuccessResponse {
	url?: string;
}

interface GetArtifactResult {
	artifact?: RemoteArtifact;
}

/** Formatta la dimensione in byte in stringa leggibile (B, KB, MB). */
export function formatArtifactBytes(bytes?: number | null): string {
	if (bytes === undefined || bytes === null || isNaN(bytes) || bytes < 0) return '';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) {
		const kb = bytes / 1024;
		return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
	}
	const mb = bytes / (1024 * 1024);
	return `${mb.toFixed(1)} MB`;
}

/** Mappa codici CommandError e fallimenti HTTP in messaggi localizzati. */
export function mapArtifactError(err: unknown): string {
	if (!err) return t('previewError');
	if (typeof err === 'string') return err;
	if (isCommandErrorLike(err)) {
		if (err.code === 'rejected') return t('previewErrorRejected');
		if (err.code === 'not_found') return t('previewErrorNotFound');
		if (err.code === 'host_offline') return t('chatMachineOffline');
		if (err.code === 'timeout') return t('previewErrorFetch');
		if (err.message && err.message !== err.code) return err.message;
	}
	return t('previewError');
}

/**
 * Avvolge il codice del prototipo con wrapPrototypeCode e lo pubblica su /v1/preview.
 * Restituisce l'URL relativo isolato (/p/<id>/) da montare nell'iframe sandbox="allow-scripts".
 */
export async function publishPrototype(code: string, title = 'Prototype'): Promise<string> {
	const wrapped = wrapPrototypeCode(title, code);
	const bytes = new TextEncoder().encode(wrapped).length;
	if (bytes > PREVIEW_MAX_HTML_BYTES) {
		throw new Error(t('previewErrorQuota'));
	}

	let res: Response;
	try {
		res = await fetch(API.preview, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ html: wrapped })
		});
	} catch {
		throw new Error(t('previewErrorPublish'));
	}

	if (!res.ok) {
		if (res.status === 413) {
			throw new Error(t('previewErrorQuota'));
		}
		let errorMsg: string | undefined;
		try {
			const body: unknown = await res.json();
			if (body && typeof body === 'object' && 'error' in body) {
				const errPayload = (body as PublishErrorResponse).error;
				if (typeof errPayload === 'string') {
					errorMsg = errPayload;
				} else if (errPayload && typeof errPayload === 'object' && 'message' in errPayload) {
					errorMsg = errPayload.message;
				}
			}
		} catch {
			// Errore non-JSON
		}
		throw new Error(errorMsg || t('previewErrorPublish'));
	}

	const body: unknown = await res.json();
	if (body && typeof body === 'object' && 'url' in body) {
		const successPayload = body as PublishSuccessResponse;
		if (typeof successPayload.url === 'string' && successPayload.url.length > 0) {
			return successPayload.url;
		}
	}
	throw new Error(t('previewErrorPublish'));
}

export interface ActiveArtifact {
	kind: RemoteArtifactKind;
	title: string;
	bytes: number;
	content: string | null;
	messageId?: string;
}

export interface OpenArtifactOptions {
	kind: RemoteArtifactKind;
	title: string;
	content?: string | null;
	bytes?: number;
	messageId?: string;
	hostId?: string;
	projectId?: string;
	laneId?: string | null;
	isHistory?: boolean;
}

export class PreviewStore {
	isOpen = $state(false);
	isLoading = $state(false);
	error = $state<string | null>(null);
	showSource = $state(false);
	deviceMode = $state<'fit' | 'phone' | 'tablet'>('fit');
	current = $state<ActiveArtifact | null>(null);
	previewUrl = $state<string | null>(null);

	hostId = $state('');
	projectId = $state('');
	laneId = $state<string | null>(null);
	isHistory = $state(false);

	/** Cache per messageId -> contenuto completo */
	private contentCache = new Map<string, string>();
	private customSendCommand?: (hostId: string, cmd: RemoteCommand) => Promise<unknown>;
	// Un'apertura piu' recente (o la chiusura) invalida i caricamenti precedenti.
	private loadEpoch = 0;

	constructor(ctx?: {
		hostId?: string;
		projectId?: string;
		laneId?: string | null;
		isHistory?: boolean;
		sendCommand?: (hostId: string, cmd: RemoteCommand) => Promise<unknown>;
	}) {
		if (ctx) {
			this.hostId = ctx.hostId ?? '';
			this.projectId = ctx.projectId ?? '';
			this.laneId = ctx.laneId ?? null;
			this.isHistory = ctx.isHistory ?? false;
			this.customSendCommand = ctx.sendCommand;
		}
	}

	setRouteContext(ctx: { hostId: string; projectId: string; laneId: string | null; isHistory?: boolean }): void {
		this.hostId = ctx.hostId;
		this.projectId = ctx.projectId;
		this.laneId = ctx.laneId;
		this.isHistory = ctx.isHistory ?? false;
	}

	async open(target: OpenArtifactOptions): Promise<void> {
		const epoch = ++this.loadEpoch;
		this.isLoading = false;
		this.isOpen = true;
		this.showSource = false;
		this.deviceMode = 'fit';
		this.error = null;
		this.previewUrl = null;

		const targetKind = target.kind;
		const targetTitle = target.title || (
			targetKind === 'mermaid' ? t('artifactKindDiagram') :
			targetKind === 'svg' ? t('artifactKindSvg') :
			t('artifactKindHtml')
		);
		const messageId = target.messageId;

		this.current = {
			kind: targetKind,
			title: targetTitle,
			bytes: target.bytes ?? 0,
			content: target.content ?? null,
			messageId
		};

		let resolvedContent = target.content;

		if (resolvedContent == null) {
			// Se siamo in una sessione storica, get_artifact non e' disponibile
			if (this.isHistory || target.isHistory) {
				this.error = t('previewErrorTooLarge');
				this.isLoading = false;
				return;
			}

			// Controlla cache locale
			if (messageId && this.contentCache.has(messageId)) {
				resolvedContent = this.contentCache.get(messageId)!;
				this.current.content = resolvedContent;
			} else {
				if (!messageId) {
					this.error = t('previewErrorNotFound');
					this.isLoading = false;
					return;
				}

				this.isLoading = true;
				const hId = target.hostId || this.hostId;
				const pId = target.projectId || this.projectId;
				const lId = target.laneId !== undefined ? target.laneId : this.laneId;

				try {
					const send =
						this.customSendCommand ??
						((host: string, cmd: RemoteCommand) => connection.sendCommand(host, cmd));
					const rawResult = await send(hId, {
						kind: 'get_artifact',
						projectId: pId,
						laneId: lId,
						messageId
					});
					if (epoch !== this.loadEpoch) return;

					let artifact: RemoteArtifact | undefined;
					if (rawResult && typeof rawResult === 'object' && 'artifact' in rawResult) {
						artifact = (rawResult as GetArtifactResult).artifact;
					}

					if (!artifact || artifact.content == null) {
						throw { code: 'not_found', message: t('previewErrorNotFound') };
					}

					resolvedContent = artifact.content;
					this.contentCache.set(messageId, resolvedContent);
					if (this.current && this.current.messageId === messageId) {
						this.current.content = resolvedContent;
						this.current.bytes = artifact.bytes || new TextEncoder().encode(resolvedContent).length;
					}
				} catch (err: unknown) {
					if (epoch !== this.loadEpoch) return;
					this.error = mapArtifactError(err);
					this.isLoading = false;
					return;
				}
			}
		}

		// Se l'artefatto e' HTML, va avvolto e pubblicato su /v1/preview (ogni riapertura pubblica nuovamente)
		if (targetKind === 'html') {
			this.isLoading = true;
			try {
				const url = await publishPrototype(resolvedContent, targetTitle);
				if (epoch !== this.loadEpoch) return;
				this.previewUrl = url;
			} catch (err) {
				if (epoch !== this.loadEpoch) return;
				this.error = (err as Error)?.message || t('previewErrorPublish');
			} finally {
				if (epoch === this.loadEpoch) this.isLoading = false;
			}
		} else {
			this.isLoading = false;
		}
	}

	async reloadHtml(): Promise<void> {
		if (this.current?.kind !== 'html' || !this.current.content) return;
		const epoch = ++this.loadEpoch;
		this.isLoading = true;
		this.error = null;
		try {
			const url = await publishPrototype(this.current.content, this.current.title);
			if (epoch !== this.loadEpoch) return;
			this.previewUrl = url;
		} catch (err) {
			if (epoch !== this.loadEpoch) return;
			this.error = (err as Error)?.message || t('previewErrorPublish');
		} finally {
			if (epoch === this.loadEpoch) this.isLoading = false;
		}
	}

	close(): void {
		this.loadEpoch++;
		this.isOpen = false;
		this.current = null;
		this.error = null;
		this.isLoading = false;
		this.previewUrl = null;
		this.showSource = false;
	}
}

const PREVIEW_STORE_KEY = Symbol('studio-pwa-preview-store');

export function setPreviewContext(store: PreviewStore): void {
	setContext(PREVIEW_STORE_KEY, store);
}

export function getPreviewContext(): PreviewStore | undefined {
	return getContext<PreviewStore | undefined>(PREVIEW_STORE_KEY);
}
