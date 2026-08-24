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

function stripDataPrefix(dataUrl: string): string {
	const commaIndex = dataUrl.indexOf(',');
	return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

function getBase64(canvas: HTMLCanvasElement, mimeType: string, quality?: number): string {
	const dataUrl = canvas.toDataURL(mimeType, quality);
	return stripDataPrefix(dataUrl);
}

export async function prepareImage(file: File | Blob): Promise<ImageContent | { error: string }> {
	try {
		const url = URL.createObjectURL(file);
		const img = new Image();

		try {
			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error('Impossibile caricare l’immagine'));
				img.src = url;
			});
		} finally {
			URL.revokeObjectURL(url);
		}

		let width = img.naturalWidth || img.width;
		let height = img.naturalHeight || img.height;

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
			ctx.drawImage(img, 0, 0, width, height);

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
	}
}
