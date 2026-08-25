// Preparazione delle immagini per il filo RPC.
//
// I comandi in ingresso non sono chunkabili e il frame fisico del trasporto
// e' di 1 MiB. Il limite di 700_000 caratteri base64 garantisce che il payload
// JSON del comando `prompt` stia comodamente nel frame senza eccedere la soglia.
// `data` deve essere base64 nudo, senza prefisso data:URL.

import type { ImageContent } from './wire';

const MAX_DIMENSION = 1568;
const MAX_BASE64_LENGTH = 700_000;
const MAX_ATTEMPTS = 4;
const JPEG_QUALITIES = [0.85, 0.7, 0.6];
const IMAGE_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'webp',
	'gif',
	'bmp',
	'avif',
	'ico',
	'svg',
	'tiff',
	'tif'
]);

export function isImageFile(file: File | Blob): boolean {
	if (file.type && file.type.startsWith('image/')) return true;
	if ('name' in file && typeof file.name === 'string') {
		const ext = file.name.split('.').pop()?.toLowerCase();
		if (ext && IMAGE_EXTENSIONS.has(ext)) return true;
	}
	return false;
}

export function extractImageFiles(dataTransfer: DataTransfer | null): File[] {
	if (!dataTransfer) return [];
	const imageFiles: File[] = [];
	const seen = new Set<string>();

	// Se `items` e' supportato ed espone file/immagini, estraiamo da qui ed evitiamo
	// di riesaminare `files`: nei browser moderni (Chromium/Tauri) entrambi contengono
	// gli stessi oggetti, e scorrerli entrambi provocherebbe un doppio inserimento
	// a causa di timestamp sintetici `lastModified` discordanti.
	if (dataTransfer.items && dataTransfer.items.length > 0) {
		for (let i = 0; i < dataTransfer.items.length; i++) {
			const item = dataTransfer.items[i];
			if (item.kind === 'file' || item.type.startsWith('image/')) {
				const file = item.getAsFile();
				if (file && isImageFile(file)) {
					const key = `${file.name}-${file.size}`;
					if (!seen.has(key)) {
						imageFiles.push(file);
						seen.add(key);
					}
				}
			}
		}
		if (imageFiles.length > 0) {
			return imageFiles;
		}
	}

	// Fallback per ambienti senza supporto a `items` o con solo `files` popolato
	if (dataTransfer.files && dataTransfer.files.length > 0) {
		for (let i = 0; i < dataTransfer.files.length; i++) {
			const file = dataTransfer.files[i];
			if (isImageFile(file)) {
				const key = `${file.name}-${file.size}`;
				if (!seen.has(key)) {
					imageFiles.push(file);
					seen.add(key);
				}
			}
		}
	}

	return imageFiles;
}

interface DecodedImageSource {
	width: number;
	height: number;
	draw(ctx: CanvasRenderingContext2D, width: number, height: number): void;
	dispose(): void;
}

function readFileAsDataUrl(file: File | Blob): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const reader = new FileReader();
	reader.onload = () => {
		if (typeof reader.result === 'string') {
			resolve(reader.result);
		} else {
			reject(new Error('Formato di lettura non valido'));
		}
	};
	reader.onerror = () => reject(new Error('Impossibile leggere il file dell’immagine'));
	reader.readAsDataURL(file);
	return promise;
}

async function loadDecodedSource(file: File | Blob): Promise<DecodedImageSource> {
	// 1. Prova prima createImageBitmap (veloce, decodifica diretta in memoria, nessun DOM ne' CSP)
	if (typeof createImageBitmap === 'function') {
		try {
			const bitmap = await createImageBitmap(file);
			return {
				width: bitmap.width,
				height: bitmap.height,
				draw(ctx, w, h) {
					ctx.drawImage(bitmap, 0, 0, w, h);
				},
				dispose() {
					bitmap.close();
				}
			};
		} catch {
			// Fallback su metodo alternativo
		}
	}

	// 2. Fallback su FileReader in data URL + Image
	const dataUrl = await readFileAsDataUrl(file);
	const img = new Image();
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	img.onload = () => resolve();
	img.onerror = () => reject(new Error('Impossibile caricare l’immagine'));
	img.src = dataUrl;
	await promise;
	const width = img.naturalWidth || img.width;
	const height = img.naturalHeight || img.height;
	return {
		width,
		height,
		draw(ctx, w, h) {
			ctx.drawImage(img, 0, 0, w, h);
		},
		dispose() {}
	};
}

function stripDataPrefix(dataUrl: string): string {
	const commaIndex = dataUrl.indexOf(',');
	return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

function getBase64(canvas: HTMLCanvasElement, mimeType: string, quality?: number): string {
	const dataUrl = canvas.toDataURL(mimeType, quality);
	return stripDataPrefix(dataUrl);
}

export async function prepareImage(file: File | Blob): Promise<ImageContent | { error: string }> {
	let source: DecodedImageSource | null = null;
	try {
		source = await loadDecodedSource(file);

		let width = source.width;
		let height = source.height;

		if (!width || !height) {
			return { error: 'Dimensioni dell’immagine non valide' };
		}

		// Ridimensionamento iniziale su canvas: lato lungo <= 1568px
		const maxSide = Math.max(width, height);
		if (maxSide > MAX_DIMENSION) {
			const scale = MAX_DIMENSION / maxSide;
			width = Math.max(1, Math.round(width * scale));
			height = Math.max(1, Math.round(height * scale));
		}

		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return { error: 'Contesto canvas 2D non disponibile' };
		}

		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			canvas.width = width;
			canvas.height = height;
			ctx.clearRect(0, 0, width, height);
			source.draw(ctx, width, height);

			// 1. Prova PNG
			const png = getBase64(canvas, 'image/png');
			if (png.length <= MAX_BASE64_LENGTH) {
				return {
					type: 'image',
					data: png,
					mimeType: 'image/png'
				};
			}

			// 2. Prova JPEG con qualita' decrescente (0.85, 0.7, 0.6)
			for (const quality of JPEG_QUALITIES) {
				const jpeg = getBase64(canvas, 'image/jpeg', quality);
				if (jpeg.length <= MAX_BASE64_LENGTH) {
					return {
						type: 'image',
						data: jpeg,
						mimeType: 'image/jpeg'
					};
				}
			}

			// 3. Se ancora sopra la soglia, dimezza le dimensioni e riprova
			width = Math.max(1, Math.floor(width / 2));
			height = Math.max(1, Math.floor(height / 2));
		}

		return { error: 'Immagine troppo grande per il canale RPC' };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Errore sconosciuto durante la preparazione dell’immagine';
		return { error: message };
	} finally {
		source?.dispose();
	}
}
