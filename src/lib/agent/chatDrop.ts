// File e cartelle portati nella chat dal sistema operativo (trascinamento o
// selettore di file). Modulo puro: posizioni, nomi, limiti e intestazioni
// dell'IPC grezzo si provano nei test senza WebView.
//
// Un percorso trascinato diventa una menzione `@` con il percorso assoluto,
// come quelle scelte dalla palette: nessuna copia e nessun limite di
// dimensione, perche' omp il file lo legge da se'. Solo le immagini piccole
// viaggiano anche come immagine, perche' il modello le veda.

import { fileBadgeLabel } from './composerDoc.ts';

/** Immagini lette da disco per l'anteprima: oltre resta solo la menzione. */
export const MAX_DROP_IMAGE_BYTES = 5 * 1024 * 1024;

/** Limite degli allegati copiati nella cartella della sessione (incolla di file senza percorso). */
export const MAX_STAGED_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const PREVIEW_IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;

/** Immagini che il backend sa leggere per l'anteprima (il tipo vero lo decidono i magic bytes). */
export function isPreviewableImagePath(path: string): boolean {
	return PREVIEW_IMAGE_RE.test(path.trim());
}

/** Ultimo segmento del percorso, con separatori Windows o POSIX: lo stesso nome del badge. */
export const pathBaseName = fileBadgeLabel;

/** Percorsi distinti e non vuoti, nell'ordine in cui sono arrivati. */
export function uniquePaths(paths: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of paths) {
		const path = raw.trim();
		if (!path) continue;
		const key = path.replace(/\\/g, '/').toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(path);
	}
	return out;
}

/**
 * Tauri consegna la posizione del trascinamento in pixel fisici della
 * WebView; `elementFromPoint` vuole pixel CSS. Il rapporto e'
 * `devicePixelRatio`, che in WebView2 include anche lo zoom della pagina.
 */
export function physicalToCssPoint(position: { x: number; y: number }, devicePixelRatio: number): { x: number; y: number } {
	const ratio = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
	return { x: position.x / ratio, y: position.y / ratio };
}

/** Riassunto dei nomi trascinati per l'evidenziazione: «a.png, b.ts +2». */
export function dropSummary(paths: readonly string[], max = 3): string {
	const names = uniquePaths(paths).map(pathBaseName);
	if (names.length <= max) return names.join(', ');
	return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

/**
 * Header dell'IPC grezzo di `stage_chat_attachment`: un header HTTP porta
 * solo ASCII, quindi i valori viaggiano percent-encoded e Rust li decodifica.
 */
export function stageAttachmentHeaders(sessionKey: string, fileName: string): Record<string, string> {
	return {
		'x-omp-session-key': encodeURIComponent(sessionKey),
		'x-omp-file-name': encodeURIComponent(fileName)
	};
}

export interface DroppedImage {
	mimeType: string;
	base64: string;
	size: number;
}

/** Codici di `chat_attachment_read_image` (src-tauri/src/chat_attachments.rs). */
export type ReadImageErrorCode = 'too_large' | 'not_image' | 'io';

export function readImageErrorCode(error: unknown): ReadImageErrorCode | null {
	if (error && typeof error === 'object' && 'code' in error) {
		const code = (error as { code: unknown }).code;
		if (code === 'too_large' || code === 'not_image' || code === 'io') return code;
	}
	return null;
}

export function readImageErrorMessage(error: unknown): string {
	if (error && typeof error === 'object' && 'message' in error) {
		const message = (error as { message: unknown }).message;
		if (typeof message === 'string') return message;
	}
	return error instanceof Error ? error.message : String(error);
}

/** Base64 -> Blob, per passare l'immagine letta da Rust allo stesso ridimensionamento degli incolla. */
export function base64ToBlob(base64: string, mimeType: string): Blob {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new Blob([bytes], { type: mimeType });
}
