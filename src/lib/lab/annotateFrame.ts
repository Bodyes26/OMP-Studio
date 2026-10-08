// Disegno delle annotazioni sul fotogramma del Laboratorio (Gate R42).
//
// Il fotogramma arriva dall'ispettore come PNG senza overlay; qui, in Studio, si
// disegnano riquadri e numeri delle note su un canvas e si ottiene l'immagine
// da allegare al prompt. La geometria e' `annotationShapes` (pura, testata).

import { annotationShapes, type LabFrame, type LabNote } from './visualNotes';

const MARK = '#e2477f';

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('fotogramma non leggibile'));
		img.src = src;
	});
}

/** PNG annotato in base64 (senza prefisso data:), pronto per `ImageContent`. */
export async function renderAnnotatedFrame(
	frame: LabFrame,
	notes: readonly LabNote[]
): Promise<{ data: string; mimeType: string }> {
	const img = await loadImage(frame.dataUrl);
	const canvas = document.createElement('canvas');
	canvas.width = frame.width;
	canvas.height = frame.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('canvas non disponibile');
	ctx.drawImage(img, 0, 0, frame.width, frame.height);

	const unit = Math.max(1, frame.scale);
	for (const shape of annotationShapes(frame, notes)) {
		ctx.save();
		ctx.strokeStyle = MARK;
		ctx.lineWidth = 2 * unit;
		if (shape.kind === 'area') {
			ctx.setLineDash([6 * unit, 4 * unit]);
			ctx.fillStyle = 'rgba(226, 71, 127, 0.08)';
		}
		for (const b of shape.boxes) {
			if (shape.kind === 'area') ctx.fillRect(b.x, b.y, b.width, b.height);
			ctx.strokeRect(b.x, b.y, b.width, b.height);
		}
		ctx.restore();

		const label = String(shape.n);
		const r = 10 * unit;
		ctx.save();
		ctx.font = `700 ${11 * unit}px system-ui, -apple-system, "Segoe UI", sans-serif`;
		const w = Math.max(2 * r, ctx.measureText(label).width + 10 * unit);
		const x = shape.badge.x - r;
		const y = shape.badge.y - r;
		ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
		ctx.shadowBlur = 4 * unit;
		ctx.fillStyle = MARK;
		ctx.beginPath();
		ctx.roundRect(x, y, w, 2 * r, r);
		ctx.fill();
		ctx.shadowBlur = 0;
		ctx.fillStyle = '#ffffff';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(label, x + w / 2, y + r + 0.5 * unit);
		ctx.restore();
	}

	const url = canvas.toDataURL('image/png');
	return { data: url.slice(url.indexOf(',') + 1), mimeType: 'image/png' };
}
